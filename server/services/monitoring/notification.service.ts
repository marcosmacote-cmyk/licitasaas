import axios from 'axios';
import { prisma } from '../../lib/prisma';

export class NotificationService {
  /**
   * Envia uma mensagem via WhatsApp usando a API configurada.
   * Retorna true se enviou com sucesso, false caso contrário.
   */
  static async sendWhatsApp(tenantId: string, phone: string, message: string): Promise<boolean> {
    if (!phone) return false;
    
    console.log(`[Notification] Sending WhatsApp to ${phone} for tenant ${tenantId}`);
    
    const whatsappApiUrl = process.env.WHATSAPP_API_URL;
    const whatsappApiToken = process.env.WHATSAPP_API_TOKEN;

    if (whatsappApiUrl && whatsappApiToken) {
      try {
        await axios.post(whatsappApiUrl, {
          number: phone.replace(/\D/g, ''),
          message: message
        }, {
          headers: { 'apikey': whatsappApiToken },
          timeout: 10000
        });
        console.log(`[Notification] ✅ WhatsApp enviado com sucesso para ${phone}`);
        return true;
      } catch (error: any) {
        console.error(`[Notification] ❌ WhatsApp falhou para ${phone}:`, error.message);
        return false;
      }
    } else {
      console.log(`[Notification][MOCK] WhatsApp message para ${phone}: ${message.substring(0, 80)}...`);
      return true; // Mock success
    }
  }

  /**
   * Envia uma mensagem via Telegram usando o Chat ID configurado.
   * Retorna true se enviou com sucesso, false caso contrário.
   */
  static async sendTelegram(tenantId: string, chatId: string, message: string): Promise<boolean> {
    if (!chatId) return false;

    console.log(`[Notification] Sending Telegram to ${chatId} for tenant ${tenantId}`);

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        await axios.post(url, {
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML'
        }, { timeout: 10000 });
        console.log(`[Notification] ✅ Telegram enviado com sucesso para ${chatId}`);
        return true;
      } catch (error: any) {
        console.error(`[Notification] ❌ Telegram falhou para ${chatId}:`, error.message);
        return false;
      }
    } else {
      console.log(`[Notification][MOCK] Telegram message para ${chatId}: ${message.substring(0, 80)}...`);
      return true; // Mock success
    }
  }

  /**
   * Envia uma mensagem de teste para validar a configuração.
   * Retorna um objeto com o resultado de cada canal.
   */
  static async sendTestNotification(tenantId: string): Promise<{ telegram: boolean | null; whatsapp: boolean | null }> {
    const config = await prisma.chatMonitorConfig.findUnique({
      where: { tenantId }
    });

    if (!config) {
      return { telegram: null, whatsapp: null };
    }

    const testMessage = `✅ <b>TESTE DE NOTIFICAÇÃO</b>\n\n` +
                        `<b>Status:</b> Sua configuração está funcionando corretamente!\n` +
                        `<b>Sistema:</b> LicitaSaaS - Monitor de Chat PNCP\n\n` +
                        `<i>Esta é uma mensagem de teste. Pode ignorá-la com segurança.</i>`;

    const results = { telegram: null as boolean | null, whatsapp: null as boolean | null };

    if (config.telegramChatId) {
      results.telegram = await this.sendTelegram(tenantId, config.telegramChatId, testMessage);
    }

    if (config.phoneNumber) {
      results.whatsapp = await this.sendWhatsApp(tenantId, config.phoneNumber, testMessage.replace(/<[^>]*>/g, ''));
    }

    return results;
  }

  /**
   * Processa notificações pendentes no banco de dados.
   * Agora rastreia para quem enviou (sentTo) e diferencia status SENT/FAILED.
   */
  static async processPendingNotifications() {
    try {
      const pendingLogs = await prisma.chatMonitorLog.findMany({
        where: { status: 'PENDING_NOTIFICATION' },
        include: { 
          biddingProcess: true,
          tenant: {
            include: {
              chatMonitorConfig: true
            }
          }
        }
      });

      if (pendingLogs.length > 0) {
        console.log(`[Notification] Processando ${pendingLogs.length} notificações pendentes...`);
      }

      for (const log of pendingLogs) {
        const config = (log.tenant as any).chatMonitorConfig;
        if (!config || !config.isActive) {
          // Config desativada: marcar como SKIPPED
          await prisma.chatMonitorLog.update({
            where: { id: log.id },
            data: { status: 'SKIPPED' }
          });
          continue;
        }

        const msgTimestamp = (log as any).messageTimestamp;
        const timestampLine = msgTimestamp
          ? `<b>Data/Hora:</b> ${msgTimestamp}\n`
          : `<b>Capturado em:</b> ${new Date(log.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })}\n`;

        // Detect platform name from bidding process link
        const link = (log.biddingProcess.link || '').toLowerCase();
        let platformName = 'PNCP';
        if (link.includes('cnetmobile') || link.includes('comprasnet') || link.includes('comprasgovbr') || link.includes('compras.gov')) {
          platformName = 'ComprasNet';
        } else if (link.includes('bbmnet')) {
          platformName = 'BBMNET';
        } else if (link.includes('bllcompras') || link.includes('bll.org')) {
          platformName = 'BLL Compras';
        } else if (link.includes('bnccompras')) {
          platformName = 'BNC Compras';
        } else if (link.includes('portaldecompraspublicas')) {
          platformName = 'Portal de Compras Públicas';
        } else if (link.includes('licitamaisbrasil')) {
          platformName = 'Licita Mais Brasil';
        } else if (link.includes('licitanet.com.br')) {
          platformName = 'Licitanet';
        } else if (link.includes('m2atecnologia') || link.includes('precodereferencia')) {
          platformName = 'M2A';
        }

        const message = `🚨 <b>ALERTA DE CHAT - ${platformName}</b>\n\n` +
                        `<b>Processo:</b> ${log.biddingProcess.title}\n` +
                        timestampLine +
                        `<b>Palavra-chave:</b> ${log.detectedKeyword}\n` +
                        `<b>Mensagem:</b> ${log.content}\n\n` +
                        `<i>Verifique agora no LicitaSaaS!</i>`;

        const sentChannels: string[] = [];
        let anySuccess = false;

        // WhatsApp
        if (config.phoneNumber) {
          const success = await this.sendWhatsApp(log.tenantId, config.phoneNumber, message.replace(/<[^>]*>/g, ''));
          if (success) {
            sentChannels.push(`whatsapp:${config.phoneNumber}`);
            anySuccess = true;
          }
        }

        // Telegram
        if (config.telegramChatId) {
          const success = await this.sendTelegram(log.tenantId, config.telegramChatId, message);
          if (success) {
            sentChannels.push(`telegram:${config.telegramChatId}`);
            anySuccess = true;
          }
        }

        // Atualiza status do log com rastreabilidade completa
        await prisma.chatMonitorLog.update({
          where: { id: log.id },
          data: { 
            status: anySuccess ? 'SENT' : (sentChannels.length === 0 && !config.phoneNumber && !config.telegramChatId ? 'NO_CHANNEL' : 'FAILED'),
            sentTo: sentChannels.length > 0 ? sentChannels.join(', ') : null
          }
        });

        if (anySuccess) {
          console.log(`[Notification] ✅ Log ${log.id} notificado via: ${sentChannels.join(', ')}`);
        } else {
          console.warn(`[Notification] ⚠️ Log ${log.id}: nenhum canal de notificação entregou com sucesso.`);
        }
      }
    } catch (error) {
      console.error(`[Notification] Process error:`, error);
    }
  }
}
