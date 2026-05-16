/**
 * BackgroundJobWorker — Polls for QUEUED jobs and executes them.
 * 
 * Runs as a setInterval loop inside the main Express process.
 * Processes ONE job at a time to avoid Gemini API rate limits.
 * 
 * Each job type maps to a handler function that:
 *   1. Reads the job.input payload
 *   2. Calls updateJobProgress() at each stage
 *   3. Calls completeJob() or failJob() when done
 */

import { pickNextJob, updateJobProgress, completeJob, failJob, cleanupStalledJobs } from './backgroundJobService';
import { logger } from '../lib/logger';

// ═══════════════════════════════════════════
// Worker State
// ═══════════════════════════════════════════

let isProcessing = false;
let workerIntervalId: ReturnType<typeof setInterval> | null = null;
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

// ═══════════════════════════════════════════
// Job Handlers Registry
// ═══════════════════════════════════════════

type JobHandler = (job: any) => Promise<any>;
const handlers: Record<string, JobHandler> = {};

/**
 * Register a handler for a job type.
 * Called from index.ts where the pipeline code lives.
 */
export function registerJobHandler(type: string, handler: JobHandler): void {
    handlers[type] = handler;
    logger.info(`[JobWorker] Handler registered: ${type}`);
}

// ═══════════════════════════════════════════
// Worker Loop
// ═══════════════════════════════════════════

async function processNextJob(): Promise<void> {
    if (isProcessing) return;

    try {
        const job = await pickNextJob();
        if (!job) return;

        isProcessing = true;
        const startTime = Date.now();
        logger.info(`[JobWorker] Processing job ${job.id} (type=${job.type})`);

        const handler = handlers[job.type];
        if (!handler) {
            await failJob(job.id, job.tenantId, `No handler registered for type: ${job.type}`);
            isProcessing = false;
            return;
        }

        try {
            // Execute the handler — it calls updateJobProgress internally
            const result = await handler(job);
            const durationS = ((Date.now() - startTime) / 1000).toFixed(1);
            logger.info(`[JobWorker] Job ${job.id} completed in ${durationS}s`);
            await completeJob(job.id, job.tenantId, result);
        } catch (err: any) {
            logger.error(`[JobWorker] Job ${job.id} failed:`, err.message);
            await failJob(job.id, job.tenantId, err.message || 'Unknown error');
        }
    } catch (err: any) {
        logger.error(`[JobWorker] Loop error:`, err.message);
    } finally {
        isProcessing = false;
    }
}

/**
 * Start the worker loop. Called once at server startup.
 * Polls every 3 seconds for new jobs.
 */
export function startJobWorker(): void {
    if (workerIntervalId) {
        logger.warn('[JobWorker] Already running');
        return;
    }

    logger.info('[JobWorker] 🚀 Starting background job worker (poll every 3s)');
    workerIntervalId = setInterval(processNextJob, 3000);

    // Cleanup stalled jobs every 2 minutes
    cleanupIntervalId = setInterval(async () => {
        try {
            await cleanupStalledJobs();
        } catch (err: any) {
            logger.warn('[JobWorker] Cleanup error:', err.message);
        }
    }, 2 * 60 * 1000);

    // Initial cleanup on start
    cleanupStalledJobs().catch(() => {});

    // FIX-07: Recovery — re-queue jobs interrupted by previous deploy
    recoverInterruptedJobs().catch(() => {});
}

/**
 * FIX-07: Recover jobs interrupted by a previous deploy.
 * Jobs marked as 'interrupted_by_deploy' by the graceful shutdown handler
 * are re-queued so they run again automatically.
 * Max 2 recovery attempts (tracked via retryCount in input) to prevent infinite loops.
 */
async function recoverInterruptedJobs(): Promise<void> {
    try {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        const interrupted = await prisma.backgroundJob.findMany({
            where: {
                status: 'FAILED',
                error: 'interrupted_by_deploy',
                completedAt: { gte: oneHourAgo }, // Only recover recent jobs
            }
        });

        let recovered = 0;
        for (const job of interrupted) {
            const input = (job.input as any) || {};
            const retryCount = input.__recoveryRetries || 0;

            if (retryCount >= 2) {
                // Max retries reached — mark as permanently failed
                await prisma.backgroundJob.update({
                    where: { id: job.id },
                    data: {
                        error: `Falhou após ${retryCount} tentativas de recuperação pós-deploy`,
                    }
                });
                logger.warn(`[JobWorker] ⚠️ Job ${job.id} exceeded max recovery retries (${retryCount}). Marking as permanently failed.`);
                continue;
            }

            // Re-queue with incremented retry count
            await prisma.backgroundJob.update({
                where: { id: job.id },
                data: {
                    status: 'QUEUED',
                    progress: 0,
                    progressMsg: `Re-enfileirado após deploy (tentativa ${retryCount + 1}/2)`,
                    error: null,
                    completedAt: null,
                    input: { ...input, __recoveryRetries: retryCount + 1 },
                }
            });
            recovered++;
            logger.info(`[JobWorker] 🔄 Recovered interrupted job ${job.id} (type=${job.type}, retry=${retryCount + 1})`);
        }

        if (recovered > 0) {
            logger.info(`[JobWorker] ✅ Recovered ${recovered}/${interrupted.length} interrupted job(s) from previous deploy`);
        }

        await prisma.$disconnect();
    } catch (err: any) {
        logger.warn(`[JobWorker] ⚠️ Recovery check failed: ${err.message}`);
    }
}

/**
 * Stop the worker loop. Called on graceful shutdown.
 */
export function stopJobWorker(): void {
    if (workerIntervalId) {
        clearInterval(workerIntervalId);
        workerIntervalId = null;
    }
    if (cleanupIntervalId) {
        clearInterval(cleanupIntervalId);
        cleanupIntervalId = null;
    }
    logger.info('[JobWorker] Stopped');
}
