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
const versionGovernance_1 = require("./services/ai/governance/versionGovernance");
const opportunity_scanner_service_1 = require("./services/monitoring/opportunity-scanner.service");
const batch_platform_monitor_service_1 = require("./services/monitoring/batch-platform-monitor.service");
const pcp_monitor_service_1 = require("./services/monitoring/pcp-monitor.service");
const licitanet_monitor_service_1 = require("./services/monitoring/licitanet-monitor.service");
const licitamaisbrasil_monitor_service_1 = require("./services/monitoring/licitamaisbrasil-monitor.service");
const ingest_service_1 = require("./services/monitoring/ingest.service");
const backgroundJobService_1 = require("./services/backgroundJobService");
const backgroundJobWorker_1 = require("./services/backgroundJobWorker");
const errorHandler_1 = require("./middlewares/errorHandler");
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const axios_1 = __importDefault(require("axios"));
const client_1 = require("@prisma/client");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const genai_1 = require("@google/genai");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const storage_1 = require("./storage");
const security_1 = require("./lib/security");
const requestLogger_1 = require("./lib/requestLogger");
const logger_1 = require("./lib/logger");
const auth_1 = require("./middlewares/auth");
const auth_2 = __importDefault(require("./routes/auth"));
const admin_1 = __importDefault(require("./routes/admin"));
const team_1 = __importDefault(require("./routes/team"));
const companies_1 = __importDefault(require("./routes/companies"));
const documents_1 = __importDefault(require("./routes/documents"));
const biddings_1 = __importDefault(require("./routes/biddings"));
const pncp_1 = __importDefault(require("./routes/pncp"));
// Resolve server root (handles both ts-node and compiled dist/)
const SERVER_ROOT = __dirname.endsWith('dist') ? path_1.default.resolve(__dirname, '..') : __dirname;
// Load .env only if it exists (don't override Railway/Docker env vars)
dotenv_1.default.config({ path: path_1.default.join(SERVER_ROOT, '.env'), override: false });
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
const PORT = process.env.PORT || 3001;
const constants_1 = require("./lib/constants");
// PROCESS_ROLE: 'api' = HTTP only (no pollers), 'worker' = pollers only, 'all' = both (legacy default)
const PROCESS_ROLE = (process.env.PROCESS_ROLE || 'all').toLowerCase();
// ── Security Middleware (Helmet, CORS, Rate Limiting, Logging) ──
(0, security_1.applySecurityMiddleware)(app);
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
// ── Observability: Request logging with correlation IDs ──
app.use(requestLogger_1.requestLogger);
// ── Health Check (for Docker/Railway/load balancers) ──
app.get('/health', async (_req, res) => {
    const mem = process.memoryUsage();
    try {
        await prisma.$queryRaw `SELECT 1`;
        res.json({
            status: 'healthy',
            role: PROCESS_ROLE,
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
            memory: {
                heapUsedMB: Math.round(mem.heapUsed / 1048576),
                heapTotalMB: Math.round(mem.heapTotal / 1048576),
                rssMB: Math.round(mem.rss / 1048576),
            },
            node: process.version,
            hasGeminiKey: !!process.env.GEMINI_API_KEY,
        });
    }
    catch (err) {
        res.status(503).json({
            status: 'unhealthy',
            reason: 'database_unreachable',
            error: err.message,
        });
    }
});
// Auth
app.use('/api/auth', auth_2.default);
/**
 * Helper to fetch file buffer from multiple sources:
 * 1. Storage Service (Supabase/Local)
 * 2. Local File System Fallback
 * 3. Database Blob Fallback (if applicable)
 */
async function getFileBufferSafe(fileNameOrUrl, tenantId) {
    try {
        // Try Storage Service first
        return await storage_1.storageService.getFileBuffer(fileNameOrUrl);
    }
    catch (err) {
        logger_1.logger.warn(`[Storage] StorageService failed for ${fileNameOrUrl}, trying fallbacks...`);
        // 1. Local disk fallback (legacy or local mode)
        const pureName = path_1.default.basename(fileNameOrUrl).split('?')[0];
        const localPath = path_1.default.join(uploadDir, pureName);
        if (fs_1.default.existsSync(localPath)) {
            return fs_1.default.readFileSync(localPath);
        }
        // 2. Database fallback (recovering from blob if exists)
        if (tenantId) {
            const doc = await prisma.document.findFirst({
                where: {
                    OR: [
                        { fileUrl: { contains: pureName } },
                        { fileName: pureName }
                    ],
                    tenantId
                }
            });
            if (doc && doc.fileContent) {
                return Buffer.from(doc.fileContent);
            }
        }
    }
    return null;
}
// Setup uploads directory for Mock Bucket
const uploadDir = path_1.default.join(SERVER_ROOT, 'uploads');
if (!fs_1.default.existsSync(uploadDir)) {
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
}
// Gemini Setup (lazy - don't crash if key missing)
const apiKey = process.env.GEMINI_API_KEY || '';
logger_1.logger.info('Gemini API Key present:', !!apiKey);
let genAI = null;
if (apiKey) {
    genAI = new genai_1.GoogleGenAI({
        apiKey,
        // Increased timeout for large scanned PDFs (3 minutes)
        httpOptions: {
            timeout: 180000
        }
    });
}
// Custom route for /uploads with database fallback for ephemeral storage recovery
app.get('/uploads/:filename', async (req, res, next) => {
    try {
        const { filename } = req.params;
        const filePath = path_1.default.join(uploadDir, filename);
        // If file exists on disk (cache hit), serve it immediately
        if (fs_1.default.existsSync(filePath)) {
            return res.sendFile(filePath);
        }
        // Recovery mode: If file is missing on disk, search in Database
        // We match by the end of the URL (filename)
        const doc = await prisma.document.findFirst({
            where: { fileUrl: { endsWith: filename } }
        });
        if (doc && doc.fileContent) {
            logger_1.logger.info(`[Persistence] Recovering ${filename} from database to disk...`);
            fs_1.default.writeFileSync(filePath, doc.fileContent);
            return res.sendFile(filePath);
        }
        next();
    }
    catch (error) {
        logger_1.logger.error(`[Persistence] Error during file recovery:`, error);
        next();
    }
});
// Fallback static serving (still good for files that ARE there)
app.use('/uploads', express_1.default.static(uploadDir));
// Configure Multer storage to use Memory (for cloud readiness)
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
// Basic health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'LicitaSaaS API is running' });
});
// ── Admin: Backup Manual do Banco ──
app.post('/api/admin/backup', auth_1.authenticateToken, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const { runBackup } = await Promise.resolve().then(() => __importStar(require('./scripts/backup-database')));
        res.json({ message: 'Backup iniciado. Aguarde...' });
        // Run async (don't block response)
        runBackup().then(result => {
            if (result.success) {
                logger_1.logger.info(`[Backup] ✅ Manual backup completed: ${result.fileName} (${result.sizeKB}KB)`);
            }
            else {
                logger_1.logger.error(`[Backup] ❌ Manual backup failed: ${result.error}`);
            }
        });
    }
    catch (error) {
        logger_1.logger.error('[Backup] Failed to start backup:', error);
        res.status(500).json({ error: 'Failed to start backup' });
    }
});
// Debug endpoint — safe counts only (no credential exposure)
app.get('/api/debug-db', auth_1.authenticateToken, async (req, res) => {
    try {
        const counts = {
            tenants: await prisma.tenant.count(),
            companies: await prisma.companyProfile.count(),
            documents: await prisma.document.count(),
            users: await prisma.user.count(),
            biddings: await prisma.biddingProcess.count(),
            credentials: await prisma.companyCredential.count()
        };
        res.json({ counts });
    }
    catch (e) {
        (0, errorHandler_1.handleApiError)(res, e, 'debug-counts');
    }
});
// Diagnostic route to check if files actually exist on disk
app.get('/api/debug-uploads', (req, res) => {
    try {
        const fs = require('fs');
        if (!fs.existsSync(uploadDir)) {
            return res.json({ error: 'Upload directory does not exist', path: uploadDir });
        }
        const files = fs.readdirSync(uploadDir);
        res.json({
            count: files.length,
            path: uploadDir,
            version: '1.0.5-supabase-fix',
            storageType: process.env.STORAGE_TYPE || 'LOCAL',
            supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY),
            node_env: process.env.NODE_ENV,
            cwd: process.cwd(),
            server_root: SERVER_ROOT
        });
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// Admin Management (Tenants, Quotas, Global Health, etc.)
app.use('/api/admin', admin_1.default);
// Team & Users Management
app.use('/api/team', team_1.default);
// Companies, Credentials & Config  (router has /*, /credentials/*, /config/* paths)
app.use('/api', companies_1.default);
// Documents & Technical Certificates (router has /*, /technical-certificates/* paths)
app.use('/api', documents_1.default);
// Biddings CRUD + AutoEnrich + AutoMonitor (Sprint 8.1 — extracted from index.ts)
app.use('/api/biddings', biddings_1.default);
// PNCP Searches, Scanner, Favorites (Sprint 8.1 — extracted from index.ts)
app.use('/api/pncp', pncp_1.default);
const pncpAnalyze_1 = __importDefault(require("./routes/pncpAnalyze"));
app.use('/api/pncp', pncpAnalyze_1.default);
const chatMonitor_1 = __importDefault(require("./routes/chatMonitor"));
const proposals_1 = __importDefault(require("./routes/proposals"));
const analysis_1 = __importDefault(require("./routes/analysis"));
app.use('/api/chat-monitor', chatMonitor_1.default);
app.use('/api/proposals', proposals_1.default); // proposals + dossier
app.use('/api/analyze-edital', analysis_1.default); // analyze-edital + petitions + jobs + events
const declarations_1 = __importDefault(require("./routes/declarations"));
const governance_1 = __importDefault(require("./routes/governance"));
app.use('/api', declarations_1.default); // declarations
app.use('/api', governance_1.default); // ai governance + company + strategy
// ═══════════════════════════════════════════════════════════════
app.post('/api/internal/scanner/reset-and-scan', async (req, res) => {
    const secret = req.headers['x-worker-secret'] || req.body?.workerSecret;
    const WORKER_SECRET = process.env.CHAT_WORKER_SECRET || '';
    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
    const isAuthorized = (WORKER_SECRET && secret === WORKER_SECRET) || (TELEGRAM_TOKEN && secret === TELEGRAM_TOKEN);
    if (!isAuthorized) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    try {
        const tenantId = req.body?.tenantId || '9f7a7155-be67-4470-8952-eb947fd97931';
        const deleted = await prisma.opportunityScannerLog.deleteMany({ where: { tenantId } });
        logger_1.logger.info(`[OpportunityScanner] 🔄 Internal reset: ${deleted.count} registros removidos para tenant ${tenantId}`);
        const { runOpportunityScan } = await Promise.resolve().then(() => __importStar(require('./services/monitoring/opportunity-scanner.service')));
        runOpportunityScan().catch(err => logger_1.logger.error('[OpportunityScanner] Scan error:', err));
        res.json({ success: true, deleted: deleted.count, message: `Reset OK (${deleted.count} removed). Scan triggered.` });
    }
    catch (error) {
        logger_1.logger.error("Internal reset error:", error);
        (0, errorHandler_1.handleApiError)(res, error, 'scanner-reset');
    }
});
// ─── AI Services Imports estão no topo do arquivo ───
// Ai Analysis
// ── Utility Functions (shared with extracted routes) ──
const ADMIN_TELEGRAM_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID || '';
const pollerLastSuccess = new Map();
const watchdogActiveAlerts = new Set();
async function sendAdminAlert(message) {
    if (!ADMIN_TELEGRAM_CHAT_ID)
        return;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken)
        return;
    try {
        await axios_1.default.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: ADMIN_TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML',
        }, { timeout: 10000 });
    }
    catch (err) {
        logger_1.logger.error(`[Watchdog] ❌ Failed to send admin alert:`, err.message);
    }
}
async function runWatchdogCheck() {
    const now = new Date();
    const alerts = [];
    const pollerThresholds = {
        'BLL+BNC': 10 * 60000, 'PCP': 15 * 60000, 'Licitanet': 15 * 60000, 'LMB': 15 * 60000,
    };
    for (const [name, thresholdMs] of Object.entries(pollerThresholds)) {
        const lastSuccess = pollerLastSuccess.get(name);
        if (!lastSuccess)
            continue;
        const elapsedMs = now.getTime() - lastSuccess.getTime();
        if (elapsedMs > thresholdMs) {
            const mins = Math.floor(elapsedMs / 60000);
            if (!watchdogActiveAlerts.has(name)) {
                alerts.push(`⚠️ <b>${name}</b> não completa um ciclo há <b>${mins} minutos</b>`);
                watchdogActiveAlerts.add(name);
            }
        }
        else {
            if (watchdogActiveAlerts.has(name)) {
                watchdogActiveAlerts.delete(name);
                sendAdminAlert(`✅ <b>${name}</b> voltou a funcionar normalmente.`);
            }
        }
    }
    try {
        const pendingCount = await prisma.chatMonitorLog.count({ where: { status: 'PENDING_NOTIFICATION' } });
        if (pendingCount > 20 && !watchdogActiveAlerts.has('NotificationQueue')) {
            alerts.push(`⚠️ <b>Fila de notificações</b> com <b>${pendingCount}</b> mensagens pendentes`);
            watchdogActiveAlerts.add('NotificationQueue');
        }
        else {
            watchdogActiveAlerts.delete('NotificationQueue');
        }
    }
    catch { }
    if (alerts.length > 0) {
        const msg = `🔴 <b>ALERTA DO SISTEMA — LicitaSaaS</b>\n\n` + alerts.join('\n') + '\n\n' +
            `<i>${now.toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })}</i>`;
        await sendAdminAlert(msg);
    }
}
async function runAutoSetup() {
    try {
        logger_1.logger.info('🔍 Verificando integridade dos dados e tenants...');
        let tenant = await prisma.tenant.findUnique({ where: { rootCnpj: '00000000' } });
        if (!tenant) {
            logger_1.logger.info('🏗️ Criando Tenant Principal...');
            tenant = await prisma.tenant.create({ data: { razaoSocial: 'LicitaSaaS Brasil', rootCnpj: '00000000' } });
        }
        const adminEmail = 'admin@licitasaas.com';
        const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
        if (!admin) {
            logger_1.logger.info('🏗️ Criando Usuário Administrador...');
            const salt = await bcryptjs_1.default.genSalt(constants_1.BCRYPT_COST);
            const passwordHash = await bcryptjs_1.default.hash('admin123', salt);
            await prisma.user.create({ data: { email: adminEmail, name: 'Administrador', passwordHash, role: 'ADMIN', tenantId: tenant.id } });
        }
        else if (admin.tenantId !== tenant.id) {
            await prisma.user.update({ where: { email: adminEmail }, data: { tenantId: tenant.id } });
        }
    }
    catch (error) {
        logger_1.logger.error('❌ Erro no runAutoSetup:', error);
    }
}
async function fetchPdfPartsForProcess(biddingProcessId, fileNamesRaw, tenantId) {
    const pdfParts = [];
    const biddingLinks = biddingProcessId ? (await prisma.biddingProcess.findUnique({ where: { id: biddingProcessId } }))?.link || "" : "";
    for (let fileName of fileNamesRaw) {
        fileName = decodeURIComponent(fileName).split('?')[0];
        const doc = await prisma.document.findFirst({ where: { fileUrl: { contains: fileName }, tenantId } });
        const hasPrefix = fileName.startsWith(tenantId) || fileName.startsWith(`pncp_${tenantId}`);
        const isExplicitlyLinked = biddingLinks.includes(fileName);
        if (!(!!doc || hasPrefix || isExplicitlyLinked))
            continue;
        const fileToFetch = doc ? doc.fileUrl : fileName;
        const pdfBuffer = await getFileBufferSafe(fileToFetch, tenantId);
        if (pdfBuffer) {
            pdfParts.push({ inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' } });
        }
    }
    return pdfParts;
}
app.listen(PORT, async () => {
    logger_1.logger.info(`Server is running on port ${PORT} (mode: ${process.env.NODE_ENV || 'development'})`);
    logger_1.logger.info(`Upload directory: ${uploadDir}`);
    await runAutoSetup();
    // Initialize version catalog
    (0, versionGovernance_1.registerInitialVersions)();
    logger_1.logger.info(`[Governance] Version catalog initialized with ${(0, versionGovernance_1.getAllVersions)().length} components`);
    // ── Background Job Worker — Process async AI tasks ──
    (0, backgroundJobWorker_1.registerJobHandler)('edital_analysis', async (job) => {
        const { fileNames, biddingProcessId } = job.input;
        const tenantId = job.tenantId;
        await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: 10, progressMsg: 'Preparando documentos...' });
        // Re-use the existing sync pipeline by making an internal HTTP call
        // This ensures zero code duplication and the legacy endpoint stays as-is
        const internalUrl = `http://localhost:${PORT}/api/analyze-edital/v2`;
        // Get a valid token for this user/tenant
        const jwt = require('jsonwebtoken');
        const internalToken = jwt.sign({ id: job.userId, tenantId: job.tenantId, role: 'Admin' }, constants_1.JWT_SECRET, { expiresIn: '10m' });
        await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: 20, progressMsg: 'Etapa 1/3 — Extração Factual...' });
        // Simulate progress updates while the pipeline runs
        let progressPercent = 20;
        const progressTimer = setInterval(async () => {
            progressPercent = Math.min(progressPercent + 10, 90);
            const stages = {
                30: 'Etapa 1/3 — Extração Factual...',
                50: 'Etapa 2/3 — Normalização...',
                70: 'Etapa 3/3 — Revisão de Risco...',
                85: 'Validando e finalizando...',
            };
            const msg = stages[Math.round(progressPercent / 10) * 10] || `Processando... (${progressPercent}%)`;
            try {
                await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: progressPercent, progressMsg: msg });
            }
            catch { /* ignore */ }
        }, 8000);
        try {
            const response = await fetch(internalUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${internalToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ fileNames, biddingProcessId }),
            });
            clearInterval(progressTimer);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.error || `Pipeline returned ${response.status}`);
            }
            const result = await response.json();
            await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: 95, progressMsg: 'Salvando resultado...' });
            return result;
        }
        catch (err) {
            clearInterval(progressTimer);
            throw err;
        }
    });
    (0, backgroundJobWorker_1.registerJobHandler)('pncp_analysis', async (job) => {
        const { orgao_cnpj, ano, numero_sequencial, link_sistema } = job.input;
        const tenantId = job.tenantId;
        await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: 5, progressMsg: 'Iniciando análise PNCP...' });
        const internalUrl = `http://localhost:${PORT}/api/pncp/analyze`;
        const jwt = require('jsonwebtoken');
        const internalToken = jwt.sign({ id: job.userId, tenantId: job.tenantId, role: 'Admin' }, constants_1.JWT_SECRET, { expiresIn: '10m' });
        try {
            const response = await fetch(internalUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${internalToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ orgao_cnpj, ano, numero_sequencial, link_sistema }),
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.error || `Pipeline returned ${response.status}`);
            }
            if (!response.body)
                throw new Error('Falha ao abrir stream de resposta local');
            // Parse SSE chunks manually in Node.js
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finalResult = null;
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n\n');
                buffer = parts.pop() || '';
                for (const part of parts) {
                    const line = part.trim();
                    if (!line.startsWith('data: '))
                        continue;
                    try {
                        const event = JSON.parse(line.slice(6));
                        if (event.type === 'progress') {
                            await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, {
                                progress: event.percent,
                                progressMsg: event.message
                            });
                        }
                        else if (event.type === 'result') {
                            finalResult = event.payload;
                        }
                        else if (event.type === 'error') {
                            throw new Error(event.error || 'Erro interno na stream');
                        }
                    }
                    catch (e) {
                        if (e.message && !e.message.includes('JSON'))
                            throw e;
                    }
                }
            }
            if (!finalResult)
                throw new Error('Nenhum dado final recebido do pipeline PNCP');
            await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: 100, progressMsg: 'Concluído' });
            return finalResult;
        }
        catch (err) {
            throw err;
        }
    });
    (0, backgroundJobWorker_1.registerJobHandler)('oracle', async (job) => {
        const tenantId = job.tenantId;
        await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: 10, progressMsg: 'Iniciando verificação de compatibilidade no Oráculo...' });
        const internalUrl = `http://localhost:${PORT}/api/technical-certificates/compare`;
        const jwt = require('jsonwebtoken');
        const internalToken = jwt.sign({ id: job.userId, tenantId: job.tenantId, role: 'Admin' }, constants_1.JWT_SECRET, { expiresIn: '10m' });
        let progressPercent = 10;
        const progressTimer = setInterval(async () => {
            progressPercent = Math.min(progressPercent + 15, 95);
            await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: progressPercent, progressMsg: 'Analisando acervos contra exigências...' }).catch(() => { });
        }, 3000);
        try {
            const response = await fetch(internalUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${internalToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(job.input),
            });
            clearInterval(progressTimer);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.error || `Oráculo retornou ${response.status}`);
            }
            await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: 100, progressMsg: 'Concluído' });
            return await response.json();
        }
        finally {
            clearInterval(progressTimer);
        }
    });
    (0, backgroundJobWorker_1.registerJobHandler)('proposal_populate', async (job) => {
        const tenantId = job.tenantId;
        await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: 10, progressMsg: 'Iniciando preenchimento da proposta...' });
        const internalUrl = `http://localhost:${PORT}/api/proposals/ai-populate`;
        const jwt = require('jsonwebtoken');
        const internalToken = jwt.sign({ id: job.userId, tenantId: job.tenantId, role: 'Admin' }, constants_1.JWT_SECRET, { expiresIn: '10m' });
        let progressPercent = 10;
        const progressTimer = setInterval(async () => {
            progressPercent = Math.min(progressPercent + 10, 95);
            await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: progressPercent, progressMsg: 'Extraindo e preenchendo itens comerciais...' }).catch(() => { });
        }, 4000);
        try {
            const response = await fetch(internalUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${internalToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(job.input),
            });
            clearInterval(progressTimer);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.error || `Preenchimento retornou ${response.status}`);
            }
            await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: 100, progressMsg: 'Concluído' });
            return await response.json();
        }
        finally {
            clearInterval(progressTimer);
        }
    });
    (0, backgroundJobWorker_1.registerJobHandler)('petition', async (job) => {
        const tenantId = job.tenantId;
        await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: 10, progressMsg: 'Preparando contexto da petição...' });
        const internalUrl = `http://localhost:${PORT}/api/petitions/generate`;
        const jwt = require('jsonwebtoken');
        const internalToken = jwt.sign({ id: job.userId, tenantId: job.tenantId, role: 'Admin' }, constants_1.JWT_SECRET, { expiresIn: '10m' });
        let progressPercent = 10;
        const progressTimer = setInterval(async () => {
            progressPercent = Math.min(progressPercent + 20, 95);
            await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: progressPercent, progressMsg: 'Redigindo fundamentação e documentos...' }).catch(() => { });
        }, 6000);
        try {
            const response = await fetch(internalUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${internalToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(job.input),
            });
            clearInterval(progressTimer);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.error || `Geração de petição retornou ${response.status}`);
            }
            await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: 100, progressMsg: 'Concluído' });
            return await response.json();
        }
        finally {
            clearInterval(progressTimer);
        }
    });
    (0, backgroundJobWorker_1.registerJobHandler)('declaration', async (job) => {
        const tenantId = job.tenantId;
        await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: 10, progressMsg: 'Iniciando geração de declaração...' });
        const internalUrl = `http://localhost:${PORT}/api/generate-declaration`;
        const jwt = require('jsonwebtoken');
        const internalToken = jwt.sign({ id: job.userId, tenantId: job.tenantId, role: 'Admin' }, constants_1.JWT_SECRET, { expiresIn: '10m' });
        let progressPercent = 10;
        const progressTimer = setInterval(async () => {
            progressPercent = Math.min(progressPercent + 25, 95);
            await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: progressPercent, progressMsg: 'Formatando declarações jurídicas...' }).catch(() => { });
        }, 3000);
        try {
            const response = await fetch(internalUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${internalToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(job.input),
            });
            clearInterval(progressTimer);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.error || `Geração de declaração retornou ${response.status}`);
            }
            await (0, backgroundJobService_1.updateJobProgress)(job.id, tenantId, { progress: 100, progressMsg: 'Concluído' });
            return await response.json();
        }
        finally {
            clearInterval(progressTimer);
        }
    });
    (0, backgroundJobWorker_1.startJobWorker)();
    logger_1.logger.info('[BackgroundJob] 🚀 Worker started — async AI operations enabled');
    // PNCP Monitor disabled — ComprasNet Watcher handles all chat monitoring
    // pncpMonitor.startPolling(5);
    // ── System Health Watchdog: check every 5 minutes ──
    if (ADMIN_TELEGRAM_CHAT_ID) {
        setTimeout(() => {
            logger_1.logger.info('[Watchdog] 🐕 System health watchdog started (interval: 5 min)');
            setInterval(runWatchdogCheck, 5 * 60000);
        }, 3 * 60000); // Start 3 min after boot (give pollers time to initialize)
    }
    else {
        logger_1.logger.info('[Watchdog] ⚠️ ADMIN_TELEGRAM_CHAT_ID not set — watchdog disabled');
    }
    // ── Background Workers (only run when PROCESS_ROLE is 'all' or 'worker') ──
    if (PROCESS_ROLE === 'api') {
        logger_1.logger.info('[Server] PROCESS_ROLE=api — background pollers disabled (running in separate worker process)');
    }
    else {
        // ── One-time backfill: fetch ComprasNet links for existing processes ──
        (async () => {
            try {
                const processes = await prisma.biddingProcess.findMany({
                    where: {
                        link: { contains: 'pncp.gov.br/app/editais' },
                        NOT: { link: { contains: 'cnetmobile' } }
                    },
                    select: { id: true, link: true, isMonitored: true }
                });
                if (processes.length === 0) {
                    logger_1.logger.info('[Backfill] All processes already have ComprasNet links or no PNCP links found.');
                    return;
                }
                logger_1.logger.info(`[Backfill] Found ${processes.length} processes with PNCP links missing ComprasNet. Fetching...`);
                let updated = 0;
                for (const proc of processes) {
                    try {
                        // Extract CNPJ/ANO/SEQ from PNCP link
                        const match = (proc.link || '').match(/editais\/(\d+)\/(\d+)\/(\d+)/);
                        if (!match)
                            continue;
                        const [, cnpj, ano, seq] = match;
                        const apiUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
                        const res = await fetch(apiUrl);
                        if (!res.ok)
                            continue;
                        const data = await res.json();
                        const comprasNetLink = data.linkSistemaOrigem;
                        if (comprasNetLink && (comprasNetLink.includes('cnetmobile') || comprasNetLink.includes('comprasnet'))) {
                            const newLink = `${proc.link}, ${comprasNetLink}`;
                            await prisma.biddingProcess.update({
                                where: { id: proc.id },
                                data: {
                                    link: newLink,
                                    isMonitored: true // Auto-enable since we now have ComprasNet data
                                }
                            });
                            updated++;
                            logger_1.logger.info(`[Backfill] ✅ Updated process ${proc.id.slice(0, 8)} with ComprasNet link`);
                        }
                        // Rate limit: 500ms between API calls to avoid hammering PNCP
                        await new Promise(r => setTimeout(r, 500));
                    }
                    catch (e) {
                        // Skip individual failures silently
                    }
                }
                logger_1.logger.info(`[Backfill] Done. Updated ${updated}/${processes.length} processes with ComprasNet links.`);
            }
            catch (e) {
                logger_1.logger.error('[Backfill] Error:', e);
            }
        })();
        // ══════════════════════════════════════════════════════════════
        // ── Batch Platforms (BLL + BNC): Polling via API REST ──
        // ══════════════════════════════════════════════════════════════
        const BATCH_POLL_INTERVAL_MS = 60000; // 60 segundos
        async function pollBatchProcesses() {
            try {
                // 1. Buscar processos monitorados de TODAS as plataformas Batch
                const batchProcesses = await prisma.biddingProcess.findMany({
                    where: {
                        isMonitored: true,
                        OR: [
                            { link: { contains: 'bllcompras' } },
                            { link: { contains: 'bnccompras' } },
                        ],
                    },
                    select: {
                        id: true,
                        tenantId: true,
                        title: true,
                        link: true,
                    },
                });
                if (batchProcesses.length === 0)
                    return;
                let totalNew = 0;
                let totalAlerts = 0;
                for (const proc of batchProcesses) {
                    try {
                        if (!proc.link)
                            continue;
                        // 2. Detectar qual plataforma (BLL ou BNC)
                        const platform = batch_platform_monitor_service_1.BatchPlatformMonitor.detectPlatform(proc.link);
                        if (!platform)
                            continue;
                        // 3. Extrair param1 da URL
                        const param1 = batch_platform_monitor_service_1.BatchPlatformMonitor.extractParam1(proc.link);
                        if (!param1)
                            continue;
                        // 4. Buscar mensagens via API REST e HTML (processo + lotes)
                        const messages = await batch_platform_monitor_service_1.BatchPlatformMonitor.fetchAllMessages(param1, platform);
                        if (messages.length === 0)
                            continue;
                        // 5. Ingerir via IngestService (dedup + keyword + notificação)
                        const result = await ingest_service_1.IngestService.ingestMessages(prisma, {
                            processId: proc.id,
                            tenantId: proc.tenantId,
                            messages: messages.map((m) => ({
                                messageId: m.messageId,
                                content: m.content,
                                authorType: m.authorType,
                                timestamp: m.timestamp || null,
                                itemRef: m.itemRef || null,
                            })),
                            captureSource: platform.captureSource,
                        });
                        if (result.created > 0) {
                            logger_1.logger.info(`[${platform.label} Poll] 📨 ${result.created} nova(s) msg(s) para ${proc.title?.substring(0, 40)} (${result.alerts} alertas)`);
                            totalNew += result.created;
                            totalAlerts += result.alerts;
                        }
                        // Gentil com a API: 1s entre processos
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    catch (err) {
                        logger_1.logger.warn(`[Batch Poll] Erro no processo ${proc.id.substring(0, 8)}:`, err.message);
                    }
                }
                if (totalNew > 0) {
                    logger_1.logger.info(`[Batch Poll] ✅ Ciclo: ${totalNew} mensagens novas, ${totalAlerts} alertas de ${batchProcesses.length} processos`);
                }
                pollerLastSuccess.set('BLL+BNC', new Date());
            }
            catch (error) {
                logger_1.logger.error('[Batch Poll] Erro no ciclo:', error.message);
            }
        }
        // Iniciar polling com delay de 30s para não sobrecarregar startup
        setTimeout(() => {
            logger_1.logger.info(`[Batch Poll] 🚀 Monitor BLL+BNC iniciado (intervalo: ${BATCH_POLL_INTERVAL_MS / 1000}s)`);
            pollBatchProcesses();
            setInterval(pollBatchProcesses, BATCH_POLL_INTERVAL_MS);
        }, 30000);
        // ══════════════════════════════════════════════════════════════
        // ── Portal de Compras Públicas (PCP): Polling via HTML SSR ──
        // ══════════════════════════════════════════════════════════════
        const PCP_POLL_INTERVAL_MS = 90000; // 90 segundos (mais gentil — HTML é pesado)
        async function pollPCPProcesses() {
            try {
                // 1. Buscar processos monitorados do Portal de Compras Públicas
                const pcpProcesses = await prisma.biddingProcess.findMany({
                    where: {
                        isMonitored: true,
                        link: { contains: 'portaldecompraspublicas' },
                    },
                    select: {
                        id: true,
                        tenantId: true,
                        title: true,
                        link: true,
                    },
                });
                if (pcpProcesses.length === 0)
                    return;
                let totalNew = 0;
                let totalAlerts = 0;
                for (const proc of pcpProcesses) {
                    try {
                        if (!proc.link)
                            continue;
                        // 2. Extrair a URL do PCP
                        const pcpUrl = pcp_monitor_service_1.PCPMonitor.extractPCPUrl(proc.link);
                        if (!pcpUrl)
                            continue;
                        // 3. Buscar mensagens via scraping do HTML SSR
                        const messages = await pcp_monitor_service_1.PCPMonitor.fetchMessages(pcpUrl);
                        if (messages.length === 0)
                            continue;
                        // 4. Ingerir via IngestService (com eventCategory e itemRef)
                        const result = await ingest_service_1.IngestService.ingestMessages(prisma, {
                            processId: proc.id,
                            tenantId: proc.tenantId,
                            messages: messages.map((m) => ({
                                messageId: m.messageId,
                                content: m.content,
                                authorType: m.authorType,
                                timestamp: m.timestamp || null,
                                itemRef: m.itemRef || null,
                                eventCategory: m.eventCategory || null,
                                captureSource: m.captureSource || 'pcp-api',
                            })),
                            captureSource: 'pcp-api',
                        });
                        if (result.created > 0) {
                            logger_1.logger.info(`[PCP Poll] 📨 ${result.created} nova(s) msg(s) para ${proc.title?.substring(0, 40)} (${result.alerts} alertas)`);
                            totalNew += result.created;
                            totalAlerts += result.alerts;
                        }
                        // Gentil com o servidor: 2s entre processos (HTML é mais pesado)
                        await new Promise(r => setTimeout(r, 2000));
                    }
                    catch (err) {
                        logger_1.logger.warn(`[PCP Poll] Erro no processo ${proc.id.substring(0, 8)}:`, err.message);
                    }
                }
                if (totalNew > 0) {
                    logger_1.logger.info(`[PCP Poll] ✅ Ciclo: ${totalNew} mensagens novas, ${totalAlerts} alertas de ${pcpProcesses.length} processos`);
                }
                pollerLastSuccess.set('PCP', new Date());
            }
            catch (error) {
                logger_1.logger.error('[PCP Poll] Erro no ciclo:', error.message);
            }
        }
        // Iniciar polling PCP com delay de 45s (após BLL+BNC)
        setTimeout(() => {
            logger_1.logger.info(`[PCP Poll] 🚀 Monitor Portal de Compras Públicas iniciado (intervalo: ${PCP_POLL_INTERVAL_MS / 1000}s)`);
            pollPCPProcesses();
            setInterval(pollPCPProcesses, PCP_POLL_INTERVAL_MS);
        }, 45000);
        // ══════════════════════════════════════════════════════════════
        // ── Licitanet: Polling via API REST JSON pública ──
        // ══════════════════════════════════════════════════════════════
        const LICITANET_POLL_INTERVAL_MS = 90000; // 90 segundos
        async function pollLicitanetProcesses() {
            try {
                // 1. Buscar processos monitorados da Licitanet
                const licitanetProcesses = await prisma.biddingProcess.findMany({
                    where: {
                        isMonitored: true,
                        link: { contains: 'licitanet.com.br' },
                    },
                    select: {
                        id: true,
                        tenantId: true,
                        title: true,
                        link: true,
                    },
                });
                if (licitanetProcesses.length === 0)
                    return;
                let totalNew = 0;
                let totalAlerts = 0;
                for (const proc of licitanetProcesses) {
                    try {
                        if (!proc.link)
                            continue;
                        // 2. Extrair a URL da Licitanet
                        const licitanetUrl = licitanet_monitor_service_1.LicitanetMonitor.extractLicitanetUrl(proc.link);
                        if (!licitanetUrl)
                            continue;
                        // 3. Buscar mensagens via API REST JSON
                        const messages = await licitanet_monitor_service_1.LicitanetMonitor.fetchMessages(licitanetUrl);
                        if (messages.length === 0)
                            continue;
                        // 4. Ingerir via IngestService (com eventCategory e itemRef)
                        const result = await ingest_service_1.IngestService.ingestMessages(prisma, {
                            processId: proc.id,
                            tenantId: proc.tenantId,
                            messages: messages.map((m) => ({
                                messageId: m.messageId,
                                content: m.content,
                                authorType: m.authorType,
                                timestamp: m.timestamp || null,
                                itemRef: m.itemRef || null,
                                eventCategory: m.eventCategory || null,
                                captureSource: m.captureSource || 'licitanet-api',
                            })),
                            captureSource: 'licitanet-api',
                        });
                        if (result.created > 0) {
                            logger_1.logger.info(`[Licitanet Poll] 📨 ${result.created} nova(s) msg(s) para ${proc.title?.substring(0, 40)} (${result.alerts} alertas)`);
                            totalNew += result.created;
                            totalAlerts += result.alerts;
                        }
                        // Gentil com o servidor: 1s entre processos (API JSON é leve)
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    catch (err) {
                        logger_1.logger.warn(`[Licitanet Poll] Erro no processo ${proc.id.substring(0, 8)}:`, err.message);
                    }
                }
                if (totalNew > 0) {
                    logger_1.logger.info(`[Licitanet Poll] ✅ Ciclo: ${totalNew} mensagens novas, ${totalAlerts} alertas de ${licitanetProcesses.length} processos`);
                }
                pollerLastSuccess.set('Licitanet', new Date());
            }
            catch (error) {
                logger_1.logger.error('[Licitanet Poll] Erro no ciclo:', error.message);
            }
        }
        // Iniciar polling Licitanet com delay de 60s (após PCP)
        setTimeout(() => {
            logger_1.logger.info(`[Licitanet Poll] 🚀 Monitor Licitanet iniciado (intervalo: ${LICITANET_POLL_INTERVAL_MS / 1000}s)`);
            pollLicitanetProcesses();
            setInterval(pollLicitanetProcesses, LICITANET_POLL_INTERVAL_MS);
        }, 60000);
        // ══════════════════════════════════════════════════════════════
        // ── Licita Mais Brasil: Polling via API REST JSON autenticada ──
        // ══════════════════════════════════════════════════════════════
        const LMB_POLL_INTERVAL_MS = 90000; // 90 segundos
        async function pollLMBProcesses() {
            try {
                // 1. Buscar processos monitorados da Licita Mais Brasil
                const lmbProcesses = await prisma.biddingProcess.findMany({
                    where: {
                        isMonitored: true,
                        link: { contains: 'licitamaisbrasil.com.br' },
                    },
                    select: {
                        id: true,
                        tenantId: true,
                        title: true,
                        link: true,
                    },
                });
                if (lmbProcesses.length === 0)
                    return;
                let totalNew = 0;
                let totalAlerts = 0;
                for (const proc of lmbProcesses) {
                    try {
                        if (!proc.link)
                            continue;
                        // 2. Extrair a URL da Licita Mais Brasil
                        const lmbUrl = licitamaisbrasil_monitor_service_1.LicitaMaisBrasilMonitor.extractLMBUrl(proc.link);
                        if (!lmbUrl)
                            continue;
                        // 3. Buscar mensagens via API REST autenticada
                        const messages = await licitamaisbrasil_monitor_service_1.LicitaMaisBrasilMonitor.fetchMessages(lmbUrl);
                        if (messages.length === 0)
                            continue;
                        // 4. Ingerir via IngestService (com eventCategory e itemRef)
                        const result = await ingest_service_1.IngestService.ingestMessages(prisma, {
                            processId: proc.id,
                            tenantId: proc.tenantId,
                            messages: messages.map((m) => ({
                                messageId: m.messageId,
                                content: m.content,
                                authorType: m.authorType,
                                timestamp: m.timestamp || null,
                                itemRef: m.itemRef || null,
                                eventCategory: m.eventCategory || null,
                                captureSource: m.captureSource || 'licitamaisbrasil-api',
                            })),
                            captureSource: 'licitamaisbrasil-api',
                        });
                        if (result.created > 0) {
                            logger_1.logger.info(`[LMB Poll] 📨 ${result.created} nova(s) msg(s) para ${proc.title?.substring(0, 40)} (${result.alerts} alertas)`);
                            totalNew += result.created;
                            totalAlerts += result.alerts;
                        }
                        // Gentil com o servidor: 1.5s entre processos (API autenticada)
                        await new Promise(r => setTimeout(r, 1500));
                    }
                    catch (err) {
                        logger_1.logger.warn(`[LMB Poll] Erro no processo ${proc.id.substring(0, 8)}:`, err.message);
                    }
                }
                if (totalNew > 0) {
                    logger_1.logger.info(`[LMB Poll] ✅ Ciclo: ${totalNew} mensagens novas, ${totalAlerts} alertas de ${lmbProcesses.length} processos`);
                }
                pollerLastSuccess.set('LMB', new Date());
            }
            catch (error) {
                logger_1.logger.error('[LMB Poll] Erro no ciclo:', error.message);
            }
        }
        // Iniciar polling LMB com delay de 75s (após Licitanet)
        setTimeout(() => {
            logger_1.logger.info(`[LMB Poll] 🚀 Monitor Licita Mais Brasil iniciado (intervalo: ${LMB_POLL_INTERVAL_MS / 1000}s)`);
            pollLMBProcesses();
            setInterval(pollLMBProcesses, LMB_POLL_INTERVAL_MS);
        }, 75000);
    } // end of PROCESS_ROLE !== 'api' block
});
// ── Opportunity Scanner: Auto-scan saved PNCP searches every 4 hours ──
if (PROCESS_ROLE !== 'api') {
    (0, opportunity_scanner_service_1.startOpportunityScanner)(4);
}
else {
    logger_1.logger.info('[Server] Opportunity Scanner disabled (PROCESS_ROLE=api)');
}
// Keep event loop alive (required in this environment)
setInterval(() => { }, 1 << 30);
