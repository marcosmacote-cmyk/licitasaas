"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerJobHandler = registerJobHandler;
exports.startJobWorker = startJobWorker;
exports.stopJobWorker = stopJobWorker;
const backgroundJobService_1 = require("./backgroundJobService");
const logger_1 = require("../lib/logger");
// ═══════════════════════════════════════════
// Worker State
// ═══════════════════════════════════════════
let isProcessing = false;
let workerIntervalId = null;
let cleanupIntervalId = null;
const handlers = {};
/**
 * Register a handler for a job type.
 * Called from index.ts where the pipeline code lives.
 */
function registerJobHandler(type, handler) {
    handlers[type] = handler;
    logger_1.logger.info(`[JobWorker] Handler registered: ${type}`);
}
// ═══════════════════════════════════════════
// Worker Loop
// ═══════════════════════════════════════════
async function processNextJob() {
    if (isProcessing)
        return;
    try {
        const job = await (0, backgroundJobService_1.pickNextJob)();
        if (!job)
            return;
        isProcessing = true;
        const startTime = Date.now();
        logger_1.logger.info(`[JobWorker] Processing job ${job.id} (type=${job.type})`);
        const handler = handlers[job.type];
        if (!handler) {
            await (0, backgroundJobService_1.failJob)(job.id, job.tenantId, `No handler registered for type: ${job.type}`);
            isProcessing = false;
            return;
        }
        try {
            // Execute the handler — it calls updateJobProgress internally
            const result = await handler(job);
            const durationS = ((Date.now() - startTime) / 1000).toFixed(1);
            logger_1.logger.info(`[JobWorker] Job ${job.id} completed in ${durationS}s`);
            await (0, backgroundJobService_1.completeJob)(job.id, job.tenantId, result);
        }
        catch (err) {
            logger_1.logger.error(`[JobWorker] Job ${job.id} failed:`, err.message);
            await (0, backgroundJobService_1.failJob)(job.id, job.tenantId, err.message || 'Unknown error');
        }
    }
    catch (err) {
        logger_1.logger.error(`[JobWorker] Loop error:`, err.message);
    }
    finally {
        isProcessing = false;
    }
}
/**
 * Start the worker loop. Called once at server startup.
 * Polls every 3 seconds for new jobs.
 */
function startJobWorker() {
    if (workerIntervalId) {
        logger_1.logger.warn('[JobWorker] Already running');
        return;
    }
    logger_1.logger.info('[JobWorker] 🚀 Starting background job worker (poll every 3s)');
    workerIntervalId = setInterval(processNextJob, 3000);
    // Cleanup stalled jobs every 2 minutes
    cleanupIntervalId = setInterval(async () => {
        try {
            await (0, backgroundJobService_1.cleanupStalledJobs)();
        }
        catch (err) {
            logger_1.logger.warn('[JobWorker] Cleanup error:', err.message);
        }
    }, 2 * 60 * 1000);
    // Initial cleanup on start
    (0, backgroundJobService_1.cleanupStalledJobs)().catch(() => { });
}
/**
 * Stop the worker loop. Called on graceful shutdown.
 */
function stopJobWorker() {
    if (workerIntervalId) {
        clearInterval(workerIntervalId);
        workerIntervalId = null;
    }
    if (cleanupIntervalId) {
        clearInterval(cleanupIntervalId);
        cleanupIntervalId = null;
    }
    logger_1.logger.info('[JobWorker] Stopped');
}
