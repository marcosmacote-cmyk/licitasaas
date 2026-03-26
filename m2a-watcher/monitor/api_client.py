"""
Worker API Client — Comunicação do M2A Watcher com o LicitaSaaS.

Usa os endpoints internos /api/chat-monitor/internal/*
autenticados por CHAT_WORKER_SECRET.
"""

import logging
from typing import List

import httpx

from config.settings import LICITASAAS_API_URL, CHAT_WORKER_SECRET
from monitor.chat_extractor import M2AChatMessage

logger = logging.getLogger('m2a.api')


class WorkerAPIClient:
    """Cliente HTTP para worker M2A (multi-tenant)."""

    def __init__(self):
        self._base_url = LICITASAAS_API_URL.strip().rstrip('/')
        self._headers = {
            'Authorization': f'Bearer {CHAT_WORKER_SECRET.strip()}',
            'Content-Type': 'application/json',
        }
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers,
            timeout=30.0,
        )

    async def get_all_sessions(self) -> List[dict]:
        """
        Busca TODOS os processos monitorados de TODOS os tenants.
        Filtra apenas processos M2A Compras (pelo link).
        """
        try:
            resp = await self._client.get('/api/chat-monitor/internal/all-sessions')
            resp.raise_for_status()
            all_sessions = resp.json()
            
            # Filtrar apenas processos M2A
            m2a_sessions = [
                s for s in all_sessions
                if self._is_m2a_process(s)
            ]
            
            logger.debug(f'Total monitorados: {len(all_sessions)}, M2A: {len(m2a_sessions)}')
            return m2a_sessions

        except httpx.HTTPStatusError as e:
            logger.error(f'Erro HTTP ao buscar sessions: {e.response.status_code}')
            return []
        except Exception as e:
            logger.error(f'Erro ao buscar sessions: {e}')
            return []

    @staticmethod
    def _is_m2a_process(session: dict) -> bool:
        """Verifica se um processo é da plataforma M2A Compras."""
        link = (session.get('link') or '').lower()
        portal = (session.get('portal') or '').lower()
        
        return (
            'm2atecnologia' in link or
            'm2a' in portal or
            'precodereferencia' in link
        )

    async def send_heartbeat(
        self, 
        active_sessions: int, 
        active_tenants: int = 0, 
        tenant_ids: list = None,
        extra_info: dict = None,
    ) -> bool:
        """Envia heartbeat real para o LicitaSaaS."""
        try:
            payload = {
                'activeSessions': active_sessions,
                'machineName': 'M2A Watcher v2.0 (Hybrid)',
                'tenantIds': tenant_ids or [],
            }
            if extra_info:
                payload['extraInfo'] = extra_info
            resp = await self._client.post(
                '/api/chat-monitor/internal/heartbeat', 
                json=payload,
            )
            resp.raise_for_status()
            logger.info(f'💓 Heartbeat: {active_sessions} sessões, {active_tenants} tenant(s)')
            return True
        except Exception as e:
            logger.warning(f'Heartbeat falhou: {e}')
            return False

    async def ingest_messages(
        self, 
        process_id: str, 
        tenant_id: str, 
        messages: List[M2AChatMessage]
    ) -> dict:
        """
        Envia mensagens para o endpoint interno com tenantId explícito.
        Endpoint: POST /api/chat-monitor/internal/ingest
        """
        if not messages:
            return {'created': 0, 'alerts': 0}

        payload = {
            'processId': process_id,
            'tenantId': tenant_id,
            'messages': [msg.to_ingest_dict() for msg in messages],
        }

        try:
            resp = await self._client.post(
                '/api/chat-monitor/internal/ingest', 
                json=payload,
            )
            resp.raise_for_status()
            result = resp.json()

            created = result.get('created', 0)
            alerts = result.get('alerts', 0)

            if created > 0:
                logger.info(
                    f'Ingeridas {created} msgs para {process_id[:8]} '
                    f'(tenant {tenant_id[:8]}, {alerts} alertas)'
                )

            return result
        except httpx.HTTPStatusError as e:
            logger.error(f'Erro HTTP no ingest: {e.response.status_code} — {e.response.text[:200]}')
            return {'created': 0, 'alerts': 0, 'error': str(e)}
        except Exception as e:
            logger.error(f'Erro no ingest: {e}')
            return {'created': 0, 'alerts': 0, 'error': str(e)}

    async def persist_certame_link(
        self,
        process_id: str,
        certame_id: str,
    ) -> bool:
        """
        Persiste o certame_id descoberto via fuzzy match de volta ao LicitaSaaS.

        Escreve a URL canônica do certame no campo 'link' do processo, garantindo
        que nas próximas execuções o match seja direto pela Strategy 1 (regex na URL),
        sem repetir o fuzzy matching — fundamental para estabilidade pós-restart no Railway.

        Endpoint: PATCH /api/chat-monitor/internal/sessions/{processId}/link
        Idempotente: não atualiza se o link já contém o certame_id.
        """
        try:
            resp = await self._client.patch(
                f'/api/chat-monitor/internal/sessions/{process_id}/link',
                json={'certameId': certame_id},
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get('updated'):
                    logger.info(
                        f'  🔗 [{process_id[:8]}] Link persistido: '
                        f'certame/{certame_id} → banco atualizado'
                    )
                else:
                    logger.debug(
                        f'  [{process_id[:8]}] Link já continha certame/{certame_id} (sem mudança)'
                    )
                return True
            else:
                logger.warning(
                    f'  [{process_id[:8]}] Falha ao persistir link: HTTP {resp.status_code}'
                )
                return False
        except Exception as e:
            logger.warning(f'  [{process_id[:8]}] Erro ao persistir certame link: {e}')
            return False

    async def close(self):
        await self._client.aclose()
