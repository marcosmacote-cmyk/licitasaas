/**
 * ══════════════════════════════════════════════════════════════════
 *  LicitaSaaS — Background Worker Process
 * ══════════════════════════════════════════════════════════════════
 * 
 * Standalone entry point that runs all background monitoring jobs
 * independently from the API server. This ensures:
 * 
 *   1. A stuck/crashed poller doesn't bring down the API
 *   2. Workers can be scaled independently
 *   3. Deploys to the API don't restart monitoring cycles
 *   4. Memory pressure from monitoring doesn't affect API latency
 * 
 * Usage:
 *   PROCESS_ROLE=worker node dist/worker.js
 * 
 * All workers share the same DATABASE_URL as the API.
 */

import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { BatchPlatformMonitor } from './services/monitoring/batch-platform-monitor.service';
import { PCPMonitor } from './services/monitoring/pcp-monitor.service';
import { LicitanetMonitor } from './services/monitoring/licitanet-monitor.service';
import { LicitaMaisBrasilMonitor } from './services/monitoring/licitamaisbrasil-monitor.service';
import { IngestService } from './services/monitoring/ingest.service';
import { startOpportunityScanner } from './services/monitoring/opportunity-scanner.service';
import { runPncpSync, getPncpAggregatorStats } from './workers/pncpAggregator';
import { decryptCredential, isEncrypted, isEncryptionConfigured } from './lib/crypto';
import { logger } from './lib/logger';

// ── Environment ──
const SERVER_ROOT = __dirname.endsWith('dist') ? path.resolve(__dirname, '..') : __dirname;
dotenv.config({ path: path.join(SERVER_ROOT, '.env'), override: false });

const prisma = new PrismaClient();

// ── Health Check (simple HTTP for Docker/Railway) ──
import http from 'http';
const HEALTH_PORT = parseInt(process.env.WORKER_HEALTH_PORT || '3002', 10);
let isHealthy = true;
let lastCycleAt: Date | null = null;

const healthServer = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        const staleThresholdMs = 10 * 60 * 1000; // 10 minutes
        const isStale = lastCycleAt && (Date.now() - lastCycleAt.getTime()) > staleThresholdMs;
        
        if (isHealthy && !isStale) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'healthy',
                role: 'worker',
                lastCycleAt: lastCycleAt?.toISOString() || null,
                uptime: process.uptime(),
            }));
        } else {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'unhealthy',
                reason: isStale ? 'stale_cycle' : 'error',
                lastCycleAt: lastCycleAt?.toISOString() || null,
            }));
        }
    } else {
        res.writeHead(404);
        res.end();
    }
});

// ══════════════════════════════════════════════════════════════════
// ── One-time Tasks ──
// ══════════════════════════════════════════════════════════════════

async function runComprasNetBackfill() {
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

// ══════════════════════════════════════════════════════════════════
// ── Pollers (extracted from server/index.ts app.listen) ──
// ══════════════════════════════════════════════════════════════════

// ── Batch Platforms (BLL + BNC) ──
const BATCH_POLL_INTERVAL_MS = 60_000;

async function pollBatchProcesses() {
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

                // CORRIGIDO: fetchAllMessages captura processo + TODOS os lotes
                const messages = await BatchPlatformMonitor.fetchAllMessages(param1, platform);
                if (messages.length === 0) continue;

                const result = await IngestService.ingestMessages(prisma, {
                    processId: proc.id,
                    tenantId: proc.tenantId,
                    // CORRIGIDO: propagar itemRef, eventCategory e captureSource individuais
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
        lastCycleAt = new Date();
    } catch (error: any) {
        logger.error('[Batch Poll] Erro no ciclo:', error.message);
    }
}

// ── Portal de Compras Públicas (PCP) ──
const PCP_POLL_INTERVAL_MS = 90_000;

async function pollPCPProcesses() {
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
        lastCycleAt = new Date();
    } catch (error: any) {
        logger.error('[PCP Poll] Erro no ciclo:', error.message);
    }
}

// ── Licitanet ──
const LICITANET_POLL_INTERVAL_MS = 90_000;

async function pollLicitanetProcesses() {
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
        lastCycleAt = new Date();
    } catch (error: any) {
        logger.error('[Licitanet Poll] Erro no ciclo:', error.message);
    }
}

// ── Licita Mais Brasil ──
const LMB_POLL_INTERVAL_MS = 90_000;

async function pollLMBProcesses() {
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
        lastCycleAt = new Date();
    } catch (error: any) {
        logger.error('[LMB Poll] Erro no ciclo:', error.message);
    }
}

// ══════════════════════════════════════════════════════════════════
// ── Daily Backup Scheduler ──
// ══════════════════════════════════════════════════════════════════

const BACKUP_HOUR_UTC = 6; // 6 AM UTC = 3 AM BRT
let lastBackupDate: string | null = null;

function scheduleBackup() {
    logger.info(`[Backup] 🗄️ Daily backup scheduled (runs at ${BACKUP_HOUR_UTC}:00 UTC / ${BACKUP_HOUR_UTC - 3}:00 BRT)`);

    // Check every 30 minutes if it's time to backup
    setInterval(async () => {
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

        // Only run once per day, at the target hour
        if (now.getUTCHours() === BACKUP_HOUR_UTC && lastBackupDate !== todayStr) {
            lastBackupDate = todayStr;
            logger.info(`[Backup] ⏰ Starting scheduled daily backup for ${todayStr}...`);
            try {
                const { runBackup } = await import('./scripts/backup-database');
                const result = await runBackup();
                if (result.success) {
                    logger.info(`[Backup] ✅ Daily backup completed: ${result.fileName} (${result.sizeKB}KB)`);
                } else {
                    logger.error(`[Backup] ❌ Daily backup failed: ${result.error}`);
                }
            } catch (err: any) {
                logger.error(`[Backup] ❌ Backup exception: ${err.message}`);
            }
        }
    }, 30 * 60 * 1000); // Check every 30 min
}

// ══════════════════════════════════════════════════════════════════
// ── Main: Start all workers ──
// ══════════════════════════════════════════════════════════════════

async function main() {
    logger.info('══════════════════════════════════════════════════════');
    logger.info('  🔧 LicitaSaaS Worker Process');
    logger.info('══════════════════════════════════════════════════════');
    logger.info(`  PID:  ${process.pid}`);
    logger.info(`  Node: ${process.version}`);
    logger.info(`  ENV:  ${process.env.NODE_ENV || 'development'}`);
    logger.info('══════════════════════════════════════════════════════');

    // Verify DB connection
    try {
        await prisma.$connect();
        logger.info('[Worker] ✅ Database connection established');
    } catch (err: any) {
        logger.error('[Worker] ❌ Failed to connect to database:', err.message);
        process.exit(1);
    }

    // Start health check server
    healthServer.listen(HEALTH_PORT, () => {
        logger.info(`[Worker] 🏥 Health check listening on port ${HEALTH_PORT}`);
    });

    // Run one-time backfill
    runComprasNetBackfill();

    // Start pollers with staggered delays to avoid thundering herd
    setTimeout(() => {
        logger.info(`[Batch Poll] 🚀 Monitor BLL+BNC iniciado (intervalo: ${BATCH_POLL_INTERVAL_MS / 1000}s)`);
        pollBatchProcesses();
        setInterval(pollBatchProcesses, BATCH_POLL_INTERVAL_MS);
    }, 10_000); // 10s after boot

    setTimeout(() => {
        logger.info(`[PCP Poll] 🚀 Monitor Portal de Compras Públicas iniciado (intervalo: ${PCP_POLL_INTERVAL_MS / 1000}s)`);
        pollPCPProcesses();
        setInterval(pollPCPProcesses, PCP_POLL_INTERVAL_MS);
    }, 25_000); // 25s after boot

    setTimeout(() => {
        logger.info(`[Licitanet Poll] 🚀 Monitor Licitanet iniciado (intervalo: ${LICITANET_POLL_INTERVAL_MS / 1000}s)`);
        pollLicitanetProcesses();
        setInterval(pollLicitanetProcesses, LICITANET_POLL_INTERVAL_MS);
    }, 40_000); // 40s after boot

    setTimeout(() => {
        logger.info(`[LMB Poll] 🚀 Monitor Licita Mais Brasil iniciado (intervalo: ${LMB_POLL_INTERVAL_MS / 1000}s)`);
        pollLMBProcesses();
        setInterval(pollLMBProcesses, LMB_POLL_INTERVAL_MS);
    }, 55_000); // 55s after boot

    // ── PNCP Aggregator: sincroniza base local a cada 15 minutos ──
    setTimeout(async () => {
        logger.info('[PNCP-AGG] 🚀 Aggregator iniciado (intervalo: 15min)');
        try {
            await runPncpSync();
            const stats = await getPncpAggregatorStats();
            logger.info(`[PNCP-AGG] ✅ Base local: ${stats.totalContratacoes} contratações, ${stats.totalAbertos} abertas`);
        } catch (e: any) {
            logger.error('[PNCP-AGG] ❌ Primeira sync falhou:', e.message);
        }
        setInterval(async () => {
            try { await runPncpSync(); }
            catch (e: any) { logger.error('[PNCP-AGG] sync error:', e.message); }
        }, 15 * 60_000); // 15 minutos
    }, 90_000); // 90s após boot (depois de todos os pollers)

    // Start Opportunity Scanner (PNCP search auto-scan)
    startOpportunityScanner(4);

    // ── Daily Automated Backup (3:00 AM UTC) ──
    scheduleBackup();

    logger.info('[Worker] 🚀 All monitors scheduled. Worker is running.');
}

// ── Graceful Shutdown ──
async function shutdown(signal: string) {
    logger.info(`[Worker] Received ${signal}. Shutting down gracefully...`);
    isHealthy = false;
    healthServer.close();
    await prisma.$disconnect();
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Unhandled errors: log but keep running ──
process.on('uncaughtException', (err) => {
    logger.error('[Worker] ⚠️ Uncaught exception (keeping alive):', err.message);
});
process.on('unhandledRejection', (reason) => {
    logger.error('[Worker] ⚠️ Unhandled rejection (keeping alive):', reason);
});

// Go!
main();
