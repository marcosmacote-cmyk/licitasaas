"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const batch_platform_monitor_service_1 = require("./services/monitoring/batch-platform-monitor.service");
const pcp_monitor_service_1 = require("./services/monitoring/pcp-monitor.service");
const licitanet_monitor_service_1 = require("./services/monitoring/licitanet-monitor.service");
const licitamaisbrasil_monitor_service_1 = require("./services/monitoring/licitamaisbrasil-monitor.service");
const ingest_service_1 = require("./services/monitoring/ingest.service");
const opportunity_scanner_service_1 = require("./services/monitoring/opportunity-scanner.service");
const pncpAggregator_1 = require("./workers/pncpAggregator");
const logger_1 = require("./lib/logger");
// ── Environment ──
const SERVER_ROOT = __dirname.endsWith('dist') ? path_1.default.resolve(__dirname, '..') : __dirname;
dotenv_1.default.config({ path: path_1.default.join(SERVER_ROOT, '.env'), override: false });
const prisma = new client_1.PrismaClient();
// ── Health Check (simple HTTP for Docker/Railway) ──
const http_1 = __importDefault(require("http"));
const HEALTH_PORT = parseInt(process.env.WORKER_HEALTH_PORT || '3002', 10);
let isHealthy = true;
let lastCycleAt = null;
const healthServer = http_1.default.createServer((req, res) => {
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
        }
        else {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'unhealthy',
                reason: isStale ? 'stale_cycle' : 'error',
                lastCycleAt: lastCycleAt?.toISOString() || null,
            }));
        }
    }
    else {
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
            logger_1.logger.info('[Backfill] All processes already have ComprasNet links or no PNCP links found.');
            return;
        }
        logger_1.logger.info(`[Backfill] Found ${processes.length} processes with PNCP links missing ComprasNet. Fetching...`);
        let updated = 0;
        for (const proc of processes) {
            try {
                const match = (proc.link || '').match(/editais\/(\d+)\/(\d+)\/(\d+)/);
                if (!match)
                    continue;
                const [, cnpj, ano, seq] = match;
                const apiUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
                const res = await fetch(apiUrl);
                if (!res.ok)
                    continue;
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
                    logger_1.logger.info(`[Backfill] ✅ Updated process ${proc.id.slice(0, 8)} with ComprasNet link`);
                }
                await new Promise(r => setTimeout(r, 500));
            }
            catch (e) {
                // Skip individual failures silently
            }
        }
        logger_1.logger.info(`[Backfill] Done. Updated ${updated}/${processes.length} processes with ComprasNet links.`);
    }
    catch (e) {
        logger_1.logger.error('[Backfill] Error:', e);
    }
}
// ══════════════════════════════════════════════════════════════════
// ── Pollers (extracted from server/index.ts app.listen) ──
// ══════════════════════════════════════════════════════════════════
// ── Batch Platforms (BLL + BNC) ──
const BATCH_POLL_INTERVAL_MS = 60000;
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
        if (batchProcesses.length === 0)
            return;
        let totalNew = 0;
        let totalAlerts = 0;
        for (const proc of batchProcesses) {
            try {
                if (!proc.link)
                    continue;
                const platform = batch_platform_monitor_service_1.BatchPlatformMonitor.detectPlatform(proc.link);
                if (!platform)
                    continue;
                const param1 = batch_platform_monitor_service_1.BatchPlatformMonitor.extractParam1(proc.link);
                if (!param1)
                    continue;
                // CORRIGIDO: fetchAllMessages captura processo + TODOS os lotes
                const messages = await batch_platform_monitor_service_1.BatchPlatformMonitor.fetchAllMessages(param1, platform);
                if (messages.length === 0)
                    continue;
                const result = await ingest_service_1.IngestService.ingestMessages(prisma, {
                    processId: proc.id,
                    tenantId: proc.tenantId,
                    // CORRIGIDO: propagar itemRef, eventCategory e captureSource individuais
                    messages: messages.map((m) => ({
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
                    logger_1.logger.info(`[${platform.label} Poll] 📨 ${result.created} nova(s) msg(s) para ${proc.title?.substring(0, 40)} (${result.alerts} alertas)`);
                    totalNew += result.created;
                    totalAlerts += result.alerts;
                }
                await new Promise(r => setTimeout(r, 1000));
            }
            catch (err) {
                logger_1.logger.warn(`[Batch Poll] Erro no processo ${proc.id.substring(0, 8)}:`, err.message);
            }
        }
        if (totalNew > 0) {
            logger_1.logger.info(`[Batch Poll] ✅ Ciclo: ${totalNew} mensagens novas, ${totalAlerts} alertas de ${batchProcesses.length} processos`);
        }
        lastCycleAt = new Date();
    }
    catch (error) {
        logger_1.logger.error('[Batch Poll] Erro no ciclo:', error.message);
    }
}
// ── Portal de Compras Públicas (PCP) ──
const PCP_POLL_INTERVAL_MS = 90000;
async function pollPCPProcesses() {
    try {
        const pcpProcesses = await prisma.biddingProcess.findMany({
            where: {
                isMonitored: true,
                link: { contains: 'portaldecompraspublicas' },
            },
            select: { id: true, tenantId: true, title: true, link: true },
        });
        if (pcpProcesses.length === 0)
            return;
        let totalNew = 0;
        let totalAlerts = 0;
        for (const proc of pcpProcesses) {
            try {
                if (!proc.link)
                    continue;
                const pcpUrl = pcp_monitor_service_1.PCPMonitor.extractPCPUrl(proc.link);
                if (!pcpUrl)
                    continue;
                const messages = await pcp_monitor_service_1.PCPMonitor.fetchMessages(pcpUrl);
                if (messages.length === 0)
                    continue;
                const result = await ingest_service_1.IngestService.ingestMessages(prisma, {
                    processId: proc.id,
                    tenantId: proc.tenantId,
                    messages: messages.map((m) => ({
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
                    logger_1.logger.info(`[PCP Poll] 📨 ${result.created} nova(s) msg(s) para ${proc.title?.substring(0, 40)} (${result.alerts} alertas)`);
                    totalNew += result.created;
                    totalAlerts += result.alerts;
                }
                await new Promise(r => setTimeout(r, 2000));
            }
            catch (err) {
                logger_1.logger.warn(`[PCP Poll] Erro no processo ${proc.id.substring(0, 8)}:`, err.message);
            }
        }
        if (totalNew > 0) {
            logger_1.logger.info(`[PCP Poll] ✅ Ciclo: ${totalNew} mensagens novas, ${totalAlerts} alertas de ${pcpProcesses.length} processos`);
        }
        lastCycleAt = new Date();
    }
    catch (error) {
        logger_1.logger.error('[PCP Poll] Erro no ciclo:', error.message);
    }
}
// ── Licitanet ──
const LICITANET_POLL_INTERVAL_MS = 90000;
async function pollLicitanetProcesses() {
    try {
        const licitanetProcesses = await prisma.biddingProcess.findMany({
            where: {
                isMonitored: true,
                link: { contains: 'licitanet.com.br' },
            },
            select: { id: true, tenantId: true, title: true, link: true },
        });
        if (licitanetProcesses.length === 0)
            return;
        let totalNew = 0;
        let totalAlerts = 0;
        for (const proc of licitanetProcesses) {
            try {
                if (!proc.link)
                    continue;
                const licitanetUrl = licitanet_monitor_service_1.LicitanetMonitor.extractLicitanetUrl(proc.link);
                if (!licitanetUrl)
                    continue;
                const messages = await licitanet_monitor_service_1.LicitanetMonitor.fetchMessages(licitanetUrl);
                if (messages.length === 0)
                    continue;
                const result = await ingest_service_1.IngestService.ingestMessages(prisma, {
                    processId: proc.id,
                    tenantId: proc.tenantId,
                    messages: messages.map((m) => ({
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
                    logger_1.logger.info(`[Licitanet Poll] 📨 ${result.created} nova(s) msg(s) para ${proc.title?.substring(0, 40)} (${result.alerts} alertas)`);
                    totalNew += result.created;
                    totalAlerts += result.alerts;
                }
                await new Promise(r => setTimeout(r, 1000));
            }
            catch (err) {
                logger_1.logger.warn(`[Licitanet Poll] Erro no processo ${proc.id.substring(0, 8)}:`, err.message);
            }
        }
        if (totalNew > 0) {
            logger_1.logger.info(`[Licitanet Poll] ✅ Ciclo: ${totalNew} mensagens novas, ${totalAlerts} alertas de ${licitanetProcesses.length} processos`);
        }
        lastCycleAt = new Date();
    }
    catch (error) {
        logger_1.logger.error('[Licitanet Poll] Erro no ciclo:', error.message);
    }
}
// ── Licita Mais Brasil ──
const LMB_POLL_INTERVAL_MS = 90000;
async function pollLMBProcesses() {
    try {
        const lmbProcesses = await prisma.biddingProcess.findMany({
            where: {
                isMonitored: true,
                link: { contains: 'licitamaisbrasil.com.br' },
            },
            select: { id: true, tenantId: true, title: true, link: true },
        });
        if (lmbProcesses.length === 0)
            return;
        let totalNew = 0;
        let totalAlerts = 0;
        for (const proc of lmbProcesses) {
            try {
                if (!proc.link)
                    continue;
                const lmbUrl = licitamaisbrasil_monitor_service_1.LicitaMaisBrasilMonitor.extractLMBUrl(proc.link);
                if (!lmbUrl)
                    continue;
                const messages = await licitamaisbrasil_monitor_service_1.LicitaMaisBrasilMonitor.fetchMessages(lmbUrl);
                if (messages.length === 0)
                    continue;
                const result = await ingest_service_1.IngestService.ingestMessages(prisma, {
                    processId: proc.id,
                    tenantId: proc.tenantId,
                    messages: messages.map((m) => ({
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
                    logger_1.logger.info(`[LMB Poll] 📨 ${result.created} nova(s) msg(s) para ${proc.title?.substring(0, 40)} (${result.alerts} alertas)`);
                    totalNew += result.created;
                    totalAlerts += result.alerts;
                }
                await new Promise(r => setTimeout(r, 1500));
            }
            catch (err) {
                logger_1.logger.warn(`[LMB Poll] Erro no processo ${proc.id.substring(0, 8)}:`, err.message);
            }
        }
        if (totalNew > 0) {
            logger_1.logger.info(`[LMB Poll] ✅ Ciclo: ${totalNew} mensagens novas, ${totalAlerts} alertas de ${lmbProcesses.length} processos`);
        }
        lastCycleAt = new Date();
    }
    catch (error) {
        logger_1.logger.error('[LMB Poll] Erro no ciclo:', error.message);
    }
}
// ══════════════════════════════════════════════════════════════════
// ── Daily Backup Scheduler ──
// ══════════════════════════════════════════════════════════════════
const BACKUP_HOUR_UTC = 6; // 6 AM UTC = 3 AM BRT
let lastBackupDate = null;
function scheduleBackup() {
    logger_1.logger.info(`[Backup] 🗄️ Daily backup scheduled (runs at ${BACKUP_HOUR_UTC}:00 UTC / ${BACKUP_HOUR_UTC - 3}:00 BRT)`);
    // Check every 30 minutes if it's time to backup
    setInterval(async () => {
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
        // Only run once per day, at the target hour
        if (now.getUTCHours() === BACKUP_HOUR_UTC && lastBackupDate !== todayStr) {
            lastBackupDate = todayStr;
            logger_1.logger.info(`[Backup] ⏰ Starting scheduled daily backup for ${todayStr}...`);
            try {
                const { runBackup } = await Promise.resolve().then(() => __importStar(require('./scripts/backup-database')));
                const result = await runBackup();
                if (result.success) {
                    logger_1.logger.info(`[Backup] ✅ Daily backup completed: ${result.fileName} (${result.sizeKB}KB)`);
                }
                else {
                    logger_1.logger.error(`[Backup] ❌ Daily backup failed: ${result.error}`);
                }
            }
            catch (err) {
                logger_1.logger.error(`[Backup] ❌ Backup exception: ${err.message}`);
            }
        }
    }, 30 * 60 * 1000); // Check every 30 min
}
// ══════════════════════════════════════════════════════════════════
// ── Main: Start all workers ──
// ══════════════════════════════════════════════════════════════════
async function main() {
    logger_1.logger.info('══════════════════════════════════════════════════════');
    logger_1.logger.info('  🔧 LicitaSaaS Worker Process');
    logger_1.logger.info('══════════════════════════════════════════════════════');
    logger_1.logger.info(`  PID:  ${process.pid}`);
    logger_1.logger.info(`  Node: ${process.version}`);
    logger_1.logger.info(`  ENV:  ${process.env.NODE_ENV || 'development'}`);
    logger_1.logger.info('══════════════════════════════════════════════════════');
    // Verify DB connection
    try {
        await prisma.$connect();
        logger_1.logger.info('[Worker] ✅ Database connection established');
    }
    catch (err) {
        logger_1.logger.error('[Worker] ❌ Failed to connect to database:', err.message);
        process.exit(1);
    }
    // Start health check server
    healthServer.listen(HEALTH_PORT, () => {
        logger_1.logger.info(`[Worker] 🏥 Health check listening on port ${HEALTH_PORT}`);
    });
    // Run one-time backfill
    runComprasNetBackfill();
    // Start pollers with staggered delays to avoid thundering herd
    setTimeout(() => {
        logger_1.logger.info(`[Batch Poll] 🚀 Monitor BLL+BNC iniciado (intervalo: ${BATCH_POLL_INTERVAL_MS / 1000}s)`);
        pollBatchProcesses();
        setInterval(pollBatchProcesses, BATCH_POLL_INTERVAL_MS);
    }, 10000); // 10s after boot
    setTimeout(() => {
        logger_1.logger.info(`[PCP Poll] 🚀 Monitor Portal de Compras Públicas iniciado (intervalo: ${PCP_POLL_INTERVAL_MS / 1000}s)`);
        pollPCPProcesses();
        setInterval(pollPCPProcesses, PCP_POLL_INTERVAL_MS);
    }, 25000); // 25s after boot
    setTimeout(() => {
        logger_1.logger.info(`[Licitanet Poll] 🚀 Monitor Licitanet iniciado (intervalo: ${LICITANET_POLL_INTERVAL_MS / 1000}s)`);
        pollLicitanetProcesses();
        setInterval(pollLicitanetProcesses, LICITANET_POLL_INTERVAL_MS);
    }, 40000); // 40s after boot
    setTimeout(() => {
        logger_1.logger.info(`[LMB Poll] 🚀 Monitor Licita Mais Brasil iniciado (intervalo: ${LMB_POLL_INTERVAL_MS / 1000}s)`);
        pollLMBProcesses();
        setInterval(pollLMBProcesses, LMB_POLL_INTERVAL_MS);
    }, 55000); // 55s after boot
    // ── PNCP Aggregator: sincroniza base local a cada 15 minutos ──
    setTimeout(async () => {
        logger_1.logger.info('[PNCP-AGG] 🚀 Aggregator iniciado (intervalo: 15min)');
        try {
            await (0, pncpAggregator_1.runPncpSync)();
            const stats = await (0, pncpAggregator_1.getPncpAggregatorStats)();
            logger_1.logger.info(`[PNCP-AGG] ✅ Base local: ${stats.totalContratacoes} contratações, ${stats.totalAbertos} abertas`);
        }
        catch (e) {
            logger_1.logger.error('[PNCP-AGG] ❌ Primeira sync falhou:', e.message);
        }
        setInterval(async () => {
            try {
                await (0, pncpAggregator_1.runPncpSync)();
            }
            catch (e) {
                logger_1.logger.error('[PNCP-AGG] sync error:', e.message);
            }
        }, 15 * 60000); // 15 minutos
    }, 90000); // 90s após boot (depois de todos os pollers)
    // Start Opportunity Scanner (PNCP search auto-scan)
    (0, opportunity_scanner_service_1.startOpportunityScanner)(4);
    // ── Daily Automated Backup (3:00 AM UTC) ──
    scheduleBackup();
    logger_1.logger.info('[Worker] 🚀 All monitors scheduled. Worker is running.');
}
// ── Graceful Shutdown ──
async function shutdown(signal) {
    logger_1.logger.info(`[Worker] Received ${signal}. Shutting down gracefully...`);
    isHealthy = false;
    healthServer.close();
    await prisma.$disconnect();
    process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// ── Unhandled errors: log but keep running ──
process.on('uncaughtException', (err) => {
    logger_1.logger.error('[Worker] ⚠️ Uncaught exception (keeping alive):', err.message);
});
process.on('unhandledRejection', (reason) => {
    logger_1.logger.error('[Worker] ⚠️ Unhandled rejection (keeping alive):', reason);
});
// Go!
main();
