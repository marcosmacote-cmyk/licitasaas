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
    tipoDetalhado?: string;           // Categoria expandida/detalhada (14 tipos)
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
    MATERIAL:     { label: 'Material',        color: '#2563eb', icon: '', bgLight: 'rgba(37,99,235,0.08)' },
    MAO_DE_OBRA:  { label: 'Mão de Obra',     color: '#7c3aed', icon: '', bgLight: 'rgba(124,58,237,0.08)' },
    EQUIPAMENTO:  { label: 'Equipamento',     color: '#0891b2', icon: '', bgLight: 'rgba(8,145,178,0.08)' },
    SERVICO:      { label: 'Serviço',         color: '#059669', icon: '', bgLight: 'rgba(5,150,105,0.08)' },
};

export const EXPANDED_TYPES_META: Record<string, { label: string; color: string; bgLight: string }> = {
    'Equipamento': { label: 'Equipamento', color: '#0891b2', bgLight: 'rgba(8,145,178,0.08)' },
    'Equipamento para Aquisição Permanente': { label: 'Equip. Aquisição Perm.', color: '#0369a1', bgLight: 'rgba(3,105,161,0.08)' },
    'Mão de Obra': { label: 'Mão de Obra', color: '#7c3aed', bgLight: 'rgba(124,58,237,0.08)' },
    'Material': { label: 'Material', color: '#2563eb', bgLight: 'rgba(37,99,235,0.08)' },
    'Serviços': { label: 'Serviços', color: '#059669', bgLight: 'rgba(5,150,105,0.08)' },
    'Taxas': { label: 'Taxas', color: '#b45309', bgLight: 'rgba(180,83,9,0.08)' },
    'Administração': { label: 'Administração', color: '#475569', bgLight: 'rgba(71,85,105,0.08)' },
    'Aluguel': { label: 'Aluguel', color: '#0d9488', bgLight: 'rgba(13,148,136,0.08)' },
    'Verba': { label: 'Verba', color: '#db2777', bgLight: 'rgba(219,39,119,0.08)' },
    'Consultoria': { label: 'Consultoria', color: '#4f46e5', bgLight: 'rgba(79,70,229,0.08)' },
    'Transporte': { label: 'Transporte', color: '#ea580c', bgLight: 'rgba(234,88,12,0.08)' },
    'Encargos Complementares': { label: 'Encargos Comp.', color: '#65a30d', bgLight: 'rgba(101,163,13,0.08)' },
    'Franquia': { label: 'Franquia', color: '#9333ea', bgLight: 'rgba(147,51,234,0.08)' },
    'Outros': { label: 'Outros', color: '#6b7280', bgLight: 'rgba(107,114,128,0.08)' }
};

export function resolveMetaCategory(type: string): InsumoCategoria {
    const upper = (type || '').toUpperCase().trim();
    switch (upper) {
        case 'MÃO DE OBRA':
        case 'MAO DE OBRA':
        case 'MAO_DE_OBRA':
            return 'MAO_DE_OBRA';
            
        case 'MATERIAL':
        case 'EQUIPAMENTO PARA AQUISIÇÃO PERMANENTE':
        case 'EQUIPAMENTO PARA AQUISICAO PERMANENTE':
            return 'MATERIAL';
            
        case 'EQUIPAMENTO':
        case 'ALUGUEL':
        case 'TRANSPORTE':
            return 'EQUIPAMENTO';
            
        case 'SERVIÇOS':
        case 'SERVICOS':
        case 'SERVICO':
        case 'TAXAS':
        case 'ADMINISTRAÇÃO':
        case 'ADMINISTRACAO':
        case 'VERBA':
        case 'CONSULTORIA':
        case 'ENCARGOS COMPLEMENTARES':
        case 'FRANQUIA':
        case 'OUTROS':
            return 'SERVICO';
            
        default:
            // Fallback rules for legacy values
            if (upper.includes('MAO') || upper.includes('MÃO')) return 'MAO_DE_OBRA';
            if (upper.includes('EQUIP') && !upper.includes('PERMANENTE')) return 'EQUIPAMENTO';
            if (upper.includes('MATERIAL')) return 'MATERIAL';
            return 'SERVICO';
    }
}

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
                tipoDetalhado: raw.insumoType,
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
    return resolveMetaCategory(type);
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
