"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitFeedback = submitFeedback;
exports.getFeedbackByExecution = getFeedbackByExecution;
exports.getFeedbackByModule = getFeedbackByModule;
exports.getAllFeedback = getAllFeedback;
exports.getFeedbackStats = getFeedbackStats;
exports.getFeedbackForGoldenConversion = getFeedbackForGoldenConversion;
exports.markAsConvertedToGolden = markAsConvertedToGolden;
const logger_1 = require("../../../lib/logger");
// ── Armazenamento em memória (será migrado para DB) ──
const feedbackStore = [];
// ── Service ──
function submitFeedback(feedback) {
    feedback.feedbackId = feedback.feedbackId || `fb-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    feedback.reviewedAt = feedback.reviewedAt || new Date().toISOString();
    feedbackStore.push(feedback);
    logger_1.logger.info(`[Feedback] ${feedback.moduleName}: ${feedback.verdict} | Issues: ${feedback.issueTypes.join(', ')} | By: ${feedback.reviewedBy || 'anonymous'}`);
    return feedback;
}
function getFeedbackByExecution(executionId) {
    return feedbackStore.filter(f => f.executionId === executionId);
}
function getFeedbackByModule(moduleName, limit = 50) {
    return feedbackStore
        .filter(f => f.moduleName === moduleName)
        .sort((a, b) => new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime())
        .slice(0, limit);
}
function getAllFeedback() {
    return [...feedbackStore];
}
function getFeedbackStats(moduleName) {
    const items = moduleName ? feedbackStore.filter(f => f.moduleName === moduleName) : feedbackStore;
    const total = items.length;
    const approved = items.filter(f => f.verdict === 'approved').length;
    const partiallyApproved = items.filter(f => f.verdict === 'partially_approved').length;
    const rejected = items.filter(f => f.verdict === 'rejected').length;
    const needsRevision = items.filter(f => f.verdict === 'needs_revision').length;
    // Count issue types
    const issueCounts = {};
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
function getFeedbackForGoldenConversion() {
    return feedbackStore.filter(f => !f.convertedToGoldenCase && (f.verdict === 'approved' ||
        (f.verdict === 'rejected' && f.issueTypes.length > 0) ||
        (f.correctedOutput && f.correctedOutput.length > 50)));
}
function markAsConvertedToGolden(feedbackId) {
    const fb = feedbackStore.find(f => f.feedbackId === feedbackId);
    if (fb)
        fb.convertedToGoldenCase = true;
}
