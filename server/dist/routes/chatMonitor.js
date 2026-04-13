"use strict";
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
exports.injectChatMonitorDeps = injectChatMonitorDeps;
// Type-safe extracted route module
/**
 * Chat Monitor routes — config, logs, agents, worker, ingestion
 * Extracted from server/index.ts
 */
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middlewares/auth");
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../lib/logger");
const errorHandler_1 = require("../middlewares/errorHandler");
const alertTaxonomy_1 = require("../services/monitoring/alertTaxonomy");
const biddingHelpers_1 = require("../lib/biddingHelpers");
const crypto_1 = require("../lib/crypto");
const ingest_service_1 = require("../services/monitoring/ingest.service");
const router = express_1.default.Router();
// Bridge: Functions/data still in index.ts
let categoryKeywordMap;
let notifyAllSseClients;
let getFileBufferSafe;
let pncpMonitor;
function injectChatMonitorDeps(deps) {
    categoryKeywordMap = deps.categoryKeywordMap;
    notifyAllSseClients = deps.notifyAllSseClients;
    getFileBufferSafe = deps.getFileBufferSafe;
    pncpMonitor = deps.pncpMonitor;
}
// Chat Monitor Configuration
// ═══════════════════════════════════════════════════════════════════════
// GET: Taxonomy (static — returns available categories for the UI)
router.get('/taxonomy', auth_1.authenticateToken, async (req, res) => {
    try {
        res.json({
            categories: alertTaxonomy_1.ALERT_TAXONOMY.map((c) => ({
                id: c.id,
                label: c.label,
                emoji: c.emoji,
                severity: c.severity,
                description: c.description,
                enabledByDefault: c.enabledByDefault,
            })),
            bySeverity: {
                critical: (0, alertTaxonomy_1.getCategoriesBySeverity)().critical.map((c) => c.id),
                warning: (0, alertTaxonomy_1.getCategoriesBySeverity)().warning.map((c) => c.id),
                info: (0, alertTaxonomy_1.getCategoriesBySeverity)().info.map((c) => c.id),
            },
            defaultEnabled: alertTaxonomy_1.DEFAULT_ENABLED_CATEGORIES,
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch taxonomy' });
    }
});
router.get('/config', auth_1.authenticateToken, async (req, res) => {
    try {
        const config = await prisma_1.prisma.chatMonitorConfig.findUnique({
            where: { tenantId: req.user.tenantId }
        });
        if (!config) {
            return res.json({
                keywords: "suspensa,reaberta,vencedora",
                customKeywords: "[]",
                enabledCategories: JSON.stringify(alertTaxonomy_1.DEFAULT_ENABLED_CATEGORIES),
                categoryCustomKeywords: "{}",
                isActive: true
            });
        }
        // Garante que configs antigos (sem os novos campos) retornem defaults
        res.json({
            ...config,
            customKeywords: config.customKeywords || "[]",
            enabledCategories: config.enabledCategories || JSON.stringify(alertTaxonomy_1.DEFAULT_ENABLED_CATEGORIES),
            categoryCustomKeywords: config.categoryCustomKeywords || "{}",
            notificationEmail: config.notificationEmail || "",
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch chat monitor config' });
    }
});
router.post('/config', auth_1.authenticateToken, async (req, res) => {
    try {
        const { keywords, phoneNumber, telegramChatId, notificationEmail, isActive, enabledCategories, customKeywords, categoryCustomKeywords } = req.body;
        // Serializa arrays/objects para string JSON se necessário
        const enabledCatStr = enabledCategories
            ? (typeof enabledCategories === 'string' ? enabledCategories : JSON.stringify(enabledCategories))
            : undefined;
        const customKwStr = customKeywords
            ? (typeof customKeywords === 'string' ? customKeywords : JSON.stringify(customKeywords))
            : undefined;
        const catCustomKwStr = categoryCustomKeywords
            ? (typeof categoryCustomKeywords === 'string' ? categoryCustomKeywords : JSON.stringify(categoryCustomKeywords))
            : undefined;
        const config = await prisma_1.prisma.chatMonitorConfig.upsert({
            where: { tenantId: req.user.tenantId },
            create: {
                tenantId: req.user.tenantId,
                keywords,
                customKeywords: customKwStr,
                enabledCategories: enabledCatStr,
                categoryCustomKeywords: catCustomKwStr,
                phoneNumber,
                telegramChatId,
                notificationEmail,
                isActive: isActive ?? true
            },
            update: {
                ...(keywords !== undefined && { keywords }),
                ...(customKwStr !== undefined && { customKeywords: customKwStr }),
                ...(enabledCatStr !== undefined && { enabledCategories: enabledCatStr }),
                ...(catCustomKwStr !== undefined && { categoryCustomKeywords: catCustomKwStr }),
                ...(phoneNumber !== undefined && { phoneNumber }),
                ...(telegramChatId !== undefined && { telegramChatId }),
                ...(notificationEmail !== undefined && { notificationEmail }),
                isActive: isActive ?? true
            }
        });
        res.json(config);
    }
    catch (error) {
        logger_1.logger.error('[ChatMonitor Config POST] Error saving config:', error?.message || error);
        res.status(500).json({ error: 'Failed to save chat monitor config', detail: error?.message });
    }
});
router.get('/logs', auth_1.authenticateToken, async (req, res) => {
    try {
        const { keyword, search, status, page = '1', limit = '20' } = req.query;
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
        const skip = (pageNum - 1) * limitNum;
        // Build dynamic where clause
        const where = { tenantId: req.user.tenantId };
        if (keyword) {
            where.detectedKeyword = { contains: keyword, mode: 'insensitive' };
        }
        if (search) {
            where.content = { contains: search, mode: 'insensitive' };
        }
        if (status) {
            where.status = status;
        }
        const [logs, total] = await Promise.all([
            prisma_1.prisma.chatMonitorLog.findMany({
                where,
                include: { biddingProcess: true },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limitNum
            }),
            prisma_1.prisma.chatMonitorLog.count({ where })
        ]);
        res.json({
            logs,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch chat monitor logs' });
    }
});
// Test Notification Endpoint
router.post('/test', auth_1.authenticateToken, async (req, res) => {
    try {
        const { NotificationService } = await Promise.resolve().then(() => __importStar(require('../services/monitoring/notification.service')));
        const result = await NotificationService.sendTestNotification(req.user.tenantId);
        res.json({
            success: true,
            results: result,
            message: result.telegram === null && result.whatsapp === null && result.email === null
                ? 'Nenhum canal configurado. Insira um Telegram Chat ID ou WhatsApp nas Configurações.'
                : 'Teste de notificação enviado! Verifique seus canais.'
        });
    }
    catch (error) {
        logger_1.logger.error('[ChatMonitor] Test notification error:', error.message);
        res.status(500).json({ error: 'Falha ao enviar teste de notificação.' });
    }
});
// Monitor Health Status Endpoint
router.get('/health', auth_1.authenticateToken, async (req, res) => {
    try {
        const health = pncpMonitor.getHealthStatus();
        const monitoredCount = await prisma_1.prisma.biddingProcess.count({
            where: { isMonitored: true, tenantId: req.user.tenantId }
        });
        const totalAlerts = await prisma_1.prisma.chatMonitorLog.count({
            where: { tenantId: req.user.tenantId }
        });
        res.json({
            ...health,
            monitoredProcesses: monitoredCount,
            totalAlerts
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get monitor health' });
    }
});
// ══════════════════════════════════════════
// ── Chat Monitor Module v2 Endpoints ──
// ══════════════════════════════════════════
// Update pncpLink for a process (manual fix when link was overwritten)
router.patch('/pncp-link/:processId', auth_1.authenticateToken, async (req, res) => {
    try {
        const { processId } = req.params;
        const { pncpLink } = req.body;
        if (!pncpLink?.includes('editais')) {
            return res.status(400).json({ error: 'Link PNCP inválido. Deve conter /editais/CNPJ/ANO/SEQ' });
        }
        await prisma_1.prisma.biddingProcess.update({
            where: { id: processId },
            data: { pncpLink }
        });
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: 'Falha ao atualizar link PNCP' });
    }
});
// Get grouped processes with message counts (V3 — includes monitored processes without logs)
router.get('/processes', auth_1.authenticateToken, async (req, res) => {
    try {
        const { companyId, platform } = req.query;
        const tenantId = req.user.tenantId;
        // Step 1: Get ALL relevant processes — monitored OR with chat logs
        const processWhere = {
            tenantId,
            OR: [
                { isMonitored: true },
                { chatMonitorLogs: { some: {} } }
            ],
        };
        if (companyId)
            processWhere.companyProfileId = companyId;
        const processes = await prisma_1.prisma.biddingProcess.findMany({
            where: processWhere,
            select: {
                id: true, title: true, portal: true, modality: true,
                uasg: true, companyProfileId: true, isMonitored: true, link: true, pncpLink: true,
                company: { select: { razaoSocial: true } },
                _count: { select: { chatMonitorLogs: true } },
            }
        });
        if (processes.length === 0) {
            return res.json([]);
        }
        const processIds = processes.map(p => p.id);
        // Step 2: Get last message per process (raw SQL for performance)
        let lastMsgMap = new Map();
        try {
            const lastMessages = await prisma_1.prisma.$queryRawUnsafe(`
                SELECT DISTINCT ON ("biddingProcessId") 
                    "biddingProcessId", "content", "createdAt", "authorType", "detectedKeyword"
                FROM "ChatMonitorLog" 
                WHERE "tenantId" = $1 AND "biddingProcessId" = ANY($2::text[])
                ORDER BY "biddingProcessId", "createdAt" DESC
            `, tenantId, processIds);
            lastMsgMap = new Map(lastMessages.map((m) => [m.biddingProcessId, m]));
        }
        catch (e) {
            logger_1.logger.info('[ChatMonitor] Raw query failed, skipping last messages:', e);
        }
        // Step 3: Safely get unread counts
        let unreadMap = new Map();
        let unreadQueryOk = false;
        try {
            const unreadCounts = await prisma_1.prisma.chatMonitorLog.groupBy({
                by: ['biddingProcessId'],
                where: { tenantId, isRead: false },
                _count: { id: true },
            });
            unreadMap = new Map(unreadCounts.map((u) => [u.biddingProcessId, u._count.id]));
            unreadQueryOk = true;
        }
        catch {
            // isRead column may not exist yet — fall back to total
        }
        // Step 4: Get important processes (keyword detected OR manually pinned)
        let importantSet = new Set();
        try {
            const kwLogs = await prisma_1.prisma.chatMonitorLog.findMany({
                where: { tenantId, OR: [{ detectedKeyword: { not: null } }, { isImportant: true }] },
                select: { biddingProcessId: true },
                distinct: ['biddingProcessId'],
            });
            importantSet = new Set(kwLogs.map((k) => k.biddingProcessId));
        }
        catch { /* silent */ }
        // Step 4b: Get archived processes (ALL logs for process are archived)
        let archivedSet = new Set();
        try {
            const archivedLogs = await prisma_1.prisma.chatMonitorLog.findMany({
                where: { tenantId, isArchived: true },
                select: { biddingProcessId: true },
                distinct: ['biddingProcessId'],
            });
            archivedSet = new Set(archivedLogs.map((k) => k.biddingProcessId));
        }
        catch { /* silent */ }
        // Step 4c: Detect closure events (encerramento_processo category)
        let closureMap = new Map();
        try {
            const closureLogs = await prisma_1.prisma.chatMonitorLog.findMany({
                where: {
                    tenantId,
                    detectedKeyword: { not: null },
                    // Match closure-related keywords
                    OR: [
                        { content: { contains: 'homologad', mode: 'insensitive' } },
                        { content: { contains: 'cancelad', mode: 'insensitive' } },
                        { content: { contains: 'anulad', mode: 'insensitive' } },
                        { content: { contains: 'revogad', mode: 'insensitive' } },
                        { content: { contains: 'desert', mode: 'insensitive' } },
                        { content: { contains: 'fracassad', mode: 'insensitive' } },
                        { content: { contains: 'processo encerrado', mode: 'insensitive' } },
                        { content: { contains: 'licitação encerrada', mode: 'insensitive' } },
                    ],
                    isArchived: false,
                },
                select: { biddingProcessId: true, detectedKeyword: true },
                orderBy: { createdAt: 'desc' },
            });
            for (const log of closureLogs) {
                if (!closureMap.has(log.biddingProcessId)) {
                    closureMap.set(log.biddingProcessId, log.detectedKeyword || 'Encerrado');
                }
            }
        }
        catch { /* silent */ }
        // Step 5: Build result
        const result = processes.map((p) => {
            const total = p._count.chatMonitorLogs || 0;
            const lastMsg = lastMsgMap.get(p.id);
            // Determine best platform link (prefer non-PNCP)
            const rawLink = p.link || null;
            const pncpLink = p.pncpLink || null;
            const isPncpUrl = (url) => /pncp\.gov\.br/i.test(url || '');
            // platformLink = the actual platform URL (ComprasNet, BLL, etc.), not PNCP
            const platformLink = (rawLink && !isPncpUrl(rawLink)) ? rawLink
                : (pncpLink && !isPncpUrl(pncpLink)) ? pncpLink
                    : null;
            return {
                id: p.id,
                title: p.title,
                portal: p.portal,
                modality: p.modality,
                uasg: p.uasg,
                companyProfileId: p.companyProfileId,
                companyName: p.company?.razaoSocial || null,
                isMonitored: p.isMonitored,
                link: rawLink,
                pncpLink: pncpLink,
                platformLink: platformLink,
                hasPncpLink: !!(rawLink?.includes('editais')),
                totalMessages: total,
                // If query succeeded: use actual count (0 if not in map). If failed: fall back to total.
                unreadCount: unreadQueryOk ? (unreadMap.get(p.id) || 0) : total,
                isImportant: importantSet.has(p.id),
                isArchived: archivedSet.has(p.id),
                closureDetected: closureMap.get(p.id) || null,
                lastMessage: lastMsg ? {
                    content: lastMsg.content,
                    createdAt: lastMsg.createdAt,
                    authorType: lastMsg.authorType,
                    detectedKeyword: lastMsg.detectedKeyword,
                } : null,
            };
        });
        // Sort: processes with messages first (by last msg date), then monitored without msgs
        result.sort((a, b) => {
            const dateA = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
            const dateB = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
            return dateB - dateA;
        });
        // Apply platform filter
        let filtered = result;
        if (platform) {
            const pf = platform.toLowerCase();
            filtered = result.filter((p) => {
                const portal = (p.portal || '').toLowerCase();
                const link = (p.link || '').toLowerCase();
                if (pf === 'comprasnet')
                    return (link.includes('cnetmobile') || link.includes('comprasnet') || portal.includes('compras') || portal.includes('cnet')) && !link.includes('bllcompras') && !link.includes('bnccompras') && !link.includes('bbmnet') && !link.includes('portaldecompraspublicas') && !link.includes('licitanet.com.br') && !link.includes('licitamaisbrasil') && !link.includes('m2atecnologia') && !portal.includes('m2a');
                if (pf === 'bbmnet')
                    return link.includes('bbmnet') || link.includes('sala.bbmnet') || portal.includes('bbmnet');
                if (pf === 'm2a')
                    return link.includes('m2atecnologia') || portal.includes('m2a');
                if (pf === 'pncp')
                    return portal.includes('pncp') || link.includes('pncp.gov.br');
                if (pf === 'pcp')
                    return link.includes('portaldecompraspublicas') || portal.includes('portal de compras');
                if (pf === 'licitanet')
                    return link.includes('licitanet.com.br') || portal.includes('licitanet');
                if (pf === 'licitamaisbrasil')
                    return link.includes('licitamaisbrasil.com.br') || portal.includes('licita mais brasil') || portal.includes('licitamaisbrasil');
                if (pf === 'bll')
                    return link.includes('bllcompras') || link.includes('bll.org') || portal.includes('bll');
                if (pf === 'bnc')
                    return link.includes('bnccompras');
                return true;
            });
        }
        res.json(filtered);
    }
    catch (error) {
        logger_1.logger.error('[ChatMonitor] Error fetching processes:', error);
        res.status(500).json({ error: 'Failed to fetch chat monitor processes', details: String(error) });
    }
});
// ── Global Message Search ──
router.get('/search', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const q = (req.query.q || '').trim();
        const limit = Number(req.query.limit) || 100;
        if (!q)
            return res.json({ results: [] });
        const messages = await prisma_1.prisma.chatMonitorLog.findMany({
            where: {
                tenantId,
                content: { contains: q, mode: 'insensitive' }
            },
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                biddingProcess: {
                    select: {
                        id: true,
                        title: true,
                        portal: true,
                        company: { select: { razaoSocial: true } }
                    }
                }
            }
        });
        // Format similarly to standard messages for UI consistency, adding process info
        const formatted = messages.map((m) => ({
            id: m.id,
            content: m.content,
            authorType: m.authorType,
            eventCategory: m.eventCategory,
            isImportant: m.isImportant,
            isArchived: m.isArchived,
            createdAt: m.createdAt,
            messageTimestamp: m.messageTimestamp,
            biddingProcessId: m.biddingProcessId,
            biddingProcessTitle: m.biddingProcess?.title,
            biddingProcessPortal: m.biddingProcess?.portal,
            biddingProcessCompany: m.biddingProcess?.company?.razaoSocial
        }));
        res.json({ results: formatted });
    }
    catch (error) {
        logger_1.logger.error('[ChatMonitor] Error searching global messages:', error);
        res.status(500).json({ error: 'Failed to search messages' });
    }
});
// ── Process Closure Action ──
// Handles closure events: move bidding to Perdido/Arquivado and archive from monitor
router.post('/process-close/:processId', auth_1.authenticateToken, async (req, res) => {
    try {
        const { processId } = req.params;
        const { action } = req.body; // 'lost' | 'archived' | 'dismiss'
        const tenantId = req.user.tenantId;
        if (!['lost', 'archived', 'dismiss', 'stop-monitoring'].includes(action)) {
            return res.status(400).json({ error: 'Invalid action. Use: lost, archived, dismiss, stop-monitoring' });
        }
        // Map action to bidding status
        const statusMap = {
            lost: 'Perdido',
            archived: 'Arquivado',
        };
        // 1. Update bidding process status (if not dismiss/stop-monitoring)
        if (action === 'stop-monitoring') {
            // Only disable monitoring, don't change status or archive logs
            await prisma_1.prisma.biddingProcess.update({
                where: { id: processId, tenantId },
                data: { isMonitored: false },
            });
            logger_1.logger.info(`[ChatMonitor] Process ${processId} monitoring stopped (status unchanged)`);
            return res.json({
                success: true,
                action,
                message: 'Monitoramento removido — o status do processo não foi alterado.',
            });
        }
        if (action !== 'dismiss') {
            await prisma_1.prisma.biddingProcess.update({
                where: { id: processId, tenantId },
                data: {
                    status: statusMap[action],
                    isMonitored: false,
                },
            });
        }
        // 2. Archive all monitor logs for this process
        await prisma_1.prisma.chatMonitorLog.updateMany({
            where: { biddingProcessId: processId, tenantId },
            data: { isArchived: true },
        });
        logger_1.logger.info(`[ChatMonitor] Process ${processId} closed with action: ${action}`);
        res.json({
            success: true,
            action,
            newStatus: statusMap[action] || null,
            message: action === 'dismiss'
                ? 'Processo mantido no monitoramento (logs arquivados)'
                : `Processo movido para "${statusMap[action]}" e arquivado do monitoramento`,
        });
    }
    catch (error) {
        logger_1.logger.error('[ChatMonitor] Error closing process:', error?.message || error);
        res.status(500).json({ error: 'Failed to close process', detail: error?.message });
    }
});
// Get messages for a specific process (paginated, ordered chronologically)
router.get('/messages/:processId', auth_1.authenticateToken, async (req, res) => {
    try {
        const { processId } = req.params;
        const { page = '1', limit = '100' } = req.query;
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 100));
        const skip = (pageNum - 1) * limitNum;
        const [messages, total] = await Promise.all([
            prisma_1.prisma.chatMonitorLog.findMany({
                where: { biddingProcessId: processId, tenantId: req.user.tenantId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limitNum,
            }),
            prisma_1.prisma.chatMonitorLog.count({
                where: { biddingProcessId: processId, tenantId: req.user.tenantId },
            }),
        ]);
        // Also get the process details
        const process = await prisma_1.prisma.biddingProcess.findUnique({
            where: { id: processId },
            select: {
                id: true, title: true, portal: true, modality: true,
                companyProfileId: true,
            },
        });
        res.json({
            messages,
            process: process ? { ...process, uasg: process.uasg } : null,
            pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
        });
    }
    catch (error) {
        logger_1.logger.error('[ChatMonitor] Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});
// Get unread count (for sidebar badge)
router.get('/unread-count', auth_1.authenticateToken, async (req, res) => {
    try {
        const count = await prisma_1.prisma.chatMonitorLog.count({
            where: { tenantId: req.user.tenantId, isRead: false, isArchived: false }
        });
        res.json({ count });
    }
    catch {
        // isRead/isArchived columns may not exist yet
        res.json({ count: 0 });
    }
});
// Toggle read/important/archive on a log
router.put('/log/:logId', auth_1.authenticateToken, async (req, res) => {
    try {
        const { logId } = req.params;
        const { isRead, isImportant, isArchived } = req.body;
        const data = {};
        if (isRead !== undefined)
            data.isRead = isRead;
        if (isImportant !== undefined)
            data.isImportant = isImportant;
        if (isArchived !== undefined)
            data.isArchived = isArchived;
        const updated = await prisma_1.prisma.chatMonitorLog.update({
            where: { id: logId },
            data,
        });
        res.json(updated);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update log' });
    }
});
// Batch mark-read all messages for a process
router.put('/read-all/:processId', auth_1.authenticateToken, async (req, res) => {
    try {
        const { processId } = req.params;
        const result = await prisma_1.prisma.chatMonitorLog.updateMany({
            where: { biddingProcessId: processId, tenantId: req.user.tenantId, isRead: false },
            data: { isRead: true },
        });
        res.json({ updated: result.count });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to mark messages as read' });
    }
});
// Batch toggle important/archive for all messages of a process
router.put('/process-action/:processId', auth_1.authenticateToken, async (req, res) => {
    try {
        const { processId } = req.params;
        const { isImportant, isArchived } = req.body;
        const data = {};
        if (isImportant !== undefined)
            data.isImportant = isImportant;
        if (isArchived !== undefined)
            data.isArchived = isArchived;
        const result = await prisma_1.prisma.chatMonitorLog.updateMany({
            where: { biddingProcessId: processId, tenantId: req.user.tenantId },
            data,
        });
        res.json({ updated: result.count });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update process messages' });
    }
});
// ══════════════════════════════════════════
// ── Local Watcher (Agent) Endpoints ──
// ══════════════════════════════════════════
// In-memory store for Agent Heartbeats (Phase 1)
const agentHeartbeats = new Map();
// ══════════════════════════════════════════════════════════════
// ── System Health Watchdog: Self-monitoring for silent deaths ──
// ══════════════════════════════════════════════════════════════
const ADMIN_TELEGRAM_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID || '';
const pollerLastSuccess = new Map();
// Track which alerts are currently active (avoid repeated spam)
const watchdogActiveAlerts = new Set();
async function sendAdminAlert(message) {
    if (!ADMIN_TELEGRAM_CHAT_ID) {
        logger_1.logger.warn('[Watchdog] ⚠️ ADMIN_TELEGRAM_CHAT_ID not set — alert suppressed');
        return;
    }
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
        logger_1.logger.warn('[Watchdog] ⚠️ TELEGRAM_BOT_TOKEN not set — alert suppressed');
        return;
    }
    try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: ADMIN_TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML',
        }, { timeout: 10000 });
        logger_1.logger.info(`[Watchdog] ✅ Admin alert sent to ${ADMIN_TELEGRAM_CHAT_ID}`);
    }
    catch (err) {
        logger_1.logger.error(`[Watchdog] ❌ Failed to send admin alert:`, err.message);
    }
}
async function runWatchdogCheck() {
    const now = new Date();
    const alerts = [];
    // ── 1. Check Railway pollers (BLL, BNC, PCP, Licitanet, LMB) ──
    const pollerThresholds = {
        'BLL+BNC': 10 * 60000, // 10 min (polls every 60s)
        'PCP': 15 * 60000, // 15 min (polls every 90s)
        'Licitanet': 15 * 60000, // 15 min (polls every 90s)
        'LMB': 15 * 60000, // 15 min (polls every 90s)
    };
    for (const [name, thresholdMs] of Object.entries(pollerThresholds)) {
        const lastSuccess = pollerLastSuccess.get(name);
        if (!lastSuccess)
            continue; // Not started yet — skip (will fire after startup delay)
        const elapsedMs = now.getTime() - lastSuccess.getTime();
        if (elapsedMs > thresholdMs) {
            const mins = Math.floor(elapsedMs / 60000);
            if (!watchdogActiveAlerts.has(name)) {
                alerts.push(`⚠️ <b>${name}</b> não completa um ciclo há <b>${mins} minutos</b>`);
                watchdogActiveAlerts.add(name);
            }
        }
        else {
            // Recovered — clear active alert
            if (watchdogActiveAlerts.has(name)) {
                watchdogActiveAlerts.delete(name);
                // Send recovery notification
                sendAdminAlert(`✅ <b>${name}</b> voltou a funcionar normalmente.`);
            }
        }
    }
    // ── 2. Check Worker heartbeats (ComprasNet, BBMNET) ──
    const workerThresholdMs = 30 * 60000; // 30 min — workers do heartbeat less frequently
    let anyWorkerHeartbeat = false;
    for (const [_tid, hb] of agentHeartbeats.entries()) {
        if (hb.lastHeartbeatAt) {
            anyWorkerHeartbeat = true;
            const elapsedMs = now.getTime() - new Date(hb.lastHeartbeatAt).getTime();
            if (elapsedMs > workerThresholdMs) {
                const mins = Math.floor(elapsedMs / 60000);
                const label = `Worker-${hb.machineName || 'unknown'}`;
                if (!watchdogActiveAlerts.has(label)) {
                    alerts.push(`⚠️ <b>${label}</b> não fez heartbeat há <b>${mins} minutos</b>`);
                    watchdogActiveAlerts.add(label);
                }
            }
            else {
                const label = `Worker-${hb.machineName || 'unknown'}`;
                if (watchdogActiveAlerts.has(label)) {
                    watchdogActiveAlerts.delete(label);
                    sendAdminAlert(`✅ <b>${label}</b> voltou a fazer heartbeat.`);
                }
            }
        }
    }
    // ── 3. Check for stale notification queue ──
    try {
        const pendingCount = await prisma_1.prisma.chatMonitorLog.count({
            where: { status: 'PENDING_NOTIFICATION' },
        });
        if (pendingCount > 20) {
            const label = 'NotificationQueue';
            if (!watchdogActiveAlerts.has(label)) {
                alerts.push(`⚠️ <b>Fila de notificações</b> com <b>${pendingCount}</b> mensagens pendentes (possível travamento)`);
                watchdogActiveAlerts.add(label);
            }
        }
        else {
            watchdogActiveAlerts.delete('NotificationQueue');
        }
    }
    catch { /* DB query failed — don't alert on watchdog errors */ }
    // ── Send consolidated alert ──
    if (alerts.length > 0) {
        const msg = `🔴 <b>ALERTA DO SISTEMA — LicitaSaaS</b>\n\n` +
            alerts.join('\n') + '\n\n' +
            `<i>${now.toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })}</i>`;
        await sendAdminAlert(msg);
    }
}
// 1. Get sessions the agent should monitor
router.get('/agents/sessions', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const processes = await prisma_1.prisma.biddingProcess.findMany({
            where: {
                tenantId,
                isMonitored: true,
                OR: [
                    // ComprasNet processes (need uasg + modalityCode)
                    {
                        uasg: { not: null },
                        modalityCode: { not: null },
                        processNumber: { not: null },
                        processYear: { not: null },
                    },
                    // ── Platform detection via LINK ──
                    { link: { contains: 'bbmnet', mode: 'insensitive' } },
                    { link: { contains: 'bllcompras', mode: 'insensitive' } },
                    { link: { contains: 'bnccompras', mode: 'insensitive' } },
                    { link: { contains: 'm2atecnologia', mode: 'insensitive' } },
                    { link: { contains: 'portaldecompraspublicas', mode: 'insensitive' } },
                    { link: { contains: 'licitanet', mode: 'insensitive' } },
                    { link: { contains: 'licitamaisbrasil', mode: 'insensitive' } },
                    // ── Platform detection via PORTAL (fallback for manual imports
                    //    where link is a file upload path, not a platform URL) ──
                    { portal: { contains: 'bbmnet', mode: 'insensitive' } },
                    { portal: { contains: 'bll', mode: 'insensitive' } },
                    { portal: { contains: 'bnc', mode: 'insensitive' } },
                    { portal: { contains: 'm2a', mode: 'insensitive' } },
                    { portal: { contains: 'portal de compras', mode: 'insensitive' } },
                    { portal: { contains: 'licitanet', mode: 'insensitive' } },
                    { portal: { contains: 'licita mais', mode: 'insensitive' } },
                ],
            },
            select: {
                id: true,
                title: true,
                uasg: true,
                modalityCode: true,
                processNumber: true,
                processYear: true,
                portal: true,
                link: true
            }
        });
        res.json(processes);
    }
    catch (error) {
        logger_1.logger.error('[Agent /sessions] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch agent sessions' });
    }
});
// 2. Agent Heartbeat (Ping from Local Watcher)
router.post('/agents/heartbeat', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { machineName, activeSessions, agentVersion, status } = req.body;
        agentHeartbeats.set(tenantId, {
            machineName: machineName || 'Local Agent',
            activeSessions: activeSessions || 0,
            agentVersion: agentVersion || '1.0.0',
            status: status || 'online',
            lastHeartbeatAt: new Date(),
        });
        res.json({ success: true, timestamp: new Date() });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to register heartbeat' });
    }
});
// 3. Agent Status (Ping from React UI)
router.get('/agents/status', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const status = agentHeartbeats.get(tenantId);
        if (!status) {
            return res.json({ isOnline: false });
        }
        // Agent is considered offline if missed heartbeat for > 3 minutes
        const isOnline = (new Date().getTime() - status.lastHeartbeatAt.getTime()) < 3 * 60 * 1000;
        res.json({ ...status, isOnline });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch agent status' });
    }
});
// Receives messages from local ComprasNet Watcher
// ══════════════════════════════════════════
// ── Internal Worker Endpoints (multi-tenant, API key auth) ──
// Used by the centralized chat worker running on the server.
// Authenticated via CHAT_WORKER_SECRET instead of user JWT.
const CHAT_WORKER_SECRET = process.env.CHAT_WORKER_SECRET || '';
function authenticateWorker(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace('Bearer ', '');
    if (!CHAT_WORKER_SECRET || token !== CHAT_WORKER_SECRET) {
        return res.status(403).json({ error: 'Invalid worker secret' });
    }
    next();
}
// Internal Worker Heartbeat (updates agentHeartbeats per-tenant)
router.post('/internal/heartbeat', authenticateWorker, async (req, res) => {
    try {
        const { activeSessions, tenantIds, machineName } = req.body;
        const tenants = tenantIds || [];
        for (const tid of tenants) {
            agentHeartbeats.set(tid, {
                machineName: machineName || 'Server Worker v4.0',
                activeSessions: activeSessions || 0,
                agentVersion: '4.0.0',
                status: 'online',
                lastHeartbeatAt: new Date(),
            });
        }
        res.json({ success: true, timestamp: new Date() });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to register worker heartbeat' });
    }
});
// Get ALL monitored processes across ALL tenants (for centralized worker)
// v3.0: Inclui credenciais do portal vinculado para autenticação dinâmica
router.get('/internal/all-sessions', authenticateWorker, async (req, res) => {
    try {
        const processes = await prisma_1.prisma.biddingProcess.findMany({
            where: {
                isMonitored: true,
            },
            select: {
                id: true,
                tenantId: true,
                title: true,
                summary: true,
                uasg: true,
                modalityCode: true,
                processNumber: true,
                processYear: true,
                portal: true,
                link: true,
                sessionDate: true,
                companyProfileId: true,
                company: {
                    select: {
                        razaoSocial: true,
                        credentials: {
                            select: {
                                platform: true,
                                url: true,
                                login: true,
                                password: true,
                            }
                        }
                    }
                }
            }
        });
        // Match best credential per process based on portal/link (v2 — with PLATFORM_DOMAINS fallback)
        const enriched = processes.map((p) => {
            const creds = p.company?.credentials || [];
            const link = (p.link || '').toLowerCase();
            const rawPortal = (p.portal || '');
            const normalizedPortal = (0, biddingHelpers_1.normalizePortal)(rawPortal, p.link || '');
            // Smart matching: score each credential
            let bestCred = null;
            let bestScore = 0;
            // Get expected domains for this process's normalized portal
            const expectedDomains = biddingHelpers_1.PLATFORM_DOMAINS[normalizedPortal] || [];
            for (const c of creds) {
                const cp = (c.platform || '').toLowerCase();
                const cu = (c.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
                let score = 0;
                // Layer 1: Exact URL match (strongest signal)
                if (cu && link && (link.includes(cu) || cu.includes(link.split('/')[2] || '')))
                    score += 10;
                // Layer 2: Domain-level match (link domain vs credential URL domain)
                const linkDomain = link.split('/')[2] || '';
                const credDomain = cu.split('/')[0] || '';
                if (linkDomain && credDomain && (linkDomain.includes(credDomain) || credDomain.includes(linkDomain)))
                    score += 8;
                // Layer 3: Platform name match (normalized portal vs credential platform)
                const normalizedCredPlatform = (0, biddingHelpers_1.normalizePortal)(c.platform || '', c.url || '');
                if (normalizedCredPlatform === normalizedPortal)
                    score += 7;
                if (cp && link && link.includes(cp.replace(/\s+/g, '')))
                    score += 5;
                // Layer 4: PLATFORM_DOMAINS fallback — match credential URL against expected domains
                if (expectedDomains.length > 0 && cu) {
                    if (expectedDomains.some(d => cu.includes(d)))
                        score += 6;
                }
                // Also check if credential platform maps to any of expected domains
                const credPlatformDomains = biddingHelpers_1.PLATFORM_DOMAINS[normalizedCredPlatform] || [];
                if (expectedDomains.length > 0 && credPlatformDomains.some(d => expectedDomains.includes(d)))
                    score += 5;
                if (score > bestScore) {
                    bestScore = score;
                    bestCred = c;
                }
            }
            return {
                id: p.id,
                tenantId: p.tenantId,
                title: p.title,
                summary: p.summary || null,
                uasg: p.uasg,
                modalityCode: p.modalityCode,
                processNumber: p.processNumber,
                processYear: p.processYear,
                portal: normalizedPortal, // Send normalized portal to workers
                link: p.link,
                sessionDate: p.sessionDate || null,
                companyProfileId: p.companyProfileId,
                companyName: p.company?.razaoSocial || null,
                portalCredentials: bestCred ? {
                    login: (0, crypto_1.isEncryptionConfigured)() && (0, crypto_1.isEncrypted)(bestCred.login) ? (0, crypto_1.decryptCredential)(bestCred.login) : bestCred.login,
                    password: (0, crypto_1.isEncryptionConfigured)() && (0, crypto_1.isEncrypted)(bestCred.password) ? (0, crypto_1.decryptCredential)(bestCred.password) : bestCred.password,
                    url: bestCred.url,
                    platform: bestCred.platform,
                } : null,
            };
        });
        logger_1.logger.info(`[Worker] Returning ${enriched.length} monitored processes across all tenants (${enriched.filter((p) => p.portalCredentials).length} with credentials)`);
        res.json(enriched);
    }
    catch (error) {
        logger_1.logger.error('[Worker /all-sessions] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch all sessions' });
    }
});
// Ingest messages from centralized worker (with explicit tenantId)
router.post('/internal/ingest', authenticateWorker, async (req, res) => {
    try {
        const { processId, tenantId, messages } = req.body;
        if (!processId || !tenantId || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'processId, tenantId, and messages[] required' });
        }
        // Verify process belongs to tenant
        const processRecord = await prisma_1.prisma.biddingProcess.findFirst({
            where: { id: processId, tenantId }
        });
        if (!processRecord) {
            return res.status(404).json({ error: 'Process not found for given tenant' });
        }
        const result = await ingest_service_1.IngestService.ingestMessages(prisma_1.prisma, {
            processId, tenantId, messages, captureSource: 'server-worker'
        });
        logger_1.logger.info(`[Worker Ingest] ${result.created} msgs saved for ${processId.substring(0, 8)} (tenant ${tenantId.substring(0, 8)}, ${result.alerts} alerts)`);
        res.json(result);
    }
    catch (error) {
        logger_1.logger.error('[Worker Ingest] Error:', error.message);
        (0, errorHandler_1.handleApiError)(res, error, 'worker-ingest');
    }
});
// ── Diagnostic: check notification pipeline health ──
router.get('/internal/notification-diag', authenticateWorker, async (req, res) => {
    try {
        const { NotificationService } = await Promise.resolve().then(() => __importStar(require('../services/monitoring/notification.service')));
        // 1. Check env vars
        const envCheck = {
            TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
            TELEGRAM_BOT_TOKEN_length: (process.env.TELEGRAM_BOT_TOKEN || '').length,
            WHATSAPP_API_URL: !!process.env.WHATSAPP_API_URL,
            WHATSAPP_API_TOKEN: !!process.env.WHATSAPP_API_TOKEN,
            RESEND_API_KEY: !!process.env.RESEND_API_KEY,
            PROCESS_ROLE: process.env.PROCESS_ROLE || 'not-set',
        };
        // 2. Count log statuses
        const statusCounts = await prisma_1.prisma.chatMonitorLog.groupBy({
            by: ['status'],
            _count: true,
        });
        // 3. Check tenant configs
        const configs = await prisma_1.prisma.chatMonitorConfig.findMany({
            select: {
                tenantId: true,
                isActive: true,
                telegramChatId: true,
                phoneNumber: true,
                notificationEmail: true,
            },
        });
        // 4. Recent logs with BLL/BNC
        const recentBatchLogs = await prisma_1.prisma.chatMonitorLog.findMany({
            where: {
                captureSource: { in: ['bll-api', 'bnc-api'] },
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
                id: true,
                status: true,
                sentTo: true,
                captureSource: true,
                detectedKeyword: true,
                createdAt: true,
                content: true,
            },
        });
        // 5. Pending notifications count
        const pendingCount = await prisma_1.prisma.chatMonitorLog.count({
            where: { status: 'PENDING_NOTIFICATION' },
        });
        res.json({
            envCheck,
            statusCounts: statusCounts.map((s) => ({ status: s.status, count: s._count })),
            tenantConfigs: configs.map((c) => ({
                tenantId: c.tenantId.substring(0, 8),
                isActive: c.isActive,
                hasTelegram: !!c.telegramChatId,
                telegramChatId: c.telegramChatId || 'NOT SET',
                hasWhatsApp: !!c.phoneNumber,
                hasEmail: !!c.notificationEmail,
            })),
            pendingNotifications: pendingCount,
            recentBatchLogs: recentBatchLogs.map((l) => ({
                id: l.id.substring(0, 8),
                status: l.status,
                sentTo: l.sentTo,
                source: l.captureSource,
                keyword: l.detectedKeyword,
                createdAt: l.createdAt,
                content: (l.content || '').substring(0, 80),
            })),
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ── Reprocess: retry PENDING/FAILED notifications ──
router.post('/internal/reprocess-notifications', authenticateWorker, async (req, res) => {
    try {
        const { NotificationService } = await Promise.resolve().then(() => __importStar(require('../services/monitoring/notification.service')));
        // Reset FAILED back to PENDING_NOTIFICATION so they get reprocessed
        const resetResult = await prisma_1.prisma.chatMonitorLog.updateMany({
            where: { status: { in: ['FAILED', 'NO_CHANNEL'] } },
            data: { status: 'PENDING_NOTIFICATION' },
        });
        // Now process all pending
        await NotificationService.processPendingNotifications();
        const remaining = await prisma_1.prisma.chatMonitorLog.count({
            where: { status: 'PENDING_NOTIFICATION' },
        });
        res.json({
            success: true,
            resetCount: resetResult.count,
            remainingPending: remaining,
            message: `Reset ${resetResult.count} failed notifications and reprocessed. ${remaining} still pending.`,
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ── Test Fetch BLL ──
router.get('/internal/test-bll-fetch', authenticateWorker, async (req, res) => {
    try {
        const { processId, tenantId, param1 } = req.query;
        const { BatchPlatformMonitor, BATCH_PLATFORMS } = await Promise.resolve().then(() => __importStar(require('../services/monitoring/batch-platform-monitor.service')));
        const { IngestService } = await Promise.resolve().then(() => __importStar(require('../services/monitoring/ingest.service')));
        const platform = BATCH_PLATFORMS.find(p => p.id === 'bll');
        if (!platform)
            return res.status(500).json({ error: 'Platform not found' });
        const messages = await BatchPlatformMonitor.fetchAllMessages(param1, platform);
        let result = null;
        let dedupErrors = null;
        if (messages.length > 0) {
            try {
                result = await IngestService.ingestMessages(prisma_1.prisma, {
                    processId: processId,
                    tenantId: tenantId,
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
            }
            catch (error) {
                dedupErrors = error.message;
            }
        }
        res.json({
            param1,
            fetchedMsgCount: messages.length,
            samples: messages.slice(0, 2),
            ingestResult: result,
            ingestError: dedupErrors,
        });
    }
    catch (error) {
        (0, errorHandler_1.handleApiError)(res, error, 'chat-monitor-test');
    }
});
// ── Persist M2A certame_id link (worker write-back for stable matching) ──
// Called by M2A Watcher after a successful fuzzy-match to persist the canonical
// certame URL in the process link field. Subsequent runs use Strategy 1 (exact match).
router.patch('/internal/sessions/:processId/link', authenticateWorker, async (req, res) => {
    try {
        const { processId } = req.params;
        const { certameId, certameUrl, link } = req.body;
        if (!certameId && !certameUrl && !link) {
            return res.status(400).json({ error: 'certameId, certameUrl, or link required' });
        }
        // Verify process exists
        const process = await prisma_1.prisma.biddingProcess.findUnique({
            where: { id: processId },
            select: { id: true, link: true, tenantId: true },
        });
        if (!process) {
            return res.status(404).json({ error: 'Process not found' });
        }
        // ── CASE 1: Generic link update (ComprasNet discovery write-back) ──
        if (link && !certameId && !certameUrl) {
            const currentLink = process.link || '';
            // Append discovered ComprasNet URL to existing links (preserve PNCP link)
            if (currentLink.includes(link)) {
                return res.json({ success: true, updated: false, reason: 'link already present' });
            }
            const newLink = currentLink ? `${link}, ${currentLink}` : link;
            await prisma_1.prisma.biddingProcess.update({
                where: { id: processId },
                data: { link: newLink },
            });
            logger_1.logger.info(`[Worker Discovery] Link updated for ${processId.substring(0, 8)} → ${link.substring(0, 60)}`);
            return res.json({ success: true, updated: true, newLink });
        }
        // ── CASE 2: M2A certame write-back (legacy) ──
        // Build canonical M2A certame URL if only certameId was provided
        const canonicalUrl = certameUrl ||
            `http://precodereferencia.m2atecnologia.com.br/fornecedores/contratacao/contratacao_fornecedor/pregao_eletronico/lei_14133/detalhes/certame/${certameId}/`;
        // Only update if link doesn't already contain this certame ID (idempotent)
        const currentLink = process.link || '';
        if (certameId && currentLink.includes(`certame/${certameId}`)) {
            return res.json({ success: true, updated: false, reason: 'link already contains certame_id' });
        }
        await prisma_1.prisma.biddingProcess.update({
            where: { id: processId },
            data: { link: canonicalUrl },
        });
        logger_1.logger.info(`[Worker M2A] Link updated for ${processId.substring(0, 8)} → certame/${certameId}`);
        res.json({ success: true, updated: true, newLink: canonicalUrl });
    }
    catch (error) {
        logger_1.logger.error('[Worker Link] Error updating link:', error.message);
        (0, errorHandler_1.handleApiError)(res, error, 'update-process-link');
    }
});
// ── Purge chat monitor logs for a specific process (admin cleanup) ──
// Used to clean up data from incorrect certame matches or test data.
router.delete('/internal/sessions/:processId/logs', authenticateWorker, async (req, res) => {
    try {
        const { processId } = req.params;
        const result = await prisma_1.prisma.chatMonitorLog.deleteMany({
            where: { biddingProcessId: processId },
        });
        logger_1.logger.info(`[Admin] Purged ${result.count} chat logs for process ${processId.substring(0, 8)}`);
        res.json({ success: true, deletedCount: result.count });
    }
    catch (error) {
        logger_1.logger.error('[Admin] Error purging logs:', error.message);
        (0, errorHandler_1.handleApiError)(res, error, 'purge-logs');
    }
});
// Receives messages from local ComprasNet / BBMNet Watcher
router.post('/ingest', auth_1.authenticateToken, async (req, res) => {
    try {
        const { processId, messages } = req.body;
        const tenantId = req.user.tenantId;
        if (!processId || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'processId and messages[] required' });
        }
        // Verify process belongs to tenant
        const processRecord = await prisma_1.prisma.biddingProcess.findFirst({
            where: { id: processId, tenantId }
        });
        if (!processRecord) {
            return res.status(404).json({ error: 'Process not found or not yours' });
        }
        const result = await ingest_service_1.IngestService.ingestMessages(prisma_1.prisma, {
            processId, tenantId, messages, captureSource: 'local-watcher'
        });
        logger_1.logger.info(`[Ingest] ${result.created} msgs saved for process ${processId.substring(0, 8)}... (${result.alerts} alerts)`);
        res.json(result);
    }
    catch (error) {
        logger_1.logger.error('[Ingest] Error:', error.message);
        (0, errorHandler_1.handleApiError)(res, error, 'ingest-messages');
    }
});
exports.default = router;
