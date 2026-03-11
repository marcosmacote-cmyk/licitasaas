const { chromium } = require('playwright');
const path = require('path');

const COMPRA_ID = '07000705900012026'; // Pregão 90001/2026 - TRE/CE

(async () => {
  console.log('🔍 DIAGNÓSTICO DE REDE — Modo Público');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('chat') || url.includes('mensagem')) {
      console.log(`[${response.status()}] ${url.substring(0, 100)}`);
    }
  });

  const url = `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=${COMPRA_ID}`;
  console.log(`📍 Navegando para: ${url}`);
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch(e) {
    console.log('⚠️ Timeout no goto', e.message);
  }
  
  console.log('⏳ Waiting 5s...');
  await page.waitForTimeout(5000);

  console.log('📸 Tirando print inicial');
  await page.screenshot({ path: path.join(__dirname, 'diagnose-public-1.png') });

  console.log('🖱️ Tirando tentando clicar na aba "Mensagem"');
  try {
    await page.click('text=Mensagem', { timeout: 5000 });
    console.log('✅ Clicou em Mensagem!');
    await page.waitForTimeout(5000);
  } catch(e) {
    console.log('❌ Falha ao clicar:', e.message.substring(0, 100));
  }

  // Tenta outro seletor se falhou
  try {
    const abas = await page.$$('text=Mensagens');
    if (abas.length > 0) {
       await abas[0].click();
       console.log('✅ Clicou em Mensagens!');
       await page.waitForTimeout(5000);
    }
  } catch(e) {}

  console.log('📸 Tirando print final');
  await page.screenshot({ path: path.join(__dirname, 'diagnose-public-2.png') });

  await browser.close();
  console.log('✅ Diagnóstico concluído.');
})();
