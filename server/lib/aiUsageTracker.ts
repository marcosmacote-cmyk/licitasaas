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

import { logger } from './logger';

// Use 'any' for PrismaClient to avoid coupling to generated types before migration
type PrismaAny = any;

// ══════════════════════════════════════════════════════════════
//  Proactive Quota Alerts — Deduplication
// ══════════════════════════════════════════════════════════════
// Cache: 'tenantId:YYYY-MM:soft|hard' → true (alert already sent this month)
const alertSentCache = new Map<string, boolean>();

/**
 * Send a proactive quota alert via all configured channels.
 * Fire-and-forget — never blocks or throws.
 */
async function sendQuotaAlert(
    prisma: PrismaAny,
    tenantId: string,
    level: 'soft' | 'hard',
    currentUsage: number,
    limit: number
): Promise<void> {
    const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `${tenantId}:${monthKey}:${level}`;

    // Already sent this month? Skip
    if (alertSentCache.has(cacheKey)) return;
    alertSentCache.set(cacheKey, true);

    const percentUsed = Math.round((currentUsage / limit) * 100);
    const fmtTokens = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${(n / 1_000).toFixed(0)}K`;

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
        const { NotificationService } = await import('../services/monitoring/notification.service');

        // Find notification config for this tenant (reuse chat monitor config)
        const config = await prisma.chatMonitorConfig.findUnique({ where: { tenantId } });

        if (!config) {
            logger.info('No notification config for tenant, skipping quota alert', { tenantId, level });
            return;
        }

        const promises: Promise<boolean>[] = [];

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
            logger.info('Quota alert sent', { tenantId, level, channels: promises.length });
        }
    } catch (err: any) {
        logger.warn('Failed to send quota alert', { tenantId, level, error: err?.message });
    }
}

export interface AiUsageContext {
    tenantId: string;
    userId?: string;
    operation: string;       // 'analysis' | 'chat' | 'proposal_letter' | 'declaration' | 'oracle' | 'dossier' | 'extraction'
    model?: string;          // resolved after call
    metadata?: Record<string, any>;
}

interface LogEntry {
    operation: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    durationMs: number;
    success: boolean;
    tenantId?: string;
}

export interface UsageSummary {
    tenantId: string;
    period: string;
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    avgDurationMs: number;
    errorRate: number;
    byOperation: Array<{
        operation: string;
        calls: number;
        tokens: number;
    }>;
    byModel: Array<{
        model: string;
        calls: number;
        tokens: number;
    }>;
}

const quotaCache = new Map<string, { totalTokens: number, expiresAt: number }>();

async function checkTenantQuota(prisma: PrismaAny, tenantId: string): Promise<void> {
    // System bypass
    if (tenantId === 'system' || tenantId === 'admin') return;

    const hardLimit = parseInt(process.env.AI_MONTHLY_HARD_LIMIT || '2000000', 10); // Default 2M tokens
    const softLimit = parseInt(process.env.AI_MONTHLY_SOFT_LIMIT || '1500000', 10); // Default 1.5M tokens

    const now = Date.now();
    const cached = quotaCache.get(tenantId);

    let currentUsage = 0;

    if (cached && cached.expiresAt > now) {
        currentUsage = cached.totalTokens;
    } else {
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
        logger.error('Tenant hit AI hard limit', { tenantId, currentUsage, hardLimit });
        // Fire-and-forget proactive alert
        sendQuotaAlert(prisma, tenantId, 'hard', currentUsage, hardLimit).catch(() => {});
        throw new Error(`Cota de inteligência artificial excedida. Limite mensal: ${hardLimit} tokens.`);
    }

    // Soft limit — proactive alert (max 1 per month per tenant)
    if (currentUsage >= softLimit) {
        logger.warn('Tenant passed AI soft limit', { tenantId, currentUsage, softLimit });
        // Fire-and-forget proactive alert
        sendQuotaAlert(prisma, tenantId, 'soft', currentUsage, softLimit).catch(() => {});
    }
}

/**
 * Wrap a Gemini API call to automatically track usage.
 * Returns the original result transparently.
 */
export async function trackAiUsage<T>(
    prisma: PrismaAny,
    ctx: AiUsageContext,
    callFn: () => Promise<T>
): Promise<T> {
    const start = Date.now();
    let success = true;
    let errorMessage: string | undefined;
    let result: T | undefined;

    try {
        // First verify Quota limits before executing expensive AI calls
        await checkTenantQuota(prisma, ctx.tenantId);

        result = await callFn();
        return result;
    } catch (error: any) {
        success = false;
        errorMessage = error?.message?.substring(0, 500) || String(error).substring(0, 500);
        throw error; // re-throw — caller handles the error
    } finally {
        const durationMs = Date.now() - start;

        // Extract token usage from Gemini response
        let inputTokens = 0;
        let outputTokens = 0;
        let totalTokens = 0;
        let modelUsed = ctx.model || 'gemini-2.5-flash';

        try {
            if (result && typeof result === 'object') {
                const res = result as any;
                if (res.usageMetadata) {
                    inputTokens = res.usageMetadata.promptTokenCount || 0;
                    outputTokens = res.usageMetadata.candidatesTokenCount || res.usageMetadata.totalTokenCount || 0;
                    totalTokens = res.usageMetadata.totalTokenCount || (inputTokens + outputTokens);
                }
                if (res.modelVersion) {
                    modelUsed = res.modelVersion;
                }
            }
        } catch {
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
        }).catch((err: any) => {
            logger.warn('Failed to persist AI usage log', { error: err?.message, tenantId: ctx.tenantId });
        });
    }
}

async function persistUsage(prisma: PrismaAny, data: {
    tenantId: string;
    userId: string | null;
    operation: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    durationMs: number;
    success: boolean;
    errorMessage: string | null;
    metadata: Record<string, any> | null;
}) {
    try {
        await prisma.aiUsageLog.create({ data });
    } catch (error: any) {
        // If the table doesn't exist yet (pre-migration), log but don't crash
        if (error?.code === 'P2021') {
            logger.debug('AiUsageLog table not yet created, skipping usage tracking');
        } else {
            logger.warn('AI usage persist error', { error: error?.message });
        }
    }
}

/**
 * Get token usage summary for a tenant over a time period.
 */
export async function getUsageSummary(
    prisma: PrismaAny,
    tenantId: string,
    periodDays: number = 30
): Promise<UsageSummary> {
    const cutoff = new Date(Date.now() - periodDays * 86400000);

    const logs: LogEntry[] = await prisma.aiUsageLog.findMany({
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
    const totalInputTokens = logs.reduce((s: number, l: LogEntry) => s + l.inputTokens, 0);
    const totalOutputTokens = logs.reduce((s: number, l: LogEntry) => s + l.outputTokens, 0);
    const totalTokensSum = logs.reduce((s: number, l: LogEntry) => s + l.totalTokens, 0);
    const avgDurationMs = totalCalls > 0 ? Math.round(logs.reduce((s: number, l: LogEntry) => s + l.durationMs, 0) / totalCalls) : 0;
    const errorCount = logs.filter((l: LogEntry) => !l.success).length;
    const errorRate = totalCalls > 0 ? Math.round((errorCount / totalCalls) * 100) : 0;

    // Group by operation
    const opMap: Record<string, { calls: number; tokens: number }> = {};
    for (const l of logs) {
        if (!opMap[l.operation]) opMap[l.operation] = { calls: 0, tokens: 0 };
        opMap[l.operation].calls++;
        opMap[l.operation].tokens += l.totalTokens;
    }
    const byOperation = Object.entries(opMap)
        .map(([operation, data]) => ({ operation, ...data }))
        .sort((a, b) => b.tokens - a.tokens);

    // Group by model
    const modelMap: Record<string, { calls: number; tokens: number }> = {};
    for (const l of logs) {
        if (!modelMap[l.model]) modelMap[l.model] = { calls: 0, tokens: 0 };
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
export async function getSystemUsageSummary(
    prisma: PrismaAny,
    periodDays: number = 30
): Promise<{
    period: string;
    totalCalls: number;
    totalTokens: number;
    byTenant: Array<{ tenantId: string; calls: number; tokens: number }>;
    byOperation: Array<{ operation: string; calls: number; tokens: number }>;
}> {
    const cutoff = new Date(Date.now() - periodDays * 86400000);

    const logs: Array<{ tenantId: string; operation: string; totalTokens: number }> = await prisma.aiUsageLog.findMany({
        where: { createdAt: { gte: cutoff } },
        select: {
            tenantId: true,
            operation: true,
            totalTokens: true,
        },
    });

    const totalCalls = logs.length;
    const totalTokens = logs.reduce((s: number, l: { totalTokens: number }) => s + l.totalTokens, 0);

    // By tenant
    const tenantMap: Record<string, { calls: number; tokens: number }> = {};
    for (const l of logs) {
        if (!tenantMap[l.tenantId]) tenantMap[l.tenantId] = { calls: 0, tokens: 0 };
        tenantMap[l.tenantId].calls++;
        tenantMap[l.tenantId].tokens += l.totalTokens;
    }
    const byTenant = Object.entries(tenantMap)
        .map(([tenantId, data]) => ({ tenantId, ...data }))
        .sort((a, b) => b.tokens - a.tokens);

    // By operation
    const opMap: Record<string, { calls: number; tokens: number }> = {};
    for (const l of logs) {
        if (!opMap[l.operation]) opMap[l.operation] = { calls: 0, tokens: 0 };
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
const GEMINI_PRICING_PER_1M: Record<string, { input: number; output: number }> = {
    'gemini-2.5-flash': { input: 0.15, output: 0.60 },
    'gemini-2.5-pro':   { input: 1.25, output: 5.00 },
    'gemini-2.0-flash': { input: 0.10, output: 0.40 },
    'gemini-1.5-flash': { input: 0.075, output: 0.30 },
};

// BRL/USD exchange rate (updated periodically, fallback)
const DEFAULT_BRL_USD = parseFloat(process.env.BRL_USD_RATE || '5.70');

function estimateCostBRL(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = GEMINI_PRICING_PER_1M[model] || GEMINI_PRICING_PER_1M['gemini-2.5-flash'];
    const costUSD = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
    return costUSD * DEFAULT_BRL_USD;
}

/**
 * Get daily usage breakdown for the dashboard chart.
 */
export async function getDailyBreakdown(
    prisma: PrismaAny,
    tenantId: string,
    periodDays: number = 30
): Promise<Array<{ date: string; calls: number; tokens: number; inputTokens: number; outputTokens: number; costBRL: number }>> {
    const cutoff = new Date(Date.now() - periodDays * 86400000);

    const logs: Array<{
        createdAt: Date;
        model: string;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
    }> = await prisma.aiUsageLog.findMany({
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
    const dayMap: Record<string, { calls: number; tokens: number; inputTokens: number; outputTokens: number; costBRL: number }> = {};

    // Pre-fill all days in the period so chart has no gaps
    for (let i = 0; i < periodDays; i++) {
        const d = new Date(Date.now() - (periodDays - 1 - i) * 86400000);
        const key = d.toISOString().split('T')[0];
        dayMap[key] = { calls: 0, tokens: 0, inputTokens: 0, outputTokens: 0, costBRL: 0 };
    }

    for (const l of logs) {
        const key = l.createdAt.toISOString().split('T')[0];
        if (!dayMap[key]) dayMap[key] = { calls: 0, tokens: 0, inputTokens: 0, outputTokens: 0, costBRL: 0 };
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
export async function getQuotaStatus(
    prisma: PrismaAny,
    tenantId: string
): Promise<{
    currentTokens: number;
    softLimit: number;
    hardLimit: number;
    percentUsed: number;
    status: 'ok' | 'warning' | 'critical';
    estimatedCostBRL: number;
    daysRemainingInMonth: number;
}> {
    const hardLimit = parseInt(process.env.AI_MONTHLY_HARD_LIMIT || '2000000', 10);
    const softLimit = parseInt(process.env.AI_MONTHLY_SOFT_LIMIT || '1500000', 10);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const logs: Array<{ model: string; inputTokens: number; outputTokens: number; totalTokens: number }> = await prisma.aiUsageLog.findMany({
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
    const status: 'ok' | 'warning' | 'critical' = currentTokens >= hardLimit ? 'critical' : currentTokens >= softLimit ? 'warning' : 'ok';

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
