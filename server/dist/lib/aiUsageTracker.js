"use strict";
/**
 * ══════════════════════════════════════════════════════════════════
 *  AI Usage Tracker — Rastreamento de Consumo por Tenant
 * ══════════════════════════════════════════════════════════════════
 *
 * Tracks every Gemini API call with:
 * - Token counts (input, output, total)
 * - Duration
 * - Operation type (analysis, chat, proposal, etc.)
 * - Tenant + User attribution
 *
 * Data is persisted to PostgreSQL (AiUsageLog) for dashboarding,
 * billing, and abuse detection.
 *
 * Usage:
 *   import { trackAiUsage, getUsageSummary, AiUsageContext } from './lib/aiUsageTracker';
 *
 *   const ctx: AiUsageContext = { tenantId: '...', userId: '...', operation: 'analysis' };
 *   const result = await trackAiUsage(prisma, ctx, () => callGeminiWithRetry(model, opts));
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTenantQuotaLimits = getTenantQuotaLimits;
exports.invalidateTenantQuotaCache = invalidateTenantQuotaCache;
exports.trackAiUsage = trackAiUsage;
exports.getUsageSummary = getUsageSummary;
exports.getSystemUsageSummary = getSystemUsageSummary;
exports.getDailyBreakdown = getDailyBreakdown;
exports.getQuotaStatus = getQuotaStatus;
const logger_1 = require("./logger");
// ══════════════════════════════════════════════════════════════
//  Proactive Quota Alerts — Deduplication
// ══════════════════════════════════════════════════════════════
// Cache: 'tenantId:YYYY-MM:soft|hard' → true (alert already sent this month)
const alertSentCache = new Map();
/**
 * Send a proactive quota alert via all configured channels.
 * Fire-and-forget — never blocks or throws.
 */
async function sendQuotaAlert(prisma, tenantId, level, currentUsage, limit) {
    const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `${tenantId}:${monthKey}:${level}`;
    // Already sent this month? Skip
    if (alertSentCache.has(cacheKey))
        return;
    alertSentCache.set(cacheKey, true);
    const percentUsed = Math.round((currentUsage / limit) * 100);
    const fmtTokens = (n) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : `${(n / 1000).toFixed(0)}K`;
    const emoji = level === 'hard' ? '🛑' : '⚠️';
    const title = level === 'hard' ? 'LIMITE DE IA ATINGIDO' : 'ALERTA DE CONSUMO DE IA';
    const body = level === 'hard'
        ? `O limite mensal de tokens de IA foi <b>atingido</b>. Novas chamadas de IA estão <b>bloqueadas</b> até o próximo mês.`
        : `O consumo de IA ultrapassou <b>${percentUsed}%</b> do limite mensal. Considere reduzir o uso para evitar bloqueio.`;
    const telegramMsg = `${emoji} <b>${title}</b>\n\n` +
        `${body}\n\n` +
        `<b>Consumo atual:</b> ${fmtTokens(currentUsage)} tokens\n` +
        `<b>Limite:</b> ${fmtTokens(limit)} tokens\n` +
        `<b>Uso:</b> ${percentUsed}%\n\n` +
        `<i>Gerencie seus limites em Configurações → Consumo de IA</i>`;
    const plainMsg = telegramMsg.replace(/<[^>]*>/g, '');
    const emailHtml = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
            <div style="background: ${level === 'hard' ? '#fef2f2' : '#fffbeb'}; border: 1px solid ${level === 'hard' ? '#fca5a5' : '#fde68a'}; border-radius: 12px; padding: 20px; margin-bottom: 16px;">
                <h2 style="color: ${level === 'hard' ? '#dc2626' : '#d97706'}; margin: 0 0 12px 0; font-size: 18px;">${emoji} ${title}</h2>
                <p style="color: #374151; margin: 0 0 16px 0; line-height: 1.5;">${body.replace(/<b>/g, '<strong>').replace(/<\/b>/g, '</strong>')}</p>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Consumo atual</td><td style="padding: 6px 0; text-align: right; font-weight: 600; color: #111827;">${fmtTokens(currentUsage)}</td></tr>
                    <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Limite mensal</td><td style="padding: 6px 0; text-align: right; font-weight: 600; color: #111827;">${fmtTokens(limit)}</td></tr>
                    <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Percentual</td><td style="padding: 6px 0; text-align: right; font-weight: 700; color: ${level === 'hard' ? '#dc2626' : '#d97706'};">${percentUsed}%</td></tr>
                </table>
            </div>
            <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0;">LicitaSaaS — Governança de IA</p>
        </div>`;
    try {
        // Import notification service dynamically to avoid circular deps
        const { NotificationService } = await Promise.resolve().then(() => __importStar(require('../services/monitoring/notification.service')));
        // Find notification config for this tenant (reuse chat monitor config)
        const config = await prisma.chatMonitorConfig.findUnique({ where: { tenantId } });
        if (!config) {
            logger_1.logger.info('No notification config for tenant, skipping quota alert', { tenantId, level });
            return;
        }
        const promises = [];
        if (config.telegramChatId) {
            promises.push(NotificationService.sendTelegram(tenantId, config.telegramChatId, telegramMsg));
        }
        if (config.phoneNumber) {
            promises.push(NotificationService.sendWhatsApp(tenantId, config.phoneNumber, plainMsg));
        }
        if (config.notificationEmail) {
            const subject = level === 'hard'
                ? 'LicitaSaaS: 🛑 Limite de IA Atingido'
                : 'LicitaSaaS: ⚠️ Alerta de Consumo de IA';
            promises.push(NotificationService.sendEmail(tenantId, config.notificationEmail, subject, emailHtml));
        }
        if (promises.length > 0) {
            await Promise.allSettled(promises);
            logger_1.logger.info('Quota alert sent', { tenantId, level, channels: promises.length });
        }
    }
    catch (err) {
        logger_1.logger.warn('Failed to send quota alert', { tenantId, level, error: err?.message });
    }
}
// Per-call usage cache: tenantId → { totalTokens, expiresAt }
const quotaCache = new Map();
// Per-tenant quota overrides cache: tenantId → { hardLimit, softLimit, expiresAt }
const tenantLimitsCache = new Map();
/**
 * Get quota limits for a tenant.
 * Priority: tenant-specific (GlobalConfig) → env variable → code default.
 */
async function getTenantQuotaLimits(prisma, tenantId) {
    const defaultHard = parseInt(process.env.AI_MONTHLY_HARD_LIMIT || '20000000', 10);
    const defaultSoft = parseInt(process.env.AI_MONTHLY_SOFT_LIMIT || '15000000', 10);
    if (tenantId === 'system' || tenantId === 'admin') {
        return { hardLimit: defaultHard, softLimit: defaultSoft };
    }
    // Check cache
    const now = Date.now();
    const cached = tenantLimitsCache.get(tenantId);
    if (cached && cached.expiresAt > now) {
        return { hardLimit: cached.hardLimit, softLimit: cached.softLimit };
    }
    // Read from GlobalConfig
    try {
        const gc = await prisma.globalConfig.findUnique({ where: { tenantId } });
        if (gc) {
            const conf = JSON.parse(gc.config || '{}');
            if (conf.aiQuota) {
                const hardLimit = conf.aiQuota.hardLimit || defaultHard;
                const softLimit = conf.aiQuota.softLimit || defaultSoft;
                tenantLimitsCache.set(tenantId, { hardLimit, softLimit, expiresAt: now + 10 * 60 * 1000 });
                return { hardLimit, softLimit };
            }
        }
    }
    catch {
        // Fallback gracefully
    }
    // Default
    tenantLimitsCache.set(tenantId, { hardLimit: defaultHard, softLimit: defaultSoft, expiresAt: now + 10 * 60 * 1000 });
    return { hardLimit: defaultHard, softLimit: defaultSoft };
}
/**
 * Invalidate the cached quota limits for a tenant (call after admin update).
 */
function invalidateTenantQuotaCache(tenantId) {
    tenantLimitsCache.delete(tenantId);
    quotaCache.delete(tenantId);
    // Also clear alert dedup so new limits get fresh alerts
    const monthKey = new Date().toISOString().slice(0, 7);
    alertSentCache.delete(`${tenantId}:${monthKey}:soft`);
    alertSentCache.delete(`${tenantId}:${monthKey}:hard`);
}
async function checkTenantQuota(prisma, tenantId) {
    // System bypass
    if (tenantId === 'system' || tenantId === 'admin')
        return;
    const { hardLimit, softLimit } = await getTenantQuotaLimits(prisma, tenantId);
    const now = Date.now();
    const cached = quotaCache.get(tenantId);
    let currentUsage = 0;
    if (cached && cached.expiresAt > now) {
        currentUsage = cached.totalTokens;
    }
    else {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        const result = await prisma.aiUsageLog.aggregate({
            where: {
                tenantId,
                createdAt: { gte: startOfMonth },
            },
            _sum: {
                totalTokens: true
            }
        });
        currentUsage = result._sum.totalTokens || 0;
        // Cache for 5 minutes
        quotaCache.set(tenantId, {
            totalTokens: currentUsage,
            expiresAt: now + 5 * 60 * 1000
        });
    }
    if (currentUsage >= hardLimit) {
        logger_1.logger.error('Tenant hit AI hard limit', { tenantId, currentUsage, hardLimit });
        // Fire-and-forget proactive alert
        sendQuotaAlert(prisma, tenantId, 'hard', currentUsage, hardLimit).catch(() => { });
        throw new Error(`Cota de inteligência artificial excedida. Limite mensal: ${hardLimit} tokens.`);
    }
    // Soft limit — proactive alert (max 1 per month per tenant)
    if (currentUsage >= softLimit) {
        logger_1.logger.warn('Tenant passed AI soft limit', { tenantId, currentUsage, softLimit });
        // Fire-and-forget proactive alert
        sendQuotaAlert(prisma, tenantId, 'soft', currentUsage, softLimit).catch(() => { });
    }
}
/**
 * Wrap a Gemini API call to automatically track usage.
 * Returns the original result transparently.
 */
async function trackAiUsage(prisma, ctx, callFn) {
    const start = Date.now();
    let success = true;
    let errorMessage;
    let result;
    try {
        // First verify Quota limits before executing expensive AI calls
        await checkTenantQuota(prisma, ctx.tenantId);
        result = await callFn();
        return result;
    }
    catch (error) {
        success = false;
        errorMessage = error?.message?.substring(0, 500) || String(error).substring(0, 500);
        throw error; // re-throw — caller handles the error
    }
    finally {
        const durationMs = Date.now() - start;
        // Extract token usage from Gemini response
        let inputTokens = 0;
        let outputTokens = 0;
        let totalTokens = 0;
        let modelUsed = ctx.model || 'gemini-2.5-flash';
        try {
            if (result && typeof result === 'object') {
                const res = result;
                if (res.usageMetadata) {
                    inputTokens = res.usageMetadata.promptTokenCount || 0;
                    outputTokens = res.usageMetadata.candidatesTokenCount || res.usageMetadata.totalTokenCount || 0;
                    totalTokens = res.usageMetadata.totalTokenCount || (inputTokens + outputTokens);
                }
                if (res.modelVersion) {
                    modelUsed = res.modelVersion;
                }
            }
        }
        catch {
            // Ignore — token extraction is best-effort
        }
        // Persist asynchronously (fire-and-forget to not block the response)
        persistUsage(prisma, {
            tenantId: ctx.tenantId,
            userId: ctx.userId || null,
            operation: ctx.operation,
            model: modelUsed,
            inputTokens,
            outputTokens,
            totalTokens,
            durationMs,
            success,
            errorMessage: errorMessage || null,
            metadata: ctx.metadata || null,
        }).catch((err) => {
            logger_1.logger.warn('Failed to persist AI usage log', { error: err?.message, tenantId: ctx.tenantId });
        });
    }
}
async function persistUsage(prisma, data) {
    try {
        await prisma.aiUsageLog.create({ data });
    }
    catch (error) {
        // If the table doesn't exist yet (pre-migration), log but don't crash
        if (error?.code === 'P2021') {
            logger_1.logger.debug('AiUsageLog table not yet created, skipping usage tracking');
        }
        else {
            logger_1.logger.warn('AI usage persist error', { error: error?.message });
        }
    }
}
/**
 * Get token usage summary for a tenant over a time period.
 */
async function getUsageSummary(prisma, tenantId, periodDays = 30) {
    const cutoff = new Date(Date.now() - periodDays * 86400000);
    const logs = await prisma.aiUsageLog.findMany({
        where: {
            tenantId,
            createdAt: { gte: cutoff },
        },
        select: {
            operation: true,
            model: true,
            inputTokens: true,
            outputTokens: true,
            totalTokens: true,
            durationMs: true,
            success: true,
        },
    });
    const totalCalls = logs.length;
    const totalInputTokens = logs.reduce((s, l) => s + l.inputTokens, 0);
    const totalOutputTokens = logs.reduce((s, l) => s + l.outputTokens, 0);
    const totalTokensSum = logs.reduce((s, l) => s + l.totalTokens, 0);
    const avgDurationMs = totalCalls > 0 ? Math.round(logs.reduce((s, l) => s + l.durationMs, 0) / totalCalls) : 0;
    const errorCount = logs.filter((l) => !l.success).length;
    const errorRate = totalCalls > 0 ? Math.round((errorCount / totalCalls) * 100) : 0;
    // Group by operation
    const opMap = {};
    for (const l of logs) {
        if (!opMap[l.operation])
            opMap[l.operation] = { calls: 0, tokens: 0 };
        opMap[l.operation].calls++;
        opMap[l.operation].tokens += l.totalTokens;
    }
    const byOperation = Object.entries(opMap)
        .map(([operation, data]) => ({ operation, ...data }))
        .sort((a, b) => b.tokens - a.tokens);
    // Group by model
    const modelMap = {};
    for (const l of logs) {
        if (!modelMap[l.model])
            modelMap[l.model] = { calls: 0, tokens: 0 };
        modelMap[l.model].calls++;
        modelMap[l.model].tokens += l.totalTokens;
    }
    const byModel = Object.entries(modelMap)
        .map(([model, data]) => ({ model, ...data }))
        .sort((a, b) => b.tokens - a.tokens);
    return {
        tenantId,
        period: `${periodDays}d`,
        totalCalls,
        totalInputTokens,
        totalOutputTokens,
        totalTokens: totalTokensSum,
        avgDurationMs,
        errorRate,
        byOperation,
        byModel,
    };
}
/**
 * Get usage summary for ALL tenants (admin endpoint).
 */
async function getSystemUsageSummary(prisma, periodDays = 30) {
    const cutoff = new Date(Date.now() - periodDays * 86400000);
    const logs = await prisma.aiUsageLog.findMany({
        where: { createdAt: { gte: cutoff } },
        select: {
            tenantId: true,
            operation: true,
            totalTokens: true,
        },
    });
    const totalCalls = logs.length;
    const totalTokens = logs.reduce((s, l) => s + l.totalTokens, 0);
    // By tenant
    const tenantMap = {};
    for (const l of logs) {
        if (!tenantMap[l.tenantId])
            tenantMap[l.tenantId] = { calls: 0, tokens: 0 };
        tenantMap[l.tenantId].calls++;
        tenantMap[l.tenantId].tokens += l.totalTokens;
    }
    const byTenant = Object.entries(tenantMap)
        .map(([tenantId, data]) => ({ tenantId, ...data }))
        .sort((a, b) => b.tokens - a.tokens);
    // By operation
    const opMap = {};
    for (const l of logs) {
        if (!opMap[l.operation])
            opMap[l.operation] = { calls: 0, tokens: 0 };
        opMap[l.operation].calls++;
        opMap[l.operation].tokens += l.totalTokens;
    }
    const byOperation = Object.entries(opMap)
        .map(([operation, data]) => ({ operation, ...data }))
        .sort((a, b) => b.tokens - a.tokens);
    return { period: `${periodDays}d`, totalCalls, totalTokens, byTenant, byOperation };
}
// ══════════════════════════════════════════════════════════════
//  Gemini Pricing (USD per 1M tokens, May 2025 pricing)
//  Ref: https://ai.google.dev/pricing
// ══════════════════════════════════════════════════════════════
const GEMINI_PRICING_PER_1M = {
    'gemini-2.5-flash': { input: 0.15, output: 0.60 },
    'gemini-2.5-pro': { input: 1.25, output: 5.00 },
    'gemini-2.0-flash': { input: 0.10, output: 0.40 },
    'gemini-1.5-flash': { input: 0.075, output: 0.30 },
};
// BRL/USD exchange rate (updated periodically, fallback)
const DEFAULT_BRL_USD = parseFloat(process.env.BRL_USD_RATE || '5.70');
function estimateCostBRL(model, inputTokens, outputTokens) {
    const pricing = GEMINI_PRICING_PER_1M[model] || GEMINI_PRICING_PER_1M['gemini-2.5-flash'];
    const costUSD = (inputTokens / 1000000) * pricing.input + (outputTokens / 1000000) * pricing.output;
    return costUSD * DEFAULT_BRL_USD;
}
/**
 * Get daily usage breakdown for the dashboard chart.
 */
async function getDailyBreakdown(prisma, tenantId, periodDays = 30) {
    const cutoff = new Date(Date.now() - periodDays * 86400000);
    const logs = await prisma.aiUsageLog.findMany({
        where: {
            tenantId,
            createdAt: { gte: cutoff },
        },
        select: {
            createdAt: true,
            model: true,
            inputTokens: true,
            outputTokens: true,
            totalTokens: true,
        },
        orderBy: { createdAt: 'asc' },
    });
    // Group by date (YYYY-MM-DD)
    const dayMap = {};
    // Pre-fill all days in the period so chart has no gaps
    for (let i = 0; i < periodDays; i++) {
        const d = new Date(Date.now() - (periodDays - 1 - i) * 86400000);
        const key = d.toISOString().split('T')[0];
        dayMap[key] = { calls: 0, tokens: 0, inputTokens: 0, outputTokens: 0, costBRL: 0 };
    }
    for (const l of logs) {
        const key = l.createdAt.toISOString().split('T')[0];
        if (!dayMap[key])
            dayMap[key] = { calls: 0, tokens: 0, inputTokens: 0, outputTokens: 0, costBRL: 0 };
        dayMap[key].calls++;
        dayMap[key].tokens += l.totalTokens;
        dayMap[key].inputTokens += l.inputTokens;
        dayMap[key].outputTokens += l.outputTokens;
        dayMap[key].costBRL += estimateCostBRL(l.model, l.inputTokens, l.outputTokens);
    }
    return Object.entries(dayMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({
        date,
        ...data,
        costBRL: Math.round(data.costBRL * 100) / 100,
    }));
}
/**
 * Get quota status for a tenant (for the dashboard gauge).
 */
async function getQuotaStatus(prisma, tenantId) {
    const { hardLimit, softLimit } = await getTenantQuotaLimits(prisma, tenantId);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const logs = await prisma.aiUsageLog.findMany({
        where: {
            tenantId,
            createdAt: { gte: startOfMonth },
        },
        select: {
            model: true,
            inputTokens: true,
            outputTokens: true,
            totalTokens: true,
        },
    });
    const currentTokens = logs.reduce((s, l) => s + l.totalTokens, 0);
    const estimatedCostBRL = logs.reduce((s, l) => s + estimateCostBRL(l.model, l.inputTokens, l.outputTokens), 0);
    const percentUsed = hardLimit > 0 ? Math.round((currentTokens / hardLimit) * 100) : 0;
    const status = currentTokens >= hardLimit ? 'critical' : currentTokens >= softLimit ? 'warning' : 'ok';
    // Days remaining in the current month
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysRemainingInMonth = endOfMonth.getDate() - now.getDate();
    return {
        currentTokens,
        softLimit,
        hardLimit,
        percentUsed,
        status,
        estimatedCostBRL: Math.round(estimatedCostBRL * 100) / 100,
        daysRemainingInMonth,
    };
}
