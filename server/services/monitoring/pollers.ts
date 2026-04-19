/**
 * ══════════════════════════════════════════════════════════════════
 *  Shared Polling Functions — Chat Monitoring Pollers
 * ══════════════════════════════════════════════════════════════════
 *
 * Single source of truth for all platform polling logic.
 * Used by both server/index.ts (when PROCESS_ROLE !== 'api')
 * and server/worker.ts.
 *
 * Each poller queries monitored processes from Prisma, fetches
 * messages from the external platform, and ingests them via
 * IngestService (with dedup, alerting, and notification).
 */

import { PrismaClient } from '@prisma/client';
import { BatchPlatformMonitor } from './batch-platform-monitor.service';
import { PCPMonitor } from './pcp-monitor.service';
import { LicitanetMonitor } from './licitanet-monitor.service';
import { LicitaMaisBrasilMonitor } from './licitamaisbrasil-monitor.service';
import { IngestService } from './ingest.service';
import { logger } from '../../lib/logger';

// ── Intervals ──
export const BATCH_POLL_INTERVAL_MS = 60_000;   // 60s
export const PCP_POLL_INTERVAL_MS = 90_000;      // 90s
export const LICITANET_POLL_INTERVAL_MS = 90_000; // 90s
export const LMB_POLL_INTERVAL_MS = 90_000;       // 90s

type OnCycleSuccess = (pollerName: string) => void;

// ──────────────────────────────────────────────────────────────────
// BLL + BNC (Batch Platforms)
// ──────────────────────────────────────────────────────────────────

export async function pollBatchProcesses(prisma: PrismaClient, onSuccess?: OnCycleSuccess) {
    try {
        const batchProcesses = await prisma.biddingProcess.findMany({
            where: {
                isMonitored: true,
                OR: [
                    { link: { contains: 'bllcompras' } },
                    { link: { contains: 'bnccompras' } },
                ],
            },
            select: { id: true, tenantId: true, title: true, link: true },
        });

        if (batchProcesses.length === 0) return;

        let totalNew = 0;
        let totalAlerts = 0;

        for (const proc of batchProcesses) {
            try {
                if (!proc.link) continue;
                const platform = BatchPlatformMonitor.detectPlatform(proc.link);
                if (!platform) continue;
                const param1 = BatchPlatformMonitor.extractParam1(proc.link);
                if (!param1) continue;

                const messages = await BatchPlatformMonitor.fetchAllMessages(param1, platform);
                if (messages.length === 0) continue;

                const result = await IngestService.ingestMessages(prisma, {
                    processId: proc.id,
                    tenantId: proc.tenantId,
                    messages: messages.map((m: any) => ({
                        messageId: m.messageId,
                        content: m.content,
                        authorType: m.authorType,
                        timestamp: m.timestamp || null,
                        itemRef: m.itemRef || null,
                        eventCategory: m.eventCategory || null,
                        captureSource: m.captureSource || platform.captureSource,
                    })),
                    captureSource: platform.captureSource,
                });

                if (result.created > 0) {
                    logger.info(`[${platform.label} Poll] 📨 ${result.created} nova(s) msg(s) para ${proc.title?.substring(0, 40)} (${result.alerts} alertas)`);
                    totalNew += result.created;
                    totalAlerts += result.alerts;
                }

                await new Promise(r => setTimeout(r, 1000));
            } catch (err: any) {
                logger.warn(`[Batch Poll] Erro no processo ${proc.id.substring(0, 8)}:`, err.message);
            }
        }

        if (totalNew > 0) {
            logger.info(`[Batch Poll] ✅ Ciclo: ${totalNew} mensagens novas, ${totalAlerts} alertas de ${batchProcesses.length} processos`);
        }
        onSuccess?.('BLL+BNC');
    } catch (error: any) {
        logger.error('[Batch Poll] Erro no ciclo:', error.message);
    }
}

// ──────────────────────────────────────────────────────────────────
// Portal de Compras Públicas (PCP)
// ──────────────────────────────────────────────────────────────────

export async function pollPCPProcesses(prisma: PrismaClient, onSuccess?: OnCycleSuccess) {
    try {
        const pcpProcesses = await prisma.biddingProcess.findMany({
            where: {
                isMonitored: true,
                link: { contains: 'portaldecompraspublicas' },
            },
            select: { id: true, tenantId: true, title: true, link: true },
        });

        if (pcpProcesses.length === 0) return;

        let totalNew = 0;
        let totalAlerts = 0;

        for (const proc of pcpProcesses) {
            try {
                if (!proc.link) continue;
                const pcpUrl = PCPMonitor.extractPCPUrl(proc.link);
                if (!pcpUrl) continue;

                const messages = await PCPMonitor.fetchMessages(pcpUrl);
                if (messages.length === 0) continue;

                const result = await IngestService.ingestMessages(prisma, {
                    processId: proc.id,
                    tenantId: proc.tenantId,
                    messages: messages.map((m: any) => ({
                        messageId: m.messageId,
                        content: m.content,
                        authorType: m.authorType,
                        timestamp: m.timestamp || null,
                        itemRef: m.itemRef || null,
                        eventCategory: m.eventCategory || null,
                        captureSource: m.captureSource || 'pcp-api',
                    })),
                    captureSource: 'pcp-api',
                });

                if (result.created > 0) {
                    logger.info(`[PCP Poll] 📨 ${result.created} nova(s) msg(s) para ${proc.title?.substring(0, 40)} (${result.alerts} alertas)`);
                    totalNew += result.created;
                    totalAlerts += result.alerts;
                }

                await new Promise(r => setTimeout(r, 2000));
            } catch (err: any) {
                logger.warn(`[PCP Poll] Erro no processo ${proc.id.substring(0, 8)}:`, err.message);
            }
        }

        if (totalNew > 0) {
            logger.info(`[PCP Poll] ✅ Ciclo: ${totalNew} mensagens novas, ${totalAlerts} alertas de ${pcpProcesses.length} processos`);
        }
        onSuccess?.('PCP');
    } catch (error: any) {
        logger.error('[PCP Poll] Erro no ciclo:', error.message);
    }
}

// ──────────────────────────────────────────────────────────────────
// Licitanet
// ──────────────────────────────────────────────────────────────────

export async function pollLicitanetProcesses(prisma: PrismaClient, onSuccess?: OnCycleSuccess) {
    try {
        const licitanetProcesses = await prisma.biddingProcess.findMany({
            where: {
                isMonitored: true,
                link: { contains: 'licitanet.com.br' },
            },
            select: { id: true, tenantId: true, title: true, link: true },
        });

        if (licitanetProcesses.length === 0) return;

        let totalNew = 0;
        let totalAlerts = 0;

        for (const proc of licitanetProcesses) {
            try {
                if (!proc.link) continue;
                const licitanetUrl = LicitanetMonitor.extractLicitanetUrl(proc.link);
                if (!licitanetUrl) continue;

                const messages = await LicitanetMonitor.fetchMessages(licitanetUrl);
                if (messages.length === 0) continue;

                const result = await IngestService.ingestMessages(prisma, {
                    processId: proc.id,
                    tenantId: proc.tenantId,
                    messages: messages.map((m: any) => ({
                        messageId: m.messageId,
                        content: m.content,
                        authorType: m.authorType,
                        timestamp: m.timestamp || null,
                        itemRef: m.itemRef || null,
                        eventCategory: m.eventCategory || null,
                        captureSource: m.captureSource || 'licitanet-api',
                    })),
                    captureSource: 'licitanet-api',
                });

                if (result.created > 0) {
                    logger.info(`[Licitanet Poll] 📨 ${result.created} nova(s) msg(s) para ${proc.title?.substring(0, 40)} (${result.alerts} alertas)`);
                    totalNew += result.created;
                    totalAlerts += result.alerts;
                }

                await new Promise(r => setTimeout(r, 1000));
            } catch (err: any) {
                logger.warn(`[Licitanet Poll] Erro no processo ${proc.id.substring(0, 8)}:`, err.message);
            }
        }

        if (totalNew > 0) {
            logger.info(`[Licitanet Poll] ✅ Ciclo: ${totalNew} mensagens novas, ${totalAlerts} alertas de ${licitanetProcesses.length} processos`);
        }
        onSuccess?.('Licitanet');
    } catch (error: any) {
        logger.error('[Licitanet Poll] Erro no ciclo:', error.message);
    }
}

// ──────────────────────────────────────────────────────────────────
// Licita Mais Brasil (LMB)
// ──────────────────────────────────────────────────────────────────

export async function pollLMBProcesses(prisma: PrismaClient, onSuccess?: OnCycleSuccess) {
    try {
        const lmbProcesses = await prisma.biddingProcess.findMany({
            where: {
                isMonitored: true,
                link: { contains: 'licitamaisbrasil.com.br' },
            },
            select: { id: true, tenantId: true, title: true, link: true },
        });

        if (lmbProcesses.length === 0) return;

        let totalNew = 0;
        let totalAlerts = 0;

        for (const proc of lmbProcesses) {
            try {
                if (!proc.link) continue;
                const lmbUrl = LicitaMaisBrasilMonitor.extractLMBUrl(proc.link);
                if (!lmbUrl) continue;

                const messages = await LicitaMaisBrasilMonitor.fetchMessages(lmbUrl);
                if (messages.length === 0) continue;

                const result = await IngestService.ingestMessages(prisma, {
                    processId: proc.id,
                    tenantId: proc.tenantId,
                    messages: messages.map((m: any) => ({
                        messageId: m.messageId,
                        content: m.content,
                        authorType: m.authorType,
                        timestamp: m.timestamp || null,
                        itemRef: m.itemRef || null,
                        eventCategory: m.eventCategory || null,
                        captureSource: m.captureSource || 'licitamaisbrasil-api',
                    })),
                    captureSource: 'licitamaisbrasil-api',
                });

                if (result.created > 0) {
                    logger.info(`[LMB Poll] 📨 ${result.created} nova(s) msg(s) para ${proc.title?.substring(0, 40)} (${result.alerts} alertas)`);
                    totalNew += result.created;
                    totalAlerts += result.alerts;
                }

                await new Promise(r => setTimeout(r, 1500));
            } catch (err: any) {
                logger.warn(`[LMB Poll] Erro no processo ${proc.id.substring(0, 8)}:`, err.message);
            }
        }

        if (totalNew > 0) {
            logger.info(`[LMB Poll] ✅ Ciclo: ${totalNew} mensagens novas, ${totalAlerts} alertas de ${lmbProcesses.length} processos`);
        }
        onSuccess?.('LMB');
    } catch (error: any) {
        logger.error('[LMB Poll] Erro no ciclo:', error.message);
    }
}

// ──────────────────────────────────────────────────────────────────
// ComprasNet Backfill (one-time task)
// ──────────────────────────────────────────────────────────────────

export async function runComprasNetBackfill(prisma: PrismaClient) {
    try {
        const processes = await prisma.biddingProcess.findMany({
            where: {
                link: { contains: 'pncp.gov.br/app/editais' },
                NOT: { link: { contains: 'cnetmobile' } }
            },
            select: { id: true, link: true, isMonitored: true }
        });

        if (processes.length === 0) {
            logger.info('[Backfill] All processes already have ComprasNet links or no PNCP links found.');
            return;
        }

        logger.info(`[Backfill] Found ${processes.length} processes with PNCP links missing ComprasNet. Fetching...`);
        let updated = 0;

        for (const proc of processes) {
            try {
                const match = (proc.link || '').match(/editais\/(\d+)\/(\d+)\/(\d+)/);
                if (!match) continue;

                const [, cnpj, ano, seq] = match;
                const apiUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
                const res = await fetch(apiUrl);
                if (!res.ok) continue;

                const data = await res.json();
                const comprasNetLink = data.linkSistemaOrigem;

                if (comprasNetLink && (comprasNetLink.includes('cnetmobile') || comprasNetLink.includes('comprasnet'))) {
                    const newLink = `${proc.link}, ${comprasNetLink}`;
                    await prisma.biddingProcess.update({
                        where: { id: proc.id },
                        data: {
                            link: newLink,
                            isMonitored: true
                        }
                    });
                    updated++;
                    logger.info(`[Backfill] ✅ Updated process ${proc.id.slice(0, 8)} with ComprasNet link`);
                }

                await new Promise(r => setTimeout(r, 500));
            } catch (e) {
                // Skip individual failures silently
            }
        }

        logger.info(`[Backfill] Done. Updated ${updated}/${processes.length} processes with ComprasNet links.`);
    } catch (e) {
        logger.error('[Backfill] Error:', e);
    }
}

// ──────────────────────────────────────────────────────────────────
// Orchestrator: Starts all pollers with staggered delays
// ──────────────────────────────────────────────────────────────────

export interface PollerConfig {
    prisma: PrismaClient;
    onCycleSuccess?: OnCycleSuccess;
    /** Stagger delays in ms: [batch, pcp, licitanet, lmb] */
    delays?: [number, number, number, number];
}

export function startAllPollers(config: PollerConfig) {
    const { prisma, onCycleSuccess } = config;
    const delays = config.delays || [10_000, 25_000, 40_000, 55_000];

    // Run one-time backfill
    runComprasNetBackfill(prisma);

    // Start pollers with staggered delays to avoid thundering herd
    setTimeout(() => {
        logger.info(`[Batch Poll] 🚀 Monitor BLL+BNC iniciado (intervalo: ${BATCH_POLL_INTERVAL_MS / 1000}s)`);
        pollBatchProcesses(prisma, onCycleSuccess);
        setInterval(() => pollBatchProcesses(prisma, onCycleSuccess), BATCH_POLL_INTERVAL_MS);
    }, delays[0]);

    setTimeout(() => {
        logger.info(`[PCP Poll] 🚀 Monitor Portal de Compras Públicas iniciado (intervalo: ${PCP_POLL_INTERVAL_MS / 1000}s)`);
        pollPCPProcesses(prisma, onCycleSuccess);
        setInterval(() => pollPCPProcesses(prisma, onCycleSuccess), PCP_POLL_INTERVAL_MS);
    }, delays[1]);

    setTimeout(() => {
        logger.info(`[Licitanet Poll] 🚀 Monitor Licitanet iniciado (intervalo: ${LICITANET_POLL_INTERVAL_MS / 1000}s)`);
        pollLicitanetProcesses(prisma, onCycleSuccess);
        setInterval(() => pollLicitanetProcesses(prisma, onCycleSuccess), LICITANET_POLL_INTERVAL_MS);
    }, delays[2]);

    setTimeout(() => {
        logger.info(`[LMB Poll] 🚀 Monitor Licita Mais Brasil iniciado (intervalo: ${LMB_POLL_INTERVAL_MS / 1000}s)`);
        pollLMBProcesses(prisma, onCycleSuccess);
        setInterval(() => pollLMBProcesses(prisma, onCycleSuccess), LMB_POLL_INTERVAL_MS);
    }, delays[3]);
}
