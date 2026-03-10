import { prisma } from '../../lib/prisma';
import { NotificationService } from './notification.service';
import path from 'path';
import fs from 'fs';

// ── Types (no Playwright imports at module level) ──

interface ComprasGovMessage {
  chaveCompra: {
    idUasgIdentificacao: number;
    idModalidade: number;
    numero: number;
    ano: number;
    numeroUasg: number;
  };
  identificadorItem?: string;
  chaveMensagemNaOrigem: string;
  texto: string;
  categoria: string;
  dataHora: string;
  tipoRemetente: string;
  identificadorRemetente?: string;
  identificadorDestinatario?: string;
}

interface WatcherSession {
  processId: string;
  compraId: string;
  page: any; // Playwright Page (dynamically loaded)
  isActive: boolean;
  lastHeartbeat: Date;
  messagesLogged: Set<string>;
}

// ── Constants ──

const COMPRASNET_CHAT_URL_PATTERN = /comprasnet-mensagem\/v2\/chat\//;
const COMPRASNET_BASE = 'https://cnetmobile.estaleiro.serpro.gov.br';
const SESSION_STATE_DIR = path.join(process.cwd(), 'server', '.playwright-sessions');

const CATEGORY_MAP: Record<string, string> = {
  '8': 'convocacao',
  '9': 'comunicado_pregoeiro',
  '13': 'encerramento_prazo',
  '14': 'mensagem_participante',
};

const SENDER_TYPE_MAP: Record<string, string> = {
  '0': 'sistema',
  '1': 'fornecedor',
  '3': 'pregoeiro',
};

// ── Lazy Playwright loader ──

let _playwright: any = null;

async function getPlaywright() {
  if (_playwright) return _playwright;
  try {
    _playwright = await import('playwright');
    return _playwright;
  } catch (err: any) {
    console.warn('[ComprasnetWatcher] ⚠️ Playwright não está instalado. O monitor de chat do ComprasNet ficará indisponível.');
    console.warn('[ComprasnetWatcher] Para habilitar, execute: npm install playwright');
    return null;
  }
}

// ── Service ──

export class ComprasnetWatcherService {
  private browser: any = null;
  private context: any = null;
  private sessions: Map<string, WatcherSession> = new Map();
  private isLaunched = false;
  private playwrightAvailable: boolean | null = null;

  constructor() {
    console.log('[ComprasnetWatcher] Service initialized.');
    try {
      if (!fs.existsSync(SESSION_STATE_DIR)) {
        fs.mkdirSync(SESSION_STATE_DIR, { recursive: true });
      }
    } catch { /* ignore in read-only environments */ }
  }

  // ─── Public API ───

  /** Returns current watcher status */
  getStatus() {
    return {
      isLaunched: this.isLaunched,
      playwrightAvailable: this.playwrightAvailable,
      activeSessions: Array.from(this.sessions.entries()).map(([id, s]) => ({
        processId: s.processId,
        compraId: s.compraId,
        isActive: s.isActive,
        lastHeartbeat: s.lastHeartbeat.toISOString(),
        messagesLogged: s.messagesLogged.size,
      })),
      hasStoredSession: this.hasStoredSession(),
    };
  }

  /** Launch the browser for manual login */
  async launchForLogin(): Promise<{ success: boolean; message: string }> {
    try {
      const pw = await getPlaywright();
      if (!pw) {
        this.playwrightAvailable = false;
        return { success: false, message: 'Playwright não está instalado no servidor. Este recurso requer Playwright.' };
      }
      this.playwrightAvailable = true;

      if (this.browser) {
        await this.browser.close().catch(() => {});
      }

      console.log('[ComprasnetWatcher] Launching browser for login...');
      this.browser = await pw.chromium.launch({
        headless: false, // Visible for manual login
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      const page = await this.context.newPage();
      await page.goto(`${COMPRASNET_BASE}/comprasnet-web/public/landing`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      this.isLaunched = true;
      console.log('[ComprasnetWatcher] ✅ Browser launched. User should log in manually.');

      // Start a background listener for login completion
      this._waitForLogin(page);

      return { success: true, message: 'Browser aberto. Faça login no Compras.gov.br e volte aqui.' };
    } catch (error: any) {
      console.error('[ComprasnetWatcher] ❌ Failed to launch browser:', error.message);
      return { success: false, message: `Erro ao abrir navegador: ${error.message}` };
    }
  }

  /** Start monitoring a specific process */
  async startMonitoring(processId: string): Promise<{ success: boolean; message: string }> {
    try {
      const pw = await getPlaywright();
      if (!pw) {
        return { success: false, message: 'Playwright não está instalado no servidor.' };
      }

      const process = await prisma.biddingProcess.findUnique({ where: { id: processId } });
      if (!process) {
        return { success: false, message: 'Processo não encontrado.' };
      }

      const compraId = this._buildCompraId(process);
      if (!compraId) {
        return { success: false, message: 'Processo sem UASG/modalidade/número/ano preenchidos. Preencha esses campos para monitorar.' };
      }

      if (this.sessions.has(processId)) {
        return { success: false, message: 'Este processo já está sendo monitorado.' };
      }

      // Ensure browser is running
      if (!this.browser || !this.context) {
        const hasSession = await this._loadStoredSession();
        if (!hasSession) {
          return { success: false, message: 'Nenhuma sessão autenticada. Faça login primeiro (POST /api/chat-watcher/login).' };
        }
      }

      // Open a new page for this process's session
      const page = await this.context!.newPage();

      // Pre-load existing logged message IDs to avoid duplicates
      const existingLogs = await prisma.chatMonitorLog.findMany({
        where: { biddingProcessId: processId },
        select: { messageId: true },
      });
      const messagesLogged = new Set<string>(existingLogs.map((l: any) => l.messageId).filter(Boolean) as string[]);

      const session: WatcherSession = {
        processId,
        compraId,
        page,
        isActive: true,
        lastHeartbeat: new Date(),
        messagesLogged,
      };

      // Set up network interception BEFORE navigating
      this._setupNetworkInterception(session, process);

      // Navigate to the session page
      const sessionUrl = `${COMPRASNET_BASE}/comprasnet-web/private/fornecedor/compras/acompanhamento-compra/${compraId}`;
      console.log(`[ComprasnetWatcher] Navigating to: ${sessionUrl}`);

      await page.goto(sessionUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      this.sessions.set(processId, session);

      // Start heartbeat for this session
      this._startHeartbeat(processId);

      console.log(`[ComprasnetWatcher] ✅ Monitoring started for ${process.title} (compraId: ${compraId})`);
      return { success: true, message: `Monitoramento iniciado para: ${process.title}` };
    } catch (error: any) {
      console.error('[ComprasnetWatcher] ❌ Failed to start monitoring:', error.message);
      return { success: false, message: `Erro ao iniciar monitoramento: ${error.message}` };
    }
  }

  /** Stop monitoring a specific process */
  async stopMonitoring(processId: string): Promise<{ success: boolean; message: string }> {
    const session = this.sessions.get(processId);
    if (!session) {
      return { success: false, message: 'Processo não está sendo monitorado.' };
    }

    session.isActive = false;
    await session.page.close().catch(() => {});
    this.sessions.delete(processId);

    console.log(`[ComprasnetWatcher] ⏹ Monitoring stopped for process ${processId}`);
    return { success: true, message: 'Monitoramento encerrado.' };
  }

  /** Stop everything and close the browser */
  async shutdown(): Promise<void> {
    console.log('[ComprasnetWatcher] Shutting down...');
    for (const [id] of this.sessions) {
      await this.stopMonitoring(id);
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.context = null;
      this.isLaunched = false;
    }
    console.log('[ComprasnetWatcher] ✅ Shutdown complete.');
  }

  // ─── Private Methods ───

  /** Build the ComprasNet compraId from process data */
  private _buildCompraId(process: any): string | null {
    const uasg = process.uasg;
    const mod = process.modalityCode;
    const num = process.processNumber;
    const year = process.processYear;

    if (!uasg || !mod || !num || !year) return null;
    return `${uasg}${String(mod).padStart(2, '0')}${num}${year}`;
  }

  /** Set up network interception to capture chat messages */
  private _setupNetworkInterception(session: WatcherSession, process: any) {
    session.page.on('response', async (response: any) => {
      try {
        const url = response.url();
        if (!COMPRASNET_CHAT_URL_PATTERN.test(url)) return;
        if (response.status() !== 200 && response.status() !== 206) return;

        const body = await response.json().catch(() => null);
        if (!body || !Array.isArray(body)) return;

        const messages: ComprasGovMessage[] = body;
        await this._processMessages(messages, session, process);

        session.lastHeartbeat = new Date();
      } catch (err: any) {
        // Silently ignore response processing errors  
        if (!err.message?.includes('Target closed')) {
          console.warn(`[ComprasnetWatcher] Response parse warning: ${err.message}`);
        }
      }
    });

    console.log(`[ComprasnetWatcher] 🔗 Network interception active for compraId ${session.compraId}`);
  }

  /** Process intercepted chat messages */
  private async _processMessages(messages: ComprasGovMessage[], session: WatcherSession, process: any) {
    const config = await prisma.chatMonitorConfig.findUnique({
      where: { tenantId: process.tenantId },
    });

    if (!config || !config.isActive) return;

    const keywords = config.keywords?.split(',').map((k: string) => k.trim().toLowerCase()) || [];

    for (const msg of messages) {
      const msgId = msg.chaveMensagemNaOrigem;
      if (!msgId || session.messagesLogged.has(msgId)) continue;

      const texto = msg.texto || '';
      const textoLower = texto.toLowerCase();
      const detectedKeyword = keywords.find((k: string) => textoLower.includes(k));
      const authorType = SENDER_TYPE_MAP[msg.tipoRemetente] || 'desconhecido';
      const category = CATEGORY_MAP[msg.categoria] || msg.categoria;

      // Always log if it matches a keyword OR if it's from pregoeiro/system (high-value)
      const isRelevant = !!detectedKeyword || msg.tipoRemetente === '0' || msg.tipoRemetente === '3';
      if (!isRelevant) {
        session.messagesLogged.add(msgId);
        continue;
      }

      console.log(`[ComprasnetWatcher] 🚨 Relevant message detected! [${authorType}/${category}] "${texto.substring(0, 80)}..."`);

      await prisma.chatMonitorLog.create({
        data: {
          tenantId: process.tenantId,
          biddingProcessId: session.processId,
          messageId: msgId,
          content: texto,
          detectedKeyword: detectedKeyword || null,
          authorType,
          authorCnpj: msg.identificadorRemetente || null,
          eventCategory: msg.categoria,
          itemRef: msg.identificadorItem || null,
          captureSource: 'comprasnet-xhr',
          status: detectedKeyword ? 'PENDING_NOTIFICATION' : 'SENT',
        },
      });

      session.messagesLogged.add(msgId);
    }

    // Process pending notifications
    if (keywords.length > 0) {
      await NotificationService.processPendingNotifications().catch((e: any) => {
        console.warn('[ComprasnetWatcher] Notification processing warning:', e.message);
      });
    }
  }

  /** Wait for user to complete login, then save session state */
  private async _waitForLogin(page: any) {
    try {
      // Wait for navigation to private area (successful login indicator)
      await page.waitForURL('**/private/**', { timeout: 300000 }); // 5 min timeout
      console.log('[ComprasnetWatcher] ✅ Login detected! Saving session state...');
      await this._saveSession();
      console.log('[ComprasnetWatcher] ✅ Session saved successfully.');
    } catch (err: any) {
      if (err.message?.includes('timeout')) {
        console.log('[ComprasnetWatcher] ⚠️ Login timeout (5 min). User may need to try again.');
      } else {
        console.warn('[ComprasnetWatcher] Login wait error:', err.message);
      }
    }
  }

  /** Save browser session state to disk */
  private async _saveSession() {
    if (!this.context) return;
    const statePath = path.join(SESSION_STATE_DIR, 'comprasnet-session.json');
    await this.context.storageState({ path: statePath });
    console.log(`[ComprasnetWatcher] Session state saved to ${statePath}`);
  }

  /** Load previously saved session state */
  private async _loadStoredSession(): Promise<boolean> {
    const statePath = path.join(SESSION_STATE_DIR, 'comprasnet-session.json');
    if (!fs.existsSync(statePath)) return false;

    try {
      const pw = await getPlaywright();
      if (!pw) return false;

      console.log('[ComprasnetWatcher] Loading stored session state...');
      this.browser = await pw.chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      });

      this.context = await this.browser.newContext({
        storageState: statePath,
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      this.isLaunched = true;
      console.log('[ComprasnetWatcher] ✅ Stored session loaded.');
      return true;
    } catch (err: any) {
      console.error('[ComprasnetWatcher] ❌ Failed to load stored session:', err.message);
      return false;
    }
  }

  /** Check if a stored session exists */
  private hasStoredSession(): boolean {
    try {
      return fs.existsSync(path.join(SESSION_STATE_DIR, 'comprasnet-session.json'));
    } catch {
      return false;
    }
  }

  /** Heartbeat to keep session alive and detect disconnections */
  private _startHeartbeat(processId: string) {
    const interval = setInterval(async () => {
      const session = this.sessions.get(processId);
      if (!session || !session.isActive) {
        clearInterval(interval);
        return;
      }

      try {
        // Check if page is still accessible
        const url = session.page.url();
        if (url.includes('login') || url.includes('landing')) {
          console.warn(`[ComprasnetWatcher] ⚠️ Session expired for process ${processId}. Attempting reconnect...`);
          session.isActive = false;
          await session.page.close().catch(() => {});
          this.sessions.delete(processId);
          // Try to reconnect with stored session
          const reconnected = await this._loadStoredSession();
          if (reconnected) {
            console.log('[ComprasnetWatcher] Attempting to restart monitoring...');
            await this.startMonitoring(processId);
          }
          clearInterval(interval);
          return;
        }

        // Click on "Mensagens" tab periodically to trigger chat refresh
        await session.page.click('text=Mensagem', { timeout: 5000 }).catch(() => {});
        session.lastHeartbeat = new Date();
      } catch (err: any) {
        if (err.message?.includes('Target closed')) {
          console.warn(`[ComprasnetWatcher] Page closed for ${processId}. Stopping heartbeat.`);
          session.isActive = false;
          this.sessions.delete(processId);
          clearInterval(interval);
        }
      }
    }, 60000); // Every 60 seconds
  }
}

// Singleton
export const comprasnetWatcher = new ComprasnetWatcherService();
