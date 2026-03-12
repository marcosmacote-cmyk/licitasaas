/**
 * ══════════════════════════════════════════════════════════════════
 *  Regression Runner + Promotion Gate
 * ══════════════════════════════════════════════════════════════════
 *
 *  Impede que mudanças em prompt, regra, contexto ou modelo
 *  sejam promovidas sem validação comparativa.
 */

// ── Tipos ──

export type VersionStatus = 'experimental' | 'in_validation' | 'stable' | 'promoted' | 'rollback_candidate' | 'archived';

export interface VersionEntry {
    componentName: string;
    version: string;
    status: VersionStatus;
    createdAt: string;
    promotedAt?: string;
    author?: string;
    changeType: 'prompt' | 'rule' | 'taxonomy' | 'context_contract' | 'output_schema' | 'model' | 'evaluator' | 'policy';
    changeDescription: string;
    impactScope: string[];
    benchmarkResultId?: string;
}

export interface RegressionResult {
    componentName: string;
    candidateVersion: string;
    baselineVersion: string;
    testSuite: string;
    totalTests: number;
    passed: number;
    failed: number;
    regressions: string[];
    improvements: string[];
    deltaScore: number;
    timestamp: string;
}

export interface PromotionDecision {
    componentName: string;
    candidateVersion: string;
    baselineVersion: string;
    benchmarkDelta: number;
    regressionIssues: string[];
    decision: 'promote' | 'hold' | 'rollback';
    reason: string;
    decidedAt: string;
    decidedBy?: string;
}

// ── Stores ──

const versionStore: VersionEntry[] = [];
const regressionStore: RegressionResult[] = [];
const promotionStore: PromotionDecision[] = [];

// ── Version Catalog ──

export function registerVersion(entry: VersionEntry): VersionEntry {
    entry.createdAt = entry.createdAt || new Date().toISOString();
    entry.status = entry.status || 'experimental';
    versionStore.push(entry);
    console.log(`[Version] Registered: ${entry.componentName}@${entry.version} (${entry.status}) — ${entry.changeDescription}`);
    return entry;
}

export function getVersionHistory(componentName: string): VersionEntry[] {
    return versionStore
        .filter(v => v.componentName === componentName)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getCurrentVersion(componentName: string): VersionEntry | undefined {
    return versionStore
        .filter(v => v.componentName === componentName && (v.status === 'promoted' || v.status === 'stable'))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

export function getAllVersions(): VersionEntry[] {
    return [...versionStore];
}

// ── Regression Runner ──

export function runRegression(
    componentName: string,
    candidateVersion: string,
    baselineVersion: string,
    testResults: Array<{ testId: string; passed: boolean; details?: string }>
): RegressionResult {
    const passed = testResults.filter(t => t.passed).length;
    const failed = testResults.filter(t => !t.passed).length;
    const regressions = testResults.filter(t => !t.passed).map(t => `${t.testId}: ${t.details || 'failed'}`);
    const improvements = testResults.filter(t => t.passed).map(t => t.testId);
    const deltaScore = testResults.length > 0
        ? Math.round(((passed - failed) / testResults.length) * 100)
        : 0;

    const result: RegressionResult = {
        componentName,
        candidateVersion,
        baselineVersion,
        testSuite: `regression-${componentName}`,
        totalTests: testResults.length,
        passed,
        failed,
        regressions,
        improvements,
        deltaScore,
        timestamp: new Date().toISOString()
    };

    regressionStore.push(result);
    console.log(`[Regression] ${componentName}: ${candidateVersion} vs ${baselineVersion} — ${passed}/${testResults.length} passed (delta: ${deltaScore > 0 ? '+' : ''}${deltaScore})`);

    return result;
}

// ── Promotion Gate ──

export function evaluatePromotion(
    componentName: string,
    candidateVersion: string,
    baselineVersion: string,
    regressionResult: RegressionResult,
    thresholds = { minPassRate: 80, maxRegressions: 2, minDelta: -10 }
): PromotionDecision {
    const passRate = regressionResult.totalTests > 0
        ? Math.round((regressionResult.passed / regressionResult.totalTests) * 100)
        : 0;

    let decision: 'promote' | 'hold' | 'rollback';
    let reason: string;

    if (passRate >= thresholds.minPassRate &&
        regressionResult.regressions.length <= thresholds.maxRegressions &&
        regressionResult.deltaScore >= thresholds.minDelta) {
        decision = 'promote';
        reason = `Pass rate: ${passRate}% (>= ${thresholds.minPassRate}%), regressions: ${regressionResult.regressions.length} (<= ${thresholds.maxRegressions}), delta: ${regressionResult.deltaScore} (>= ${thresholds.minDelta})`;
    } else if (regressionResult.deltaScore < -30 || passRate < 50) {
        decision = 'rollback';
        reason = `Critical regression: pass rate ${passRate}%, delta ${regressionResult.deltaScore}`;
    } else {
        decision = 'hold';
        reason = `Below thresholds: pass rate ${passRate}%, regressions ${regressionResult.regressions.length}, delta ${regressionResult.deltaScore}`;
    }

    const promotionDecision: PromotionDecision = {
        componentName,
        candidateVersion,
        baselineVersion,
        benchmarkDelta: regressionResult.deltaScore,
        regressionIssues: regressionResult.regressions,
        decision,
        reason,
        decidedAt: new Date().toISOString()
    };

    promotionStore.push(promotionDecision);

    // Update version status
    const versionEntry = versionStore.find(v =>
        v.componentName === componentName && v.version === candidateVersion
    );
    if (versionEntry) {
        if (decision === 'promote') {
            versionEntry.status = 'promoted';
            versionEntry.promotedAt = new Date().toISOString();
            // Demote previous
            versionStore.filter(v =>
                v.componentName === componentName &&
                v.version !== candidateVersion &&
                v.status === 'promoted'
            ).forEach(v => v.status = 'archived');
        } else if (decision === 'rollback') {
            versionEntry.status = 'rollback_candidate';
        } else {
            versionEntry.status = 'in_validation';
        }
    }

    console.log(`[Promotion] ${componentName}: ${candidateVersion} — ${decision.toUpperCase()} — ${reason}`);

    return promotionDecision;
}

export function getPromotionHistory(componentName?: string): PromotionDecision[] {
    const items = componentName
        ? promotionStore.filter(p => p.componentName === componentName)
        : promotionStore;
    return items.sort((a, b) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime());
}

export function getRegressionHistory(componentName?: string): RegressionResult[] {
    const items = componentName
        ? regressionStore.filter(r => r.componentName === componentName)
        : regressionStore;
    return items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// ── Register Initial Versions ──

export function registerInitialVersions(): void {
    const initialVersions: Omit<VersionEntry, 'createdAt'>[] = [
        { componentName: 'prompt-base', version: 'v3.0.0', status: 'promoted', changeType: 'prompt', changeDescription: 'Base prompt com taxonomia inline', impactScope: ['analysis'] },
        { componentName: 'prompt-extraction', version: 'v3.0.0', status: 'promoted', changeType: 'prompt', changeDescription: 'Extração factual com 17 regras de qualidade', impactScope: ['analysis'] },
        { componentName: 'prompt-normalization', version: 'v3.0.0', status: 'promoted', changeType: 'prompt', changeDescription: 'Normalização com reclassificação ativa', impactScope: ['analysis'] },
        { componentName: 'prompt-risk-review', version: 'v3.0.0', status: 'promoted', changeType: 'prompt', changeDescription: 'Risk review com checklist 7 dimensões', impactScope: ['analysis'] },
        { componentName: 'prompt-chat', version: 'v2.0.0', status: 'promoted', changeType: 'prompt', changeDescription: 'Consultor com fato/inferência/recomendação', impactScope: ['chat'] },
        { componentName: 'prompt-petition', version: 'v2.0.0', status: 'promoted', changeType: 'prompt', changeDescription: 'Redator jurídico com tese+fundamento+pedido', impactScope: ['petition'] },
        { componentName: 'prompt-oracle', version: 'v2.0.0', status: 'promoted', changeType: 'prompt', changeDescription: 'Comparador com aderência material', impactScope: ['oracle'] },
        { componentName: 'prompt-dossier', version: 'v2.0.0', status: 'promoted', changeType: 'prompt', changeDescription: 'Organizador documental por criticidade', impactScope: ['dossier'] },
        { componentName: 'prompt-declaration', version: 'v2.0.0', status: 'promoted', changeType: 'prompt', changeDescription: 'Gerador formal com baixa criatividade', impactScope: ['declaration'] },
        { componentName: 'prompt-proposal', version: 'v2.0.0', status: 'promoted', changeType: 'prompt', changeDescription: 'Estruturador com riscos de desclassificação', impactScope: ['proposal'] },
        { componentName: 'taxonomy', version: 'v1.0.0', status: 'promoted', changeType: 'taxonomy', changeDescription: '8 categorias, 5 distinções, 6 perfis de tipo', impactScope: ['analysis', 'all_modules'] },
        { componentName: 'rules-engine', version: 'v1.0.0', status: 'promoted', changeType: 'rule', changeDescription: '15 regras determinísticas R01-R15', impactScope: ['analysis'] },
        { componentName: 'quality-evaluator-core', version: 'v1.0.0', status: 'promoted', changeType: 'evaluator', changeDescription: '30 checagens em 5 dimensões', impactScope: ['analysis'] },
        { componentName: 'quality-evaluator-modules', version: 'v1.0.0', status: 'promoted', changeType: 'evaluator', changeDescription: '30 checagens em 6 módulos', impactScope: ['all_modules'] },
        { componentName: 'context-contracts', version: 'v1.0.0', status: 'promoted', changeType: 'context_contract', changeDescription: '6 contratos com required/optional/forbidden', impactScope: ['all_modules'] },
        { componentName: 'human-review-policy', version: 'v1.0.0', status: 'promoted', changeType: 'policy', changeDescription: '20 regras recommended/required', impactScope: ['all_modules'] },
    ];

    for (const v of initialVersions) {
        if (!versionStore.find(e => e.componentName === v.componentName && e.version === v.version)) {
            registerVersion({ ...v, createdAt: '2026-03-12T19:00:00Z' });
        }
    }
}
