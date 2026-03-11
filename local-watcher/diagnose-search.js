const { chromium } = require('playwright');
const path = require('path');

(async () => {
  console.log('🔍 TESTE: 16 digitos vs 17 digitos na página publica');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Testando 16 dígitos (s/ padding): 7000705900012026');
  await page.goto('https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=7000705900012026', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(__dirname, 'test-pub-16.png') });

  console.log('Testando 17 dígitos (c/ padding): 07000705900012026');
  await page.goto('https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=07000705900012026', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(__dirname, 'test-pub-17.png') });

  // Testando com PNCP id-like
  // wait, the PNCP ID for this is maybe just something else.
  // We can search the public page and click the process.

  await page.goto('https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  
  try {
     // Preencher form de pesquisa
     await page.fill('input[formcontrolname="uasg"]', '70007');
     await page.fill('input[formcontrolname="numero"]', '90001');
     await page.fill('input[formcontrolname="ano"]', '2026');
     await page.click('button:has-text("Pesquisar")');
     await page.waitForTimeout(5000);
     await page.screenshot({ path: path.join(__dirname, 'test-pub-search.png') });
     
     // Clicar no primeiro card de compras
     await page.click('app-card-compra');
     await page.waitForTimeout(5000);
     
     const finalUrl = page.url();
     console.log('✅ URL final real =', finalUrl);
     await page.screenshot({ path: path.join(__dirname, 'test-pub-found.png') });
  } catch(e) { console.log('Erro na busca livre', e.message); }

  await browser.close();
})();
