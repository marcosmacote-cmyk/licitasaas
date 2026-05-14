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

export interface EngineeringRowCoverageReport {
    provider?: string;
    candidateCount: number;
    consumedRowCount: number;
    missingRowCount: number;
    coveragePercent: number;
    missingRowIds?: string[];
    missingRowIdsTruncated?: boolean;
    retryBatchCount?: number;
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
    /** OCR row-level coverage diagnostics, when extraction used row candidates */
    rowCoverage?: EngineeringRowCoverageReport | null;
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

    // FIX STRUCT-01: Detect items from Projeto Estrutural/Hidráulico/Elétrico
    // These are hallucinations from Memória de Cálculo pages: "Sapatas (Projeto Estrutural)",
    // "Viga Baldrame (Projeto Estrutural)", etc. They have quantity but zero cost.
    const STRUCTURAL_PROJECT_PATTERNS = [
        /\(projeto\s+estrutural\)/i,
        /\(projeto\s+hidr[aá]ulico\)/i,
        /\(projeto\s+sanit[aá]rio\)/i,
        /\(projeto\s+el[eé]trico\)/i,
        /\bsapatas?\b.*\b(?:salas?|refeit[oó]rio|quadra)\b/i,
        /\bvigas?\s+baldrame\b/i,
        /\bpilares?\s+sapatas?\b/i,
    ];
    const isStructuralItem = STRUCTURAL_PROJECT_PATTERNS.some(p => p.test(description));
    if (isStructuralItem && unitCost === 0) {
        reasons.push('item de projeto estrutural/memória de cálculo (hallucination)');
        return {
            item: itemNumber,
            classification: 'narrative_noise',
            confidence: 5,
            reasons,
        };
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
    let acceptedItems: any[] = [];
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

    // ── DEDUPLICATION: Collapse items with identical description + values ──
    // Prevents catastrophic duplication (e.g., 486 copies of the same item)
    const deduplicatedItems: any[] = [];
    const fingerprints = new Map<string, { item: any; count: number }>();

    for (const item of acceptedItems) {
        const type = String(item.type || '').toUpperCase();
        // Don't deduplicate ETAPAs/SUBETAPAs — they are structural
        if (type === 'ETAPA' || type === 'SUBETAPA') {
            deduplicatedItems.push(item);
            continue;
        }

        const desc = String(item.description || '').toLowerCase().trim().substring(0, 80);
        const qty = Number(item.quantity) || 0;
        const cost = Number(item.unitCost) || 0;
        // FIX-DEDUP-01: Include item number in fingerprint.
        // Items with DIFFERENT numbers but identical descriptions are legitimate
        // (same service in different locations, e.g., 2.3.2.3 vs 2.4.2.3).
        // Only collapse true duplicates: same item number + same content.
        const itemNum = String(item.item || '').trim();
        const fp = `${itemNum}|${desc}|${qty}|${cost}`;

        const existing = fingerprints.get(fp);
        if (existing) {
            existing.count++;
            // Keep the first occurrence, skip duplicates
        } else {
            fingerprints.set(fp, { item, count: 1 });
            deduplicatedItems.push(item);
        }
    }

    // Count total duplicates removed
    let totalDuplicatesRemoved = 0;
    for (const [, entry] of fingerprints) {
        if (entry.count > 1) {
            totalDuplicatesRemoved += entry.count - 1;
        }
    }

    if (totalDuplicatesRemoved > 0) {
        logger.warn(
            `[EngValidator] 🧹 Deduplication removed ${totalDuplicatesRemoved} duplicate item(s) ` +
            `(${acceptedItems.length} → ${deduplicatedItems.length} items).`
        );
        acceptedItems = deduplicatedItems;
    }

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
    screening?: EngineeringItemScreeningResult,
    rowCoverage?: EngineeringRowCoverageReport | null
): EngineeringValidationReport {
    const issues: ValidationIssue[] = [];
    let score = 100; // Start at 100, deduct for problems
    let forceQuarantine = false;

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
    const hasManyRows = items.length >= 15;

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

    // ── Check 1.5: Catastrophic blank rows ──
    // Real budget groupers and composition rows must carry descriptions. A high
    // blank-row ratio is a strong signal that the model is echoing structure
    // without actually reading the sheet.
    const blankDescriptionItems = items.filter(it => String(it.description || '').trim().length < 3);
    if (blankDescriptionItems.length > 0) {
        const blankRatio = items.length > 0 ? blankDescriptionItems.length / items.length : 0;
        const catastrophicBlankRows = hasManyRows && (blankDescriptionItems.length > 15 || blankRatio > 0.12);
        if (catastrophicBlankRows) {
            forceQuarantine = true;
        }
        issues.push({
            code: 'EV06_BLANK_ROWS',
            severity: catastrophicBlankRows ? 'error' : 'warning',
            message: `${blankDescriptionItems.length} linha(s) sem descrição (${Math.round(blankRatio * 100)}% do resultado). ${catastrophicBlankRows ? 'Padrão incompatível com publicação automática.' : 'Revisar antes de publicar.'}`,
            affectedItems: blankDescriptionItems.map(it => it.item).filter(Boolean).slice(0, 30),
        });
        score -= catastrophicBlankRows ? 35 : Math.min(blankDescriptionItems.length, 8);
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
        const duplicateRatio = leafItems.length > 0 ? dupCount / leafItems.length : 0;
        const catastrophicDuplicates = hasManyRows && (dupCount > 25 || duplicateRatio > 0.15);
        if (catastrophicDuplicates) {
            forceQuarantine = true;
        }
        issues.push({
            code: 'EV05',
            severity: catastrophicDuplicates || duplicates.length > 5 ? 'error' : 'warning',
            message: `${dupCount} itens duplicados detectados em ${duplicates.length} grupos (${Math.round(duplicateRatio * 100)}% das composições/insumos).`,
            affectedItems: duplicates.flatMap(([_, items]) => items),
        });
        score -= catastrophicDuplicates ? 35 : Math.min(duplicates.length * 2, 15);
    }

    const itemTypeFingerprints = new Map<string, string[]>();
    for (const it of items) {
        const itemNumber = String(it.item || '').trim();
        const type = String(it.type || '').trim().toUpperCase();
        if (!itemNumber || !type) continue;
        const fp = `${itemNumber}|${type}`;
        if (!itemTypeFingerprints.has(fp)) itemTypeFingerprints.set(fp, []);
        itemTypeFingerprints.get(fp)!.push(itemNumber);
    }
    const repeatedItemNumbers = Array.from(itemTypeFingerprints.entries())
        .filter(([_, itemNumbers]) => itemNumbers.length > 1);
    if (repeatedItemNumbers.length > 0) {
        const repeatedCount = repeatedItemNumbers.reduce((sum, [_, itemNumbers]) => sum + itemNumbers.length - 1, 0);
        const repeatedRatio = items.length > 0 ? repeatedCount / items.length : 0;
        const catastrophicRepeatedNumbering = hasManyRows && (repeatedCount > 20 || repeatedRatio > 0.10);
        if (catastrophicRepeatedNumbering) {
            forceQuarantine = true;
        }
        issues.push({
            code: 'EV05_ITEM_NUMBER',
            severity: catastrophicRepeatedNumbering ? 'error' : 'warning',
            message: `${repeatedCount} repetição(ões) de número+tipo de item em ${repeatedItemNumbers.length} grupo(s). ${catastrophicRepeatedNumbering ? 'Provável extração duplicada por lotes.' : 'Revisar duplicidade.'}`,
            affectedItems: repeatedItemNumbers.flatMap(([_, itemNumbers]) => itemNumbers).slice(0, 40),
        });
        score -= catastrophicRepeatedNumbering ? 30 : Math.min(repeatedCount, 10);
    }

    // ── Check 6: Ghost items (no description or all-zero) ──
    const ghostItems = leafItems.filter(it =>
        (!it.description || it.description.trim().length < 3) ||
        (Number(it.quantity) === 0 && Number(it.unitCost) === 0 && it.type === 'COMPOSICAO')
    );

    if (ghostItems.length > 0) {
        if (hasManyRows && ghostItems.length > 10) {
            forceQuarantine = true;
        }
        issues.push({
            code: 'EV06',
            severity: ghostItems.length > 10 ? 'error' : 'warning',
            message: `${ghostItems.length} itens fantasma (sem descrição ou valores zerados).`,
            affectedItems: ghostItems.map(it => it.item).filter(Boolean),
        });
        score -= Math.min(ghostItems.length, 10);
    }

    const zeroValueCompositions = leafItems.filter(it => {
        const type = String(it.type || '').toUpperCase();
        const qty = Number(it.quantity) || 0;
        const unitCost = Number(it.unitCost) || 0;
        const totalPrice = Number(it.totalPrice) || 0;
        return type === 'COMPOSICAO' && qty > 0 && unitCost <= 0 && totalPrice <= 0;
    });
    if (zeroValueCompositions.length > 0) {
        const zeroRatio = leafItems.length > 0 ? zeroValueCompositions.length / leafItems.length : 0;
        const catastrophicZeroValues = hasManyRows && (zeroValueCompositions.length > 10 || zeroRatio > 0.20);
        if (catastrophicZeroValues) {
            forceQuarantine = true;
        }
        issues.push({
            code: 'EV06_ZERO_VALUES',
            severity: catastrophicZeroValues ? 'error' : 'warning',
            message: `${zeroValueCompositions.length} composição(ões) com quantidade mas custo/total zerados (${Math.round(zeroRatio * 100)}% dos itens de preço). ${catastrophicZeroValues ? 'Provável alucinação ou leitura incompleta.' : 'Revisar valores.'}`,
            affectedItems: zeroValueCompositions.map(it => it.item).filter(Boolean).slice(0, 40),
        });
        score -= catastrophicZeroValues ? 35 : Math.min(zeroValueCompositions.length, 10);
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

    // ── Check 9: Orphan items (composições sem etapa pai) ──
    const allItemNums = items.map(it => String(it.item || ''));
    const etapaNumbers = new Set(etapas.map(it => String(it.item || '').replace(/\.0$/, '')));
    const orphanItems = leafItems.filter(it => {
        const itemNum = String(it.item || '');
        const parentNum = itemNum.split('.').slice(0, 1).join('.');
        return parentNum !== itemNum && !etapaNumbers.has(parentNum);
    });
    if (orphanItems.length > 0 && etapas.length > 0) {
        const orphanRatio = orphanItems.length / leafItems.length;
        if (orphanRatio > 0.3) {
            issues.push({
                code: 'EV09',
                severity: 'warning',
                message: `${orphanItems.length} itens órfãos (sem etapa pai). Hierarquia pode estar incompleta.`,
                affectedItems: orphanItems.map(it => it.item).filter(Boolean).slice(0, 10),
            });
            score -= 5;
        }
    }

    // ── Check 10: Code format validation for known bases ──
    const invalidCodeItems: string[] = [];
    for (const it of leafItems) {
        const code = String(it.code || '').trim();
        const source = String(it.sourceName || '').toUpperCase();
        if (!code || code === 'N/A' || source === 'PROPRIA') continue;

        let isValid = true;
        if (source === 'SINAPI') {
            // SINAPI codes are 5-6 digit numbers
            isValid = /^\d{4,7}$/.test(code.replace(/^0+/, ''));
        } else if (source === 'SEINFRA') {
            // SEINFRA codes: C followed by digits, or just digits
            isValid = /^C?\d{3,6}$/i.test(code);
        } else if (source === 'ORSE') {
            // ORSE: digits or digits/ORSE
            isValid = /^\d{1,6}(\/ORSE)?$/i.test(code);
        }
        // Other bases: skip format check

        if (!isValid) {
            invalidCodeItems.push(it.item);
        }
    }
    if (invalidCodeItems.length > 3) {
        issues.push({
            code: 'EV10',
            severity: 'warning',
            message: `${invalidCodeItems.length} itens com formato de código inválido para a base declarada. Possível confusão de colunas na extração.`,
            affectedItems: invalidCodeItems.slice(0, 10),
        });
        score -= Math.min(invalidCodeItems.length, 8);
    }

    // ── Check 11: Description length anomalies ──
    const shortDescItems = leafItems.filter(it => {
        const desc = String(it.description || '').trim();
        return desc.length >= 3 && desc.length < 10;
    });
    const longDescItems = leafItems.filter(it => {
        const desc = String(it.description || '').trim();
        return desc.length > 300;
    });
    if (shortDescItems.length > leafItems.length * 0.3) {
        issues.push({
            code: 'EV11',
            severity: 'warning',
            message: `${shortDescItems.length} itens com descrição muito curta (<10 chars). Possível extração truncada.`,
            affectedItems: shortDescItems.map(it => it.item).filter(Boolean).slice(0, 5),
        });
        score -= 5;
    }
    if (longDescItems.length > 5) {
        issues.push({
            code: 'EV11',
            severity: 'info',
            message: `${longDescItems.length} itens com descrição muito longa (>300 chars). Pode incluir texto extra do edital.`,
        });
    }

    // ── Check 12: Unit/Quantity consistency ──
    const noUnitItems = leafItems.filter(it => {
        const qty = Number(it.quantity) || 0;
        const unit = String(it.unit || '').trim();
        return qty > 0 && !unit;
    });
    if (noUnitItems.length > 3) {
        issues.push({
            code: 'EV12',
            severity: 'warning',
            message: `${noUnitItems.length} itens com quantidade mas sem unidade. Extração pode ter confundido colunas.`,
            affectedItems: noUnitItems.map(it => it.item).filter(Boolean).slice(0, 5),
        });
        score -= 3;
    }

    // ── Check 13: Numbering sequence gaps ──
    const sortedLeafNums = leafItems
        .map(it => String(it.item || ''))
        .filter(n => /^\d+\.\d+/.test(n))
        .sort((a, b) => {
            const pa = a.split('.').map(Number);
            const pb = b.split('.').map(Number);
            for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
                const diff = (pa[i] || 0) - (pb[i] || 0);
                if (diff !== 0) return diff;
            }
            return 0;
        });

    // Count large gaps (missing items > 3)
    let gapCount = 0;
    for (let i = 1; i < sortedLeafNums.length; i++) {
        const prevParts = sortedLeafNums[i - 1].split('.').map(Number);
        const currParts = sortedLeafNums[i].split('.').map(Number);
        // Same parent etapa, check sequence
        if (prevParts.length >= 2 && currParts.length >= 2 && prevParts[0] === currParts[0]) {
            const gap = currParts[currParts.length - 1] - prevParts[prevParts.length - 1];
            if (gap > 5) gapCount++;
        }
    }
    if (gapCount > 3) {
        issues.push({
            code: 'EV13',
            severity: 'info',
            message: `${gapCount} lacunas na numeração detectadas. Possíveis itens faltantes na extração.`,
        });
        score -= 2;
    }

    // ── Check 15: CPU Contamination Detection ──
    // If the AI extracted from "Composições de Custos Unitários" (CPU) instead of
    // the "Planilha Sintética", items will be individual INSUMOS (servente, pedreiro,
    // cimento, areia) repeated many times across compositions.
    const CPU_INSUMO_PATTERNS = [
        /\bservente\b/i, /\bpedreiro\b/i, /\bcarpinteiro\b/i, /\beletricist/i,
        /\bencanador\b/i, /\bpintor\b/i, /\barmador\b/i, /\bserralheiro\b/i,
        /\bajudante\b/i, /\bmestre de obras?\b/i, /\bencarregado\b/i,
        /\bcimento portland\b/i, /\bareia media\b/i, /\bareia m[eé]dia\b/i,
        /\bbrita\b/i, /\ba[cç]o ca-?\s?(?:50|60)\b/i, /\btijolo\b/i,
    ];

    const cpuSuspectItems = leafItems.filter(it => {
        const desc = String(it.description || '').toLowerCase().trim();
        return CPU_INSUMO_PATTERNS.some(p => p.test(desc));
    });

    // Count description repetitions (CPU hallmark: same insumo across many compositions)
    const cpuDescCounts = new Map<string, number>();
    for (const it of leafItems) {
        const desc = String(it.description || '').toLowerCase().trim().substring(0, 40);
        cpuDescCounts.set(desc, (cpuDescCounts.get(desc) || 0) + 1);
    }
    const highRepeatCount = Array.from(cpuDescCounts.values()).filter(c => c >= 5).length;

    const cpuSuspectRatio = leafItems.length > 0 ? cpuSuspectItems.length / leafItems.length : 0;
    const isCpuContaminated = hasManyRows && (
        (cpuSuspectRatio > 0.25 && cpuSuspectItems.length > 10) ||
        (highRepeatCount >= 5 && cpuSuspectRatio > 0.15)
    );

    if (isCpuContaminated) {
        forceQuarantine = true;
        issues.push({
            code: 'EV15_CPU',
            severity: 'error',
            message: `CONTAMINAÇÃO POR CPU DETECTADA: ${cpuSuspectItems.length}/${leafItems.length} itens ` +
                `(${Math.round(cpuSuspectRatio * 100)}%) são insumos individuais (servente, pedreiro, cimento, etc.). ` +
                `${highRepeatCount} descrições se repetem ≥5 vezes. ` +
                `A IA provavelmente extraiu da "Composição de Custos Unitários" em vez da "Planilha Sintética".`,
            affectedItems: cpuSuspectItems.map(it => it.item).filter(Boolean).slice(0, 20),
        });
        score -= 40;
    } else if (cpuSuspectItems.length > 5 && cpuSuspectRatio > 0.10) {
        issues.push({
            code: 'EV15_CPU',
            severity: 'warning',
            message: `${cpuSuspectItems.length} itens parecem insumos de CPU (${Math.round(cpuSuspectRatio * 100)}% das composições). ` +
                `Revisar se a extração inclui itens da "Composição de Custos Unitários".`,
            affectedItems: cpuSuspectItems.map(it => it.item).filter(Boolean).slice(0, 10),
        });
        score -= 8;
    }

    // ── Check 14: OCR row coverage ──
    if (rowCoverage && rowCoverage.candidateCount >= 10) {
        const coveragePercent = Number(rowCoverage.coveragePercent) || 0;
        const missingRowCount = Number(rowCoverage.missingRowCount) || 0;
        const candidateCount = Number(rowCoverage.candidateCount) || 0;
        const missingRatio = candidateCount > 0 ? missingRowCount / candidateCount : 0;
        const affectedRows = rowCoverage.missingRowIds?.slice(0, 20);

        if (coveragePercent < 60 || missingRatio > 0.25) {
            forceQuarantine = true;
            issues.push({
                code: 'EV14',
                severity: 'error',
                message: `Cobertura OCR baixa: ${coveragePercent}% (${rowCoverage.consumedRowCount}/${candidateCount} linhas candidatas consumidas; ${missingRowCount} pendentes). Extração mantida para revisão.`,
                affectedItems: affectedRows,
            });
            score -= 35;
        } else if (coveragePercent < 85 || missingRatio > 0.10) {
            issues.push({
                code: 'EV14',
                severity: 'warning',
                message: `Cobertura OCR moderada: ${coveragePercent}% (${rowCoverage.consumedRowCount}/${candidateCount} linhas candidatas consumidas; ${missingRowCount} pendentes). Recomenda-se revisar linhas pendentes.`,
                affectedItems: affectedRows,
            });
            score -= 14;
        } else if (missingRowCount > 0) {
            issues.push({
                code: 'EV14',
                severity: 'info',
                message: `Cobertura OCR alta: ${coveragePercent}% (${missingRowCount} linha(s) candidata(s) sem item publicado).`,
                affectedItems: affectedRows,
            });
        }
    }

    // Clamp score
    score = Math.max(0, Math.min(100, score));

    const publishable = score >= 65 && !forceQuarantine; // FIX-06: Below 65 or low OCR coverage = too unreliable

    // Add warning for moderate confidence publications
    if (score >= 65 && score < 80) {
        issues.push({
            code: 'LOW_CONFIDENCE_PUBLICATION',
            severity: 'warning',
            message: `Extração publicada com confiança moderada (${score}%). Recomenda-se revisão manual.`,
        });
    }

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
        rowCoverage: rowCoverage || null,
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
