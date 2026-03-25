# M2A Compras Chat Watcher

Watcher centralizado para monitoramento de chat de licitações na plataforma **M2A Compras** (m2atecnologia.com.br).

## Arquitetura

O watcher segue o mesmo padrão do ComprasNet Chat Watcher:
- **Round-Robin**: uma única sessão HTTP autenticada cicla por todos os processos M2A monitorados
- **HTTP-based**: usa `httpx` com cookies de sessão Django (CSRF + sessionid) em vez de browser automation
- **Multi-tenant**: busca processos de todos os tenants via endpoint interno do LicitaSaaS

## Fluxo de Operação

1. **Autenticação**: Login no M2A Compras via Django CSRF (POST /login/)
2. **Sincronização**: Busca processos M2A monitorados no LicitaSaaS
3. **Monitoramento**: Para cada processo:
   - Tenta acessar URL de chat direto
   - Acessa página de detalhes e extrai mensagens do HTML
   - Detecta mudanças de status (sessão, situação, chat disponível)
4. **Ingestão**: Envia mensagens capturadas via `POST /api/chat-monitor/internal/ingest`
5. **Heartbeat**: Envia status periódico ao LicitaSaaS

## Instalação

```bash
# Criar ambiente virtual
python3 -m venv venv
source venv/bin/activate

# Instalar dependências
pip install -r requirements.txt

# Configurar variáveis
cp .env.example .env
# Editar .env com credenciais reais
```

## Uso

```bash
# Modo produção
python main.py

# Modo debug (verbose)
python main.py --debug

# Modo dry-run (apenas exibe, não envia)
python main.py --dry-run
```

## Variáveis de Ambiente

| Variável | Descrição | Exemplo |
|---|---|---|
| `LICITASAAS_API_URL` | URL da API LicitaSaaS | `https://licitasaas-production.up.railway.app` |
| `CHAT_WORKER_SECRET` | Secret compartilhado com o servidor | `licitasaas-worker-secret-2026-dev` |
| `M2A_BASE_URL` | URL base do M2A Compras | `https://precodereferencia.m2atecnologia.com.br` |
| `M2A_USERNAME` | CPF para login (sem formatação) | `99561760363` |
| `M2A_PASSWORD` | Senha do M2A | `senhaaqui` |
| `CHAT_POLL_INTERVAL_SEC` | Intervalo entre processos (seg) | `30` |
| `SESSION_REFRESH_SEC` | Intervalo entre ciclos (seg) | `180` |

## Estrutura de Diretórios

```
m2a-watcher/
├── main.py                    # Ponto de entrada principal
├── config/
│   ├── __init__.py
│   └── settings.py            # Configurações e variáveis de ambiente
├── monitor/
│   ├── __init__.py
│   ├── session_manager.py     # Gerencia sessão Django (CSRF + cookies)
│   ├── chat_extractor.py      # Extrai mensagens do HTML
│   └── api_client.py          # Comunicação com LicitaSaaS API
├── session_data/              # Cache de sessão (auto-criado)
├── requirements.txt
├── .env
└── .env.example
```

## Notas Técnicas

- O chat M2A só é acessível para **participantes ativos** na sessão de disputa
- A plataforma usa **Pusher** para tempo real, mas o watcher faz polling por HTTP
- Quando o chat não está disponível, o watcher monitora **mudanças de status** e gera mensagens sintéticas
- A sessão Django expira após ~6h; o watcher renova automaticamente via re-login
