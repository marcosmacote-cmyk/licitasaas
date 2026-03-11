const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navegando public');
  await page.goto('https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras');
  
  // click "Em andamento" e "Finalizadas" - na verdade vamos dar uncheck nas checkboxes e preencher "Todas"
  await page.click('text="Todas as modalidades"');
  // just fill 
  // It has generic inputs for Uasg and Numero
  // from screenshot, it has labels "Unidade compradora" and "Número da compra"
  
  await page.fill('div:has-text("Unidade compradora") input, input[placeholder=""]', '70007'); 
  // Wait, let's use exact sibling
  await page.fill('app-pesquisa-compra input>>nth=0', '70007');
  await page.fill('app-pesquisa-compra input>>nth=1', '900012026');
  
  await page.click('button:has-text("Pesquisar")');
  await page.waitForTimeout(5000);
  
  await page.screenshot({ path: path.join(__dirname, 'step3-results.png') });
  
  try {
     const elements = await page.$$('app-card-compra');
     if (elements.length > 0) {
        console.log('Achou um card!');
        await elements[0].click();
        await page.waitForTimeout(5000);
        console.log('FINAL URL:', page.url());
     } else {
        console.log('Nenhum card encontrado');
     }
  } catch(e) {}
  
  await browser.close();
})();
