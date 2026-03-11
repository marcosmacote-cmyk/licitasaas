const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navegando public');
  await page.goto('https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras', { waitUntil: 'load' });
  await page.waitForTimeout(5000);

  // Take screenshot of the form
  await page.screenshot({ path: path.join(__dirname, 'step1-form.png') });
  
  try {
     const frame = page; 
     await frame.fill('input[formcontrolname="uasg"]', '70007');
     await frame.fill('input[formcontrolname="numero"]', '90001');
     await frame.fill('input[formcontrolname="ano"]', '2026');
     await frame.screenshot({ path: path.join(__dirname, 'step2-filled.png') });
     
     // Press Enter
     await frame.press('input[formcontrolname="ano"]', 'Enter');
     console.log('Esperando resultados...');
     await page.waitForTimeout(5000);
     await page.screenshot({ path: path.join(__dirname, 'step3-results.png') });
     
     // Look for links to click
     await page.click('app-card-compra');
     console.log('Clicou no card!');
     await page.waitForTimeout(5000);
     
     console.log('FINAL URL:', page.url());
     await page.screenshot({ path: path.join(__dirname, 'step4-process.png') });
     
     // Clicar em Mensagens
     await page.click('text=Mensag');
     await page.waitForTimeout(5000);
     await page.screenshot({ path: path.join(__dirname, 'step5-chat.png') });
     
  } catch(e) { console.log('Erro de ui', e.message); }

  await browser.close();
})();
