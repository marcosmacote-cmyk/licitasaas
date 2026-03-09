import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { NotificationService } from './notification.service';

const prisma = new PrismaClient();

export class PncpMonitorService {
  private isProcessing = false;

  constructor() {
    console.log('[PncpMonitor] Service initialized.');
  }

  async startPolling(intervalMinutes: number = 5) {
    console.log(`[PncpMonitor] Starting polling every ${intervalMinutes} minutes.`);
    setInterval(() => this.pollMonitoredProcesses(), intervalMinutes * 60 * 1000);
    // Priming run
    this.pollMonitoredProcesses();
  }

  private async pollMonitoredProcesses() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      console.log('[PncpMonitor] Polling started...');
      
      // Get all monitored processes
      const monitoredProcesses = await prisma.biddingProcess.findMany({
        where: { isMonitored: true }
      });

      console.log(`[PncpMonitor] Found ${monitoredProcesses.length} monitored processes.`);

      for (const process of monitoredProcesses) {
        await this.checkProcessMessages(process);
      }

      // After checking messages, process any pending notifications
      await NotificationService.processPendingNotifications();

    } catch (error) {
      console.error('[PncpMonitor] Polling error:', error);
    } finally {
      this.isProcessing = false;
      console.log('[PncpMonitor] Polling cycle finished.');
    }
  }

  private async checkProcessMessages(process: any) {
    try {
      // Extract CNPJ and sequential number from link if possible
      const pncpMatch = process.link?.match(/editais\/(\d+)\/(\d+)\/(\d+)/);
      if (!pncpMatch) {
        return;
      }

      const [_, cnpj, ano, sequencial] = pncpMatch;
      const apiUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/mensagens?pagina=1&tamanhoPagina=100`;

      const response = await axios.get(apiUrl, { timeout: 10000 });
      const messages = response.data?.data || [];
      
      if (messages.length === 0) return;

      const config = await prisma.chatMonitorConfig.findUnique({
        where: { tenantId: process.tenantId }
      });

      if (!config || !config.isActive) return;

      const keywords = config.keywords?.split(',').map(k => k.trim().toLowerCase()) || [];
      
      for (const msg of messages) {
        const msgId = String(msg.id || msg.numero);
        const content = msg.conteudo?.toLowerCase() || '';

        const alreadyLogged = await prisma.chatMonitorLog.findFirst({
          where: { 
            biddingProcessId: process.id,
            messageId: msgId
          }
        });

        if (alreadyLogged) continue;

        const detectedKeyword = keywords.find(k => content.includes(k));

        if (detectedKeyword) {
          console.log(`[PncpMonitor] 🚨 KEYWORD DETECTED! "${detectedKeyword}" in process ${process.title}`);
          
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
        }
      }

    } catch (error: any) {
      console.error(`[PncpMonitor] Error checking process ${process.id}:`, error.message);
    }
  }
}

export const pncpMonitor = new PncpMonitorService();
