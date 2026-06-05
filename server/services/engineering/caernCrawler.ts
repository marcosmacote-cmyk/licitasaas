/**
 * CAERN Crawler — Tabela de Preços CAERN (Companhia de Águas e Esgotos do RN)
 * Portal: https://www.caern.com.br/servicos/tabela-de-precos/
 * Format: PDF via api.mziq.com (MZ File Manager)
 * 
 * Strategy: Puppeteer scrape of public page → extract download links → download PDFs
 * The page is JavaScript-rendered with year selector dropdown.
 * Each year may have multiple PDFs (Banco de Preços, Composições série 1000/2000, Encargos).
 * 
 * UF: RN (Rio Grande do Norte) — single state base
 * No authentication required — fully public
 */
import { prisma } from '../../lib/prisma';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';

const CAERN_URL = 'https://www.caern.com.br/servicos/tabela-de-precos/';
const MZ_BASE = 'https://api.mziq.com/mzfilemanager/v2/d/2a1a75a3-21f9-46ef-9aa4-487f2d2b709b/';

interface CaernPdfEntry {
  url: string;
  title: string;
  publishDate: string;
  year: number;
  period: string; // e.g. "Janeiro 2026", "Julho 2025"
}

interface SyncResult {
  success: boolean;
  message: string;
  databaseId?: string;
  itemCount?: number;
  compositionCount?: number;
}

function parseBrPrice(text: string): number {
  if (!text) return 0;
  const c = text.replace(/[^\d.,\-]/g, '');
  if (!c) return 0;
  if (c.includes(',') && (!c.includes('.') || c.lastIndexOf(',') > c.lastIndexOf('.')))
    return parseFloat(c.replace(/\./g, '').replace(',', '.')) || 0;
  return parseFloat(c.replace(/,/g, '')) || 0;
}

// ═══════════════════════════════════════════════════════════
// Launch Puppeteer
// ═══════════════════════════════════════════════════════════
async function launchBrowser(): Promise<any> {
  let ppt: any;
  try { ppt = require('puppeteer-core'); } catch {
    try { ppt = require('puppeteer'); } catch { throw new Error('Puppeteer not available'); }
  }
  for (const p of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    process.env.CHROME_PATH
  ].filter(Boolean)) {
    try {
      return await ppt.launch({ executablePath: p as string, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
    } catch { continue; }
  }
  throw new Error('No Chrome/Chromium found');
}

// ═══════════════════════════════════════════════════════════
// Scrape CAERN page to discover PDF links for all years
// ═══════════════════════════════════════════════════════════
async function discoverPdfLinks(years: number[]): Promise<CaernPdfEntry[]> {
  const allEntries: CaernPdfEntry[] = [];
  let browser: any;

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto(CAERN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    for (const year of years) {
      // Select year in dropdown
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
      await new Promise(r => setTimeout(r, 3000));

      // Extract links
      const links = await page.evaluate((yr: number) => {
        const results: { url: string; title: string; publishDate: string }[] = [];
        const anchors = document.querySelectorAll('a[href*="api.mziq.com"], a[href*=".pdf"]');
        for (const a of anchors) {
          const href = (a as HTMLAnchorElement).href;
          if (!href || href.includes('Política')) continue;

          // Get surrounding text — look at parent row for date and title
          const row = a.closest('tr, .row, div') || a.parentElement;
          const rowText = row?.textContent?.trim() || '';
          const title = (a as HTMLElement).innerText?.trim() || a.textContent?.trim() || '';

          // Try to extract date from row (format DD/MM/YYYY)
          const dateMatch = rowText.match(/(\d{2}\/\d{2}\/\d{4})/);
          const publishDate = dateMatch ? dateMatch[1] : '';

          // Get the descriptive title
          let desc = title;
          if (!desc || desc.length < 3) {
            // Try getting text after the date in the row
            const parts = rowText.split(/\d{2}\/\d{2}\/\d{4}/);
            desc = parts.length > 1 ? parts[1].trim() : rowText;
          }

          if (href && desc) {
            results.push({ url: href, title: desc.substring(0, 200), publishDate });
          }
        }
        return results;
      }, year);

      // Determine period from section headers
      const sectionHeaders = await page.evaluate(() => {
        const headers = document.querySelectorAll('.accordion-header, .card-header, h3, h4, h5, [class*="header"], [class*="title"]');
        return Array.from(headers).map(h => h.textContent?.trim() || '').filter(t => t.includes('Tabela de Preços'));
      });

      for (const link of links) {
        let period = `${year}`;
        
        // 1. Try to extract from the link title (e.g. "Janeiro 2026", "Julho 2025")
        const titlePeriod = link.title.match(/(Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s*(?:de\s*)?(\d{4})/i);
        if (titlePeriod) {
          period = `${titlePeriod[1]} ${titlePeriod[2]}`;
        } else {
          // 2. Try to extract from the publish date (format DD/MM/YYYY)
          const dateMatch = link.publishDate.match(/\d{2}\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            const mNum = parseInt(dateMatch[1]);
            const yr = parseInt(dateMatch[2]);
            if (yr === year) {
              const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
              const mName = monthNames[mNum - 1] || 'Janeiro';
              period = `${mName} ${yr}`;
            }
          }
        }

        allEntries.push({ ...link, year, period });
      }

      console.log(`[CAERN Crawler] 📄 ${year}: ${links.length} PDFs encontrados`);
    }
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }

  return allEntries;
}

// ═══════════════════════════════════════════════════════════
// Known units in CAERN price tables
// ═══════════════════════════════════════════════════════════
const KNOWN_UNITS_LIST = [
  'UN', 'M', 'M2', 'M²', 'M3', 'M³', 'KG', 'L', 'CJ', 'VB', 'GB', 'PC', 'H',
  'MÊS', 'MES', 'DIA', 'KM', 'PAR', 'JG', 'BD', 'GL', 'CX', 'TB', 'SC', 'LT',
  'TN', 'TF', 'CH', 'CM', 'T', 'KWH', 'HA', 'CHP', 'CHI', 'MJ', 'CONJ',
  'UNID', 'UND', 'PT X DIA',
];
const KNOWN_UNITS = new Set(KNOWN_UNITS_LIST);
// Regex to match the combined line: "UNIT PRICE1 PRICE2"
// Supports properly spaced "M 7,10 6,55" AND merged spaces from pdf-parse "M³2,512,48"
const UNIT_PRICE_REGEX = new RegExp(
  `^(${KNOWN_UNITS_LIST.join('|')})\\s*(\\d[\\d.,]*?\\,\\d{2})\\s*(\\d[\\d.,]*?\\,\\d{2})\\s*$`, 'i'
);
// Also match unit + single price: "M 7,10" or "M7,10"
const UNIT_SINGLE_PRICE_REGEX = new RegExp(
  `^(${KNOWN_UNITS_LIST.join('|')})\\s*(\\d[\\d.,]*?\\,\\d{2})\\s*$`, 'i'
);

// ═══════════════════════════════════════════════════════════
// Extract text from PDF using pdf-parse v2 (PDFParse class)
// Falls back to pdfjs-dist if available
// ═══════════════════════════════════════════════════════════
async function extractPdfText(buffer: Buffer): Promise<string> {
  // Try pdf-parse v2+ (class-based API)
  try {
    const mod = require('pdf-parse');
    if (mod.PDFParse) {
      const { PDFParse } = mod;
      const parser = new PDFParse(new Uint8Array(buffer));
      await parser.load();
      const result = await parser.getText();
      if (result && typeof result.text === 'string') {
        return result.text;
      }
      // If result.text is not a string, reconstruct from pages
      if (result && result.pages) {
        const pages = result.pages;
        const allText: string[] = [];
        const pageKeys = Object.keys(pages);
        for (const pk of pageKeys) {
          const page = pages[pk];
          const itemKeys = Object.keys(page);
          for (const ik of itemKeys) {
            const item = page[ik];
            if (item && item.text) allText.push(item.text);
          }
        }
        return allText.join('\n');
      }
    }
    // Try as function (v1 API fallback)
    if (typeof mod === 'function') {
      const pdfData = await mod(buffer);
      return pdfData.text || '';
    }
  } catch (e: any) {
    console.log(`[CAERN Crawler] ⚠️ pdf-parse getText falhou: ${e.message}, tentando pdfjs-dist...`);
  }

  // Fallback: pdfjs-dist
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const allText: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items.map((i: any) => i.str).join('\n');
      allText.push(pageText);
    }
    return allText.join('\n');
  } catch (e: any) {
    console.log(`[CAERN Crawler] ⚠️ pdfjs-dist também falhou: ${e.message}`);
  }

  return '';
}

// ═══════════════════════════════════════════════════════════
// Download PDF and extract table data
// Actual PDF text format (from pdf-parse v2.4.5):
//   97160                          ← code (3-6 digit number)
//   ASSENTAMENTO DE TUBO...        ← description line 1
//   MM, JUNTA ELÁSTICA...          ← description line 2
//   INTERFERÊNCIAS...              ← description line 3
//   M 7,10 6,55                    ← UNIT + PRICE1 + PRICE2 on SAME line
// ═══════════════════════════════════════════════════════════
async function parsePdfBuffer(buffer: Buffer): Promise<{ code: string; description: string; unit: string; price: number; type: string }[]> {
  const items: { code: string; description: string; unit: string; price: number; type: string }[] = [];
  const text = await extractPdfText(buffer);

  if (!text) {
    console.log(`[CAERN Crawler] ⚠️ Não foi possível extrair texto do PDF`);
    return [];
  }

  const lines: string[] = text.split('\n').map((l: string) => l.trim()).filter(Boolean);

  // State machine parser
  type State = 'SEEK_CODE' | 'READ_DESC';
  let state: State = 'SEEK_CODE';
  let curCode = '';
  let curDesc: string[] = [];
  let descLineCount = 0;

  const isCode = (l: string) => /^\d{3,7}$/.test(l);
  const isHeaderLine = (l: string) => /^(CÓDIGO|DESCRIÇÃO|UNIDADE|PREÇO|ITEM|BANCO DE PREÇOS|COMPOSIÇÕES|TABELA|PÁG|PAG|CAERN|OBSERVAÇÕES|DATA BASE|PREÇOS SERVIÇOS|SERVIÇOS SINAPI|COM DESONERAÇÃO|SEM DESONERAÇÃO|SEM BDI)/i.test(l);
  const isPageMarker = (l: string) => /^--\s*\d+\s*of\s*\d+\s*--$/.test(l);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip headers, footers, page markers
    if (isHeaderLine(line) || isPageMarker(line)) {
      if (state === 'READ_DESC' && descLineCount > 0) state = 'SEEK_CODE';
      continue;
    }

    switch (state) {
      case 'SEEK_CODE':
        if (isCode(line)) {
          curCode = line;
          curDesc = [];
          descLineCount = 0;
          state = 'READ_DESC';
        }
        break;

      case 'READ_DESC': {
        // Check if this line is the combined UNIT + PRICE line
        const matchDouble = line.match(UNIT_PRICE_REGEX);
        if (matchDouble && descLineCount > 0) {
          items.push({
            code: curCode,
            description: curDesc.join(' '),
            unit: matchDouble[1].toUpperCase(),
            price: parseBrPrice(matchDouble[2]),
            type: 'SERVICO',
          });
          state = 'SEEK_CODE';
          break;
        }

        // Check single price variant: "UN 13,24"
        const matchSingle = line.match(UNIT_SINGLE_PRICE_REGEX);
        if (matchSingle && descLineCount > 0) {
          items.push({
            code: curCode,
            description: curDesc.join(' '),
            unit: matchSingle[1].toUpperCase(),
            price: parseBrPrice(matchSingle[2]),
            type: 'SERVICO',
          });
          state = 'SEEK_CODE';
          break;
        }

        // Check if this is a new code (description was empty or we need to restart)
        if (isCode(line)) {
          curCode = line;
          curDesc = [];
          descLineCount = 0;
          break;
        }

        // Otherwise it's a description line
        if (line.length > 2) {
          curDesc.push(line);
          descLineCount++;
          if (descLineCount > 6) { state = 'SEEK_CODE'; }
        }
        break;
      }
    }
  }

  // Log results
  if (items.length > 0) {
    const s = items[0];
    console.log(`[CAERN Crawler] 📊 ${items.length} itens (ex: ${s.code} | ${s.description.substring(0, 50)}... | ${s.unit} | R$${s.price})`);
  } else {
    const codeLikes = lines.filter(l => /^\d{3,7}$/.test(l)).slice(0, 3);
    const unitPriceLikes = lines.filter(l => UNIT_PRICE_REGEX.test(l) || UNIT_SINGLE_PRICE_REGEX.test(l)).slice(0, 3);
    console.log(`[CAERN Crawler] 📊 0 itens de ${lines.length} linhas. Códigos: [${codeLikes}] UnitPrice: [${unitPriceLikes}]`);
  }

  return items;
}

async function downloadAndParsePdf(url: string): Promise<{ items: { code: string; description: string; unit: string; price: number; type: string }[]; rawText: string }> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });

    if (!response.ok) {
      console.log(`[CAERN Crawler] ⚠️ HTTP ${response.status} para ${url.substring(0, 80)}...`);
      return { items: [], rawText: '' };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    
    // Check if buffer is a ZIP file
    const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
    
    if (isZip) {
      console.log(`[CAERN Crawler] 📦 Arquivo ZIP detectado para URL: ${url}`);
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();
      const allItems: { code: string; description: string; unit: string; price: number; type: string }[] = [];
      
      for (const entry of entries) {
        if (entry.isDirectory || !entry.entryName.toLowerCase().endsWith('.pdf')) continue;
        
        const nameLower = entry.entryName.toLowerCase();
        // Skip detailed CPU files or background materials
        if (nameLower.includes('cpu') || nameLower.includes('encargos') || nameLower.includes('miv') || nameLower.includes('política') || nameLower.includes('privacidade')) {
          console.log(`[CAERN Crawler] ⏭️ Pulando entrada do ZIP irrelevante: ${entry.entryName}`);
          continue;
        }
        
        console.log(`[CAERN Crawler] 📄 Processando PDF do ZIP: ${entry.entryName}`);
        const pdfBuffer = entry.getData();
        const items = await parsePdfBuffer(pdfBuffer);
        allItems.push(...items);
      }
      
      return { items: allItems, rawText: `ZIP file with ${entries.length} entries` };
    } else {
      const items = await parsePdfBuffer(buffer);
      return { items, rawText: '' };
    }
  } catch (e: any) {
    console.error(`[CAERN Crawler] ❌ Erro ao baixar/parsear: ${e.message}`);
    return { items: [], rawText: '' };
  }
}

// ═══════════════════════════════════════════════════════════
// Persist to database
// ═══════════════════════════════════════════════════════════
async function persistCaernData(
  period: string,
  year: number,
  month: number,
  allItems: { code: string; description: string; unit: string; price: number; type: string }[],
  pdfUrls: string[]
): Promise<SyncResult> {
  const baseName = 'CAERN';
  const uf = 'RN';
  const version = period;

  let db = await prisma.engineeringDatabase.findFirst({
    where: { name: baseName, uf, referenceMonth: month, referenceYear: year, type: 'OFICIAL' }
  });

  if (db) {
    await prisma.engineeringComposition.deleteMany({ where: { databaseId: db.id } });
    await prisma.engineeringItem.deleteMany({ where: { databaseId: db.id } });
  } else {
    db = await prisma.engineeringDatabase.create({
      data: { name: baseName, uf, version, type: 'OFICIAL', payrollExemption: false, referenceMonth: month, referenceYear: year }
    });
  }

  // Separate items by type
  const materials = allItems.filter((it: { type: string }) => it.type === 'MATERIAL');
  const services = allItems.filter((it: { type: string }) => it.type !== 'MATERIAL');

  let insItems = 0;
  for (let i = 0; i < materials.length; i += 1000) {
    const r = await prisma.engineeringItem.createMany({
      data: materials.slice(i, i + 1000).map((it: { code: string; description: string; unit: string; price: number; type: string }) => ({ databaseId: db!.id, ...it })),
      skipDuplicates: true,
    });
    insItems += r.count;
  }

  let insComps = 0;
  for (let i = 0; i < services.length; i += 1000) {
    const r = await prisma.engineeringComposition.createMany({
      data: services.slice(i, i + 1000).map((s: { code: string; description: string; unit: string; price: number }) => ({
        databaseId: db!.id, code: s.code, description: s.description, unit: s.unit, totalPrice: s.price,
      })),
      skipDuplicates: true,
    });
    insComps += r.count;
  }

  await prisma.engineeringDatabase.update({
    where: { id: db!.id },
    data: { itemCount: insItems, compositionCount: insComps, version: `${version} (${pdfUrls.length} PDFs)` }
  });

  console.log(`[CAERN Crawler] ✅ CAERN ${uf} ${version}: ${insItems} insumos + ${insComps} composições`);
  return {
    success: true,
    message: `CAERN ${uf} ${version}: ${insItems} insumos + ${insComps} composições (${pdfUrls.length} PDFs)`,
    databaseId: db!.id, itemCount: insItems, compositionCount: insComps,
  };
}

// ═══════════════════════════════════════════════════════════
// Month name to number
// ═══════════════════════════════════════════════════════════
const MONTH_MAP: Record<string, number> = {
  'janeiro': 1, 'fevereiro': 2, 'março': 3, 'marco': 3, 'abril': 4,
  'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8,
  'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12,
};

function extractMonthFromPeriod(period: string): number {
  const lower = period.toLowerCase();
  for (const [name, num] of Object.entries(MONTH_MAP)) {
    if (lower.includes(name)) return num;
  }
  return 1; // default to January
}

// ═══════════════════════════════════════════════════════════
// Main Orchestrator
// ═══════════════════════════════════════════════════════════
export interface CaernSyncOptions {
  years?: number[];  // e.g. [2026, 2025, 2024] — defaults to last 3 years
}

export interface CaernSyncReport {
  started: string;
  finished: string;
  totalAttempted: number;
  totalSuccess: number;
  totalFailed: number;
  results: SyncResult[];
}

export async function syncCaern(options: CaernSyncOptions = {}): Promise<CaernSyncReport> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const years = options.years || [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];
  const started = new Date().toISOString();
  const results: SyncResult[] = [];

  console.log(`\n[CAERN Crawler] 🚀 Sync CAERN: Anos ${years.join(', ')}`);

  try {
    // Step 1: Discover all PDF links via Puppeteer
    const pdfEntries = await discoverPdfLinks(years);
    console.log(`[CAERN Crawler] 📋 Total: ${pdfEntries.length} PDFs descobertos`);

    if (pdfEntries.length === 0) {
      return { started, finished: new Date().toISOString(), totalAttempted: 0, totalSuccess: 0, totalFailed: 1, results: [{ success: false, message: 'Nenhum PDF encontrado no portal CAERN' }] };
    }

    // Group entries by period (e.g. "Janeiro 2026")
    const grouped = new Map<string, CaernPdfEntry[]>();
    for (const entry of pdfEntries) {
      const key = `${entry.period}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(entry);
    }

    // Step 2: Process each period
    for (const [period, entries] of grouped) {
      const year = entries[0].year;
      const month = extractMonthFromPeriod(period);

      // Idempotency check
      const existing = await prisma.engineeringDatabase.findFirst({
        where: {
          name: 'CAERN',
          uf: 'RN',
          referenceMonth: month,
          referenceYear: year,
          type: 'OFICIAL',
          OR: [
            { itemCount: { gt: 0 } },
            { compositionCount: { gt: 0 } }
          ]
        }
      });
      if (existing && ((existing.itemCount || 0) > 0 || (existing.compositionCount || 0) > 0)) {
        console.log(`[CAERN Crawler] ⏭️ CAERN RN ${period}: já existente (${existing.itemCount} insumos, ${existing.compositionCount} composições)`);
        results.push({ success: true, message: `Já existente: CAERN ${period}` });
        continue;
      }

      console.log(`[CAERN Crawler] 📥 Processando período: ${period} (${entries.length} PDFs)...`);

      // Download and parse each PDF for this period
      const allItems: { code: string; description: string; unit: string; price: number; type: string }[] = [];
      const pdfUrls: string[] = [];

      for (const entry of entries) {
        // Skip irrelevant PDFs: MIV (brand manual), Privacy Policy, generic links
        const lower = entry.title.toLowerCase();
        const isIrrelevant = lower.includes('miv') || lower.includes('política') || lower.includes('politica') ||
                            lower.includes('privacidade') || lower.includes('powered by') ||
                            lower === 'tabela de preços' || entry.title.length < 5;
        
        if (isIrrelevant) {
          console.log(`[CAERN Crawler] ⏭️ Pulando irrelevante: ${entry.title.substring(0, 60)}`);
          continue;
        }

        // Skip Encargos Sociais (not price data)
        if (lower.includes('encargo') && lower.includes('socia')) {
          console.log(`[CAERN Crawler] ⏭️ Pulando: ${entry.title.substring(0, 60)}`);
          continue;
        }

        console.log(`[CAERN Crawler] 📄 Baixando: ${entry.title.substring(0, 80)}...`);
        const { items } = await downloadAndParsePdf(entry.url);
        allItems.push(...items);
        pdfUrls.push(entry.url);

        // Rate limit
        await new Promise(r => setTimeout(r, 2000));
      }

      if (allItems.length === 0) {
        // Even if we couldn't parse items, register the database entry with the PDF URLs
        // so the user knows the period exists
        console.log(`[CAERN Crawler] ⚠️ CAERN ${period}: PDFs baixados mas sem itens parseáveis (PDF complexo)`);
        // Still persist with 0 items but version has PDF info
        const result = await persistCaernData(period, year, month, [], pdfUrls);
        results.push({ ...result, message: `CAERN ${period}: ${pdfUrls.length} PDFs registrados (parsing pendente)` });
        continue;
      }

      const result = await persistCaernData(period, year, month, allItems, pdfUrls);
      results.push(result);
    }
  } catch (e: any) {
    console.error(`[CAERN Crawler] ❌ Erro fatal: ${e.message}`);
    results.push({ success: false, message: `Erro: ${e.message}` });
  }

  const finished = new Date().toISOString();
  const ok = results.filter(r => r.success).length;
  const fail = results.filter(r => !r.success).length;
  console.log(`\n[CAERN Crawler] 🏁 Sync completo: ${ok} sucesso, ${fail} falhas`);

  return { started, finished, totalAttempted: results.length, totalSuccess: ok, totalFailed: fail, results };
}
