import fetch from 'node-fetch';
import AdmZip from 'adm-zip';

async function testUrl(url: string, label: string) {
  console.log(`\nTesting: ${label} -> ${url}`);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) {
      console.log(`Failed to fetch: HTTP ${res.status}`);
      return;
    }
    const contentType = res.headers.get('content-type') || '';
    const contentDisposition = res.headers.get('content-disposition') || '';
    console.log(`Content-Type: ${contentType}`);
    console.log(`Content-Disposition: ${contentDisposition}`);
    
    const buffer = Buffer.from(await res.arrayBuffer());
    console.log(`File Size: ${buffer.length} bytes`);
    
    if (buffer.length > 4 && buffer.toString('utf8', 0, 4).startsWith('PK\x03\x04')) {
      console.log("Detected ZIP file signature!");
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();
      console.log(`ZIP contains ${entries.length} entries:`);
      for (const entry of entries) {
        console.log(`  - ${entry.entryName} (IsDir: ${entry.isDirectory}, Size: ${entry.header.size} bytes)`);
      }
    } else {
      console.log("Not a ZIP file. Starts with:", buffer.toString('utf8', 0, 40));
    }
  } catch (e: any) {
    console.error(`Error testing ${label}:`, e.message);
  }
}

async function main() {
  // We'll test the Janeiro 2026 link first (which also failed parsing)
  // Let's get the links for 2026 first using Puppeteer in a quick discovery
  let ppt: any;
  try { ppt = require('puppeteer-core'); } catch {
    try { ppt = require('puppeteer'); } catch { throw new Error('Puppeteer not available'); }
  }
  
  console.log("Discovering 2026 URLs...");
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await ppt.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.goto('https://www.caern.com.br/servicos/tabela-de-precos/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  
  // Select 2026
  await page.evaluate(() => {
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === '2026') {
          sel.selectedIndex = i;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
    }
  });
  await new Promise(r => setTimeout(r, 2000));
  
  const links2026 = await page.evaluate(() => {
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
  
  await browser.close();
  
  console.log(`Found ${links2026.length} links for 2026:`);
  for (const l of links2026) {
    await testUrl(l.url, l.title);
  }
}

main().catch(console.error);
