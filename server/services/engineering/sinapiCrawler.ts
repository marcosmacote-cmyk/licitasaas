/**
 * SINAPI Crawler — Download automático via Puppeteer headless
 * Usa Chromium do sistema (Alpine: /usr/bin/chromium-browser)
 */
import * as XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import os from 'os';

const prisma = new PrismaClient();

// ═══════════════════════════════════════════════════════════
// Puppeteer-based download (bypasses Azion WAF)
// ═══════════════════════════════════════════════════════════

async function downloadViaPuppeteer(url: string, downloadDir: string): Promise<string | null> {
  let browser: any = null;
  try {
    const puppeteer = await import('puppeteer-core');
    const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
    
    browser = await puppeteer.default.launch({
      executablePath: execPath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    // Configure download behavior
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
    
    console.log(`[SINAPI Crawler] 🌐 Navegando para: ${url.split('/').pop()}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Wait for download to complete (check for file in downloadDir)
    const maxWait = 120000; // 2 min
    const start = Date.now();
    let downloadedFile: string | null = null;
    
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 2000));
      const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.zip') && !f.endsWith('.crdownload'));
      if (files.length > 0) {
        downloadedFile = path.join(downloadDir, files[0]);
        break;
      }
    }
    
    if (downloadedFile) {
      console.log(`[SINAPI Crawler] ✅ Download concluído: ${path.basename(downloadedFile)}`);
    } else {
      console.log(`[SINAPI Crawler] ❌ Download timeout`);
    }
    
    return downloadedFile;
  } catch (err: any) {
    console.error(`[SINAPI Crawler] Puppeteer error:`, err.message);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════
// URL Generation
// ═══════════════════════════════════════════════════════════

function generateSinapiUrls(uf: string, month: number, year: number, desonerado: boolean): string[] {
  const mm = String(month).padStart(2, '0');
  const mmyy = `${mm}${year}`;
  const regime = desonerado ? 'Desonerado' : 'NaoDesonerado';
  const base = `https://www.caixa.gov.br/Downloads/sinapi-a-partir-jul-2009-${uf.toLowerCase()}`;
  return [
    `${base}/SINAPI_ref_Insumos_Composicoes_${uf}_${mmyy}_${regime}.zip`,
    `${base}/SINAPI_Preco_Ref_Insumos_${uf}_${mmyy}_${regime}.zip`,
    `${base}/SINAPI_Custo_Ref_Composicoes_Sintetico_${uf}_${mmyy}_${regime}.zip`,
  ];
}

// ═══════════════════════════════════════════════════════════
// ZIP + Excel Processing
// ═══════════════════════════════════════════════════════════

function extractExcelFromZip(zipBuffer: Buffer): Buffer[] {
  const zip = new AdmZip(zipBuffer);
  return zip.getEntries()
    .filter((e: any) => e.entryName.toUpperCase().endsWith('.XLSX'))
    .sort((a: any, b: any) => b.header.size - a.header.size)
    .map((e: any) => e.getData());
}

function parseExcelToItems(buffer: Buffer): { code: string; description: string; unit: string; price: number; type: string }[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const items: { code: string; description: string; unit: string; price: number; type: string }[] = [];

  for (const sheetName of workbook.SheetNames) {
    const rows: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    if (rows.length < 2) continue;

    let headerIdx = -1, colMap: Record<string, number> = {};
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const row = rows[i].map((c: any) => String(c).trim().toUpperCase());
      const cI = row.findIndex((c: string) => c.includes('CODIGO') || c.includes('CÓDIGO'));
      const dI = row.findIndex((c: string) => c.includes('DESCRI'));
      const pI = row.findIndex((c: string) => c.includes('PRECO') || c.includes('PREÇO') || c.includes('CUSTO') || c.includes('MEDIANA'));
      const uI = row.findIndex((c: string) => c.includes('UNID') || c === 'UN');
      if (cI >= 0 && dI >= 0 && pI >= 0) { headerIdx = i; colMap = { code: cI, desc: dI, price: pI, unit: uI >= 0 ? uI : -1 }; break; }
    }
    if (headerIdx < 0) continue;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const code = String(r[colMap.code] ?? '').trim();
      const desc = String(r[colMap.desc] ?? '').trim();
      const unit = colMap.unit >= 0 ? String(r[colMap.unit] ?? '').trim().toUpperCase() : 'UN';
      if (!code || !desc || code.length < 2) continue;

      let price = 0;
      const raw = r[colMap.price];
      if (typeof raw === 'number') price = raw;
      else if (raw) {
        const c = String(raw).replace(/[^\d.,\-]/g, '');
        price = c.includes(',') && (!c.includes('.') || c.lastIndexOf(',') > c.lastIndexOf('.'))
          ? parseFloat(c.replace(/\./g, '').replace(',', '.')) || 0
          : parseFloat(c.replace(/,/g, '')) || 0;
      }
      if (price <= 0) continue;

      let type = 'SERVICO';
      const du = desc.toUpperCase();
      if (/PEDREIRO|SERVENTE|MESTRE|ELETRICISTA|PINTOR|CARPINTEIRO/.test(du) && ['H', 'HORA', 'MES'].includes(unit)) type = 'MAO_DE_OBRA';
      else if (['KG', 'L', 'M', 'UN', 'M2', 'M3'].includes(unit) && price < 500 && !/INSTALACAO|EXECUCAO/.test(du)) type = 'MATERIAL';
      else if (/BETONEIRA|CAMINHAO|RETROESCAVADEIRA|COMPACTADOR/.test(du)) type = 'EQUIPAMENTO';

      items.push({ code, description: desc, unit: unit || 'UN', price, type });
    }
  }
  return items;
}

// ═══════════════════════════════════════════════════════════
// Database Persistence
// ═══════════════════════════════════════════════════════════

interface SyncResult { success: boolean; message: string; databaseId?: string; itemCount?: number; compositionCount?: number; }

async function persistItems(baseName: string, uf: string, month: number, year: number, desonerado: boolean, items: { code: string; description: string; unit: string; price: number; type: string }[]): Promise<SyncResult> {
  const version = `${String(month).padStart(2, '0')}/${year}`;
  const regime = desonerado ? 'Desonerado' : 'Onerado';

  let db = await prisma.engineeringDatabase.findFirst({
    where: { name: baseName, uf, referenceMonth: month, referenceYear: year, payrollExemption: desonerado, type: 'OFICIAL' }
  });

  if (db) {
    await prisma.engineeringItem.deleteMany({ where: { databaseId: db.id } });
    await prisma.engineeringComposition.deleteMany({ where: { databaseId: db.id } });
  } else {
    db = await prisma.engineeringDatabase.create({
      data: { name: baseName, uf, version, type: 'OFICIAL', payrollExemption: desonerado, referenceMonth: month, referenceYear: year }
    });
  }

  const basicItems = items.filter(it => it.type !== 'SERVICO');
  const serviceItems = items.filter(it => it.type === 'SERVICO');

  let insertedItems = 0;
  for (let i = 0; i < basicItems.length; i += 1000) {
    const r = await prisma.engineeringItem.createMany({ data: basicItems.slice(i, i + 1000).map(it => ({ databaseId: db!.id, ...it })), skipDuplicates: true });
    insertedItems += r.count;
  }

  let insertedComps = 0;
  for (const svc of serviceItems) {
    try { await prisma.engineeringComposition.create({ data: { databaseId: db!.id, code: svc.code, description: svc.description, unit: svc.unit, totalPrice: svc.price } }); insertedComps++; } catch {}
  }

  await prisma.engineeringDatabase.update({ where: { id: db!.id }, data: { itemCount: insertedItems, compositionCount: insertedComps } });
  console.log(`[SINAPI Crawler] ✅ ${baseName} ${uf} ${version} ${regime}: ${insertedItems} insumos + ${insertedComps} composições`);
  return { success: true, message: `${baseName} ${uf} ${version} ${regime}: ${insertedItems} insumos + ${insertedComps} composições`, databaseId: db!.id, itemCount: insertedItems, compositionCount: insertedComps };
}

// ═══════════════════════════════════════════════════════════
// Main Orchestrator
// ═══════════════════════════════════════════════════════════

export interface SyncOptions { ufs: string[]; months: number; includeDesonerado: boolean; baseName?: string; }
export interface SyncReport { started: string; finished: string; totalAttempted: number; totalSuccess: number; totalFailed: number; results: SyncResult[]; }

export async function syncSinapi(options: SyncOptions): Promise<SyncReport> {
  const { ufs, months, includeDesonerado, baseName = 'SINAPI' } = options;
  const started = new Date().toISOString();
  const results: SyncResult[] = [];
  const now = new Date();
  const targetMonths: { month: number; year: number }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    targetMonths.push({ month: d.getMonth() + 1, year: d.getFullYear() });
  }

  console.log(`[SINAPI Crawler] 🚀 Sync: ${ufs.join(',')} × ${months} meses`);

  for (const uf of ufs) {
    for (const { month, year } of targetMonths) {
      const regimes = includeDesonerado ? [false, true] : [false];
      for (const desonerado of regimes) {
        const regime = desonerado ? 'Desonerado' : 'Onerado';
        const version = `${String(month).padStart(2, '0')}/${year}`;

        // Idempotency check
        const existing = await prisma.engineeringDatabase.findFirst({
          where: { name: baseName, uf, referenceMonth: month, referenceYear: year, payrollExemption: desonerado, type: 'OFICIAL', itemCount: { gt: 0 } }
        });
        if (existing) { results.push({ success: true, message: `Já existente: ${existing.itemCount} itens` }); continue; }

        console.log(`\n[SINAPI Crawler] 📥 ${baseName} ${uf} ${version} ${regime}...`);
        const urls = generateSinapiUrls(uf, month, year, desonerado);
        let zipBuffer: Buffer | null = null;

        // Try Puppeteer download for each URL candidate
        for (const url of urls) {
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sinapi-'));
          try {
            const filePath = await downloadViaPuppeteer(url, tmpDir);
            if (filePath && fs.existsSync(filePath)) {
              const buf = fs.readFileSync(filePath);
              if (buf.length > 100 && buf[0] === 0x50 && buf[1] === 0x4B) { zipBuffer = buf; break; }
            }
          } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          }
        }

        if (!zipBuffer) { results.push({ success: false, message: `Download falhou: ${version} ${regime}` }); continue; }

        const excels = extractExcelFromZip(zipBuffer);
        if (excels.length === 0) { results.push({ success: false, message: `ZIP sem Excel` }); continue; }

        const allItems = excels.flatMap(buf => parseExcelToItems(buf));
        if (allItems.length === 0) { results.push({ success: false, message: `Nenhum item válido` }); continue; }

        results.push(await persistItems(baseName, uf, month, year, desonerado, allItems));
        await new Promise(r => setTimeout(r, 3000)); // Respect rate limits
      }
    }
  }

  const finished = new Date().toISOString();
  console.log(`\n[SINAPI Crawler] 🏁 ${results.filter(r => r.success).length}/${results.length} sucesso`);
  return { started, finished, totalAttempted: results.length, totalSuccess: results.filter(r => r.success).length, totalFailed: results.filter(r => !r.success).length, results };
}

export async function importFromBuffer(buffer: Buffer, baseName: string, uf: string, month: number, year: number, desonerado: boolean): Promise<SyncResult> {
  const items = parseExcelToItems(buffer);
  if (items.length === 0) return { success: false, message: 'Nenhum item válido' };
  return persistItems(baseName, uf, month, year, desonerado, items);
}
