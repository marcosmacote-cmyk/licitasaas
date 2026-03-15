"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pncpMonitor = exports.PncpMonitorService = void 0;
const prisma_1 = require("../../lib/prisma");
const axios_1 = __importDefault(require("axios"));
const notification_service_1 = require("./notification.service");
// ── Helpers ──
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/**
 * Faz uma requisição HTTP GET com retry e backoff exponencial.
 * Tenta até `maxRetries` vezes, dobrando o tempo de espera a cada falha.
 */
async function fetchWithRetry(url, maxRetries = 3, initialDelayMs = 1000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios_1.default.get(url, { timeout: 15000 });
            return response;
        }
        catch (error) {
            lastError = error;
            const isRetryable = !error.response || error.response.status >= 500 || error.code === 'ECONNABORTED';
            if (!isRetryable || attempt === maxRetries) {
                throw error;
            }
            const delay = initialDelayMs * Math.pow(2, attempt - 1); // 1s, 2s, 4s
            console.warn(`[PncpMonitor] ⚠️ Tentativa ${attempt}/${maxRetries} falhou (${error.message}). Retentando em ${delay}ms...`);
            await sleep(delay);
        }
    }
    throw lastError;
}
// ── Service ──
class PncpMonitorService {
    constructor() {
        this.isProcessing = false;
        this.lastPollTime = null;
        this.lastPollStatus = null;
        this.processedCount = 0;
        this.alertsDetected = 0;
        this.consecutiveFailures = new Map();
        console.log('[PncpMonitor] Service initialized.');
    }
    async startPolling(intervalMinutes = 5) {
        console.log(`[PncpMonitor] Starting polling every ${intervalMinutes} minutes.`);
        setInterval(() => this.pollMonitoredProcesses(), intervalMinutes * 60 * 1000);
        // Priming run
        this.pollMonitoredProcesses();
    }
    /** Retorna status de saúde do monitor (usado pela API) */
    getHealthStatus() {
        return {
            isProcessing: this.isProcessing,
            lastPollTime: this.lastPollTime?.toISOString() || null,
            lastPollStatus: this.lastPollStatus,
            processedCount: this.processedCount,
            alertsDetected: this.alertsDetected,
        };
    }
    async pollMonitoredProcesses() {
        if (this.isProcessing)
            return;
        this.isProcessing = true;
        this.alertsDetected = 0;
        try {
            console.log('[PncpMonitor] Polling started...');
            // Get all monitored processes
            const monitoredProcesses = await prisma_1.prisma.biddingProcess.findMany({
                where: { isMonitored: true }
            });
            this.processedCount = monitoredProcesses.length;
            console.log(`[PncpMonitor] Found ${monitoredProcesses.length} monitored processes.`);
            for (const process of monitoredProcesses) {
                await this.checkProcessMessages(process);
            }
            // After checking messages, process any pending notifications
            await notification_service_1.NotificationService.processPendingNotifications();
            this.lastPollStatus = 'success';
        }
        catch (error) {
            console.error('[PncpMonitor] Polling error:', error);
            this.lastPollStatus = 'error';
        }
        finally {
            this.isProcessing = false;
            this.lastPollTime = new Date();
            console.log(`[PncpMonitor] Polling cycle finished. Alerts: ${this.alertsDetected}`);
        }
    }
    async checkProcessMessages(process) {
        const shortTitle = process.title?.substring(0, 55) || process.id;
        try {
            // Try pncpLink first (preserved PNCP URL), then fall back to link
            const urlToMatch = process.pncpLink || process.link || '';
            const pncpMatch = urlToMatch.match(/editais\/(\d+)\/(\d+)\/(\d+)/);
            if (!pncpMatch) {
                console.log(`[PncpMonitor] ⏭️ "${shortTitle}" — nenhum link PNCP válido. pncpLink: "${process.pncpLink || 'NULL'}", link: "${process.link || 'NULL'}"`);
                return;
            }
            // Auto-backfill pncpLink if it was found in link field
            if (!process.pncpLink && process.link?.includes('editais')) {
                await prisma_1.prisma.biddingProcess.update({
                    where: { id: process.id },
                    data: { pncpLink: process.link }
                }).catch(() => { });
                console.log(`[PncpMonitor] 📌 Auto-preenchido pncpLink para "${shortTitle}"`);
            }
            const [_, cnpj, ano, sequencial] = pncpMatch;
            console.log(`[PncpMonitor] 🔍 Verificando "${shortTitle}" — CNPJ: ${cnpj}, Ano: ${ano}, Seq: ${sequencial}`);
            // Fetch messages with retry and backoff
            const allMessages = [];
            let page = 1;
            const pageSize = 100;
            let hasMore = true;
            while (hasMore) {
                const apiUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/mensagens?pagina=${page}&tamanhoPagina=${pageSize}`;
                try {
                    const response = await fetchWithRetry(apiUrl);
                    const pageData = response.data?.data || [];
                    if (pageData.length === 0) {
                        hasMore = false;
                    }
                    else {
                        allMessages.push(...pageData);
                        // Only paginate if we got a full page (there might be more)
                        hasMore = pageData.length === pageSize && page < 5; // Max 5 pages (500 msgs) safety limit
                        page++;
                    }
                    // Reset failure counter on success
                    this.consecutiveFailures.delete(process.id);
                }
                catch (fetchErr) {
                    const status = fetchErr?.response?.status;
                    // 404 = endpoint doesn't exist for this process (expected for many process types)
                    if (status === 404) {
                        const failures = (this.consecutiveFailures.get(process.id) || 0) + 1;
                        this.consecutiveFailures.set(process.id, failures);
                        // Only log on first occurrence, then silently skip
                        if (failures === 1) {
                            console.warn(`[PncpMonitor] ⚠️ "${shortTitle}" — 404 no endpoint de mensagens. Será ignorado.`);
                        }
                        // After 3 consecutive 404s, auto-disable monitoring to stop wasting requests
                        if (failures >= 3) {
                            console.warn(`[PncpMonitor] 🔕 Auto-desativando monitoramento para "${shortTitle}" (3 falhas 404 consecutivas).`);
                            await prisma_1.prisma.biddingProcess.update({
                                where: { id: process.id },
                                data: { isMonitored: false }
                            }).catch(() => { });
                            this.consecutiveFailures.delete(process.id);
                        }
                        return;
                    }
                    // Other errors (500, timeout, etc.) — log as error
                    console.error(`[PncpMonitor] ❌ Erro ao verificar "${shortTitle}": ${fetchErr.message}`);
                    return;
                }
            }
            if (allMessages.length === 0) {
                console.log(`[PncpMonitor] 📭 "${shortTitle}" — PNCP retornou 0 mensagens.`);
                return;
            }
            console.log(`[PncpMonitor] 📨 "${shortTitle}" — ${allMessages.length} mensagens obtidas da API PNCP.`);
            const config = await prisma_1.prisma.chatMonitorConfig.findUnique({
                where: { tenantId: process.tenantId }
            });
            if (!config || !config.isActive) {
                console.log(`[PncpMonitor] ⏸️ "${shortTitle}" — Config desativada ou inexistente. Skipping.`);
                return;
            }
            const keywords = config.keywords?.split(',').map(k => k.trim().toLowerCase()) || [];
            // Fetch all already-logged message IDs for this process in ONE query (eliminates N+1)
            const existingLogs = await prisma_1.prisma.chatMonitorLog.findMany({
                where: { biddingProcessId: process.id },
                select: { messageId: true }
            });
            const loggedMessageIds = new Set(existingLogs.map(l => l.messageId));
            let newCount = 0;
            for (const msg of allMessages) {
                const msgId = String(msg.id || msg.numero);
                const content = msg.conteudo?.toLowerCase() || '';
                if (loggedMessageIds.has(msgId))
                    continue;
                const detectedKeyword = keywords.find(k => content.includes(k)) || null;
                if (detectedKeyword) {
                    console.log(`[PncpMonitor] 🚨 KEYWORD "${detectedKeyword}" in "${shortTitle}"`);
                    this.alertsDetected++;
                }
                // Capture ALL messages (not just keyword matches)
                await prisma_1.prisma.chatMonitorLog.create({
                    data: {
                        tenantId: process.tenantId,
                        biddingProcessId: process.id,
                        messageId: msgId,
                        content: msg.conteudo || '',
                        authorType: msg.nomeUsuario || msg.tipo || 'Sistema',
                        detectedKeyword: detectedKeyword,
                        status: detectedKeyword ? 'PENDING_NOTIFICATION' : 'CAPTURED'
                    }
                });
                loggedMessageIds.add(msgId);
                newCount++;
            }
            console.log(`[PncpMonitor] ✅ "${shortTitle}" — ${newCount} novas mensagens capturadas (${existingLogs.length} já existiam).`);
        }
        catch (error) {
            console.error(`[PncpMonitor] ❌ Error checking "${shortTitle}":`, error.message);
        }
    }
}
exports.PncpMonitorService = PncpMonitorService;
exports.pncpMonitor = new PncpMonitorService();
