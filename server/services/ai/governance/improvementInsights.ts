/**
 * ══════════════════════════════════════════════════════════════════
 *  Improvement Insights Service — Loop de Aprendizado Orientado
 * ══════════════════════════════════════════════════════════════════
 *
 *  Transforma feedback, métricas e revisão humana em backlog
 *  acionável de melhorias por módulo.
 */

import { getAllFeedback, getFeedbackForGoldenConversion, markAsConvertedToGolden, FeedbackModuleName } from './feedbackService';
import { generateModuleMetrics } from './operationalMetrics';

// ── Tipos ──

export interface ImprovementInsight {
    insightId: string;
    moduleName: string;
    issuePattern: string;
    frequency: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
    suggestedAction: string;
    relatedCases: string[];
    affectedComponent?: string;
    createdAt: string;
}

export interface ImprovementReport {
    generatedAt: string;
    period: string;
    insights: ImprovementInsight[];
    summary: {
        totalInsights: number;
        criticalInsights: number;
        highInsights: number;
        topModule: string;
        topPattern: string;
    };
    goldenCaseCandidates: number;
}

// ── Gerador de Insights ──

export function generateImprovementInsights(periodDays = 30): ImprovementReport {
    const allFeedback = getAllFeedback();
    const cutoff = new Date(Date.now() - periodDays * 86400000);
    const recentFeedback = allFeedback.filter(f => new Date(f.reviewedAt) >= cutoff);
    const insights: ImprovementInsight[] = [];

    // 1. Agrupar issues por módulo e tipo
    const moduleIssues: Record<string, Record<string, string[]>> = {};
    for (const fb of recentFeedback) {
        if (!moduleIssues[fb.moduleName]) moduleIssues[fb.moduleName] = {};
        for (const issue of fb.issueTypes) {
            if (!moduleIssues[fb.moduleName][issue]) moduleIssues[fb.moduleName][issue] = [];
            moduleIssues[fb.moduleName][issue].push(fb.executionId);
        }
    }

    // 2. Gerar insights para padrões recorrentes (frequency >= 2)
    for (const [moduleName, issues] of Object.entries(moduleIssues)) {
        for (const [issueType, execIds] of Object.entries(issues)) {
            if (execIds.length >= 2) {
                const severity = determineSeverity(issueType, execIds.length);
                const action = suggestAction(moduleName, issueType);

                insights.push({
                    insightId: `ins-${moduleName}-${issueType}-${Date.now()}`,
                    moduleName,
                    issuePattern: issueType,
                    frequency: execIds.length,
                    severity,
                    suggestedAction: action,
                    relatedCases: execIds.slice(0, 5),
                    affectedComponent: mapIssueToComponent(issueType),
                    createdAt: new Date().toISOString()
                });
            }
        }
    }

    // 3. Insights por módulo de métricas operacionais
    const modules: FeedbackModuleName[] = ['chat', 'petition', 'oracle', 'dossier', 'declaration', 'proposal'];
    for (const mod of modules) {
        const metrics = generateModuleMetrics(mod, periodDays);
        if (metrics.rejectionRate > 20) {
            insights.push({
                insightId: `ins-${mod}-high-rejection-${Date.now()}`,
                moduleName: mod,
                issuePattern: 'high_rejection_rate',
                frequency: metrics.totalExecutions,
                severity: metrics.rejectionRate > 40 ? 'critical' : 'high',
                suggestedAction: `Módulo ${mod} com ${metrics.rejectionRate}% de rejeição. Revisar prompt e contrato de contexto.`,
                relatedCases: [],
                affectedComponent: `prompt-${mod}`,
                createdAt: new Date().toISOString()
            });
        }
    }

    // 4. Golden case candidates
    const goldenCandidates = getFeedbackForGoldenConversion();

    // Sort insights
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    insights.sort((a, b) => (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3));

    const topModule = insights.length > 0 ? insights[0].moduleName : 'none';
    const topPattern = insights.length > 0 ? insights[0].issuePattern : 'none';

    const report: ImprovementReport = {
        generatedAt: new Date().toISOString(),
        period: `${periodDays}d`,
        insights,
        summary: {
            totalInsights: insights.length,
            criticalInsights: insights.filter(i => i.severity === 'critical').length,
            highInsights: insights.filter(i => i.severity === 'high').length,
            topModule,
            topPattern
        },
        goldenCaseCandidates: goldenCandidates.length
    };

    console.log(`[Insights] Generated ${insights.length} insights (${report.summary.criticalInsights} critical, ${report.summary.highInsights} high) | ${goldenCandidates.length} golden case candidates`);

    return report;
}

/**
 * Converte feedbacks elegíveis em golden cases
 */
export function convertFeedbackToGoldenCases(): Array<{
    feedbackId: string;
    moduleName: string;
    caseType: string;
    executionId: string;
}> {
    const candidates = getFeedbackForGoldenConversion();
    const converted: Array<{ feedbackId: string; moduleName: string; caseType: string; executionId: string }> = [];

    for (const fb of candidates) {
        let caseType: string;
        if (fb.verdict === 'approved') {
            caseType = 'approved';
        } else if (fb.correctedOutput) {
            caseType = 'corrected';
        } else if (fb.verdict === 'rejected') {
            caseType = 'rejected';
        } else {
            continue;
        }

        converted.push({
            feedbackId: fb.feedbackId,
            moduleName: fb.moduleName,
            caseType,
            executionId: fb.executionId
        });

        markAsConvertedToGolden(fb.feedbackId);
    }

    console.log(`[GoldenCases] Converted ${converted.length} feedbacks to golden cases`);
    return converted;
}

// ── Helpers ──

function determineSeverity(issueType: string, frequency: number): ImprovementInsight['severity'] {
    const criticalIssues = ['hallucination', 'unsafe_to_use_directly', 'invented_content'];
    const highIssues = ['false_positive', 'missing_legal_ground', 'incorrect_classification'];

    if (criticalIssues.includes(issueType)) return 'critical';
    if (highIssues.includes(issueType) || frequency >= 5) return 'high';
    if (frequency >= 3) return 'medium';
    return 'low';
}

function suggestAction(moduleName: string, issueType: string): string {
    const actionMap: Record<string, string> = {
        'hallucination': `Revisar prompt de ${moduleName} para reforçar proibição de invenção`,
        'false_positive': `Adicionar regras de validação no evaluator de ${moduleName}`,
        'false_negative': `Ampliar contexto fornecido ao ${moduleName}`,
        'missing_information': `Verificar contrato de contexto de ${moduleName} — campos necessários podem estar em forbiddenSections`,
        'incorrect_classification': `Revisar taxonomia e regras de distinção para o módulo ${moduleName}`,
        'weak_reasoning': `Fortalecer prompt de ${moduleName} com exemplos de raciocínio esperado`,
        'poor_evidence_usage': `Garantir que evidence_registry está sendo incluído no contexto de ${moduleName}`,
        'weak_operational_value': `Adicionar instruções de utilidade prática no prompt de ${moduleName}`,
        'unsafe_to_use_directly': `Revisar política de revisão humana para ${moduleName} — pode precisar de threshold mais baixo`,
        'excessive_generic': `Adicionar proibição explícita de genericidade no prompt de ${moduleName}`,
        'wrong_category': `Revisar taxonomia — padrões textuais podem estar mapeados incorretamente`,
        'missing_legal_ground': `Fortalecer instrução de fundamentação jurídica no prompt de ${moduleName}`,
        'invented_content': `URGENTE: reforçar proibição de invenção no prompt de ${moduleName}`
    };
    return actionMap[issueType] || `Investigar padrão ${issueType} no módulo ${moduleName}`;
}

function mapIssueToComponent(issueType: string): string {
    const componentMap: Record<string, string> = {
        'hallucination': 'prompt',
        'false_positive': 'evaluator',
        'incorrect_classification': 'taxonomy',
        'missing_information': 'context_contract',
        'weak_reasoning': 'prompt',
        'poor_evidence_usage': 'context_contract',
        'missing_legal_ground': 'prompt',
        'invented_content': 'prompt',
        'wrong_category': 'taxonomy'
    };
    return componentMap[issueType] || 'prompt';
}
