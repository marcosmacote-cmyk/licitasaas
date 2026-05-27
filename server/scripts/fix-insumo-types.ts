/**
 * fix-insumo-types.ts — Script de Correção de Tipos de Insumos
 *
 * Percorre todos os EngineeringItem de bases PROPRIA_*,
 * aplica o classificador inteligente e corrige tipos errados.
 *
 * Uso: npx tsx server/scripts/fix-insumo-types.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';

// Inline classifier to avoid import path issues in script context
type InsumoCategoria = 'MATERIAL' | 'MAO_DE_OBRA' | 'EQUIPAMENTO' | 'SERVICO';

const DICTIONARY: Record<InsumoCategoria, string[]> = {
    MAO_DE_OBRA: [
        'pedreiro', 'servente', 'mestre de obras', 'eletricista', 'encanador',
        'pintor', 'carpinteiro', 'armador', 'soldador', 'montador',
        'bombeiro hidraulico', 'bombeiro hidr', 'apontador', 'almoxarife',
        'calceteiro', 'marmorista', 'vidraceiro', 'serralheiro', 'gesseiro',
        'azulejista', 'ladrilhista', 'impermeabilizador',
        'topografo', 'nivelador', 'laboratorista',
        'engenheiro civil', 'engenheiro eletric', 'engenheiro mecanico',
        'tecnico de seguranca', 'tecnico em edificacoes', 'tecnico em eletric',
        'tecnico em eletrotecnic', 'eletrotecnico',
        'encarregado', 'operador de maquina', 'operador de equip',
        'motorista de caminhao', 'motorista',
        'vigia', 'vigilante', 'auxiliar de escritorio',
        'ajudante', 'meio oficial', 'oficial',
        'mao de obra', 'mao-de-obra',
        'encargos complementares', 'encargos sociais',
        'alimentacao - mensalista', 'alimentacao (coletivo',
        'transporte - mensalista', 'transporte (coletivo',
        'mensalista', 'horista',
    ],
    EQUIPAMENTO: [
        'betoneira', 'retroescavadeira', 'escavadeira', 'pa carregadeira',
        'trator', 'motoniveladora', 'rolo compactador', 'rolo compressor',
        'caminhao basculante', 'caminhao carroceria', 'caminhao pipa',
        'caminhao munk', 'caminhao munck',
        'caminhonete', 'caminhoneta', 'veiculo utilitario',
        'veiculo com um cesto', 'cesto aereo',
        'vibrador de imersao', 'vibrador de concreto',
        'compactador de solos', 'placa vibratoria',
        'guindaste', 'guincho', 'grua',
        'bomba de concreto', 'bomba submersivel',
        'compressor de ar', 'gerador de energia', 'gerador eletric',
        'serra circular', 'serra eletrica',
        'martelete', 'martelo demolidor',
        'andaime metalico', 'andaime tubular',
        'plataforma elevatoria', 'carrinho de mao',
        'equipamento', 'aluguel de', 'locacao de',
    ],
    MATERIAL: [
        'cimento portland', 'cimento', 'areia media', 'areia fina', 'areia grossa',
        'brita 1', 'brita 2', 'brita 0', 'brita graduada',
        'concreto usinado', 'concreto fck', 'concreto magro',
        'argamassa colante', 'argamassa industrializada',
        'tijolo ceramico', 'tijolo macico', 'bloco ceramico', 'bloco de concreto',
        'aco ca-50', 'aco ca-60', 'vergalhao', 'barra de aco',
        'tela de aco', 'tela soldada', 'arame recozido',
        'prego', 'parafuso',
        'tinta latex', 'tinta acrilica', 'tinta esmalte',
        'massa corrida', 'massa acrilica', 'selador', 'verniz',
        'piso ceramico', 'azulejo', 'porcelanato',
        'tubo pvc', 'tubo de pvc', 'tubo de ferro',
        'fio de cobre', 'cabo de cobre', 'cabo flexivel', 'cabo eletric',
        'eletroduto', 'disjuntor', 'tomada', 'interruptor',
        'rele fotoeletrico', 'reator', 'lampada', 'luminaria', 'refletor',
        'conector', 'terminal',
        'plaqueta de identificacao',
        'madeira de lei', 'tabua', 'sarrafo', 'pontalete',
        'manta asfaltica', 'impermeabilizante',
        'telha fibrocimento', 'telha ceramica',
        'porta de madeira', 'janela de aluminio',
        'vaso sanitario', 'lavatorio',
        'cabo de cobre', 'cabo pp', 'cabo sintenax',
    ],
    SERVICO: [
        'taxa', 'emolumento', 'licenca', 'alvara',
        'consultoria', 'projeto', 'laudo',
        'verba', 'franquia',
        'administracao local', 'administracao central',
    ],
};

const LABOR_UNITS = new Set(['H', 'HORA', 'HH', 'H/H', 'DIA', 'MES', 'MÊS', 'MESES']);

function normalizeText(text: string): string {
    return (text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function classifyType(description: string, unit: string): { type: InsumoCategoria; confidence: string; keyword?: string } {
    const normalizedDesc = normalizeText(description);
    const normalizedUnit = (unit || '').toUpperCase().trim();

    const categoryOrder: InsumoCategoria[] = ['MAO_DE_OBRA', 'EQUIPAMENTO', 'MATERIAL', 'SERVICO'];
    for (const category of categoryOrder) {
        for (const keyword of DICTIONARY[category]) {
            if (normalizedDesc.includes(normalizeText(keyword))) {
                return { type: category, confidence: 'HIGH', keyword };
            }
        }
    }

    if (LABOR_UNITS.has(normalizedUnit)) {
        const hasEquipHint = normalizedDesc.includes('aluguel') || normalizedDesc.includes('veiculo') || normalizedDesc.includes('caminhao');
        return { type: hasEquipHint ? 'EQUIPAMENTO' : 'MAO_DE_OBRA', confidence: 'MEDIUM' };
    }

    return { type: 'MATERIAL', confidence: 'LOW' };
}

async function main() {
    const isDryRun = process.argv.includes('--dry-run');
    const prisma = new PrismaClient();

    console.log(`\n🔧 Fix Insumo Types ${isDryRun ? '(DRY RUN)' : '(LIVE)'}\n${'='.repeat(60)}`);

    try {
        // Find all PROPRIA databases
        const propriaDbs = await prisma.engineeringDatabase.findMany({
            where: { name: { startsWith: 'PROPRIA' } },
            select: { id: true, name: true },
        });

        console.log(`📊 Found ${propriaDbs.length} PROPRIA databases\n`);

        let totalChecked = 0;
        let totalFixed = 0;
        const fixes: Array<{ dbName: string; code: string; desc: string; oldType: string; newType: string; keyword?: string }> = [];

        for (const db of propriaDbs) {
            const items = await prisma.engineeringItem.findMany({
                where: { databaseId: db.id },
                select: { id: true, code: true, description: true, unit: true, type: true },
            });

            for (const item of items) {
                totalChecked++;
                const classification = classifyType(item.description, item.unit);

                if (classification.confidence === 'HIGH' && classification.type !== item.type) {
                    fixes.push({
                        dbName: db.name,
                        code: item.code,
                        desc: item.description.substring(0, 60),
                        oldType: item.type,
                        newType: classification.type,
                        keyword: classification.keyword,
                    });

                    if (!isDryRun) {
                        await prisma.engineeringItem.update({
                            where: { id: item.id },
                            data: { type: classification.type },
                        });
                    }
                    totalFixed++;
                }
            }
        }

        console.log(`\n📋 Results:\n${'─'.repeat(40)}`);
        console.log(`Total items checked: ${totalChecked}`);
        console.log(`Items reclassified:  ${totalFixed}`);

        if (fixes.length > 0) {
            console.log(`\n🔄 Reclassifications:\n${'─'.repeat(80)}`);
            for (const fix of fixes) {
                console.log(`  [${fix.dbName}] ${fix.code}: ${fix.oldType} → ${fix.newType} (keyword: "${fix.keyword}") — "${fix.desc}"`);
            }
        }

        if (isDryRun) {
            console.log(`\n⚠️  DRY RUN — no changes made. Run without --dry-run to apply fixes.`);
        } else {
            console.log(`\n✅ ${totalFixed} items updated successfully.`);
        }
    } catch (e: any) {
        console.error('❌ Error:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

main();
