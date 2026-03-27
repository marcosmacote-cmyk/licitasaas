import axios from 'axios';
import { prisma } from '../../lib/prisma';
import { Resend } from 'resend';

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

    console.log(`[Notification] Sending Telegram to ${chatId} for tenant ${tenantId} (${message.length} chars)`);

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const MAX_LEN = 4000; // Telegram limit is 4096, leave margin

        // Split long messages into chunks
        if (message.length > MAX_LEN) {
          const chunks = this.splitMessage(message, MAX_LEN);
          console.log(`[Notification] Mensagem dividida em ${chunks.length} partes (total: ${message.length} chars)`);
          for (const chunk of chunks) {
            await axios.post(url, {
              chat_id: chatId,
              text: chunk,
              parse_mode: 'HTML'
            }, { timeout: 15000 });
            // Small delay between messages to avoid rate limiting
            await new Promise(r => setTimeout(r, 500));
          }
        } else {
          await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
          }, { timeout: 15000 });
        }
        console.log(`[Notification] ✅ Telegram enviado com sucesso para ${chatId}`);
        return true;
      } catch (error: any) {
        const detail = error.response?.data?.description || error.message;
        console.error(`[Notification] ❌ Telegram falhou para ${chatId}: ${detail}`);
        // If HTML parse error, retry without parse_mode
        if (detail?.includes('parse') || detail?.includes('HTML')) {
          try {
            const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
            const plainMsg = message.replace(/<[^>]*>/g, '');
            const truncated = plainMsg.length > 4000 ? plainMsg.substring(0, 3997) + '...' : plainMsg;
            await axios.post(url, { chat_id: chatId, text: truncated }, { timeout: 15000 });
            console.log(`[Notification] ✅ Telegram enviado (fallback plain text) para ${chatId}`);
            return true;
          } catch (e2: any) {
            console.error(`[Notification] ❌ Telegram fallback também falhou:`, e2.response?.data?.description || e2.message);
          }
        }
        return false;
      }
    } else {
      console.log(`[Notification][MOCK] Telegram message para ${chatId}: ${message.substring(0, 80)}...`);
      return true; // Mock success
    }
  }

  /**
   * Divide uma mensagem longa em chunks respeitando quebras de linha
   */
  private static splitMessage(message: string, maxLen: number): string[] {
    const chunks: string[] = [];
    let remaining = message;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      // Find a good split point (double newline or single newline)
      let splitAt = remaining.lastIndexOf('\n\n', maxLen);
      if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf('\n', maxLen);
      if (splitAt < maxLen * 0.3) splitAt = maxLen; // Force split
      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).replace(/^\n+/, '');
    }
    return chunks;
  }

  /**
   * Envia uma mensagem via Email usando Resend SDK.
   * Retorna true se enviou com sucesso, false caso contrário.
   */
  static async sendEmail(tenantId: string, toEmail: string, subject: string, htmlMessage: string): Promise<boolean> {
    if (!toEmail) return false;

    console.log(`[Notification] Sending Email to ${toEmail} for tenant ${tenantId}`);

    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      try {
        const resend = new Resend(resendApiKey);
        await resend.emails.send({
          from: 'LicitaSaaS Alertas <alertas@licitasaas.com>',
          to: toEmail,
          subject: subject,
          html: htmlMessage,
        });
        console.log(`[Notification] ✅ Email enviado com sucesso para ${toEmail}`);
        return true;
      } catch (error: any) {
        console.error(`[Notification] ❌ Email falhou para ${toEmail}:`, error.message);
        return false;
      }
    } else {
      console.log(`[Notification][MOCK] Email message para ${toEmail}: subject="${subject}"`);
      return true; // Mock success
    }
  }

  /**
   * Envia uma mensagem de teste para validar a configuração.
   * Retorna um objeto com o resultado de cada canal.
   */
  static async sendTestNotification(tenantId: string): Promise<{ telegram: boolean | null; whatsapp: boolean | null; email: boolean | null }> {
    const config = await prisma.chatMonitorConfig.findUnique({
      where: { tenantId }
    });

    if (!config) {
      return { telegram: null, whatsapp: null, email: null };
    }

    const testMessage = `✅ <b>TESTE DE NOTIFICAÇÃO</b>\n\n` +
                        `<b>Status:</b> Sua configuração está funcionando corretamente!\n` +
                        `<b>Sistema:</b> LicitaSaaS - Alertas\n\n` +
                        `<i>Esta é uma mensagem de teste. Pode ignorá-la com segurança.</i>`;

    const results = { telegram: null as boolean | null, whatsapp: null as boolean | null, email: null as boolean | null };

    if (config.telegramChatId) {
      results.telegram = await this.sendTelegram(tenantId, config.telegramChatId, testMessage);
    }

    if (config.phoneNumber) {
      results.whatsapp = await this.sendWhatsApp(tenantId, config.phoneNumber, testMessage.replace(/<[^>]*>/g, ''));
    }

    // Test email to all active users
    try {
      const activeUsers = await prisma.user.findMany({ where: { tenantId, isActive: true }, select: { email: true } });
      if (activeUsers.length > 0) {
        const htmlTestMessage = `
          <div style="font-family: Arial, sans-serif; color: #333; max-width: 500px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #2563eb;">Teste de Notificação</h2>
            <p>Sua configuração de e-mail está funcionando corretamente.</p>
            <p style="font-size: 12px; color: #9ca3af; margin-top: 24px;">LicitaSaaS — Mensagem de teste automática.</p>
          </div>`;
        let emailOk = true;
        for (const user of activeUsers) {
          if (user.email) {
            const sent = await this.sendEmail(tenantId, user.email, 'LicitaSaaS: Teste de Notificação', htmlTestMessage);
            if (!sent) emailOk = false;
          }
        }
        results.email = emailOk;
      }
    } catch {
      results.email = false;
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
