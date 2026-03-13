const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  // Captura TODAS as chamadas de API
  const apiCalls = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('comprasnet-fase-externa') || url.includes('comprasnet-mensagem')) {
      let body = '';
      try { body = (await resp.text()).substring(0, 300); } catch {}
      apiCalls.push({ url: url.substring(0, 200), status: resp.status(), body });
    }
  });

  // Navega para a pesquisa
  console.log('1. Navegando para pesquisa...');
  await page.goto('https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(8000);

  // Preenche o campo de UASG
  console.log('2. Preenchendo UASG...');
  const uasgField = page.locator('#unidadeCompradora');
  await uasgField.click();
  await uasgField.fill('981547');
  await page.waitForTimeout(2000);

  // Preenche o campo do número do processo (segundo input text)
  console.log('3. Preenchendo número do processo...');
  const numField = page.locator('input[placeholder="Ex: 102021"]');
  await numField.click();
  await numField.fill('90003');
  await page.waitForTimeout(1000);

  // Clica em Pesquisar
  console.log('4. Clicando Pesquisar...');
  const searchBtn = page.locator('button:has-text("Pesquisar")');
  await searchBtn.click();
  await page.waitForTimeout(10000);

  // Diagnóstico após pesquisa
  console.log('\n=== APÓS PESQUISA ===');
  console.log('URL:', page.url());
  
  const results = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    
    // Busca links de resultado
    const links = [];
    document.querySelectorAll('a').forEach((a, i) => {
      const href = a.href || '';
      const t = a.textContent?.trim()?.substring(0, 80);
      if (t && t.length > 3 && i < 30) {
        links.push({ text: t, href: href.substring(0, 120) });
      }
    });

    // Busca cards de resultado
    const cards = [];
    document.querySelectorAll('.card, .p-card, [class*="resultado"], [class*="compra-item"], [class*="list-item"]').forEach((el, i) => {
      if (i < 5) cards.push({ class: el.className?.substring(0, 60), text: el.textContent?.trim()?.substring(0, 200) });
    });

    return { 
      bodyPreview: text.substring(0, 800), 
      links, 
      cards,
      numButtons: document.querySelectorAll('button').length
    };
  });

  console.log('\nBody:', results.bodyPreview?.substring(0, 500));
  console.log('\nLinks:');
  results.links.forEach(l => console.log(`  "${l.text}" → ${l.href}`));
  console.log('\nCards:', results.cards);

  console.log('\n\n=== API CALLS CAPTURED ===');
  apiCalls.forEach(c => {
    console.log(`\n${c.status} ${c.url}`);
    if (c.body && c.body.length > 5) console.log(`   Body: ${c.body.substring(0, 200)}`);
  });

  await browser.close();
})();
