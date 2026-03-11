# 📡 ComprasNet Chat Watcher — Local

Roda na **sua máquina** e envia as mensagens capturadas do ComprasNet para o LicitaSaaS.

## Pré-requisitos

- Node.js 18+
- Google Chrome ou Chromium (instalado pelo Playwright)

## Setup (uma vez)

```bash
cd local-watcher
npm run setup
```

Isso instala as dependências e o Chromium headless.

## Configuração

Edite o arquivo `watcher.js` e preencha:

### 1. Token JWT

Abra o LicitaSaaS no navegador → F12 (DevTools) → Network → Clique em qualquer request → Headers → copie o valor de `Authorization` (sem "Bearer ").

```js
TOKEN: 'cole_seu_token_aqui',
```

### 2. Processos para monitorar

Para cada processo, você precisa do `id` (UUID), `uasg`, `modalityCode`, `processNumber` e `processYear`.

```js
PROCESSES: [
  {
    id: '17bb7591-aaf2-4285-9514-79ac10ed8291',
    uasg: '943001',
    modalityCode: '5',
    processNumber: '91398',
    processYear: '2026'
  },
],
```

> Esses dados estão disponíveis nos cards do Kanban do LicitaSaaS.

## Uso

```bash
npm start
```

O script:
1. Abre um navegador
2. Pede para fazer login no ComprasNet (se não tiver sessão salva)
3. Navega até a página de cada processo
4. Intercepta todas as mensagens do chat em tempo real
5. Envia para o LicitaSaaS a cada 15 segundos

## Como funciona

```
[Playwright Browser]
   ↓ Intercepta XHR (/comprasnet-mensagem/v2/chat/)
   ↓ Captura mensagens
   ↓ Buffer local
   ↓ POST /api/chat-monitor/ingest (a cada 15s)
[LicitaSaaS Railway]
   ↓ Salva em ChatMonitorLog
[Monitor de Chat UI]
   ↓ Exibe mensagens
```

## Parar

Pressione `Ctrl+C`. As mensagens pendentes serão enviadas antes de encerrar.
