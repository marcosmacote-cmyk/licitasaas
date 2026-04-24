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
// Puppeteer portal navigation + CDP download interception
// The Caixa WAF (Azion CDN) blocks direct file URLs.
// Strategy: browse portal page first → get cookies → fetch file via CDP
// ═══════════════════════════════════════════════════════════

const PORTAL_URL = 'https://www.caixa.gov.br/poder-publico/modernizacao-gestao/sinapi/Paginas/default.aspx';

async function downloadSinapiViaBrowser(uf: string, month: number, year: number, desonerado: boolean, downloadDir: string): Promise<string | null> {
  let browser: any = null;
  try {
    const puppeteer = await import('puppeteer-core');
    const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
    
    browser = await puppeteer.default.launch({
      executablePath: execPath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'],
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Step 1: Visit portal page to establish session cookies
    console.log(`[SINAPI Crawler] 🌐 Abrindo portal SINAPI da Caixa...`);
    await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    
    // Step 2: Configure CDP for download interception
    const client = await page.createCDPSession();
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });
    
    // Step 3: Build correct file URLs based on year
    // From 2025+: national bundles → SINAPI-YYYY-MM-formato-xlsx.zip
    // Pre-2025: state-specific → SINAPI_ref_Insumos_Composicoes_CE_YYYYMM_NaoDesonerado.zip
    const mm = String(month).padStart(2, '0');
    const regime = desonerado ? 'Desonerado' : 'NaoDesonerado';
    
    let fileUrls: { url: string; fileName: string }[] = [];
    
    if (year >= 2025) {
      // New format: single national ZIP per month (contains all UFs)
      const basePath = 'https://www.caixa.gov.br/Downloads/sinapi-relatorios-mensais';
      fileUrls = [
        { url: `${basePath}/SINAPI-${year}-${mm}-formato-xlsx.zip`, fileName: `SINAPI-${year}-${mm}-formato-xlsx.zip` },
        // Try rectified version too
        { url: `${basePath}/SINAPI-${year}-${mm}-formato-xlsx_Retificacao01.zip`, fileName: `SINAPI-${year}-${mm}-formato-xlsx_Retificacao01.zip` },
      ];
      console.log(`[SINAPI Crawler] 📅 Formato 2025+: ZIP nacional mensal`);
    } else {
      // Old format: state-specific ZIPs (YYYYMM, not MMYYYY!)
      const ufSlug = `sinapi-a-partir-jul-2009-${uf.toLowerCase()}`;
      const datePart = `${year}${mm}`; // YYYYMM format
      const basePath = `https://www.caixa.gov.br/Downloads/${ufSlug}`;
      fileUrls = [
        { url: `${basePath}/SINAPI_ref_Insumos_Composicoes_${uf}_${datePart}_${regime}.zip`, fileName: `SINAPI_ref_Insumos_Composicoes_${uf}_${datePart}_${regime}.zip` },
        { url: `${basePath}/SINAPI_Preco_Ref_Insumos_${uf}_${datePart}_${regime}.zip`, fileName: `SINAPI_Preco_Ref_Insumos_${uf}_${datePart}_${regime}.zip` },
        { url: `${basePath}/SINAPI_Custo_Ref_Composicoes_Sintetico_${uf}_${datePart}_${regime}.zip`, fileName: `SINAPI_Custo_Ref_Composicoes_Sintetico_${uf}_${datePart}_${regime}.zip` },
      ];
      console.log(`[SINAPI Crawler] 📅 Formato pré-2025: ZIP por UF (${uf})`);
    }
    
    for (const { url: fileUrl, fileName } of fileUrls) {
      console.log(`[SINAPI Crawler] 📥 Tentando: ${fileName}`);
      
      try {
        // Use page.evaluate to fetch with the browser's cookies
        const result = await page.evaluate(async (url: string) => {
          try {
            const resp = await fetch(url, { redirect: 'follow', credentials: 'include' });
            if (!resp.ok) return { ok: false, status: resp.status };
            const buf = await resp.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            return { ok: true, data: btoa(binary), size: buf.byteLength };
          } catch (e: any) {
            return { ok: false, error: e.message };
          }
        }, fileUrl);
        
        if (result.ok && result.data && result.size > 1000) {
          const buffer = Buffer.from(result.data, 'base64');
          if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
            const filePath = path.join(downloadDir, fileName);
            fs.writeFileSync(filePath, buffer);
            console.log(`[SINAPI Crawler] ✅ Download OK: ${fileName} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
            return filePath;
          }
          console.log(`[SINAPI Crawler] ⚠️ Não é ZIP: ${fileName} (${buffer.length} bytes)`);
        } else {
          console.log(`[SINAPI Crawler] ❌ ${fileName} (status=${result.status || result.error})`);
        }
      } catch (err: any) {
        console.log(`[SINAPI Crawler] ❌ Erro: ${err.message}`);
      }
    }
    
    return null;
  } catch (err: any) {
    console.error(`[SINAPI Crawler] Puppeteer error:`, err.message);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════
// ZIP + Excel Processing (handles nested ZIPs for national bundles)
// ═══════════════════════════════════════════════════════════

function extractExcelFromZip(zipBuffer: Buffer): Buffer[] {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  
  const names = entries.map((e: any) => e.entryName);
  console.log(`[SINAPI Parse] 📦 ZIP contém ${entries.length} entradas:`);
  names.forEach((n: string) => console.log(`  → ${n}`));
  
  const excels: Buffer[] = [];
  
  for (const entry of entries) {
    const name = (entry as any).entryName.toUpperCase();
    
    if (name.endsWith('.XLSX') && !name.startsWith('__MACOSX') && !name.includes('~$')) {
      console.log(`[SINAPI Parse] 📋 Excel: ${(entry as any).entryName} (${((entry as any).header.size / 1024).toFixed(0)} KB)`);
      excels.push((entry as any).getData());
    } else if (name.endsWith('.ZIP')) {
      console.log(`[SINAPI Parse] 📦 ZIP aninhado: ${(entry as any).entryName}`);
      try {
        const innerExcels = extractExcelFromZip((entry as any).getData());
        excels.push(...innerExcels);
      } catch (err: any) {
        console.log(`[SINAPI Parse] ⚠️ Erro ZIP aninhado: ${err.message}`);
      }
    }
  }
  
  excels.sort((a, b) => b.length - a.length);
  console.log(`[SINAPI Parse] ✅ ${excels.length} planilhas Excel extraídas`);
  return excels;
}

function parseExcelToItems(buffer: Buffer, uf?: string, desonerado?: boolean): { code: string; description: string; unit: string; price: number; type: string }[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true });
  const items: { code: string; description: string; unit: string; price: number; type: string }[] = [];
  const targetUf = (uf || 'CE').toUpperCase();

  console.log(`[SINAPI Parse] 📄 ${workbook.SheetNames.length} abas: ${workbook.SheetNames.join(', ')}`);

  // Target sheets: IND/ISD=Insumos NãoDesonerado, ICD=Insumos Desonerado
  // CSD=Composições SemDesoneração, CCD=Composições ComDesoneração
  let insumoSheets = ['IND', 'ISD', 'ICD', 'ISE'];
  let compSheets = ['CSD', 'CCD', 'CNE', 'CSE'];
  
  if (desonerado !== undefined) {
    insumoSheets = desonerado ? ['ICD'] : ['IND', 'ISD'];
    compSheets = desonerado ? ['CCD'] : ['CSD'];
  }
  
  const allTargets = [...insumoSheets, ...compSheets];

  for (const sheetName of workbook.SheetNames) {
    const upper = sheetName.toUpperCase().trim();
    const isTarget = allTargets.includes(upper);
    if (!isTarget) continue;

    const isComposition = compSheets.includes(upper);
    const rows: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    if (rows.length < 5) continue;

    // Find the header row with UF columns (AC, AL, AM, ..., CE, ..., TO)
    let headerIdx = -1, ufColIdx = -1;
    let codeCol = -1, descCol = -1, unitCol = -1, groupCol = -1;

    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const row = rows[i].map((c: any) => String(c).trim().toUpperCase());
      const ceIdx = row.indexOf(targetUf);
      if (ceIdx >= 0) {
        // This row has the UF as a column header
        headerIdx = i;
        ufColIdx = ceIdx;
        // Find other columns in this row or previous rows
        for (let j = Math.max(0, i - 3); j <= i; j++) {
          const r2 = rows[j].map((c: any) => String(c).trim().toUpperCase());
          if (codeCol < 0) codeCol = r2.findIndex((c: string) => c.includes('CODIGO') || c.includes('CÓDIGO') || c === 'CÓDIGO SINAPI' || c.includes('COMPOSIÇÃO'));
          if (descCol < 0) descCol = r2.findIndex((c: string) => c.includes('DESCRI'));
          if (unitCol < 0) unitCol = r2.findIndex((c: string) => c.includes('UNID') || c === 'UN' || c === 'UNIDADE');
          if (groupCol < 0) groupCol = r2.findIndex((c: string) => c.includes('GRUPO') || c.includes('TIPO') || c.includes('CLASSIFICAÇÃO'));
        }
        break;
      }
    }

    if (headerIdx < 0 || ufColIdx < 0) {
      console.log(`[SINAPI Parse] ⚠️ Aba "${sheetName}": UF ${targetUf} não encontrada nas colunas`);
      continue;
    }

    // Fallback column detection
    if (codeCol < 0) codeCol = 1; // Column B typically
    if (descCol < 0) descCol = codeCol + 1;
    if (unitCol < 0) unitCol = codeCol + 2;

    console.log(`[SINAPI Parse] 🎯 Aba "${sheetName}": UF ${targetUf}=col${ufColIdx}, código=col${codeCol}, desc=col${descCol}, unid=col${unitCol}`);

    let count = 0;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      let code = String(r[codeCol] ?? '').trim();
      
      // Handle Caixa's HYPERLINK formulas that evaluate to 0 in CSD/CCD
      if (!code || code === '0' || code.length < 2) {
        const cell = workbook.Sheets[sheetName][XLSX.utils.encode_cell({ r: i, c: codeCol })];
        if (cell && cell.f) {
          const match = cell.f.match(/,?(\d+)\s*\)$/);
          if (match) code = match[1];
        }
      }

      const desc = String(r[descCol] ?? '').trim();
      const unit = String(r[unitCol] ?? '').trim().toUpperCase() || 'UN';
      if (!code || !desc || code.length < 2 || code === '0') continue;

      // Read price from the UF column
      let price = 0;
      const raw = r[ufColIdx];
      if (typeof raw === 'number') price = raw;
      else if (raw) {
        const c = String(raw).replace(/[^\d.,\-]/g, '');
        if (c) {
          price = c.includes(',') && (!c.includes('.') || c.lastIndexOf(',') > c.lastIndexOf('.'))
            ? parseFloat(c.replace(/\./g, '').replace(',', '.')) || 0
            : parseFloat(c.replace(/,/g, '')) || 0;
        }
      }
      if (price <= 0) continue;

      // Determine type
      let type = isComposition ? 'SERVICO' : 'MATERIAL';
      const group = String(r[groupCol] ?? '').toUpperCase();
      if (group.includes('MÃO') || group.includes('MAO') || group.includes('OBRA')) type = 'MAO_DE_OBRA';
      else if (group.includes('EQUIP')) type = 'EQUIPAMENTO';
      else if (group.includes('COMPOS') || group.includes('SERV')) type = 'SERVICO';
      else if (group.includes('MATERIAL') || group.includes('INSUMO')) type = 'MATERIAL';

      items.push({ code, description: desc, unit, price, type });
      count++;
    }
    console.log(`[SINAPI Parse] ✅ Aba "${sheetName}": ${count} itens para ${targetUf}`);
  }

  // Fallback for isolated files (unlikely in national bundles but good for safety)
  if (items.length === 0) {
    for (const sheetName of workbook.SheetNames) {
      if (!sheetName.toUpperCase().includes('DESONERA')) continue;
      const rows: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
      if (rows.length < 5) continue;
      // Look for header with CODIGO + DESCRI + UF column
      for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const row = rows[i].map((c: any) => String(c).trim().toUpperCase());
        const ceIdx = row.indexOf(targetUf);
        const cI = row.findIndex((c: string) => c.includes('CODIGO') || c.includes('CÓDIGO') || c.includes('COMPOSIÇÃO'));
        const dI = row.findIndex((c: string) => c.includes('DESCRI'));
        if (ceIdx >= 0 && cI >= 0 && dI >= 0) {
          const uI = row.findIndex((c: string) => c.includes('UNID'));
          console.log(`[SINAPI Parse] 🔄 Fallback aba "${sheetName}": UF col=${ceIdx}`);
          for (let j = i + 1; j < rows.length; j++) {
            const r = rows[j];
            let code = String(r[cI] ?? '').trim();
            if (!code || code === '0' || code.length < 2) {
              const cell = workbook.Sheets[sheetName][XLSX.utils.encode_cell({ r: j, c: cI })];
              if (cell && cell.f) {
                const match = cell.f.match(/,?(\d+)\s*\)$/);
                if (match) code = match[1];
              }
            }
            const desc = String(r[dI] ?? '').trim();
            if (!code || !desc || code.length < 2 || code === '0') continue;
            let price = 0;
            const raw = r[ceIdx];
            if (typeof raw === 'number') price = raw;
            else if (raw) { const c = String(raw).replace(/[^\d.,\-]/g, ''); price = parseFloat(c.replace(',', '.')) || 0; }
            if (price <= 0) continue;
            items.push({ code, description: desc, unit: uI >= 0 ? String(r[uI] ?? 'UN').trim() : 'UN', price, type: 'SERVICO' });
          }
          break;
        }
      }
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
  for (let i = 0; i < serviceItems.length; i += 1000) {
    const chunk = serviceItems.slice(i, i + 1000);
    const r = await prisma.engineeringComposition.createMany({
      data: chunk.map(svc => ({ databaseId: db!.id, code: svc.code, description: svc.description, unit: svc.unit, totalPrice: svc.price })),
      skipDuplicates: true
    });
    insertedComps += r.count;
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

        // Idempotency check: require both items and compositions to consider it fully synced
        const existing = await prisma.engineeringDatabase.findFirst({
          where: { name: baseName, uf, referenceMonth: month, referenceYear: year, payrollExemption: desonerado, type: 'OFICIAL' }
        });
        if (existing && existing.itemCount > 0 && existing.compositionCount > 0) { 
          results.push({ success: true, message: `Já existente: ${existing.itemCount} itens, ${existing.compositionCount} composições` }); 
          continue; 
        }

        console.log(`\n[SINAPI Crawler] 📥 ${baseName} ${uf} ${version} ${regime}...`);
        let zipBuffer: Buffer | null = null;

        // Download via portal navigation (single browser session per UF+month+regime)
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sinapi-'));
        try {
          const filePath = await downloadSinapiViaBrowser(uf, month, year, desonerado, tmpDir);
          if (filePath && fs.existsSync(filePath)) {
            const buf = fs.readFileSync(filePath);
            if (buf.length > 100 && buf[0] === 0x50 && buf[1] === 0x4B) zipBuffer = buf;
          }
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }

        if (!zipBuffer) { console.log(`[SINAPI Crawler] ❌ Download falhou: ${version} ${regime}`); results.push({ success: false, message: `Download falhou: ${version} ${regime}` }); continue; }

        console.log(`[SINAPI Crawler] 📦 Extraindo planilhas do ZIP (${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB)...`);
        const excels = extractExcelFromZip(zipBuffer);
        if (excels.length === 0) { console.log(`[SINAPI Crawler] ❌ ZIP sem Excel`); results.push({ success: false, message: `ZIP sem Excel` }); continue; }

        console.log(`[SINAPI Crawler] 📊 Parseando ${excels.length} planilhas...`);
        const allItems = excels.flatMap(buf => parseExcelToItems(buf, uf, desonerado));
        console.log(`[SINAPI Crawler] 📊 Total de itens parseados: ${allItems.length}`);
        if (allItems.length === 0) { console.log(`[SINAPI Crawler] ❌ Nenhum item válido encontrado`); results.push({ success: false, message: `Nenhum item válido` }); continue; }

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
  const items = parseExcelToItems(buffer, uf, desonerado);
  if (items.length === 0) return { success: false, message: 'Nenhum item válido' };
  return persistItems(baseName, uf, month, year, desonerado, items);
}
