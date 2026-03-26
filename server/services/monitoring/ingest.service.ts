/**
 * ══════════════════════════════════════════════════════════════════
 * IngestService — Serviço unificado de ingestão de mensagens
 * ══════════════════════════════════════════════════════════════════
 * 
 * Centraliza a lógica que antes era duplicada em:
 *   - POST /api/chat-monitor/internal/ingest  (ComprasNet Watcher)
 *   - POST /api/chat-monitor/ingest           (BBMNet Watcher)
 *   - pollBatchProcesses()                    (BLL + BNC)
 *   - pollPCPProcesses()                      (Portal de Compras Públicas)
 *   - pollLicitanetProcesses()                (Licitanet)
 *   - pollLMBProcesses()                      (Licita Mais Brasil)
 * 
 * Pipeline:
 * 1. Deduplicação por messageId (Set em memória)
 * 2. Deduplicação por fingerprintHash (DB unique constraint)
 * 3. Keyword detection via KeywordDetector
 * 4. Criação de ChatMonitorLog
 * 5. Trigger de notificações (se houver alertas)
 */

import { PrismaClient } from '@prisma/client';
import { createDetectorFromConfig } from './keywordDetector';
import { DedupService } from './dedup.service';
import { NotificationService } from './notification.service';

// ── Types ──

export interface RawMessage {
    messageId?: string | null;
    content: string;
    authorType?: string;
    authorCnpj?: string | null;
    eventCategory?: string | null;
    itemRef?: string | null;
    captureSource?: string;
    timestamp?: string | null;
}

export interface IngestParams {
    processId: string;
    tenantId: string;
    messages: RawMessage[];
    /** Source of capture (e.g. 'local-watcher', 'bll-api', 'pcp-api') */
    captureSource: string;
    /** If true, skips the process ownership check (used by internal/worker endpoints) */
    skipOwnershipCheck?: boolean;
}

export interface IngestResult {
    success: boolean;
    created: number;
    alerts: number;
    total: number;
}

// ── Service ──

export class IngestService {
    /**
     * Ingests an array of raw messages into ChatMonitorLog.
     * 
     * Handles:
     * - Deduplication (both messageId and fingerprintHash)
     * - Keyword detection
     * - Log creation
     * - Notification triggering
     */
    static async ingestMessages(
        prisma: PrismaClient,
        params: IngestParams
    ): Promise<IngestResult> {
        const { processId, tenantId, messages, captureSource } = params;

        if (!messages || messages.length === 0) {
            return { success: true, created: 0, alerts: 0, total: 0 };
        }

        // 1. Build dedup sets from existing logs
        const existingLogs = await prisma.chatMonitorLog.findMany({
            where: { biddingProcessId: processId },
            select: { messageId: true, fingerprintHash: true },
        });
        const existingIds = new Set(existingLogs.map((l: any) => l.messageId));
        const existingFingerprints = new Set(existingLogs.map((l: any) => l.fingerprintHash));

        // 2. Load keyword detector config for this tenant
        const config = await prisma.chatMonitorConfig.findUnique({
            where: { tenantId },
        });
        const detector = createDetectorFromConfig(config);

        let created = 0;
        let alerts = 0;

        // 3. Process each message
        for (const msg of messages) {
            const messageId = msg.messageId || null;
            const content = msg.content || '';
            const authorType = msg.authorType || 'desconhecido';

            // 3a. Skip if messageId already exists
            if (messageId && existingIds.has(messageId)) continue;

            // 3b. Generate fingerprint and check for duplicates
            const fingerprintHash = DedupService.generateFingerprint(
                processId, messageId, content, authorType
            );

            if (existingFingerprints.has(fingerprintHash)) continue;

            // Double-check via DB (in case another concurrent process ingested it)
            const isDuplicate = await prisma.chatMonitorLog.findUnique({
                where: { fingerprintHash }
            });
            if (isDuplicate) {
                existingFingerprints.add(fingerprintHash);
                continue;
            }

            // 3c. Keyword detection
            const detection = detector.detect(content);
            if (detection.shouldNotify) alerts++;

            const eventCategory = msg.eventCategory || detection.categoryId || null;
            const status = detection.shouldNotify ? 'PENDING_NOTIFICATION' : 'CAPTURED';

            // 3d. Create log entry
            await prisma.chatMonitorLog.create({
                data: {
                    tenantId,
                    biddingProcessId: processId,
                    messageId,
                    fingerprintHash,
                    content,
                    authorType,
                    authorCnpj: msg.authorCnpj || null,
                    eventCategory,
                    itemRef: msg.itemRef || null,
                    detectedKeyword: detection.detectedKeyword,
                    captureSource: msg.captureSource || captureSource,
                    messageTimestamp: msg.timestamp || null,
                    status,
                },
            });

            // Track for in-memory dedup within this batch
            if (messageId) existingIds.add(messageId);
            existingFingerprints.add(fingerprintHash);
            created++;
        }

        // 4. Trigger notifications if there were keyword matches
        if (alerts > 0) {
            try {
                await NotificationService.processPendingNotifications();
            } catch { /* silent — notification failure should not break ingest */ }
        }

        return { success: true, created, alerts, total: messages.length };
    }
}
