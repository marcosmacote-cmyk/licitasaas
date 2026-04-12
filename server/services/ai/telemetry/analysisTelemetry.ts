/**
 * ══════════════════════════════════════════════════════════════════
 *  Analysis Telemetry Service — Observabilidade de Produção
 * ══════════════════════════════════════════════════════════════════
 *
 *  Persiste métricas de cada análise no PostgreSQL via Prisma.
 *  Fornece:
 *   1. recordAnalysis() — chamada após cada análise completa
 *   2. getPipelineHealth() — agregação para dashboard admin
 *   3. checkDriftAlerts() — alarmes automáticos de degradação
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../../../lib/logger';

const prisma = new PrismaClient();

// ── Types ──

export interface TelemetryInput {
    tenantId: string;
    processId?: string;
    
    // Input
    numPdfs: number;
    totalPages: number;
    totalChars: number;
    hasScannedPdf: boolean;
    portal?: string;
    modalidade?: string;
    objeto?: string;
    
    // Extraction
    model: string;
    promptVersion: string;
    extractionTimeMs: number;
    totalTimeMs: number;
    parseRepairs: number;
    fallbackUsed: boolean;
    categoryGapRecovery: boolean;
    
    // Output
    totalRequirements: number;
    categoryCounts: Record<string, number>;
    totalEvidences: number;
    totalRisks: number;
    qualityScore?: number;
    confidenceScore?: number;
    
    // Enforcer
    enforcerCorrections: number;
    safetyNetsTriggered: string[];
    
    // Result
    status: 'success' | 'partial' | 'error';
    errorMessage?: string;
}

export interface PipelineHealthReport {
    period: string;
    totalAnalyses: number;
    avgQuality: number;
    avgConfidence: number;
    avgTimeMs: number;
    modelDistribution: Record<string, number>;
    topSafetyNets: Array<{ name: string; count: number }>;
    qualityTrend: Array<{ date: string; avg: number; count: number }>;
    errorRate: number;
    scannedPdfRate: number;
    avgRequirements: number;
    avgEvidences: number;
    fallbackRate: number;
    alerts: DriftAlert[];
}

export interface DriftAlert {
    type: 'quality_drop' | 'enforcer_overload' | 'parse_errors' | 'extraction_thin' | 'slow_pipeline' | 'fallback_spike';
    severity: 'warning' | 'critical';
    message: string;
    value: number;
    threshold: number;
    detectedAt: string;
}

// ── Record Analysis ──

export async function recordAnalysisTelemetry(input: TelemetryInput): Promise<void> {
    try {
        await prisma.aiAnalysisTelemetry.create({
            data: {
                tenantId: input.tenantId,
                processId: input.processId,
                numPdfs: input.numPdfs,
                totalPages: input.totalPages,
                totalChars: input.totalChars,
                hasScannedPdf: input.hasScannedPdf,
                portal: input.portal || null,
                modalidade: input.modalidade || null,
                objeto: (input.objeto || '').substring(0, 200) || null,
                model: input.model,
                promptVersion: input.promptVersion,
                extractionTimeMs: input.extractionTimeMs,
                totalTimeMs: input.totalTimeMs,
                parseRepairs: input.parseRepairs,
                fallbackUsed: input.fallbackUsed,
                categoryGapRecovery: input.categoryGapRecovery,
                totalRequirements: input.totalRequirements,
                categoryCounts: input.categoryCounts as any,
                totalEvidences: input.totalEvidences,
                totalRisks: input.totalRisks,
                qualityScore: input.qualityScore ?? null,
                confidenceScore: input.confidenceScore ?? null,
                enforcerCorrections: input.enforcerCorrections,
                safetyNetsTriggered: input.safetyNetsTriggered as any,
                status: input.status,
                errorMessage: input.errorMessage || null,
            }
        });
        logger.info(`[Telemetry] ✅ Recorded | Quality: ${input.qualityScore ?? '-'}% | Reqs: ${input.totalRequirements} | Enforcer: ${input.enforcerCorrections} corrections | Status: ${input.status}`);
    } catch (err: any) {
        // Telemetry must never crash the pipeline
        logger.error(`[Telemetry] ⚠️ Failed to record (non-blocking): ${err.message}`);
    }
}

// ── Pipeline Health Dashboard ──

export async function getPipelineHealth(periodDays = 7): Promise<PipelineHealthReport> {
    const since = new Date(Date.now() - periodDays * 86400000);
    
    const records = await prisma.aiAnalysisTelemetry.findMany({
        where: { timestamp: { gte: since } },
        orderBy: { timestamp: 'asc' },
    });
    
    const total = records.length;
    if (total === 0) {
        return {
            period: `${periodDays}d`, totalAnalyses: 0,
            avgQuality: 0, avgConfidence: 0, avgTimeMs: 0,
            modelDistribution: {}, topSafetyNets: [],
            qualityTrend: [], errorRate: 0, scannedPdfRate: 0,
            avgRequirements: 0, avgEvidences: 0, fallbackRate: 0,
            alerts: [],
        };
    }
    
    // Averages
    const withQuality = records.filter(r => r.qualityScore != null);
    const avgQuality = withQuality.length > 0
        ? Math.round(withQuality.reduce((s, r) => s + (r.qualityScore || 0), 0) / withQuality.length * 10) / 10
        : 0;
    
    const withConfidence = records.filter(r => r.confidenceScore != null);
    const avgConfidence = withConfidence.length > 0
        ? Math.round(withConfidence.reduce((s, r) => s + (r.confidenceScore || 0), 0) / withConfidence.length * 10) / 10
        : 0;
    
    const avgTimeMs = Math.round(records.reduce((s, r) => s + r.totalTimeMs, 0) / total);
    const avgRequirements = Math.round(records.reduce((s, r) => s + r.totalRequirements, 0) / total);
    const avgEvidences = Math.round(records.reduce((s, r) => s + r.totalEvidences, 0) / total);
    
    // Model distribution
    const modelDist: Record<string, number> = {};
    for (const r of records) {
        modelDist[r.model] = (modelDist[r.model] || 0) + 1;
    }
    
    // Top safety nets
    const netCounts: Record<string, number> = {};
    for (const r of records) {
        const nets = (r.safetyNetsTriggered as string[]) || [];
        for (const n of nets) {
            netCounts[n] = (netCounts[n] || 0) + 1;
        }
    }
    const topSafetyNets = Object.entries(netCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    
    // Quality trend (daily)
    const dailyMap: Record<string, { total: number; sum: number }> = {};
    for (const r of withQuality) {
        const day = r.timestamp.toISOString().substring(0, 10);
        if (!dailyMap[day]) dailyMap[day] = { total: 0, sum: 0 };
        dailyMap[day].total++;
        dailyMap[day].sum += r.qualityScore || 0;
    }
    const qualityTrend = Object.entries(dailyMap)
        .map(([date, d]) => ({ date, avg: Math.round(d.sum / d.total * 10) / 10, count: d.total }))
        .sort((a, b) => a.date.localeCompare(b.date));
    
    // Rates
    const errorRate = Math.round(records.filter(r => r.status === 'error').length / total * 1000) / 10;
    const scannedPdfRate = Math.round(records.filter(r => r.hasScannedPdf).length / total * 1000) / 10;
    const fallbackRate = Math.round(records.filter(r => r.fallbackUsed).length / total * 1000) / 10;
    
    // Drift alerts
    const alerts = checkDriftAlerts(records);
    
    return {
        period: `${periodDays}d`,
        totalAnalyses: total,
        avgQuality, avgConfidence, avgTimeMs,
        modelDistribution: modelDist,
        topSafetyNets, qualityTrend,
        errorRate, scannedPdfRate, fallbackRate,
        avgRequirements, avgEvidences,
        alerts,
    };
}

// ── Drift Detection ──

function checkDriftAlerts(records: any[]): DriftAlert[] {
    const alerts: DriftAlert[] = [];
    const now = new Date().toISOString();
    
    if (records.length < 3) return alerts; // Not enough data
    
    // Check last 3 analyses for quality drop
    const last3 = records.slice(-3);
    const last3Quality = last3.filter((r: any) => r.qualityScore != null).map((r: any) => r.qualityScore);
    if (last3Quality.length === 3 && last3Quality.every((q: number) => q < 70)) {
        alerts.push({
            type: 'quality_drop',
            severity: 'critical',
            message: `Últimas 3 análises com qualidade < 70%: [${last3Quality.join(', ')}]`,
            value: Math.round(last3Quality.reduce((a: number, b: number) => a + b, 0) / 3),
            threshold: 70,
            detectedAt: now,
        });
    }
    
    // Enforcer overload (average > 25 corrections)
    const avgCorrections = records.reduce((s: number, r: any) => s + r.enforcerCorrections, 0) / records.length;
    if (avgCorrections > 25) {
        alerts.push({
            type: 'enforcer_overload',
            severity: 'warning',
            message: `SchemaEnforcer med: ${avgCorrections.toFixed(1)} correções/análise (threshold: 25)`,
            value: Math.round(avgCorrections),
            threshold: 25,
            detectedAt: now,
        });
    }
    
    // Parse errors spike (>5 repairs in any recent analysis)
    const highRepairs = records.filter((r: any) => r.parseRepairs > 5);
    if (highRepairs.length > 0) {
        alerts.push({
            type: 'parse_errors',
            severity: 'warning',
            message: `${highRepairs.length} análise(s) com JSON truncado (parseRepairs > 5)`,
            value: highRepairs.length,
            threshold: 0,
            detectedAt: now,
        });
    }
    
    // Thin extraction (< 10 requirements)
    const thinCount = records.filter((r: any) => r.totalRequirements < 10).length;
    if (thinCount > records.length * 0.3) {
        alerts.push({
            type: 'extraction_thin',
            severity: 'critical',
            message: `${thinCount}/${records.length} análises com < 10 exigências (>30%)`,
            value: thinCount,
            threshold: Math.round(records.length * 0.3),
            detectedAt: now,
        });
    }
    
    // Slow pipeline (avg > 300s)
    const avgTime = records.reduce((s: number, r: any) => s + r.totalTimeMs, 0) / records.length;
    if (avgTime > 300000) {
        alerts.push({
            type: 'slow_pipeline',
            severity: 'warning',
            message: `Pipeline lento: média ${(avgTime / 1000).toFixed(0)}s (threshold: 300s)`,
            value: Math.round(avgTime / 1000),
            threshold: 300,
            detectedAt: now,
        });
    }
    
    // Fallback spike (>30% using OpenAI)
    const fallbackCount = records.filter((r: any) => r.fallbackUsed).length;
    const fallbackPct = fallbackCount / records.length * 100;
    if (fallbackPct > 30) {
        alerts.push({
            type: 'fallback_spike',
            severity: 'critical',
            message: `${fallbackPct.toFixed(0)}% usando OpenAI fallback (threshold: 30%)`,
            value: Math.round(fallbackPct),
            threshold: 30,
            detectedAt: now,
        });
    }
    
    return alerts;
}

// ── Classify Safety Nets from Enforcer Details ──

export function classifySafetyNets(details: string[]): string[] {
    const nets: Set<string> = new Set();
    for (const d of details) {
        const dl = d.toLowerCase();
        if (dl.includes('cnpj') && dl.includes('ie') && dl.includes('im')) nets.add('RFT_REGRA_OURO');
        else if (dl.includes('rft') && (dl.includes('cnd') || dl.includes('fgts') || dl.includes('cndt'))) nets.add('RFT_CND_INJECTION');
        else if (dl.includes('qef') && (dl.includes('balanç') || dl.includes('índice') || dl.includes('falência'))) nets.add('QEF_INJECTION');
        else if (dl.includes('pc:') || dl.includes('pc ')) nets.add('PC_CLEANUP');
        else if (dl.includes('consórcio')) nets.add('HJ_CONSORCIO');
        else if (dl.includes('reserva')) nets.add('RFT_DC_RESERVA_PCD');
        else if (dl.includes('dc↔rft') || dl.includes('dc→rft') || dl.includes('duplicado')) nets.add('DC_RFT_DEDUP');
        else if (dl.includes('habilitacao_juridica') && dl.includes('vazia')) nets.add('HJ_EMPTY_INJECTION');
        else if (dl.includes('participation_conditions')) nets.add('PART_COND_DEFAULTS');
        else if (dl.includes('modalidade')) nets.add('MODALIDADE_NORMALIZATION');
        else if (dl.includes('description') && dl.includes('copiado')) nets.add('DESCRIPTION_COPY');
    }
    return [...nets];
}
