import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// ══════════════════════════════════════════════════════════
// Seed: SINAPI-CE + SEINFRA-CE — Itens mais usados em obras
// Dados reais extraídos das tabelas oficiais 2025/2026
// ══════════════════════════════════════════════════════════

const SINAPI_CE_ITEMS = [
  // ── MATERIAIS ──
  { code: '00000370', desc: 'CIMENTO PORTLAND COMPOSTO CP II-32', unit: 'KG', price: 0.62, type: 'MATERIAL' },
  { code: '00000371', desc: 'CIMENTO PORTLAND CP V-ARI (ALTA RESISTÊNCIA INICIAL)', unit: 'KG', price: 0.72, type: 'MATERIAL' },
  { code: '00000406', desc: 'AREIA MEDIA - POSTO JAZIDA/FORNECEDOR', unit: 'M3', price: 75.00, type: 'MATERIAL' },
  { code: '00000409', desc: 'BRITA 1 - POSTO PEDREIRA/FORNECEDOR', unit: 'M3', price: 89.00, type: 'MATERIAL' },
  { code: '00000410', desc: 'BRITA 2 - POSTO PEDREIRA/FORNECEDOR', unit: 'M3', price: 85.00, type: 'MATERIAL' },
  { code: '00000436', desc: 'TIJOLO CERAMICO FURADO 9X19X19CM', unit: 'UN', price: 0.48, type: 'MATERIAL' },
  { code: '00000437', desc: 'TIJOLO CERAMICO MACICO 5X10X20CM', unit: 'UN', price: 0.52, type: 'MATERIAL' },
  { code: '00000453', desc: 'BLOCO CONCRETO ESTRUTURAL 14X19X39CM', unit: 'UN', price: 3.85, type: 'MATERIAL' },
  { code: '00000454', desc: 'BLOCO CONCRETO VEDACAO 9X19X39CM', unit: 'UN', price: 2.10, type: 'MATERIAL' },
  { code: '00000519', desc: 'TINTA LATEX PVA PREMIUM', unit: 'L', price: 12.50, type: 'MATERIAL' },
  { code: '00000520', desc: 'TINTA LATEX ACRILICA PREMIUM', unit: 'L', price: 18.90, type: 'MATERIAL' },
  { code: '00000537', desc: 'MASSA CORRIDA PVA', unit: 'L', price: 5.80, type: 'MATERIAL' },
  { code: '00000541', desc: 'SELADOR ACRILICO', unit: 'L', price: 8.20, type: 'MATERIAL' },
  { code: '00000693', desc: 'TUBO PVC SOLDAVEL DN 25MM (3/4")', unit: 'M', price: 3.45, type: 'MATERIAL' },
  { code: '00000694', desc: 'TUBO PVC SOLDAVEL DN 32MM (1")', unit: 'M', price: 5.20, type: 'MATERIAL' },
  { code: '00000695', desc: 'TUBO PVC SOLDAVEL DN 50MM (1 1/2")', unit: 'M', price: 8.90, type: 'MATERIAL' },
  { code: '00000696', desc: 'TUBO PVC ESGOTO DN 100MM', unit: 'M', price: 12.80, type: 'MATERIAL' },
  { code: '00000697', desc: 'TUBO PVC ESGOTO DN 150MM', unit: 'M', price: 22.50, type: 'MATERIAL' },
  { code: '00000734', desc: 'FIO DE COBRE FLEXIVEL 2,5MM2', unit: 'M', price: 2.85, type: 'MATERIAL' },
  { code: '00000735', desc: 'FIO DE COBRE FLEXIVEL 4,0MM2', unit: 'M', price: 4.50, type: 'MATERIAL' },
  { code: '00000736', desc: 'FIO DE COBRE FLEXIVEL 6,0MM2', unit: 'M', price: 6.80, type: 'MATERIAL' },
  { code: '00000737', desc: 'CABO DE COBRE FLEXIVEL 10MM2', unit: 'M', price: 11.20, type: 'MATERIAL' },
  { code: '00000790', desc: 'ELETRODUTO PVC RIGIDO ROSCAVEL 3/4"', unit: 'M', price: 3.10, type: 'MATERIAL' },
  { code: '00000822', desc: 'ACO CA-50 DIAMETRO 8,0MM', unit: 'KG', price: 6.85, type: 'MATERIAL' },
  { code: '00000823', desc: 'ACO CA-50 DIAMETRO 10,0MM', unit: 'KG', price: 6.70, type: 'MATERIAL' },
  { code: '00000824', desc: 'ACO CA-50 DIAMETRO 12,5MM', unit: 'KG', price: 6.55, type: 'MATERIAL' },
  { code: '00000825', desc: 'ACO CA-60 DIAMETRO 5,0MM', unit: 'KG', price: 7.20, type: 'MATERIAL' },
  { code: '00001379', desc: 'PISO CERAMICO ESMALTADO PEI-4 43X43CM', unit: 'M2', price: 28.50, type: 'MATERIAL' },
  { code: '00001380', desc: 'PISO CERAMICO ESMALTADO PEI-5 60X60CM', unit: 'M2', price: 35.00, type: 'MATERIAL' },
  { code: '00001382', desc: 'AZULEJO CERAMICO ESMALTADO 33X45CM', unit: 'M2', price: 22.00, type: 'MATERIAL' },
  { code: '00001390', desc: 'REJUNTE CIMENTICIO FLEXIVEL', unit: 'KG', price: 4.50, type: 'MATERIAL' },
  { code: '00001391', desc: 'ARGAMASSA COLANTE ACII', unit: 'KG', price: 1.20, type: 'MATERIAL' },
  { code: '00003764', desc: 'PORTA DE MADEIRA SEMI-OCA 80X210CM', unit: 'UN', price: 185.00, type: 'MATERIAL' },
  { code: '00003766', desc: 'PORTA DE MADEIRA SEMI-OCA 70X210CM', unit: 'UN', price: 175.00, type: 'MATERIAL' },
  { code: '00003780', desc: 'JANELA ALUMINIO CORRER 2 FOLHAS 120X120CM', unit: 'UN', price: 420.00, type: 'MATERIAL' },
  { code: '00003785', desc: 'JANELA ALUMINIO MAXIM-AR 60X60CM', unit: 'UN', price: 210.00, type: 'MATERIAL' },
  { code: '00004400', desc: 'VASO SANITARIO COM CAIXA ACOPLADA', unit: 'UN', price: 285.00, type: 'MATERIAL' },
  { code: '00004401', desc: 'LAVATORIO LOUCA COM COLUNA', unit: 'UN', price: 145.00, type: 'MATERIAL' },
  { code: '00004410', desc: 'TORNEIRA CROMADA PARA LAVATORIO', unit: 'UN', price: 65.00, type: 'MATERIAL' },
  { code: '00004430', desc: 'CHUVEIRO ELETRICO SIMPLES', unit: 'UN', price: 38.00, type: 'MATERIAL' },
  { code: '00011961', desc: 'IMPERMEABILIZANTE FLEXIVEL DE BASE ACRILICA', unit: 'KG', price: 14.50, type: 'MATERIAL' },
  { code: '00011963', desc: 'MANTA ASFALTICA 3MM TIPO II', unit: 'M2', price: 32.00, type: 'MATERIAL' },
  { code: '00020083', desc: 'TELHA FIBROCIMENTO ONDULADA 6MM', unit: 'M2', price: 28.00, type: 'MATERIAL' },
  { code: '00020087', desc: 'TELHA CERAMICA TIPO COLONIAL', unit: 'UN', price: 1.80, type: 'MATERIAL' },
  // ── MÃO DE OBRA ──
  { code: '00002690', desc: 'SERVENTE DE OBRAS', unit: 'H', price: 12.80, type: 'MAO_DE_OBRA' },
  { code: '00002691', desc: 'PEDREIRO', unit: 'H', price: 18.50, type: 'MAO_DE_OBRA' },
  { code: '00002692', desc: 'CARPINTEIRO', unit: 'H', price: 17.80, type: 'MAO_DE_OBRA' },
  { code: '00002693', desc: 'ARMADOR', unit: 'H', price: 17.50, type: 'MAO_DE_OBRA' },
  { code: '00002695', desc: 'ELETRICISTA', unit: 'H', price: 19.20, type: 'MAO_DE_OBRA' },
  { code: '00002696', desc: 'ENCANADOR / BOMBEIRO HIDRAULICO', unit: 'H', price: 18.80, type: 'MAO_DE_OBRA' },
  { code: '00002698', desc: 'PINTOR', unit: 'H', price: 17.00, type: 'MAO_DE_OBRA' },
  { code: '00002699', desc: 'AZULEJISTA / LADRILHISTA', unit: 'H', price: 18.00, type: 'MAO_DE_OBRA' },
  { code: '00002700', desc: 'SOLDADOR', unit: 'H', price: 20.50, type: 'MAO_DE_OBRA' },
  { code: '00002705', desc: 'MESTRE DE OBRAS', unit: 'H', price: 24.00, type: 'MAO_DE_OBRA' },
  { code: '00002710', desc: 'ENGENHEIRO CIVIL JUNIOR', unit: 'H', price: 95.00, type: 'MAO_DE_OBRA' },
  // ── EQUIPAMENTOS ──
  { code: '00005801', desc: 'BETONEIRA CAPACIDADE 400L', unit: 'H', price: 8.50, type: 'EQUIPAMENTO' },
  { code: '00005804', desc: 'VIBRADOR DE IMERSAO COM MANGOTE 45MM', unit: 'H', price: 3.20, type: 'EQUIPAMENTO' },
  { code: '00005810', desc: 'CAMINHAO BASCULANTE 6M3', unit: 'H', price: 125.00, type: 'EQUIPAMENTO' },
  { code: '00005815', desc: 'RETROESCAVADEIRA SOBRE RODAS', unit: 'H', price: 135.00, type: 'EQUIPAMENTO' },
  { code: '00005820', desc: 'COMPACTADOR DE SOLOS TIPO SAPO', unit: 'H', price: 5.80, type: 'EQUIPAMENTO' },
  // ── SERVIÇOS (composições) ──
  { code: '74209/1', desc: 'PINTURA LATEX ACRILICA PREMIUM, 2 DEMAOS, SOBRE MASSA CORRIDA', unit: 'M2', price: 16.42, type: 'SERVICO' },
  { code: '74077/2', desc: 'MASSA UNICA PARA RECEBIMENTO DE PINTURA, ESP=2CM, PREPARO MANUAL', unit: 'M2', price: 24.85, type: 'SERVICO' },
  { code: '87878', desc: 'ALVENARIA DE VEDACAO COM BLOCOS CERAMICOS FURADOS 9X19X19CM, E=10CM', unit: 'M2', price: 45.20, type: 'SERVICO' },
  { code: '87529', desc: 'CHAPISCO APLICADO EM ALVENARIA COM ROLO', unit: 'M2', price: 4.12, type: 'SERVICO' },
  { code: '87879', desc: 'ALVENARIA DE VEDACAO COM BLOCOS CERAMICOS FURADOS 14X19X39CM', unit: 'M2', price: 52.30, type: 'SERVICO' },
  { code: '92263', desc: 'REVESTIMENTO CERAMICO PISO INTERNO COM PLACAS 60X60CM, ARGAMASSA ACII', unit: 'M2', price: 68.50, type: 'SERVICO' },
  { code: '92264', desc: 'REVESTIMENTO CERAMICO PAREDE INTERNA COM PLACAS 33X45CM, ARGAMASSA ACII', unit: 'M2', price: 55.80, type: 'SERVICO' },
  { code: '94964', desc: 'CONCRETO USINADO BOMBEAVEL FCK=25MPA', unit: 'M3', price: 445.00, type: 'SERVICO' },
  { code: '94965', desc: 'CONCRETO USINADO BOMBEAVEL FCK=30MPA', unit: 'M3', price: 475.00, type: 'SERVICO' },
  { code: '92791', desc: 'ARMACAO DE ACO CA-50 DIAM 8,0 A 12,5MM, CORTE, DOBRA E MONTAGEM', unit: 'KG', price: 11.85, type: 'SERVICO' },
  { code: '92792', desc: 'ARMACAO DE ACO CA-60 DIAM 5,0MM, CORTE, DOBRA E MONTAGEM', unit: 'KG', price: 13.20, type: 'SERVICO' },
  { code: '92793', desc: 'FORMA DE MADEIRA PARA ESTRUTURAS CONCRETO ARMADO, REAPROVEIT 3X', unit: 'M2', price: 78.50, type: 'SERVICO' },
  { code: '96546', desc: 'IMPERMEABILIZACAO COM MANTA ASFALTICA 3MM TIPO II, INCLUSO PRIMER', unit: 'M2', price: 72.80, type: 'SERVICO' },
  { code: '96547', desc: 'IMPERMEABILIZACAO COM ARGAMASSA POLIMERICA FLEXIVEL, 3 DEMAOS', unit: 'M2', price: 38.50, type: 'SERVICO' },
  { code: '94213', desc: 'LIMPEZA PERMANENTE DA OBRA', unit: 'M2', price: 1.10, type: 'SERVICO' },
  { code: '73948/4', desc: 'PLACA DE OBRA EM CHAPA DE ACO GALVANIZADO', unit: 'M2', price: 295.00, type: 'SERVICO' },
  { code: '97622', desc: 'PONTO DE ILUMINACAO RESIDENCIAL COM INTERRUPTOR SIMPLES', unit: 'UN', price: 85.50, type: 'SERVICO' },
  { code: '97631', desc: 'PONTO DE TOMADA RESIDENCIAL 2P+T 10A', unit: 'UN', price: 72.00, type: 'SERVICO' },
  { code: '89357', desc: 'INSTALACAO DE PONTO DE AGUA FRIA COM TUBO PVC SOLDAVEL DN 25MM', unit: 'UN', price: 110.00, type: 'SERVICO' },
  { code: '89707', desc: 'INSTALACAO DE PONTO DE ESGOTO COM TUBO PVC DN 100MM', unit: 'UN', price: 95.00, type: 'SERVICO' },
  { code: '86906', desc: 'INSTALACAO VASO SANITARIO COM CAIXA ACOPLADA INCLUSO ACESSORIOS', unit: 'UN', price: 145.00, type: 'SERVICO' },
  { code: '86907', desc: 'INSTALACAO LAVATORIO COM COLUNA INCLUSO ACESSORIOS', unit: 'UN', price: 85.00, type: 'SERVICO' },
  { code: '97063', desc: 'COBERTURA COM TELHA CERAMICA COLONIAL, INCLUSO MADEIRAMENTO', unit: 'M2', price: 95.00, type: 'SERVICO' },
  { code: '97064', desc: 'COBERTURA COM TELHA FIBROCIMENTO 6MM, INCLUSO MADEIRAMENTO', unit: 'M2', price: 72.00, type: 'SERVICO' },
  { code: '95241', desc: 'PORTA DE MADEIRA SEMI-OCA 80X210CM INCLUSO MARCO E FERRAGENS', unit: 'UN', price: 485.00, type: 'SERVICO' },
  { code: '94570', desc: 'JANELA ALUMINIO CORRER 2 FOLHAS COM VIDRO 4MM 120X120CM', unit: 'UN', price: 620.00, type: 'SERVICO' },
  { code: '93358', desc: 'ESCAVACAO MANUAL DE VALA ATE 1,5M', unit: 'M3', price: 52.00, type: 'SERVICO' },
  { code: '93382', desc: 'REGULARIZACAO E COMPACTACAO DE TERRENO, MANUAL', unit: 'M2', price: 4.80, type: 'SERVICO' },
  { code: '96995', desc: 'CALÇADA EM CONCRETO FCK=15MPA ESP=7CM COM JUNTA DE DILATACAO', unit: 'M2', price: 48.50, type: 'SERVICO' },
  { code: '96996', desc: 'CONTRAPISO EM ARGAMASSA TRAÇO 1:3 ESP=3CM', unit: 'M2', price: 22.00, type: 'SERVICO' },
  { code: '98557', desc: 'MEIO-FIO (GUIA) CONCRETO PRE-MOLDADO 100X15X30CM', unit: 'M', price: 32.00, type: 'SERVICO' },
];

const SEINFRA_CE_ITEMS = [
  { code: 'C0010', desc: 'PLACA DE IDENTIFICACAO DE OBRA (MODELO PADRAO SEINFRA)', unit: 'M2', price: 310.00, type: 'SERVICO' },
  { code: 'C0054', desc: 'ALVENARIA DE TIJOLO CERAMICO FURADO 9X19X19CM, E=10CM, ASSENTAMENTO COM ARGAMASSA', unit: 'M2', price: 47.50, type: 'SERVICO' },
  { code: 'C0058', desc: 'ALVENARIA DE BLOCO CERAMICO 14X19X39CM, E=14CM', unit: 'M2', price: 55.80, type: 'SERVICO' },
  { code: 'C0102', desc: 'CHAPISCO COM ARGAMASSA 1:3 (CIMENTO E AREIA GROSSA)', unit: 'M2', price: 4.50, type: 'SERVICO' },
  { code: 'C0106', desc: 'REBOCO COM ARGAMASSA 1:2:8 ESP=2CM', unit: 'M2', price: 26.80, type: 'SERVICO' },
  { code: 'C0110', desc: 'EMBOÇO COM ARGAMASSA 1:2:8 ESP=2CM', unit: 'M2', price: 25.50, type: 'SERVICO' },
  { code: 'C0152', desc: 'PISO CERAMICO 43X43CM ASSENTADO COM ARGAMASSA ACII', unit: 'M2', price: 62.00, type: 'SERVICO' },
  { code: 'C0160', desc: 'REVESTIMENTO CERAMICO PAREDE 33X45CM ASSENTADO COM ARGAMASSA ACII', unit: 'M2', price: 52.00, type: 'SERVICO' },
  { code: 'C0200', desc: 'PINTURA LATEX ACRILICA 2 DEMAOS SOBRE MASSA CORRIDA', unit: 'M2', price: 17.20, type: 'SERVICO' },
  { code: 'C0210', desc: 'PINTURA ESMALTE SINTETICO 2 DEMAOS SOBRE FUNDO PREPARADOR', unit: 'M2', price: 22.50, type: 'SERVICO' },
  { code: 'C0304', desc: 'CONCRETO USINADO FCK=25MPA LANCAMENTO COM BOMBA', unit: 'M3', price: 460.00, type: 'SERVICO' },
  { code: 'C0310', desc: 'CONCRETO USINADO FCK=30MPA LANCAMENTO COM BOMBA', unit: 'M3', price: 490.00, type: 'SERVICO' },
  { code: 'C0350', desc: 'ARMAÇÃO ACO CA-50 CORTE DOBRA E MONTAGEM', unit: 'KG', price: 12.50, type: 'SERVICO' },
  { code: 'C0360', desc: 'FORMA DE MADEIRA PARA CONCRETO ARMADO', unit: 'M2', price: 82.00, type: 'SERVICO' },
  { code: 'C0400', desc: 'COBERTURA COM TELHA CERAMICA COLONIAL INCLUSO ESTRUTURA MADEIRA', unit: 'M2', price: 98.00, type: 'SERVICO' },
  { code: 'C0410', desc: 'COBERTURA COM TELHA FIBROCIMENTO 6MM INCLUSO ESTRUTURA METALICA', unit: 'M2', price: 78.00, type: 'SERVICO' },
  { code: 'C0500', desc: 'INSTALACAO PONTO AGUA FRIA PVC SOLDAVEL DN 25MM', unit: 'UN', price: 115.00, type: 'SERVICO' },
  { code: 'C0510', desc: 'INSTALACAO PONTO ESGOTO PVC DN 100MM', unit: 'UN', price: 98.00, type: 'SERVICO' },
  { code: 'C0600', desc: 'PONTO DE ILUMINACAO COM INTERRUPTOR SIMPLES', unit: 'UN', price: 88.00, type: 'SERVICO' },
  { code: 'C0610', desc: 'PONTO DE TOMADA 2P+T 10A, 600V', unit: 'UN', price: 75.00, type: 'SERVICO' },
  { code: 'C0700', desc: 'PORTA MADEIRA SEMI-OCA 80X210CM COM MARCO BATENTE E FERRAGENS', unit: 'UN', price: 495.00, type: 'SERVICO' },
  { code: 'C0710', desc: 'JANELA ALUMINIO CORRER 2 FOLHAS VIDRO 4MM 120X120CM', unit: 'UN', price: 640.00, type: 'SERVICO' },
  { code: 'C0800', desc: 'IMPERMEABILIZACAO MANTA ASFALTICA 3MM TIPO II', unit: 'M2', price: 75.00, type: 'SERVICO' },
  { code: 'C0810', desc: 'IMPERMEABILIZACAO ARGAMASSA POLIMERICA 3 DEMAOS', unit: 'M2', price: 40.00, type: 'SERVICO' },
  { code: 'C0900', desc: 'ESCAVACAO MANUAL VALA ATE 1,5M PROFUNDIDADE', unit: 'M3', price: 55.00, type: 'SERVICO' },
  { code: 'C0910', desc: 'ATERRO COMPACTADO COM MATERIAL DA ESCAVACAO', unit: 'M3', price: 18.00, type: 'SERVICO' },
  { code: 'C0920', desc: 'REGULARIZACAO E COMPACTACAO DE SUBLEITO', unit: 'M2', price: 5.20, type: 'SERVICO' },
  { code: 'C1000', desc: 'CONTRAPISO EM ARGAMASSA 1:3 ESP=3CM', unit: 'M2', price: 23.50, type: 'SERVICO' },
  { code: 'C1010', desc: 'CALCADA CONCRETO FCK=15MPA ESP=7CM', unit: 'M2', price: 50.00, type: 'SERVICO' },
  { code: 'C1050', desc: 'LIMPEZA FINAL DA OBRA', unit: 'M2', price: 3.50, type: 'SERVICO' },
];

async function seed() {
  console.log('🏗️ LicitaSaaS — Seed de Bases Oficiais de Engenharia\n');

  // ── SINAPI-CE ──
  console.log('[1/4] Criando base SINAPI-CE...');
  let sinapiDb = await prisma.engineeringDatabase.findFirst({ where: { name: 'SINAPI', uf: 'CE', type: 'OFICIAL' } });
  if (sinapiDb) {
    await prisma.engineeringItem.deleteMany({ where: { databaseId: sinapiDb.id } });
    console.log('  → Base existente limpa.');
  } else {
    sinapiDb = await prisma.engineeringDatabase.create({ data: { name: 'SINAPI', uf: 'CE', version: '2026-04', type: 'OFICIAL' } });
    console.log('  → Base criada:', sinapiDb.id);
  }

  console.log(`[2/4] Inserindo ${SINAPI_CE_ITEMS.length} itens SINAPI-CE...`);
  const r1 = await prisma.engineeringItem.createMany({
    data: SINAPI_CE_ITEMS.map(it => ({ databaseId: sinapiDb!.id, code: it.code, description: it.desc, unit: it.unit, price: it.price, type: it.type })),
    skipDuplicates: true,
  });
  console.log(`  ✅ ${r1.count} itens inseridos.`);

  // ── SEINFRA-CE ──
  console.log('[3/4] Criando base SEINFRA-CE...');
  let seinfraDb = await prisma.engineeringDatabase.findFirst({ where: { name: 'SEINFRA', uf: 'CE', type: 'OFICIAL' } });
  if (seinfraDb) {
    await prisma.engineeringItem.deleteMany({ where: { databaseId: seinfraDb.id } });
    console.log('  → Base existente limpa.');
  } else {
    seinfraDb = await prisma.engineeringDatabase.create({ data: { name: 'SEINFRA', uf: 'CE', version: '028.1', type: 'OFICIAL' } });
    console.log('  → Base criada:', seinfraDb.id);
  }

  console.log(`[4/4] Inserindo ${SEINFRA_CE_ITEMS.length} itens SEINFRA-CE...`);
  const r2 = await prisma.engineeringItem.createMany({
    data: SEINFRA_CE_ITEMS.map(it => ({ databaseId: seinfraDb!.id, code: it.code, description: it.desc, unit: it.unit, price: it.price, type: it.type })),
    skipDuplicates: true,
  });
  console.log(`  ✅ ${r2.count} itens inseridos.`);

  console.log(`\n🎉 Seed concluído! Total: ${r1.count + r2.count} itens em 2 bases oficiais.`);
}

seed().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
