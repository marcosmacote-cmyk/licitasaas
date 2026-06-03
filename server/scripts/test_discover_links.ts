import { chromium } from 'playwright';

const CAERN_URL = 'https://www.caern.com.br/servicos/tabela-de-precos/';

async function main() {
  console.log("Launching playwright to inspect CAERN links...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto(CAERN_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  const years = [2026, 2025, 2024];
  
  for (const year of years) {
    console.log(`\n--- Selecting Year: ${year} ---`);
    await page.evaluate((y: number) => {
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value === String(y) || sel.options[i].text.trim() === String(y)) {
            sel.selectedIndex = i;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }
        }
      }
    }, year);
    await page.waitForTimeout(3000);
    
    const links = await page.evaluate((yr: number) => {
      const results: any[] = [];
      const anchors = document.querySelectorAll('a[href*="api.mziq.com"], a[href*=".pdf"]');
      for (const a of anchors) {
        const href = (a as HTMLAnchorElement).href;
        if (!href || href.includes('Política')) continue;
        
        const row = a.closest('tr, .row, div') || a.parentElement;
        const rowText = row?.textContent?.trim() || '';
        const title = (a as HTMLElement).innerText?.trim() || a.textContent?.trim() || '';
        
        const dateMatch = rowText.match(/(\d{2}\/\d{2}\/\d{4})/);
        const publishDate = dateMatch ? dateMatch[1] : '';
        
        let desc = title;
        if (!desc || desc.length < 3) {
          const parts = rowText.split(/\d{2}\/\d{2}\/\d{4}/);
          desc = parts.length > 1 ? parts[1].trim() : rowText;
        }
        results.push({ url: href, title: desc, publishDate });
      }
      return results;
    }, year);
    
    console.log(`Found ${links.length} links for year ${year}:`);
    for (const l of links) {
      console.log(`- Title: "${l.title}"`);
      console.log(`  URL:   "${l.url}"`);
      console.log(`  Date:  "${l.publishDate}"`);
    }
  }
  
  await browser.close();
}

main().catch(console.error);
