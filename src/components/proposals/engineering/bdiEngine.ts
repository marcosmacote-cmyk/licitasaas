/**
 * bdiEngine.ts — Motor de Cálculo de BDI para Obras de Engenharia
 * 
 * Implementa a fórmula oficial do Acórdão TCU 2622/2013:
 * BDI = {(1 + AC + S + G + R) × (1 + DF) × (1 + L) / (1 - I) - 1} × 100
 * 
 * Onde:
 *  AC = Administração Central
 *  S  = Seguros
 *  G  = Garantias
 *  R  = Riscos
 *  DF = Despesas Financeiras
 *  L  = Lucro / Remuneração
 *  I  = Tributos (PIS + COFINS + ISS + CPRB se aplicável)
 */

import { applyPrecision } from './precisionEngine';
import type { PrecisionConfig } from './types';

export interface BdiTcuParams {
    adminCentral: number;   // AC — %
    seguros: number;        // S  — %
    garantias: number;      // G  — %
    riscos: number;         // R  — %
    despFinanceiras: number;// DF — %
    lucro: number;          // L  — %
    tributos: number;       // I  — % (PIS + COFINS + ISS)
}

export interface BdiConfig {
    mode: 'SIMPLIFICADO' | 'TCU';
    bdiGlobal: number;     // Used in SIMPLIFICADO mode
    tcu: BdiTcuParams;     // Used in TCU mode
    /** BDI Diferenciado — parâmetros TCU para Fornecimento/Materiais/Equipamentos */
    tcuFornecimento?: BdiTcuParams;
}

/** Default TCU params — zerado para não confundir com dados do edital */
export const DEFAULT_TCU_PARAMS: BdiTcuParams = {
    adminCentral: 0,
    seguros: 0,
    garantias: 0,
    riscos: 0,
    despFinanceiras: 0,
    lucro: 0,
    tributos: 0,
};

/** Default TCU params — Fornecimento (zerado) */
export const DEFAULT_TCU_FORNECIMENTO_PARAMS: BdiTcuParams = {
    adminCentral: 0,
    seguros: 0,
    garantias: 0,
    riscos: 0,
    despFinanceiras: 0,
    lucro: 0,
    tributos: 0,
};

export const DEFAULT_BDI_CONFIG: BdiConfig = {
    mode: 'TCU',
    bdiGlobal: 0,
    tcu: { ...DEFAULT_TCU_PARAMS },
    tcuFornecimento: { ...DEFAULT_TCU_FORNECIMENTO_PARAMS },
};

/**
 * Calcula o BDI pela fórmula do Acórdão TCU 2622/2013
 * @returns BDI como percentual (ex: 25.34)
 */
export function calculateBdiTCU(params: BdiTcuParams): number {
    const ac = params.adminCentral / 100;
    const s  = params.seguros / 100;
    const g  = params.garantias / 100;
    const r  = params.riscos / 100;
    const df = params.despFinanceiras / 100;
    const l  = params.lucro / 100;
    const i  = params.tributos / 100;

    // Guard against division by zero
    if (i >= 1) return 0;

    const bdi = ((1 + ac + s + g + r) * (1 + df) * (1 + l) / (1 - i) - 1) * 100;
    return Math.round(bdi * 100) / 100; // 2 decimal places
}

/**
 * Distribui o BDI global digitado pelo usuário pelos parâmetros TCU, 
 * usando os valores medianos para as despesas e calculando o lucro 
 * necessário para atingir o BDI alvo.
 */
export function autoDistributeBdi(targetBdi: number): BdiTcuParams {
    // Valores medianos do TCU (Acórdão 2622/2013)
    const tcu: BdiTcuParams = {
        adminCentral: 4.00,
        seguros: 0.80,
        garantias: 0.80,
        riscos: 0.97,
        despFinanceiras: 0.59,
        lucro: 6.16,
        tributos: 5.65
    };
    // K1 = (1 + AC + S + G + R) * (1 + DF)
    const ac_s_r_g = (tcu.adminCentral + tcu.seguros + tcu.riscos + tcu.garantias) / 100;
    const K1 = (1 + ac_s_r_g) * (1 + tcu.despFinanceiras / 100);
    const K2 = 1 - (tcu.tributos / 100);
    
    // Formula inversa para o lucro (L):
    let solvedLucro = ( (targetBdi / 100 + 1) * K2 / K1 - 1 ) * 100;
    
    // Se o BDI for tão baixo que o lucro fica negativo, zeramos o lucro.
    // E ajustamos também os outros pra não bugar.
    if (solvedLucro < 0) solvedLucro = 0;
    
    return { ...tcu, lucro: Number(solvedLucro.toFixed(2)) };
}

/**
 * Resolve o BDI efetivo baseado na configuração
 */
export function resolveEffectiveBdi(config: BdiConfig): number {
    if (config.mode === 'TCU') {
        return calculateBdiTCU(config.tcu);
    }
    return config.bdiGlobal;
}

/**
 * Calcula preço unitário com BDI.
 * Respeita a configuração de precisão do edital (ROUND/TRUNCATE, N casas).
 */
export function applyBdi(unitCost: number, bdiPercentage: number, precision?: PrecisionConfig): number {
    const raw = unitCost * (1 + bdiPercentage / 100);
    return applyPrecision(raw, { precision });
}

/**
 * Calcula o preço total de um item de engenharia.
 * Respeita a configuração de precisão do edital.
 */
export function calculateEngineeringItem(
    quantity: number,
    unitCost: number,
    bdiPercentage: number,
    precision?: PrecisionConfig
): { unitPrice: number; totalPrice: number } {
    const unitPrice = applyBdi(unitCost, bdiPercentage, precision);
    const totalPrice = applyPrecision(quantity * unitPrice, { precision });
    return { unitPrice, totalPrice };
}

/** Faixas referenciais do TCU por tipo de obra (Acórdão 2622/2013) */
export const TCU_REFERENCE_RANGES = {
    'Construção de Edifícios': { min: 20.34, median: 22.12, max: 25.00 },
    'Construção de Rodovias': { min: 17.20, median: 20.97, max: 24.23 },
    'Construção de Redes':    { min: 19.60, median: 22.83, max: 27.48 },
    'Obras Hidráulicas':      { min: 20.34, median: 24.18, max: 28.97 },
    'Fornecimento de Materiais/Equipamentos': { min: 11.10, median: 14.02, max: 16.80 },
} as const;
