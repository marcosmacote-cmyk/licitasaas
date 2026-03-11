/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  LicitaSaaS — ComprasNet Chat Watcher (Local)           ║
 * ║                                                          ║
 * ║  Roda na sua máquina, intercepta mensagens do            ║
 * ║  ComprasNet e envia para o LicitaSaaS via API.           ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * USO:
 *   1. npm run setup   (instala dependências + Chromium)
 *   2. Edite as variáveis abaixo
 *   3. npm start       (abre browser para login + monitora)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ══════════════════════════════════════════
// ── CONFIGURAÇÃO — EDITE AQUI ──
// ══════════════════════════════════════════

const CONFIG = {
  // URL da API do LicitaSaaS (produção)
  API_URL: 'https://licitasaas-production.up.railway.app',

  // Token JWT — obtenha fazendo login no LicitaSaaS
  // Abra DevTools > Network > copie o header Authorization de qualquer request
  TOKEN: 'SEU_TOKEN_JWT_AQUI',

  // Intervalo de refresh da aba de mensagens (ms)
  REFRESH_INTERVAL: 60000, // 60 segundos

  // Intervalo de envio de mensagens para a API (ms)
  SEND_INTERVAL: 15000, // 15 segundos

  // Intervalo de busca de novos processos no sistema (ms)
  SYNC_INTERVAL: 60000, // 60 segundos
};

// ══════════════════════════════════════════
// ── NÃO EDITE ABAIXO DESTA LINHA ──
// ══════════════════════════════════════════

const SESSION_FILE = path.join(__dirname, '.session-state.json');
const COMPRASNET_BASE = 'https://cnetmobile.estaleiro.serpro.gov.br';
const CHAT_URL_PATTERN = /comprasnet-mensagem\/v2\/chat\//;

const SENDER_TYPE_MAP = { '0': 'sistema', '1': 'fornecedor', '3': 'pregoeiro' };
const CATEGORY_MAP = { '8': 'convocacao', '9': 'comunicado_pregoeiro', '13': 'encerramento_prazo', '14': 'mensagem_participante' };

// Estado Global
const state = {
  activeSessions: new Map(), // processId -> { page, intervalId }
  messageBuffers: new Map(), // processId -> messages[]
  sentMessageIds: new Map(), // processId -> Set<messageId>
  context: null,
};

function buildCompraId(proc) {
  if (!proc.uasg || !proc.modalityCode || !proc.processNumber || !proc.processYear) return null;
  return `${proc.uasg}${String(proc.modalityCode).padStart(2, '0')}${proc.processNumber}${proc.processYear}`;
}

async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Authorization': `Bearer ${CONFIG.TOKEN}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  return fetch(`${CONFIG.API_URL}${endpoint}`, { ...options, headers });
}

async function sendHeartbeat() {
  try {
    await apiFetch('/api/chat-monitor/agents/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        machineName: os.hostname(),
        activeSessions: state.activeSessions.size,
        agentVersion: '1.1.0',
        status: 'online'
      })
    });
  } catch (err) {
    console.warn('  ⚠️ Falha ao enviar heartbeat:', err.message);
  }
}

async function fetchRemoteSessions() {
  try {
    const res = await apiFetch('/api/chat-monitor/agents/sessions');
    if (!res.ok) {
        if (res.status === 401) throw new Error('Token JWT inválido ou expirado.');
        throw new Error(`Erro API: ${res.status}`);
    }
    const processes = await res.json();
    return processes;
  } catch (err) {
    console.error('  ❌ Erro ao buscar processos:', err.message);
    return null;
  }
}

async function sendToAPI(processId) {
  const buffer = state.messageBuffers.get(processId) || [];
  if (buffer.length === 0) return;

  const toSend = [...buffer];
  state.messageBuffers.set(processId, []);

  try {
    const res = await apiFetch('/api/chat-monitor/ingest', {
      method: 'POST',
      body: JSON.stringify({ processId, messages: toSend }),
    });

    const data = await res.json();
    if (data.success) {
      console.log(`  📤 Enviado ${data.created} msgs novas (${data.alerts} alertas) → proc ${processId.substring(0,8)}`);
    } else {
      console.error(`  ❌ API error:`, data.error || data);
      state.messageBuffers.set(processId, [...toSend, ...(state.messageBuffers.get(processId) || [])]);
    }
  } catch (err) {
    console.error(`  ❌ Falha ao enviar p/ API:`, err.message);
    state.messageBuffers.set(processId, [...toSend, ...(state.messageBuffers.get(processId) || [])]);
  }
}

async function startProcessMonitor(proc) {
  const compraId = buildCompraId(proc);
  if (!compraId) return;

  console.log(`  📡 Iniciando captura para: ${proc.id.substring(0, 8)}... → compraId: ${compraId}`);

  state.messageBuffers.set(proc.id, []);
  state.sentMessageIds.set(proc.id, new Set());

  const page = await state.context.newPage();

  // Set up network interception BEFORE navigating
  page.on('response', async (response) => {
    try {
      const url = response.url();
      if (!CHAT_URL_PATTERN.test(url)) return;
      if (response.status() !== 200 && response.status() !== 206) return;

      const body = await response.json().catch(() => null);
      if (!body || !Array.isArray(body)) return;

      const sent = state.sentMessageIds.get(proc.id);
      let newCount = 0;

      for (const msg of body) {
        const msgId = msg.chaveMensagemNaOrigem;
        if (!msgId || sent.has(msgId)) continue;

        sent.add(msgId);
        newCount++;

        const buffer = state.messageBuffers.get(proc.id) || [];
        buffer.push({
          messageId: msgId,
          content: msg.texto || '',
          authorType: SENDER_TYPE_MAP[msg.tipoRemetente] || 'desconhecido',
          authorCnpj: msg.identificadorRemetente || null,
          eventCategory: msg.categoria || null,
          itemRef: msg.identificadorItem || null,
          captureSource: 'local-watcher',
        });
        state.messageBuffers.set(proc.id, buffer);
      }

      if (newCount > 0) {
        console.log(`  📨 ${newCount} msg(s) capturadas - [${proc.id.substring(0, 8)}]`);
      }
    } catch (err) {
      if (!err.message?.includes('Target closed')) {
        console.warn(`  ⚠️ Response parse:`, err.message);
      }
    }
  });

  // Navigate to the process page
  const sessionUrl = `${COMPRASNET_BASE}/comprasnet-web/private/fornecedor/compras/acompanhamento-compra/${compraId}`;
  try {
    await page.goto(sessionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    console.error(`  ❌ Erro ao navegar no processo ${proc.id}: ${err.message}`);
  }

  // Periodic refresh — click Mensagens tab
  const intervalId = setInterval(async () => {
    try {
      await page.click('text=Mensagem', { timeout: 5000 }).catch(() => {});
    } catch { /* ignore */ }
  }, CONFIG.REFRESH_INTERVAL);

  state.activeSessions.set(proc.id, { page, intervalId });
}

async function stopProcessMonitor(processId) {
  const session = state.activeSessions.get(processId);
  if (!session) return;

  console.log(`  ⏹ Parando monitoramento para proc ${processId.substring(0,8)}`);
  clearInterval(session.intervalId);
  await session.page.close().catch(() => {});
  state.activeSessions.delete(processId);
}

async function syncSessions() {
  const remoteProcesses = await fetchRemoteSessions();
  if (!remoteProcesses) return;

  const remoteIds = new Set(remoteProcesses.map(p => p.id));
  const localIds = new Set(state.activeSessions.keys());

  // Iniciar novos processos
  for (const proc of remoteProcesses) {
    if (!localIds.has(proc.id)) {
      await startProcessMonitor(proc);
    }
  }

  // Parar processos removidos/desativados
  for (const localId of localIds) {
    if (!remoteIds.has(localId)) {
      await stopProcessMonitor(localId);
    }
  }

  // Atualizar heartbeat e enviar log
  await sendHeartbeat();
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  LicitaSaaS — ComprasNet Watcher Local   ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  // Validate config
  if (CONFIG.TOKEN === 'SEU_TOKEN_JWT_AQUI' || !CONFIG.TOKEN) {
    console.error('❌ Configure o TOKEN JWT em CONFIG.TOKEN');
    console.log('   Abra o LicitaSaaS no navegador → DevTools (F12) → Network');
    console.log('   → Clique em qualquer request → Headers → Authorization');
    console.log('   → Copie o valor (sem "Bearer ")');
    process.exit(1);
  }

  // Test API connection
  console.log('🔗 Testando conexão com API...');
  try {
    const testRes = await apiFetch('/api/chat-monitor/health');
    if (testRes.ok) {
      console.log('✅ Conexão com API OK!');
    } else if (testRes.status === 401) {
      console.error('❌ Token JWT inválido. Atualize CONFIG.TOKEN.');
      process.exit(1);
    }
  } catch (err) {
    console.error(`❌ Não conseguiu conectar à API (${CONFIG.API_URL}):`, err.message);
    process.exit(1);
  }

  // Launch browser
  console.log('');
  console.log('🌐 Abrindo navegador...');

  const hasSession = fs.existsSync(SESSION_FILE);
  const browser = await chromium.launch({
    headless: false, // Visible for login and monitoring
    args: ['--no-sandbox'],
  });

  const contextOptions = {
    viewport: { width: 1400, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
  if (hasSession) {
    contextOptions.storageState = SESSION_FILE;
    console.log('📋 Sessão anterior encontrada. Tentando reutilizar...');
  }

  state.context = await browser.newContext(contextOptions);

  // Login page
  const loginPage = await state.context.newPage();
  await loginPage.goto(`${COMPRASNET_BASE}/comprasnet-web/public/landing`, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  // Check if already logged in
  const currentUrl = loginPage.url();
  if (currentUrl.includes('private') || hasSession) {
    console.log('✅ Já logado (sessão reutilizada)!');
  } else {
    console.log('');
    console.log('┌────────────────────────────────────────────┐');
    console.log('│  🔐 Faça login no ComprasNet no navegador  │');
    console.log('│  Aguardando login... (timeout: 5 min)      │');
    console.log('└────────────────────────────────────────────┘');
    console.log('');

    try {
      await loginPage.waitForURL('**/private/**', { timeout: 300000 });
      console.log('✅ Login detectado!');
    } catch {
      console.error('❌ Timeout de login (5 min). Saindo...');
      await browser.close();
      process.exit(1);
    }
  }

  // Save session
  await state.context.storageState({ path: SESSION_FILE });
  console.log('💾 Sessão salva.');
  await loginPage.close();

  console.log('');
  console.log('🚀 Iniciando sincronização com LicitaSaaS...');
  
  // Sincroniza logo na partida
  await syncSessions();

  // Periodic Sync: Verifica processos criados/removidos
  setInterval(syncSessions, CONFIG.SYNC_INTERVAL);

  // Periodic send to API: Envia o buffer capturado para o backend
  setInterval(async () => {
    for (const processId of state.activeSessions.keys()) {
      await sendToAPI(processId);
    }
  }, CONFIG.SEND_INTERVAL);

  console.log('');
  console.log('┌──────────────────────────────────────────────┐');
  console.log('│  ✅ Agente Online e Rodando!                 │');
  console.log('│                                              │');
  console.log('│  • Processos são sincronizados a cada 60s    │');
  console.log('│  • Mensagens são enviadas a cada 15s         │');
  console.log('│  • Heartbeat enviado para o painel           │');
  console.log('│                                              │');
  console.log('│  Deixe esta janela aberta.                   │');
  console.log('│  Pressione Ctrl+C para encerrar.             │');
  console.log('└──────────────────────────────────────────────┘');
  console.log('');

  // Keep alive / Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Encerrando agente...');
    
    // Tenta enviar o que sobrou no buffer
    for (const processId of state.activeSessions.keys()) {
      await sendToAPI(processId);
    }
    
    await browser.close();
    console.log('✅ Agente encerrado.');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
