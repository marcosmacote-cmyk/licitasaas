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
  TOKEN: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI0MmE2MjliMC00ZmQzLTQ4YjQtOWExNi1jNTg1NjAwZmU2ODIiLCJ0ZW5hbnRJZCI6IjlmN2E3MTU1LWJlNjctNDQ3MC04OTUyLWViOTQ3ZmQ5NzkzMSIsInJvbGUiOiJBRE1JTiIsImlhdCI6MTc3MzI2MDUwNiwiZXhwIjoxNzczMjg5MzA2fQ.YhDQHB-uOz-_W8f4v0MzK14CWzzdYiawWqc1CU2RNkE',

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
  const uasg = String(proc.uasg).padStart(6, '0');
  const mod = String(proc.modalityCode).padStart(2, '0');
  return `${uasg}${mod}${proc.processNumber}${proc.processYear}`;
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

  // ── ABORDAGEM: Página Pública + Interceptação de XHR ──
  // O ComprasNet permite acesso público a qualquer processo.
  // Abrimos a página pública e interceptamos as respostas XHR de mensagens.
  const page = await state.context.newPage();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO messages (processId, messageId, content, authorType, authorCnpj, eventCategory, itemRef, captureSource)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Intercepta TODAS as respostas de rede ANTES de navegar
  page.on('response', async (response) => {
    try {
      const url = response.url();
      if (!CHAT_URL_PATTERN.test(url)) return;
      if (response.status() !== 200) return;

      const body = await response.json().catch(() => null);
      if (!body || !Array.isArray(body) || body.length === 0) return;

      const insertMany = db.transaction((msgs) => {
        let count = 0;
        let newTexts = [];
        for (const msg of msgs) {
          if (!msg.chaveMensagemNaOrigem) continue;
          try {
            const res = insert.run(
              proc.id,
              msg.chaveMensagemNaOrigem,
              msg.texto || '',
              msg.tipoRemetente || 'desconhecido',
              msg.identificadorRemetente || null,
              msg.categoria || null,
              msg.identificadorItem || null,
              'comprasnet-xhr'
            );
            if (res.changes > 0) {
              count++;
              newTexts.push(msg.texto ? msg.texto.substring(0, 120).replace(/\n/g, ' ') : '[Mensagem Vazia]');
            }
          } catch(e) { /* unique constraint */ }
        }
        return { count, newTexts };
      });

      const { count: newCount, newTexts } = insertMany(body);

      if (newCount > 0) {
        console.log(`\n======================================================`);
        console.log(`  🚨 MENSAGEM CAPTURADA AO VIVO NO COMPRASNET!`);
        console.log(`  📍 Processo: ${proc.processNumber}/${proc.processYear} (UASG ${proc.uasg})`);
        console.log(`  📨 Quantidade nova: ${newCount}`);
        newTexts.slice(0, 3).forEach(t => {
          console.log(`  💬 "${t}${t.length >= 120 ? '...' : ''}"`);
        });
        console.log(`======================================================\n`);
      } else if (body.length > 0) {
        // Mensagens existem mas já foram capturadas
        console.log(`  ✅ [${proc.processNumber}/${proc.processYear}] ${body.length} msgs no chat (todas já capturadas).`);
      }
    } catch (err) {
      if (!err.message?.includes('Target closed')) {
        console.warn(`  ⚠️ XHR parse error:`, err.message);
      }
    }
  });

  // ESTRATÉGIA: Preencher os campos de pesquisa — igual ao acesso manual
  const basePage = `${COMPRASNET_BASE}/comprasnet-web/public/compras`;

  try {
    // 1) Carrega a página de pesquisa pública
    await page.goto(basePage, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(6000); // Espera Angular carregar

    // 2) Preenche os campos de pesquisa
    const allInputs = page.locator('input[type="text"], input:not([type])');
    await allInputs.first().waitFor({ state: 'attached', timeout: 10000 });
    const count = await allInputs.count();
    const uasgField = allInputs.nth(count >= 2 ? count - 2 : 0);
    const numField = allInputs.nth(count >= 2 ? count - 1 : Math.min(1, count - 1));

    const uasg6 = String(proc.uasg).padStart(6, '0');
    const compraNum = `${proc.processNumber}${proc.processYear}`;

    await uasgField.fill(uasg6, { timeout: 10000 });
    await numField.fill(compraNum, { timeout: 10000 });
    
    console.log(`  🔍 [${proc.processNumber}/${proc.processYear}] Pesquisando UASG ${uasg6}, Nº ${compraNum}...`);

    // 3) Clica em "Pesquisar"
    await page.click('button:has-text("Pesquisar")', { timeout: 5000 });
    await page.waitForTimeout(5000); // Espera resultados

    // 4) Clica no ícone de "lista/detalhes" (≡) dentro do primeiro card
    //    Usa Playwright click nativo (mouse real) — NÃO evaluate().click()!
    //    O Angular não reconhece clicks via JavaScript puro.
    const listIconSelectors = [
      'i.fa-tasks',
      'i.fa-list',
      'i.fa-list-ul',
      'i.fa-list-alt',
      'i.fa-bars',
      'i.fa-th-list',
    ];
    
    let cardClicked = false;
    for (const sel of listIconSelectors) {
      try {
        const icon = page.locator(sel).first();
        await icon.waitFor({ timeout: 3000 });
        await icon.click({ timeout: 3000 });
        cardClicked = true;
        console.log(`  🖱️ [${proc.processNumber}/${proc.processYear}] Clicou no ícone: ${sel}`);
        break;
      } catch { /* try next */ }
    }
    
    if (!cardClicked) {
      console.warn(`  ⚠️ [${proc.processNumber}/${proc.processYear}] Não encontrou ícone de detalhes no card.`);
    }

    await page.waitForTimeout(8000); // Espera a página do processo carregar
    console.log(`  ✅ [${proc.processNumber}/${proc.processYear}] Processo encontrado e aberto!`);
  } catch (err) {
    console.error(`  ❌ [${proc.processNumber}/${proc.processYear}] Erro na busca: ${err.message.substring(0, 100)}`);
  }


  // ═══════════════════════════════════════════════════════════
  // CLICK HUMANIZADO via CDP (isTrusted: true)
  // O reCAPTCHA v3 detecta dispatchEvent porque isTrusted=false
  // Usando page.mouse via CDP, os eventos são isTrusted=true
  // ═══════════════════════════════════════════════════════════

  // Click humanizado: move mouse → pausa → click com down/up
  async function humanClick(pg, selector) {
    const el = pg.locator(selector).first();
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    if (!box) return false;

    // Ponto aleatório dentro do botão (não exatamente no centro)
    const targetX = box.x + (box.width * 0.3) + (Math.random() * (box.width * 0.4));
    const targetY = box.y + (box.height * 0.3) + (Math.random() * (box.height * 0.4));

    // Move mouse com trajetória (25 passos = parece humano)
    await pg.mouse.move(targetX, targetY, { steps: 25 });
    
    // Pausa natural antes de clicar
    await pg.waitForTimeout(Math.floor(Math.random() * 400) + 300);

    // Click nativo CDP: down + delay + up (isTrusted: true!)
    await pg.mouse.down();
    await pg.waitForTimeout(Math.floor(Math.random() * 80) + 40);
    await pg.mouse.up();

    return true;
  }

  // 1) Click humanizado no botão de refresh (🔄)
  try {
    const refreshed = await humanClick(page, 'button:has(i.fa-sync-alt)');
    if (refreshed) {
      console.log(`  🔄 [${proc.processNumber}/${proc.processYear}] Atualização clicada (mouse humanizado)!`);
      await page.waitForTimeout(8000); // Espera recarregar
    }
  } catch { /* ignore */ }

  // 2) Click humanizado no botão de mensagens (✉️)
  try {
    const envelopeClicked = await humanClick(page, 'button:has(i.fa-envelope)');
    if (envelopeClicked) {
      console.log(`  💬 [${proc.processNumber}/${proc.processYear}] Envelope clicado (mouse humanizado, isTrusted:true)!`);
      await page.waitForTimeout(5000);
    } else {
      console.log(`  ⚠️ [${proc.processNumber}/${proc.processYear}] Botão envelope não encontrado.`);
    }
  } catch(e) {
    console.warn(`  ⚠️ Erro ao clicar envelope:`, e.message?.substring(0, 120));
  }

  // ── Captura contínua: DOM + XHR (o XHR interceptor já roda acima) ──

  // Captura mensagens diretamente do DOM renderizado
  async function captureMessagesFromDOM(pg) {
    return await pg.evaluate(() => {
      const messages = [];
      // Procura blocos de mensagem no painel
      const sidebar = document.querySelector('.p-sidebar, .p-dialog');
      if (!sidebar) return messages;
      
      // Procura divs que parecem mensagens individuais
      const allDivs = sidebar.querySelectorAll('div');
      allDivs.forEach(div => {
        const text = div.textContent?.trim();
        // Mensagens tipicamente têm mais de 20 chars e contém data/hora
        if (text && text.length > 20 && text.length < 2000) {
          messages.push({
            text: text,
            html: div.innerHTML?.substring(0, 3000),
          });
        }
      });
      
      // Fallback: pega todo o conteúdo do sidebar
      if (messages.length === 0 && sidebar) {
        const allText = sidebar.textContent?.trim();
        if (allText && allText.length > 20) {
          messages.push({ text: allText.substring(0, 5000), html: sidebar.innerHTML?.substring(0, 10000) });
        }
      }
      return messages;
    });
  }

  // Polling periódico: refresh (humanizado) + envelope (humanizado) + captura DOM
  const intervalId = setInterval(async () => {
    try {
      if (page.isClosed()) { clearInterval(intervalId); return; }
      
      // Tenta refresh humanizado
      await humanClick(page, 'button:has(i.fa-sync-alt)').catch(() => {});
      await page.waitForTimeout(8000);
      
      // Tenta envelope humanizado
      await humanClick(page, 'button:has(i.fa-envelope)').catch(() => {});
      await page.waitForTimeout(5000);
      
      // Captura do DOM se painel estiver aberto
      const domMsgs = await captureMessagesFromDOM(page).catch(() => []);
      if (domMsgs.length > 0) {
        for (const msg of domMsgs) {
          try {
            const hash = Buffer.from(msg.text.substring(0, 200)).toString('base64');
            db.prepare(`INSERT OR IGNORE INTO messages (id, processId, data, status) VALUES (?, ?, ?, 'pending')`)
              .run(`dom-${proc.id}-${hash}`, proc.id, JSON.stringify({
                source: 'dom',
                text: msg.text,
                capturedAt: new Date().toISOString(),
              }));
          } catch { /* duplicate */ }
        }
      }
    } catch { /* ignore */ }
  }, CONFIG.REFRESH_INTERVAL);

  state.activeSessions.set(proc.id, { page, intervalId });
}

async function stopProcessMonitor(processId) {
  const session = state.activeSessions.get(processId);
  if (!session) return;

  console.log(`  ⏹ Parando monitoramento para proc ${processId.substring(0,8)}`);
  clearInterval(session.intervalId);
  if (session.page) await session.page.close().catch(() => {});
  state.activeSessions.delete(processId);
}

async function syncSessions() {
  const remoteProcesses = await fetchRemoteSessions();
  if (!remoteProcesses) return;

  const remoteIds = new Set(remoteProcesses.map(p => p.id));
  const localIds = new Set(state.activeSessions.keys());

  // Iniciar novos processos (sequencialmente com delay)
  const newProcs = remoteProcesses.filter(p => !localIds.has(p.id));
  for (let i = 0; i < newProcs.length; i++) {
    if (i > 0) {
      console.log(`  ⏳ Aguardando 10s antes do próximo processo...`);
      await new Promise(r => setTimeout(r, 10000));
    }
    await startProcessMonitor(newProcs[i]);
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

  // ── Launch browser — ACESSO PÚBLICO (sem login!) ──
  // Usa o Chrome REAL instalado na máquina + stealth plugin
  console.log('');
  console.log('🌐 Abrindo Chrome real (Acesso Público — sem login)...');

  state.browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--ignore-certificate-errors',
    ],
  });

  state.context = await state.browser.newContext({
    viewport: { width: 1400, height: 900 },
  });

  console.log('🚀 Iniciando sincronização com LicitaSaaS...');
  
  // Sincroniza logo na partida
  await syncSessions();

  // Periodic Sync
  setInterval(syncSessions, CONFIG.SYNC_INTERVAL);

  // Periodic send to API
  setInterval(async () => {
    await sendPendingMessages();
  }, CONFIG.SEND_INTERVAL);

  console.log('');
  console.log('┌──────────────────────────────────────────────┐');
  console.log('│  ✅ Agente Online e Rodando! (Modo Público)  │');
  console.log('│                                              │');
  console.log('│  • Sem necessidade de login no ComprasNet    │');
  console.log('│  • Processos são sincronizados a cada 60s    │');
  console.log('│  • Mensagens são enviadas a cada 15s         │');
  console.log('│  • DB Local — Prevenção a falhas             │');
  console.log('│                                              │');
  console.log('│  Deixe esta janela aberta.                   │');
  console.log('│  Pressione Ctrl+C para encerrar.             │');
  console.log('└──────────────────────────────────────────────┘');
  console.log('');

  // Keep alive / Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Encerrando agente...');
    await sendPendingMessages();
    await state.browser.close().catch(() => {});
    console.log('✅ Agente encerrado.');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
