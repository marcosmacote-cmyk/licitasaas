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
    matchedCode?: string | null;
    matchedSourceName?: string | null;
    matchedUf?: string | null;
    matchedReference?: string | null;
    matchedPayrollExemption?: boolean | null;
    matchMethod?: 'code_exact' | 'description_similarity' | 'none';
    confidence?: number;
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

/** Composição analítica de Encargos Sociais por grupo */
export interface EncargosSociaisGrupo {
    /** A — Encargos Básicos */
    inss: number;       // 20.00
    sesi: number;       // 1.50
    senai: number;      // 1.00
    incra: number;      // 0.20
    sebrae: number;     // 0.60
    salarioEducacao: number; // 2.50
    fgts: number;       // 8.00
    seguroAcidente: number; // 3.00 (RAT × FAP)
    /** B — Encargos que recebem incidência de A */
    decimoTerceiro: number; // 8.33
    ferias: number;         // 12.10 (inclui 1/3)
    /** C — Encargos Complementares */
    avisoPrevio: number;       // 5.55
    auxilioDoenca: number;     // 0.79
    licencaPaternidade: number;// 0.07
    faltaJustificada: number;  // 0.71
    diasChuva: number;         // 1.50
    /** D — Reincidências (B × A) */
    reincidenciaGrupoA: number; // auto-calc
    /** E — Complementos */
    valeTransporte: number;
    alimentacao: number;
    epiUniformes: number;
}

export interface EncargosSociaisConfig {
    horista: number;
    mensalista: number;
    /** Composição analítica — Horista */
    grupoHorista?: Partial<EncargosSociaisGrupo>;
    /** Composição analítica — Mensalista */
    grupoMensalista?: Partial<EncargosSociaisGrupo>;
    /** Segundo encargo social (para comparação) */
    encargos2?: { horista: number; mensalista: number; label?: string };
    /** Qual encargo está ativo nas composições: 1 (principal) ou 2 (alternativo) */
    encargoAtivo?: 1 | 2;
    /** Encargos por base de referência (SINAPI, SEINFRA, etc.)
     *  Cada base pode ter seu próprio conjunto de horista/mensalista/grupoAnalítico */
    encargosPorBase?: Record<string, {
        horista: number;
        mensalista: number;
        grupoHorista?: Partial<EncargosSociaisGrupo>;
    }>;
}

export interface PrecisionConfig {
    tipo: 'ROUND' | 'TRUNCATE';
    casasDecimais: number;
}

export interface EngineeringConfig {
    objeto: string;
    basesConsideradas: string[];
    /** UF usada para escolher a base oficial estadual correta (ex: SINAPI PA, CE, SP). */
    ufReferencia?: string;
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
    basesConsideradas: [],
    ufReferencia: '',
    dataBase: '',
    regimeOneracao: 'ONERADO',
    encargosSociais: { horista: 0, mensalista: 0 },
    precision: { tipo: 'ROUND', casasDecimais: 2 },
    bdiDiferenciado: false,
    bdiFornecimento: 0,
};
