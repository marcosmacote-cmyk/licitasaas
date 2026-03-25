"""
Configurações do M2A Compras Chat Watcher.
Carrega variáveis de ambiente e define constantes.
"""

import os
import random
from pathlib import Path
from dotenv import load_dotenv

# Carrega .env do diretório do watcher
load_dotenv(Path(__file__).parent.parent / '.env')

# ── LicitaSaaS API ──
LICITASAAS_API_URL = os.getenv('LICITASAAS_API_URL', 'http://localhost:3000')

# ── Worker (modo servidor) ──
CHAT_WORKER_SECRET = os.getenv('CHAT_WORKER_SECRET', '')

# ── M2A Compras Credentials ──
M2A_BASE_URL = os.getenv('M2A_BASE_URL', 'http://precodereferencia.m2atecnologia.com.br')
M2A_WS_BASE_URL = os.getenv('M2A_WS_BASE_URL', 'ws://precodereferencia.m2atecnologia.com.br')
M2A_USERNAME = os.getenv('M2A_USERNAME', '')
M2A_PASSWORD = os.getenv('M2A_PASSWORD', '')

# ── Pusher Config (capturado via engenharia reversa) ──
PUSHER_APP_KEY = os.getenv('PUSHER_APP_KEY', '0ee75c81fdc02cf8f324')
PUSHER_CLUSTER = os.getenv('PUSHER_CLUSTER', 'us2')

# ── WebSocket Patterns (Django Channels do M2A) ──
# Padrão 1: Chat do pregão → ws://.../ws/websocket/chat_pregao/{certame_id}/
# Padrão 2: Fornecedor room → ws://.../ws/websocket/fornecedor/{certame_id}/{participante_id}
WS_CHAT_PATH_TEMPLATE = '/ws/websocket/chat_pregao/{certame_id}/'
WS_FORNECEDOR_PATH_TEMPLATE = '/ws/websocket/fornecedor/{certame_id}/{participante_id}'

# ── Polling (fallback) ──
CHAT_POLL_INTERVAL_SEC = int(os.getenv('CHAT_POLL_INTERVAL_SEC', '30'))
HEARTBEAT_INTERVAL_SEC = int(os.getenv('HEARTBEAT_INTERVAL_SEC', '60'))
SESSION_REFRESH_SEC = int(os.getenv('SESSION_REFRESH_SEC', '180'))

# ── Jitter Anti-Detection ──
JITTER_PERCENT = 0.3
HUMAN_DELAY_MIN = 2.0
HUMAN_DELAY_MAX = 5.0

# ── Safety Limits ──
MAX_CONSECUTIVE_ERRORS = 5
COOLDOWN_AFTER_ERROR_SEC = 60
MAX_SESSIONS = int(os.getenv('MAX_SESSIONS', '30'))

# ── Timeouts ──
HTTP_TIMEOUT_SEC = int(os.getenv('HTTP_TIMEOUT_SEC', '30'))
WS_CONNECT_TIMEOUT_SEC = int(os.getenv('WS_CONNECT_TIMEOUT_SEC', '15'))
WS_PING_INTERVAL_SEC = int(os.getenv('WS_PING_INTERVAL_SEC', '30'))

# ── Paths ──
SESSION_DATA_DIR = Path(__file__).parent.parent / 'session_data'
SESSION_DATA_DIR.mkdir(exist_ok=True)


def jittered_interval(base_sec: float) -> float:
    """Retorna intervalo com jitter aleatório (anti-padrão de bot)."""
    jitter = base_sec * JITTER_PERCENT
    return max(5.0, base_sec + random.uniform(-jitter, jitter))
