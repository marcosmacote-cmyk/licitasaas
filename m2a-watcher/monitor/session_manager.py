"""
M2A Session Manager — Gerencia autenticação e sessão HTTP no M2A Compras.

A plataforma M2A usa Django com proteção CSRF. O fluxo de login é:
1. GET /usuario/login/ → Obter csrftoken do cookie
2. POST /usuario/login/ → Enviar credenciais com csrfmiddlewaretoken + perfil
3. Manter cookies de sessão (sessionid + csrftoken)

A sessão é mantida via cookies httpx e renovada automaticamente
quando detectamos que expirou (redirect para /login/).

Descobertas via exploração real (25/03/2026):
- URL de login: /usuario/login/ (não /login/)
- Protocolo: HTTP (HTTPS tem problemas de certificado)
- Perfil: radio button no form de login (Fornecedor)
- Chat API: /chat/{certame_id}/ (AJAX)
- WebSocket: ws://.../ws/websocket/chat_pregao/{certame_id}/
"""

import logging
import json
import re
import time
from pathlib import Path
from typing import Optional, Dict

import httpx

from config.settings import (
    M2A_BASE_URL,
    M2A_USERNAME,
    M2A_PASSWORD,
    HTTP_TIMEOUT_SEC,
    SESSION_DATA_DIR,
)

logger = logging.getLogger('m2a.session')


class M2ASessionManager:
    """Gerencia sessão autenticada no M2A Compras.
    
    Suporta dois modos:
    1. Credenciais dinâmicas (via constructor) — para multi-empresa
    2. Credenciais do .env (fallback) — compatibilidade v2.0
    """

    # URLs corrigidas após exploração real
    LOGIN_URL = f'{M2A_BASE_URL}/usuario/login/'
    DASHBOARD_URL = f'{M2A_BASE_URL}/fornecedores/'
    CONTRATACOES_URL = f'{M2A_BASE_URL}/fornecedores/contratacao/contratacao_fornecedor/'
    SESSION_FILE = SESSION_DATA_DIR / 'm2a_session.json'

    USER_AGENT = (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    )

    def __init__(self, username: str = '', password: str = ''):
        # Credenciais: parâmetro explícito OU fallback .env
        self._username = username or M2A_USERNAME
        self._password = password or M2A_PASSWORD
        self._client: Optional[httpx.AsyncClient] = None
        self._csrf_token: str = ''
        self._session_id: str = ''
        self._logged_in: bool = False
        self._login_count: int = 0
        self._last_login_time: float = 0

    @property
    def is_logged_in(self) -> bool:
        return self._logged_in

    @property
    def cookies_dict(self) -> Dict[str, str]:
        """Retorna cookies atuais como dict (para uso no WebSocket)."""
        if not self._client:
            return {}
        return {c.name: c.value for c in self._client.cookies.jar}

    @property
    def csrf_token(self) -> str:
        return self._csrf_token

    def _create_client(self) -> httpx.AsyncClient:
        """Cria um httpx client com cookies persistentes."""
        return httpx.AsyncClient(
            timeout=HTTP_TIMEOUT_SEC,
            follow_redirects=True,
            headers={
                'User-Agent': self.USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
            },
        )

    async def _ensure_client(self):
        """Garante que o client HTTP está inicializado."""
        if self._client is None:
            self._client = self._create_client()

    async def login(self) -> bool:
        """
        Realiza login completo no M2A Compras.
        
        Fluxo (corrigido após exploração real):
        1. GET /usuario/login/ → pegar CSRF token
        2. POST /usuario/login/ → enviar credenciais + perfil "fornecedor"
        3. Verificar se dashboard /fornecedores/ é acessível
        """
        if not self._username or not self._password:
            logger.error('Credenciais M2A não configuradas (username/password vazios)!')
            return False

        await self._ensure_client()
        assert self._client is not None

        try:
            # Step 1: GET login page para obter CSRF token
            logger.info(f'🔐 Acessando página de login M2A: {self.LOGIN_URL}')
            resp = await self._client.get(self.LOGIN_URL)
            
            if resp.status_code != 200:
                logger.error(f'Erro ao acessar login: HTTP {resp.status_code}')
                return False

            # Extrair CSRF token dos cookies
            csrf_token = self._extract_csrf_token(resp)
            if not csrf_token:
                logger.error('CSRF token não encontrado na página de login')
                return False

            logger.info(f'CSRF token obtido: {csrf_token[:20]}...')

            # Step 2: POST login com credenciais + perfil Fornecedor
            logger.info(f'Enviando credenciais para {self._username[:6]}***...')
            login_data = {
                'csrfmiddlewaretoken': csrf_token,
                'username': self._username,
                'password': self._password,
                'perfil': '2',  # Radio: 1=Órgão público, 2=Fornecedor
            }

            resp = await self._client.post(
                self.LOGIN_URL,
                data=login_data,
                headers={
                    'Referer': self.LOGIN_URL,
                    'Origin': M2A_BASE_URL,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            )

            # Verificar response
            response_text = resp.text.lower()
            final_url = str(resp.url)

            # Verificar se login falhou
            if 'credenciais inválidas' in response_text or 'senha incorreta' in response_text:
                logger.error('❌ Credenciais inválidas!')
                return False

            # Se redirecionou para /fornecedores/, login foi bem-sucedido
            if '/fornecedores' in final_url and '/login' not in final_url:
                logger.info('Login redirecionou para dashboard ✅')
                self._logged_in = True
            else:
                # Step 3: Pode precisar selecionar perfil em segundo passo
                if 'selecione' in response_text or 'perfil' in response_text:
                    logger.info('Selecionando perfil Fornecedor (segundo passo)...')
                    success = await self._select_profile(resp, 'fornecedor')
                    if success:
                        self._logged_in = await self._verify_login()
                else:
                    # Verificar se estamos logados
                    self._logged_in = await self._verify_login()

            if self._logged_in:
                self._login_count += 1
                self._last_login_time = time.time()
                self._update_csrf_from_client()
                self._save_session()
                logger.info(f'✅ Login M2A bem-sucedido! (login #{self._login_count})')
            else:
                logger.error('❌ Login não confirmado — sessão pode estar inválida')

            return self._logged_in

        except httpx.ConnectTimeout:
            logger.error('❌ Timeout ao conectar com M2A. Servidor pode estar instável.')
            return False
        except Exception as e:
            logger.error(f'Erro no login: {e}')
            return False

    def _extract_csrf_token(self, resp: httpx.Response) -> str:
        """Extrai CSRF token dos cookies ou do HTML."""
        # Primeiro: tentar dos cookies da resposta
        for cookie in resp.cookies.jar:
            if cookie.name == 'csrftoken':
                self._csrf_token = cookie.value
                return cookie.value

        # Segundo: tentar do HTML (hidden input)
        match = re.search(
            r"name=['\"]csrfmiddlewaretoken['\"].*?value=['\"]([^'\"]+)['\"]",
            resp.text,
            re.IGNORECASE | re.DOTALL
        )
        if match:
            self._csrf_token = match.group(1)
            return match.group(1)

        # Terceiro: tentar do cookie do client
        if self._client:
            for cookie in self._client.cookies.jar:
                if cookie.name == 'csrftoken':
                    self._csrf_token = cookie.value
                    return cookie.value

        return ''

    def _update_csrf_from_client(self):
        """Atualiza CSRF token do client (após login/redirect)."""
        if not self._client:
            return
        for cookie in self._client.cookies.jar:
            if cookie.name == 'csrftoken':
                self._csrf_token = cookie.value
                return

    async def _select_profile(self, login_resp: httpx.Response, profile_type: str) -> bool:
        """Seleciona o perfil de acesso (Fornecedor/Comprador)."""
        assert self._client is not None
        
        try:
            html = login_resp.text
            
            # Padrão 1: Link direto para /fornecedores/
            match = re.search(r'href=["\']([^"\']*fornecedor[^"\']*)["\']', html, re.IGNORECASE)
            if match:
                profile_url = match.group(1)
                if not profile_url.startswith('http'):
                    profile_url = f'{M2A_BASE_URL}{profile_url}'
                
                resp = await self._client.get(profile_url)
                return resp.status_code == 200

            # Padrão 2: Form POST para selecionar perfil
            csrf = self._csrf_token
            for cookie in self._client.cookies.jar:
                if cookie.name == 'csrftoken':
                    csrf = cookie.value
                    break

            resp = await self._client.post(
                self.LOGIN_URL,
                data={
                    'csrfmiddlewaretoken': csrf,
                    'perfil': '2' if profile_type == 'fornecedor' else '1',
                },
                headers={
                    'Referer': self.LOGIN_URL,
                    'Origin': M2A_BASE_URL,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            )

            return resp.status_code in (200, 302)

        except Exception as e:
            logger.warning(f'Erro ao selecionar perfil: {e}')
            return False

    async def _verify_login(self) -> bool:
        """Verifica se a sessão está autenticada acessando o dashboard."""
        assert self._client is not None
        
        try:
            resp = await self._client.get(self.DASHBOARD_URL)
            
            # Se redireciona para login, não está autenticado
            final_url = str(resp.url)
            if '/login' in final_url:
                return False

            # O M2A pode retornar 404 mesmo autenticado (quirk do Django)
            # Verificar se a página tem conteúdo do sistema M2A
            body_lower = resp.text.lower()
            has_m2a_content = (
                'm2a' in body_lower or
                'fornecedor' in body_lower or
                'sistemas' in body_lower or
                'contratacao' in body_lower
            )
            
            # Aceitar se não foi redirecionado para login E tem conteúdo M2A
            return has_m2a_content and resp.status_code in (200, 404)

        except Exception:
            return False

    async def ensure_session(self) -> bool:
        """Garante que a sessão está ativa. Faz login se necessário."""
        await self._ensure_client()
        
        if self._logged_in:
            # Verificar se sessão ainda é válida
            still_valid = await self._verify_login()
            if still_valid:
                return True
            logger.warning('Sessão M2A expirada. Re-autenticando...')
            self._logged_in = False

        # Tentar restaurar sessão salva
        restored = await self._restore_session()
        if restored:
            logger.info('✅ Sessão M2A restaurada do cache')
            return True

        # Login fresh
        return await self.login()

    async def get_page(self, url: str) -> Optional[str]:
        """
        Faz GET em uma URL autenticada.
        Retorna o HTML ou None se falhar.
        """
        if not await self.ensure_session():
            return None

        assert self._client is not None

        try:
            resp = await self._client.get(url)
            
            # Verificar se foi redirecionado para login
            if '/login' in str(resp.url):
                logger.warning('Sessão expirada durante requisição')
                self._logged_in = False
                
                # Tentar re-login e repetir
                if await self.login():
                    resp = await self._client.get(url)
                    if '/login' in str(resp.url):
                        return None
                else:
                    return None

            return resp.text if resp.status_code == 200 else None

        except Exception as e:
            logger.error(f'Erro ao acessar {url}: {e}')
            return None

    async def discover_certames(self) -> list:
        """
        Descobre todos os certames em que o fornecedor está inscrito.
        
        Faz scraping da página "Minhas Contratações" do M2A, que lista
        todos os certames com status, título/objeto e ID.
        
        Retorna:
            Lista de dicts: [{'certame_id': '43465', 'title': '...', 'status': '...'}, ...]
        """
        if not await self.ensure_session():
            return []

        assert self._client is not None

        certames = []
        page = 1
        max_pages = 5  # Safety limit

        while page <= max_pages:
            url = (
                f'{M2A_BASE_URL}/fornecedores/contratacao/'
                f'contratacao_fornecedor/contratacoes/minhas_contratacoes/tabela/'
            )
            if page > 1:
                url += f'?page={page}'

            try:
                resp = await self._client.get(
                    url,
                    headers={'X-Requested-With': 'XMLHttpRequest'},
                )

                if resp.status_code != 200:
                    break

                # Response is JSON with html_table field
                try:
                    data = json.loads(resp.text)
                    html = data.get('html_table', '')
                except (json.JSONDecodeError, ValueError):
                    html = resp.text

                if not html:
                    break

                # Extract certame IDs
                certame_ids = re.findall(r'detalhes/certame/(\d+)', html)
                if not certame_ids:
                    break

                # Extract title/object for each certame by context
                for cid in certame_ids:
                    # Find the certame link position and look backwards for title
                    pattern = rf'detalhes/certame/{cid}'
                    match = re.search(pattern, html)
                    if not match:
                        continue

                    # Get context around the certame link (look back for title)
                    start = max(0, match.start() - 3000)
                    if certames:
                        # Don't overlap with previous certame
                        prev_pattern = rf'detalhes/certame/{certames[-1]["certame_id"]}'
                        prev_match = re.search(prev_pattern, html)
                        if prev_match:
                            start = max(start, prev_match.end())

                    context = html[start:match.end() + 200]

                    # Extract title (longest text block near the certame)
                    text_blocks = re.findall(r'>([^<]{15,})<', context)
                    title = ''
                    for tb in text_blocks:
                        tb = tb.strip()
                        # Skip navigation/button text
                        if any(skip in tb.lower() for skip in [
                            'acessar', 'proposta', 'inscrito', 'collapse',
                            'function', 'onclick', 'javascript',
                        ]):
                            continue
                        if len(tb) > len(title):
                            title = tb

                    # Extract status
                    status_match = re.search(
                        r'(?:Inscrito|Em andamento|Encerrado|Suspenso|Aberto)',
                        context, re.IGNORECASE,
                    )
                    status = status_match.group(0) if status_match else 'Desconhecido'

                    certames.append({
                        'certame_id': cid,
                        'title': title.strip()[:200],
                        'status': status,
                    })

                # Check if there's a next page
                has_next = f"data-page=\"{page + 1}\"" in html
                if not has_next:
                    break

                page += 1

            except Exception as e:
                logger.error(f'Erro ao descobrir certames (página {page}): {e}')
                break

        logger.info(f'🔎 Descobertos {len(certames)} certame(s) para {self._username[:6]}***')
        for c in certames[:5]:
            logger.info(f'   #{c["certame_id"]} [{c["status"]}] {c["title"][:60]}')
        if len(certames) > 5:
            logger.info(f'   ... +{len(certames) - 5} certame(s)')

        return certames

    async def get_all_chat_messages(self, certame_id: str) -> Optional[str]:
        """
        Busca TODAS as mensagens do chat via endpoint de tabela.
        
        Endpoint correto (descoberto via engenharia reversa):
            GET /contratacao/visualizar_todas_mensagens_table/{certame_id}/
        
        Retorna JSON com campo 'html_table' contendo tabela HTML
        com colunas: Data | Autor | Mensagem.
        """
        if not await self.ensure_session():
            return None

        assert self._client is not None

        url = f'{M2A_BASE_URL}/contratacao/visualizar_todas_mensagens_table/{certame_id}/'
        try:
            resp = await self._client.get(
                url,
                headers={
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': (
                        f'{M2A_BASE_URL}/fornecedores/contratacao/'
                        f'contratacao_fornecedor/pregao_eletronico/'
                        f'lei_14133/detalhes/certame/{certame_id}/'
                    ),
                },
            )

            if resp.status_code == 200:
                text = resp.text
                # Parse JSON wrapper if present
                if text.strip().startswith('{'):
                    try:
                        data = json.loads(text)
                        html = data.get('html_table', text)
                        return html
                    except (json.JSONDecodeError, ValueError):
                        pass
                return text
            
            logger.warning(
                f'Mensagens table retornou HTTP {resp.status_code} '
                f'para certame {certame_id}'
            )
            return None

        except Exception as e:
            logger.error(f'Erro ao buscar mensagens para certame {certame_id}: {e}')
            return None

    async def get_chat_messages_ajax(self, certame_id: str) -> Optional[str]:
        """
        Busca mensagens do chat via endpoint AJAX (fallback/legacy).
        Endpoint: /chat/{certame_id}/ (requer POST, mas tentamos GET como fallback)
        
        Nota: O endpoint principal é get_all_chat_messages().
        Este método é mantido como fallback.
        """
        if not await self.ensure_session():
            return None

        assert self._client is not None

        url = f'{M2A_BASE_URL}/chat/{certame_id}/'
        try:
            resp = await self._client.get(
                url,
                headers={
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': f'{M2A_BASE_URL}/fornecedores/contratacao/contratacao_fornecedor/',
                },
            )

            if resp.status_code == 200:
                return resp.text
            
            logger.warning(f'Chat AJAX retornou HTTP {resp.status_code} para certame {certame_id}')
            return None

        except Exception as e:
            logger.error(f'Erro no chat AJAX para certame {certame_id}: {e}')
            return None

    async def get_contratacao_details(self, certame_id: str) -> Optional[str]:
        """
        Acessa página de detalhes da contratação no M2A.
        URL real: /fornecedores/contratacao/contratacao_fornecedor/
                  pregao_eletronico/lei_14133/detalhes/certame/{certame_id}/
        
        Nota: A URL exata depende da modalidade. Usamos a URL genérica via
              discover_certames() + chat AJAX para capturar mensagens.
        """
        # Tentamos múltiplos padrões de URL (diferentes modalidades)
        url_patterns = [
            f'{M2A_BASE_URL}/fornecedores/contratacao/contratacao_fornecedor/'
            f'pregao_eletronico/lei_14133/detalhes/certame/{certame_id}/',
            f'{M2A_BASE_URL}/fornecedores/contratacao/contratacao_fornecedor/'
            f'concorrencia_eletronica/lei_14133/detalhes/certame/{certame_id}/',
        ]
        for url in url_patterns:
            result = await self.get_page(url)
            if result and len(result) > 1000:
                return result
        return None

    def _save_session(self):
        """Salva cookies da sessão para restauração posterior."""
        if not self._client:
            return

        try:
            cookies = {c.name: c.value for c in self._client.cookies.jar}

            session_data = {
                'cookies': cookies,
                'csrf_token': self._csrf_token,
                'saved_at': time.time(),
                'login_count': self._login_count,
            }

            self.SESSION_FILE.write_text(json.dumps(session_data, indent=2))
            logger.debug('Sessão salva em cache')

        except Exception as e:
            logger.warning(f'Erro ao salvar sessão: {e}')

    async def _restore_session(self) -> bool:
        """Tenta restaurar cookies de sessão do cache."""
        if not self.SESSION_FILE.exists():
            return False

        try:
            data = json.loads(self.SESSION_FILE.read_text())
            
            # Sessão com mais de 6h é considerada expirada
            if time.time() - data.get('saved_at', 0) > 6 * 3600:
                logger.info('Sessão em cache muito antiga (>6h). Ignorando.')
                return False

            cookies = data.get('cookies', {})
            if not cookies.get('sessionid'):
                return False

            await self._ensure_client()
            assert self._client is not None

            # Restaurar cookies
            for name, value in cookies.items():
                self._client.cookies.set(name, value)

            self._csrf_token = data.get('csrf_token', '')

            # Verificar se sessão restaurada é válida
            if await self._verify_login():
                self._logged_in = True
                self._login_count = data.get('login_count', 0)
                return True

            return False

        except Exception as e:
            logger.warning(f'Erro ao restaurar sessão: {e}')
            return False

    async def close(self):
        """Fecha o client HTTP."""
        if self._client:
            await self._client.aclose()
            self._client = None
