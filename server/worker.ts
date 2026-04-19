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
import { startAllPollers } from './services/monitoring/pollers';
import { startOpportunityScanner } from './services/monitoring/opportunity-scanner.service';
import { runPncpSync, getPncpAggregatorStats } from './workers/pncpAggregator';
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

// ── Per-poller health tracking (Watchdog) ──
const pollerLastSuccess = new Map<string, Date>();

const healthServer = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        const staleThresholdMs = 10 * 60 * 1000; // 10 minutes
        const isStale = lastCycleAt && (Date.now() - lastCycleAt.getTime()) > staleThresholdMs;
        
        // Check individual poller health
        const pollerHealth: Record<string, string> = {};
        for (const [name, lastAt] of pollerLastSuccess) {
            const ageMs = Date.now() - lastAt.getTime();
            const isPollerStale = ageMs > 5 * 60 * 1000; // 5 minutes stale threshold
            pollerHealth[name] = isPollerStale ? `stale (${Math.round(ageMs / 1000)}s ago)` : 'ok';
        }

        if (isHealthy && !isStale) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'healthy',
                role: 'worker',
                lastCycleAt: lastCycleAt?.toISOString() || null,
                uptime: process.uptime(),
                pollers: pollerHealth,
            }));
        } else {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'unhealthy',
                reason: isStale ? 'stale_cycle' : 'error',
                lastCycleAt: lastCycleAt?.toISOString() || null,
                pollers: pollerHealth,
            }));
        }
    } else {
        res.writeHead(404);
        res.end();
    }
});

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
// ── Watchdog: Monitor poller health ──
// ══════════════════════════════════════════════════════════════════

function startWatchdog() {
    const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    const STALE_THRESHOLD_MS = 10 * 60 * 1000;  // 10 minutes

    setTimeout(() => {
        logger.info('[Watchdog] 🐕 Worker watchdog started (interval: 5 min)');
        
        setInterval(() => {
            const now = Date.now();
            const stalePollers: string[] = [];

            for (const [name, lastAt] of pollerLastSuccess) {
                const ageMs = now - lastAt.getTime();
                if (ageMs > STALE_THRESHOLD_MS) {
                    stalePollers.push(`${name} (${Math.round(ageMs / 60000)}min ago)`);
                }
            }

            if (stalePollers.length > 0) {
                logger.warn(`[Watchdog] ⚠️ Stale pollers detected: ${stalePollers.join(', ')}`);
            }

            // Log memory usage periodically
            const mem = process.memoryUsage();
            const heapMB = Math.round(mem.heapUsed / 1048576);
            const rssMB = Math.round(mem.rss / 1048576);
            if (heapMB > 300) {
                logger.warn(`[Watchdog] ⚠️ High memory: heap=${heapMB}MB, rss=${rssMB}MB`);
            }
        }, WATCHDOG_INTERVAL_MS);
    }, 3 * 60 * 1000); // Start 3 min after boot
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

    // Start all chat monitoring pollers (shared module)
    startAllPollers({
        prisma,
        onCycleSuccess: (pollerName) => {
            lastCycleAt = new Date();
            pollerLastSuccess.set(pollerName, new Date());
        },
        delays: [10_000, 25_000, 40_000, 55_000],
    });

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

    // ── Watchdog: Monitor poller health ──
    startWatchdog();

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
