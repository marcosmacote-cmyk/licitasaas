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
const Database = require('better-sqlite3');

// ══════════════════════════════════════════
// ── CONFIGURAÇÃO — EDITE AQUI ──
// ══════════════════════════════════════════

const CONFIG = {
  // URL da API do LicitaSaaS (produção)
  API_URL: 'https://licitasaas-production.up.railway.app',

  // Token JWT — obtenha fazendo login no LicitaSaaS
  // Abra DevTools > Network > copie o header Authorization de qualquer request
  TOKEN: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI0MmE2MjliMC00ZmQzLTQ4YjQtOWExNi1jNTg1NjAwZmU2ODIiLCJ0ZW5hbnRJZCI6IjlmN2E3MTU1LWJlNjctNDQ3MC04OTUyLWViOTQ3ZmQ5NzkzMSIsInJvbGUiOiJBRE1JTiIsImlhdCI6MTc3MzIyOTQwNiwiZXhwIjoxNzczMjU4MjA2fQ.Et3OFHEBvrENdrOophW79j4PMfI2F6UJ0T8W3W-DDvA',

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

// Initialize SQLite Database (Fase 2)
const db = new Database(path.join(__dirname, 'watcher.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    processId TEXT NOT NULL,
    messageId TEXT NOT NULL,
    content TEXT,
    authorType TEXT,
    authorCnpj TEXT,
    eventCategory TEXT,
    itemRef TEXT,
    captureSource TEXT,
    status TEXT DEFAULT 'pending',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(processId, messageId)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
`);

// Estado Global
const state = {
  activeSessions: new Map(), // processId -> { page, intervalId }
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

async function sendPendingMessages() {
  const pending = db.prepare("SELECT * FROM messages WHERE status = 'pending' LIMIT 200").all();
  if (pending.length === 0) return;

  // Group by processId
  const byProcess = {};
  for (const p of pending) {
    if (!byProcess[p.processId]) byProcess[p.processId] = [];
    byProcess[p.processId].push(p);
  }

  for (const [processId, msgs] of Object.entries(byProcess)) {
    try {
      const res = await apiFetch('/api/chat-monitor/ingest', {
        method: 'POST',
        body: JSON.stringify({ processId, messages: msgs }),
      });

      const data = await res.json();
      if (data.success) {
        // Mark as sent
        const ids = msgs.map(m => m.id);
        const placeholders = ids.map(() => '?').join(',');
        db.prepare(`UPDATE messages SET status = 'sent' WHERE id IN (${placeholders})`).run(ids);
        console.log(`  📤 Enviado ${data.created} msgs novas (${data.alerts} alertas) → proc ${processId.substring(0,8)}`);
      } else {
        console.error(`  ❌ API error:`, data.error || data);
      }
    } catch (err) {
      console.error(`  ❌ Falha ao enviar p/ API (proc ${processId.substring(0,8)}):`, err.message);
    }
  }
}

async function startProcessMonitor(proc) {
  const compraId = buildCompraId(proc);
  if (!compraId) return;

  console.log(`  📡 Iniciando captura para: ${proc.id.substring(0, 8)}... → compraId: ${compraId}`);

  const page = await state.context.newPage();

  // Set up network interception BEFORE navigating
  page.on('response', async (response) => {
    try {
      const url = response.url();
      if (!CHAT_URL_PATTERN.test(url)) return;
      if (response.status() !== 200 && response.status() !== 206) return;

      const body = await response.json().catch(() => null);
      if (!body || !Array.isArray(body)) return;

      const insert = db.prepare(`
        INSERT OR IGNORE INTO messages (processId, messageId, content, authorType, authorCnpj, eventCategory, itemRef, captureSource)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction((msgs) => {
        let count = 0;
        for (const msg of msgs) {
          if (!msg.chaveMensagemNaOrigem) continue;
          const res = insert.run(
            proc.id,
            msg.chaveMensagemNaOrigem,
            msg.texto || '',
            SENDER_TYPE_MAP[msg.tipoRemetente] || 'desconhecido',
            msg.identificadorRemetente || null,
            msg.categoria || null,
            msg.identificadorItem || null,
            'local-watcher'
          );
          if (res.changes > 0) count++;
        }
        return count;
      });

      const newCount = insertMany(body);

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
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-position=0,0',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list',
    ],
  });

  const contextOptions = {
    viewport: { width: 1400, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Set realistic permissions to mimic real browser
    permissions: ['geolocation', 'notifications'],
    bypassCSP: true,
  };
  if (hasSession) {
    contextOptions.storageState = SESSION_FILE;
    console.log('📋 Sessão anterior encontrada. Tentando reutilizar...');
  }

  state.context = await browser.newContext(contextOptions);

  // Login page
  const loginPage = await state.context.newPage();
  
  // Mudamos a URL base porque o Serpro desativou a tela /public/landing
  await loginPage.goto(`https://www.comprasnet.gov.br/seguro/loginPortal.asp`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Check if already logged in by waiting for a moment to see where the URL stabilizes after applying state
  await loginPage.waitForTimeout(3000); // give it a beat to redirect
  const currentUrl = loginPage.url();
  
  // Mudamos a heurística de "já logado" 
  const isAlreadyLoggedIn = (currentUrl.includes('private') || currentUrl.includes('cnetmobile.estaleiro')) && !currentUrl.includes('loginportal') && !currentUrl.includes('acesso.gov.br');

  if (isAlreadyLoggedIn && hasSession) {
    console.log('✅ Já logado (sessão reutilizada)!');
  } else {
    console.log('');
    console.log('┌────────────────────────────────────────────┐');
    console.log('│  🔐 Faça login no ComprasNet no navegador  │');
    console.log('│  Aguardando login... (timeout: 10 min)     │');
    console.log('└────────────────────────────────────────────┘');
    console.log('');

    loginPage.setDefaultTimeout(600000); // Força 10 minutos (600000ms) ignorando o padrão de 30s
    try {
      // Damos 10 minutos (600.000 ms) para o usuário rodar MFA, celular e autorizar.
      // E não damos nenhum "goto" agora, deixamos a tela livre para você logar no seu ritmo.
      await loginPage.waitForFunction(() => {
        const url = window.location.href.toLowerCase();
        
        // Se a url for uma página em branco ou nova guia, ignorar.
        if (url === 'about:blank' || url.includes('newtab')) return false;

        // Se estivermos em qualquer tela de login, SSO, ou do portal unificado Gov.br (sso.acesso.gov.br), continua esperando.
        if (
          url.includes('loginportal') || 
          url.includes('sso.acesso.gov.br') || 
          url.includes('autenticacao')
        ) {
          return false;
        }

        // Se chegou aqui, não é página de login e nem gov.br.
        // O Serpro costuma transferir você para comprasnet.gov.br/... ou cnetmobile...
        const isComprasnet = url.includes('comprasnet.gov');
        const isCnetMobile = url.includes('cnetmobile');
        return isComprasnet || isCnetMobile;
      }, undefined, { timeout: 600000, polling: 3000 });
      
      console.log('✅ Login detectado com sucesso!');
    } catch (e) {
      console.error('❌ Falha ou Timeout (10 min) aguardando login:', e.message);
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

  // Periodic send to API: Envia o buffer persistido no banco de dados para o backend
  setInterval(async () => {
    await sendPendingMessages();
  }, CONFIG.SEND_INTERVAL);

  console.log('');
  console.log('┌──────────────────────────────────────────────┐');
  console.log('│  ✅ Agente Online e Rodando!                 │');
  console.log('│                                              │');
  console.log('│  • Processos são sincronizados a cada 60s    │');
  console.log('│  • Mensagens são enviadas a cada 15s         │');
  console.log('│  • DB Local Ligado — Prevenção a falhas      │');
  console.log('│  • Heartbeat enviado para o painel           │');
  console.log('│                                              │');
  console.log('│  Deixe esta janela aberta.                   │');
  console.log('│  Pressione Ctrl+C para encerrar.             │');
  console.log('└──────────────────────────────────────────────┘');
  console.log('');

  // Keep alive / Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Encerrando agente...');
    
    // Tenta enviar o que sobrou no buffer SQLite
    await sendPendingMessages();
    
    await browser.close();
    console.log('✅ Agente encerrado.');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
