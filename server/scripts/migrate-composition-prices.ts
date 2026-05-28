/**
 * migrate-composition-prices.ts — Script de migração CASCA-FIX
 *
 * Migra propostas existentes para a nova arquitetura de preços:
 * 1. Copia unitCost atual → editalUnitCost (referência histórica)
 * 2. Busca composição PRÓPRIA no banco → compositionTotalPrice = composição.totalPrice
 * 3. Se composição tem itens → unitCost = composição.totalPrice (preço formado)
 * 4. Se composição não tem itens → unitCost mantido (será tratado como CASCA no frontend)
 *
 * USO:
 *   npx tsx server/scripts/migrate-composition-prices.ts          # dry-run (default)
 *   npx tsx server/scripts/migrate-composition-prices.ts --apply  # executa alterações
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const isDryRun = !process.argv.includes('--apply');

async function main() {
    console.log(`\n🔧 CASCA-FIX Migration ${isDryRun ? '(DRY RUN — nenhuma alteração será feita)' : '⚠️  APLICANDO ALTERAÇÕES'}\n`);

    // 1. Find all COMPOSICAO items from all proposals
    const items = await prisma.engineeringProposalItem.findMany({
        where: {
            type: 'COMPOSICAO',
            // Only process items that haven't been migrated yet
            editalUnitCost: null,
        },
        select: {
            id: true,
            code: true,
            sourceName: true,
            unitCost: true,
            proposalId: true,
            description: true,
        },
        orderBy: { proposalId: 'asc' },
    });

    console.log(`📊 Encontrados ${items.length} itens COMPOSICAO sem editalUnitCost\n`);

    if (items.length === 0) {
        console.log('✅ Nenhum item para migrar. Todas as composições já foram processadas.');
        return;
    }

    // Group by proposal for logging
    const byProposal = new Map<string, typeof items>();
    for (const item of items) {
        const list = byProposal.get(item.proposalId) || [];
        list.push(item);
        byProposal.set(item.proposalId, list);
    }

    let totalMigrated = 0;
    let totalWithComposition = 0;
    let totalCascas = 0;

    for (const [proposalId, proposalItems] of byProposal) {
        console.log(`\n📋 Proposta ${proposalId} — ${proposalItems.length} composições`);

        for (const item of proposalItems) {
            const isPropria = !item.sourceName || item.sourceName === 'PROPRIA' || item.sourceName.startsWith('PROPRIA_');

            if (!isPropria) {
                // Oficial: apenas registrar editalUnitCost, sem alterar unitCost
                console.log(`  📌 [OFICIAL] ${item.code} "${item.description?.substring(0, 50)}" — unitCost=${item.unitCost} → editalUnitCost=${item.unitCost}`);
                if (!isDryRun) {
                    await prisma.engineeringProposalItem.update({
                        where: { id: item.id },
                        data: { editalUnitCost: item.unitCost },
                    });
                }
                totalMigrated++;
                continue;
            }

            // PRÓPRIA: buscar composição no banco
            let compositionTotal: number | null = null;
            let hasItems = false;

            if (item.code) {
                const composition = await prisma.engineeringComposition.findFirst({
                    where: {
                        code: item.code,
                        database: {
                            OR: [
                                { name: 'PROPRIA' },
                                { name: { startsWith: 'PROPRIA_' } },
                                { type: 'PROPRIA' },
                            ],
                        },
                    },
                    include: {
                        items: { select: { id: true } },
                    },
                });

                if (composition) {
                    compositionTotal = Number(composition.totalPrice) || 0;
                    hasItems = composition.items.length > 0;
                }
            }

            if (hasItems && compositionTotal !== null && compositionTotal > 0) {
                // Composição com itens: unitCost = preço formado
                console.log(`  ✅ [FORMADA] ${item.code} "${item.description?.substring(0, 50)}" — editalUnitCost=${item.unitCost}, compositionTotalPrice=${compositionTotal}, unitCost: ${item.unitCost} → ${compositionTotal}`);
                if (!isDryRun) {
                    await prisma.engineeringProposalItem.update({
                        where: { id: item.id },
                        data: {
                            editalUnitCost: item.unitCost,
                            compositionTotalPrice: compositionTotal,
                            // unitCost NÃO é alterado aqui — o recalcAllItems do frontend
                            // vai usar compositionTotalPrice automaticamente
                        },
                    });
                }
                totalWithComposition++;
            } else {
                // Sem composição ou sem itens: é CASCA
                console.log(`  ⚠️  [CASCA]  ${item.code} "${item.description?.substring(0, 50)}" — editalUnitCost=${item.unitCost}, sem composição formada`);
                if (!isDryRun) {
                    await prisma.engineeringProposalItem.update({
                        where: { id: item.id },
                        data: {
                            editalUnitCost: item.unitCost,
                            // compositionTotalPrice permanece null → frontend tratará como CASCA
                        },
                    });
                }
                totalCascas++;
            }
            totalMigrated++;
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 Resumo da Migração${isDryRun ? ' (DRY RUN)' : ''}:`);
    console.log(`   Total de itens processados: ${totalMigrated}`);
    console.log(`   Com composição formada:     ${totalWithComposition}`);
    console.log(`   CASCAs (sem composição):    ${totalCascas}`);
    console.log(`   Oficiais (apenas ref):      ${totalMigrated - totalWithComposition - totalCascas}`);
    console.log(`${'='.repeat(60)}\n`);

    if (isDryRun) {
        console.log('ℹ️  Execute com --apply para aplicar as alterações:');
        console.log('   npx tsx server/scripts/migrate-composition-prices.ts --apply\n');
    } else {
        console.log('✅ Migração aplicada com sucesso!\n');
    }
}

main()
    .catch(e => {
        console.error('❌ Erro na migração:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
