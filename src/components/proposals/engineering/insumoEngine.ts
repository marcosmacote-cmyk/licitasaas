/**
 * insumoEngine.ts — Motor de Consolidação de Insumos
 * 
 * Consolida todos os insumos das composições do orçamento,
 * agrupa por categoria, aplica descontos e recalcula totais.
 */

// ═══════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════

export type InsumoCategoria = 'MATERIAL' | 'MAO_DE_OBRA' | 'EQUIPAMENTO' | 'SERVICO';

export interface InsumoConsolidado {
    id: string;                       // Unique key: "code_databaseId" or generated
    codigo: string;
    descricao: string;
    categoria: InsumoCategoria;
    unidade: string;
    precoOriginal: number;            // Preço da base oficial
    desconto: number;                 // % de desconto aplicado
    precoFinal: number;               // precoOriginal × (1 - desconto/100)
    base: string;                     // SINAPI, SEINFRA, PRÓPRIA
    composicoesVinculadas: string[];  // Codes das composições que usam
    coeficienteTotal: number;         // Soma de coeficientes em todas as composições
    custoTotal: number;               // precoFinal × coeficienteTotal (across all compositions × quantities)
    abcClass?: 'A' | 'B' | 'C';      // Classificação ABC
}

export interface DescontoConfig {
    descontoGlobal: number;           // % aplicado a todos
    descontoPorCategoria: Record<InsumoCategoria, number>;
    descontosPorInsumo: Record<string, number>; // insumoId → %
}

export interface InsumoHubStats {
    totalInsumos: number;
    totalCusto: number;
    custoMaterial: number;
    custoMaoDeObra: number;
    custoEquipamento: number;
    custoServico: number;
    descontoMedio: number;
    economiaTotalDesconto: number;
}

export interface InsumoRaw {
    insumoCode: string;
    insumoDescription: string;
    insumoUnit: string;
    insumoPrice: number;
    insumoType: string;
    coefficient: number;
    compositionCode: string;
    compositionDescription: string;
    base: string;
    serviceQuantity: number;          // Quantity of the parent service in the proposal
}

// ═══════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════

export const CATEGORIA_META: Record<InsumoCategoria, { label: string; color: string; icon: string; bgLight: string }> = {
    MATERIAL:     { label: 'Material',        color: '#2563eb', icon: '📦', bgLight: 'rgba(37,99,235,0.08)' },
    MAO_DE_OBRA:  { label: 'Mão de Obra',     color: '#7c3aed', icon: '👷', bgLight: 'rgba(124,58,237,0.08)' },
    EQUIPAMENTO:  { label: 'Equipamento',     color: '#0891b2', icon: '🔧', bgLight: 'rgba(8,145,178,0.08)' },
    SERVICO:      { label: 'Serviço',         color: '#059669', icon: '🏗️', bgLight: 'rgba(5,150,105,0.08)' },
};

export const DEFAULT_DESCONTO_CONFIG: DescontoConfig = {
    descontoGlobal: 0,
    descontoPorCategoria: { MATERIAL: 0, MAO_DE_OBRA: 0, EQUIPAMENTO: 0, SERVICO: 0 },
    descontosPorInsumo: {},
};

// ═══════════════════════════════════════════════════════════
// CONSOLIDAÇÃO
// ═══════════════════════════════════════════════════════════

/**
 * Consolida insumos brutos (da API) em lista agrupada por código.
 * Cada insumo aparece UMA vez, com soma dos coeficientes ponderados.
 */
export function consolidateInsumos(
    rawInsumos: InsumoRaw[],
    descontoConfig: DescontoConfig,
): InsumoConsolidado[] {
    const map = new Map<string, InsumoConsolidado>();

    for (const raw of rawInsumos) {
        const key = raw.insumoCode.toUpperCase();
        const categoria = normalizeCategoria(raw.insumoType);
        const existing = map.get(key);

        // Weighted coefficient: coefficient × service quantity
        const weightedCoef = raw.coefficient * raw.serviceQuantity;

        if (existing) {
            existing.coeficienteTotal += weightedCoef;
            if (!existing.composicoesVinculadas.includes(raw.compositionCode)) {
                existing.composicoesVinculadas.push(raw.compositionCode);
            }
        } else {
            map.set(key, {
                id: key,
                codigo: raw.insumoCode,
                descricao: raw.insumoDescription,
                categoria,
                unidade: raw.insumoUnit,
                precoOriginal: raw.insumoPrice,
                desconto: 0,
                precoFinal: raw.insumoPrice,
                base: raw.base,
                composicoesVinculadas: [raw.compositionCode],
                coeficienteTotal: weightedCoef,
                custoTotal: 0,
            });
        }
    }

    // Apply discounts and calculate totals
    const result = Array.from(map.values());
    applyDescontos(result, descontoConfig);

    // Calculate ABC classification
    classifyABC(result);

    return result.sort((a, b) => b.custoTotal - a.custoTotal);
}

/**
 * Aplica descontos hierárquicos: Insumo > Categoria > Global
 */
export function applyDescontos(
    insumos: InsumoConsolidado[],
    config: DescontoConfig,
): void {
    for (const ins of insumos) {
        // Priority: per-insumo > per-category > global
        let desconto = config.descontoGlobal;

        const catDesconto = config.descontoPorCategoria[ins.categoria];
        if (catDesconto > 0) desconto = catDesconto;

        const insumoDesconto = config.descontosPorInsumo[ins.id];
        if (insumoDesconto !== undefined && insumoDesconto > 0) desconto = insumoDesconto;

        ins.desconto = desconto;
        ins.precoFinal = Math.round(ins.precoOriginal * (1 - desconto / 100) * 100) / 100;
        ins.custoTotal = Math.round(ins.precoFinal * ins.coeficienteTotal * 100) / 100;
    }
}

/**
 * Classificação ABC (Pareto): A=80%, B=15%, C=5%
 */
export function classifyABC(insumos: InsumoConsolidado[]): void {
    const sorted = [...insumos].sort((a, b) => b.custoTotal - a.custoTotal);
    const total = sorted.reduce((s, i) => s + i.custoTotal, 0);
    if (total === 0) return;

    let accum = 0;
    for (const ins of sorted) {
        accum += ins.custoTotal;
        const pct = (accum / total) * 100;
        if (pct <= 80) ins.abcClass = 'A';
        else if (pct <= 95) ins.abcClass = 'B';
        else ins.abcClass = 'C';
    }
}

/**
 * Calcula estatísticas do Hub
 */
export function calculateHubStats(
    insumos: InsumoConsolidado[],
): InsumoHubStats {
    const totalCusto = insumos.reduce((s, i) => s + i.custoTotal, 0);
    const custoOriginal = insumos.reduce((s, i) => s + i.precoOriginal * i.coeficienteTotal, 0);
    const descontos = insumos.filter(i => i.desconto > 0);
    const descontoMedio = descontos.length > 0
        ? descontos.reduce((s, i) => s + i.desconto, 0) / descontos.length
        : 0;

    return {
        totalInsumos: insumos.length,
        totalCusto: Math.round(totalCusto * 100) / 100,
        custoMaterial: Math.round(insumos.filter(i => i.categoria === 'MATERIAL').reduce((s, i) => s + i.custoTotal, 0) * 100) / 100,
        custoMaoDeObra: Math.round(insumos.filter(i => i.categoria === 'MAO_DE_OBRA').reduce((s, i) => s + i.custoTotal, 0) * 100) / 100,
        custoEquipamento: Math.round(insumos.filter(i => i.categoria === 'EQUIPAMENTO').reduce((s, i) => s + i.custoTotal, 0) * 100) / 100,
        custoServico: Math.round(insumos.filter(i => i.categoria === 'SERVICO').reduce((s, i) => s + i.custoTotal, 0) * 100) / 100,
        descontoMedio: Math.round(descontoMedio * 100) / 100,
        economiaTotalDesconto: Math.round((custoOriginal - totalCusto) * 100) / 100,
    };
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function normalizeCategoria(type: string): InsumoCategoria {
    const upper = (type || '').toUpperCase();
    if (upper.includes('MAO') || upper.includes('MÃO') || upper === 'MAO_DE_OBRA') return 'MAO_DE_OBRA';
    if (upper.includes('EQUIP')) return 'EQUIPAMENTO';
    if (upper.includes('MATERIAL') || upper === 'MATERIAL') return 'MATERIAL';
    return 'SERVICO';
}

/**
 * Filtra insumos por critérios
 */
export function filterInsumos(
    insumos: InsumoConsolidado[],
    filters: {
        categoria?: InsumoCategoria | 'TODOS';
        base?: string;
        search?: string;
        abcClass?: 'A' | 'B' | 'C' | 'TODOS';
    },
): InsumoConsolidado[] {
    let result = insumos;

    if (filters.categoria && filters.categoria !== 'TODOS') {
        result = result.filter(i => i.categoria === filters.categoria);
    }
    if (filters.base && filters.base !== 'TODOS') {
        result = result.filter(i => i.base.toUpperCase() === filters.base!.toUpperCase());
    }
    if (filters.abcClass && filters.abcClass !== 'TODOS') {
        result = result.filter(i => i.abcClass === filters.abcClass);
    }
    if (filters.search) {
        const q = filters.search.toLowerCase();
        result = result.filter(i =>
            i.codigo.toLowerCase().includes(q) ||
            i.descricao.toLowerCase().includes(q)
        );
    }

    return result;
}
