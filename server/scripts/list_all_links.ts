import { syncCaern } from '../services/engineering/caernCrawler';

async function main() {
  console.log("Listing all CAERN links discovered by crawler...");
  // Replicate the discover links method or just print what we get.
  // We can write the discover links code here to run it without the actual sync.
  let ppt: any;
  try { ppt = require('puppeteer-core'); } catch {
    try { ppt = require('puppeteer'); } catch { throw new Error('Puppeteer not available'); }
  }

  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await ppt.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  for (const year of [2026, 2025, 2024]) {
    console.log(`\n--- Year ${year} ---`);
    await page.goto('https://www.caern.com.br/servicos/tabela-de-precos/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

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
    await new Promise(r => setTimeout(r, 2000));

    const links = await page.evaluate(() => {
      const results: { url: string; title: string }[] = [];
      const anchors = document.querySelectorAll('a[href*="api.mziq.com"], a[href*=".pdf"]');
      for (const a of anchors) {
        const href = (a as HTMLAnchorElement).href;
        const title = (a as HTMLElement).innerText?.trim() || a.textContent?.trim() || '';
        if (href && title && !href.includes('Política')) {
          results.push({ url: href, title });
        }
      }
      return results;
    });

    console.log(`Found ${links.length} links:`);
    links.forEach((l, idx) => {
      console.log(`  ${idx}: "${l.title}" -> ${l.url}`);
    });
  }

  await browser.close();
}

main().catch(console.error);
