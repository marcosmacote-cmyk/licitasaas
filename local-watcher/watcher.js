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

// ══════════════════════════════════════════
// ── CONFIGURAÇÃO — EDITE AQUI ──
// ══════════════════════════════════════════

const CONFIG = {
  // URL da API do LicitaSaaS (produção)
  API_URL: 'https://licitasaas-production.up.railway.app',

  // Token JWT — obtenha fazendo login no LicitaSaaS
  // Abra DevTools > Network > copie o header Authorization de qualquer request
  TOKEN: 'SEU_TOKEN_JWT_AQUI',

  // IDs dos processos para monitorar
  // Encontre na URL do Kanban ou no Monitor Chat
  PROCESSES: [
    // { id: 'UUID_DO_PROCESSO', uasg: '943001', modalityCode: '5', processNumber: '91398', processYear: '2026' },
  ],

  // Intervalo de refresh da aba de mensagens (ms)
  REFRESH_INTERVAL: 60000, // 60 segundos

  // Intervalo de envio de mensagens para a API (ms)
  SEND_INTERVAL: 15000, // 15 segundos
};

// ══════════════════════════════════════════
// ── NÃO EDITE ABAIXO DESTA LINHA ──
// ══════════════════════════════════════════

const SESSION_FILE = path.join(__dirname, '.session-state.json');
const COMPRASNET_BASE = 'https://cnetmobile.estaleiro.serpro.gov.br';
const CHAT_URL_PATTERN = /comprasnet-mensagem\/v2\/chat\//;

const SENDER_TYPE_MAP = { '0': 'sistema', '1': 'fornecedor', '3': 'pregoeiro' };
const CATEGORY_MAP = { '8': 'convocacao', '9': 'comunicado_pregoeiro', '13': 'encerramento_prazo', '14': 'mensagem_participante' };

// Message buffer per process
const messageBuffers = new Map(); // processId -> messages[]
const sentMessageIds = new Map(); // processId -> Set<messageId>

function buildCompraId(proc) {
  if (!proc.uasg || !proc.modalityCode || !proc.processNumber || !proc.processYear) return null;
  return `${proc.uasg}${String(proc.modalityCode).padStart(2, '0')}${proc.processNumber}${proc.processYear}`;
}

async function sendToAPI(processId) {
  const buffer = messageBuffers.get(processId) || [];
  if (buffer.length === 0) return;

  // Take messages from buffer
  const toSend = [...buffer];
  messageBuffers.set(processId, []);

  try {
    const res = await fetch(`${CONFIG.API_URL}/api/chat-monitor/ingest`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ processId, messages: toSend }),
    });

    const data = await res.json();
    if (data.success) {
      console.log(`  📤 Enviado ${data.created} msgs novas (${data.alerts} alertas) → ${processId.substring(0, 8)}...`);
    } else {
      console.error(`  ❌ API error:`, data.error || data);
      // Put messages back in buffer on failure
      messageBuffers.set(processId, [...toSend, ...(messageBuffers.get(processId) || [])]);
    }
  } catch (err) {
    console.error(`  ❌ Falha na conexão:`, err.message);
    messageBuffers.set(processId, [...toSend, ...(messageBuffers.get(processId) || [])]);
  }
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

  if (CONFIG.PROCESSES.length === 0) {
    console.error('❌ Configure pelo menos um processo em CONFIG.PROCESSES');
    console.log('   Exemplo:');
    console.log('   { id: "uuid", uasg: "943001", modalityCode: "5", processNumber: "91398", processYear: "2026" }');
    process.exit(1);
  }

  // Validate process configs
  for (const proc of CONFIG.PROCESSES) {
    const compraId = buildCompraId(proc);
    if (!compraId) {
      console.error(`❌ Processo ${proc.id} precisa de uasg, modalityCode, processNumber, processYear`);
      process.exit(1);
    }
    messageBuffers.set(proc.id, []);
    sentMessageIds.set(proc.id, new Set());
  }

  // Test API connection
  console.log('🔗 Testando conexão com API...');
  try {
    const testRes = await fetch(`${CONFIG.API_URL}/api/chat-monitor/health`, {
      headers: { 'Authorization': `Bearer ${CONFIG.TOKEN}` },
    });
    if (testRes.ok) {
      console.log('✅ Conexão com API OK!');
    } else if (testRes.status === 401) {
      console.error('❌ Token JWT inválido ou expirado. Atualize CONFIG.TOKEN.');
      process.exit(1);
    } else {
      console.warn(`⚠️ API respondeu com status ${testRes.status}. Continuando...`);
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
    headless: false,
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

  const context = await browser.newContext(contextOptions);

  // Login page
  const loginPage = await context.newPage();
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
  await context.storageState({ path: SESSION_FILE });
  console.log('💾 Sessão salva.');
  await loginPage.close();

  // Start monitoring each process
  console.log('');
  console.log(`🚀 Iniciando monitoramento de ${CONFIG.PROCESSES.length} processo(s)...`);
  console.log('');

  for (const proc of CONFIG.PROCESSES) {
    const compraId = buildCompraId(proc);
    console.log(`  📡 Processo: ${proc.id.substring(0, 8)}... → compraId: ${compraId}`);

    const page = await context.newPage();

    // Set up network interception BEFORE navigating
    page.on('response', async (response) => {
      try {
        const url = response.url();
        if (!CHAT_URL_PATTERN.test(url)) return;
        if (response.status() !== 200 && response.status() !== 206) return;

        const body = await response.json().catch(() => null);
        if (!body || !Array.isArray(body)) return;

        const sent = sentMessageIds.get(proc.id);
        let newCount = 0;

        for (const msg of body) {
          const msgId = msg.chaveMensagemNaOrigem;
          if (!msgId || sent.has(msgId)) continue;

          sent.add(msgId);
          newCount++;

          const buffer = messageBuffers.get(proc.id) || [];
          buffer.push({
            messageId: msgId,
            content: msg.texto || '',
            authorType: SENDER_TYPE_MAP[msg.tipoRemetente] || 'desconhecido',
            authorCnpj: msg.identificadorRemetente || null,
            eventCategory: msg.categoria || null,
            itemRef: msg.identificadorItem || null,
            captureSource: 'local-watcher',
          });
          messageBuffers.set(proc.id, buffer);
        }

        if (newCount > 0) {
          console.log(`  📨 ${newCount} novas mensagens capturadas para ${proc.id.substring(0, 8)}...`);
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
      console.log(`  ✅ Monitorando: ${proc.id.substring(0, 8)}...`);
    } catch (err) {
      console.error(`  ❌ Erro ao navegar: ${err.message}`);
    }

    // Periodic refresh — click Mensagens tab
    setInterval(async () => {
      try {
        await page.click('text=Mensagem', { timeout: 5000 }).catch(() => {});
      } catch { /* ignore */ }
    }, CONFIG.REFRESH_INTERVAL);
  }

  // Periodic send to API
  setInterval(async () => {
    for (const proc of CONFIG.PROCESSES) {
      await sendToAPI(proc.id);
    }
  }, CONFIG.SEND_INTERVAL);

  console.log('');
  console.log('┌────────────────────────────────────────────┐');
  console.log('│  ✅ Watcher rodando!                       │');
  console.log('│                                            │');
  console.log('│  • Mensagens são capturadas automaticamente│');
  console.log('│  • Enviadas para o LicitaSaaS a cada 15s   │');
  console.log('│  • Tab "Mensagem" refresh a cada 60s       │');
  console.log('│                                            │');
  console.log('│  Pressione Ctrl+C para encerrar.           │');
  console.log('└────────────────────────────────────────────┘');
  console.log('');

  // Keep alive
  process.on('SIGINT', async () => {
    console.log('\n🛑 Encerrando watcher...');
    // Send remaining messages
    for (const proc of CONFIG.PROCESSES) {
      await sendToAPI(proc.id);
    }
    await browser.close();
    console.log('✅ Watcher encerrado.');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
