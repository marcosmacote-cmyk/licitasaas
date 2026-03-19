/**
 * Composição de Preços Unitários — Tipos
 * 
 * Modelo de dados para detalhar a formação de preço de cada item,
 * cobrindo qualquer tipo de serviço ou fornecimento em licitações.
 */

/** Grupos de custo — cobre qualquer tipo de serviço/fornecimento */
export type CostGroup =
    | 'MATERIAL'
    | 'MAO_DE_OBRA'
    | 'EQUIPAMENTO'
    | 'FRETE'
    | 'TERCEIROS'
    | 'ADMIN_CENTRAL'
    | 'CUSTOS_FINANCEIROS'
    | 'SEGUROS'
    | 'RISCOS'
    | 'DESPESAS_OPERACIONAIS'
    | 'TRIBUTOS'
    | 'LUCRO'
    | 'OUTRO';

/** Metadados de cada grupo */
export interface CostGroupMeta {
    key: CostGroup;
    label: string;
    category: 'DIRETO' | 'INDIRETO' | 'TRIBUTO' | 'LUCRO';
    color: string;
    icon: string; // Lucide icon name
}

/** Linha individual da composição de preços */
export interface CostCompositionLine {
    id: string;
    group: CostGroup;
    description: string;
    unit: string;
    quantity: number;
    unitValue: number;
    totalValue: number;     // quantity × unitValue (calculado)
    source?: string;        // Fonte de pesquisa (SINAPI, SICRO, cotação, etc.)
    notes?: string;
}

/** Composição completa de um item */
export interface ItemCostComposition {
    itemId: string;
    lines: CostCompositionLine[];
    templateUsed?: string;  // Nome do template aplicado
}

/** Totais calculados da composição */
export interface CompositionTotals {
    totalDirect: number;
    totalIndirect: number;
    totalTaxes: number;
    profit: number;
    grandTotal: number;
    bdiImplicit: number;    // (grandTotal - totalDirect) / totalDirect × 100
}

/** Mapa de composições para todos os itens */
export type CompositionMap = Record<string, ItemCostComposition>;

/** Template de composição */
export interface CompositionTemplate {
    key: string;
    label: string;
    description: string;
    lines: Omit<CostCompositionLine, 'id' | 'totalValue'>[];
}

// ══════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════

export const COST_GROUP_META: CostGroupMeta[] = [
    // Custos Diretos
    { key: 'MATERIAL',              label: 'Material / Insumos',        category: 'DIRETO',   color: '#2563eb', icon: 'Package' },
    { key: 'MAO_DE_OBRA',           label: 'Mão de Obra Direta',        category: 'DIRETO',   color: '#7c3aed', icon: 'Users' },
    { key: 'EQUIPAMENTO',           label: 'Equipamentos',              category: 'DIRETO',   color: '#0891b2', icon: 'Wrench' },
    { key: 'FRETE',                 label: 'Frete / Transporte',        category: 'DIRETO',   color: '#d97706', icon: 'Truck' },
    { key: 'TERCEIROS',             label: 'Serviços de Terceiros',     category: 'DIRETO',   color: '#059669', icon: 'Handshake' },
    // Custos Indiretos
    { key: 'ADMIN_CENTRAL',         label: 'Administração Central',     category: 'INDIRETO', color: '#6366f1', icon: 'Building2' },
    { key: 'CUSTOS_FINANCEIROS',    label: 'Custos Financeiros',        category: 'INDIRETO', color: '#8b5cf6', icon: 'Banknote' },
    { key: 'SEGUROS',               label: 'Seguros e Garantias',       category: 'INDIRETO', color: '#06b6d4', icon: 'Shield' },
    { key: 'RISCOS',                label: 'Riscos e Imprevistos',      category: 'INDIRETO', color: '#f59e0b', icon: 'AlertTriangle' },
    { key: 'DESPESAS_OPERACIONAIS', label: 'Despesas Operacionais',     category: 'INDIRETO', color: '#64748b', icon: 'Settings' },
    // Tributos
    { key: 'TRIBUTOS',              label: 'Tributos',                  category: 'TRIBUTO',  color: '#dc2626', icon: 'Receipt' },
    // Lucro
    { key: 'LUCRO',                 label: 'Lucro / Benefício',         category: 'LUCRO',    color: '#16a34a', icon: 'TrendingUp' },
    // Outros
    { key: 'OUTRO',                 label: 'Outros Custos',             category: 'DIRETO',   color: '#94a3b8', icon: 'MoreHorizontal' },
];

export const COMPOSITION_UNITS = [
    'UN', 'KG', 'M', 'M²', 'M³', 'ML', 'HORA', 'DIA', 'MÊS',
    'VB', 'CJ', 'PCT', 'LITRO', 'TON', '%', 'GL',
];

export function getCostGroupMeta(group: CostGroup): CostGroupMeta {
    return COST_GROUP_META.find(m => m.key === group) || COST_GROUP_META[COST_GROUP_META.length - 1];
}
