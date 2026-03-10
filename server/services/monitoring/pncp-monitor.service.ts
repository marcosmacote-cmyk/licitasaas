import { prisma } from '../../lib/prisma';
import axios from 'axios';
import { NotificationService } from './notification.service';

// ── Helpers ──
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Faz uma requisição HTTP GET com retry e backoff exponencial.
 * Tenta até `maxRetries` vezes, dobrando o tempo de espera a cada falha.
 */
async function fetchWithRetry(url: string, maxRetries = 3, initialDelayMs = 1000): Promise<any> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, { timeout: 15000 });
      return response;
    } catch (error: any) {
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
export class PncpMonitorService {
  private isProcessing = false;
  private lastPollTime: Date | null = null;
  private lastPollStatus: 'success' | 'error' | null = null;
  private processedCount = 0;
  private alertsDetected = 0;

  constructor() {
    console.log('[PncpMonitor] Service initialized.');
  }

  async startPolling(intervalMinutes: number = 5) {
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

  private async pollMonitoredProcesses() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.alertsDetected = 0;

    try {
      console.log('[PncpMonitor] Polling started...');
      
      // Get all monitored processes
      const monitoredProcesses = await prisma.biddingProcess.findMany({
        where: { isMonitored: true }
      });

      this.processedCount = monitoredProcesses.length;
      console.log(`[PncpMonitor] Found ${monitoredProcesses.length} monitored processes.`);

      for (const process of monitoredProcesses) {
        await this.checkProcessMessages(process);
      }

      // After checking messages, process any pending notifications
      await NotificationService.processPendingNotifications();

      this.lastPollStatus = 'success';
    } catch (error) {
      console.error('[PncpMonitor] Polling error:', error);
      this.lastPollStatus = 'error';
    } finally {
      this.isProcessing = false;
      this.lastPollTime = new Date();
      console.log(`[PncpMonitor] Polling cycle finished. Alerts: ${this.alertsDetected}`);
    }
  }

  private consecutiveFailures: Map<string, number> = new Map();

  private async checkProcessMessages(process: any) {
    try {
      // Extract CNPJ and sequential number from link if possible
      const pncpMatch = process.link?.match(/editais\/(\d+)\/(\d+)\/(\d+)/);
      if (!pncpMatch) {
        return;
      }

      const [_, cnpj, ano, sequencial] = pncpMatch;
      
      // Fetch messages with retry and backoff
      const allMessages: any[] = [];
      let page = 1;
      const pageSize = 100;
      let hasMore = true;

      while (hasMore) {
        const apiUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/mensagens?pagina=${page}&tamanhoPagina=${pageSize}`;
        
        try {
          const response = await fetchWithRetry(apiUrl);
          const pageData = (response.data as any)?.data || [];
          
          if (pageData.length === 0) {
            hasMore = false;
          } else {
            allMessages.push(...pageData);
            // Only paginate if we got a full page (there might be more)
            hasMore = pageData.length === pageSize && page < 5; // Max 5 pages (500 msgs) safety limit
            page++;
          }
          // Reset failure counter on success
          this.consecutiveFailures.delete(process.id);
        } catch (fetchErr: any) {
          const status = fetchErr?.response?.status;
          
          // 404 = endpoint doesn't exist for this process (expected for many process types)
          if (status === 404) {
            const failures = (this.consecutiveFailures.get(process.id) || 0) + 1;
            this.consecutiveFailures.set(process.id, failures);
            
            // Only log on first occurrence, then silently skip
            if (failures === 1) {
              console.warn(`[PncpMonitor] ⚠️ Processo "${process.title.substring(0, 60)}..." não possui endpoint de mensagens no PNCP (404). Será ignorado silenciosamente.`);
            }
            
            // After 3 consecutive 404s, auto-disable monitoring to stop wasting requests
            if (failures >= 3) {
              console.warn(`[PncpMonitor] 🔕 Auto-desativando monitoramento para "${process.title.substring(0, 50)}..." (3 falhas 404 consecutivas).`);
              await prisma.biddingProcess.update({
                where: { id: process.id },
                data: { isMonitored: false }
              }).catch(() => {});
              this.consecutiveFailures.delete(process.id);
            }
            return;
          }
          
          // Other errors (500, timeout, etc.) — log as error
          console.error(`[PncpMonitor] ❌ Erro ao verificar processo "${process.title.substring(0, 60)}...": ${fetchErr.message}`);
          return;
        }
      }
      
      if (allMessages.length === 0) return;

      const config = await prisma.chatMonitorConfig.findUnique({
        where: { tenantId: process.tenantId }
      });

      if (!config || !config.isActive) return;

      const keywords = config.keywords?.split(',').map(k => k.trim().toLowerCase()) || [];

      // Fetch all already-logged message IDs for this process in ONE query (eliminates N+1)
      const existingLogs = await prisma.chatMonitorLog.findMany({
        where: { biddingProcessId: process.id },
        select: { messageId: true }
      });
      const loggedMessageIds = new Set(existingLogs.map(l => l.messageId));
      
      for (const msg of allMessages) {
        const msgId = String(msg.id || msg.numero);
        const content = msg.conteudo?.toLowerCase() || '';

        if (loggedMessageIds.has(msgId)) continue;

        const detectedKeyword = keywords.find(k => content.includes(k));

        if (detectedKeyword) {
          console.log(`[PncpMonitor] 🚨 KEYWORD DETECTED! "${detectedKeyword}" in process ${process.title}`);
          this.alertsDetected++;
          
          await prisma.chatMonitorLog.create({
            data: {
              tenantId: process.tenantId,
              biddingProcessId: process.id,
              messageId: msgId,
              content: msg.conteudo,
              detectedKeyword: detectedKeyword,
              status: 'PENDING_NOTIFICATION'
            }
          });
          // Add to set to avoid duplicate creation within the same cycle
          loggedMessageIds.add(msgId);
        }
      }

    } catch (error: any) {
      console.error(`[PncpMonitor] Error checking process ${process.id}:`, error.message);
    }
  }
}

export const pncpMonitor = new PncpMonitorService();
