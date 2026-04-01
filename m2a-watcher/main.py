"""
M2A Compras Chat Watcher v4.1 — Certame Discovery + Multi-Empresa

Arquitetura:
1. Busca processos M2A monitorados no LicitaSaaS (com credenciais por empresa)
2. Para cada empresa → autentica via SessionPool (login lazy)
3. Descobre certames inscritos via scraping de "Minhas Contratações"
4. Match inteligente entre processos LicitaSaaS ↔ certames M2A (por título/summary)
5. Captura mensagens via Chat AJAX + WebSocket (se disponível)
6. Envia mensagens capturadas ao LicitaSaaS via /internal/ingest
7. Mantém heartbeat e renova sessões automaticamente

v4.1 changelog:
    - Log rotation (RotatingFileHandler, 5MB max, 3 backups)
    - Persistent seen_hashes (sobrevive restart no Railway)
    - Version bump heartbeat (v4.1)
    - Graceful shutdown com persist de estado

USO:
    python main.py                    # Modo produção
    python main.py --debug            # Modo debug (verbose)
    python main.py --dry-run          # Apenas exibe, não envia ao LicitaSaaS
    python main.py --no-ws            # Desabilitar WebSocket (apenas HTTP)
"""

import asyncio
import argparse
import json
import logging
import logging.handlers
import signal
import os
import sys
import time
import re
from difflib import SequenceMatcher
from typing import Dict, List, Set, Optional, Tuple
from pathlib import Path

from config.settings import (
    CHAT_WORKER_SECRET,
    LICITASAAS_API_URL,
    M2A_BASE_URL,
    HEARTBEAT_INTERVAL_SEC,
    SESSION_REFRESH_SEC,
    CHAT_POLL_INTERVAL_SEC,
    SESSION_DATA_DIR,
    jittered_interval,
)
from monitor.session_manager import M2ASessionManager
from monitor.session_pool import M2ASessionPool
from monitor.chat_extractor import M2AChatExtractor, M2AChatMessage
from monitor.api_client import WorkerAPIClient

# ── Logging with rotation ──
LOG_FORMAT = '%(asctime)s  %(name)-22s  %(levelname)-7s  %(message)s'
LOG_DATE_FMT = '%H:%M:%S'

# Rotating file handler: max 5MB, keep 3 backups
file_handler = logging.handlers.RotatingFileHandler(
    'watcher.log', encoding='utf-8', maxBytes=5_000_000, backupCount=3
)
file_handler.setFormatter(logging.Formatter(LOG_FORMAT, datefmt=LOG_DATE_FMT))

logging.basicConfig(
    level=logging.INFO,
    format=LOG_FORMAT,
    datefmt=LOG_DATE_FMT,
    handlers=[
        logging.StreamHandler(sys.stdout),
        file_handler,
    ]
)
logger = logging.getLogger('m2a')

# ── Seen hashes persistence ──
_SEEN_HASHES_FILE = SESSION_DATA_DIR / 'seen_hashes.json'


def _load_seen_hashes() -> Dict[str, List[str]]:
    """Load previously seen message hashes from disk."""
    if not _SEEN_HASHES_FILE.exists():
        return {}
    try:
        data = json.loads(_SEEN_HASHES_FILE.read_text())
        return {k: list(v) for k, v in data.items()}
    except Exception:
        return {}


def _save_seen_hashes(seen: Dict[str, Set[str]]):
    """Persist seen message hashes to disk."""
    try:
        serializable = {k: list(v) for k, v in seen.items()}
        _SEEN_HASHES_FILE.write_text(json.dumps(serializable))
    except Exception as e:
        logger.warning(f'Erro ao salvar seen hashes: {e}')


# ── Text Similarity / Matching ──
def normalize_text(text: str) -> str:
    """Normaliza texto para comparação: lowercase, sem pontuação, sem espaços extras."""
    text = text.lower()
    text = re.sub(r'[^\w\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def text_similarity(a: str, b: str) -> float:
    """Calcula similaridade entre dois textos (0.0 a 1.0)."""
    na = normalize_text(a)
    nb = normalize_text(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio()


def match_process_to_certame(
    process: dict, certames: list
) -> Optional[dict]:
    """
    Faz match de um processo LicitaSaaS com um certame M2A.
    
    Estratégias (em ordem de prioridade):
    1. Match por certame_id no link (se a URL contém /certame/{id}/)
    2. Match por summary/objeto (o campo 'summary' contém a descrição do objeto
       da licitação, que é muito mais similar ao título do certame M2A)
    3. Fallback: match por título (threshold baixo)
    
    Proteções contra falso-positivo (v4.2):
    - Thresholds elevados (0.50 summary / 0.45 title)
    - Cross-validation: se o título do processo contém um número/ano diferente
      do certame, o score é penalizado em -0.20
    - Ano contraditório (ex: processo de 2026 → certame de 2024) = penalidade
    
    Retorna o certame com melhor score ou None.
    """
    link = (process.get('link', '') or '').lower()
    title = process.get('title', '') or ''
    summary = process.get('summary', '') or ''

    # ── Estratégia 1: certame_id direto no link (match instantâneo) ──
    certame_match = re.search(r'detalhes/certame/(\d+)', link)
    if certame_match:
        cid = certame_match.group(1)
        for c in certames:
            if c['certame_id'] == cid:
                logger.info(f'  🔗 Match direto via link: certame #{cid}')
                return c

    # ── Estratégia 2: Match por summary (objeto da licitação) ──
    SUMMARY_THRESHOLD = 0.50  # v4.2: elevado de 0.35 para reduzir falsos-positivos
    TITLE_THRESHOLD = 0.45    # v4.2: elevado de 0.30 para reduzir falsos-positivos

    # Extrair número e ano do processo para cross-validation
    process_numbers = _extract_process_identifiers(title)

    best_score = 0.0
    best_match = None
    match_source = ''
    all_scores = []

    for c in certames:
        ctitle = c.get('title', '')
        if not ctitle:
            continue

        # Score por summary (fonte primária — alto peso)
        summary_score = 0.0
        if summary:
            summary_score = _compute_match_score(summary, ctitle)

        # Score por título (fallback — peso menor)
        title_score = _compute_match_score(title, ctitle)

        # Usar o melhor score entre summary e title
        if summary_score >= title_score:
            score = summary_score
            source = 'summary'
        else:
            score = title_score
            source = 'title'

        # ── Cross-validation: penalizar se números/anos contradizem ──
        certame_numbers = _extract_process_identifiers(ctitle)
        penalty = _compute_contradiction_penalty(process_numbers, certame_numbers)
        if penalty > 0:
            score = max(0, score - penalty)

        all_scores.append((score, source, c.get('certame_id', '?'), ctitle[:60], penalty))

        if score > best_score:
            best_score = score
            best_match = c
            match_source = source

    # Debug: log top 3 candidates
    if all_scores:
        all_scores.sort(reverse=True, key=lambda x: x[0])
        top3 = all_scores[:3]
        src_label = f'summary="{summary[:40]}"' if summary else f'title="{title[:40]}"'
        logger.info(f'  📊 Match candidates ({src_label}):')
        for rank, (sc, src, cid, ct, pen) in enumerate(top3, 1):
            pen_str = f' (penalty={pen:.2f})' if pen > 0 else ''
            logger.info(f'     #{rank} score={sc:.3f} via={src} certame={cid} "{ct}"{pen_str}')

    # Determinar threshold baseado na fonte
    threshold = SUMMARY_THRESHOLD if match_source == 'summary' else TITLE_THRESHOLD

    if best_match and best_score >= threshold:
        logger.info(
            f'  🎯 Match ({match_source}): score={best_score:.2f} | '
            f'certame #{best_match["certame_id"]} ↔ "{title[:50]}"'
        )
        return best_match

    if best_match and best_score > 0.20:
        logger.info(
            f'  ⚠️ Melhor candidato ABAIXO do threshold ({best_score:.2f} < {threshold:.2f}): '
            f'certame #{best_match["certame_id"]} — NÃO será usado'
        )

    return None


def _extract_process_identifiers(text: str) -> dict:
    """
    Extrai números de processo e anos de um texto para cross-validation.
    Ex: 'Concorrência 01.018/2026-CE' → {'numbers': ['01.018'], 'years': ['2026']}
    Ex: 'Nº 090.2024-SMO' → {'numbers': ['090'], 'years': ['2024']}
    """
    result = {'numbers': [], 'years': []}
    
    # Extrair anos (4 dígitos entre 2020-2029)
    years = re.findall(r'\b(202[0-9])\b', text)
    result['years'] = list(set(years))
    
    # Extrair números de processo (padrões comuns)
    # Ex: 01.018, 090, PE001, nº 123
    nums = re.findall(r'(?:n[ºo°]?\s*)?([\d]{2,}(?:[./][\d]+)*)', text, re.IGNORECASE)
    result['numbers'] = [n for n in nums if len(n) >= 2 and n not in result['years']]
    
    return result


def _compute_contradiction_penalty(proc_ids: dict, cert_ids: dict) -> float:
    """
    Calcula penalidade se o processo e o certame têm anos ou números CONTRADITÓRIOS.
    
    Regra: Se ambos têm anos e os anos são DIFERENTES → penalidade alta (0.25).
    Se ambos têm números curtos identificáveis e são DIFERENTES → penalidade média (0.15).
    """
    penalty = 0.0
    
    # Penalidade por ano contraditório
    proc_years = set(proc_ids.get('years', []))
    cert_years = set(cert_ids.get('years', []))
    if proc_years and cert_years and not proc_years.intersection(cert_years):
        penalty += 0.25  # Anos totalmente diferentes = forte indicador de mismatch
    
    return penalty


def _compute_match_score(text_a: str, text_b: str) -> float:
    """
    Calcula score de match composto: 60% similaridade de texto + 40% word overlap.
    """
    if not text_a or not text_b:
        return 0.0

    # Score base: similaridade de sequência
    sim_score = text_similarity(text_a, text_b)

    # Bonus: word overlap (palavras importantes em comum)
    a_words = set(normalize_text(text_a).split())
    b_words = set(normalize_text(text_b).split())

    stopwords = {
        'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'para', 'no', 'na',
        'nos', 'nas', 'a', 'o', 'as', 'os', 'um', 'uma', 'uns',
        'contratacao', 'empresa', 'servicos', 'prestacao', 'municipal',
        'prefeitura', 'registro', 'precos', 'futura', 'eventual',
        'visando', 'mediante', 'numero', 'pregao', 'eletronico',
        'eletronica', 'concorrencia', 'licitacao', 'edital',
    }

    a_important = a_words - stopwords
    b_important = b_words - stopwords

    word_score = 0.0
    if a_important and b_important:
        overlap = len(a_important & b_important)
        total = max(len(a_important), len(b_important))
        word_score = overlap / total if total > 0 else 0

    # Combine: 60% text similarity + 40% word overlap
    return 0.6 * sim_score + 0.4 * word_score


class M2AWatcher:
    """Worker centralizado para monitoramento do M2A Compras v4.1 (Certame Discovery + Persistence)."""

    def __init__(self, dry_run: bool = False, use_websocket: bool = True):
        self.session_pool = M2ASessionPool()
        self.extractor = M2AChatExtractor()
        self.api = WorkerAPIClient()
        self.dry_run = dry_run
        self.use_websocket = use_websocket
        self._running = False
        
        # WebSocket pool (lazy init)
        self._ws_pool = None
        self._ws_available = use_websocket

        # Mapeamento processId → tenantId
        self._tenant_map: Dict[str, str] = {}
        # Cache de certames descobertos por login (CNPJ)
        self._discovered_certames: Dict[str, list] = {}
        # Mapeamento processId → certame_id (resultado do match)
        self._process_certame_map: Dict[str, str] = {}
        # Mapeamento processId → login (CNPJ da empresa)
        self._process_login_map: Dict[str, str] = {}
        # Hashes de mensagens já vistas por processo
        self._seen_hashes: Dict[str, Set[str]] = {}
        # Processos com WebSocket ativo
        self._ws_processes: Set[str] = set()
        # Cache de status por processo
        self._status_cache: Dict[str, dict] = {}
        # Estatísticas
        self._cycle_count = 0
        self._total_messages_captured = 0
        self._ws_messages_captured = 0
        self._consecutive_failures = 0

        # Restore persisted seen hashes
        saved = _load_seen_hashes()
        if saved:
            for pid, hashes in saved.items():
                self._seen_hashes[pid] = set(hashes)
            total = sum(len(v) for v in saved.values())
            logger.info(f'✅ Restaurados {total} hashes de mensagens vistas de {len(saved)} processo(s)')

    async def _init_ws_pool(self):
        """Inicializa o pool de WebSocket (lazy)."""
        if self._ws_pool is not None:
            return

        try:
            from monitor.ws_monitor import M2AWebSocketPool
            self._ws_pool = M2AWebSocketPool(on_messages=self._handle_ws_messages)
            logger.info('🔌 Pool WebSocket inicializado')
        except ImportError as e:
            logger.warning(f'WebSocket não disponível (instale websockets): {e}')
            self._ws_available = False

    async def _handle_ws_messages(self, process_id: str, messages: List[M2AChatMessage]):
        """Callback para mensagens recebidas via WebSocket."""
        if self.dry_run:
            for msg in messages:
                logger.info(f'  🔌 [DRY-RUN] [{msg.author_type}] {msg.content[:80]}')
            return

        await self._send_messages(process_id, messages)
        self._ws_messages_captured += len(messages)
        self._total_messages_captured += len(messages)

    async def start(self):
        """Inicia o watcher."""
        self._running = True
        logger.info('=' * 60)
        logger.info('  M2A Compras Chat Watcher v4.1')
        logger.info(f'  API URL: {LICITASAAS_API_URL}')
        logger.info(f'  M2A URL: {M2A_BASE_URL}')
        logger.info(f'  WebSocket: {"Habilitado" if self.use_websocket else "Desabilitado"}')
        logger.info(f'  Dry run: {self.dry_run}')
        logger.info('=' * 60)

        if not CHAT_WORKER_SECRET:
            logger.error('CHAT_WORKER_SECRET não configurado!')
            return

        logger.info('🔐 Modo Multi-Empresa: login lazy + certame discovery')

        # Inicializar WebSocket pool (se habilitado)
        if self.use_websocket:
            await self._init_ws_pool()

        logger.info('🚀 Iniciando monitoramento...')

        # Loops paralelos
        tasks = [
            self._heartbeat_loop(),
            self._round_robin_loop(),
        ]
        
        if self._ws_available and self._ws_pool:
            tasks.append(self._ws_sync_loop())

        await asyncio.gather(*tasks, return_exceptions=True)

    async def _heartbeat_loop(self):
        """Envia heartbeat periódico."""
        while self._running:
            try:
                tenants = list(set(self._tenant_map.values()))
                sessions = len(self._tenant_map)
                ws_active = self._ws_pool.active_count if self._ws_pool else 0
                pool_info = self.session_pool
                
                await self.api.send_heartbeat(
                    sessions, len(tenants),
                    tenant_ids=tenants,
                    extra_info={
                        'ws_connections': ws_active,
                        'ws_messages': self._ws_messages_captured,
                        'session_pool': {
                            'active': pool_info.active_count,
                            'total': pool_info.total_count,
                            'logins': pool_info.get_active_logins(),
                        },
                        'matched_certames': len(self._process_certame_map),
                    }
                )
            except Exception as e:
                logger.warning(f'Heartbeat falhou: {e}')
            await asyncio.sleep(jittered_interval(HEARTBEAT_INTERVAL_SEC))

    async def _ws_sync_loop(self):
        """Sincroniza conexões WebSocket com processos monitorados."""
        while self._running:
            try:
                if self._ws_pool and self._process_certame_map:
                    active_ws_sessions = []
                    for pid, certame_id in self._process_certame_map.items():
                        login = self._process_login_map.get(pid, '')
                        if certame_id and login:
                            cookies = self.session_pool.get_cookies_for_login(login)
                            if cookies:
                                active_ws_sessions.append({
                                    'certame_id': certame_id,
                                    'process_id': pid,
                                    'participante_id': '',
                                    'cookies': cookies,
                                })

                    if active_ws_sessions:
                        base_cookies = active_ws_sessions[0].get('cookies', {})
                        await self._ws_pool.sync_certames(active_ws_sessions, base_cookies)
                    
                    self._ws_processes = {
                        s['process_id'] for s in active_ws_sessions
                        if self._ws_pool and any(
                            m.is_connected 
                            for m in self._ws_pool._monitors.values()
                            if m.process_id == s['process_id']
                        )
                    }

            except Exception as e:
                logger.warning(f'WS sync falhou: {e}')

            await asyncio.sleep(60)

    async def _round_robin_loop(self):
        """
        Loop principal Round-Robin para HTTP polling.
        v4.0: Descobre certames via scraping e faz match inteligente.
        """
        while self._running:
            cycle_start = time.time()
            self._cycle_count += 1
            cycle_msgs = 0

            try:
                # 1. Buscar processos M2A monitorados (com credenciais)
                sessions = await self.api.get_all_sessions()
                
                # Filtrar apenas processos M2A
                m2a_sessions = [
                    s for s in sessions
                    if 'm2atecnologia' in (s.get('link', '') or '').lower()
                    or 'm2a' in (s.get('portal', '') or '').lower()
                ]

                if not m2a_sessions:
                    logger.info(f'🔄 Ciclo #{self._cycle_count}: Nenhum processo M2A monitorado')
                else:
                    # Atualizar mapas
                    for s in m2a_sessions:
                        self._tenant_map[s['id']] = s['tenantId']

                    # Agrupar por credencial
                    by_credential: Dict[str, List[dict]] = {}  # login → [session_data]
                    no_cred: List[dict] = []

                    for session_data in m2a_sessions:
                        creds = session_data.get('portalCredentials')
                        if creds and creds.get('login') and creds.get('password'):
                            login = creds['login']
                            self._process_login_map[session_data['id']] = login
                            by_credential.setdefault(login, []).append(session_data)
                        else:
                            no_cred.append(session_data)

                    tenants = len(set(self._tenant_map.values()))
                    total_processable = sum(len(v) for v in by_credential.values())
                    ws_active = self._ws_pool.active_count if self._ws_pool else 0
                    matched = len(self._process_certame_map)
                    
                    logger.info(
                        f'🔄 Ciclo #{self._cycle_count}: '
                        f'{total_processable} processos M2A com credenciais '
                        f'({len(by_credential)} empresa(s), '
                        f'{matched} matched, WS: {ws_active})'
                    )

                    if no_cred:
                        logger.warning(
                            f'⚠️ {len(no_cred)} processo(s) M2A sem credenciais — '
                            f'cadastre as credenciais no painel LicitaSaaS'
                        )

                    # 2. Processar por grupo de credenciais
                    process_index = 0
                    for login, process_group in by_credential.items():
                        company_name = process_group[0].get('companyName', login[:6] + '***')
                        password = process_group[0]['portalCredentials']['password']

                        # Login lazy via SessionPool
                        session = await self.session_pool.get_session(login, password)
                        if not session:
                            logger.error(
                                f'❌ [{company_name}] Falha na autenticação M2A. '
                                f'Pulando {len(process_group)} processo(s).'
                            )
                            continue

                        # 3. Certame Discovery (uma vez por empresa por ciclo)
                        # Redescobrir a cada 10 ciclos ou se não tem cache
                        needs_discovery = (
                            login not in self._discovered_certames
                            or self._cycle_count % 10 == 1
                        )

                        if needs_discovery:
                            logger.info(f'🔎 [{company_name}] Descobrindo certames...')
                            certames = await session.discover_certames()
                            self._discovered_certames[login] = certames
                        else:
                            certames = self._discovered_certames.get(login, [])

                        if not certames:
                            logger.warning(
                                f'⚠️ [{company_name}] Nenhum certame encontrado. '
                                f'Verifique se a empresa está inscrita em processos M2A.'
                            )
                            continue

                        logger.info(
                            f'🏢 [{company_name}] {len(process_group)} processo(s) '
                            f'↔ {len(certames)} certame(s) disponíveis'
                        )

                        # 4. Match processos → certames
                        for session_data in process_group:
                            if not self._running:
                                break

                            pid = session_data['id']
                            process_index += 1
                            title = session_data.get('title', pid[:8])

                            # Verificar se já tem match em cache
                            cached_certame_id = self._process_certame_map.get(pid)
                            if cached_certame_id:
                                certame_id = cached_certame_id
                            else:
                                # Fazer match
                                matched_certame = match_process_to_certame(
                                    session_data, certames
                                )
                                if matched_certame:
                                    certame_id = matched_certame['certame_id']
                                    self._process_certame_map[pid] = certame_id

                                    # ── Write-back: persistir certame_id no LicitaSaaS ──
                                    # Garante match direto (Strategy 1) nos próximos ciclos,
                                    # incluindo após restart no Railway.
                                    asyncio.create_task(
                                        self.api.persist_certame_link(pid, certame_id)
                                    )
                                else:
                                    if self._cycle_count <= 2:
                                        logger.warning(
                                            f'  ❓ Sem match para "{title[:50]}" — '
                                            f'certame não identificado'
                                        )
                                    continue


                            # Se WebSocket está ativo, pular polling HTTP (exceto backup)
                            has_ws = pid in self._ws_processes
                            if has_ws and self._cycle_count % 5 != 0:
                                continue

                            try:
                                prefix = '🔌' if has_ws else '🌐'
                                logger.info(
                                    f'  {prefix} [{process_index}/{total_processable}] '
                                    f'Certame #{certame_id} — {title[:50]}'
                                )
                                new_msgs = await self._poll_chat(
                                    pid, certame_id, session
                                )

                                if new_msgs:
                                    logger.info(
                                        f'  📨 [{pid[:8]}] {len(new_msgs)} '
                                        f'nova(s) mensagem(ns)!'
                                    )
                                    for msg in new_msgs[:3]:
                                        logger.info(
                                            f'    [{msg.author_type}] '
                                            f'{msg.content[:80]}'
                                        )
                                    if len(new_msgs) > 3:
                                        logger.info(
                                            f'    ... +{len(new_msgs) - 3} mensagens'
                                        )

                                    if not self.dry_run:
                                        await self._send_messages(pid, new_msgs)
                                    cycle_msgs += len(new_msgs)
                                    self._total_messages_captured += len(new_msgs)

                            except Exception as e:
                                logger.error(f'  ❌ [{pid[:8]}] Erro: {e}')

                            # Delay entre processos
                            await asyncio.sleep(
                                jittered_interval(CHAT_POLL_INTERVAL_SEC / 2)
                            )

                    self._consecutive_failures = 0

                # 5. Persist seen hashes after each full cycle
                _save_seen_hashes(self._seen_hashes)

                # 6. Resumo do ciclo
                elapsed = time.time() - cycle_start
                pool = self.session_pool
                logger.info(
                    f'✅ Ciclo #{self._cycle_count} concluído em {elapsed:.0f}s '
                    f'— {cycle_msgs} novas msgs HTTP '
                    f'(total: {self._total_messages_captured}, '
                    f'WS: {self._ws_messages_captured}) '
                    f'[Pool: {pool.active_count} sessões, '
                    f'{len(self._process_certame_map)} matches]'
                )

            except Exception as e:
                logger.error(f'Erro no ciclo: {e}')
                self._consecutive_failures += 1
                if self._consecutive_failures >= 5:
                    logger.error('Muitas falhas consecutivas. Encerrando.')
                    self._running = False
                    break

            # 6. Aguardar antes do próximo ciclo
            elapsed = time.time() - cycle_start
            wait_time = max(30, SESSION_REFRESH_SEC - elapsed)
            logger.info(f'⏳ Próximo ciclo em {wait_time:.0f}s...')
            await asyncio.sleep(jittered_interval(wait_time))

    async def _poll_chat(
        self,
        process_id: str,
        certame_id: str,
        session: M2ASessionManager,
    ) -> List[M2AChatMessage]:
        """
        Faz polling do chat de um certame M2A.
        
        Estratégia (v4.0):
        1. Endpoint principal: /visualizar_todas_mensagens_table/{id}/
        2. Fallback: /chat/{id}/ (legacy)
        3. A cada 5 ciclos: detalhes da contratação (status changes)
        
        Retorna lista de mensagens novas (não vistas antes).
        """
        all_new_msgs: List[M2AChatMessage] = []

        # Inicializar seen_hashes para este processo
        if process_id not in self._seen_hashes:
            self._seen_hashes[process_id] = set()

        # 1. Endpoint principal: tabela de todas as mensagens
        html = await session.get_all_chat_messages(certame_id)
        if html and len(html) > 50:
            new_msgs = self.extractor.extract_from_html(html)
            if new_msgs:
                truly_new = [
                    m for m in new_msgs
                    if m.msg_id not in self._seen_hashes[process_id]
                ]
                for m in truly_new:
                    self._seen_hashes[process_id].add(m.msg_id)
                all_new_msgs.extend(truly_new)
        else:
            logger.debug(
                f'    Tabela de mensagens vazia para certame #{certame_id} '
                f'(len={len(html) if html else 0})'
            )

        # 2. Detalhes da contratação (para detectar mudanças de status)
        # Fazemos isso com menos frequência (a cada 5 ciclos)
        if self._cycle_count % 5 == 0:
            details_html = await session.get_contratacao_details(certame_id)
            if details_html:
                # Extrair mensagens de chat embutido (backup/fallback)
                if not all_new_msgs:
                    backup_msgs = self.extractor.extract_from_html(details_html)
                    if backup_msgs:
                        truly_new = [
                            m for m in backup_msgs
                            if m.msg_id not in self._seen_hashes[process_id]
                        ]
                        for m in truly_new:
                            self._seen_hashes[process_id].add(m.msg_id)
                        all_new_msgs.extend(truly_new)

                # Detectar mudanças de status
                status_msgs = self._detect_status_changes(
                    process_id, details_html
                )
                all_new_msgs.extend(status_msgs)

        return all_new_msgs

    def _detect_status_changes(
        self, process_id: str, html: str
    ) -> List[M2AChatMessage]:
        """Detecta mudanças de status na página de detalhes."""
        new_status = self.extractor.extract_process_status(html)
        old_status = self._status_cache.get(process_id, {})
        self._status_cache[process_id] = new_status

        if not old_status:
            return []

        changes: List[M2AChatMessage] = []
        import hashlib

        # Verificar mudança de status da sessão
        new_session = new_status.get('session_status', '')
        old_session = old_status.get('session_status', '')
        if new_session and new_session != old_session:
            content = (
                f'[M2A Monitor] Status da sessão alterado: '
                f'{old_session or "N/A"} → {new_session}'
            )
            msg_id = hashlib.md5(
                f'm2a-status|{process_id}|{content}|{time.time()}'.encode()
            ).hexdigest()[:16]
            changes.append(M2AChatMessage(
                msg_id=msg_id,
                content=content,
                author_type='sistema',
                event_category='status_change',
            ))

        # Verificar mudança de situação
        new_sit = new_status.get('situation', '')
        old_sit = old_status.get('situation', '')
        if new_sit and new_sit != old_sit:
            content = (
                f'[M2A Monitor] Situação alterada: '
                f'{old_sit or "N/A"} → {new_sit}'
            )
            msg_id = hashlib.md5(
                f'm2a-sit|{process_id}|{content}|{time.time()}'.encode()
            ).hexdigest()[:16]
            changes.append(M2AChatMessage(
                msg_id=msg_id,
                content=content,
                author_type='sistema',
                event_category='status_change',
            ))

        # Detectar chat ficando disponível
        new_chat = new_status.get('has_chat', False)
        old_chat = old_status.get('has_chat', False)
        if new_chat and not old_chat:
            content = (
                '[M2A Monitor] Chat da licitação ficou DISPONÍVEL! '
                'Monitoramento ativo.'
            )
            msg_id = hashlib.md5(
                f'm2a-chat|{process_id}|avail|{time.time()}'.encode()
            ).hexdigest()[:16]
            changes.append(M2AChatMessage(
                msg_id=msg_id,
                content=content,
                author_type='sistema',
                event_category='chat_available',
            ))

        return changes

    async def _send_messages(
        self, process_id: str, messages: List[M2AChatMessage]
    ):
        """Envia mensagens para a API com tenantId."""
        tenant_id = self._tenant_map.get(process_id, '')
        if not tenant_id:
            logger.error(f'Sem tenantId para {process_id[:8]}!')
            return

        try:
            result = await self.api.ingest_messages(
                process_id, tenant_id, messages
            )
            alerts = result.get('alerts', 0)
            created = result.get('created', 0)
            if created > 0:
                logger.info(f'  ✅ {created} criada(s), {alerts} alerta(s)')
        except Exception as e:
            logger.error(f'Erro no ingest: {e}')

    async def shutdown(self):
        logger.info('Encerrando M2A watcher...')
        self._running = False

        # Persist seen hashes on shutdown
        _save_seen_hashes(self._seen_hashes)
        
        # Parar WebSocket pool
        if self._ws_pool:
            await self._ws_pool.stop_all()
        
        # Fechar todas as sessões do pool
        await self.session_pool.close_all()
        await self.api.close()
        
        logger.info(
            f'Watcher encerrado. Total: {self._total_messages_captured} msgs '
            f'({self._ws_messages_captured} via WS) '
            f'em {self._cycle_count} ciclos. '
            f'{len(self._process_certame_map)} certames matched.'
        )


async def main():
    parser = argparse.ArgumentParser(
        description='M2A Compras Chat Watcher v4.0'
    )
    parser.add_argument(
        '--debug', action='store_true', help='Modo debug (verbose)'
    )
    parser.add_argument(
        '--dry-run', action='store_true',
        help='Apenas exibe, não envia ao LicitaSaaS',
    )
    parser.add_argument(
        '--no-ws', action='store_true',
        help='Desabilitar WebSocket (apenas HTTP polling)',
    )
    args = parser.parse_args()

    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)

    watcher = M2AWatcher(
        dry_run=args.dry_run,
        use_websocket=not args.no_ws,
    )

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(
            sig, lambda: asyncio.create_task(watcher.shutdown())
        )

    try:
        await watcher.start()
    except KeyboardInterrupt:
        await watcher.shutdown()
    except Exception as e:
        logger.error(f'Erro fatal: {e}', exc_info=True)
        await watcher.shutdown()


if __name__ == '__main__':
    asyncio.run(main())
