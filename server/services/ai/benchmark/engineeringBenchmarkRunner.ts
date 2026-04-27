/**
 * ══════════════════════════════════════════════════════════════════
 *  Engineering Benchmark Runner — Avaliação do pipeline de extração
 * ══════════════════════════════════════════════════════════════════
 *
 *  Compara o output da extração de planilha orçamentária contra
 *  gabaritos esperados (benchmark manifest). Mede:
 *    - Contagem de itens (dentro do range esperado?)
 *    - Cobertura de código oficial
 *    - Reconciliação matemática
 *    - Integridade hierárquica
 *    - Detecção de duplicatas/fantasmas
 *
 *  Pode ser executado:
 *    1. Manualmente via endpoint de debug
 *    2. Automaticamente após cada extração de engenharia
 *    3. Via CLI para regressão em batch
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const engineeringManifest = require('./engineeringBenchmarkManifest.json');
import { validateEngineeringExtraction } from '../../engineering/extractionValidator';
import { logger } from '../../../lib/logger';

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface EngBenchmarkResult {
    caseId: string;
    caseName: string;
    primaryBase: string;
    scores: {
        itemCountInRange: boolean;
        codeCoverageOk: boolean;
        totalReconciliationOk: boolean;
        hierarchyPresent: boolean;
        noDuplicates: boolean;
        noGhosts: boolean;
        etapasFound: string[];
        etapasMissing: string[];
        codesFound: string[];
        codesMissing: string[];
    };
    metrics: {
        itemCount: number;
        expectedRange: string;
        codeCoveragePct: number;
        expectedCodeCoveragePct: number;
        calculatedTotal: number;
        expectedTotal: number;
        divergencePct: number | null;
        validationScore: number;
        etapas: number;
        composicoes: number;
    };
    totalScore: number;
    details: string[];
}

export interface EngBenchmarkSummary {
    manifestVersion: string;
    pipelineVersion: string;
    timestamp: string;
    totalCases: number;
    casesRun: number;
    averageScore: number;
    itemCountAccuracy: number;
    codeCoverageAccuracy: number;
    reconciliationAccuracy: number;
    results: EngBenchmarkResult[];
}

// ═══════════════════════════════════════════
// Core evaluation
// ═══════════════════════════════════════════

/**
 * Evaluate engineering extraction output against a benchmark case.
 */
export function evaluateEngineeringExtraction(
    caseId: string,
    extractedItems: any[],
    actualEstimatedValue?: number
): EngBenchmarkResult | null {
    const benchCase = (engineeringManifest as any).cases.find((c: any) => c.id === caseId);
    if (!benchCase) {
        logger.warn(`[EngBenchmark] Case ${caseId} not found in manifest`);
        return null;
    }

    const expected = benchCase.expected;
    const details: string[] = [];

    // Run the validator
    const validation = validateEngineeringExtraction(
        extractedItems,
        actualEstimatedValue || expected.total_estimated || null
    );

    // ── Score 1: Item count in expected range ──
    const itemCount = extractedItems.length;
    const inRange = itemCount >= expected.min_items && itemCount <= expected.max_items;
    if (!inRange) {
        details.push(`Items: ${itemCount} (esperado ${expected.min_items}-${expected.max_items})`);
    }

    // ── Score 2: Code coverage ──
    const codeCoverageOk = validation.codeCoveragePercent >= expected.code_coverage_min_pct;
    if (!codeCoverageOk) {
        details.push(`Cobertura: ${validation.codeCoveragePercent}% (mínimo: ${expected.code_coverage_min_pct}%)`);
    }

    // ── Score 3: Total reconciliation ──
    let totalReconciliationOk = true;
    let divergencePct: number | null = null;
    const estimatedTotal = actualEstimatedValue || expected.total_estimated || 0;

    if (estimatedTotal > 0 && validation.calculatedTotal > 0) {
        // Account for BDI (test at 0%, 25%, 30%)
        const ratios = [
            validation.calculatedTotal / estimatedTotal,
            (validation.calculatedTotal * 1.25) / estimatedTotal,
            (validation.calculatedTotal * 1.30) / estimatedTotal,
        ];
        const bestDivergence = Math.min(...ratios.map(r => Math.abs(1 - r)));
        divergencePct = Math.round(bestDivergence * 100);
        totalReconciliationOk = divergencePct <= expected.total_tolerance_pct;
        if (!totalReconciliationOk) {
            details.push(`Divergência: ${divergencePct}% (tolerância: ${expected.total_tolerance_pct}%)`);
        }
    }

    // ── Score 4: Hierarchy (etapas present) ──
    const etapas = extractedItems.filter(it => it.type === 'ETAPA');
    const composicoes = extractedItems.filter(it => it.type === 'COMPOSICAO');
    const hierarchyPresent = etapas.length >= expected.min_etapas;
    if (!hierarchyPresent) {
        details.push(`Etapas: ${etapas.length} (mínimo: ${expected.min_etapas})`);
    }

    // Check key etapas
    const allDescriptions = extractedItems.map(it =>
        (it.description || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    );
    const expectedEtapas: string[] = expected.key_etapas || [];
    const etapasFound = expectedEtapas.filter(ke =>
        allDescriptions.some(d => d.includes(ke.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').substring(0, 12)))
    );
    const etapasMissing = expectedEtapas.filter(ke => !etapasFound.includes(ke));
    if (etapasMissing.length > 0) {
        details.push(`Etapas faltando: ${etapasMissing.join(', ')}`);
    }

    // Check key codes
    const allCodes = extractedItems.map(it => (it.code || '').toUpperCase());
    const expectedCodes: string[] = expected.key_codes || [];
    const codesFound = expectedCodes.filter(kc => allCodes.includes(kc.toUpperCase()));
    const codesMissing = expectedCodes.filter(kc => !codesFound.includes(kc));

    // ── Score 5: Duplicates ──
    const duplicateIssues = validation.issues.filter(i => i.code === 'EV05');
    const noDuplicates = duplicateIssues.length === 0 || duplicateIssues.every(i => i.severity !== 'error');

    // ── Score 6: Ghosts ──
    const ghostIssues = validation.issues.filter(i => i.code === 'EV06');
    const noGhosts = ghostIssues.length === 0 || ghostIssues.every(i => i.severity !== 'error');

    // ── Calculate total score ──
    const scoring = (engineeringManifest as any).scoring;
    const totalScore = Math.round(
        (inRange ? scoring.item_count_accuracy : 0) +
        (codeCoverageOk ? scoring.code_coverage : Math.round(scoring.code_coverage * validation.codeCoveragePercent / expected.code_coverage_min_pct)) +
        (totalReconciliationOk ? scoring.total_reconciliation : 0) +
        (hierarchyPresent ? scoring.hierarchy_integrity : Math.round(scoring.hierarchy_integrity * etapas.length / expected.min_etapas)) +
        (noDuplicates ? scoring.no_duplicates : 0) +
        (noGhosts ? scoring.no_ghosts : 0)
    );

    return {
        caseId: benchCase.id,
        caseName: benchCase.name,
        primaryBase: expected.primary_base,
        scores: {
            itemCountInRange: inRange,
            codeCoverageOk,
            totalReconciliationOk,
            hierarchyPresent,
            noDuplicates,
            noGhosts,
            etapasFound,
            etapasMissing,
            codesFound,
            codesMissing,
        },
        metrics: {
            itemCount,
            expectedRange: `${expected.min_items}-${expected.max_items}`,
            codeCoveragePct: validation.codeCoveragePercent,
            expectedCodeCoveragePct: expected.code_coverage_min_pct,
            calculatedTotal: validation.calculatedTotal,
            expectedTotal: estimatedTotal,
            divergencePct,
            validationScore: validation.qualityScore,
            etapas: etapas.length,
            composicoes: composicoes.length,
        },
        totalScore: Math.min(100, totalScore),
        details,
    };
}

/**
 * Generate summary from multiple benchmark results.
 */
export function generateEngineeringSummary(results: EngBenchmarkResult[]): EngBenchmarkSummary {
    const totalCases = (engineeringManifest as any).cases.length;
    const casesRun = results.length;

    const averageScore = casesRun > 0
        ? Math.round(results.reduce((sum, r) => sum + r.totalScore, 0) / casesRun)
        : 0;

    const itemCountAccuracy = casesRun > 0
        ? Math.round(results.filter(r => r.scores.itemCountInRange).length / casesRun * 100)
        : 0;

    const codeCoverageAccuracy = casesRun > 0
        ? Math.round(results.filter(r => r.scores.codeCoverageOk).length / casesRun * 100)
        : 0;

    const reconciliationAccuracy = casesRun > 0
        ? Math.round(results.filter(r => r.scores.totalReconciliationOk).length / casesRun * 100)
        : 0;

    // Log summary
    logger.info(`\n[EngBenchmark] ══════════════ SUMÁRIO ENGENHARIA ══════════════`);
    logger.info(`[EngBenchmark] Pipeline: ${(engineeringManifest as any).pipeline_version}`);
    logger.info(`[EngBenchmark] Cases: ${casesRun}/${totalCases} | Score Médio: ${averageScore}%`);
    logger.info(`[EngBenchmark] Item Count: ${itemCountAccuracy}% | Code Coverage: ${codeCoverageAccuracy}% | Reconciliation: ${reconciliationAccuracy}%`);
    for (const r of results) {
        const status = r.totalScore >= 70 ? '✅' : r.totalScore >= 40 ? '⚠️' : '❌';
        logger.info(
            `[EngBenchmark]   ${r.caseId}: ${r.totalScore}% ${status} — ${r.caseName} ` +
            `(${r.metrics.itemCount} items, ${r.metrics.codeCoveragePct}% codes, ${r.metrics.etapas} etapas)` +
            (r.details.length > 0 ? ` | ${r.details.join(' | ')}` : '')
        );
    }
    logger.info(`[EngBenchmark] ═══════════════════════════════════\n`);

    return {
        manifestVersion: (engineeringManifest as any).version,
        pipelineVersion: (engineeringManifest as any).pipeline_version,
        timestamp: new Date().toISOString(),
        totalCases,
        casesRun,
        averageScore,
        itemCountAccuracy,
        codeCoverageAccuracy,
        reconciliationAccuracy,
        results,
    };
}

/**
 * Auto-evaluate: After each engineering extraction, check if the bidding
 * matches a benchmark case and log the comparison.
 */
export function autoEvaluateIfBenchmarkCase(
    pncpRef: { cnpj?: string; ano?: string; seq?: string } | null,
    extractedItems: any[],
    estimatedValue?: number
): EngBenchmarkResult | null {
    if (!pncpRef?.cnpj || !pncpRef?.seq) return null;

    // Find matching case in manifest
    const matchingCase = (engineeringManifest as any).cases.find((c: any) =>
        c.pncp_ref?.cnpj === pncpRef.cnpj &&
        c.pncp_ref?.seq === pncpRef.seq
    );

    if (!matchingCase) return null;

    logger.info(`[EngBenchmark] 🎯 Benchmark case detected: ${matchingCase.id} — ${matchingCase.name}`);
    return evaluateEngineeringExtraction(matchingCase.id, extractedItems, estimatedValue);
}
