import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

const SEINFRA_CONFIGS = {
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
  console.log(`⬇️ Downloading: ${url.split('/').pop()}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP error ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

function detectType(code: string, description: string): 'MATERIAL' | 'MAO_DE_OBRA' | 'EQUIPAMENTO' | 'SERVICO' {
  const desc = (description || '').toUpperCase();
  if (code.startsWith('C')) return 'SERVICO';
  if (desc.includes('PEDREIRO') || desc.includes('SERVENTE') || desc.includes('CARPINTEIRO') ||
      desc.includes('ELETRICIST') || desc.includes('BOMBEIRO') || desc.includes('PINTOR') ||
      desc.includes('ENCANADOR') || desc.includes('SOLDADOR') || desc.includes('ARMADOR') ||
      desc.includes('OPERADOR') || desc.includes('MOTORISTA') || desc.includes('MÃO DE OBRA') ||
      desc.includes('MAO DE OBRA') || desc.includes('AJUDANTE') || desc.includes('ENGENHEIRO') ||
      desc.includes('MESTRE DE OBRA') || desc.includes('APONTADOR') || desc.includes('VIGIA') ||
      desc.includes('TOPÓGRAFO') || desc.includes('TOPOGRAFO') || desc.includes('ALMOXARIFE') ||
      desc.includes('MONTADOR') || desc.includes('SERRALHEIRO') || desc.includes('CALCETEIRO') ||
      desc.includes('MARMORISTA') || desc.includes('VIDRACEIRO') || desc.includes('IMPERMEABILIZADOR')) return 'MAO_DE_OBRA';
  if (desc.includes('BETONEIRA') || desc.includes('COMPACTADOR') || desc.includes('RETRO') ||
      desc.includes('ESCAVADEIRA') || desc.includes('CAMINHÃO') || desc.includes('CAMINHAO') ||
      desc.includes('VIBRADOR') || desc.includes('GUINDASTE') || desc.includes('MÁQUINA') ||
      desc.includes('MAQUINA') || desc.includes('ROLO') || desc.includes('TRATOR') ||
      desc.includes('GUINCHO') || desc.includes('SERRA CIRCULAR') || desc.includes('PERFURATRIZ') ||
      desc.includes('USINA') || desc.includes('GERADOR') || desc.includes('ANDAIME')) return 'EQUIPAMENTO';
  return 'MATERIAL';
}

interface ParsedInsumo {
  code: string;
  description: string;
  unit: string;
  price: number;
  type: 'MATERIAL' | 'MAO_DE_OBRA' | 'EQUIPAMENTO' | 'SERVICO';
}

interface ParsedCompositionItem {
  insumoCode: string;
  description: string;
  unit: string;
  coefficient: number;
  unitPrice: number;
  totalPrice: number;
  isComposition: boolean;
}

interface ParsedComposition {
  code: string;
  description: string;
  unit: string;
  totalPrice: number;
  items: ParsedCompositionItem[];
}

function parseInsumos(buffer: Buffer): ParsedInsumo[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const items: ParsedInsumo[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    for (const row of rows) {
      if (!row || row.length < 3) continue;
      const code = String(row[0] || '').trim().toUpperCase();
      
      // Permitir insumos iniciados com I, G, R ou puramente numéricos
      if (!code.match(/^[IGR]\d{3,5}$/) && !code.match(/^\d{4,6}$/)) continue;

      const description = String(row[1] || '').trim();
      const unit = String(row[2] || '').trim();
      const price = typeof row[3] === 'number' ? row[3] :
          parseFloat(String(row[3] || '0').replace(/\./g, '').replace(',', '.')) || 0;

      if (description) {
        items.push({
          code,
          description,
          unit: unit || 'UN',
          price,
          type: detectType(code, description),
        });
      }
    }
  }
  return items;
}

function parseComposicoes(buffer: Buffer): ParsedComposition[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const compositions: ParsedComposition[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    let currentComp: ParsedComposition | null = null;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const col0 = String(row[0] || '').trim();

      // Cabeçalho de composição
      const headerMatch = col0.match(/^([a-zA-Z\d]+)\s*-\s*(.+?)\s*-\s*(\w+(?:\.\w+)?)\s*$/);
      if (headerMatch && col0.startsWith('C')) {
        if (currentComp && currentComp.items.length > 0) {
          compositions.push(currentComp);
        }
        currentComp = {
          code: headerMatch[1].toUpperCase(),
          description: headerMatch[2].trim(),
          unit: headerMatch[3].trim(),
          totalPrice: 0,
          items: [],
        };
        continue;
      }

      if (!currentComp) continue;
      if (col0 === 'MAO DE OBRA' || col0 === 'MATERIAIS' || col0 === 'EQUIPAMENTOS' || 
          col0 === 'ATIVIDADES AUXILIARES' || col0 === 'SERVIÇOS' || col0 === 'CUSTOS HORÁRIOS') continue;

      const col3 = String(row[3] || '').trim();
      if (col3 === 'Valor Geral:' || col3 === 'Total Simples:') {
        const totalVal = typeof row[5] === 'number' ? row[5] :
            parseFloat(String(row[5] || '0').replace(/\./g, '').replace(',', '.')) || 0;
        if (col3 === 'Valor Geral:' && totalVal > 0) {
          currentComp.totalPrice = Math.round(totalVal * 100) / 100;
        }
        continue;
      }

      const col4 = String(row[4] || '').trim();
      if (col4 === 'Total:' || col3 === 'Encargos Sociais:' || col3 === 'Valor BDI:') continue;

      // Permitir itens de composição com prefixo I, C, G ou R
      const itemMatch = col0.match(/^([ICGR]\d{4,5})$/i);
      if (itemMatch) {
        const insumoCode = itemMatch[1].toUpperCase();
        const desc = String(row[1] || '').trim();
        const unit = String(row[2] || '').trim();
        const coefficient = typeof row[3] === 'number' ? row[3] :
            parseFloat(String(row[3] || '0').replace(',', '.')) || 0;
        const unitPrice = typeof row[4] === 'number' ? row[4] :
            parseFloat(String(row[4] || '0').replace(/\./g, '').replace(',', '.')) || 0;
        const totalPrice = typeof row[5] === 'number' ? row[5] :
            parseFloat(String(row[5] || '0').replace(/\./g, '').replace(',', '.')) || 0;

        if (desc && coefficient > 0) {
          currentComp.items.push({
            insumoCode,
            description: desc,
            unit: unit || 'UN',
            coefficient,
            unitPrice,
            totalPrice: totalPrice || (coefficient * unitPrice),
            isComposition: insumoCode.startsWith('C'),
          });
        }
      }
    }

    if (currentComp && currentComp.items.length > 0) {
      compositions.push(currentComp);
    }
  }
  return compositions;
}

async function syncRegime(regime: 'onerada' | 'desonerada') {
  const config = SEINFRA_CONFIGS[regime];
  console.log(`\n==================================================`);
  console.log(`🚀 SINCRONIZANDO BASE SEINFRA ${config.version} (${regime.toUpperCase()})`);
  console.log(`==================================================`);

  // 1. Download e parse das tabelas
  const insumosBuf = await downloadFile(config.insumos);
  const allInsumos = parseInsumos(insumosBuf);
  
  const compsBuf = await downloadFile(config.composicoes);
  const allComps = parseComposicoes(compsBuf);

  // 2. Filtrar insumos começados por 'G' e 'R'
  const targetInsumos = allInsumos.filter(i => i.code.startsWith('G') || i.code.startsWith('R'));
  console.log(`Identificados ${targetInsumos.length} insumos de interesse (prefixo G ou R) na planilha.`);

  // 3. Upsert de Insumos
  console.log(`Iniciando Upsert de ${targetInsumos.length} insumos no banco de dados de produção...`);
  let insumosInserted = 0;
  for (const insumo of targetInsumos) {
    try {
      await prisma.engineeringItem.upsert({
        where: { databaseId_code: { databaseId: config.dbId, code: insumo.code } },
        create: {
          databaseId: config.dbId,
          code: insumo.code,
          description: insumo.description,
          unit: insumo.unit,
          price: insumo.price,
          type: insumo.type,
        },
        update: {
          description: insumo.description,
          unit: insumo.unit,
          price: insumo.price,
          type: insumo.type,
        }
      });
      insumosInserted++;
    } catch (e: any) {
      console.error(`Erro ao inserir insumo ${insumo.code}:`, e.message);
    }
  }
  console.log(`✅ Concluído: ${insumosInserted} insumos inseridos/atualizados.`);

  // 4. Carregar todo o banco de dados dessa base na memória para busca rápida sem latência de rede
  console.log("Carregando banco de dados na memória (Cache)...");
  const dbItems = await prisma.engineeringItem.findMany({
    where: { databaseId: config.dbId },
    select: { id: true, code: true }
  });
  const itemMap = new Map<string, string>();
  for (const it of dbItems) {
    itemMap.set(it.code.toUpperCase(), it.id);
  }
  console.log(`  → Cacheado ${itemMap.size} insumos.`);

  const dbComps = await prisma.engineeringComposition.findMany({
    where: { databaseId: config.dbId },
    select: { id: true, code: true }
  });
  const compMap = new Map<string, string>();
  for (const c of dbComps) {
    compMap.set(c.code.toUpperCase(), c.id);
  }
  console.log(`  → Cacheado ${compMap.size} composições.`);

  // 5. Identificar composições que dependem de insumos 'G' ou 'R'
  const affectedComps = allComps.filter(c => 
    c.items.some(item => item.insumoCode.startsWith('G') || item.insumoCode.startsWith('R'))
  );
  console.log(`Planilha possui ${affectedComps.length} composições que usam insumos 'G' ou 'R'.`);

  // 6. Atualizar relações de composição de forma otimizada
  console.log("Restaurando as referências estruturadas nas composições afetadas (Bulk Insertion)...");
  let compsUpdated = 0;
  for (const comp of affectedComps) {
    try {
      const compId = compMap.get(comp.code.toUpperCase());
      if (!compId) {
        console.warn(`  ⚠️ Composição ${comp.code} não foi encontrada no banco de dados.`);
        continue;
      }

      // Limpar todos os itens vinculados a essa composição no banco
      await prisma.engineeringCompositionItem.deleteMany({
        where: { compositionId: compId }
      });

      // Mapear os itens para inserção em lote
      const itemsPayload: any[] = [];
      for (const item of comp.items) {
        let itemId: string | null = null;
        let auxCompId: string | null = null;

        if (item.isComposition) {
          auxCompId = compMap.get(item.insumoCode.toUpperCase()) || null;
        } else {
          itemId = itemMap.get(item.insumoCode.toUpperCase()) || null;
          if (!itemId && (item.insumoCode.startsWith('G') || item.insumoCode.startsWith('R'))) {
            console.warn(`  ⚠️ Insumo de composição ${item.insumoCode} não foi encontrado no cache.`);
          }
        }

        itemsPayload.push({
          compositionId: compId,
          itemId,
          auxiliaryCompositionId: auxCompId,
          coefficient: item.coefficient,
          price: item.totalPrice,
        });
      }

      // Inserir os itens em lote (1 query)
      if (itemsPayload.length > 0) {
        await prisma.engineeringCompositionItem.createMany({
          data: itemsPayload
        });
      }
      
      compsUpdated++;
      if (compsUpdated % 20 === 0) {
        console.log(`  → ${compsUpdated}/${affectedComps.length} composições restauradas...`);
      }
    } catch (e: any) {
      console.error(`Erro ao atualizar composição ${comp.code}:`, e.message);
    }
  }
  console.log(`✅ Concluído: ${compsUpdated} composições estruturadas com sucesso.`);
}

async function main() {
  try {
    const startTime = Date.now();
    await syncRegime('onerada');
    await syncRegime('desonerada');
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n🎉 Sincronização concluída com sucesso em ${elapsed} segundos!`);
  } catch (e: any) {
    console.error("Erro catastrófico na execução:", e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
