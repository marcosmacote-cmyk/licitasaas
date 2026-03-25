"""
M2A Session Pool — Gerencia múltiplas sessões autenticadas simultaneamente.

Cada empresa (CNPJ) tem sua própria sessão no M2A.
O pool faz login lazy (quando necessário) e mantém as sessões ativas.

Uso:
    pool = M2ASessionPool()
    session = await pool.get_session('21139049000108', 'senha123')
    html = await session.get_page('/chat/43465/')
"""

import logging
from typing import Dict, Optional

from monitor.session_manager import M2ASessionManager

logger = logging.getLogger('m2a.pool')


class M2ASessionPool:
    """Pool de sessões M2A — uma por credencial (CNPJ)."""

    def __init__(self):
        # Chave = login (CNPJ), Valor = M2ASessionManager
        self._sessions: Dict[str, M2ASessionManager] = {}
        self._login_failures: Dict[str, int] = {}
        self._max_failures = 3  # Máximo de falhas consecutivas antes de desistir

    @property
    def active_count(self) -> int:
        """Número de sessões ativas."""
        return sum(1 for s in self._sessions.values() if s.is_logged_in)

    @property
    def total_count(self) -> int:
        """Número total de sessões (ativas + inativas)."""
        return len(self._sessions)

    def get_active_logins(self) -> list:
        """Retorna lista de CNPJs com sessão ativa."""
        return [k for k, v in self._sessions.items() if v.is_logged_in]

    async def get_session(
        self, login: str, password: str
    ) -> Optional[M2ASessionManager]:
        """
        Retorna sessão autenticada para o login (CNPJ) dado.
        Faz login se necessário. Retorna None se login falhar.
        """
        if not login or not password:
            logger.warning('Credenciais vazias — não é possível obter sessão')
            return None

        # Verificar se já tem muitas falhas
        if self._login_failures.get(login, 0) >= self._max_failures:
            logger.warning(
                f'⏭️ [{login[:6]}***] Ignorando — {self._max_failures} falhas consecutivas'
            )
            return None

        # Sessão existente e ativa?
        if login in self._sessions:
            session = self._sessions[login]
            if session.is_logged_in:
                # Verificar se ainda é válida
                still_valid = await session.ensure_session()
                if still_valid:
                    return session
                # Sessão expirou — refazer login
                logger.info(f'🔄 [{login[:6]}***] Sessão expirada, re-autenticando...')

        # Nova sessão
        logger.info(f'🔐 [{login[:6]}***] Criando nova sessão M2A...')
        session = M2ASessionManager(username=login, password=password)

        success = await session.login()
        if success:
            self._sessions[login] = session
            self._login_failures[login] = 0  # Reset falhas
            logger.info(
                f'✅ [{login[:6]}***] Sessão ativa '
                f'(pool: {self.active_count}/{self.total_count})'
            )
            return session
        else:
            self._login_failures[login] = self._login_failures.get(login, 0) + 1
            failures = self._login_failures[login]
            logger.error(
                f'❌ [{login[:6]}***] Login falhou '
                f'(tentativa {failures}/{self._max_failures})'
            )
            await session.close()
            return None

    def get_cookies_for_login(self, login: str) -> Dict[str, str]:
        """Retorna cookies da sessão de um login específico."""
        session = self._sessions.get(login)
        if session and session.is_logged_in:
            return session.cookies_dict
        return {}

    def reset_failures(self, login: str):
        """Reseta contador de falhas (ex: após credencial ser atualizada)."""
        self._login_failures.pop(login, None)

    async def close_all(self):
        """Fecha todas as sessões do pool."""
        for login, session in self._sessions.items():
            try:
                await session.close()
                logger.info(f'🔒 [{login[:6]}***] Sessão encerrada')
            except Exception as e:
                logger.warning(f'Erro ao fechar sessão {login[:6]}***: {e}')
        self._sessions.clear()
        self._login_failures.clear()
        logger.info('Pool de sessões encerrado')

    async def close_session(self, login: str):
        """Fecha uma sessão específica."""
        session = self._sessions.pop(login, None)
        if session:
            await session.close()

    def __repr__(self) -> str:
        return (
            f'M2ASessionPool(active={self.active_count}, '
            f'total={self.total_count})'
        )
