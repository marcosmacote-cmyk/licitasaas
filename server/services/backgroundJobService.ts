/**
 * BackgroundJobService — Manages async AI operations with real-time status tracking.
 * 
 * Architecture:
 *   1. Frontend submits job → gets jobId immediately (202 Accepted)
 *   2. JobWorker picks up QUEUED jobs and processes them in background
 *   3. SSE pushes progress/completion events to connected clients
 *   4. Frontend receives notification and fetches result
 * 
 * Supported job types:
 *   - edital_analysis: Full V2 pipeline (extraction + normalization + risk review)
 *   - oracle: Technical Oracle comparison
 *   - proposal_populate: AI-populate proposal items
 *   - petition: Petition generation
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

const prisma = new PrismaClient();

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export type JobType = 'edital_analysis' | 'pncp_analysis' | 'oracle' | 'proposal_populate' | 'petition' | 'declaration';
export type JobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface JobSubmission {
    tenantId: string;
    userId: string;
    type: JobType;
    input: Record<string, any>;
    targetId?: string;
    targetTitle?: string;
}

export interface JobProgress {
    progress: number;       // 0-100
    progressMsg: string;    // Human-readable status
}

export interface JobEvent {
    type: 'job_queued' | 'job_progress' | 'job_completed' | 'job_failed';
    jobId: string;
    jobType: JobType;
    targetId?: string;
    targetTitle?: string;
    progress?: number;
    progressMsg?: string;
    error?: string;
    metadata?: any;
    timestamp: string;
}

// ═══════════════════════════════════════════
// SSE Client Registry
// ═══════════════════════════════════════════

interface SSEClient {
    userId: string;
    tenantId: string;
    res: any; // Express Response with SSE headers
}

const sseClients: Map<string, SSEClient> = new Map();

/**
 * Register an SSE client connection
 */
export function registerSSEClient(clientId: string, userId: string, tenantId: string, res: any): void {
    sseClients.set(clientId, { userId, tenantId, res });
    logger.info(`[SSE] Client registered: ${clientId} (user=${userId}, tenant=${tenantId}). Total: ${sseClients.size}`);
}

/**
 * Remove an SSE client connection
 */
export function removeSSEClient(clientId: string): void {
    sseClients.delete(clientId);
    logger.info(`[SSE] Client removed: ${clientId}. Total: ${sseClients.size}`);
}

/**
 * Push an event to all SSE clients of a given tenant
 */
export function pushEventToTenant(tenantId: string, event: JobEvent): void {
    const eventData = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    let sent = 0;
    for (const [clientId, client] of sseClients) {
        if (client.tenantId === tenantId) {
            try {
                client.res.write(eventData);
                sent++;
            } catch (err) {
                logger.warn(`[SSE] Failed to send to ${clientId}, removing client`);
                sseClients.delete(clientId);
            }
        }
    }
    if (sent > 0) {
        logger.info(`[SSE] Pushed ${event.type} for job ${event.jobId} to ${sent} client(s)`);
    }
}

// ═══════════════════════════════════════════
// Job CRUD Operations
// ═══════════════════════════════════════════

/**
 * Submit a new background job. Returns immediately with the job ID.
 */
export async function submitJob(submission: JobSubmission): Promise<{ jobId: string }> {
    // Check for duplicate: prevent submitting same type+targetId if already QUEUED/PROCESSING
    if (submission.targetId) {
        const existing = await prisma.backgroundJob.findFirst({
            where: {
                tenantId: submission.tenantId,
                type: submission.type,
                targetId: submission.targetId,
                status: { in: ['QUEUED', 'PROCESSING'] }
            }
        });
        if (existing) {
            logger.info(`[BackgroundJob] Duplicate prevented: ${submission.type} for ${submission.targetId} already ${existing.status}`);
            return { jobId: existing.id };
        }
    }

    // Check tenant limit: max 5 pending jobs
    const pendingCount = await prisma.backgroundJob.count({
        where: {
            tenantId: submission.tenantId,
            status: { in: ['QUEUED', 'PROCESSING'] }
        }
    });
    if (pendingCount >= 5) {
        throw new Error('Limite de 5 tarefas simultâneas atingido. Aguarde a conclusão de uma tarefa para submeter outra.');
    }

    const job = await prisma.backgroundJob.create({
        data: {
            tenantId: submission.tenantId,
            userId: submission.userId,
            type: submission.type,
            status: 'QUEUED',
            progress: 0,
            input: submission.input,
            targetId: submission.targetId || null,
            targetTitle: submission.targetTitle || null,
        }
    });

    logger.info(`[BackgroundJob] Created: ${job.id} (type=${job.type}, target=${job.targetId})`);

    // Push SSE event
    pushEventToTenant(submission.tenantId, {
        type: 'job_queued',
        jobId: job.id,
        jobType: submission.type as JobType,
        targetId: submission.targetId,
        targetTitle: submission.targetTitle,
        timestamp: new Date().toISOString(),
    });

    return { jobId: job.id };
}

/**
 * Update job progress (called by the worker during execution)
 */
export async function updateJobProgress(jobId: string, tenantId: string, progress: JobProgress): Promise<void> {
    await prisma.backgroundJob.update({
        where: { id: jobId },
        data: {
            status: 'PROCESSING',
            progress: progress.progress,
            progressMsg: progress.progressMsg,
        }
    });

    // Fetch job type for SSE event
    const job = await prisma.backgroundJob.findUnique({ where: { id: jobId }, select: { type: true, targetId: true, targetTitle: true } });

    pushEventToTenant(tenantId, {
        type: 'job_progress',
        jobId,
        jobType: (job?.type || 'edital_analysis') as JobType,
        targetId: job?.targetId || undefined,
        targetTitle: job?.targetTitle || undefined,
        progress: progress.progress,
        progressMsg: progress.progressMsg,
        timestamp: new Date().toISOString(),
    });
}

/**
 * Mark job as completed with result
 */
export async function completeJob(jobId: string, tenantId: string, result: any): Promise<void> {
    const job = await prisma.backgroundJob.update({
        where: { id: jobId },
        data: {
            status: 'COMPLETED',
            progress: 100,
            progressMsg: 'Concluído',
            result: result,
            completedAt: new Date(),
        }
    });

    logger.info(`[BackgroundJob] Completed: ${jobId} (type=${job.type})`);

    pushEventToTenant(tenantId, {
        type: 'job_completed',
        jobId,
        jobType: job.type as JobType,
        targetId: job.targetId || undefined,
        targetTitle: job.targetTitle || undefined,
        progress: 100,
        progressMsg: 'Concluído',
        timestamp: new Date().toISOString(),
    });
}

/**
 * Mark job as failed
 */
export async function failJob(jobId: string, tenantId: string, error: string): Promise<void> {
    const job = await prisma.backgroundJob.update({
        where: { id: jobId },
        data: {
            status: 'FAILED',
            error,
            completedAt: new Date(),
        }
    });

    logger.info(`[BackgroundJob] Failed: ${jobId} — ${error}`);

    pushEventToTenant(tenantId, {
        type: 'job_failed',
        jobId,
        jobType: job.type as JobType,
        targetId: job.targetId || undefined,
        targetTitle: job.targetTitle || undefined,
        error,
        timestamp: new Date().toISOString(),
    });
}

/**
 * Get a single job by ID (with tenant isolation)
 */
export async function getJob(jobId: string, tenantId: string) {
    return prisma.backgroundJob.findFirst({
        where: { id: jobId, tenantId }
    });
}

/**
 * List recent jobs for a user
 */
export async function listJobs(tenantId: string, userId: string, limit = 20) {
    return prisma.backgroundJob.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
            id: true,
            type: true,
            status: true,
            progress: true,
            progressMsg: true,
            error: true,
            targetId: true,
            targetTitle: true,
            createdAt: true,
            completedAt: true,
        }
    });
}

/**
 * Pick the next QUEUED job for processing (FIFO)
 */
export async function pickNextJob(): Promise<any | null> {
    // Atomic: find + update in one query to prevent race conditions
    const jobs = await prisma.backgroundJob.findMany({
        where: { status: 'QUEUED' },
        orderBy: { createdAt: 'asc' },
        take: 1,
    });

    if (jobs.length === 0) return null;

    const job = jobs[0];

    // Mark as PROCESSING atomically
    const updated = await prisma.backgroundJob.updateMany({
        where: { id: job.id, status: 'QUEUED' },
        data: { status: 'PROCESSING', progress: 5, progressMsg: 'Iniciando...' }
    });

    if (updated.count === 0) return null; // Another worker grabbed it

    return prisma.backgroundJob.findUnique({ where: { id: job.id } });
}

/**
 * Cleanup: expire stuck PROCESSING jobs (>5 min) and old completed jobs (>7 days)
 */
export async function cleanupStalledJobs(): Promise<number> {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Expire stuck jobs
    const stalled = await prisma.backgroundJob.updateMany({
        where: {
            status: 'PROCESSING',
            updatedAt: { lt: fiveMinAgo }
        },
        data: {
            status: 'FAILED',
            error: 'Timeout — job exceeded 5 minute limit',
            completedAt: new Date(),
        }
    });

    // Delete old completed/failed jobs
    const old = await prisma.backgroundJob.deleteMany({
        where: {
            status: { in: ['COMPLETED', 'FAILED'] },
            createdAt: { lt: sevenDaysAgo }
        }
    });

    if (stalled.count > 0 || old.count > 0) {
        logger.info(`[BackgroundJob] Cleanup: ${stalled.count} stalled, ${old.count} old deleted`);
    }

    return stalled.count + old.count;
}
