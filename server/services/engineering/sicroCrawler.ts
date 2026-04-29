/**
 * SICRO Crawler — Download automático de relatórios SICRO (DNIT)
 * Portal: https://www.gov.br/dnit/pt-br/.../sicro/relatorios-sicro
 * Formato: .7z contendo planilhas Excel
 * Sem necessidade de Puppeteer — download direto via HTTP
 */
import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { prisma } from '../../lib/prisma';
import { execSync } from 'child_process';

// ═══════════════════════════════════════════════════════════
// UFs and Regions mapping for SICRO portal URL structure
// ═══════════════════════════════════════════════════════════
const SICRO_UF_MAP: Record<string, { region: string; slug: string; code: string }> = {
  'AC': { region: 'norte', slug: 'acre', code: 'AC' },
  'AL': { region: 'nordeste', slug: 'alagoas', code: 'AL' },
  'AM': { region: 'norte', slug: 'amazonas', code: 'AM' },
  'AP': { region: 'norte', slug: 'amapa', code: 'AP' },
  'BA': { region: 'nordeste', slug: 'bahia', code: 'BA' },
  'CE': { region: 'nordeste', slug: 'ceara', code: 'CE' },
  'DF': { region: 'centro-oeste', slug: 'distrito-federal', code: 'DF' },
  'ES': { region: 'sudeste', slug: 'espirito-santo', code: 'ES' },
  'GO': { region: 'centro-oeste', slug: 'goias', code: 'GO' },
  'MA': { region: 'nordeste', slug: 'maranhao', code: 'MA' },
  'MG': { region: 'sudeste', slug: 'minas-gerais', code: 'MG' },
  'MS': { region: 'centro-oeste', slug: 'mato-grosso-do-sul', code: 'MS' },
  'MT': { region: 'centro-oeste', slug: 'mato-grosso', code: 'MT' },
  'PA': { region: 'norte', slug: 'para', code: 'PA' },
  'PB': { region: 'nordeste', slug: 'paraiba', code: 'PB' },
  'PE': { region: 'nordeste', slug: 'pernambuco', code: 'PE' },
  'PI': { region: 'nordeste', slug: 'piaui', code: 'PI' },
  'PR': { region: 'sul', slug: 'parana', code: 'PR' },
  'RJ': { region: 'sudeste', slug: 'rio-de-janeiro', code: 'RJ' },
  'RN': { region: 'nordeste', slug: 'rio-grande-do-norte', code: 'RN' },
  'RO': { region: 'norte', slug: 'rondonia', code: 'RO' },
  'RR': { region: 'norte', slug: 'roraima', code: 'RR' },
  'RS': { region: 'sul', slug: 'rio-grande-do-sul', code: 'RS' },
  'SC': { region: 'sul', slug: 'santa-catarina', code: 'SC' },
  'SE': { region: 'nordeste', slug: 'sergipe', code: 'SE' },
  'SP': { region: 'sudeste', slug: 'sao-paulo', code: 'SP' },
  'TO': { region: 'norte', slug: 'tocantins', code: 'TO' },
};

const ALL_UFS = Object.keys(SICRO_UF_MAP);
const MONTH_NAMES = ['', 'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const BASE_URL = 'https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/custos-referenciais/sistemas-de-custos/sicro';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════
interface ParsedItem {
  code: string;
  description: string;
  unit: string;
  price: number;
  type: string;
}

interface ParsedCompositionItem {
  parentCode: string;
  type: string;
  code: string;
  description: string;
  unit: string;
  quantity: number;
}

interface SyncResult {
  success: boolean;
  message: string;
  databaseId?: string;
  itemCount?: number;
  compositionCount?: number;
}

// ═══════════════════════════════════════════════════════════
// Download SICRO .7z file via HTTP
// Confirmed URL pattern (via browser inspection):
//   .../sicro/relatorios/relatorios-sicro/{region}/{state}/{year}/{month}/{uf-lower}-{MM}-{YYYY}.7z
// Example: .../sicro/relatorios/relatorios-sicro/nordeste/ceara/2026/janeiro/ce-01-2026.7z
// ═══════════════════════════════════════════════════════════
async function downloadSicro7z(uf: string, month: number, year: number, downloadDir: string): Promise<string | null> {
  const info = SICRO_UF_MAP[uf];
  if (!info) return null;

  const mm = String(month).padStart(2, '0');
  const monthName = MONTH_NAMES[month];
  const ufLower = uf.toLowerCase();
  const correctFileName = `${ufLower}-${mm}-${year}.7z`;

  // Primary URL: confirmed via browser DOM inspection of gov.br portal
  // Path: .../sicro/relatorios/relatorios-sicro/{region}/{state}/{year}/{month}/{uf}-{MM}-{YYYY}.7z
  const urlPatterns = [
    `${BASE_URL}/relatorios/relatorios-sicro/${info.region}/${info.slug}/${year}/${monthName}/${correctFileName}`,
    // Fallback: try uppercase UF
    `${BASE_URL}/relatorios/relatorios-sicro/${info.region}/${info.slug}/${year}/${monthName}/${uf}-${mm}-${year}.7z`,
    // Fallback: dot-separated format
    `${BASE_URL}/relatorios/relatorios-sicro/${info.region}/${info.slug}/${year}/${monthName}/${ufLower}-${mm}.${year}.7z`,
    // Fallback: navigate to month page and extract link from HTML
    `${BASE_URL}/relatorios/relatorios-sicro/${info.region}/${info.slug}/${year}/${monthName}/${monthName}-${year}`,
  ];

  console.log(`[SICRO Crawler] 📥 Buscando: ${uf} ${mm}/${year}...`);

  for (const url of urlPatterns) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        continue; // silently try next pattern
      }

      const contentType = response.headers.get('content-type') || '';
      const buffer = Buffer.from(await response.arrayBuffer());

      // Check if it's a valid 7z file (magic bytes: 37 7A BC AF 27 1C)
      if (buffer.length > 6 && buffer[0] === 0x37 && buffer[1] === 0x7A && buffer[2] === 0xBC) {
        const filePath = path.join(downloadDir, correctFileName);
        fs.writeFileSync(filePath, buffer);
        console.log(`[SICRO Crawler] ✅ Download OK: ${correctFileName} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
        return filePath;
      }

      // Could also be a ZIP
      if (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4B) {
        const filePath = path.join(downloadDir, correctFileName.replace('.7z', '.zip'));
        fs.writeFileSync(filePath, buffer);
        console.log(`[SICRO Crawler] ✅ Download OK (ZIP): ${correctFileName} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
        return filePath;
      }

      // If it's an HTML page with a download link inside, try to parse it
      if (contentType.includes('text/html') && buffer.length < 500000) {
        const html = buffer.toString('utf-8');
        const match = html.match(/href="([^"]*\.7z[^"]*)"/i) || html.match(/href="([^"]*\.zip[^"]*)"/i);
        if (match) {
          const innerUrl = match[1].startsWith('http') ? match[1] : `https://www.gov.br${match[1]}`;
          console.log(`[SICRO Crawler] 🔗 Link encontrado na página: ${innerUrl}`);
          try {
            const res2 = await fetch(innerUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
              redirect: 'follow',
            });
            if (res2.ok) {
              const buf2 = Buffer.from(await res2.arrayBuffer());
              if (buf2.length > 1000) {
                const ext = innerUrl.includes('.zip') ? '.zip' : '.7z';
                const filePath = path.join(downloadDir, `${uf}-${mm}.${year}${ext}`);
                fs.writeFileSync(filePath, buf2);
                console.log(`[SICRO Crawler] ✅ Download via inner link: ${(buf2.length / 1024 / 1024).toFixed(1)} MB`);
                return filePath;
              }
            }
          } catch (e) {}
        }
      }

      console.log(`[SICRO Crawler] ⚠️ Conteúdo não é 7z/ZIP (${contentType}, ${buffer.length} bytes)`);
    } catch (e: any) {
      console.log(`[SICRO Crawler] ❌ Erro fetch: ${e.message}`);
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════
// Extract files from .7z using node child_process
// Falls back to adm-zip for ZIP files
// ═══════════════════════════════════════════════════════════
function extract7z(filePath: string, outputDir: string): string[] {
  const ext = path.extname(filePath).toLowerCase();

  // If ZIP, use adm-zip
  if (ext === '.zip') {
    try {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(filePath);
      zip.extractAllTo(outputDir, true);
      return findExcelFiles(outputDir);
    } catch (e: any) {
      console.error(`[SICRO Extract] ZIP error: ${e.message}`);
      return [];
    }
  }

  // For .7z, try multiple approaches
  const binPaths = [
    'p7zip', // Railway Alpine
    '7z',
    '7za',
    '/usr/bin/7z',
    '/usr/bin/p7zip',
  ];

  // Try using 7zip-bin npm package
  try {
    const sevenBin = require('7zip-bin');
    binPaths.unshift(sevenBin.path7za);
  } catch (e) {}

  for (const bin of binPaths) {
    try {
      execSync(`"${bin}" x "${filePath}" -o"${outputDir}" -y`, { stdio: 'pipe', timeout: 60000 });
      console.log(`[SICRO Extract] ✅ Extracted with ${bin}`);
      return findExcelFiles(outputDir);
    } catch (e) {
      continue;
    }
  }

  // Last resort: try to install p7zip if on Railway (Alpine)
  try {
    execSync('apk add --no-cache p7zip 2>/dev/null || apt-get install -y p7zip-full 2>/dev/null', { stdio: 'pipe', timeout: 30000 });
    execSync(`p7zip -d "${filePath}" 2>/dev/null || 7z x "${filePath}" -o"${outputDir}" -y`, { stdio: 'pipe', timeout: 60000 });
    return findExcelFiles(outputDir);
  } catch (e) {}

  console.error(`[SICRO Extract] ❌ Não conseguiu extrair .7z — instale p7zip`);
  return [];
}

function findExcelFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findExcelFiles(fullPath));
      } else if (/\.(xlsx?|xls)$/i.test(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch (e) {}
  return results;
}

// ═══════════════════════════════════════════════════════════
// Parse SICRO Excel files
// SICRO has different sheet structures than SINAPI
// Typically: "Relatório Sintético", "Composições", "Insumos"
// ═══════════════════════════════════════════════════════════
function parseSicroExcel(filePath: string): { items: ParsedItem[]; compositionItems: ParsedCompositionItem[] } {
  const items: ParsedItem[] = [];
  const compositionItems: ParsedCompositionItem[] = [];

  try {
    const buffer = fs.readFileSync(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    console.log(`[SICRO Parse] 📄 ${path.basename(filePath)}: ${workbook.SheetNames.length} abas: ${workbook.SheetNames.join(', ')}`);

    for (const sheetName of workbook.SheetNames) {
      const upper = sheetName.toUpperCase().trim();
      const rows: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
      if (rows.length < 3) continue;

      // Detect if this is an items/insumos sheet or a compositions sheet
      const isInsumo = upper.includes('INSUMO') || upper.includes('MATERIAL') || upper.includes('EQUIPAMENTO') || upper.includes('MÃO');
      const isComposition = upper.includes('COMPOS') || upper.includes('SERVIÇO') || upper.includes('SERVICO') || upper.includes('SINTÉTIC') || upper.includes('SINTETICO') || upper.includes('RELATÓRIO') || upper.includes('RELATORIO');
      const isAnalytic = upper.includes('ANALÍT') || upper.includes('ANALIT') || upper.includes('DETALH');

      if (!isInsumo && !isComposition && !isAnalytic) {
        // Try to detect by column headers
        const headerRow = rows.slice(0, 10).find(r => {
          const joined = r.map((c: any) => String(c).toUpperCase()).join(' ');
          return joined.includes('CÓDIGO') || joined.includes('CODIGO') || joined.includes('DESCRIÇÃO');
        });
        if (!headerRow) continue;
      }

      // Find header row
      let headerIdx = -1;
      let codeCol = -1, descCol = -1, unitCol = -1, priceCol = -1, typeCol = -1;

      for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const row = rows[i].map((c: any) => String(c).trim().toUpperCase());
        const hasCode = row.some((c: string) => c.includes('CÓDIGO') || c.includes('CODIGO') || c === 'CÓD' || c === 'COD');
        const hasDesc = row.some((c: string) => c.includes('DESCRIÇÃO') || c.includes('DESCRICAO') || c.includes('DESCRIÇAO'));
        if (hasCode && hasDesc) {
          headerIdx = i;
          for (let j = 0; j < row.length; j++) {
            const c = row[j];
            if (codeCol < 0 && (c.includes('CÓDIGO') || c.includes('CODIGO') || c === 'CÓD' || c === 'COD')) codeCol = j;
            if (descCol < 0 && (c.includes('DESCRIÇÃO') || c.includes('DESCRICAO'))) descCol = j;
            if (unitCol < 0 && (c.includes('UNID') || c === 'UN' || c === 'UNIDADE')) unitCol = j;
            if (priceCol < 0 && (c.includes('PREÇO') || c.includes('PRECO') || c.includes('CUSTO') || c.includes('VALOR') || c.includes('TOTAL'))) priceCol = j;
            if (typeCol < 0 && (c.includes('TIPO') || c.includes('GRUPO') || c.includes('CLASSIF'))) typeCol = j;
          }
          break;
        }
      }

      if (headerIdx < 0 || codeCol < 0) continue;
      if (descCol < 0) descCol = codeCol + 1;
      if (unitCol < 0) unitCol = descCol + 1;
      if (priceCol < 0) priceCol = unitCol + 1;

      console.log(`[SICRO Parse] 📋 Aba "${sheetName}": header@row${headerIdx}, cols: code=${codeCol} desc=${descCol} unit=${unitCol} price=${priceCol}`);

      let count = 0;
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        const code = String(r[codeCol] ?? '').trim();
        const desc = String(r[descCol] ?? '').trim();
        if (!code || !desc || code.length < 2) continue;

        const unit = String(r[unitCol] ?? '').trim().toUpperCase() || 'UN';

        let price = 0;
        const rawPrice = r[priceCol];
        if (typeof rawPrice === 'number') {
          price = rawPrice;
        } else if (rawPrice) {
          const c = String(rawPrice).replace(/[^\d.,\-]/g, '');
          if (c) {
            price = c.includes(',') && (!c.includes('.') || c.lastIndexOf(',') > c.lastIndexOf('.'))
              ? parseFloat(c.replace(/\./g, '').replace(',', '.')) || 0
              : parseFloat(c.replace(/,/g, '')) || 0;
          }
        }

        // Determine type from group column or sheet name
        let type = 'SERVICO';
        if (typeCol >= 0) {
          const rawType = String(r[typeCol] ?? '').toUpperCase();
          if (rawType.includes('MÃO') || rawType.includes('MAO') || rawType.includes('OBRA')) type = 'MAO_DE_OBRA';
          else if (rawType.includes('EQUIP')) type = 'EQUIPAMENTO';
          else if (rawType.includes('MATERIAL') || rawType.includes('INSUMO')) type = 'MATERIAL';
        } else if (isInsumo) {
          if (upper.includes('EQUIP')) type = 'EQUIPAMENTO';
          else if (upper.includes('MÃO') || upper.includes('MAO')) type = 'MAO_DE_OBRA';
          else type = 'MATERIAL';
        }

        if (isAnalytic) {
          // Analytical sheet — treat as composition items (we need parent code)
          // SICRO analytical sheets are more complex, skip for now
          continue;
        }

        if (price > 0) {
          items.push({ code, description: desc, unit, price, type });
          count++;
        }
      }

      console.log(`[SICRO Parse] ✅ Aba "${sheetName}": ${count} itens extraídos`);
    }
  } catch (e: any) {
    console.error(`[SICRO Parse] ❌ Erro: ${e.message}`);
  }

  return { items, compositionItems };
}

// ═══════════════════════════════════════════════════════════
// Persist Items (reuses same logic as SINAPI)
// ═══════════════════════════════════════════════════════════
async function persistSicroItems(uf: string, month: number, year: number, data: { items: ParsedItem[]; compositionItems: ParsedCompositionItem[] }): Promise<SyncResult> {
  const baseName = 'SICRO';
  const version = `${String(month).padStart(2, '0')}/${year}`;

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

  // Separate services (compositions) from materials/equipment (items)
  const basicItems = data.items.filter(it => it.type !== 'SERVICO');
  const serviceItems = data.items.filter(it => it.type === 'SERVICO');

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
  console.log(`[SICRO Crawler] ✅ SICRO ${uf} ${version}: ${insertedItems} insumos + ${insertedComps} composições`);
  return { success: true, message: `SICRO ${uf} ${version}: ${insertedItems} insumos + ${insertedComps} composições`, databaseId: db!.id, itemCount: insertedItems, compositionCount: insertedComps };
}

// ═══════════════════════════════════════════════════════════
// Main Orchestrator
// ═══════════════════════════════════════════════════════════
export interface SicroSyncOptions {
  ufs: string[];
  months: number;
}

export interface SicroSyncReport {
  started: string;
  finished: string;
  totalAttempted: number;
  totalSuccess: number;
  totalFailed: number;
  results: SyncResult[];
}

export async function syncSicro(options: SicroSyncOptions): Promise<SicroSyncReport> {
  const { ufs: requestedUfs, months } = options;
  const isAllUfs = requestedUfs.includes('ALL') || requestedUfs.length >= 27;
  const ufs = isAllUfs ? ALL_UFS : requestedUfs;
  const started = new Date().toISOString();
  const results: SyncResult[] = [];

  const now = new Date();
  const targetMonths: { month: number; year: number }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    targetMonths.push({ month: d.getMonth() + 1, year: d.getFullYear() });
  }

  console.log(`\n[SICRO Crawler] 🚀 Sync SICRO: ${isAllUfs ? 'ALL (27 UFs)' : ufs.join(',')} × ${months} meses`);

  for (const uf of ufs) {
    for (const { month, year } of targetMonths) {
      const version = `${String(month).padStart(2, '0')}/${year}`;

      // Idempotency check
      const existing = await prisma.engineeringDatabase.findFirst({
        where: { name: 'SICRO', uf, referenceMonth: month, referenceYear: year, type: 'OFICIAL', itemCount: { gt: 0 } }
      });
      if (existing && (existing.itemCount || 0) > 0) {
        console.log(`[SICRO Crawler] ⏭️ SICRO ${uf} ${version}: já existente (${existing.itemCount} itens)`);
        results.push({ success: true, message: `Já existente: ${uf} ${version}` });
        continue;
      }

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sicro-'));
      const extractDir = path.join(tmpDir, 'extracted');
      fs.mkdirSync(extractDir, { recursive: true });

      try {
        const filePath = await downloadSicro7z(uf, month, year, tmpDir);
        if (!filePath) {
          console.log(`[SICRO Crawler] ⚠️ SICRO ${uf} ${version}: download não disponível`);
          results.push({ success: false, message: `Download indisponível: ${uf} ${version}` });
          continue;
        }

        // Extract
        const excelFiles = extract7z(filePath, extractDir);
        if (excelFiles.length === 0) {
          console.log(`[SICRO Crawler] ⚠️ SICRO ${uf} ${version}: sem planilhas Excel no arquivo`);
          results.push({ success: false, message: `Sem Excel: ${uf} ${version}` });
          continue;
        }

        console.log(`[SICRO Crawler] 📊 ${excelFiles.length} planilha(s) encontrada(s)`);

        // Parse all Excel files
        const allData: { items: ParsedItem[]; compositionItems: ParsedCompositionItem[] } = { items: [], compositionItems: [] };
        for (const excelFile of excelFiles) {
          const data = parseSicroExcel(excelFile);
          allData.items.push(...data.items);
          allData.compositionItems.push(...data.compositionItems);
        }

        if (allData.items.length === 0) {
          console.log(`[SICRO Crawler] ⚠️ SICRO ${uf} ${version}: nenhum item extraído`);
          results.push({ success: false, message: `Sem itens: ${uf} ${version}` });
          continue;
        }

        // Persist
        const result = await persistSicroItems(uf, month, year, allData);
        results.push(result);
      } catch (e: any) {
        console.error(`[SICRO Crawler] ❌ SICRO ${uf} ${version}: ${e.message}`);
        results.push({ success: false, message: `Erro: ${uf} ${version} - ${e.message}` });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const finished = new Date().toISOString();
  const totalSuccess = results.filter(r => r.success).length;
  const totalFailed = results.filter(r => !r.success).length;
  console.log(`\n[SICRO Crawler] 🏁 Sync completo: ${totalSuccess} sucesso, ${totalFailed} falhas`);

  return { started, finished, totalAttempted: results.length, totalSuccess, totalFailed, results };
}
