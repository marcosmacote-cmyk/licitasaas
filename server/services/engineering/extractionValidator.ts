/**
 * ══════════════════════════════════════════════════════════════════
 *  Engineering Extraction Validator — Validação pós-extração
 * ══════════════════════════════════════════════════════════════════
 *
 *  Valida o resultado da extração de planilha orçamentária ANTES
 *  de publicar no schemaV2. Gera um score de qualidade e lista
 *  de problemas encontrados.
 *
 *  Checagens:
 *    1. Cobertura: % de itens com código oficial
 *    2. Reconciliação matemática: soma ≈ valor global do edital
 *    3. Hierarquia: etapas sem filhos = possível erro
 *    4. Duplicatas: mesma descrição + código = possível extração dupla
 *    5. Itens fantasma: itens sem descrição ou com dados zerados
 *    6. Consistência BDI: custo × (1 + BDI) ≈ preço com BDI
 */

import { logger } from '../../lib/logger';

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface ValidationIssue {
    code: string;
    severity: 'info' | 'warning' | 'error';
    message: string;
    affectedItems?: string[];  // item numbers
}

export type EngineeringItemClassification =
    | 'valid_budget_item'
    | 'section_header'
    | 'subtotal'
    | 'narrative_noise'
    | 'ambiguous';

export interface EngineeringItemQuality {
    item: string;
    classification: EngineeringItemClassification;
    confidence: number;
    reasons: string[];
}

export interface EngineeringItemScreeningResult {
    acceptedItems: any[];
    rejectedItems: any[];
    itemQuality: EngineeringItemQuality[];
}

export interface EngineeringValidationReport {
    /** Quality score 0-100 */
    qualityScore: number;
    /** Is this result reliable enough to publish? */
    publishable: boolean;
    /** Total items extracted */
    totalItems: number;
    /** Items with official codes (SINAPI, SEINFRA, etc.) */
    itemsWithOfficialCodes: number;
    /** Coverage: % of composições with official codes */
    codeCoveragePercent: number;
    /** Sum of all line totals (qty × unitCost) */
    calculatedTotal: number;
    /** Expected total from edital (if available) */
    expectedTotal: number | null;
    /** Divergence from expected total (%) */
    totalDivergencePercent: number | null;
    /** Issues found */
    issues: ValidationIssue[];
    /** Counts by type */
    typeCounts: Record<string, number>;
    /** Item-level diagnostics generated before scoring */
    itemQuality?: EngineeringItemQuality[];
    /** Rejected non-budget/noise rows */
    rejectedItems?: any[];
}

// ═══════════════════════════════════════════
// Validation checks
// ═══════════════════════════════════════════

const VALID_UNITS = new Set([
    'UN', 'UND', 'UNID', 'VB', 'CJ', 'GL', 'M', 'M2', 'M²', 'M3', 'M³',
    'KG', 'G', 'T', 'TON', 'L', 'ML', 'H', 'HR', 'HORA', 'MES', 'MÊS',
    'DIA', 'KM', 'HA', 'PCT', 'PAR', 'JG', 'KWH',
]);

const NARRATIVE_PATTERNS = [
    /\blicitante\b/i,
    /\bcontratada\b|\bcontratante\b/i,
    /\bdever[aá]\b|\bdeverão\b|\bdeve\b/i,
    /\bcomprovar\b|\bcomprova[cç][aã]o\b/i,
    /\bhabilita[cç][aã]o\b|\batestado\b/i,
    /\bmulta\b|\bsan[cç][aã]o\b|\bpenalidade\b/i,
    /\bprazo\b|\bvig[eê]ncia\b/i,
    /\bedital\b|\btermo de refer[eê]ncia\b/i,
    /\bdeclara[cç][aã]o\b|\bdocumenta[cç][aã]o\b/i,
];

const BUDGET_DESCRIPTION_PATTERNS = [
    /\bfornecimento\b|\binstala[cç][aã]o\b|\bexecu[cç][aã]o\b/i,
    /\bescava[cç][aã]o\b|\balvenaria\b|\bconcreto\b|\bargamassa\b|\bpintura\b/i,
    /\btransporte\b|\bcarga\b|\bdescarga\b|\bdemoli[cç][aã]o\b/i,
    /\bcabo\b|\btubo\b|\bporta\b|\bjanela\b|\brevestimento\b|\bcobertura\b/i,
    /\bservi[cç]os?\b|\bobras?\b|\bmaterial\b|\bequipamento\b/i,
];

const SUBTOTAL_PATTERNS = [
    /^subtotal\b/i,
    /^sub-total\b/i,
    /^total\b/i,
    /\btotal geral\b/i,
    /\bvalor global\b/i,
];

function normalizeUnit(unit: any): string {
    return String(unit || '').trim().toUpperCase();
}

function classifyEngineeringItem(item: any): EngineeringItemQuality {
    const description = String(item?.description || '').trim();
    const type = String(item?.type || '').toUpperCase();
    const unit = normalizeUnit(item?.unit);
    const quantity = Number(item?.quantity) || 0;
    const unitCost = Number(item?.unitCost) || 0;
    const code = String(item?.code || '').trim();
    const itemNumber = String(item?.item || '');
    const reasons: string[] = [];
    let confidence = 45;

    if (!description || description.length < 3) {
        reasons.push('descrição ausente/curta');
        confidence -= 35;
    }

    const isHeader = type === 'ETAPA' || type === 'SUBETAPA';
    if (isHeader) {
        reasons.push('agrupador hierárquico');
        confidence += 25;
        return {
            item: itemNumber,
            classification: 'section_header',
            confidence: Math.max(0, Math.min(100, confidence)),
            reasons,
        };
    }

    if (SUBTOTAL_PATTERNS.some(pattern => pattern.test(description))) {
        reasons.push('linha de total/subtotal');
        return {
            item: itemNumber,
            classification: 'subtotal',
            confidence: 88,
            reasons,
        };
    }

    const narrativeHits = NARRATIVE_PATTERNS.filter(pattern => pattern.test(description)).length;
    if (narrativeHits > 0) {
        reasons.push(`${narrativeHits} sinal(is) de texto narrativo`);
        confidence -= narrativeHits * 24;
    }

    if (quantity > 0) {
        reasons.push('quantidade numérica');
        confidence += 18;
    }
    if (unitCost > 0) {
        reasons.push('preço unitário numérico');
        confidence += 18;
    }
    if (unit && VALID_UNITS.has(unit)) {
        reasons.push(`unidade reconhecida (${unit})`);
        confidence += 12;
    }
    if (code && code !== 'N/A') {
        reasons.push('código presente');
        confidence += 10;
    }
    if (BUDGET_DESCRIPTION_PATTERNS.some(pattern => pattern.test(description))) {
        reasons.push('descrição parece serviço/insumo de engenharia');
        confidence += 12;
    }

    confidence = Math.max(0, Math.min(100, confidence));

    if (narrativeHits > 0 && quantity === 0 && unitCost === 0) {
        return { item: itemNumber, classification: 'narrative_noise', confidence, reasons };
    }

    if (quantity === 0 && unitCost === 0 && !unit && !code) {
        return { item: itemNumber, classification: 'ambiguous', confidence, reasons };
    }

    if (confidence < 35) {
        return { item: itemNumber, classification: 'narrative_noise', confidence, reasons };
    }

    if (confidence < 55) {
        return { item: itemNumber, classification: 'ambiguous', confidence, reasons };
    }

    return { item: itemNumber, classification: 'valid_budget_item', confidence, reasons };
}

/**
 * Remove obvious non-budget rows before enrichment/persistence while keeping
 * ambiguous rows available for validation diagnostics.
 */
export function screenEngineeringItems(items: any[]): EngineeringItemScreeningResult {
    const itemQuality = items.map(classifyEngineeringItem);
    const acceptedItems: any[] = [];
    const rejectedItems: any[] = [];

    items.forEach((item, index) => {
        const quality = itemQuality[index];
        const itemWithQuality = {
            ...item,
            _quality: {
                classification: quality.classification,
                confidence: quality.confidence,
                reasons: quality.reasons,
            },
        };

        if (quality.classification === 'narrative_noise' || quality.classification === 'subtotal') {
            rejectedItems.push(itemWithQuality);
        } else {
            acceptedItems.push(itemWithQuality);
        }
    });

    if (rejectedItems.length > 0) {
        logger.warn(`[EngValidator] Screening rejeitou ${rejectedItems.length}/${items.length} linha(s) não orçamentárias antes do merge.`);
    }

    return { acceptedItems, rejectedItems, itemQuality };
}

/**
 * Validate an engineering extraction result.
 *
 * @param items - The extracted engineering items (from Gemini)
 * @param expectedTotal - The estimated value from the edital (if known)
 * @returns Validation report with score, issues, and publishability
 */
export function validateEngineeringExtraction(
    items: any[],
    expectedTotal?: number | null,
    screening?: EngineeringItemScreeningResult
): EngineeringValidationReport {
    const issues: ValidationIssue[] = [];
    let score = 100; // Start at 100, deduct for problems

    // ── Basic counts ──
    const typeCounts: Record<string, number> = {};
    for (const it of items) {
        const t = it.type || 'UNKNOWN';
        typeCounts[t] = (typeCounts[t] || 0) + 1;
    }

    const etapas = items.filter(it => it.type === 'ETAPA');
    const subetapas = items.filter(it => it.type === 'SUBETAPA');
    const composicoes = items.filter(it => it.type === 'COMPOSICAO');
    const insumos = items.filter(it => it.type === 'INSUMO');
    const leafItems = [...composicoes, ...insumos]; // items with prices

    // ── Check 1: Minimum items ──
    if (items.length < 5) {
        issues.push({
            code: 'EV01',
            severity: 'error',
            message: `Apenas ${items.length} itens extraídos. Mínimo esperado: 5.`,
        });
        score -= 30;
    } else if (items.length < 15) {
        issues.push({
            code: 'EV01',
            severity: 'warning',
            message: `${items.length} itens extraídos. Planilhas típicas têm 50-300 itens.`,
        });
        score -= 10;
    }

    if (screening?.rejectedItems?.length) {
        issues.push({
            code: 'EV00',
            severity: screening.rejectedItems.length > 10 ? 'warning' : 'info',
            message: `${screening.rejectedItems.length} linha(s) descartadas como ruído narrativo/total antes de publicar.`,
            affectedItems: screening.rejectedItems.map(it => it.item).filter(Boolean),
        });
        score -= Math.min(screening.rejectedItems.length, 8);
    }

    // ── Check 2: Code coverage ──
    const itemsWithOfficialCodes = leafItems.filter(it =>
        it.code && it.sourceName && it.sourceName !== 'PROPRIA' && it.code !== 'N/A'
    ).length;
    const codeCoveragePercent = leafItems.length > 0
        ? Math.round((itemsWithOfficialCodes / leafItems.length) * 100)
        : 0;

    if (codeCoveragePercent < 30) {
        issues.push({
            code: 'EV02',
            severity: 'error',
            message: `Cobertura de código oficial muito baixa: ${codeCoveragePercent}% (${itemsWithOfficialCodes}/${leafItems.length}). Esperado ≥ 50%.`,
        });
        score -= 20;
    } else if (codeCoveragePercent < 60) {
        issues.push({
            code: 'EV02',
            severity: 'warning',
            message: `Cobertura de código oficial moderada: ${codeCoveragePercent}% (${itemsWithOfficialCodes}/${leafItems.length}). Ideal ≥ 80%.`,
        });
        score -= 10;
    }

    // ── Check 3: Mathematical reconciliation ──
    const calculatedTotal = leafItems.reduce((sum, it) => {
        const qty = Number(it.quantity) || 0;
        const cost = Number(it.unitCost) || 0;
        return sum + (qty * cost);
    }, 0);

    let totalDivergencePercent: number | null = null;

    if (expectedTotal && expectedTotal > 0 && calculatedTotal > 0) {
        // Need to account for BDI: calculatedTotal is without BDI, expectedTotal might be with BDI
        // Typical BDI is 20-35%. Check if calculatedTotal * 1.3 ≈ expectedTotal
        const ratioRaw = calculatedTotal / expectedTotal;
        const ratioWithBdi25 = (calculatedTotal * 1.25) / expectedTotal;
        const ratioWithBdi30 = (calculatedTotal * 1.30) / expectedTotal;

        // Find the best-fitting BDI assumption
        const bestRatio = [ratioRaw, ratioWithBdi25, ratioWithBdi30]
            .map(r => ({ ratio: r, divergence: Math.abs(1 - r) }))
            .sort((a, b) => a.divergence - b.divergence)[0];

        totalDivergencePercent = Math.round(bestRatio.divergence * 100);

        if (totalDivergencePercent > 30) {
            issues.push({
                code: 'EV03',
                severity: 'error',
                message: `Divergência de ${totalDivergencePercent}% entre soma calculada (R$ ${calculatedTotal.toFixed(2)}) e valor do edital (R$ ${expectedTotal.toFixed(2)}). Possível extração incompleta ou erro de valores.`,
            });
            score -= 20;
        } else if (totalDivergencePercent > 10) {
            issues.push({
                code: 'EV03',
                severity: 'warning',
                message: `Divergência de ${totalDivergencePercent}% entre soma calculada e valor do edital. Pode indicar itens faltantes ou BDI não contabilizado.`,
            });
            score -= 8;
        } else {
            issues.push({
                code: 'EV03',
                severity: 'info',
                message: `Reconciliação OK: divergência de ${totalDivergencePercent}% (dentro da tolerância).`,
            });
        }
    } else if (!expectedTotal || expectedTotal === 0) {
        issues.push({
            code: 'EV03',
            severity: 'info',
            message: 'Valor global do edital não disponível para reconciliação.',
        });
    }

    // ── Check 4: Hierarchy integrity ──
    const itemNumberSet = new Set(items.map(it => it.item));

    for (const etapa of [...etapas, ...subetapas]) {
        const prefix = etapa.item;
        if (!prefix) continue;
        const hasChildren = items.some(it =>
            it.item !== prefix &&
            it.item?.startsWith(prefix + '.') &&
            it.type !== 'ETAPA' &&
            it.type !== 'SUBETAPA'
        );
        if (!hasChildren) {
            issues.push({
                code: 'EV04',
                severity: 'warning',
                message: `Etapa "${prefix} - ${etapa.description?.substring(0, 50)}" sem filhos. Possível agrupador vazio ou itens faltantes.`,
                affectedItems: [prefix],
            });
            score -= 2;
        }
    }

    // ── Check 5: Duplicate detection ──
    const fingerprints = new Map<string, string[]>();
    for (const it of leafItems) {
        const fp = `${(it.description || '').toLowerCase().trim().substring(0, 60)}|${(it.code || '').toLowerCase()}`;
        if (!fingerprints.has(fp)) fingerprints.set(fp, []);
        fingerprints.get(fp)!.push(it.item);
    }

    const duplicates = Array.from(fingerprints.entries())
        .filter(([_, items]) => items.length > 1);

    if (duplicates.length > 0) {
        const dupCount = duplicates.reduce((s, [_, items]) => s + items.length - 1, 0);
        issues.push({
            code: 'EV05',
            severity: duplicates.length > 5 ? 'error' : 'warning',
            message: `${dupCount} itens duplicados detectados em ${duplicates.length} grupos.`,
            affectedItems: duplicates.flatMap(([_, items]) => items),
        });
        score -= Math.min(duplicates.length * 2, 15);
    }

    // ── Check 6: Ghost items (no description or all-zero) ──
    const ghostItems = leafItems.filter(it =>
        (!it.description || it.description.trim().length < 3) ||
        (Number(it.quantity) === 0 && Number(it.unitCost) === 0 && it.type === 'COMPOSICAO')
    );

    if (ghostItems.length > 0) {
        issues.push({
            code: 'EV06',
            severity: ghostItems.length > 10 ? 'error' : 'warning',
            message: `${ghostItems.length} itens fantasma (sem descrição ou valores zerados).`,
            affectedItems: ghostItems.map(it => it.item).filter(Boolean),
        });
        score -= Math.min(ghostItems.length, 10);
    }

    // ── Check 7: Has at least 1 etapa (structural check) ──
    if (etapas.length === 0 && items.length > 10) {
        issues.push({
            code: 'EV07',
            severity: 'warning',
            message: 'Nenhuma ETAPA encontrada. A planilha deveria ter agrupadores hierárquicos.',
        });
        score -= 5;
    }

    // ── Check 8: Items with very high unit costs (possible BDI contamination) ──
    if (expectedTotal && expectedTotal > 0) {
        const suspiciousItems = leafItems.filter(it => {
            const cost = Number(it.unitCost) || 0;
            return cost > expectedTotal * 0.5; // Single item > 50% of total
        });
        if (suspiciousItems.length > 0) {
            issues.push({
                code: 'EV08',
                severity: 'warning',
                message: `${suspiciousItems.length} item(ns) com custo unitário > 50% do valor global. Possível erro de escala ou BDI incluso no unitário.`,
                affectedItems: suspiciousItems.map(it => it.item).filter(Boolean),
            });
            score -= 5;
        }
    }

    // Clamp score
    score = Math.max(0, Math.min(100, score));

    const publishable = score >= 40; // Below 40 = too unreliable

    const report: EngineeringValidationReport = {
        qualityScore: score,
        publishable,
        totalItems: items.length,
        itemsWithOfficialCodes,
        codeCoveragePercent,
        calculatedTotal,
        expectedTotal: expectedTotal || null,
        totalDivergencePercent,
        issues,
        typeCounts,
        itemQuality: screening?.itemQuality,
        rejectedItems: screening?.rejectedItems,
    };

    const issuesSummary = issues
        .filter(i => i.severity !== 'info')
        .map(i => `[${i.severity}] ${i.code}: ${i.message}`)
        .join(' | ');

    logger.info(
        `[EngValidator] Score: ${score}% | ${publishable ? '✅ Publishable' : '⚠️ NOT publishable'} | ` +
        `Items: ${items.length} (${etapas.length} etapas, ${composicoes.length} comp, ${insumos.length} ins) | ` +
        `Codes: ${codeCoveragePercent}% | ` +
        `Total: R$ ${calculatedTotal.toFixed(2)} | ` +
        (totalDivergencePercent !== null ? `Divergence: ${totalDivergencePercent}% | ` : '') +
        `Issues: ${issues.length}${issuesSummary ? ` — ${issuesSummary}` : ''}`
    );

    return report;
}
