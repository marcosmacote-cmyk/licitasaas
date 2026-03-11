/**
 * DIAGNÓSTICO — Descobre qual API o ComprasNet usa para mensagens de chat
 * 
 * Uso: node diagnose.js
 * 
 * Este script:
 * 1. Abre o browser com o perfil persistente (já logado)
 * 2. Navega para a página de acompanhamento de um processo real
 * 3. Intercepta TODAS as chamadas de rede
 * 4. Mostra as URLs, headers e respostas
 */

const { chromium } = require('playwright');
const path = require('path');

const COMPRA_ID = '7000705900012026'; // Pregão 90001/2026 - TRE/CE
const userDataDir = path.join(__dirname, '.chromium-profile');

(async () => {
  console.log('🔍 DIAGNÓSTICO DE REDE — ComprasNet Chat');
  console.log('=========================================');
  console.log(`Processo: compraId ${COMPRA_ID}`);
  console.log('');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    bypassCSP: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] || await context.newPage();

  // Intercepta TODAS as requisições de rede
  const apiCalls = [];

  page.on('response', async (response) => {
    const url = response.url();
    const status = response.status();
    
    // Filtra apenas APIs relevantes (ignora imagens, CSS, JS estáticos)
    if (
      url.includes('comprasnet') && 
      !url.includes('.js') && 
      !url.includes('.css') && 
      !url.includes('.png') && 
      !url.includes('.ico') && 
      !url.includes('.woff') &&
      !url.includes('.svg') &&
      !url.includes('gtm') &&
      !url.includes('google')
    ) {
      const entry = { url: url.substring(0, 200), status };
      
      // Tenta ler o body de APIs JSON
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('json')) {
          const body = await response.json().catch(() => null);
          if (body) {
            entry.bodyPreview = JSON.stringify(body).substring(0, 300);
            entry.isArray = Array.isArray(body);
            entry.length = Array.isArray(body) ? body.length : undefined;
          }
        }
      } catch(e) {}
      
      apiCalls.push(entry);
      
      // Destaca chamadas que parecem ser de mensagens/chat
      const isChat = url.includes('mensagem') || url.includes('chat') || url.includes('message');
      const prefix = isChat ? '🟢' : '⚪';
      console.log(`${prefix} [${status}] ${url.substring(0, 150)}`);
      if (entry.bodyPreview) {
        console.log(`   📦 Body: ${entry.bodyPreview.substring(0, 200)}`);
      }
    }
  });

  // Navega para a página do processo
  const processUrl = `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/private/fornecedor/compras/acompanhamento-compra/${COMPRA_ID}`;
  console.log(`\n📍 Navegando para: ${processUrl}\n`);

  try {
    await page.goto(processUrl, { waitUntil: 'networkidle', timeout: 30000 });
  } catch(e) {
    console.log('⚠️ Timeout de navegação (normal para SPA):', e.message.substring(0, 100));
  }

  // Espera um pouco para capturar chamadas lazy
  console.log('\n⏳ Aguardando 5s para chamadas lazy...\n');
  await page.waitForTimeout(5000);

  // Tenta clicar na aba "Mensagem" se existir
  console.log('🖱️ Tentando clicar na aba "Mensagem"...');
  try {
    await page.click('text=Mensagem', { timeout: 5000 });
    console.log('✅ Clicou em "Mensagem"!');
    await page.waitForTimeout(5000);
  } catch(e) {
    console.log('❌ Não encontrou aba "Mensagem":', e.message.substring(0, 100));
  }

  // Tenta outros seletores possíveis
  try {
    await page.click('text=Mensagens', { timeout: 3000 });
    console.log('✅ Clicou em "Mensagens"!');
    await page.waitForTimeout(5000);
  } catch(e) {}

  // Resumo
  console.log('\n=========================================');
  console.log('📊 RESUMO DAS CHAMADAS DE API:');
  console.log('=========================================');
  
  const chatCalls = apiCalls.filter(c => 
    c.url.includes('mensagem') || c.url.includes('chat') || c.url.includes('message')
  );
  
  if (chatCalls.length > 0) {
    console.log(`\n🟢 ${chatCalls.length} chamada(s) de CHAT/MENSAGEM encontradas:`);
    chatCalls.forEach(c => {
      console.log(`  URL: ${c.url}`);
      console.log(`  Status: ${c.status}`);
      if (c.bodyPreview) console.log(`  Body: ${c.bodyPreview}`);
      console.log('');
    });
  } else {
    console.log('\n❌ Nenhuma chamada de chat/mensagem detectada!');
    console.log('   Todas as chamadas capturadas:');
    apiCalls.forEach(c => {
      console.log(`  [${c.status}] ${c.url}`);
    });
  }

  // Mostra o URL atual
  console.log(`\n📍 URL atual do navegador: ${page.url()}`);
  
  // Captura screenshot
  await page.screenshot({ path: path.join(__dirname, 'diagnose-screenshot.png') });
  console.log('📸 Screenshot salvo: diagnose-screenshot.png');
  
  console.log('\n⏳ Navegador ficará aberto por 30s para inspeção manual...');
  console.log('   (Você pode abrir DevTools → Network para ver mais detalhes)');
  await page.waitForTimeout(30000);

  await context.close();
  console.log('\n✅ Diagnóstico concluído.');
})();
