import puppeteer from 'puppeteer-core';

const CAERN_URL = 'https://www.caern.com.br/servicos/tabela-de-precos/';

async function main() {
  console.log("Launching Puppeteer to inspect CAERN links...");
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.goto(CAERN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  
  // Discover available years in the dropdown
  const availableYears = await page.evaluate(() => {
    const select = document.querySelector('select');
    if (!select) return [];
    return Array.from(select.options)
      .map(o => o.value || o.text.trim())
      .filter(v => /^\d{4}$/.test(v));
  });
  console.log(`Available years in dropdown: ${availableYears.join(', ')}`);
  
  // We want to query years from 2023 to 2026 (or whatever is available within the last 36 months)
  const targetYears = availableYears.filter(y => parseInt(y) >= 2023);
  
  for (const year of targetYears) {
    console.log(`\n--- Selecting Year: ${year} ---`);
    await page.evaluate((y: string) => {
      const select = document.querySelector('select');
      if (select) {
        for (let i = 0; i < select.options.length; i++) {
          if (select.options[i].value === y || select.options[i].text.trim() === y) {
            select.selectedIndex = i;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }
        }
      }
    }, year);
    await new Promise(r => setTimeout(r, 2500));
    
    // Get all accordion/section headers to see sub-periods (months)
    const sectionHeaders = await page.evaluate(() => {
      const headers = document.querySelectorAll('.accordion-header, .card-header, h3, h4, h5, [class*="header"], [class*="title"]');
      return Array.from(headers)
        .map(h => h.textContent?.trim() || '')
        .filter(t => t.includes('Tabela de Preços') || t.includes('Preços'));
    });
    console.log(`Section headers found:`, sectionHeaders);
    
    const links = await page.evaluate(() => {
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
    });
    
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
