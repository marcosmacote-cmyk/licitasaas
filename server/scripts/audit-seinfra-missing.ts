import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

const SEINFRA_URLS = {
  onerada: {
    insumos: 'https://sin.seinfra.ce.gov.br/site-seinfra/siproce/onerada/Tabela-de-Insumos-028---ENC.-SOCIAIS-114,15.xls',
    composicoes: 'https://sin.seinfra.ce.gov.br/site-seinfra/siproce/onerada/Composicoes-028---ENC.-SOCIAIS-114,15.xls',
    version: '028',
    dbId: '86eb1def-185e-4699-bb3f-45f8eb0d9a02'
  },
  desonerada: {
    insumos: 'https://sin.seinfra.ce.gov.br/site-seinfra/siproce/desonerada/Tabela-de-Insumos-028.1---ENC.-SOCIAIS-84,44.xls',
    composicoes: 'https://sin.seinfra.ce.gov.br/site-seinfra/siproce/desonerada/Composicoes-028.1---ENC.-SOCIAIS-84,44.xls',
    version: '028.1',
    dbId: '19f5f99a-422e-4b44-9397-1fb6980756ed'
  }
};

async function downloadFile(url: string): Promise<Buffer> {
  console.log(`⬇️ Baixando: ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Erro HTTP ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

// Parse de insumos sem o filtro restritivo de regex do importador original
function getRawInsumos(buffer: Buffer): { code: string; desc: string; unit: string; price: number }[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const items: any[] = [];
  
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    
    for (const row of rows) {
      if (!row || row.length < 3) continue;
      const code = String(row[0] || '').trim();
      const desc = String(row[1] || '').trim();
      const unit = String(row[2] || '').trim();
      const price = typeof row[3] === 'number' ? row[3] : parseFloat(String(row[3] || '0').replace('.', '').replace(',', '.')) || 0;
      
      // Filtro básico para pular cabeçalhos de grupos de insumos (como "MATERIAIS", "MAO DE OBRA" que não tem código)
      // e pular cabeçalhos de colunas
      if (!code || code.toLowerCase() === 'código' || code.toLowerCase() === 'codigo' || desc.toLowerCase() === 'descrição' || desc.toLowerCase() === 'descricao') continue;
      
      // Aceita qualquer código que tenha letras e/ou números e descrição longa o suficiente
      if (desc && desc.length > 2) {
        items.push({ code: code.toUpperCase(), desc, unit, price });
      }
    }
  }
  return items;
}

// Parse de composições sem filtros restritivos
function getRawComposicoes(buffer: Buffer): { code: string; desc: string; unit: string }[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const comps: any[] = [];
  
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    
    for (const row of rows) {
      if (!row || row.length === 0) continue;
      const col0 = String(row[0] || '').trim();
      
      // Detecta cabeçalho de composição: "C1802 - BOMBA CENTRÍFUGA... - UN"
      const headerMatch = col0.match(/^([a-zA-Z\d]+)\s*-\s*(.+?)\s*-\s*(\w+(?:\.\w+)?)\s*$/);
      if (headerMatch) {
        comps.push({
          code: headerMatch[1].toUpperCase(),
          desc: headerMatch[2].trim(),
          unit: headerMatch[3].trim()
        });
      }
    }
  }
  return comps;
}

async function auditRegime(regime: 'onerada' | 'desonerada') {
  const config = SEINFRA_URLS[regime];
  console.log(`\n=== AUDITANDO REGIME: ${regime.toUpperCase()} (SEINFRA ${config.version}) ===`);
  
  // 1. Baixar e extrair insumos da planilha
  const insumosBuf = await downloadFile(config.insumos);
  const excelInsumos = getRawInsumos(insumosBuf);
  console.log(`Excel oficial possui ${excelInsumos.length} insumos.`);
  
  // 2. Baixar e extrair composições da planilha
  const compsBuf = await downloadFile(config.composicoes);
  const excelComps = getRawComposicoes(compsBuf);
  console.log(`Excel oficial possui ${excelComps.length} composições.`);
  
  // 3. Buscar o que temos no banco
  console.log("Buscando insumos existentes no banco...");
  const dbInsumos = await prisma.engineeringItem.findMany({
    where: { databaseId: config.dbId },
    select: { code: true }
  });
  const dbInsumosSet = new Set(dbInsumos.map(i => i.code.toUpperCase()));
  console.log(`Banco possui ${dbInsumosSet.size} insumos.`);
  
  console.log("Buscando composições existentes no banco...");
  const dbComps = await prisma.engineeringComposition.findMany({
    where: { databaseId: config.dbId },
    select: { code: true }
  });
  const dbCompsSet = new Set(dbComps.map(c => c.code.toUpperCase()));
  console.log(`Banco possui ${dbCompsSet.size} composições.`);
  
  // 4. Cruzamento de dados
  const missingInsumos: any[] = [];
  const missingComps: any[] = [];
  
  for (const item of excelInsumos) {
    if (!dbInsumosSet.has(item.code)) {
      missingInsumos.push(item);
    }
  }
  
  for (const comp of excelComps) {
    if (!dbCompsSet.has(comp.code)) {
      missingComps.push(comp);
    }
  }
  
  console.log(`\n→ Resultados da Auditoria de Itens Ausentes:`);
  console.log(`Insumos ausentes no banco: ${missingInsumos.length}`);
  console.log(`Composições ausentes no banco: ${missingComps.length}`);
  
  if (missingInsumos.length > 0) {
    console.log("\nAmostra dos insumos ausentes (primeiros 20):");
    console.log(missingInsumos.slice(0, 20).map(i => ({ code: i.code, desc: i.desc.substring(0, 60), unit: i.unit, price: i.price })));
    
    // Contar padrões de códigos de insumos ausentes (por exemplo, qual letra inicial eles têm)
    const patternCounts: Record<string, number> = {};
    for (const item of missingInsumos) {
      const prefix = item.code.substring(0, 1);
      patternCounts[prefix] = (patternCounts[prefix] || 0) + 1;
    }
    console.log("\nContagem de prefixos de códigos de insumos ausentes:");
    console.log(patternCounts);
  }
  
  if (missingComps.length > 0) {
    console.log("\nAmostra das composições ausentes (primeiras 20):");
    console.log(missingComps.slice(0, 20).map(c => ({ code: c.code, desc: c.desc.substring(0, 60), unit: c.unit })));
    
    const patternCounts: Record<string, number> = {};
    for (const comp of missingComps) {
      const prefix = comp.code.substring(0, 1);
      patternCounts[prefix] = (patternCounts[prefix] || 0) + 1;
    }
    console.log("\nContagem de prefixos de códigos de composições ausentes:");
    console.log(patternCounts);
  }
}

async function main() {
  try {
    await auditRegime('onerada');
    await auditRegime('desonerada');
  } catch (error) {
    console.error("Erro na auditoria:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
