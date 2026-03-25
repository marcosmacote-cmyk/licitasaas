"""
Teste do session_manager corrigido.
Apenas autenticação - SEM acessar chat ou sessões ativas.
"""

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from monitor.session_manager import M2ASessionManager


async def test():
    print('=' * 60)
    print('  Teste Session Manager (somente login)')
    print('=' * 60)

    session = M2ASessionManager()

    # 1. Login
    print('\n🔐 Testando login via SessionManager...')
    ok = await session.login()
    print(f'   Resultado: {"✅ Sucesso" if ok else "❌ Falha"}')

    if ok:
        # 2. Verificar propriedades
        print(f'   is_logged_in: {session.is_logged_in}')
        cookies = session.cookies_dict
        print(f'   Cookies: {list(cookies.keys())}')
        print(f'   CSRF token: {session.csrf_token[:20]}...' if session.csrf_token else '   CSRF: Não obtido')

        # 3. Verificar ensure_session
        print('\n🔄 Testando ensure_session...')
        still_ok = await session.ensure_session()
        print(f'   Resultado: {"✅ Sessão válida" if still_ok else "❌ Sessão inválida"}')

    await session.close()
    print('\n' + '=' * 60)


if __name__ == '__main__':
    asyncio.run(test())
