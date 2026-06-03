import { syncCaern } from '../services/engineering/caernCrawler';
import { prisma } from '../lib/prisma';
import fetch from 'node-fetch'; // or use global fetch
import fs from 'fs';
import path from 'path';

// We will replicate a small portion of Puppeteer discovery to get the direct URLs
// Or we can just print the discovered entries from caernCrawler if we make a script.
// Let's launch Puppeteer, get links, find 2025 ones, download PDF 2 and 3, and inspect the lines.

async function main() {
  console.log("Iniciando inspeção de PDFs da CAERN...");
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
  await page.goto('https://www.caern.com.br/servicos/tabela-de-precos/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Select 2025
  await page.evaluate(() => {
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === '2025') {
          sel.selectedIndex = i;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
    }
  });
  await new Promise(r => setTimeout(r, 3000));

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

  console.log(`Encontrados ${links.length} links para 2025:`);
  links.forEach((l, idx) => console.log(`${idx}: [${l.title}] -> ${l.url}`));

  // We want to download the 1st, 2nd, and 3rd PDFs (indexes 0, 1, 2 or similar)
  // Let's filter out irrelevant ones
  const targetLinks = links.filter(l => {
    const lower = l.title.toLowerCase();
    return !lower.includes('miv') && !lower.includes('política') && !lower.includes('encargo');
  });

  console.log(`\nLinks filtrados (${targetLinks.length}):`);
  targetLinks.forEach((l, idx) => console.log(`${idx}: [${l.title}] -> ${l.url}`));

  // Let's inspect target link index 1 and 2
  for (const idx of [0, 1, 2]) {
    if (!targetLinks[idx]) continue;
    const item = targetLinks[idx];
    console.log(`\n======================================================`);
    console.log(`INSPECIONANDO PDF ${idx}: ${item.title}`);
    console.log(`URL: ${item.url}`);

    const res = await fetch(item.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) {
      console.log(`Erro ao baixar: ${res.status}`);
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());

    // Extract text
    const mod = require('pdf-parse');
    let text = '';
    try {
      if (mod.PDFParse) {
        const parser = new mod.PDFParse(new Uint8Array(buffer));
        await parser.load();
        const r = await parser.getText();
        text = r.text || '';
      } else if (typeof mod === 'function') {
        const pdfData = await mod(buffer);
        text = pdfData.text || '';
      }
    } catch (e: any) {
      console.log(`Erro ao extrair com pdf-parse: ${e.message}`);
    }

    if (!text) {
      console.log("Não foi possível obter texto.");
      continue;
    }

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    console.log(`Total de linhas extraídas: ${lines.length}`);
    console.log(`Primeiras 40 linhas:`);
    lines.slice(0, 40).forEach((l, i) => console.log(`  ${i}: "${l}"`));

    // Let's find some codes like 92768, 92769, 92767
    const testCodes = ['92768', '92769', '92767', '5953'];
    for (const code of testCodes) {
      const lineIdx = lines.findIndex(l => l === code);
      if (lineIdx >= 0) {
        console.log(`\nLinhas ao redor do código ${code} (linha ${lineIdx}):`);
        const start = Math.max(0, lineIdx - 5);
        const end = Math.min(lines.length, lineIdx + 15);
        for (let i = start; i < end; i++) {
          console.log(`  ${i === lineIdx ? '->' : '  '} ${i}: "${lines[i]}"`);
        }
      }
    }
  }

  await browser.close();
}

main().catch(console.error);
