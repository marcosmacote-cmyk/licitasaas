import { prisma } from '../../lib/prisma';
import { enrichWithOfficialPrices } from './priceEnricher';

export interface ReconciliationAlert {
    id: string;
    itemId?: string;
    itemNumber?: string;
    code?: string;
    description?: string;
    type: 'BUDGET_COMPOSITION_MISMATCH' | 'COMPOSITION_ITEMS_SUM_MISMATCH' | 'BUDGET_MATH_INCONSISTENCY' | 'EMPTY_PROPRIA_WITH_PRICE' | 'OFFICIAL_BASE_OUT_OF_SYNC';
    severity: 'CRITICAL' | 'WARNING' | 'INFO';
    message: string;
    expectedValue: number | string;
    actualValue: number | string;
    suggestedAction: {
        label: string;
        actionType: 'SYNC_BUDGET_UNIT_COST' | 'RECALCULATE_ITEM_MATH' | 'ZERO_COMPOSITION_AND_ITEM' | 'SYNC_WITH_OFFICIAL_BASE';
    };
}

export interface ReconciliationReport {
    alerts: ReconciliationAlert[];
    summary: {
        totalAlerts: number;
        criticalCount: number;
        warningCount: number;
        infoCount: number;
        reconciliationScore: number; // 0 to 100
    };
}

// Helper function to apply precision math matching calculationEngine.ts
function applyPrecision(value: number, config: any): number {
    const dec = config?.casasDecimais ?? 2;
    const factor = Math.pow(10, dec);
    if (config?.tipo === 'TRUNCATE') {
        return Math.floor(value * factor + 1e-9) / factor;
    }
    return Math.round(value * factor) / factor;
}

export async function getReconciliationReport(proposalId: string, tenantId: string): Promise<ReconciliationReport> {
    const proposal = await prisma.priceProposal.findUnique({
        where: { id: proposalId },
        select: {
            bdiConfig: true,
            engineeringConfig: true,
            bdiPercentage: true,
        }
    });

    if (!proposal) {
        throw new Error('Proposta não encontrada');
    }

    const bdiConfig = (proposal.bdiConfig as any) || {};
    const engineeringConfig = (proposal.engineeringConfig as any) || {};
    const precisionConfig = engineeringConfig.precision || { tipo: 'ROUND', casasDecimais: 2 };
    
    // Resolve BDI
    const bdiGlobal = Number(bdiConfig.bdiGlobal) || Number(proposal.bdiPercentage) || 0;
    const bdiDiferenciado = !!engineeringConfig.bdiDiferenciado;
    const bdiFornecimento = Number(engineeringConfig.bdiFornecimento) || 0;

    const items = await prisma.engineeringProposalItem.findMany({
        where: { proposalId },
        orderBy: { sortOrder: 'asc' }
    });

    const billableItems = items.filter(it => it.type !== 'ETAPA' && it.type !== 'SUBETAPA');
    const alerts: ReconciliationAlert[] = [];

    // 1. Fetch own/custom compositions
    const propriaDbName = `PROPRIA_${proposalId}`;
    const customComps = await prisma.engineeringComposition.findMany({
        where: {
            database: {
                name: propriaDbName,
                tenantId
            }
        },
        include: {
            items: true
        }
    });

    const customCompsMap = new Map<string, typeof customComps[0]>();
    for (const comp of customComps) {
        customCompsMap.set(comp.code, comp);
    }

    // 2. Run price enrichment to verify official database matches and pricing drift
    const itemsForEnrichment = billableItems.map(it => ({
        code: it.code,
        sourceName: it.sourceName,
        unitCost: it.unitCost,
        type: it.type,
        description: it.description,
        priceAudit: it.priceAudit
    }));
    await enrichWithOfficialPrices(itemsForEnrichment, engineeringConfig, { tenantId, proposalId });
    const enrichedMap = new Map<string, any>();
    for (const enriched of itemsForEnrichment) {
        if (enriched.code) {
            enrichedMap.set(enriched.code, enriched);
        }
    }

    // 3. Scan each item for inconsistencies
    for (const item of billableItems) {
        const isPropria = item.sourceName === 'PROPRIA' || item.sourceName.startsWith('PROPRIA_');

        // A. Check for Empty custom composition with active price
        if (isPropria && item.type === 'COMPOSICAO') {
            const comp = customCompsMap.get(item.code || '');
            const hasNoLines = !comp || !comp.items || comp.items.length === 0;
            if (hasNoLines && item.unitCost > 0) {
                alerts.push({
                    id: `empty-propria-${item.id}`,
                    itemId: item.id,
                    itemNumber: item.itemNumber,
                    code: item.code || undefined,
                    description: item.description,
                    type: 'EMPTY_PROPRIA_WITH_PRICE',
                    severity: 'CRITICAL',
                    message: `A composição própria "${item.code}" está vazia no editor, mas o item orçamentário ainda exibe preço ativo de R$ ${item.unitCost.toFixed(2)}.`,
                    expectedValue: 0,
                    actualValue: item.unitCost,
                    suggestedAction: {
                        label: 'Zerar preço do item',
                        actionType: 'ZERO_COMPOSITION_AND_ITEM'
                    }
                });
                continue; // Skip further checks as item price should be zero
            }
        }

        // B. Check for Custom Composition vs. Budget Unit Cost mismatch
        if (isPropria && item.type === 'COMPOSICAO') {
            const comp = customCompsMap.get(item.code || '');
            if (comp && comp.items.length > 0) {
                const compSum = comp.items.reduce((s, ci) => s + (Number(ci.price) || 0), 0);
                const roundedCompSum = applyPrecision(compSum, precisionConfig);
                
                // Compare composition sum to budget unitCost
                if (Math.abs(item.unitCost - roundedCompSum) > 0.01) {
                    alerts.push({
                        id: `budget-comp-mismatch-${item.id}`,
                        itemId: item.id,
                        itemNumber: item.itemNumber,
                        code: item.code || undefined,
                        description: item.description,
                        type: 'BUDGET_COMPOSITION_MISMATCH',
                        severity: 'CRITICAL',
                        message: `O custo unitário R$ ${item.unitCost.toFixed(2)} do item diverge da soma real de sua composição própria R$ ${roundedCompSum.toFixed(2)}.`,
                        expectedValue: roundedCompSum,
                        actualValue: item.unitCost,
                        suggestedAction: {
                            label: 'Atualizar planilha com o valor da composição',
                            actionType: 'SYNC_BUDGET_UNIT_COST'
                        }
                    });
                }

                // Compare composition sum to composition.totalPrice field (internal sync check)
                if (Math.abs(comp.totalPrice - roundedCompSum) > 0.01) {
                    alerts.push({
                        id: `comp-items-mismatch-${comp.id}`,
                        itemId: item.id,
                        itemNumber: item.itemNumber,
                        code: item.code || undefined,
                        description: item.description,
                        type: 'COMPOSICAO_ITEMS_SUM_MISMATCH' as any, // mapping to COMPOSITION_ITEMS_SUM_MISMATCH
                        severity: 'WARNING',
                        message: `O campo totalPrice R$ ${comp.totalPrice.toFixed(2)} da composição própria "${comp.code}" diverge da soma de suas linhas R$ ${roundedCompSum.toFixed(2)}.`,
                        expectedValue: roundedCompSum,
                        actualValue: comp.totalPrice,
                        suggestedAction: {
                            label: 'Atualizar planilha com o valor da composição',
                            actionType: 'SYNC_BUDGET_UNIT_COST' // will re-sum and save
                        }
                    });
                }
            }
        }

        // C. Check for Official Base price drift
        if (!isPropria && item.code) {
            const enriched = enrichedMap.get(item.code);
            const matchedPrice = enriched?.priceAudit?.matchedUnitCost;
            if (matchedPrice !== undefined && matchedPrice !== null && Math.abs(item.unitCost - matchedPrice) > 0.01) {
                alerts.push({
                    id: `base-drift-${item.id}`,
                    itemId: item.id,
                    itemNumber: item.itemNumber,
                    code: item.code,
                    description: item.description,
                    type: 'OFFICIAL_BASE_OUT_OF_SYNC',
                    severity: 'WARNING',
                    message: `O custo unitário R$ ${item.unitCost.toFixed(2)} diverge do preço atual de R$ ${matchedPrice.toFixed(2)} na base oficial ${item.sourceName} (${enriched.priceAudit.matchedReference || 'Referência'}).`,
                    expectedValue: matchedPrice,
                    actualValue: item.unitCost,
                    suggestedAction: {
                        label: 'Atualizar para preço da base oficial',
                        actionType: 'SYNC_WITH_OFFICIAL_BASE'
                    }
                });
            }
        }

        // D. Check for Line Math Inconsistency (unitPrice & totalPrice matching quantity, BDI, discount)
        const itemBdi = bdiDiferenciado && item.bdiCategoria === 'FORNECIMENTO' ? bdiFornecimento : bdiGlobal;
        const expectedUpWithoutDiscount = applyPrecision(item.unitCost * (1 + itemBdi / 100), precisionConfig);
        const expectedUnitPrice = applyPrecision(expectedUpWithoutDiscount * (1 - (item.discount || 0) / 100), precisionConfig);
        const expectedTotalPrice = applyPrecision(item.quantity * expectedUnitPrice, precisionConfig);

        const priceDrift = Math.abs(item.unitPrice - expectedUnitPrice) > 0.01;
        const totalDrift = Math.abs(item.totalPrice - expectedTotalPrice) > 0.01;

        if (priceDrift || totalDrift) {
            const detailMsg = priceDrift 
                ? `Preço unitário R$ ${item.unitPrice.toFixed(2)} diverge de R$ ${expectedUnitPrice.toFixed(2)} (BDI ${itemBdi}%, desc ${item.discount || 0}%)`
                : `Preço total R$ ${item.totalPrice.toFixed(2)} diverge de R$ ${expectedTotalPrice.toFixed(2)} (Qtd ${item.quantity} × R$ ${item.unitPrice.toFixed(2)})`;
            
            alerts.push({
                id: `math-drift-${item.id}`,
                itemId: item.id,
                itemNumber: item.itemNumber,
                code: item.code || undefined,
                description: item.description,
                type: 'BUDGET_MATH_INCONSISTENCY',
                severity: 'INFO',
                message: `Erro aritmético no item: ${detailMsg}.`,
                expectedValue: expectedTotalPrice,
                actualValue: item.totalPrice,
                suggestedAction: {
                    label: 'Recalcular matemática do item',
                    actionType: 'RECALCULATE_ITEM_MATH'
                }
            });
        }
    }

    // 4. Calculate health scores
    const criticalCount = alerts.filter(a => a.severity === 'CRITICAL').length;
    const warningCount = alerts.filter(a => a.severity === 'WARNING').length;
    const infoCount = alerts.filter(a => a.severity === 'INFO').length;

    // Reconciliation Score calculation:
    // Start at 100.
    // Critical alerts deduct 10 points each (min 0).
    // Warning alerts deduct 4 points each.
    // Info alerts deduct 1 point each.
    const deductions = (criticalCount * 12) + (warningCount * 5) + (infoCount * 1.5);
    const reconciliationScore = Math.max(0, Math.min(100, Math.round(100 - deductions)));

    return {
        alerts,
        summary: {
            totalAlerts: alerts.length,
            criticalCount,
            warningCount,
            infoCount,
            reconciliationScore
        }
    };
}

export async function reconcileProposal(
    proposalId: string,
    tenantId: string,
    actionType: string,
    alertId?: string
): Promise<{ success: boolean; resolvedCount: number }> {
    // Validate proposal
    const proposal = await prisma.priceProposal.findUnique({
        where: { id: proposalId },
        select: {
            bdiConfig: true,
            engineeringConfig: true,
            bdiPercentage: true,
        }
    });

    if (!proposal) {
        throw new Error('Proposta não encontrada');
    }

    const bdiConfig = (proposal.bdiConfig as any) || {};
    const engineeringConfig = (proposal.engineeringConfig as any) || {};
    const precisionConfig = engineeringConfig.precision || { tipo: 'ROUND', casasDecimais: 2 };
    
    // Resolve BDI
    const bdiGlobal = Number(bdiConfig.bdiGlobal) || Number(proposal.bdiPercentage) || 0;
    const bdiDiferenciado = !!engineeringConfig.bdiDiferenciado;
    const bdiFornecimento = Number(engineeringConfig.bdiFornecimento) || 0;

    // Fetch report to get exact alerts we need to fix
    const report = await getReconciliationReport(proposalId, tenantId);
    let alertsToFix = report.alerts;

    // If a specific alertId is provided, filter for only that alert
    if (alertId) {
        alertsToFix = report.alerts.filter(a => a.id === alertId);
    }

    if (alertsToFix.length === 0) {
        return { success: true, resolvedCount: 0 };
    }

    let resolvedCount = 0;

    await prisma.$transaction(async (tx) => {
        for (const alert of alertsToFix) {
            const itemId = alert.itemId;
            if (!itemId) continue;

            const item = await tx.engineeringProposalItem.findUnique({ where: { id: itemId } });
            if (!item) continue;

            const itemBdi = bdiDiferenciado && item.bdiCategoria === 'FORNECIMENTO' ? bdiFornecimento : bdiGlobal;

            if (alert.type === 'EMPTY_PROPRIA_WITH_PRICE' || alert.suggestedAction.actionType === 'ZERO_COMPOSITION_AND_ITEM') {
                // Set cost and totals to 0
                await tx.engineeringProposalItem.update({
                    where: { id: itemId },
                    data: {
                        unitCost: 0,
                        unitPrice: 0,
                        totalPrice: 0,
                        compositionTotalPrice: 0,
                    }
                });
                resolvedCount++;
            } 
            else if (alert.type === 'BUDGET_COMPOSITION_MISMATCH' || alert.type === 'COMPOSITION_ITEMS_SUM_MISMATCH' || alert.suggestedAction.actionType === 'SYNC_BUDGET_UNIT_COST') {
                const targetValue = Number(alert.expectedValue);
                
                // 1. Sync custom composition's totalPrice in database
                const propriaDbName = `PROPRIA_${proposalId}`;
                const comp = await tx.engineeringComposition.findFirst({
                    where: {
                        code: item.code || '',
                        database: { name: propriaDbName, tenantId }
                    }
                });
                if (comp) {
                    await tx.engineeringComposition.update({
                        where: { id: comp.id },
                        data: { totalPrice: targetValue }
                    });
                }

                // 2. Sync proposal item's unitCost, then recalculate item math
                const expectedUpWithoutDiscount = applyPrecision(targetValue * (1 + itemBdi / 100), precisionConfig);
                const expectedUnitPrice = applyPrecision(expectedUpWithoutDiscount * (1 - (item.discount || 0) / 100), precisionConfig);
                const expectedTotalPrice = applyPrecision(item.quantity * expectedUnitPrice, precisionConfig);

                await tx.engineeringProposalItem.update({
                    where: { id: itemId },
                    data: {
                        unitCost: targetValue,
                        compositionTotalPrice: targetValue,
                        unitPrice: expectedUnitPrice,
                        totalPrice: expectedTotalPrice,
                    }
                });
                resolvedCount++;
            } 
            else if (alert.type === 'OFFICIAL_BASE_OUT_OF_SYNC' || alert.suggestedAction.actionType === 'SYNC_WITH_OFFICIAL_BASE') {
                const targetValue = Number(alert.expectedValue);

                const expectedUpWithoutDiscount = applyPrecision(targetValue * (1 + itemBdi / 100), precisionConfig);
                const expectedUnitPrice = applyPrecision(expectedUpWithoutDiscount * (1 - (item.discount || 0) / 100), precisionConfig);
                const expectedTotalPrice = applyPrecision(item.quantity * expectedUnitPrice, precisionConfig);

                await tx.engineeringProposalItem.update({
                    where: { id: itemId },
                    data: {
                        unitCost: targetValue,
                        unitPrice: expectedUnitPrice,
                        totalPrice: expectedTotalPrice,
                    }
                });
                resolvedCount++;
            }
            else if (alert.type === 'BUDGET_MATH_INCONSISTENCY' || alert.suggestedAction.actionType === 'RECALCULATE_ITEM_MATH') {
                const expectedUpWithoutDiscount = applyPrecision(item.unitCost * (1 + itemBdi / 100), precisionConfig);
                const expectedUnitPrice = applyPrecision(expectedUpWithoutDiscount * (1 - (item.discount || 0) / 100), precisionConfig);
                const expectedTotalPrice = applyPrecision(item.quantity * expectedUnitPrice, precisionConfig);

                await tx.engineeringProposalItem.update({
                    where: { id: itemId },
                    data: {
                        unitPrice: expectedUnitPrice,
                        totalPrice: expectedTotalPrice,
                    }
                });
                resolvedCount++;
            }
        }

        // Recalculate priceProposal's totalValue based on recalculated items
        const allItems = await tx.engineeringProposalItem.findMany({
            where: { proposalId }
        });
        const totalValue = allItems
            .filter((it: any) => it.type !== 'ETAPA' && it.type !== 'SUBETAPA')
            .reduce((sum: number, it: any) => sum + (Number(it.totalPrice) || 0), 0);

        await tx.priceProposal.update({
            where: { id: proposalId },
            data: { totalValue }
        });
    });

    return { success: true, resolvedCount };
}
