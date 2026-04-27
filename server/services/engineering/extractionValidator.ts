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
}

// ═══════════════════════════════════════════
// Validation checks
// ═══════════════════════════════════════════

/**
 * Validate an engineering extraction result.
 *
 * @param items - The extracted engineering items (from Gemini)
 * @param expectedTotal - The estimated value from the edital (if known)
 * @returns Validation report with score, issues, and publishability
 */
export function validateEngineeringExtraction(
    items: any[],
    expectedTotal?: number | null
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
