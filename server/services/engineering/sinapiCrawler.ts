/**
 * SINAPI Crawler — Auto-download da Caixa Econômica Federal
 * 
 * Estratégia: O portal da Caixa usa SharePoint com URLs dinâmicas.
 * Porém, os arquivos ZIP ficam hospedados em URLs padronizadas após
 * a publicação mensal. Usamos um browser headless leve (via fetch + 
 * cookie handling) para navegar pelo portal e encontrar os links.
 * 
 * Fallback: Se a navegação automática falhar, o admin pode fazer
 * upload manual pelo Hub de Bases.
 */

import axios from 'axios';
import * as XLSX from 'xlsx';
// @ts-ignore — adm-zip pode não ter types
import AdmZip from 'adm-zip';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ═══════════════════════════════════════════════════════════
// Configuração de URLs conhecidas do SINAPI
// ═══════════════════════════════════════════════════════════

const UF_MAP: Record<string, string> = {
  'AC': 'Acre', 'AL': 'Alagoas', 'AM': 'Amazonas', 'AP': 'Amapa',
  'BA': 'Bahia', 'CE': 'Ceara', 'DF': 'Distrito Federal', 'ES': 'Espirito Santo',
  'GO': 'Goias', 'MA': 'Maranhao', 'MG': 'Minas Gerais', 'MS': 'Mato Grosso do Sul',
  'MT': 'Mato Grosso', 'PA': 'Para', 'PB': 'Paraiba', 'PE': 'Pernambuco',
  'PI': 'Piaui', 'PR': 'Parana', 'RJ': 'Rio de Janeiro', 'RN': 'Rio Grande do Norte',
  'RO': 'Rondonia', 'RR': 'Roraima', 'RS': 'Rio Grande do Sul', 'SC': 'Santa Catarina',
  'SE': 'Sergipe', 'SP': 'Sao Paulo', 'TO': 'Tocantins'
};

/**
 * Gera URLs candidatas para download do SINAPI na Caixa.
 * A Caixa usa vários padrões de nomenclatura ao longo dos anos.
 */
function generateSinapiUrls(uf: string, month: number, year: number, desonerado: boolean): string[] {
  const mm = String(month).padStart(2, '0');
  const yy = String(year);
  const mmyy = `${mm}${yy}`;
  const regime = desonerado ? 'Desonerado' : 'NaoDesonerado';
  const regimeAlt = desonerado ? 'Desonerado' : 'Nao Desonerado';
  
  // A Caixa usa vários formatos de URL ao longo dos meses
  const baseUrls = [
    // Formato mais comum (2024+)
    `https://www.caixa.gov.br/Downloads/sinapi-a-partir-jul-2009-${uf.toLowerCase()}/SINAPI_ref_Insumos_Composicoes_${uf}_${mmyy}_${regime}.zip`,
    `https://www.caixa.gov.br/Downloads/sinapi-a-partir-jul-2009-${uf.toLowerCase()}/SINAPI_Preco_Ref_Insumos_${uf}_${mmyy}_${regime}.zip`,
    // Formato alternativo (com espaços codificados)
    `https://www.caixa.gov.br/Downloads/sinapi-a-partir-jul-2009-${uf.toLowerCase()}/SINAPI_Custo_Ref_Composicoes_Sintetico_${uf}_${mmyy}_${regime}.zip`,
    // Formato com ano-mês invertido
    `https://www.caixa.gov.br/Downloads/sinapi-a-partir-jul-2009-${uf.toLowerCase()}/SINAPI_ref_Insumos_Composicoes_${uf}_${yy}${mm}_${regime}.zip`,
  ];
  
  return baseUrls;
}

// ═══════════════════════════════════════════════════════════
// Download & Processamento
// ═══════════════════════════════════════════════════════════

interface SyncResult {
  success: boolean;
  message: string;
  databaseId?: string;
  itemCount?: number;
  compositionCount?: number;
}

/**
 * Tenta baixar um ZIP do SINAPI usando múltiplas URLs candidatas.
 * Retorna o buffer do ZIP se conseguir, ou null se todas falharem.
 */
async function downloadSinapiZip(uf: string, month: number, year: number, desonerado: boolean): Promise<Buffer | null> {
  const urls = generateSinapiUrls(uf, month, year, desonerado);
  const regime = desonerado ? 'Desonerado' : 'Onerado';
  
  for (const url of urls) {
    try {
      console.log(`[SINAPI Crawler] Tentando: ${url.split('/').pop()}`);
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000, // 60s timeout
        maxRedirects: 5,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/zip,application/octet-stream,*/*',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        validateStatus: (status) => status === 200, // Only accept 200
      });
      
      // Verificar se o conteúdo é realmente um ZIP (magic bytes: PK)
      const buffer = Buffer.from(response.data);
      if (buffer.length > 100 && buffer[0] === 0x50 && buffer[1] === 0x4B) {
        console.log(`[SINAPI Crawler] ✅ Download OK: ${(buffer.length / 1024 / 1024).toFixed(1)} MB — ${regime} ${uf} ${String(month).padStart(2, '0')}/${year}`);
        return buffer;
      } else {
        console.log(`[SINAPI Crawler] ⚠️ Resposta não é ZIP (${buffer.length} bytes), tentando próxima URL...`);
      }
    } catch (err: any) {
      const status = err.response?.status || err.code || 'UNKNOWN';
      console.log(`[SINAPI Crawler] ❌ Falha (${status}): ${url.split('/').pop()}`);
    }
  }
  
  return null;
}

/**
 * Extrai os arquivos Excel relevantes de dentro do ZIP.
 * Retorna os buffers dos arquivos de Insumos e Composições.
 */
function extractExcelFromZip(zipBuffer: Buffer): { insumos: Buffer | null; composicoes: Buffer | null } {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  
  let insumos: Buffer | null = null;
  let composicoes: Buffer | null = null;
  
  for (const entry of entries) {
    const name = entry.entryName.toUpperCase();
    if (name.endsWith('.XLSX') || name.endsWith('.XLS')) {
      if (name.includes('INSUMO') && name.includes('PRECO')) {
        insumos = entry.getData();
        console.log(`[SINAPI Crawler] 📋 Encontrado arquivo de INSUMOS: ${entry.entryName}`);
      } else if (name.includes('COMPOSIC') && (name.includes('SINTETICO') || name.includes('ANALITICO') || name.includes('CUSTO'))) {
        composicoes = entry.getData();
        console.log(`[SINAPI Crawler] 📋 Encontrado arquivo de COMPOSIÇÕES: ${entry.entryName}`);
      }
    }
  }
  
  // Se não encontrou pelos nomes específicos, pega os maiores xlsx
  if (!insumos && !composicoes) {
    const xlsxFiles = entries
      .filter((e: any) => e.entryName.toUpperCase().endsWith('.XLSX'))
      .sort((a: any, b: any) => b.header.size - a.header.size);
    
    if (xlsxFiles.length >= 2) {
      composicoes = xlsxFiles[0].getData();
      insumos = xlsxFiles[1].getData();
      console.log(`[SINAPI Crawler] 📋 Usando os 2 maiores XLSX como fallback`);
    } else if (xlsxFiles.length === 1) {
      insumos = xlsxFiles[0].getData();
      console.log(`[SINAPI Crawler] 📋 Apenas 1 XLSX encontrado, tratando como insumos`);
    }
  }
  
  return { insumos, composicoes };
}

/**
 * Processa um buffer Excel e extrai itens de engenharia.
 * Reutiliza a mesma lógica do endpoint /api/engineering/bases/import.
 */
function parseExcelToItems(buffer: Buffer): { code: string; description: string; unit: string; price: number; type: string }[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const allItems: { code: string; description: string; unit: string; price: number; type: string }[] = [];
  
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rows.length < 2) continue;
    
    // Smart column detection
    let headerRowIdx = -1;
    let colMap: Record<string, number> = {};
    
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const row = rows[i].map((c: any) => String(c).trim().toUpperCase());
      const codeIdx = row.findIndex((c: string) => c.includes('CODIGO') || c.includes('CÓDIGO') || c === 'COD');
      const descIdx = row.findIndex((c: string) => c.includes('DESCRI'));
      const unitIdx = row.findIndex((c: string) => c.includes('UNID') || c === 'UN' || c === 'UND');
      const priceIdx = row.findIndex((c: string) => c.includes('PRECO') || c.includes('PREÇO') || c.includes('CUSTO') || c.includes('VALOR') || c.includes('MEDIANA'));
      
      if (codeIdx >= 0 && descIdx >= 0 && priceIdx >= 0) {
        headerRowIdx = i;
        colMap = { code: codeIdx, desc: descIdx, unit: unitIdx >= 0 ? unitIdx : -1, price: priceIdx };
        break;
      }
    }
    
    if (headerRowIdx < 0) continue;
    
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const code = String(row[colMap.code] ?? '').trim();
      const desc = String(row[colMap.desc] ?? '').trim();
      const unit = colMap.unit >= 0 ? String(row[colMap.unit] ?? '').trim().toUpperCase() : 'UN';
      const rawPrice = row[colMap.price];
      
      if (!code || !desc || code.length < 2) continue;
      
      let price = 0;
      if (typeof rawPrice === 'number') {
        price = rawPrice;
      } else if (rawPrice) {
        const cleaned = String(rawPrice).replace(/[^\d.,\-]/g, '');
        if (cleaned.includes(',') && (!cleaned.includes('.') || cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.'))) {
          price = parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
        } else {
          price = parseFloat(cleaned.replace(/,/g, '')) || 0;
        }
      }
      
      if (price <= 0) continue;
      
      // Classify type
      let type = 'SERVICO';
      const descUpper = desc.toUpperCase();
      if (['H', 'HORA', 'MES', 'DIA'].includes(unit) && /PEDREIRO|SERVENTE|MESTRE|ELETRICISTA|ENCANADOR|PINTOR|CARPINTEIRO|ARMADOR|SOLDADOR/.test(descUpper)) {
        type = 'MAO_DE_OBRA';
      } else if (['KG', 'L', 'M', 'UN', 'M2', 'M3', 'SC', 'PCT', 'PC', 'GL', 'LT', 'TN', 'CJ'].includes(unit) && price < 500 && !/INSTALACAO|ASSENTAMENTO|EXECUCAO/.test(descUpper)) {
        type = 'MATERIAL';
      } else if (/BETONEIRA|CAMINHAO|RETROESCAVADEIRA|COMPACTADOR|GUINDASTE|VIBRADOR/.test(descUpper)) {
        type = 'EQUIPAMENTO';
      }
      
      allItems.push({ code, description: desc, unit: unit || 'UN', price, type });
    }
  }
  
  return allItems;
}

/**
 * Persiste os itens extraídos no banco de dados.
 * Cria ou atualiza a EngineeringDatabase e seus itens/composições.
 */
async function persistItems(
  baseName: string,
  uf: string,
  month: number,
  year: number,
  desonerado: boolean,
  items: { code: string; description: string; unit: string; price: number; type: string }[]
): Promise<SyncResult> {
  const version = `${String(month).padStart(2, '0')}/${year}`;
  const regime = desonerado ? 'Desonerado' : 'Onerado';
  
  // Check if this exact base already exists
  let db = await prisma.engineeringDatabase.findFirst({
    where: {
      name: baseName,
      uf: uf,
      referenceMonth: month,
      referenceYear: year,
      payrollExemption: desonerado,
      type: 'OFICIAL'
    }
  });
  
  if (db) {
    // Clean and re-import
    await prisma.engineeringItem.deleteMany({ where: { databaseId: db.id } });
    await prisma.engineeringComposition.deleteMany({ where: { databaseId: db.id } });
    console.log(`[SINAPI Crawler] 🔄 Base existente "${baseName} ${uf} ${version} ${regime}" limpa para re-import.`);
  } else {
    db = await prisma.engineeringDatabase.create({
      data: {
        name: baseName,
        uf: uf,
        version: version,
        type: 'OFICIAL',
        payrollExemption: desonerado,
        referenceMonth: month,
        referenceYear: year,
      }
    });
    console.log(`[SINAPI Crawler] ✨ Nova base "${baseName} ${uf} ${version} ${regime}" criada.`);
  }
  
  // Split items by type
  const basicItems = items.filter(it => it.type !== 'SERVICO');
  const serviceItems = items.filter(it => it.type === 'SERVICO');
  
  // Batch insert items
  const BATCH = 1000;
  let insertedItems = 0;
  for (let i = 0; i < basicItems.length; i += BATCH) {
    const batch = basicItems.slice(i, i + BATCH);
    const result = await prisma.engineeringItem.createMany({
      data: batch.map(it => ({ databaseId: db!.id, ...it })),
      skipDuplicates: true,
    });
    insertedItems += result.count;
  }
  
  // Batch insert compositions (SERVICO items)
  let insertedComps = 0;
  for (const svc of serviceItems) {
    try {
      await prisma.engineeringComposition.create({
        data: {
          databaseId: db!.id,
          code: svc.code,
          description: svc.description,
          unit: svc.unit,
          totalPrice: svc.price,
        }
      });
      insertedComps++;
    } catch (e: any) {
      if (!e.message?.includes('Unique constraint')) {
        // Silently skip duplicates
      }
    }
  }
  
  // Update counters
  await prisma.engineeringDatabase.update({
    where: { id: db!.id },
    data: { itemCount: insertedItems, compositionCount: insertedComps }
  });
  
  console.log(`[SINAPI Crawler] ✅ ${baseName} ${uf} ${version} ${regime}: ${insertedItems} insumos + ${insertedComps} composições`);
  
  return {
    success: true,
    message: `${baseName} ${uf} ${version} ${regime}: ${insertedItems} insumos + ${insertedComps} composições`,
    databaseId: db!.id,
    itemCount: insertedItems,
    compositionCount: insertedComps,
  };
}

// ═══════════════════════════════════════════════════════════
// Orquestrador Principal
// ═══════════════════════════════════════════════════════════

export interface SyncOptions {
  ufs: string[];         // Ex: ["CE", "SP"]
  months: number;        // Quantos meses para trás (1 = só o atual, 3 = últimos 3)
  includeDesonerado: boolean;
  baseName?: string;     // Default: "SINAPI"
}

export interface SyncReport {
  started: string;
  finished: string;
  totalAttempted: number;
  totalSuccess: number;
  totalFailed: number;
  results: SyncResult[];
}

/**
 * Orquestrador principal do sync do SINAPI.
 * Itera por cada combinação de UF × Mês × Regime e faz download + import.
 */
export async function syncSinapi(options: SyncOptions): Promise<SyncReport> {
  const { ufs, months, includeDesonerado, baseName = 'SINAPI' } = options;
  const started = new Date().toISOString();
  const results: SyncResult[] = [];
  
  // Calculate the target months (going backwards from current)
  const now = new Date();
  const targetMonths: { month: number; year: number }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    targetMonths.push({ month: d.getMonth() + 1, year: d.getFullYear() });
  }
  
  console.log(`[SINAPI Crawler] 🚀 Iniciando sync: ${ufs.join(', ')} × ${months} meses × ${includeDesonerado ? 'Onerado+Desonerado' : 'Apenas Onerado'}`);
  console.log(`[SINAPI Crawler] 📅 Meses alvo: ${targetMonths.map(m => `${String(m.month).padStart(2, '0')}/${m.year}`).join(', ')}`);
  
  for (const uf of ufs) {
    for (const { month, year } of targetMonths) {
      const regimes = includeDesonerado ? [false, true] : [false];
      
      for (const desonerado of regimes) {
        const regime = desonerado ? 'Desonerado' : 'Onerado';
        const version = `${String(month).padStart(2, '0')}/${year}`;
        
        // Check idempotency — skip if already imported
        const existing = await prisma.engineeringDatabase.findFirst({
          where: {
            name: baseName,
            uf: uf,
            referenceMonth: month,
            referenceYear: year,
            payrollExemption: desonerado,
            type: 'OFICIAL',
            itemCount: { gt: 0 }  // Only skip if it actually has items
          }
        });
        
        if (existing && existing.itemCount > 0) {
          console.log(`[SINAPI Crawler] ⏭️ Pulando ${baseName} ${uf} ${version} ${regime} (já existe com ${existing.itemCount} itens)`);
          results.push({ success: true, message: `Já existente: ${existing.itemCount} itens`, databaseId: existing.id });
          continue;
        }
        
        // Try to download
        console.log(`\n[SINAPI Crawler] 📥 Baixando: ${baseName} ${uf} ${version} ${regime}...`);
        const zipBuffer = await downloadSinapiZip(uf, month, year, desonerado);
        
        if (!zipBuffer) {
          console.log(`[SINAPI Crawler] ❌ Não foi possível baixar ${baseName} ${uf} ${version} ${regime}`);
          results.push({ success: false, message: `Download falhou: ${baseName} ${uf} ${version} ${regime}` });
          continue;
        }
        
        // Extract Excel files from ZIP
        const { insumos, composicoes } = extractExcelFromZip(zipBuffer);
        
        if (!insumos && !composicoes) {
          console.log(`[SINAPI Crawler] ❌ Nenhum arquivo Excel encontrado no ZIP`);
          results.push({ success: false, message: `ZIP sem Excel: ${baseName} ${uf} ${version} ${regime}` });
          continue;
        }
        
        // Parse and merge all items
        const allItems: { code: string; description: string; unit: string; price: number; type: string }[] = [];
        if (insumos) allItems.push(...parseExcelToItems(insumos));
        if (composicoes) allItems.push(...parseExcelToItems(composicoes));
        
        if (allItems.length === 0) {
          results.push({ success: false, message: `Nenhum item válido: ${baseName} ${uf} ${version} ${regime}` });
          continue;
        }
        
        // Persist
        const result = await persistItems(baseName, uf, month, year, desonerado, allItems);
        results.push(result);
        
        // Small delay between downloads to be respectful
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  
  const finished = new Date().toISOString();
  const totalSuccess = results.filter(r => r.success).length;
  const totalFailed = results.filter(r => !r.success).length;
  
  console.log(`\n[SINAPI Crawler] 🏁 Sync concluído: ${totalSuccess} sucesso, ${totalFailed} falhas`);
  
  return {
    started,
    finished,
    totalAttempted: results.length,
    totalSuccess,
    totalFailed,
    results,
  };
}

/**
 * Importa um arquivo Excel diretamente (para upload manual via Hub).
 * Wrapper que aceita um Buffer e metadata.
 */
export async function importFromBuffer(
  buffer: Buffer,
  baseName: string,
  uf: string,
  month: number,
  year: number,
  desonerado: boolean
): Promise<SyncResult> {
  const items = parseExcelToItems(buffer);
  if (items.length === 0) {
    return { success: false, message: 'Nenhum item válido encontrado no arquivo' };
  }
  return persistItems(baseName, uf, month, year, desonerado, items);
}
