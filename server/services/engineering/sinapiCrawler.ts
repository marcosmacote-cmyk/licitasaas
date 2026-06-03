/**
 * SINAPI Crawler — Download automático via Puppeteer headless
 * Usa Chromium do sistema (Alpine: /usr/bin/chromium-browser)
 */
import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
import { prisma } from '../../lib/prisma';
import { classifyInsumoType } from './insumoClassifier';

// ═══════════════════════════════════════════════════════════
// Puppeteer portal navigation + CDP download interception
// The Caixa WAF (Azion CDN) blocks direct file URLs.
// Strategy: browse portal page first → get cookies → fetch file via CDP
// ═══════════════════════════════════════════════════════════

const PORTAL_URL = 'https://www.caixa.gov.br/poder-publico/modernizacao-gestao/sinapi/Paginas/default.aspx';

const ALL_UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
// SINAPI attributes unavailable local prices to SP in official composition costs (%AS).
const SINAPI_ATTRIBUTED_PRICE_UF = 'SP';

export async function downloadSinapiViaBrowser(uf: string, month: number, year: number, desonerado: boolean, downloadDir: string): Promise<string | null> {
  let browser: any = null;
  try {
    const puppeteerModule = require('puppeteer-core');
    const puppeteer = puppeteerModule.default ?? puppeteerModule;
    const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
    
    browser = await puppeteer.launch({
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

interface ExcelFile { fileName: string; buffer: Buffer; }

function extractExcelFromZip(zipBuffer: Buffer): ExcelFile[] {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  
  const names = entries.map((e: any) => e.entryName);
  console.log(`[SINAPI Parse] 📦 ZIP contém ${entries.length} entradas:`);
  names.forEach((n: string) => console.log(`  → ${n}`));
  
  const excels: ExcelFile[] = [];
  
  for (const entry of entries) {
    const name = (entry as any).entryName.toUpperCase();
    
    if (name.endsWith('.XLSX') && !name.startsWith('__MACOSX') && !name.includes('~$')) {
      console.log(`[SINAPI Parse] 📋 Excel: ${(entry as any).entryName} (${((entry as any).header.size / 1024).toFixed(0)} KB)`);
      excels.push({ fileName: (entry as any).entryName, buffer: (entry as any).getData() });
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
  
  excels.sort((a, b) => b.buffer.length - a.buffer.length);
  console.log(`[SINAPI Parse] ✅ ${excels.length} planilhas Excel extraídas`);
  return excels;
}

export interface ParsedItem { code: string; description: string; unit: string; price: number; type: string; }
export interface ParsedCompositionItem { parentCode: string; type: string; code: string; description: string; unit: string; quantity: number; }

function parseSinapiNumber(value: any): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const cleaned = String(value).replace(/[^\d.,\-]/g, '');
  if (!cleaned) return 0;
  return cleaned.includes(',') && (!cleaned.includes('.') || cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.'))
    ? parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0
    : parseFloat(cleaned.replace(/,/g, '')) || 0;
}

function extractSinapiCodeFromFormula(formula: any): string {
  const text = String(formula || '');
  if (!text) return '';

  const quotedArgs = [...text.matchAll(/"([^"]*\d{2,}[^"]*)"/g)]
    .map(match => match[1].replace(/\D/g, ''))
    .filter(Boolean);
  if (quotedArgs.length > 0) return quotedArgs[quotedArgs.length - 1];

  const numericArgs = [...text.matchAll(/(?:,|;)\s*([0-9]{2,})(?=\s*[),;])/g)]
    .map(match => match[1])
    .filter(Boolean);
  if (numericArgs.length > 0) return numericArgs[numericArgs.length - 1];

  const trailing = text.match(/([0-9]{2,})\s*\)?\s*$/);
  return trailing ? trailing[1] : '';
}

function readSinapiCodeCell(workbook: XLSX.WorkBook, sheetName: string, rowIndex: number, colIndex: number, rawValue: any): string {
  let code = String(rawValue ?? '').trim();
  if ((code && code !== '0' && code.length >= 2) || colIndex < 0) return code;

  const cell = workbook.Sheets[sheetName][XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })];
  const formulaCode = extractSinapiCodeFromFormula((cell as any)?.f);
  if (formulaCode) code = formulaCode;
  return code;
}

function parseExcelToItems(buffer: Buffer, uf?: string, desonerado?: boolean, fileName?: string): { items: ParsedItem[]; compositionItems: ParsedCompositionItem[] } {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true });
  const items: ParsedItem[] = [];
  const compositionItems: ParsedCompositionItem[] = [];
  const targetUf = (uf || 'CE').toUpperCase();

  console.log(`[SINAPI Parse] 📄 ${workbook.SheetNames.length} abas: ${workbook.SheetNames.join(', ')}`);

  let insumoSheets = ['IND', 'ISD', 'ICD', 'ISE'];
  let compSheets = ['CSD', 'CCD', 'CNE', 'CSE'];
  
  if (desonerado !== undefined) {
    insumoSheets = desonerado ? ['ICD'] : ['IND', 'ISD'];
    compSheets = desonerado ? ['CCD'] : ['CSD'];
  }
  
  const allTargets = [...insumoSheets, ...compSheets, 'ANALÍTICO', 'ANALITICO'];

  for (const sheetName of workbook.SheetNames) {
    const upper = sheetName.toUpperCase().trim();
    let isTarget = allTargets.includes(upper);
    let forceType: 'INSUMO' | 'COMPOSITION' | 'ANALITICO' | null = null;

    if (!isTarget && fileName) {
      const upperFile = fileName.toUpperCase();
      if (upperFile.includes('ANALITICO')) {
        isTarget = true;
        forceType = 'ANALITICO';
      } else if (upperFile.includes('SINTETICO')) {
        isTarget = true;
        forceType = 'COMPOSITION';
      } else if (upperFile.includes('INSUMOS') || upperFile.includes('PRECO_REF')) {
        isTarget = true;
        forceType = 'INSUMO';
      }
    }

    if (!isTarget) continue;

    const rows: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    if (rows.length < 5) continue;

    if (upper === 'ANALÍTICO' || upper === 'ANALITICO' || forceType === 'ANALITICO') {
      let headerIdx = -1;
      let parentCodeCol = 1, typeCol = 2, codeCol = 3, descCol = 4, unitCol = 5, qtyCol = 6;
      for (let i = 0; i < Math.min(rows.length, 30); i++) {
        const row = rows[i].map((c: any) => String(c).trim().toUpperCase());
        if (row.some((c: string) => c.includes('COEFICIENTE')) && 
            (row.includes('GRUPO') || row.includes('CODIGO ITEM') || row.includes('CÓDIGO ITEM') || 
             row.includes('CODIGO DA COMPOSICAO') || row.includes('CODIGO DA COMPOSIÇÃO') || 
             row.some(c => c.includes('CÓDIGO DO ITEM') || c.includes('CODIGO DO ITEM')))) {
          headerIdx = i;
          parentCodeCol = row.findIndex((c: string) => c.includes('COMPOSIÇÃO') || c.includes('COMPOSICAO') || c.includes('COMPOSIC'));
          typeCol = row.findIndex((c: string) => c.includes('TIPO ITEM') || c.includes('TIPO'));
          codeCol = row.findIndex((c: string) => c.includes('CÓDIGO DO ITEM') || c.includes('CÓDIGO DO\r\nITEM') || c.includes('CODIGO ITEM') || c.includes('CÓDIGO ITEM') || c.includes('CODIGO DO ITEM'));
          descCol = row.findIndex((c: string) => c === 'DESCRIÇÃO' || c === 'DESCRIÇÃO ITEM' || c === 'DESCRICAO ITEM' || c.includes('DESCRIÇÃO DO ITEM'));
          unitCol = row.findIndex((c: string) => c === 'UNIDADE' || c === 'UNIDADE ITEM' || c === 'UNIDADE DE MEDIDA');
          qtyCol = row.findIndex((c: string) => c === 'COEFICIENTE');
          break;
        }
      }
      
      if (headerIdx >= 0) {
        let count = 0;
        let currentParentCode = '';
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const r = rows[i];
          const explicitParentCode = readSinapiCodeCell(workbook, sheetName, i, parentCodeCol, r[parentCodeCol]);
          if (explicitParentCode && explicitParentCode !== '0') currentParentCode = explicitParentCode;
          const parentCode = explicitParentCode || currentParentCode;
          const code = readSinapiCodeCell(workbook, sheetName, i, codeCol, r[codeCol]);
          if (!parentCode || !code || code === '0') continue;
          
          const rawType = String(r[typeCol] ?? '').trim().toUpperCase();
          const description = String(r[descCol] ?? '').trim();
          const unit = String(r[unitCol] ?? '').trim() || 'UN';
          const groupHint = rawType.includes('COMPOS') ? 'SERVICO' : undefined;
          const classification = classifyInsumoType(description, unit, groupHint);
          const type = rawType.includes('COMPOS') ? 'SERVICO' : classification.type;
          
          let qty = 0;
          const rawQty = r[qtyCol];
          if (typeof rawQty === 'number') qty = rawQty;
          else if (rawQty) {
            const c = String(rawQty).replace(/[^\d.,\-]/g, '');
            if (c) qty = parseFloat(c.replace(',', '.')) || 0;
          }
          if (qty <= 0) continue;
          
          compositionItems.push({ parentCode, type, code, description, unit, quantity: qty });
          count++;
        }
        console.log(`[SINAPI Parse] ✅ Aba "${sheetName}" (Analítico): ${count} itens de composição parseados`);
      }
      continue;
    }

    const isComposition = forceType === 'COMPOSITION' || compSheets.includes(upper);

    // Find the header row
    let headerIdx = -1, ufColIdx = -1, fallbackUfColIdx = -1;
    let codeCol = -1, descCol = -1, unitCol = -1, groupCol = -1;

    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const row = rows[i].map((c: any) => String(c).trim().toUpperCase());
      
      const isPre2025SinteticoHeader = row.some(c => c.includes('CODIGO  DA COMPOSICAO') || c.includes('CODIGO DA COMPOSICAO')) && row.includes('CUSTO TOTAL');
      const isPre2025InsumoHeader = row.some(c => c.includes('DESCRICAO DO INSUMO') || c.includes('PRECO MEDIANO R$') || c.includes('PREÇO MEDIANO R$'));
      
      const ceIdx = row.indexOf(targetUf);
      const isNationalHeader = ceIdx >= 0 && (row.includes('CODIGO') || row.includes('CÓDIGO') || row.includes('CODIGO  ') || row.includes('CODIGO DA COMPOSICAO') || row.includes('CODIGO  DA COMPOSICAO'));

      if (isPre2025SinteticoHeader || isPre2025InsumoHeader || isNationalHeader) {
        headerIdx = i;
        
        if (isPre2025SinteticoHeader) {
          ufColIdx = row.findIndex(c => c.includes('CUSTO TOTAL'));
          codeCol = row.findIndex(c => c.includes('CODIGO  DA COMPOSICAO') || c.includes('CODIGO DA COMPOSICAO'));
          descCol = row.findIndex(c => c.includes('DESCRICAO DA COMPOSICAO') || c.includes('DESCRIÇÃO DA COMPOSIÇÃO'));
          unitCol = row.findIndex(c => c === 'UNIDADE');
          groupCol = row.findIndex(c => c.includes('GRUPO') || c.includes('TIPO') || c.includes('CLASSIFICAÇÃO') || c.includes('CLASSE'));
        } else if (isPre2025InsumoHeader) {
          ufColIdx = row.findIndex(c => c.includes('PRECO MEDIANO') || c.includes('PREÇO MEDIANO') || c.includes('PRECO MEDIANO R$') || c.includes('PREÇO MEDIANO R$'));
          if (ufColIdx < 0) ufColIdx = 4;
          codeCol = row.findIndex(c => c.includes('CODIGO'));
          descCol = row.findIndex(c => c.includes('DESCRICAO DO INSUMO') || c.includes('DESCRIÇÃO DO INSUMO'));
          unitCol = row.findIndex(c => c.includes('UNIDADE DE MEDIDA') || c.includes('UNIDADE'));
          groupCol = row.findIndex(c => c.includes('GRUPO') || c.includes('TIPO') || c.includes('CLASSIFICAÇÃO') || c.includes('FAMILIA') || c.includes('FAMÍLIA'));
        } else {
          // National format
          ufColIdx = ceIdx;
          fallbackUfColIdx = row.indexOf(SINAPI_ATTRIBUTED_PRICE_UF);
          
          for (let j = Math.max(0, i - 3); j <= i; j++) {
            const r2 = rows[j].map((c: any) => String(c).trim().toUpperCase());
            if (codeCol < 0) codeCol = r2.findIndex((c: string) => c.includes('CODIGO') || c.includes('CÓDIGO') || c === 'CÓDIGO SINAPI' || c.includes('COMPOSIÇÃO') || c.includes('COMPOSICAO'));
            if (descCol < 0) descCol = r2.findIndex((c: string) => c.includes('DESCRI'));
            if (unitCol < 0) unitCol = r2.findIndex((c: string) => c.includes('UNID') || c === 'UN' || c === 'UNIDADE');
            if (groupCol < 0) groupCol = r2.findIndex((c: string) => c.includes('GRUPO') || c.includes('TIPO') || c.includes('CLASSIFICAÇÃO'));
          }
        }
        break;
      }
    }

    if (headerIdx < 0 || ufColIdx < 0) {
      console.log(`[SINAPI Parse] ⚠️ Aba "${sheetName}": colunas de preço ou cabeçalho não encontrados`);
      continue;
    }

    if (codeCol < 0) codeCol = 1;
    if (descCol < 0) descCol = codeCol + 1;
    if (unitCol < 0) unitCol = codeCol + 2;

    console.log(`[SINAPI Parse] 🎯 Aba "${sheetName}": UFCol=${ufColIdx}, códigoCol=${codeCol}, descCol=${descCol}, unidCol=${unitCol}`);

    let count = 0;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const code = readSinapiCodeCell(workbook, sheetName, i, codeCol, r[codeCol]);
      const desc = String(r[descCol] ?? '').trim();
      const unit = String(r[unitCol] ?? '').trim().toUpperCase() || 'UN';
      if (!code || !desc || code.length < 2 || code === '0') continue;

      const localPrice = parseSinapiNumber(r[ufColIdx]);
      const attributedPrice = !isComposition && fallbackUfColIdx >= 0
        ? parseSinapiNumber(r[fallbackUfColIdx])
        : 0;
      const price = localPrice > 0 ? localPrice : attributedPrice;
      if (price <= 0) continue;

      const group = groupCol >= 0 ? String(r[groupCol] ?? '').toUpperCase() : '';
      let groupType: string | undefined;
      if (group.includes('MÃO') || group.includes('MAO') || group.includes('OBRA')) groupType = 'MAO_DE_OBRA';
      else if (group.includes('EQUIP')) groupType = 'EQUIPAMENTO';
      else if (group.includes('COMPOS') || group.includes('SERV')) groupType = 'SERVICO';
      else if (group.includes('MATERIAL') || group.includes('INSUMO')) groupType = 'MATERIAL';
      
      const classification = classifyInsumoType(desc, unit, groupType);
      const type = isComposition ? 'SERVICO' : (groupType || classification.type);

      items.push({ code, description: desc, unit, price, type });
      count++;
    }
    console.log(`[SINAPI Parse] ✅ Aba "${sheetName}": ${count} itens extraídos`);
  }

  return { items, compositionItems };
}

// ═══════════════════════════════════════════════════════════
// Database Persistence
// ═══════════════════════════════════════════════════════════

interface SyncResult { success: boolean; message: string; databaseId?: string; itemCount?: number; compositionCount?: number; }

async function getAnalyticalCoverage(databaseId: string): Promise<{ total: number; incomplete: number; worstCoverage: number }> {
  const rows: Array<{ total: any; incomplete: any; worstCoverage: any }> = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE c."totalPrice" > 0
          AND COALESCE(ci.total, 0) < (c."totalPrice" * 0.85)
      )::int AS incomplete,
      COALESCE(MIN(
        CASE
          WHEN c."totalPrice" > 0 THEN COALESCE(ci.total, 0) / c."totalPrice"
          ELSE 1
        END
      ), 1)::float AS "worstCoverage"
    FROM "EngineeringComposition" c
    LEFT JOIN (
      SELECT ci."compositionId", SUM(ci.price) AS total
      FROM "EngineeringCompositionItem" ci
      INNER JOIN "EngineeringComposition" comp ON comp.id = ci."compositionId"
      WHERE comp."databaseId" = ${databaseId}
      GROUP BY ci."compositionId"
    ) ci ON ci."compositionId" = c.id
    WHERE c."databaseId" = ${databaseId}
  `;
  const row = rows[0] || { total: 0, incomplete: 0, worstCoverage: 1 };
  return {
    total: Number(row.total) || 0,
    incomplete: Number(row.incomplete) || 0,
    worstCoverage: Number(row.worstCoverage) || 1,
  };
}

async function hasCompleteAnalyticalCoverage(databaseId: string): Promise<boolean> {
  const db = await prisma.engineeringDatabase.findUnique({
    where: { id: databaseId },
    select: { itemCount: true, compositionCount: true }
  });
  if (db && db.itemCount >= 4000 && db.compositionCount >= 7000) {
    return true;
  }
  const hasDeps = await prisma.engineeringCompositionItem.findFirst({
    where: { composition: { databaseId } },
    select: { id: true }
  });
  if (!hasDeps) return false;
  const coverage = await getAnalyticalCoverage(databaseId);
  return coverage.incomplete === 0;
}

export function toCanonicalCode(code: string): string {
  const raw = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
  const numeric = raw.match(/^0*(\d+)$/);
  return numeric ? numeric[1] : raw;
}

function buildSinapiCodeVariants(code: string): string[] {
  const canonical = toCanonicalCode(code);
  return canonical ? [canonical] : [];
}

function setCodeVariants<T>(map: Map<string, T>, code: string, value: T) {
  const canonical = toCanonicalCode(code);
  if (canonical && !map.has(canonical)) map.set(canonical, value);
}

function getByCodeVariants<T>(map: Map<string, T>, code: string): T | undefined {
  const canonical = toCanonicalCode(code);
  return canonical ? map.get(canonical) : undefined;
}

async function persistItems(baseName: string, uf: string, month: number, year: number, desonerado: boolean, data: { items: ParsedItem[]; compositionItems: ParsedCompositionItem[] }): Promise<SyncResult> {
  const version = `${String(month).padStart(2, '0')}/${year}`;
  const regime = desonerado ? 'Desonerado' : 'Onerado';

  let db = await prisma.engineeringDatabase.findFirst({
    where: { name: baseName, uf, referenceMonth: month, referenceYear: year, payrollExemption: desonerado, type: 'OFICIAL' }
  });

  if (db) {
    await prisma.engineeringComposition.deleteMany({ where: { databaseId: db.id } });
    await prisma.engineeringItem.deleteMany({ where: { databaseId: db.id } });
  } else {
    db = await prisma.engineeringDatabase.create({
      data: { name: baseName, uf, version, type: 'OFICIAL', payrollExemption: desonerado, referenceMonth: month, referenceYear: year }
    });
  }

  const basicItems = data.items.filter(it => it.type !== 'SERVICO');
  const serviceItems = data.items.filter(it => it.type === 'SERVICO');

  const compCodes = new Set<string>();
  for (const s of serviceItems) compCodes.add(toCanonicalCode(s.code));

  const itemCodes = new Set<string>();
  for (const i of basicItems) itemCodes.add(toCanonicalCode(i.code));

  const basicItemsMap = new Map<string, ParsedItem>();
  for (const it of basicItems) basicItemsMap.set(toCanonicalCode(it.code), it);

  const priceMap = new Map<string, number>();
  for (const it of data.items) priceMap.set(toCanonicalCode(it.code), it.price);

  const parentPrices = new Map<string, number>();
  for (const s of serviceItems) parentPrices.set(toCanonicalCode(s.code), s.price);

  const repairedKeys = new Set<string>();

  // 1. Resolve prices of missing items (órfãos) completely in-memory
  if (data.compositionItems && data.compositionItems.length > 0) {
    const resolvedTotalByParent = new Map<string, number>();
    const unresolvedByParent = new Map<string, ParsedCompositionItem[]>();

    // Step 1a: Group composition items and compute resolved totals
    for (const ci of data.compositionItems) {
      const parentKey = toCanonicalCode(ci.parentCode);
      const childKey = toCanonicalCode(ci.code);
      const isSvc = ci.type === 'SERVICO';

      const exists = isSvc ? compCodes.has(childKey) : itemCodes.has(childKey);
      if (exists) {
        const unitPrice = priceMap.get(childKey) || 0;
        resolvedTotalByParent.set(parentKey, (resolvedTotalByParent.get(parentKey) || 0) + unitPrice * ci.quantity);
      } else {
        if (!isSvc) {
          if (!unresolvedByParent.has(parentKey)) unresolvedByParent.set(parentKey, []);
          unresolvedByParent.get(parentKey)!.push(ci);
        }
      }
    }

    // Step 1b: Resolve prices for parents with exactly 1 unresolved child
    for (const [parentKey, unresolvedList] of unresolvedByParent.entries()) {
      if (unresolvedList.length !== 1) continue;
      const ci = unresolvedList[0];
      const childKey = toCanonicalCode(ci.code);
      const parentTotal = parentPrices.get(parentKey) || 0;
      const resolvedTotal = resolvedTotalByParent.get(parentKey) || 0;
      const residual = parentTotal - resolvedTotal;
      const unitPrice = ci.quantity > 0 && residual > 0.01 ? residual / ci.quantity : 0;

      if (unitPrice > 0) {
        priceMap.set(childKey, unitPrice);
        repairedKeys.add(childKey);

        const existingItem = basicItemsMap.get(childKey);
        if (existingItem) {
          if (existingItem.price <= 0.01) existingItem.price = unitPrice;
        } else {
          const newItem: ParsedItem = {
            code: ci.code,
            description: ci.description || `Insumo SINAPI ${ci.code}`,
            unit: ci.unit || 'UN',
            price: unitPrice,
            type: ci.type || 'MATERIAL'
          };
          basicItems.push(newItem);
          basicItemsMap.set(childKey, newItem);
          itemCodes.add(childKey);
        }
      }
    }
  }

  const itemIdMap = new Map<string, string>();
  const compIdMap = new Map<string, string>();

  // Pre-generate UUIDs for basic items in memory
  const basicItemsWithIds = basicItems.map(it => {
    const id = randomUUID();
    itemIdMap.set(toCanonicalCode(it.code), id);
    return {
      id,
      databaseId: db!.id,
      code: it.code,
      description: it.description,
      unit: it.unit,
      price: it.price,
      type: it.type
    };
  });

  // Pre-generate UUIDs for compositions in memory
  const serviceItemsWithIds = serviceItems.map(svc => {
    const id = randomUUID();
    compIdMap.set(toCanonicalCode(svc.code), id);
    return {
      id,
      databaseId: db!.id,
      code: svc.code,
      description: svc.description,
      unit: svc.unit,
      totalPrice: svc.price
    };
  });

  // 2. Bulk insert all basic items (now including computed órfãos!)
  let insertedItems = 0;
  for (let i = 0; i < basicItemsWithIds.length; i += 5000) {
    const r = await prisma.engineeringItem.createMany({
      data: basicItemsWithIds.slice(i, i + 5000),
      skipDuplicates: true
    });
    insertedItems += r.count;
  }

  // 3. Bulk insert all compositions
  let insertedComps = 0;
  for (let i = 0; i < serviceItemsWithIds.length; i += 8000) {
    const chunk = serviceItemsWithIds.slice(i, i + 8000);
    const r = await prisma.engineeringComposition.createMany({
      data: chunk,
      skipDuplicates: true
    });
    insertedComps += r.count;
  }

  // 4. Bulk insert all composition items (in-memory lookup, zero database calls)
  let insertedCompItems = 0;
  if (data.compositionItems && data.compositionItems.length > 0) {
    const dbCompItems = [];
    let unresolvedCompItems = 0;
    let unresolvedParents = 0;
    let repairedResidualItems = 0;

    for (const ci of data.compositionItems) {
      const parentId = compIdMap.get(toCanonicalCode(ci.parentCode));
      if (!parentId) {
        unresolvedParents++;
        continue;
      }

      const childKey = toCanonicalCode(ci.code);
      const unitPrice = priceMap.get(childKey) || 0;
      const totalPrice = unitPrice * ci.quantity;

      const isSvc = ci.type === 'SERVICO';
      const itemId = isSvc ? null : (itemIdMap.get(childKey) || null);
      const auxCompId = isSvc ? (compIdMap.get(childKey) || null) : null;

      if (!itemId && !auxCompId) {
        unresolvedCompItems++;
        continue;
      }

      if (!isSvc && repairedKeys.has(childKey) && itemId) {
        repairedResidualItems++;
      }

      dbCompItems.push({
        compositionId: parentId,
        itemId,
        auxiliaryCompositionId: auxCompId,
        coefficient: ci.quantity,
        price: totalPrice
      });
    }

    for (let i = 0; i < dbCompItems.length; i += 10000) {
      const chunk = dbCompItems.slice(i, i + 10000);
      const r = await prisma.engineeringCompositionItem.createMany({ data: chunk, skipDuplicates: true });
      insertedCompItems += r.count;
    }

    if (unresolvedParents > 0 || unresolvedCompItems > 0) {
      console.warn(
        `[SINAPI Crawler] ⚠️ ${baseName} ${uf} ${version} ${regime}: ` +
        `${unresolvedParents} dependência(s) sem composição-pai, ${unresolvedCompItems} sem insumo/composição vinculável ` +
        `e ${repairedResidualItems} reparada(s) por residual da CPU`
      );
    }
  }

  await prisma.engineeringDatabase.update({ where: { id: db!.id }, data: { itemCount: insertedItems, compositionCount: insertedComps } });
  const coverage = await getAnalyticalCoverage(db!.id);
  if (coverage.incomplete > 0) {
    console.warn(
      `[SINAPI Crawler] ⚠️ ${baseName} ${uf} ${version} ${regime}: ` +
      `${coverage.incomplete}/${coverage.total} composição(ões) com soma analítica abaixo de 85% do preço sintético ` +
      `(pior cobertura ${(coverage.worstCoverage * 100).toFixed(1)}%).`
    );
  }
  console.log(`[SINAPI Crawler] ✅ ${baseName} ${uf} ${version} ${regime}: ${insertedItems} insumos + ${insertedComps} composições + ${insertedCompItems} dependências`);
  return { success: true, message: `${baseName} ${uf} ${version} ${regime}: ${insertedItems} insumos + ${insertedComps} composições`, databaseId: db!.id, itemCount: insertedItems, compositionCount: insertedComps };
}

async function persistItemsWithRetry(
  baseName: string,
  uf: string,
  month: number,
  year: number,
  desonerado: boolean,
  data: { items: ParsedItem[]; compositionItems: ParsedCompositionItem[] },
  retries = 5
): Promise<SyncResult> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await persistItems(baseName, uf, month, year, desonerado, data);
    } catch (err: any) {
      console.warn(`[SINAPI Crawler] ⚠️ Erro ao persistir ${uf} (${attempt}/${retries}): ${err.message || err}`);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 30000 * attempt));
      await prisma.$connect().catch(() => {});
    }
  }
  throw new Error('Unreachable code');
}

// ═══════════════════════════════════════════════════════════
// Main Orchestrator
// ═══════════════════════════════════════════════════════════

export interface SyncOptions {
  ufs: string[];
  months: number;
  includeDesonerado: boolean;
  baseName?: string;
  force?: boolean;
  targetPeriods?: { month: number; year: number }[];
}
export interface SyncReport { started: string; finished: string; totalAttempted: number; totalSuccess: number; totalFailed: number; results: SyncResult[]; }

/** Parse national 2025+ Excel extracting ALL UF columns at once */
export function parseExcelAllUFs(buffer: Buffer, desonerado?: boolean): Map<string, { items: ParsedItem[]; compositionItems: ParsedCompositionItem[] }> {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true });
  const result = new Map<string, { items: ParsedItem[]; compositionItems: ParsedCompositionItem[] }>();
  for (const uf of ALL_UFS) result.set(uf, { items: [], compositionItems: [] });

  let insumoSheets = ['IND', 'ISD', 'ICD', 'ISE'];
  let compSheets = ['CSD', 'CCD', 'CNE', 'CSE'];
  if (desonerado !== undefined) {
    insumoSheets = desonerado ? ['ICD'] : ['IND', 'ISD'];
    compSheets = desonerado ? ['CCD'] : ['CSD'];
  }
  const allTargets = [...insumoSheets, ...compSheets];

  for (const sheetName of workbook.SheetNames) {
    const upper = sheetName.toUpperCase().trim();
    if (!allTargets.includes(upper)) continue;
    const isComposition = compSheets.includes(upper);
    const rows: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    if (rows.length < 5) continue;

    // Find header row — detect ALL UF columns at once
    let headerIdx = -1;
    let codeCol = -1, descCol = -1, unitCol = -1, groupCol = -1;
    const ufColMap: Record<string, number> = {};

    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const row = rows[i].map((c: any) => String(c).trim().toUpperCase());
      const foundUfs = ALL_UFS.filter(uf => row.indexOf(uf) >= 0);
      if (foundUfs.length >= 10) { // National sheet has 27 UF columns
        headerIdx = i;
        for (const uf of ALL_UFS) { const idx = row.indexOf(uf); if (idx >= 0) ufColMap[uf] = idx; }
        for (let j = Math.max(0, i - 3); j <= i; j++) {
          const r2 = rows[j].map((c: any) => String(c).trim().toUpperCase());
          if (codeCol < 0) codeCol = r2.findIndex((c: string) => c.includes('CODIGO') || c.includes('CÓDIGO') || c.includes('COMPOSIÇÃO'));
          if (descCol < 0) descCol = r2.findIndex((c: string) => c.includes('DESCRI'));
          if (unitCol < 0) unitCol = r2.findIndex((c: string) => c.includes('UNID') || c === 'UN' || c === 'UNIDADE');
          if (groupCol < 0) groupCol = r2.findIndex((c: string) => c.includes('GRUPO') || c.includes('TIPO') || c.includes('CLASSIFICAÇÃO'));
        }
        break;
      }
    }

    if (headerIdx < 0 || Object.keys(ufColMap).length === 0) continue;
    if (codeCol < 0) codeCol = 1;
    if (descCol < 0) descCol = codeCol + 1;
    if (unitCol < 0) unitCol = codeCol + 2;

    console.log(`[SINAPI Parse] 🌎 Aba "${sheetName}": ${Object.keys(ufColMap).length} UFs detectadas, parsing multi-UF...`);

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const code = readSinapiCodeCell(workbook, sheetName, i, codeCol, r[codeCol]);
      const desc = String(r[descCol] ?? '').trim();
      const unit = String(r[unitCol] ?? '').trim().toUpperCase() || 'UN';
      if (!code || !desc || code.length < 2 || code === '0') continue;

      const group = String(r[groupCol] ?? '').toUpperCase();
      let groupType: string | undefined;
      if (group.includes('MÃO') || group.includes('MAO') || group.includes('OBRA')) groupType = 'MAO_DE_OBRA';
      else if (group.includes('EQUIP')) groupType = 'EQUIPAMENTO';
      else if (group.includes('COMPOS') || group.includes('SERV')) groupType = 'SERVICO';
      else if (group.includes('MATERIAL') || group.includes('INSUMO')) groupType = 'MATERIAL';
      const classification = classifyInsumoType(desc, unit, groupType);
      const type = isComposition ? 'SERVICO' : (groupType || classification.type);

      const attributedPrice = !isComposition && ufColMap[SINAPI_ATTRIBUTED_PRICE_UF] !== undefined
        ? parseSinapiNumber(r[ufColMap[SINAPI_ATTRIBUTED_PRICE_UF]])
        : 0;
      for (const [uf, colIdx] of Object.entries(ufColMap)) {
        const localPrice = parseSinapiNumber(r[colIdx]);
        const price = localPrice > 0 || uf === SINAPI_ATTRIBUTED_PRICE_UF ? localPrice : attributedPrice;
        if (price <= 0) continue;
        result.get(uf)!.items.push({ code, description: desc, unit, price, type });
      }
    }
  }

  // Also parse ANALÍTICO sheet for composition items (UF-independent coefficients)
  for (const sheetName of workbook.SheetNames) {
    const upper = sheetName.toUpperCase().trim();
    if (upper !== 'ANALÍTICO' && upper !== 'ANALITICO') continue;
    const rows: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    let headerIdx = -1, parentCodeCol = 1, typeCol = 2, ccodeCol = 3, cdescCol = 4, cunitCol = 5, qtyCol = 6;
    const analyticalUfColMap: Record<string, number> = {};
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const row = rows[i].map((c: any) => String(c).trim().toUpperCase());
      if (row.includes('GRUPO') && row.some((c: string) => c.includes('COEFICIENTE'))) {
        headerIdx = i;
        parentCodeCol = row.findIndex((c: string) => c.includes('COMPOSIÇÃO'));
        typeCol = row.findIndex((c: string) => c.includes('TIPO ITEM'));
        ccodeCol = row.findIndex((c: string) => c.includes('CÓDIGO DO ITEM') || c.includes('CÓDIGO DO\r\nITEM'));
        cdescCol = row.findIndex((c: string) => c === 'DESCRIÇÃO');
        cunitCol = row.findIndex((c: string) => c === 'UNIDADE');
        qtyCol = row.findIndex((c: string) => c === 'COEFICIENTE');
        for (let j = Math.max(0, i - 3); j <= i; j++) {
          const headerRow = rows[j].map((c: any) => String(c).trim().toUpperCase());
          for (const uf of ALL_UFS) {
            const idx = headerRow.indexOf(uf);
            if (idx >= 0) analyticalUfColMap[uf] = idx;
          }
        }
        break;
      }
    }
    if (headerIdx < 0) continue;
    const compItems: ParsedCompositionItem[] = [];
    let analyticalPriceItems = 0;
    let currentParentCode = '';
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const explicitParentCode = readSinapiCodeCell(workbook, sheetName, i, parentCodeCol, r[parentCodeCol]);
      if (explicitParentCode && explicitParentCode !== '0') currentParentCode = explicitParentCode;
      const parentCode = explicitParentCode || currentParentCode;
      const code = readSinapiCodeCell(workbook, sheetName, i, ccodeCol, r[ccodeCol]);
      if (!parentCode || !code || code === '0') continue;
      const rawType = String(r[typeCol] ?? '').trim().toUpperCase();
      const description = String(r[cdescCol] ?? '').trim();
      const unit = String(r[cunitCol] ?? '').trim() || 'UN';
      const groupHint = rawType.includes('COMPOS') ? 'SERVICO' : undefined;
      const classification = classifyInsumoType(description, unit, groupHint);
      const type = rawType.includes('COMPOS') ? 'SERVICO' : classification.type;
      const qty = parseSinapiNumber(r[qtyCol]);
      if (qty <= 0) continue;
      compItems.push({ parentCode, type, code, description, unit, quantity: qty });

      // Some SINAPI national analytical rows carry the priced child item by UF
      // even when that child is absent or unpriced in the synthetic item sheet.
      // Capture those prices too so dependencies such as 00004813 do not become
      // unresolved/invisible in the CPU.
      for (const [uf, colIdx] of Object.entries(analyticalUfColMap)) {
        const price = parseSinapiNumber(r[colIdx]);
        if (price <= 0 || !description) continue;
        result.get(uf)!.items.push({ code, description, unit, price, type });
        analyticalPriceItems++;
      }
    }
    // Share composition items across all UFs (coefficients are universal)
    for (const uf of ALL_UFS) result.get(uf)!.compositionItems.push(...compItems);
    console.log(`[SINAPI Parse] ✅ Analítico: ${compItems.length} itens de composição (compartilhados entre ${ALL_UFS.length} UFs) + ${analyticalPriceItems} preço(s) por UF`);
  }

  return result;
}

export async function syncSinapi(options: SyncOptions): Promise<SyncReport> {
  const { ufs: requestedUfs, months, includeDesonerado, baseName = 'SINAPI', force = false } = options;
  const isAllUfs = requestedUfs.includes('ALL') || requestedUfs.length >= 27;
  const ufs = isAllUfs ? ALL_UFS : requestedUfs;
  const started = new Date().toISOString();
  const results: SyncResult[] = [];
  const now = new Date();
  const targetMonths: { month: number; year: number }[] = [];
  if (Array.isArray(options.targetPeriods) && options.targetPeriods.length > 0) {
    for (const period of options.targetPeriods) {
      const month = Number(period.month);
      const year = Number(period.year);
      if (month >= 1 && month <= 12 && year >= 2009 && year <= now.getFullYear() + 1) {
        targetMonths.push({ month, year });
      }
    }
  }
  if (targetMonths.length === 0) {
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      targetMonths.push({ month: d.getMonth() + 1, year: d.getFullYear() });
    }
  }

  console.log(`[SINAPI Crawler] 🚀 Sync: ${isAllUfs ? 'ALL (27 UFs)' : ufs.join(',')} × ${months} meses`);

  // For 2025+ national format: download once, extract all UFs
  for (const { month, year } of targetMonths) {
    if (year >= 2025 && isAllUfs) {
      const regimesNeeded: boolean[] = [];
      const regimesToCheck = includeDesonerado ? [false, true] : [false];
      
      for (const desonerado of regimesToCheck) {
        const existingDbs = force ? [] : await prisma.engineeringDatabase.findMany({
          where: {
            name: baseName,
            referenceMonth: month,
            referenceYear: year,
            payrollExemption: desonerado,
            type: 'OFICIAL',
            itemCount: { gt: 0 },
            compositionCount: { gt: 0 },
          },
          select: { id: true },
        });
        let existingCount = 0;
        for (const existingDb of existingDbs) {
          if (await hasCompleteAnalyticalCoverage(existingDb.id)) existingCount++;
        }
        if (existingCount < 27) {
          regimesNeeded.push(desonerado);
        } else {
          const regimeLabel = desonerado ? 'Desonerado' : 'Onerado';
          console.log(`[SINAPI Crawler] ⏭️ ${String(month).padStart(2, '0')}/${year} ${regimeLabel}: ${existingCount}/27 UFs já completas`);
        }
      }

      if (regimesNeeded.length === 0) continue;

      const version = `${String(month).padStart(2, '0')}/${year}`;
      console.log(`\n[SINAPI Crawler] 📥 Nacional ${version} (Requer regimes: ${regimesNeeded.map(r => r ? 'Desonerado' : 'Onerado').join(', ')})`);
      
      let zipBuffer: Buffer | null = null;
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sinapi-'));
      try {
        const filePath = await downloadSinapiViaBrowser('CE', month, year, false, tmpDir);
        if (filePath && fs.existsSync(filePath)) {
          const buf = fs.readFileSync(filePath);
          if (buf.length > 100 && buf[0] === 0x50 && buf[1] === 0x4B) zipBuffer = buf;
        }
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }

      if (!zipBuffer) {
        console.log(`[SINAPI Crawler] ❌ Download falhou: ${version}`);
        for (const desonerado of regimesNeeded) {
          results.push({ success: false, message: `Download falhou: ${version} ${desonerado ? 'Desonerado' : 'Onerado'}` });
        }
        continue;
      }

      const excels = extractExcelFromZip(zipBuffer);
      if (excels.length === 0) {
        for (const desonerado of regimesNeeded) {
          results.push({ success: false, message: `ZIP sem Excel: ${version} ${desonerado ? 'Desonerado' : 'Onerado'}` });
        }
        continue;
      }

      for (const desonerado of regimesNeeded) {
        const regime = desonerado ? 'Desonerado' : 'Onerado';
        console.log(`[SINAPI Crawler] 🌎 Parsing multi-UF para regime ${regime} (${excels.length} planilhas)...`);
        
        const allUfData = new Map<string, { items: ParsedItem[]; compositionItems: ParsedCompositionItem[] }>();
        for (const uf of ALL_UFS) allUfData.set(uf, { items: [], compositionItems: [] });

        for (const file of excels) {
          const ufData = parseExcelAllUFs(file.buffer, desonerado);
          for (const [uf, data] of ufData.entries()) {
            const existing = allUfData.get(uf)!;
            existing.items.push(...data.items);
            existing.compositionItems.push(...data.compositionItems);
          }
        }

        const ufList = ALL_UFS.filter(uf => allUfData.get(uf)!.items.length > 0);

        // Process UFs sequentially (chunkSize = 1) to avoid Postgres index locks and proxy bottlenecks
        const chunkSize = 1;
        for (let i = 0; i < ufList.length; i += chunkSize) {
          const chunk = ufList.slice(i, i + chunkSize);
          await Promise.all(chunk.map(async (uf) => {
            const data = allUfData.get(uf)!;
            const ex = force ? null : await prisma.engineeringDatabase.findFirst({
              where: {
                name: baseName,
                uf,
                referenceMonth: month,
                referenceYear: year,
                payrollExemption: desonerado,
                type: 'OFICIAL',
                itemCount: { gt: 0 },
                compositionCount: { gt: 0 },
              }
            });
            if (ex && await hasCompleteAnalyticalCoverage(ex.id)) {
              results.push({ success: true, message: `Já existente: ${uf} ${regime}` });
              return;
            }
            
            const res = await persistItemsWithRetry(baseName, uf, month, year, desonerado, data);
            results.push(res);
          }));
        }

        // Handle UFs with no data
        for (const uf of ALL_UFS) {
          if (allUfData.get(uf)!.items.length === 0) {
            results.push({ success: false, message: `${uf}: sem dados` });
          }
        }
      }
      
      await new Promise(r => setTimeout(r, 3000));
      continue; // Skip per-UF loop for this month
    }
  }

  // Per-UF loop (pre-2025 or specific UFs)
  for (const uf of ufs) {
    for (const { month, year } of targetMonths) {
      if (year >= 2025 && isAllUfs) continue; // Already handled above
      const regimes = includeDesonerado ? [false, true] : [false];
      for (const desonerado of regimes) {
        const regime = desonerado ? 'Desonerado' : 'Onerado';
        const version = `${String(month).padStart(2, '0')}/${year}`;

        // Idempotency check: require both items and compositions to consider it fully synced
        const existing = await prisma.engineeringDatabase.findFirst({
          where: { name: baseName, uf, referenceMonth: month, referenceYear: year, payrollExemption: desonerado, type: 'OFICIAL' }
        });
        
        let hasCompleteCoverage = false;
        if (existing) {
          hasCompleteCoverage = await hasCompleteAnalyticalCoverage(existing.id);
        }

        if (!force && existing && existing.itemCount > 0 && existing.compositionCount > 0 && hasCompleteCoverage) { 
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
        const allExtracted = excels.map(item => parseExcelToItems(item.buffer, uf, desonerado, item.fileName));
        const allItems = allExtracted.flatMap(e => e.items);
        const allCompItems = allExtracted.flatMap(e => e.compositionItems);
        
        console.log(`[SINAPI Crawler] 📊 Total de itens parseados: ${allItems.length}, dependências: ${allCompItems.length}`);
        if (allItems.length === 0) { console.log(`[SINAPI Crawler] ❌ Nenhum item válido encontrado`); results.push({ success: false, message: `Nenhum item válido` }); continue; }

        results.push(await persistItemsWithRetry(baseName, uf, month, year, desonerado, { items: allItems, compositionItems: allCompItems }));
        await new Promise(r => setTimeout(r, 3000)); // Respect rate limits
      }
    }
  }

  const finished = new Date().toISOString();
  console.log(`\n[SINAPI Crawler] 🏁 ${results.filter(r => r.success).length}/${results.length} sucesso`);
  return { started, finished, totalAttempted: results.length, totalSuccess: results.filter(r => r.success).length, totalFailed: results.filter(r => !r.success).length, results };
}

export async function importFromBuffer(buffer: Buffer, baseName: string, uf: string, month: number, year: number, desonerado: boolean): Promise<SyncResult> {
  const data = parseExcelToItems(buffer, uf, desonerado);
  if (data.items.length === 0) return { success: false, message: 'Nenhum item válido' };
  return persistItems(baseName, uf, month, year, desonerado, data);
}
