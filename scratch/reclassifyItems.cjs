/**
 * reclassifyItems.ts — Reclassifica itens de engenharia via TypeInferencer
 * 
 * Roda em produção (via railway ssh) para corrigir classificações genéricas
 * nas bases SINAPI, SBC, SICRO e ORSE.
 * 
 * Uso: node /tmp/reclassifyItems.cjs [--dry-run] [--base SINAPI]
 */
const { PrismaClient } = require('/app/server/node_modules/@prisma/client');
const prisma = new PrismaClient();

// ═══════════════════════════════════════════════════════════
// INSUMO CLASSIFIER (inlined from insumoClassifier.ts)
// ═══════════════════════════════════════════════════════════

const DICTIONARY = {
    MAO_DE_OBRA: [
        'pedreiro', 'servente', 'mestre de obras', 'eletricista', 'encanador',
        'pintor', 'carpinteiro', 'armador', 'soldador', 'montador',
        'bombeiro hidraulico', 'bombeiro hidr', 'apontador', 'almoxarife',
        'calceteiro', 'marmorista', 'vidraceiro', 'serralheiro', 'gesseiro',
        'azulejista', 'ladrilhista', 'impermeabilizador', 'poceiro',
        'topografo', 'nivelador', 'laboratorista',
        'engenheiro civil', 'engenheiro eletric', 'engenheiro mecanico',
        'engenheiro de seguranca', 'engenheiro sanitarista',
        'tecnico de seguranca', 'tecnico em edificacoes', 'tecnico em eletric',
        'tecnico em eletrotecnic', 'eletrotecnico',
        'encarregado', 'operador de maquina', 'operador de equip',
        'operador de betoneira', 'operador de guincho', 'operador de grua',
        'operador de guindaste', 'operador de retro',
        'motorista de caminhao', 'motorista',
        'vigia', 'vigilante', 'auxiliar de escritorio', 'auxiliar de topografia',
        'ajudante', 'meio oficial', 'oficial',
        'mao de obra', 'mao-de-obra',
        'encargos complementares', 'encargos sociais',
        'alimentacao - mensalista', 'alimentacao (coletivo',
        'transporte - mensalista', 'transporte (coletivo',
        'vale transporte', 'vale alimentacao',
        'epi ', 'equipamento de protecao individual',
        'mensalista', 'horista',
    ],
    EQUIPAMENTO: [
        'betoneira', 'retroescavadeira', 'escavadeira', 'pa carregadeira',
        'trator', 'motoniveladora', 'rolo compactador', 'rolo compressor',
        'caminhao basculante', 'caminhao carroceria', 'caminhao pipa',
        'caminhao munk', 'caminhao munck', 'caminhao guindauto',
        'caminhonete', 'caminhoneta', 'veiculo utilitario',
        'veiculo com um cesto', 'cesto aereo',
        'vibrador de imersao', 'vibrador de concreto',
        'compactador de solos', 'placa vibratoria',
        'guindaste', 'guincho', 'grua', 'elevador de obra',
        'bomba de concreto', 'bomba submersivel',
        'compressor de ar', 'gerador de energia', 'gerador eletric',
        'serra circular', 'serra eletrica', 'furadeira',
        'martelete', 'martelo demolidor', 'rompedor',
        'andaime metalico', 'andaime tubular', 'escoramento',
        'forma metalica', 'forma de aco',
        'plataforma elevatoria', 'carrinho de mao',
        'aluguel de', 'locacao de',
    ],
    MATERIAL: [
        'cimento portland', 'areia media', 'areia fina', 'areia grossa',
        'brita 1', 'brita 2', 'brita 0', 'pedra britada',
        'concreto usinado', 'concreto fck',
        'argamassa colante', 'argamassa industrializada',
        'tijolo ceramico', 'bloco ceramico', 'bloco de concreto',
        'aco ca-50', 'aco ca-60', 'vergalhao', 'barra de aco',
        'tela de aco', 'tela soldada', 'arame recozido', 'arame galvanizado',
        'prego', 'parafuso',
        'tinta latex', 'tinta acrilica', 'tinta esmalte', 'tinta epoxi',
        'massa corrida', 'massa acrilica', 'selador', 'verniz',
        'piso ceramico', 'azulejo', 'porcelanato',
        'tubo pvc', 'tubo de pvc', 'tubo de ferro', 'tubo de cobre',
        'conexao pvc', 'joelho pvc',
        'fio de cobre', 'cabo de cobre', 'cabo flexivel', 'cabo eletric',
        'eletroduto', 'disjuntor', 'tomada', 'interruptor',
        'lampada', 'luminaria', 'refletor',
        'manta asfaltica', 'impermeabilizante',
        'telha fibrocimento', 'telha ceramica', 'telha metalica',
        'porta de madeira', 'porta de aluminio', 'janela de aluminio',
        'vidro temperado', 'vidro laminado',
        'vaso sanitario', 'lavatorio', 'torneira', 'registro', 'sifao', 'valvula',
    ],
    SERVICO: [
        'taxa', 'emolumento', 'licenca', 'alvara',
        'consultoria', 'projeto', 'laudo',
        'verba', 'franquia',
        'administracao local', 'administracao central',
    ],
};

const LABOR_UNITS = new Set(['H', 'HORA', 'HH', 'H/H', 'DIA', 'MES', 'MÊS', 'MESES']);

function normalizeText(text) {
    return (text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function classifyInsumoType(description, unit, existingType) {
    const normalizedDesc = normalizeText(description);
    const normalizedUnit = (unit || '').toUpperCase().trim();

    // Priority 1: Preserve valid DB types (not default MATERIAL)
    if (existingType) {
        const upper = existingType.toUpperCase().trim();
        if (upper === 'MAO_DE_OBRA' || upper === 'MÃO DE OBRA') {
            return { type: 'MAO_DE_OBRA', confidence: 'HIGH', source: 'DATABASE' };
        }
        if (upper === 'EQUIPAMENTO') {
            return { type: 'EQUIPAMENTO', confidence: 'HIGH', source: 'DATABASE' };
        }
    }

    // Priority 2: Dictionary keyword match
    const categoryOrder = ['MAO_DE_OBRA', 'EQUIPAMENTO', 'MATERIAL', 'SERVICO'];
    for (const category of categoryOrder) {
        const keywords = DICTIONARY[category];
        for (const keyword of keywords) {
            const normalizedKw = normalizeText(keyword);
            if (normalizedDesc.includes(normalizedKw)) {
                return { type: category, confidence: 'HIGH', source: 'DICTIONARY', matchedKeyword: keyword };
            }
        }
    }

    // Priority 3: Unit heuristic
    if (LABOR_UNITS.has(normalizedUnit)) {
        const hasEquipHint = normalizedDesc.includes('aluguel') ||
            normalizedDesc.includes('locacao') ||
            normalizedDesc.includes('veiculo') ||
            normalizedDesc.includes('caminhao') ||
            normalizedDesc.includes('maquina');
        if (hasEquipHint) {
            return { type: 'EQUIPAMENTO', confidence: 'MEDIUM', source: 'UNIT_HEURISTIC' };
        }
        return { type: 'MAO_DE_OBRA', confidence: 'MEDIUM', source: 'UNIT_HEURISTIC' };
    }

    return { type: existingType || 'MATERIAL', confidence: 'LOW', source: 'DEFAULT' };
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const targetBase = args.find(a => !a.startsWith('--'));
    
    console.log(`\n🔧 Reclassificação de Insumos ${dryRun ? '(DRY RUN)' : '(PRODUÇÃO)'}`);
    if (targetBase) console.log(`   Base: ${targetBase}`);
    console.log('');

    // Get all databases
    const databases = await prisma.engineeringDatabase.findMany({
        where: targetBase ? { name: targetBase } : undefined,
        select: { id: true, name: true, uf: true, itemCount: true },
        orderBy: { name: 'asc' }
    });

    let totalChanged = 0;
    let totalProcessed = 0;
    const changes = { MAO_DE_OBRA: 0, EQUIPAMENTO: 0, SERVICO: 0, MATERIAL: 0 };
    const changesByBase = {};

    for (const db of databases) {
        const BATCH_SIZE = 5000;
        let offset = 0;
        let dbChanged = 0;
        let dbProcessed = 0;
        
        while (true) {
            const items = await prisma.engineeringItem.findMany({
                where: { databaseId: db.id },
                select: { id: true, code: true, description: true, unit: true, type: true },
                skip: offset,
                take: BATCH_SIZE,
                orderBy: { code: 'asc' }
            });
            
            if (items.length === 0) break;
            
            const updates = [];
            for (const item of items) {
                const classification = classifyInsumoType(item.description, item.unit, null);
                
                // Only update if classifier says different type with sufficient confidence
                if (classification.type !== item.type && classification.confidence !== 'LOW') {
                    updates.push({
                        id: item.id,
                        oldType: item.type,
                        newType: classification.type,
                        confidence: classification.confidence,
                        source: classification.source,
                        keyword: classification.matchedKeyword,
                        code: item.code,
                        desc: item.description.substring(0, 50),
                    });
                }
            }
            
            if (updates.length > 0 && !dryRun) {
                // Batch update
                for (const upd of updates) {
                    await prisma.engineeringItem.update({
                        where: { id: upd.id },
                        data: { type: upd.newType }
                    });
                }
            }
            
            dbChanged += updates.length;
            dbProcessed += items.length;
            totalChanged += updates.length;
            totalProcessed += items.length;
            
            for (const upd of updates) {
                changes[upd.newType] = (changes[upd.newType] || 0) + 1;
            }
            
            offset += BATCH_SIZE;
        }
        
        if (dbChanged > 0) {
            changesByBase[db.name] = { changed: dbChanged, total: dbProcessed, uf: db.uf };
            console.log(`📁 ${db.name} ${db.uf || ''}: ${dbChanged}/${dbProcessed} reclassificados`);
        }
    }

    console.log(`\n═══════════════════════════════════════`);
    console.log(`Total processados: ${totalProcessed}`);
    console.log(`Total reclassificados: ${totalChanged}`);
    console.log(`  → MAO_DE_OBRA: +${changes.MAO_DE_OBRA || 0}`);
    console.log(`  → EQUIPAMENTO: +${changes.EQUIPAMENTO || 0}`);
    console.log(`  → SERVICO: +${changes.SERVICO || 0}`);
    console.log(`  → MATERIAL: +${changes.MATERIAL || 0}`);
    if (dryRun) console.log('\n⚠️  DRY RUN — nenhuma alteração foi gravada');
    console.log('');

    await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
