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
import { logger } from '../../../lib/logger';

// ── Tipos ──

export interface ImprovementInsight {
    insightId: string;
    moduleName: string;
    issuePattern: string;
    frequency: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
    probableCause: string;
    suggestedAction: string;
    relatedCases: string[];
    affectedComponent?: string;
    impactDescription: string;
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
        topReworkModules: string[];
        actionableBacklog: number;
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
                const severity = determineSeverity(moduleName, issueType, execIds.length);
                const action = suggestAction(moduleName, issueType);
                const cause = determineProbableCause(issueType);
                const impact = describeImpact(moduleName, issueType, execIds.length);

                insights.push({
                    insightId: `ins-${moduleName}-${issueType}-${Date.now()}`,
                    moduleName,
                    issuePattern: issueType,
                    frequency: execIds.length,
                    severity,
                    probableCause: cause,
                    suggestedAction: action,
                    relatedCases: execIds.slice(0, 5),
                    affectedComponent: mapIssueToComponent(issueType),
                    impactDescription: impact,
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
                probableCause: `Taxa de rejeição de ${metrics.rejectionRate}% indica problema sistêmico no módulo`,
                suggestedAction: `Módulo ${mod} com ${metrics.rejectionRate}% de rejeição. Revisar prompt, contrato de contexto e schema de saída.`,
                relatedCases: [],
                affectedComponent: `prompt-${mod}`,
                impactDescription: `${mod}: ${metrics.rejectionRate}% das saídas rejeitadas — módulo não está entregando valor ao usuário`,
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

    // Top rework modules (módulos com mais insights)
    const moduleCount: Record<string, number> = {};
    for (const ins of insights) moduleCount[ins.moduleName] = (moduleCount[ins.moduleName] || 0) + 1;
    const topReworkModules = Object.entries(moduleCount).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => `${e[0]}(${e[1]})`);

    const report: ImprovementReport = {
        generatedAt: new Date().toISOString(),
        period: `${periodDays}d`,
        insights,
        summary: {
            totalInsights: insights.length,
            criticalInsights: insights.filter(i => i.severity === 'critical').length,
            highInsights: insights.filter(i => i.severity === 'high').length,
            topModule,
            topPattern,
            topReworkModules,
            actionableBacklog: insights.filter(i => i.severity === 'critical' || i.severity === 'high').length
        },
        goldenCaseCandidates: goldenCandidates.length
    };

    logger.info(`[Insights] Generated ${insights.length} insights (${report.summary.criticalInsights} critical, ${report.summary.highInsights} high) | ${goldenCandidates.length} golden case candidates`);

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

    logger.info(`[GoldenCases] Converted ${converted.length} feedbacks to golden cases`);
    return converted;
}

// ── Helpers ──

function determineSeverity(moduleName: string, issueType: string, frequency: number): ImprovementInsight['severity'] {
    const criticalIssues = ['hallucination', 'unsafe_to_use_directly', 'invented_content'];
    const highIssues = ['false_positive', 'missing_legal_ground', 'incorrect_classification'];
    const criticalModules = ['oracle', 'petition', 'proposal', 'participation'];

    if (criticalIssues.includes(issueType)) return 'critical';
    if (highIssues.includes(issueType) && criticalModules.includes(moduleName)) return 'critical';
    if (highIssues.includes(issueType) || frequency >= 5) return 'high';
    if (frequency >= 3) return 'medium';
    return 'low';
}

function determineProbableCause(issueType: string): string {
    const causeMap: Record<string, string> = {
        'hallucination': 'Prompt com margem excessiva para criação de conteúdo não evidenciado',
        'false_positive': 'Matching por similaridade textual sem validação material/quantitativa',
        'false_negative': 'Contexto insuficiente ou campos decisivos em forbiddenSections',
        'missing_information': 'Campos necessários ausentes no contrato de contexto do módulo',
        'incorrect_classification': 'Regras de taxonomia ou perfis de tipo com gap de cobertura',
        'weak_reasoning': 'Prompt sem exemplos de cadeia de raciocínio esperada',
        'poor_evidence_usage': 'Evidence_registry não incluído ou muito truncado no contexto',
        'weak_operational_value': 'Falta de instrução sobre utilidade prática no prompt',
        'unsafe_to_use_directly': 'Threshold de revisão humana ou confiança está alto demais',
        'excessive_generic': 'Prompt genérico sem contenção contra genericidade',
        'wrong_category': 'Padrões de matching textual na taxonomia com falha',
        'missing_legal_ground': 'Base de fundamentos jurídicos insuficiente no prompt',
        'invented_content': 'Ausência de proibição explícita ou reforço fraco no prompt'
    };
    return causeMap[issueType] || `Investigar causa para padrão: ${issueType}`;
}

function describeImpact(moduleName: string, issueType: string, frequency: number): string {
    return `${moduleName}: padrão '${issueType}' ocorreu ${frequency}x no período — ${getImpactLevel(issueType)} impacto operacional`;
}

function getImpactLevel(issueType: string): string {
    const high = ['hallucination', 'false_positive', 'unsafe_to_use_directly', 'invented_content', 'missing_legal_ground'];
    if (high.includes(issueType)) return 'ALTO';
    return 'MÉDIO';
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
