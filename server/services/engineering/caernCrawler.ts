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
  for (const p of ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome', process.env.CHROME_PATH].filter(Boolean)) {
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
        // Try to extract period from the link title or section headers
        let period = `${year}`;
        for (const header of sectionHeaders) {
          // "Tabela de Preços - Julho 2025" → "Julho 2025"
          const periodMatch = header.match(/(Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s*(?:de\s*)?(\d{4})/i);
          if (periodMatch && parseInt(periodMatch[2]) === year) {
            period = `${periodMatch[1]} ${periodMatch[2]}`;
          }
        }

        // Also try extracting from the title itself
        const titlePeriod = link.title.match(/(Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s*(?:de\s*)?(\d{4})/i);
        if (titlePeriod) {
          period = `${titlePeriod[1]} ${titlePeriod[2]}`;
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
// Download PDF and try to extract table data
// ═══════════════════════════════════════════════════════════
async function downloadAndParsePdf(url: string): Promise<{ items: { code: string; description: string; unit: string; price: number; type: string }[]; rawText: string }> {
  const items: { code: string; description: string; unit: string; price: number; type: string }[] = [];

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });

    if (!response.ok) {
      console.log(`[CAERN Crawler] ⚠️ HTTP ${response.status} para ${url.substring(0, 80)}...`);
      return { items: [], rawText: '' };
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Try pdf-parse
    let pdfParse: any;
    try { pdfParse = require('pdf-parse'); } catch {
      console.log(`[CAERN Crawler] ⚠️ pdf-parse não disponível, salvando PDF sem parsing`);
      return { items: [], rawText: '' };
    }

    const pdfData = await pdfParse(buffer);
    const text = pdfData.text || '';

    // Try to extract structured data from PDF text
    // CAERN PDFs typically have format: CÓDIGO | DESCRIÇÃO | UNIDADE | PREÇO
    const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean);

    for (const line of lines) {
      // Pattern: starts with a code (numbers, dots, dashes), followed by description, unit, price
      // Example: "01.001.001  ESCAVAÇÃO MANUAL DE VALA  M3  45,50"
      const match = line.match(/^(\d[\d./-]{2,20})\s+(.{10,}?)\s+(M[23²³]?|UN|KG|L|M|CJ|VB|GB|PC|H|MÊS|DIA|KM|PAR|JG|FIO|BD|GL|CX|TB|SC|LT|TN|TF|CH|CM)\s+(\d[\d.,]+)\s*$/i);
      if (match) {
        items.push({
          code: match[1].trim(),
          description: match[2].trim(),
          unit: match[3].trim().toUpperCase(),
          price: parseBrPrice(match[4]),
          type: 'SERVICO',
        });
      }
    }

    console.log(`[CAERN Crawler] 📊 PDF parseado: ${items.length} itens extraídos de ${lines.length} linhas`);
    return { items, rawText: text.substring(0, 500) };

  } catch (e: any) {
    console.error(`[CAERN Crawler] ❌ Erro ao baixar/parsear PDF: ${e.message}`);
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
    await prisma.engineeringItem.deleteMany({ where: { databaseId: db.id } });
    await prisma.engineeringComposition.deleteMany({ where: { databaseId: db.id } });
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
  const years = options.years || [currentYear, currentYear - 1, currentYear - 2];
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
        where: { name: 'CAERN', uf: 'RN', referenceMonth: month, referenceYear: year, type: 'OFICIAL', itemCount: { gt: 0 } }
      });
      if (existing && (existing.itemCount || 0) > 0) {
        console.log(`[CAERN Crawler] ⏭️ CAERN RN ${period}: já existente (${existing.itemCount} itens)`);
        results.push({ success: true, message: `Já existente: CAERN ${period}` });
        continue;
      }

      console.log(`[CAERN Crawler] 📥 Processando período: ${period} (${entries.length} PDFs)...`);

      // Download and parse each PDF for this period
      const allItems: { code: string; description: string; unit: string; price: number; type: string }[] = [];
      const pdfUrls: string[] = [];

      for (const entry of entries) {
        // Only process "Banco de Preços" and "Composições" PDFs (skip Encargos Sociais)
        const isRelevant = entry.title.toLowerCase().includes('banco') ||
                          entry.title.toLowerCase().includes('composiç') ||
                          entry.title.toLowerCase().includes('composic') ||
                          entry.title.toLowerCase().includes('cpu') ||
                          entry.title.toLowerCase().includes('preço');

        if (!isRelevant && entry.title.toLowerCase().includes('encargo')) {
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
