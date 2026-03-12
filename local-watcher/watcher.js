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
    // Primeiro garante que o elemento existe no DOM
    const el = pg.locator(selector).first();
    await el.waitFor({ state: 'attached', timeout: 5000 });
    
    // Tenta scrollIntoView (com timeout curto, ignora se falhar)
    await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    
    // Pega coordenadas — tenta locator primeiro, fallback para evaluate
    let box = await el.boundingBox();
    if (!box) {
      // Fallback: pega coords via evaluate (funciona com elementos "invisíveis" pro Playwright)
      box = await pg.evaluate((sel) => {
        const icon = document.querySelector(sel.replace('button:has(', '').replace(')', ''));
        const btn = icon ? (icon.closest('button') || icon) : null;
        if (!btn) return null;
        const rect = btn.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }, selector);
    }
    if (!box || box.width === 0) return false;

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

  // Pega coordenadas de um elemento via evaluate (mais confiável que locator)
  async function getElementBox(pg, cssSelector) {
    return await pg.evaluate((sel) => {
      const elements = document.querySelectorAll(sel);
      if (!elements || elements.length === 0) return null;
      
      // Itera em busca do elemento realmente visível na tela
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        const btn = el.closest('button') || el;
        
        // Critérios estritos de visibilidade (Angular/PrimeNG muitas vezes usa display:none ou opacidade)
        const style = window.getComputedStyle(btn);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
        if (btn.offsetWidth === 0 || btn.offsetHeight === 0) continue;
        const rect = btn.getBoundingClientRect();
        // Garante que está no viewport e tem área clicável
        if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.left >= 0) {
           return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }
      }
      return null;
    }, cssSelector);
  }

  // ═══════════════════════════════════════════════════════════
  // PURE HUMAN-IN-THE-LOOP (CAPTCHA BYPASS)
  // Como as automações Playwright falham reCAPTCHA v3, nós 
  // avisamos o usuário para abrir o painel. Nós então monitoramos.
  // ═══════════════════════════════════════════════════════════

  // Avisa o usuário para abrir as mensagens manualmente
  console.log(`  👤 [${proc.processNumber}/${proc.processYear}] Processo aberto! Aguardando ação manual...`);
  console.log(`  ┌─────────────────────────────────────────────────────┐`);
  console.log(`  │  📌 AÇÃO NECESSÁRIA (Human-in-the-Loop):           │`);
  console.log(`  │  1. Na aba aberta, clique em 🔄 (Atualizar)        │`);
  console.log(`  │  2. Em seguida, clique em ✉️ (Mensagens)           │`);
  console.log(`  │  O watcher vai detectar e assumir a captura!       │`);
  console.log(`  └─────────────────────────────────────────────────────┘`);

  // ── Captura contínua: DOM + XHR (o XHR interceptor já roda acima) ──

  // Captura mensagens diretamente do DOM renderizado
  async function captureMessagesFromDOM(pg) {
    return await pg.evaluate(() => {
      const messages = [];
      
      // ─── Estratégia: encontrar headers "Mensagem do ..." e extrair o card pai ───
      // Cada mensagem no ComprasNet tem um header tipo "Mensagem do Agente de contratação"
      // seguido do texto e uma data "Enviada em dd/mm/yyyy às hh:mm:ss"
      
      const allElements = document.querySelectorAll('*');
      
      for (const el of allElements) {
        // Verifica se o texto PRÓPRIO deste elemento (não herdado) começa com "Mensagem do"
        const ownText = el.innerText?.trim() || '';
        
        if (ownText.startsWith('Mensagem do') && ownText.length < 60) {
          // Encontramos um header de mensagem! O card completo está no parent
          // Podemos subir 1, 2 ou 3 níveis para pegar o card inteiro
          let card = el.parentElement;
          
          // Sobe até encontrar um card que tenha a data "Enviada em"
          for (let level = 0; level < 4 && card; level++) {
            const cardText = card.innerText?.trim() || '';
            if (cardText.includes('Enviada em') && cardText.length > 30 && cardText.length < 2000) {
              messages.push({
                text: cardText,
                html: card.innerHTML?.substring(0, 3000),
              });
              break;
            }
            card = card.parentElement;
          }
        }
      }
      
      // Dedup: pode ter achado o mesmo card em diferentes níveis
      const unique = [];
      const seen = new Set();
      for (const m of messages) {
        // Usa os primeiros 100 chars como chave
        const key = m.text.substring(0, 100);
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(m);
        }
      }
      
      // ─── Fallback: se não achou cards, pega o texto bruto do painel inteiro ───
      if (unique.length === 0) {
        // Procura o painel pelo título "Mensagens"
        const allSpans = document.querySelectorAll('span, h1, h2, h3, h4, h5, div');
        for (const sp of allSpans) {
          if (sp.innerText?.trim() === 'Mensagens' && sp.children.length === 0) {
            // Achou o título! Sobe até o container overlay
            let container = sp.parentElement;
            for (let i = 0; i < 6 && container; i++) {
              const style = window.getComputedStyle(container);
              // Overlay geralmente é position:fixed ou position:absolute
              if (style.position === 'fixed' || style.position === 'absolute' || container.classList.toString().includes('sidebar') || container.classList.toString().includes('dialog')) {
                const fullText = container.innerText?.trim() || '';
                if (fullText.length > 50) {
                  // Tenta separar mensagens pelo padrão "Mensagem do"
                  const parts = fullText.split(/(?=Mensagem do )/);
                  for (const part of parts) {
                    const trimmed = part.trim();
                    if (trimmed.startsWith('Mensagem do') && trimmed.length > 30) {
                      unique.push({ text: trimmed, html: '' });
                    }
                  }
                  // Se split não funcionou, pega blob completo
                  if (unique.length === 0) {
                    unique.push({ text: fullText.substring(0, 5000), html: container.innerHTML?.substring(0, 5000) });
                  }
                }
                break;
              }
              container = container.parentElement;
            }
            break;
          }
        }
      }
      
      return unique;
    });
  }

  // Detecta se o painel de mensagens está aberto no DOM (Ação humana)
  async function isChatPanelOpen(pg) {
    return await pg.evaluate(() => {
      const sidebar = document.querySelector('.p-sidebar, .p-dialog');
      if (sidebar && sidebar.textContent.includes('Mensagens')) return true;
      const msgs = document.querySelectorAll('[class*="mensagem"], [class*="message"], [class*="chat"]');
      if (msgs.length > 0) return true;
      return false;
    });
  }

  // Polling periódico: apenas observa o DOM! Não clica em nada automatizado.
  let chatDetected = false;
  const intervalId = setInterval(async () => {
    try {
      if (page.isClosed()) { clearInterval(intervalId); return; }
      
      const panelOpen = await isChatPanelOpen(page);
      
      if (panelOpen && !chatDetected) {
        chatDetected = true;
        console.log(`  ✅ [${proc.processNumber}/${proc.processYear}] Painel de mensagens DETECTADO! Assumindo captura...`);
        
        // DIAGNÓSTICO: Dump do conteúdo visível no painel
        const diagDump = await page.evaluate(() => {
          // Tenta achar qualquer container com "Mensagens" no texto
          const allElements = document.querySelectorAll('*');
          let panelEl = null;
          for (const el of allElements) {
            // Procura elemento que tenha "Mensagens" como texto direto (não herdado)
            const ownText = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
            if (ownText === 'Mensagens' || el.textContent?.trim().startsWith('Mensagens')) {
              // Sobe até achar o container pai
              panelEl = el.parentElement || el;
              break;
            }
          }
          
          if (!panelEl) {
            // Fallback: procura pelo título h2/h3 ou por classe
            const sidebar = document.querySelector('.p-sidebar, .p-dialog, [class*="sidebar"], [class*="offcanvas"], [class*="drawer"]');
            panelEl = sidebar;
          }
          
          if (!panelEl) return { found: false, bodySnippet: document.body.innerText?.substring(0, 2000) };
          
          return {
            found: true,
            tagName: panelEl.tagName,
            className: panelEl.className,
            textContent: panelEl.textContent?.substring(0, 2000),
            childCount: panelEl.children.length,
            childTags: Array.from(panelEl.children).map(c => `${c.tagName}.${c.className?.substring(0,30)}`).join(' | '),
          };
        });
        
        console.log(`  🔍 DIAGNÓSTICO DO PAINEL:`);
        console.log(`     Encontrado: ${diagDump.found}`);
        if (diagDump.found) {
          console.log(`     Tag: ${diagDump.tagName}, Class: ${diagDump.className?.substring(0, 80)}`);
          console.log(`     Filhos (${diagDump.childCount}): ${diagDump.childTags?.substring(0, 200)}`);
          console.log(`     Texto (primeiros 500 chars): ${diagDump.textContent?.substring(0, 500)}`);
        } else {
          console.log(`     Body snippet: ${diagDump.bodySnippet?.substring(0, 500)}`);
        }
      }
      if (!panelOpen && chatDetected) {
        chatDetected = false;
        console.log(`  ⚠️ [${proc.processNumber}/${proc.processYear}] Painel fechou. Aguardando reabertura humana...`);
      }
      
      // Captura do DOM se painel estiver aberto
      if (panelOpen) {
        const domMsgs = await captureMessagesFromDOM(page).catch(() => []);
        console.log(`  📊 [${proc.processNumber}/${proc.processYear}] captureMessagesFromDOM retornou ${domMsgs.length} items brutos.`);
        
        // Log de cada item bruto para diagnóstico
        domMsgs.forEach((m, idx) => {
          console.log(`     [${idx}] Tamanho: ${m.text?.length || 0} chars | Começa: "${m.text?.substring(0, 80)}..."`);
        });

        // Filtra mensagens que são puramente boilerplate
        const validMsgs = domMsgs.filter(m => {
          const txt = m.text?.trim() || '';
          if (txt === 'Mensagens') return false;
          if (txt.length < 30) return false;
          return true;
        });

        console.log(`  ✅ [${proc.processNumber}/${proc.processYear}] Após filtro: ${validMsgs.length} mensagens válidas.`);

        if (validMsgs.length > 0) {
          let newInserted = 0;
          for (const msg of validMsgs) {
            try {
              const hash = Buffer.from(msg.text.substring(0, 200)).toString('base64');
              const msgId = `dom-${proc.id}-${hash}`;
              const info = db.prepare(`INSERT OR IGNORE INTO messages (id, processId, data, status) VALUES (?, ?, ?, 'pending')`)
                .run(msgId, proc.id, JSON.stringify({
                  source: 'dom',
                  text: msg.text,
                  capturedAt: new Date().toISOString(),
                }));
              if (info.changes > 0) {
                newInserted++;
                console.log(`     💾 Nova msg salva: "${msg.text.substring(0, 60)}..."`);
              }
            } catch (err) {
              console.log(`     ❌ Erro ao salvar: ${err.message?.substring(0, 80)}`);
            }
          }
          if (newInserted > 0) {
            console.log(`  🎉 [${proc.processNumber}/${proc.processYear}] ${newInserted} NOVAS mensagens salvas no banco!`);
          } else {
            console.log(`  ℹ️  [${proc.processNumber}/${proc.processYear}] ${validMsgs.length} mensagens já existiam no banco (duplicadas).`);
          }
        }
      }
    } catch (err) {
      console.log(`  ❌ Erro no polling: ${err.message?.substring(0, 120)}`);
    }
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
