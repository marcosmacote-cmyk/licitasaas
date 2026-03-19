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

/** Recalcula todos os totalValue das linhas e retorna a composição atualizada */
export function recalcComposition(comp: ItemCostComposition): ItemCostComposition {
    return {
        ...comp,
        lines: comp.lines.map(l => ({ ...l, totalValue: calcLineTotal(l) })),
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
