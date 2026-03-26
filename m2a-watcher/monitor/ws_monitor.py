"""
M2A WebSocket Monitor — Monitoramento em tempo real via Django Channels.

O M2A Compras usa dois mecanismos de tempo real (descoberto em 25/03/2026):

1. Django Channels WebSocket:
   - Chat: ws://.../ws/websocket/chat_pregao/{certame_id}/
   - Fornecedor: ws://.../ws/websocket/fornecedor/{certame_id}/{participante_id}
   
2. Pusher (v8.2.0):
   - App Key: 0ee75c81fdc02cf8f324
   - Cluster: us2
   - Usado para notificações de lance/status

Este módulo implementa:
- Conexão WebSocket nativa para o chat (primary)
- Reconexão automática com backoff exponencial
- Parsing de mensagens JSON do WebSocket
- Integração com o extractor para formatar mensagens
"""

import asyncio
import json
import logging
import time
from typing import Callable, Optional, Dict, Set, List

import websockets
from websockets.exceptions import (
    ConnectionClosed,
    ConnectionClosedError,
    ConnectionClosedOK,
    InvalidHandshake,
    InvalidURI,
)

from config.settings import (
    M2A_WS_BASE_URL,
    WS_CHAT_PATH_TEMPLATE,
    WS_FORNECEDOR_PATH_TEMPLATE,
    WS_CONNECT_TIMEOUT_SEC,
    WS_PING_INTERVAL_SEC,
)
from monitor.chat_extractor import M2AChatMessage, make_hash, classify_author, classify_event

logger = logging.getLogger('m2a.ws')


class M2AWebSocketMonitor:
    """
    Monitor WebSocket para o chat de pregões do M2A.

    Cada instância gerencia UMA conexão WebSocket para UM certame.
    O M2AWatcher cria N instâncias para N certames monitorados.
    """

    def __init__(
        self,
        certame_id: str,
        process_id: str,
        cookies: Dict[str, str],
        on_messages: Callable,
        participante_id: str = '',
    ):
        self.certame_id = certame_id
        self.process_id = process_id
        self.participante_id = participante_id
        self._cookies = cookies
        self._on_messages = on_messages

        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._running = False
        self._connected = False
        self._reconnect_delay = 5  # segundos (com backoff)
        self._max_reconnect_delay = 300  # 5 min máximo
        self._seen_hashes: Set[str] = set()
        self._message_count = 0
        self._connect_time: float = 0
        self._task: Optional[asyncio.Task] = None

    @property
    def is_connected(self) -> bool:
        if not self._connected or self._ws is None:
            return False
        if hasattr(self._ws, "open"):
            return self._ws.open
        state = getattr(self._ws, "state", None)
        if state is not None:
            return getattr(state, "name", str(state).split('.')[-1]) == "OPEN"
        return True

    @property
    def ws_url(self) -> str:
        """URL do WebSocket para o chat do certame."""
        path = WS_CHAT_PATH_TEMPLATE.format(certame_id=self.certame_id)
        return f'{M2A_WS_BASE_URL}{path}'

    @property
    def ws_fornecedor_url(self) -> str:
        """URL do WebSocket para o canal do fornecedor."""
        if not self.participante_id:
            return ''
        path = WS_FORNECEDOR_PATH_TEMPLATE.format(
            certame_id=self.certame_id,
            participante_id=self.participante_id,
        )
        return f'{M2A_WS_BASE_URL}{path}'

    def _build_headers(self) -> Dict[str, str]:
        """Constrói headers para autenticação no WebSocket."""
        headers = {
            'Origin': M2A_WS_BASE_URL.replace('ws://', 'http://').replace('wss://', 'https://'),
            'User-Agent': (
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
            ),
        }

        # Enviar cookies de sessão como header Cookie
        if self._cookies:
            cookie_str = '; '.join(f'{k}={v}' for k, v in self._cookies.items())
            headers['Cookie'] = cookie_str

        return headers

    async def start(self):
        """Inicia o monitor WebSocket em background."""
        self._running = True
        self._task = asyncio.create_task(self._connection_loop())
        logger.info(f'🔌 WS Monitor iniciado para certame {self.certame_id}')

    async def stop(self):
        """Para o monitor WebSocket."""
        self._running = False
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._connected = False
        logger.info(f'🔌 WS Monitor parado para certame {self.certame_id}')

    async def _connection_loop(self):
        """Loop de conexão com reconexão automática."""
        while self._running:
            try:
                await self._connect_and_listen()
            except (ConnectionClosed, ConnectionClosedError) as e:
                if self._running:
                    logger.warning(
                        f'WS desconectado (certame {self.certame_id}): {e}. '
                        f'Reconectando em {self._reconnect_delay}s...'
                    )
            except (InvalidHandshake, InvalidURI) as e:
                logger.error(
                    f'WS handshake falhou (certame {self.certame_id}): {e}. '
                    f'Reconectando em {self._reconnect_delay}s...'
                )
            except asyncio.CancelledError:
                break
            except Exception as e:
                if self._running:
                    logger.error(
                        f'WS erro inesperado (certame {self.certame_id}): {e}. '
                        f'Reconectando em {self._reconnect_delay}s...'
                    )

            self._connected = False

            if self._running:
                await asyncio.sleep(self._reconnect_delay)
                # Backoff exponencial
                self._reconnect_delay = min(
                    self._reconnect_delay * 1.5,
                    self._max_reconnect_delay
                )

    async def _connect_and_listen(self):
        """Conecta ao WebSocket e escuta mensagens."""
        url = self.ws_url
        headers = self._build_headers()

        logger.info(f'🔌 Conectando WS: {url}')

        async with websockets.connect(
            url,
            additional_headers=headers,
            open_timeout=WS_CONNECT_TIMEOUT_SEC,
            ping_interval=WS_PING_INTERVAL_SEC,
            ping_timeout=WS_PING_INTERVAL_SEC * 2,
            max_size=2**20,  # 1MB
        ) as ws:
            self._ws = ws
            self._connected = True
            self._connect_time = time.time()
            self._reconnect_delay = 5  # Reset backoff on success

            logger.info(
                f'✅ WS conectado ao certame {self.certame_id} '
                f'({url})'
            )

            async for raw_message in ws:
                if not self._running:
                    break

                try:
                    parsed_messages = self._parse_ws_message(raw_message)
                    if parsed_messages:
                        # Filtrar mensagens já vistas
                        new_msgs = [
                            m for m in parsed_messages
                            if m.msg_id not in self._seen_hashes
                        ]
                        for msg in new_msgs:
                            self._seen_hashes.add(msg.msg_id)
                            self._message_count += 1

                        if new_msgs:
                            logger.info(
                                f'📨 WS [{self.certame_id}] '
                                f'{len(new_msgs)} nova(s) mensagem(ns)'
                            )
                            # Callback para o watcher processar
                            await self._on_messages(self.process_id, new_msgs)

                except Exception as e:
                    logger.warning(f'Erro ao processar msg WS: {e}')

    def _parse_ws_message(self, raw: str | bytes) -> List[M2AChatMessage]:
        """
        Parseia mensagem recebida via WebSocket.

        O M2A pode enviar em diferentes formatos:
        1. JSON com campo 'message' ou 'mensagem'
        2. JSON com array de mensagens
        3. JSON com evento de status
        4. Texto puro (raro)
        """
        if isinstance(raw, bytes):
            raw = raw.decode('utf-8', errors='replace')

        raw = raw.strip()
        if not raw:
            return []

        messages: List[M2AChatMessage] = []

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            # Não é JSON — tratar como texto puro
            if len(raw) > 5 and not raw.startswith('{'):
                msg_id = make_hash(raw, 'sistema', str(int(time.time())))
                messages.append(M2AChatMessage(
                    msg_id=msg_id,
                    content=raw[:2000],
                    author_type='sistema',
                    event_category=classify_event(raw),
                ))
            return messages

        # Processar JSON
        if isinstance(data, dict):
            messages.extend(self._parse_dict_message(data))
        elif isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    messages.extend(self._parse_dict_message(item))

        return messages

    def _parse_dict_message(self, data: dict) -> List[M2AChatMessage]:
        """Parseia uma mensagem em formato dict do WebSocket."""
        messages: List[M2AChatMessage] = []

        # Extrair conteúdo — tentar múltiplos campos
        content = (
            data.get('message') or
            data.get('mensagem') or
            data.get('content') or
            data.get('texto') or
            data.get('msg') or
            data.get('text') or
            ''
        )

        if isinstance(content, dict):
            # Conteúdo pode ser nested
            content = (
                content.get('text') or
                content.get('content') or
                content.get('mensagem') or
                json.dumps(content, ensure_ascii=False)
            )

        content = str(content).strip()

        # Ignorar mensagens de controle/ping
        control_keywords = ['ping', 'pong', 'heartbeat', 'keep-alive', 'keepalive']
        if not content or content.lower() in control_keywords:
            return messages

        # Extrair autor
        author_raw = (
            data.get('author') or
            data.get('autor') or
            data.get('remetente') or
            data.get('sender') or
            data.get('user') or
            data.get('usuario') or
            data.get('nome') or
            ''
        )
        if isinstance(author_raw, dict):
            author_raw = author_raw.get('name') or author_raw.get('nome') or ''

        author_type = classify_author(str(author_raw)) if author_raw else 'sistema'

        # Extrair timestamp
        timestamp = (
            data.get('timestamp') or
            data.get('data_hora') or
            data.get('datetime') or
            data.get('data') or
            data.get('created_at') or
            data.get('hora') or
            ''
        )
        timestamp = str(timestamp)

        # Extrair tipo de evento
        event_type = (
            data.get('type') or
            data.get('tipo') or
            data.get('event') or
            data.get('evento') or
            ''
        )

        # Categorizar evento
        event_category = ''
        if event_type:
            event_category = classify_event(str(event_type))
        if not event_category:
            event_category = classify_event(content)

        # Gerar ID único
        msg_id = data.get('id') or data.get('message_id') or data.get('msg_id')
        if not msg_id:
            msg_id = make_hash(content, author_type, timestamp)
        else:
            msg_id = str(msg_id)

        messages.append(M2AChatMessage(
            msg_id=msg_id,
            content=content[:2000],
            author_type=author_type,
            author_name=str(author_raw),
            timestamp=timestamp,
            event_category=event_category,
        ))

        # Verificar se há sub-mensagens
        sub_messages = data.get('messages') or data.get('mensagens') or []
        if isinstance(sub_messages, list):
            for sub in sub_messages:
                if isinstance(sub, dict):
                    messages.extend(self._parse_dict_message(sub))

        return messages

    def update_cookies(self, cookies: Dict[str, str]):
        """Atualiza cookies (após refresh de sessão)."""
        self._cookies = cookies

    def get_stats(self) -> dict:
        """Retorna estatísticas do monitor."""
        uptime = time.time() - self._connect_time if self._connect_time else 0
        return {
            'certame_id': self.certame_id,
            'process_id': self.process_id[:8],
            'connected': self.is_connected,
            'messages_received': self._message_count,
            'unique_hashes': len(self._seen_hashes),
            'uptime_seconds': int(uptime),
        }


class M2AWebSocketPool:
    """
    Pool de conexões WebSocket para múltiplos certames.
    
    Gerencia N monitores WebSocket simultaneamente,
    um por certame monitorado.
    """

    def __init__(self, on_messages: Callable):
        self._monitors: Dict[str, M2AWebSocketMonitor] = {}
        self._on_messages = on_messages

    @property
    def active_count(self) -> int:
        return sum(1 for m in self._monitors.values() if m.is_connected)

    async def add_certame(
        self,
        certame_id: str,
        process_id: str,
        cookies: Dict[str, str],
        participante_id: str = '',
    ):
        """Adiciona um certame ao pool de monitoramento."""
        key = f'{certame_id}:{process_id}'

        if key in self._monitors:
            # Já está monitorando — atualizar cookies
            self._monitors[key].update_cookies(cookies)
            return

        monitor = M2AWebSocketMonitor(
            certame_id=certame_id,
            process_id=process_id,
            cookies=cookies,
            on_messages=self._on_messages,
            participante_id=participante_id,
        )

        self._monitors[key] = monitor
        await monitor.start()

    async def remove_certame(self, certame_id: str, process_id: str):
        """Remove um certame do pool."""
        key = f'{certame_id}:{process_id}'
        monitor = self._monitors.pop(key, None)
        if monitor:
            await monitor.stop()

    async def sync_certames(
        self,
        active_sessions: List[dict],
        cookies: Dict[str, str],
    ):
        """
        Sincroniza o pool com a lista de sessões ativas.
        Adiciona novos, remove encerrados.
        """
        active_keys = set()
        
        for session in active_sessions:
            certame_id = session.get('certame_id', '')
            process_id = session.get('process_id', '')
            participante_id = session.get('participante_id', '')
            
            if certame_id and process_id:
                key = f'{certame_id}:{process_id}'
                active_keys.add(key)
                await self.add_certame(certame_id, process_id, cookies, participante_id)

        # Remover certames que não estão mais ativos
        keys_to_remove = set(self._monitors.keys()) - active_keys
        for key in keys_to_remove:
            certame_id, process_id = key.split(':', 1)
            await self.remove_certame(certame_id, process_id)
            logger.info(f'Removido certame {certame_id} do pool WS')

    def update_all_cookies(self, cookies: Dict[str, str]):
        """Atualiza cookies em todos os monitores (após re-login)."""
        for monitor in self._monitors.values():
            monitor.update_cookies(cookies)

    def get_stats(self) -> List[dict]:
        """Retorna estatísticas de todos os monitores."""
        return [m.get_stats() for m in self._monitors.values()]

    async def stop_all(self):
        """Para todos os monitores."""
        tasks = [m.stop() for m in self._monitors.values()]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._monitors.clear()
        logger.info('Pool WS encerrado')
