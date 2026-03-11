const { chromium } = require('playwright');

const COMPRASNET = 'https://cnetmobile.estaleiro.serpro.gov.br';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  await page.goto(`${COMPRASNET}/comprasnet-web/public/compras`, { waitUntil: 'load' });
  await page.waitForTimeout(5000);

  const allInputs = page.locator('input[type="text"], input:not([type])');
  const count = await allInputs.count();
  await allInputs.nth(count - 2).fill('981547');
  await allInputs.nth(count - 1).fill('900032026');
  await page.click('button:has-text("Pesquisar")');
  await page.waitForTimeout(5000);

  // Dump all elements in the results area
  const dump = await page.evaluate(() => {
    const results = [];
    // Look for clickable elements with process text
    const allElements = document.querySelectorAll('a, [href], [routerlink], [ng-click], [click], .card, .compra, [class*="compra"], [class*="card"], .resultado');
    allElements.forEach((el, i) => {
      results.push({
        i,
        tag: el.tagName,
        text: el.innerText?.trim().substring(0, 100),
        class: el.className?.substring(0, 80),
        href: el.getAttribute('href'),
        routerLink: el.getAttribute('routerlink'),
        role: el.getAttribute('role'),
        outerHTML: el.outerHTML?.substring(0, 200),
      });
    });
    return results;
  });

  console.log('=== ELEMENTOS CLICÁVEIS NOS RESULTADOS ===');
  dump.forEach(d => {
    if (d.text && d.text.length > 5) {
      console.log(`[${d.i}] <${d.tag}> text="${d.text.substring(0, 80)}" class="${d.class}"`);
      console.log(`   href="${d.href}" routerLink="${d.routerLink}"`);
      console.log(`   HTML: ${d.outerHTML?.substring(0, 160)}`);
      console.log('');
    }
  });

  // Also check specifically for the first card's clickable element
  const cardHTML = await page.evaluate(() => {
    const card = document.querySelector('app-card-compra');
    if (!card) return 'NO app-card-compra FOUND';
    return card.outerHTML.substring(0, 1000);
  });
  console.log('=== PRIMEIRO CARD HTML ===');
  console.log(cardHTML);

  await browser.close();
})();
