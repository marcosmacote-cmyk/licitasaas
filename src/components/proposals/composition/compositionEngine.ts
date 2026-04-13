/**
 * Composição de Preços Unitários — Engine de Cálculo
 */

import type { CostCompositionLine, CompositionTotals, ItemCostComposition, CostGroup } from './types';

const DIRECT_GROUPS: CostGroup[] = [
    'MATERIAL', 'MAO_DE_OBRA', 'EQUIPAMENTO', 'FRETE', 'TERCEIROS', 'OUTRO',
];

const INDIRECT_GROUPS: CostGroup[] = [
    'ADMIN_CENTRAL', 'CUSTOS_FINANCEIROS', 'SEGUROS', 'RISCOS', 'DESPESAS_OPERACIONAIS',
];

/** Calcula o totalValue de uma linha */
export function calcLineTotal(line: CostCompositionLine): number {
    return Math.round(line.quantity * line.unitValue * 100) / 100;
}

/** Interface de Auditoria Financeira Estrita */
export interface FinancialMutationAudit {
    action: 'add_line' | 'update_line' | 'remove_line' | 'recalc' | 'apply_discount' | 'sync_with_proposal';
    itemId: string;
    oldValue?: number;
    newValue?: number;
    details: any;
    timestamp: string;
}

/** Logger Atômico de Mutações Financeiras (Governança) */
export const logFinancialMutation = (mutation: FinancialMutationAudit) => {
    if (process.env.NODE_ENV !== 'test') {
        console.info(`[Financial-Audit] [${mutation.timestamp}] Ação: ${mutation.action} | Item: ${mutation.itemId}`, mutation.details);
    }
};

/** Recalcula todos os totalValue das linhas e retorna a composição atualizada */
export function recalcComposition(comp: ItemCostComposition): ItemCostComposition {
    const recalculated = comp.lines.map(l => ({ ...l, totalValue: calcLineTotal(l) }));
    
    // Calcula o total antigo e novo para registro de auditoria atômico
    const oldGrandTotal = comp.lines.reduce((s, l) => s + (l.totalValue || 0), 0);
    const newGrandTotal = recalculated.reduce((s, l) => s + l.totalValue, 0);

    if (oldGrandTotal !== newGrandTotal) {
        logFinancialMutation({
            action: 'recalc',
            itemId: comp.itemId,
            oldValue: oldGrandTotal,
            newValue: newGrandTotal,
            details: { message: 'Engine recalculou composição completa', diff: newGrandTotal - oldGrandTotal },
            timestamp: new Date().toISOString()
        });
    }

    return {
        ...comp,
        lines: recalculated,
    };
}

/** Calcula os totais da composição */
export function calculateCompositionTotals(lines: CostCompositionLine[]): CompositionTotals {
    const totalDirect = lines
        .filter(l => DIRECT_GROUPS.includes(l.group))
        .reduce((sum, l) => sum + l.totalValue, 0);

    const totalIndirect = lines
        .filter(l => INDIRECT_GROUPS.includes(l.group))
        .reduce((sum, l) => sum + l.totalValue, 0);

    const totalTaxes = lines
        .filter(l => l.group === 'TRIBUTOS')
        .reduce((sum, l) => sum + l.totalValue, 0);

    const profit = lines
        .filter(l => l.group === 'LUCRO')
        .reduce((sum, l) => sum + l.totalValue, 0);

    const grandTotal = Math.round((totalDirect + totalIndirect + totalTaxes + profit) * 100) / 100;

    const bdiImplicit = totalDirect > 0
        ? Math.round(((grandTotal - totalDirect) / totalDirect) * 10000) / 100
        : 0;

    return { totalDirect, totalIndirect, totalTaxes, profit, grandTotal, bdiImplicit };
}

/** Calcula totais por grupo */
export function totalsByGroup(lines: CostCompositionLine[]): Record<CostGroup, number> {
    const result = {} as Record<CostGroup, number>;
    for (const line of lines) {
        result[line.group] = (result[line.group] || 0) + line.totalValue;
    }
    return result;
}

/** Gera um ID único para linhas */
export function generateLineId(): string {
    return `cl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Cria uma composição vazia para um item */
export function createEmptyComposition(itemId: string): ItemCostComposition {
    return { itemId, lines: [] };
}

/** Serializa composição para JSON (para salvar no campo costComposition) */
export function serializeComposition(comp: ItemCostComposition): string {
    return JSON.stringify(comp);
}

/** Desserializa composição do JSON */
export function deserializeComposition(json: string | undefined | null, itemId: string): ItemCostComposition {
    if (!json) return createEmptyComposition(itemId);
    try {
        const parsed = JSON.parse(json);
        return { ...parsed, itemId };
    } catch {
        return createEmptyComposition(itemId);
    }
}
