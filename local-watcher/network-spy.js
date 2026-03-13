#!/usr/bin/env node
/**
 * ══════════════════════════════════════════════════════════════════
 *  SPRINT 1 — Network Spy: Engenharia Reversa do Canal de Mensagens
 * ══════════════════════════════════════════════════════════════════
 * 
 *  Este script NÃO clica em nada. Ele apenas:
 *  1. Abre o Chrome real
 *  2. Navega até o processo
 *  3. Intercepta TODAS as requisições de rede
 *  4. Aguarda o usuário clicar manualmente em 🔄 e ✉️
 *  5. Registra tudo: URL, método, headers, cookies, payload, response
 * 
 *  Uso: node network-spy.js
 * ══════════════════════════════════════════════════════════════════
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ── Configuração ──
const SEARCH_URL = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras';

const LOG_FILE = path.join(__dirname, 'network-spy-log.json');

// Armazena todas as requisições capturadas
const capturedRequests = [];
let requestCounter = 0;

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  🔍 Network Spy — Engenharia Reversa ComprasNet  ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  // Lança Chrome real
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });

  const page = await context.newPage();

  // ══════════════════════════════════════════════════════
  // INTERCEPTOR MASTER: captura TUDO que passa pela rede
  // ══════════════════════════════════════════════════════

  // 1. CDP Session para capturar WebSocket frames
  const cdpSession = await context.newCDPSession(page);
  await cdpSession.send('Network.enable');

  // Captura WebSocket criado
  cdpSession.on('Network.webSocketCreated', (params) => {
    const entry = {
      seq: ++requestCounter,
      timestamp: new Date().toISOString(),
      type: 'WEBSOCKET_CREATED',
      url: params.url,
      requestId: params.requestId,
    };
    capturedRequests.push(entry);
    console.log(`  🔌 [${entry.seq}] WebSocket CRIADO: ${params.url}`);
  });

  // Captura frames WebSocket recebidos
  cdpSession.on('Network.webSocketFrameReceived', (params) => {
    const payload = params.response?.payloadData?.substring(0, 500) || '';
    const entry = {
      seq: ++requestCounter,
      timestamp: new Date().toISOString(),
      type: 'WEBSOCKET_FRAME',
      requestId: params.requestId,
      payloadPreview: payload,
    };
    capturedRequests.push(entry);
    if (payload.length > 0) {
      console.log(`  📨 [${entry.seq}] WS Frame: ${payload.substring(0, 120)}...`);
    }
  });

  // Captura EventSource (SSE)
  cdpSession.on('Network.eventSourceMessageReceived', (params) => {
    const entry = {
      seq: ++requestCounter,
      timestamp: new Date().toISOString(),
      type: 'SSE_MESSAGE',
      requestId: params.requestId,
      eventName: params.eventName,
      data: params.data?.substring(0, 500),
    };
    capturedRequests.push(entry);
    console.log(`  📡 [${entry.seq}] SSE: ${params.eventName} → ${params.data?.substring(0, 120)}`);
  });

  // 2. Playwright route: intercepta Fetch/XHR
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();
    const resourceType = request.resourceType();

    // Ignora assets estáticos (imagens, fontes, CSS, JS bundles)
    const skipTypes = ['image', 'font', 'stylesheet', 'media'];
    const skipExtensions = ['.png', '.jpg', '.gif', '.svg', '.woff', '.ttf', '.css', '.ico'];
    const isStaticAsset = skipTypes.includes(resourceType) || skipExtensions.some(ext => url.includes(ext));

    if (isStaticAsset) {
      await route.continue();
      return;
    }

    // Captura detalhes da requisição
    const headers = request.headers();
    const postData = request.postData() || null;

    const entry = {
      seq: ++requestCounter,
      timestamp: new Date().toISOString(),
      type: 'HTTP',
      method,
      url,
      resourceType,
      requestHeaders: {},
      requestBody: postData,
      responseStatus: null,
      responseHeaders: {},
      responseBody: null,
    };

    // Salva headers relevantes (não todos para não poluir)
    const interestingHeaders = ['authorization', 'cookie', 'x-csrf-token', 'x-xsrf-token', 'content-type', 'accept', 'recaptcha', 'x-recaptcha', 'g-recaptcha-response'];
    for (const h of interestingHeaders) {
      if (headers[h]) entry.requestHeaders[h] = headers[h];
    }

    // Continua a requisição e captura a resposta
    try {
      const response = await route.fetch();
      entry.responseStatus = response.status();
      
      // Headers da resposta
      const respHeaders = response.headers();
      for (const key of Object.keys(respHeaders)) {
        if (key.toLowerCase().includes('token') || key.toLowerCase().includes('cookie') || key.toLowerCase().includes('captcha') || key.toLowerCase() === 'content-type') {
          entry.responseHeaders[key] = respHeaders[key];
        }
      }

      // Tenta capturar o body da resposta (apenas JSON/text)
      const contentType = respHeaders['content-type'] || '';
      if (contentType.includes('json') || contentType.includes('text')) {
        try {
          const bodyBuffer = await response.body();
          const bodyText = bodyBuffer.toString('utf-8').substring(0, 5000);
          entry.responseBody = bodyText;
        } catch { /* body não acessível */ }
      }

      capturedRequests.push(entry);

      // Log formatado no console
      const emoji = entry.responseStatus >= 200 && entry.responseStatus < 300 ? '✅' : '⚠️';
      const shortUrl = url.replace('https://cnetmobile.estaleiro.serpro.gov.br', '');
      
      // Destaca requisições que parecem ser do chat/mensagens
      const isChatRelated = url.toLowerCase().includes('mensag') || 
                            url.toLowerCase().includes('message') || 
                            url.toLowerCase().includes('chat') || 
                            url.toLowerCase().includes('captcha') ||
                            url.toLowerCase().includes('recaptcha') ||
                            (postData && postData.toLowerCase().includes('mensag'));

      if (isChatRelated) {
        console.log(`  🎯🎯🎯 [${entry.seq}] ${emoji} ${method} ${entry.responseStatus} ${shortUrl}`);
        if (postData) console.log(`     📤 Body: ${postData.substring(0, 200)}`);
        if (entry.responseBody) console.log(`     📥 Response: ${entry.responseBody.substring(0, 300)}`);
        if (Object.keys(entry.requestHeaders).length > 0) console.log(`     🔑 Headers: ${JSON.stringify(entry.requestHeaders).substring(0, 200)}`);
      } else if (resourceType === 'fetch' || resourceType === 'xhr' || method !== 'GET') {
        console.log(`  📡 [${entry.seq}] ${emoji} ${method} ${entry.responseStatus} ${shortUrl.substring(0, 100)}`);
        if (postData) console.log(`     📤 Body: ${postData.substring(0, 150)}`);
      }

      // Fulfills com a resposta original
      await route.fulfill({ response });

    } catch (err) {
      // Se o fetch falhar, deixa a requisição continuar normalmente
      entry.responseStatus = 'FETCH_ERROR';
      entry.responseBody = err.message;
      capturedRequests.push(entry);
      await route.continue();
    }
  });

  // ══════════════════════════════════════════════════════
  // NAVEGA até o processo
  // ══════════════════════════════════════════════════════

  console.log(`\n🌐 Navegando para página de pesquisa do ComprasNet...\n`);
  await page.goto(SEARCH_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await page.waitForTimeout(5000);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  👤 AÇÃO MANUAL NECESSÁRIA:                                  ║');
  console.log('║                                                              ║');
  console.log('║  1. Pesquise o processo (UASG, número, etc.)                 ║');
  console.log('║  2. Clique no resultado para abrir a página do processo      ║');
  console.log('║  3. Clique no ícone de ✉️  Mensagens                         ║');
  console.log('║  4. Navegue pelas páginas do chat (1, 2, 3...)               ║');
  console.log('║  5. Feche e reabra o painel                                  ║');
  console.log('║                                                              ║');
  console.log('║  O spy está capturando TUDO que passa pela rede.             ║');
  console.log('║  Quando terminar, pressione Ctrl+C para salvar o log.        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('📊 Requisições capturadas em tempo real:\n');

  // ══════════════════════════════════════════════════════
  // SALVA o log ao encerrar
  // ══════════════════════════════════════════════════════

  const saveAndExit = async () => {
    console.log('\n\n📝 Salvando log completo...');
    
    // Salva JSON completo
    fs.writeFileSync(LOG_FILE, JSON.stringify(capturedRequests, null, 2));
    console.log(`✅ Log salvo em: ${LOG_FILE}`);
    console.log(`📊 Total de requisições capturadas: ${capturedRequests.length}`);

    // Resumo
    const httpReqs = capturedRequests.filter(r => r.type === 'HTTP');
    const wsReqs = capturedRequests.filter(r => r.type === 'WEBSOCKET_CREATED' || r.type === 'WEBSOCKET_FRAME');
    const sseReqs = capturedRequests.filter(r => r.type === 'SSE_MESSAGE');
    const chatReqs = capturedRequests.filter(r => {
      const url = (r.url || '').toLowerCase();
      return url.includes('mensag') || url.includes('message') || url.includes('chat');
    });
    const captchaReqs = capturedRequests.filter(r => {
      const url = (r.url || '').toLowerCase();
      return url.includes('captcha') || url.includes('recaptcha');
    });

    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║          📊 RESUMO FINAL             ║');
    console.log('╠══════════════════════════════════════╣');
    console.log(`║  HTTP Requests:     ${String(httpReqs.length).padStart(4)}            ║`);
    console.log(`║  WebSocket:         ${String(wsReqs.length).padStart(4)}            ║`);
    console.log(`║  SSE:               ${String(sseReqs.length).padStart(4)}            ║`);
    console.log(`║  Chat-related:      ${String(chatReqs.length).padStart(4)}            ║`);
    console.log(`║  Captcha-related:   ${String(captchaReqs.length).padStart(4)}            ║`);
    console.log('╚══════════════════════════════════════╝');

    if (chatReqs.length > 0) {
      console.log('\n🎯 REQUISIÇÕES RELACIONADAS AO CHAT:');
      chatReqs.forEach(r => {
        console.log(`  ${r.method || r.type} ${r.responseStatus || ''} ${r.url}`);
        if (r.requestBody) console.log(`    📤 ${r.requestBody.substring(0, 200)}`);
        if (r.responseBody) console.log(`    📥 ${r.responseBody.substring(0, 300)}`);
      });
    }

    if (captchaReqs.length > 0) {
      console.log('\n🛡️ REQUISIÇÕES DO CAPTCHA:');
      captchaReqs.forEach(r => {
        console.log(`  ${r.method || r.type} ${r.responseStatus || ''} ${r.url?.substring(0, 120)}`);
      });
    }

    await browser.close();
    process.exit(0);
  };

  process.on('SIGINT', saveAndExit);

  // Mantém o script rodando
  await new Promise(() => {});
}

main().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
