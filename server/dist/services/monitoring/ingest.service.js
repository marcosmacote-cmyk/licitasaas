"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.IngestService = void 0;
const keywordDetector_1 = require("./keywordDetector");
const dedup_service_1 = require("./dedup.service");
const notification_service_1 = require("./notification.service");
// ── Service ──
class IngestService {
    /**
     * Ingests an array of raw messages into ChatMonitorLog.
     *
     * Handles:
     * - Deduplication (both messageId and fingerprintHash)
     * - Keyword detection
     * - Log creation
     * - Notification triggering
     */
    static async ingestMessages(prisma, params) {
        const { processId, tenantId, messages, captureSource } = params;
        if (!messages || messages.length === 0) {
            return { success: true, created: 0, alerts: 0, total: 0 };
        }
        // 1. Build dedup sets from existing logs
        const existingLogs = await prisma.chatMonitorLog.findMany({
            where: { biddingProcessId: processId },
            select: { messageId: true, fingerprintHash: true },
        });
        const existingIds = new Set(existingLogs.map((l) => l.messageId));
        const existingFingerprints = new Set(existingLogs.map((l) => l.fingerprintHash));
        // 2. Load keyword detector config for this tenant
        const config = await prisma.chatMonitorConfig.findUnique({
            where: { tenantId },
        });
        const detector = (0, keywordDetector_1.createDetectorFromConfig)(config);
        let created = 0;
        let alerts = 0;
        // 3. Process each message
        for (const msg of messages) {
            const messageId = msg.messageId || null;
            const content = msg.content || '';
            const authorType = msg.authorType || 'desconhecido';
            // 3a. Skip if messageId already exists
            if (messageId && existingIds.has(messageId))
                continue;
            // 3b. Generate fingerprint and check for duplicates
            const fingerprintHash = dedup_service_1.DedupService.generateFingerprint(processId, messageId, content, authorType);
            if (existingFingerprints.has(fingerprintHash))
                continue;
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
            if (detection.shouldNotify)
                alerts++;
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
            if (messageId)
                existingIds.add(messageId);
            existingFingerprints.add(fingerprintHash);
            created++;
        }
        // 4. Trigger notifications if there were keyword matches
        if (alerts > 0) {
            try {
                await notification_service_1.NotificationService.processPendingNotifications();
            }
            catch (notifErr) {
                console.error(`[IngestService] ⚠️ Notification processing failed (${alerts} alerts):`, notifErr.message || notifErr);
            }
        }
        return { success: true, created, alerts, total: messages.length };
    }
}
exports.IngestService = IngestService;
