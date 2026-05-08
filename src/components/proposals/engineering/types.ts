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

export type PriceAuditStatus = 'OK' | 'DIVERGENT' | 'BASE_INCOMPATIVEL' | 'BASE_INDISPONIVEL' | 'SEM_MATCH';

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
    /** SINAPI Groups A-D — subtotals per group */
    grupoA_horista?: number;
    grupoA_mensalista?: number;
    grupoB_horista?: number;
    grupoB_mensalista?: number;
    grupoC_horista?: number;
    grupoC_mensalista?: number;
    grupoD_horista?: number;
    grupoD_mensalista?: number;
    /** Individual items — Group A (Encargos Sociais Básicos) */
    a1_h?: number; a1_m?: number; // INSS
    a2_h?: number; a2_m?: number; // SESI
    a3_h?: number; a3_m?: number; // SENAI
    a4_h?: number; a4_m?: number; // INCRA
    a5_h?: number; a5_m?: number; // SEBRAE
    a6_h?: number; a6_m?: number; // Salário Educação
    a7_h?: number; a7_m?: number; // Seguro Contra Acidentes de Trabalho (RAT)
    a8_h?: number; a8_m?: number; // FGTS
    a9_h?: number; a9_m?: number; // SECONCI
    /** Individual items — Group B (Encargos Trabalhistas) */
    b1_h?: number; b1_m?: number;  // Repouso Semanal Remunerado
    b2_h?: number; b2_m?: number;  // Feriados
    b3_h?: number; b3_m?: number;  // Auxílio Enfermidade
    b4_h?: number; b4_m?: number;  // 13º Salário
    b5_h?: number; b5_m?: number;  // Licença Paternidade
    b6_h?: number; b6_m?: number;  // Faltas Justificadas
    b7_h?: number; b7_m?: number;  // Dias de Chuvas
    b8_h?: number; b8_m?: number;  // Auxílio Acidente de Trabalho
    b9_h?: number; b9_m?: number;  // Férias Gozadas
    b10_h?: number; b10_m?: number; // Salário Maternidade
    /** Individual items — Group C (Encargos Rescisórios) */
    c1_h?: number; c1_m?: number; // Aviso Prévio Indenizado
    c2_h?: number; c2_m?: number; // Aviso Prévio Trabalhado
    c3_h?: number; c3_m?: number; // Férias Indenizadas
    c4_h?: number; c4_m?: number; // Depósito Rescisão Sem Justa Causa
    c5_h?: number; c5_m?: number; // Indenização Adicional
    /** Individual items — Group D (Reincidências) */
    d1_h?: number; d1_m?: number; // Reincidência de Grupo A sobre Grupo B
    d2_h?: number; d2_m?: number; // Reincidência de Grupo A sobre Aviso Prévio Trabalhado
    /** Base principal identificada pela IA */
    basePrincipal?: string | null;
    /** Composição analítica — Horista (legacy) */
    grupoHorista?: Partial<EncargosSociaisGrupo>;
    /** Composição analítica — Mensalista (legacy) */
    grupoMensalista?: Partial<EncargosSociaisGrupo>;
    /** Segundo encargo social (para comparação) */
    encargos2?: { horista: number; mensalista: number; label?: string };
    /** Qual encargo está ativo nas composições (0=principal, 1,2,3...=adicionais) */
    encargoAtivo?: number;
    /** N planilhas analíticas adicionais (por base de referência) */
    encargosAdicionais?: EncargosSheet[];
    /** Encargos por base de referência (SINAPI, SEINFRA, etc.)
     *  Cada base pode ter seu próprio conjunto de horista/mensalista/grupoAnalítico */
    encargosPorBase?: Record<string, {
        horista: number;
        mensalista: number;
        grupoHorista?: Partial<EncargosSociaisGrupo>;
    }>;
}

/** Encargos sheet — uma planilha analítica completa de encargos sociais */
export interface EncargosSheet {
    label: string; // "SINAPI", "SEINFRA-CE", "SETOP-MG"
    horista: number;
    mensalista: number;
    grupoA_horista?: number; grupoA_mensalista?: number;
    grupoB_horista?: number; grupoB_mensalista?: number;
    grupoC_horista?: number; grupoC_mensalista?: number;
    grupoD_horista?: number; grupoD_mensalista?: number;
    a1_h?: number; a1_m?: number; a2_h?: number; a2_m?: number;
    a3_h?: number; a3_m?: number; a4_h?: number; a4_m?: number;
    a5_h?: number; a5_m?: number; a6_h?: number; a6_m?: number;
    a7_h?: number; a7_m?: number; a8_h?: number; a8_m?: number;
    a9_h?: number; a9_m?: number;
    b1_h?: number; b1_m?: number; b2_h?: number; b2_m?: number;
    b3_h?: number; b3_m?: number; b4_h?: number; b4_m?: number;
    b5_h?: number; b5_m?: number; b6_h?: number; b6_m?: number;
    b7_h?: number; b7_m?: number; b8_h?: number; b8_m?: number;
    b9_h?: number; b9_m?: number; b10_h?: number; b10_m?: number;
    c1_h?: number; c1_m?: number; c2_h?: number; c2_m?: number;
    c3_h?: number; c3_m?: number; c4_h?: number; c4_m?: number;
    c5_h?: number; c5_m?: number;
    d1_h?: number; d1_m?: number; d2_h?: number; d2_m?: number;
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
    /** Snapshot of AI-extracted config values — used for Config Consistency alerts */
    _aiExtractedRef?: {
        objeto?: string;
        ufReferencia?: string;
        regimeOneracao?: string;
        dataBase?: string;
        dataBases?: Record<string, string>;
        basesConsideradas?: string[];
    };
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
