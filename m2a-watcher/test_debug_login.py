"""
Debug detalhado do login M2A.
"""

import asyncio
import sys
import os
import re

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import httpx
from config.settings import M2A_BASE_URL, M2A_USERNAME, M2A_PASSWORD


async def debug_login():
    print('=' * 60)
    print('  Debug Login M2A')
    print(f'  URL Base: {M2A_BASE_URL}')
    print(f'  Username: {M2A_USERNAME}')
    print(f'  Password: {M2A_PASSWORD[:4]}***')
    print('=' * 60)

    client = httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
        headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
    )

    # Step 1: Descobrir URL de login correto
    print('\n--- Step 1: Descobrir URL de login ---')
    
    urls_to_try = [
        f'{M2A_BASE_URL}/usuario/login/',
        f'{M2A_BASE_URL}/login/',
        f'{M2A_BASE_URL}/accounts/login/',
        f'{M2A_BASE_URL}/',
    ]
    
    login_url = None
    csrf_token = None
    
    for url in urls_to_try:
        try:
            print(f'\n  Tentando: {url}')
            resp = await client.get(url)
            final_url = str(resp.url)
            print(f'  Status: {resp.status_code}, Final URL: {final_url}')
            print(f'  Content-Type: {resp.headers.get("content-type", "?")}')
            print(f'  Body length: {len(resp.text)} bytes')
            
            # Procurar CSRF token
            for cookie in client.cookies.jar:
                if cookie.name == 'csrftoken':
                    csrf_token = cookie.value
                    print(f'  ✅ CSRF cookie: {csrf_token[:30]}...')
            
            # Procurar csrfmiddlewaretoken no HTML
            match = re.search(
                r"name=['\"]csrfmiddlewaretoken['\"].*?value=['\"]([^'\"]+)['\"]",
                resp.text, re.IGNORECASE | re.DOTALL
            )
            if match:
                csrf_token = match.group(1)
                print(f'  ✅ CSRF hidden input: {csrf_token[:30]}...')
            
            # Procurar form de login
            if 'username' in resp.text.lower() and 'password' in resp.text.lower():
                login_url = url
                print(f'  ✅ Form de login encontrado!')
                
                # Extrair action do form
                form_match = re.search(r'<form[^>]*action=["\']([^"\']*)["\']', resp.text, re.IGNORECASE)
                if form_match:
                    print(f'  📋 Form action: {form_match.group(1)}')
                
                # Mostrar campos do form
                inputs = re.findall(r'<input[^>]+name=["\']([^"\']+)["\']', resp.text, re.IGNORECASE)
                print(f'  📋 Form inputs: {inputs}')
                
                # Mostrar radio buttons / selects
                radios = re.findall(r'<input[^>]*type=["\']radio["\'][^>]*name=["\']([^"\']+)["\'][^>]*value=["\']([^"\']+)["\']', resp.text, re.IGNORECASE)
                if radios:
                    print(f'  📋 Radio buttons: {radios}')
                
                selects = re.findall(r'<select[^>]*name=["\']([^"\']+)["\']', resp.text, re.IGNORECASE)
                if selects:
                    print(f'  📋 Selects: {selects}')
                
                # Mostrar trecho relevante do HTML
                form_match2 = re.search(r'<form.*?</form>', resp.text, re.DOTALL | re.IGNORECASE)
                if form_match2:
                    form_html = form_match2.group(0)
                    # Limpar HTML
                    clean = re.sub(r'<[^>]+>', ' ', form_html)
                    clean = re.sub(r'\s+', ' ', clean).strip()
                    print(f'  📋 Form text: {clean[:500]}')
                
                break
                    
        except Exception as e:
            print(f'  ❌ Erro: {e}')
    
    if not login_url:
        print('\n❌ Form de login não encontrado em nenhuma URL!')
        await client.aclose()
        return
    
    if not csrf_token:
        print('\n❌ CSRF token não encontrado!')
        await client.aclose()
        return
    
    # Step 2: Tentar POST de login
    print(f'\n--- Step 2: POST Login ---')
    print(f'  URL: {login_url}')
    
    # Tentar com campo perfil
    login_data = {
        'csrfmiddlewaretoken': csrf_token,
        'username': M2A_USERNAME,
        'password': M2A_PASSWORD,
        'perfil': '2',  # 1=Órgão público, 2=Fornecedor
    }
    print(f'  Data: {", ".join(f"{k}={v[:10]}..." if len(str(v))>10 else f"{k}={v}" for k,v in login_data.items())}')
    
    resp = await client.post(
        login_url,
        data=login_data,
        headers={
            'Referer': login_url,
            'Origin': M2A_BASE_URL,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
    )
    
    final_url = str(resp.url)
    print(f'  Status: {resp.status_code}')
    print(f'  Final URL: {final_url}')
    print(f'  Body length: {len(resp.text)} bytes')
    
    # Checar cookies de sessão
    print(f'\n  Cookies atuais:')
    for cookie in client.cookies.jar:
        display_val = cookie.value[:20] + '...' if len(cookie.value) > 20 else cookie.value
        print(f'    {cookie.name}: {display_val}')
    
    # Verificar se o body indica erro
    body_lower = resp.text.lower()
    if 'erro' in body_lower or 'inválid' in body_lower or 'incorret' in body_lower:
        # Extrair mensagem de erro
        error_match = re.search(r'<(?:div|span|p)[^>]*class=["\'][^"\']*(?:erro|error|alert|message)[^"\']*["\'][^>]*>(.*?)</(?:div|span|p)>', resp.text, re.DOTALL | re.IGNORECASE)
        if error_match:
            error_text = re.sub(r'<[^>]+>', '', error_match.group(1)).strip()
            print(f'\n  ❌ ERRO no login: {error_text}')
        else:
            # Procurar qualquer texto de erro
            for line in resp.text.split('\n'):
                line_lower = line.lower().strip()
                if any(k in line_lower for k in ('erro', 'inválid', 'incorret', 'falha')):
                    clean_line = re.sub(r'<[^>]+>', '', line).strip()
                    if clean_line:
                        print(f'\n  ❌ Possível erro: {clean_line[:200]}')
    
    # Verificar se estamos num dashboard
    if '/login' in final_url:
        print(f'\n  ⚠️ Ainda na página de login!')
        
        # Verificar se há segundo passo
        if 'perfil' in body_lower or 'selecione' in body_lower:
            print(f'  ⚠️ Parece pedir seleção de perfil')
            
    elif '/fornecedores' in final_url or '/dashboard' in final_url:
        print(f'\n  ✅ Redirecionado para dashboard!')
    
    # Step 3: Testar acesso ao dashboard
    print(f'\n--- Step 3: Testar Dashboard ---')
    resp = await client.get(f'{M2A_BASE_URL}/fornecedores/')
    final_url = str(resp.url)
    print(f'  Status: {resp.status_code}')
    print(f'  Final URL: {final_url}')
    
    if '/login' in final_url:
        print(f'  ❌ Redirecionado para login — sessão inválida')
    else:
        print(f'  ✅ Dashboard acessível!')
        title_match = re.search(r'<title>(.*?)</title>', resp.text, re.IGNORECASE)
        if title_match:
            print(f'  📄 Título: {title_match.group(1).strip()}')
    
    # Mostrar um trecho do body para debug
    body_text = re.sub(r'<[^>]+>', ' ', resp.text[:3000])
    body_text = re.sub(r'\s+', ' ', body_text).strip()
    print(f'\n  Body preview: {body_text[:500]}')
    
    await client.aclose()
    print('\n' + '=' * 60)

if __name__ == '__main__':
    asyncio.run(debug_login())
