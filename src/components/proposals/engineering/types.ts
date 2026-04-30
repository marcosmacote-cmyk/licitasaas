/**
 * types.ts — Tipos centralizados do Módulo de Engenharia
 * 
 * REGRA: Todas as interfaces compartilhadas entre engines, editors e panels
 * devem ser definidas aqui. NÃO declare tipos locais duplicados.
 */

// ═══════════════════════════════════════════════════════════
// ITEM TYPES
// ═══════════════════════════════════════════════════════════

export type EngItemType = 'ETAPA' | 'SUBETAPA' | 'COMPOSICAO' | 'INSUMO';

/** Categorias de BDI conforme Acórdão TCU 2622/2013 */
export type BdiCategoria = 'OBRA' | 'FORNECIMENTO';

export type PriceAuditStatus = 'OK' | 'DIVERGENT' | 'BASE_INCOMPATIVEL' | 'SEM_MATCH';

export interface PriceAudit {
    status: PriceAuditStatus;
    extractedUnitCost?: number;
    matchedUnitCost?: number | null;
    matchedDatabaseId?: string | null;
    matchedSourceName?: string | null;
    matchedUf?: string | null;
    matchedReference?: string | null;
    matchedPayrollExemption?: boolean | null;
    deltaValue?: number | null;
    deltaPercent?: number | null;
    warnings?: string[];
}

export interface EngInsumo {
    description: string;
    type: string;
    unit: string;
    coefficient: number;
    unitPrice: number;
}

export interface EngItem {
    id: string;
    itemNumber: string;
    code: string;
    sourceName: string;
    description: string;
    unit: string;
    quantity: number;
    unitCost: number;
    unitPrice: number;
    totalPrice: number;
    type: EngItemType;
    /** Categoria de BDI diferenciado. Default: 'OBRA' */
    bdiCategoria?: BdiCategoria;
    /** Origem do preço atualmente exibido. EDITAL preserva valores oficiais extraídos. */
    priceOrigin?: 'EDITAL' | 'BASE' | 'MANUAL';
    officialUnitCost?: number;
    officialUnitPrice?: number;
    officialTotalPrice?: number;
    priceAudit?: PriceAudit;
    insumos?: EngInsumo[];
}

export const isGrouper = (type: EngItemType) => type === 'ETAPA' || type === 'SUBETAPA';
export const getDepth = (itemNumber: string) => (itemNumber.match(/\./g) || []).length;

// ═══════════════════════════════════════════════════════════
// ENGINEERING CONFIG — Tipagem forte para engineeringConfig
// ═══════════════════════════════════════════════════════════

export interface EncargosSociaisConfig {
    horista: number;
    mensalista: number;
}

export interface PrecisionConfig {
    tipo: 'ROUND' | 'TRUNCATE';
    casasDecimais: number;
}

export interface EngineeringConfig {
    objeto: string;
    basesConsideradas: string[];
    dataBase: string;
    /** Data base específica para cada banco selecionado (ex: SINAPI -> 2026-03) */
    dataBases?: Record<string, string>;
    regimeOneracao: 'DESONERADO' | 'ONERADO';
    encargosSociais: EncargosSociaisConfig;
    precision: PrecisionConfig;
    /** Habilitar BDI diferenciado (Obra vs Fornecimento). Default: false */
    bdiDiferenciado?: boolean;
    /** BDI para itens de Fornecimento (%). Só aplicado se bdiDiferenciado=true */
    bdiFornecimento?: number;
}

export const DEFAULT_ENGINEERING_CONFIG: EngineeringConfig = {
    objeto: '',
    basesConsideradas: ['SINAPI', 'SEINFRA', 'SICOR'],
    dataBase: '',
    regimeOneracao: 'DESONERADO',
    encargosSociais: { horista: 114.3, mensalista: 47.8 },
    precision: { tipo: 'ROUND', casasDecimais: 2 },
    bdiDiferenciado: false,
    bdiFornecimento: 14.02,
};
