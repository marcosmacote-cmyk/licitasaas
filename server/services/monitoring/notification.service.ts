import axios from 'axios';
import { prisma } from '../../lib/prisma';

export class NotificationService {
  /**
   * Envia uma mensagem via WhatsApp usando a API configurada (através do telefone do tenant)
   */
  static async sendWhatsApp(tenantId: string, phone: string, message: string) {
    if (!phone) return;
    
    console.log(`[Notification] Sending WhatsApp to ${phone} for tenant ${tenantId}`);
    
    // Aqui seria a integração com a API de WhatsApp (ex: Evolution API, WPPConnect, etc)
    // Para o LicitaSaaS, vamos usar um log simulando ou uma URL de webhook se disponível no .env
    const whatsappApiUrl = process.env.WHATSAPP_API_URL;
    const whatsappApiToken = process.env.WHATSAPP_API_TOKEN;

    if (whatsappApiUrl && whatsappApiToken) {
      try {
        await axios.post(whatsappApiUrl, {
          number: phone.replace(/\D/g, ''),
          message: message
        }, {
          headers: { 'apikey': whatsappApiToken }
        });
      } catch (error: any) {
        console.error(`[Notification] WhatsApp failed:`, error.message);
      }
    } else {
      console.log(`[Notification][MOCK] WhatsApp message: ${message}`);
    }
  }

  /**
   * Envia uma mensagem via Telegram usando o Chat ID configurado
   */
  static async sendTelegram(tenantId: string, chatId: string, message: string) {
    if (!chatId) return;

    console.log(`[Notification] Sending Telegram to ${chatId} for tenant ${tenantId}`);

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        await axios.post(url, {
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML'
        });
      } catch (error: any) {
        console.error(`[Notification] Telegram failed:`, error.message);
      }
    } else {
      console.log(`[Notification][MOCK] Telegram message: ${message}`);
    }
  }

  /**
   * Processa notificações pendentes no banco de dados
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

      for (const log of pendingLogs) {
        const config = (log.tenant as any).chatMonitorConfig;
        if (!config || !config.isActive) continue;

        const message = `🚨 <b>ALERTA DE CHAT - PNCP</b>\n\n` +
                        `<b>Processo:</b> ${log.biddingProcess.title}\n` +
                        `<b>Palavra-chave:</b> ${log.detectedKeyword}\n` +
                        `<b>Mensagem:</b> ${log.content}\n\n` +
                        `<i>Verifique agora no LicitaSaaS!</i>`;

        // WhatsApp
        if (config.phoneNumber) {
          await this.sendWhatsApp(log.tenantId, config.phoneNumber, message.replace(/<[^>]*>/g, ''));
        }

        // Telegram
        if (config.telegramChatId) {
          await this.sendTelegram(log.tenantId, config.telegramChatId, message);
        }

        // Atualiza status do log
        await prisma.chatMonitorLog.update({
          where: { id: log.id },
          data: { status: 'NOTIFIED' }
        });
      }
    } catch (error) {
      console.error(`[Notification] Process error:`, error);
    }
  }
}
