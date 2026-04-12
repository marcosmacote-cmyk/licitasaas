/**
 * ══════════════════════════════════════════════════════════════════
 *  Operational Metrics — Telemetria de Erro e Uso Real
 * ══════════════════════════════════════════════════════════════════
 */

import { getFeedbackStats, getAllFeedback, FeedbackModuleName } from './feedbackService';
import { logger } from '../../../lib/logger';

export interface ModuleOperationalMetrics {
    moduleName: string;
    period: string;
    totalExecutions: number;
    approvalRate: number;
    partialApprovalRate: number;
    rejectionRate: number;
    humanReviewRecommendedRate: number;
    humanReviewRequiredRate: number;
    averageQualityScore: number;
    reworkRate: number;
    criticalOmissionRate: number;
    recommendationAdherenceRate: number;
    topIssueTypes: Array<{ issueType: string; count: number }>;
    topErrors: Array<{ error: string; count: number; severity: string }>;
    topEditalTypes: Array<{ editalType: string; averageScore: number }>;
}

export interface SystemOperationalReport {
    generatedAt: string;
    period: string;
    moduleMetrics: ModuleOperationalMetrics[];
    systemWideMetrics: {
        totalFeedback: number;
        overallApprovalRate: number;
        overallRejectionRate: number;
        mostProblematicModule: string;
        mostCommonIssue: string;
    };
}

// ── Armazenamento de execuções ──

interface ExecutionRecord {
    executionId: string;
    moduleName: FeedbackModuleName;
    timestamp: string;
    qualityScore?: number;
    humanReviewStatus?: 'not_needed' | 'recommended' | 'required';
    editalType?: string;
    promptVersion?: string;
}

const executionStore: ExecutionRecord[] = [];

export function recordExecution(record: ExecutionRecord): void {
    executionStore.push(record);
}

export function generateModuleMetrics(moduleName: FeedbackModuleName, periodDays = 30): ModuleOperationalMetrics {
    const cutoff = new Date(Date.now() - periodDays * 86400000);

    const executions = executionStore.filter(e =>
        e.moduleName === moduleName && new Date(e.timestamp) >= cutoff
    );

    const stats = getFeedbackStats(moduleName);
    const totalExec = Math.max(executions.length, stats.total);

    // Quality scores
    const withQuality = executions.filter(e => e.qualityScore !== undefined);
    const avgQuality = withQuality.length > 0
        ? Math.round(withQuality.reduce((sum, e) => sum + (e.qualityScore || 0), 0) / withQuality.length)
        : 0;

    // Human review rates
    const reviewRecommended = executions.filter(e => e.humanReviewStatus === 'recommended').length;
    const reviewRequired = executions.filter(e => e.humanReviewStatus === 'required').length;

    // Edital type performance
    const editalMap: Record<string, { total: number; scoreSum: number }> = {};
    for (const e of executions) {
        const type = e.editalType || 'unknown';
        if (!editalMap[type]) editalMap[type] = { total: 0, scoreSum: 0 };
        editalMap[type].total++;
        editalMap[type].scoreSum += e.qualityScore || 0;
    }
    const topEditalTypes = Object.entries(editalMap)
        .map(([editalType, data]) => ({
            editalType,
            averageScore: data.total > 0 ? Math.round(data.scoreSum / data.total) : 0
        }))
        .sort((a, b) => a.averageScore - b.averageScore);
    // Métricas decisórias
    const allFeedback = getAllFeedback().filter(f => f.moduleName === moduleName && new Date(f.reviewedAt) >= cutoff);
    const reworkCount = allFeedback.filter(f => f.correctedOutput).length;
    const criticalOmissions = allFeedback.filter(f => f.issueTypes.includes('missing_information' as any) || f.issueTypes.includes('false_negative' as any)).length;
    const adherent = allFeedback.filter(f => f.verdict === 'approved' || f.verdict === 'partially_approved').length;

    // Top errors with severity
    const errorMap: Record<string, { count: number; severity: string }> = {};
    for (const fb of allFeedback) {
        for (const issue of fb.issueTypes) {
            if (!errorMap[issue]) errorMap[issue] = { count: 0, severity: 'medium' };
            errorMap[issue].count++;
            if (['hallucination', 'invented_content', 'unsafe_to_use_directly'].includes(issue)) errorMap[issue].severity = 'critical';
            else if (['false_positive', 'missing_legal_ground'].includes(issue)) errorMap[issue].severity = 'high';
        }
    }
    const topErrors = Object.entries(errorMap)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5)
        .map(([error, data]) => ({ error, count: data.count, severity: data.severity }));

    return {
        moduleName,
        period: `${periodDays}d`,
        totalExecutions: totalExec,
        approvalRate: stats.approvalRate,
        partialApprovalRate: stats.total > 0 ? Math.round((stats.partiallyApproved / stats.total) * 100) : 0,
        rejectionRate: stats.total > 0 ? Math.round((stats.rejected / stats.total) * 100) : 0,
        humanReviewRecommendedRate: totalExec > 0 ? Math.round((reviewRecommended / totalExec) * 100) : 0,
        humanReviewRequiredRate: totalExec > 0 ? Math.round((reviewRequired / totalExec) * 100) : 0,
        averageQualityScore: avgQuality,
        reworkRate: allFeedback.length > 0 ? Math.round((reworkCount / allFeedback.length) * 100) : 0,
        criticalOmissionRate: allFeedback.length > 0 ? Math.round((criticalOmissions / allFeedback.length) * 100) : 0,
        recommendationAdherenceRate: allFeedback.length > 0 ? Math.round((adherent / allFeedback.length) * 100) : 0,
        topIssueTypes: stats.topIssues.map(i => ({ issueType: i.type, count: i.count })),
        topErrors,
        topEditalTypes
    };
}

export function generateSystemReport(periodDays = 30): SystemOperationalReport {
    const modules: FeedbackModuleName[] = ['analysis', 'chat', 'petition', 'oracle', 'dossier', 'declaration', 'proposal'];
    const moduleMetrics = modules.map(m => generateModuleMetrics(m, periodDays));

    const globalStats = getFeedbackStats();
    const worstModule = moduleMetrics.reduce((worst, m) =>
        m.rejectionRate > (worst?.rejectionRate || 0) ? m : worst, moduleMetrics[0]);

    const allIssues = moduleMetrics.flatMap(m => m.topIssueTypes);
    const issueCounts: Record<string, number> = {};
    for (const i of allIssues) {
        issueCounts[i.issueType] = (issueCounts[i.issueType] || 0) + i.count;
    }
    const mostCommonIssue = Object.entries(issueCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none';

    const report: SystemOperationalReport = {
        generatedAt: new Date().toISOString(),
        period: `${periodDays}d`,
        moduleMetrics,
        systemWideMetrics: {
            totalFeedback: globalStats.total,
            overallApprovalRate: globalStats.approvalRate,
            overallRejectionRate: globalStats.total > 0 ? Math.round((globalStats.rejected / globalStats.total) * 100) : 0,
            mostProblematicModule: worstModule?.moduleName || 'unknown',
            mostCommonIssue
        }
    };

    logger.info(`[Metrics] System Report: ${globalStats.total} feedbacks | Approval: ${globalStats.approvalRate}% | Worst: ${worstModule?.moduleName} (${worstModule?.rejectionRate}% rejection)`);

    return report;
}
