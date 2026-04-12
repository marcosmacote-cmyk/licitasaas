import { logger } from '../../../lib/logger';
/**
 * ══════════════════════════════════════════════════════════════════
 *  Feedback Schemas & Service — Captura Estruturada de Feedback
 * ══════════════════════════════════════════════════════════════════
 *
 *  Permite que revisores humanos registrem se uma saída da IA foi
 *  correta, parcial, inadequada ou arriscada, com tipologia de erro.
 */

// ── Tipos ──

export type FeedbackModuleName = 'analysis' | 'chat' | 'petition' | 'oracle' | 'dossier' | 'declaration' | 'proposal';

export type FeedbackVerdict = 'approved' | 'partially_approved' | 'rejected' | 'needs_revision';

export type FeedbackIssueType =
    | 'missing_information'
    | 'incorrect_classification'
    | 'weak_reasoning'
    | 'hallucination'
    | 'false_positive'
    | 'false_negative'
    | 'poor_evidence_usage'
    | 'weak_operational_value'
    | 'unsafe_to_use_directly'
    | 'excessive_generic'
    | 'wrong_category'
    | 'missing_legal_ground'
    | 'invented_content';

export interface AIExecutionFeedback {
    feedbackId: string;
    executionId: string;
    moduleName: FeedbackModuleName;
    verdict: FeedbackVerdict;
    issueTypes: FeedbackIssueType[];
    reviewerNotes?: string;
    correctedOutput?: string;
    correctedFields?: Record<string, unknown>;
    reviewedBy?: string;
    reviewedAt: string;
    promptVersion?: string;
    modelUsed?: string;
    editalType?: string;
    convertedToGoldenCase?: boolean;
}

// ── Armazenamento em memória (será migrado para DB) ──

const feedbackStore: AIExecutionFeedback[] = [];

// ── Service ──

export function submitFeedback(feedback: AIExecutionFeedback): AIExecutionFeedback {
    feedback.feedbackId = feedback.feedbackId || `fb-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    feedback.reviewedAt = feedback.reviewedAt || new Date().toISOString();
    feedbackStore.push(feedback);

    logger.info(`[Feedback] ${feedback.moduleName}: ${feedback.verdict} | Issues: ${feedback.issueTypes.join(', ')} | By: ${feedback.reviewedBy || 'anonymous'}`);

    return feedback;
}

export function getFeedbackByExecution(executionId: string): AIExecutionFeedback[] {
    return feedbackStore.filter(f => f.executionId === executionId);
}

export function getFeedbackByModule(moduleName: FeedbackModuleName, limit = 50): AIExecutionFeedback[] {
    return feedbackStore
        .filter(f => f.moduleName === moduleName)
        .sort((a, b) => new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime())
        .slice(0, limit);
}

export function getAllFeedback(): AIExecutionFeedback[] {
    return [...feedbackStore];
}

export function getFeedbackStats(moduleName?: FeedbackModuleName): {
    total: number;
    approved: number;
    partiallyApproved: number;
    rejected: number;
    needsRevision: number;
    topIssues: Array<{ type: string; count: number }>;
    approvalRate: number;
} {
    const items = moduleName ? feedbackStore.filter(f => f.moduleName === moduleName) : feedbackStore;
    const total = items.length;
    const approved = items.filter(f => f.verdict === 'approved').length;
    const partiallyApproved = items.filter(f => f.verdict === 'partially_approved').length;
    const rejected = items.filter(f => f.verdict === 'rejected').length;
    const needsRevision = items.filter(f => f.verdict === 'needs_revision').length;

    // Count issue types
    const issueCounts: Record<string, number> = {};
    for (const f of items) {
        for (const issue of f.issueTypes) {
            issueCounts[issue] = (issueCounts[issue] || 0) + 1;
        }
    }
    const topIssues = Object.entries(issueCounts)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    return {
        total,
        approved,
        partiallyApproved,
        rejected,
        needsRevision,
        topIssues,
        approvalRate: total > 0 ? Math.round((approved / total) * 100) : 0
    };
}

/**
 * Identifica feedbacks que devem virar golden cases
 */
export function getFeedbackForGoldenConversion(): AIExecutionFeedback[] {
    return feedbackStore.filter(f =>
        !f.convertedToGoldenCase && (
            f.verdict === 'approved' ||
            (f.verdict === 'rejected' && f.issueTypes.length > 0) ||
            (f.correctedOutput && f.correctedOutput.length > 50)
        )
    );
}

export function markAsConvertedToGolden(feedbackId: string): void {
    const fb = feedbackStore.find(f => f.feedbackId === feedbackId);
    if (fb) fb.convertedToGoldenCase = true;
}
