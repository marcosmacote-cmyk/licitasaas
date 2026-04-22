// ── Sentry MUST be imported first for proper instrumentation ──
import { Sentry, sentryErrorHandler, captureError, setSentryUser } from './lib/sentry';

import { robustJsonParse, robustJsonParseDetailed } from "./services/ai/parser.service";
import { callGeminiWithRetry } from "./services/ai/gemini.service";
import { ANALYZE_EDITAL_SYSTEM_PROMPT, USER_ANALYSIS_INSTRUCTION, EXTRACT_CERTIFICATE_SYSTEM_PROMPT, COMPARE_CERTIFICATE_SYSTEM_PROMPT, MASTER_PETITION_SYSTEM_PROMPT, PETITION_USER_INSTRUCTION, V2_EXTRACTION_PROMPT, V2_NORMALIZATION_PROMPT, V2_RISK_REVIEW_PROMPT, V2_EXTRACTION_USER_INSTRUCTION, V2_NORMALIZATION_USER_INSTRUCTION, V2_RISK_REVIEW_USER_INSTRUCTION, V2_PROMPT_VERSION, getDomainRoutingInstruction, NORM_CATEGORIES, buildCategoryNormPrompt, buildCategoryNormUser, MANUAL_EXTRACTION_ADDON } from "./services/ai/prompt.service";
import { AnalysisSchemaV1, createEmptyAnalysisSchema } from "./services/ai/analysis-schema-v1";
import { fallbackToOpenAi, fallbackToOpenAiV2 } from "./services/ai/openai.service";
import { indexDocumentChunks, searchSimilarChunks } from "./services/ai/rag.service";
import { executeRiskRules } from "./services/ai/riskRulesEngine";
import { evaluateAnalysisQuality, validateAnalysisCompleteness } from "./services/ai/analysisQualityEvaluator";
import { enforceSchema } from "./services/ai/schemaEnforcer";
import { buildModuleContext, ModuleName } from "./services/ai/modules/moduleContextContracts";
import { CHAT_SYSTEM_PROMPT, CHAT_USER_INSTRUCTION } from "./services/ai/modules/prompts/chatPromptV2";
import { PETITION_SYSTEM_PROMPT, PETITION_USER_INSTRUCTION as PETITION_V2_USER_INSTRUCTION } from "./services/ai/modules/prompts/petitionPromptV2";
import { ORACLE_SYSTEM_PROMPT } from "./services/ai/modules/prompts/oraclePromptV2";
import { DECLARATION_SYSTEM_PROMPT } from "./services/ai/modules/prompts/declarationPromptV2";
import {
    parseAndSanitize as parseDeclaration,
    validateDeclaration,
    calculateQualityReport,
    hasCriticalIssues,
    summarizeReport,
    repairDeclaration,
    createGeminiRepairFn,
    FAMILY_LENGTH_CONSTRAINTS,
    DECLARATION_SEMANTIC_MAP,
    ANTI_GENERIC_PHRASES,
    validateAndFixTitle,
} from "./services/ai/declaration";
import type { AuthoritativeFacts, DeclarationFamily, DeclarationStyle } from "./services/ai/declaration";
import { evaluateModuleQuality } from "./services/ai/modules/moduleQualityEvaluator";
import { evaluateHumanReview } from "./services/ai/modules/humanReviewPolicy";
import { submitFeedback, getFeedbackByModule, getFeedbackStats, AIExecutionFeedback } from "./services/ai/governance/feedbackService";
import { generateSystemReport, recordExecution } from "./services/ai/governance/operationalMetrics";
import { registerInitialVersions, getAllVersions, getPromotionHistory } from "./services/ai/governance/versionGovernance";
import { generateImprovementInsights, convertFeedbackToGoldenCases } from "./services/ai/governance/improvementInsights";
import { createOrUpdateProfile, getProfile, getAllProfiles, createEmptyProfile, CompanyLicitationProfile } from "./services/ai/company/companyProfileService";
import { matchCompanyToEdital, calculateParticipationScore, generateActionPlan } from "./services/ai/strategy/participationEngine";
import { buildHybridContext } from "./services/ai/strategy/companyAwareContext";
import { generateCompanyInsights, recordMatchHistory } from "./services/ai/strategy/companyLearningInsights";
import { pncpMonitor } from "./services/monitoring/pncp-monitor.service";
import { recordAnalysisTelemetry, getPipelineHealth, classifySafetyNets } from "./services/ai/telemetry/analysisTelemetry";
import { ALERT_TAXONOMY, getCategoriesBySeverity, DEFAULT_ENABLED_CATEGORIES } from "./services/monitoring/alertTaxonomy";
import { NotificationService } from "./services/monitoring/notification.service";
import { startOpportunityScanner } from "./services/monitoring/opportunity-scanner.service";
import { startAllPollers } from "./services/monitoring/pollers";
import { submitJob, getJob, listJobs, registerSSEClient, removeSSEClient, updateJobProgress, completeJob, failJob } from "./services/backgroundJobService";
import { registerJobHandler, startJobWorker } from "./services/backgroundJobWorker";
import { handleApiError } from "./middlewares/errorHandler";
import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import https from 'https';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import { GoogleGenAI, createPartFromUri } from '@google/genai';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { storageService } from './storage';
import { createExtractorFromData } from 'node-unrar-js';
import { applySecurityMiddleware, authLimiter, aiLimiter, globalErrorHandler } from './lib/security';
import { encryptCredential, decryptCredential, isEncrypted, isEncryptionConfigured } from './lib/crypto';
import { requestLogger } from './lib/requestLogger';
import { logger } from './lib/logger';
import { getUsageSummary, getSystemUsageSummary } from './lib/aiUsageTracker';
import { authenticateToken, requireAdmin, requireSuperAdmin } from './middlewares/auth';
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import teamRoutes from './routes/team';
import companiesRoutes from './routes/companies';
import documentsRoutes from './routes/documents';
import biddingsRoutes from './routes/biddings';
import pncpRoutes from './routes/pncp';
import {
    normalizeModality, normalizePortal, hasMonitorableDomain,
    detectPlatformFromLink, sanitizeBiddingData,
    MONITORABLE_DOMAINS, PLATFORM_DOMAINS
} from './lib/biddingHelpers';

// Resolve server root (handles both ts-node and compiled dist/)
const SERVER_ROOT = __dirname.endsWith('dist') ? path.resolve(__dirname, '..') : __dirname;

// Load .env only if it exists (don't override Railway/Docker env vars)
dotenv.config({ path: path.join(SERVER_ROOT, '.env'), override: false });

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;
import { JWT_SECRET, BCRYPT_COST } from './lib/constants';

// PROCESS_ROLE: 'api' = HTTP only (no pollers), 'worker' = pollers only, 'all' = both (legacy default)
const PROCESS_ROLE = (process.env.PROCESS_ROLE || 'all').toLowerCase();

// ── Security Middleware (Helmet, CORS, Rate Limiting, Logging) ──
applySecurityMiddleware(app);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Observability: Request logging with correlation IDs ──
app.use(requestLogger);

// ── Health Check (for Docker/Railway/load balancers) ──
app.get('/health', async (_req, res) => {
    const mem = process.memoryUsage();
    try {
        await prisma.$queryRaw`SELECT 1`;
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
    } catch (err: any) {
        res.status(503).json({
            status: 'unhealthy',
            reason: 'database_unreachable',
            error: err.message,
        });
    }
});

// Auth
app.use('/api/auth', authRoutes);

/**
 * Helper to fetch file buffer from multiple sources:
 * 1. Storage Service (Supabase/Local)
 * 2. Local File System Fallback
 * 3. Database Blob Fallback (if applicable)
 */
async function getFileBufferSafe(fileNameOrUrl: string, tenantId?: string): Promise<Buffer | null> {
    try {
        // Try Storage Service first
        return await storageService.getFileBuffer(fileNameOrUrl);
    } catch (err) {
        logger.warn(`[Storage] StorageService failed for ${fileNameOrUrl}, trying fallbacks...`);

        // 1. Local disk fallback (legacy or local mode)
        const pureName = path.basename(fileNameOrUrl).split('?')[0];
        const localPath = path.join(uploadDir, pureName);
        if (fs.existsSync(localPath)) {
            return fs.readFileSync(localPath);
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
const uploadDir = process.env.NODE_ENV === 'production' ? '/app/uploads' : path.join(SERVER_ROOT, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Gemini Setup (lazy - don't crash if key missing)
const apiKey = process.env.GEMINI_API_KEY || '';
logger.info('Gemini API Key present:', !!apiKey);
let genAI: GoogleGenAI | null = null;
if (apiKey) {
    genAI = new GoogleGenAI({
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
        const filePath = path.join(uploadDir, filename);

        // If file exists on disk (cache hit), serve it immediately
        if (fs.existsSync(filePath)) {
            return res.sendFile(filePath);
        }

        // Recovery mode: If file is missing on disk, search in Database
        // We match by the end of the URL (filename)
        const doc = await prisma.document.findFirst({
            where: { fileUrl: { endsWith: filename } }
        });

        if (doc && doc.fileContent) {
            logger.info(`[Persistence] Recovering ${filename} from database to disk...`);
            fs.writeFileSync(filePath, doc.fileContent);
            return res.sendFile(filePath);
        }

        next();
    } catch (error) {
        logger.error(`[Persistence] Error during file recovery:`, error);
        next();
    }
});

// ── Supabase URL Proxy (migration safety net) ──
// When the DB has old supabase.co URLs, the frontend requests go through this proxy.
// The storageService (in RAILWAY mode) fetches from Supabase, caches locally, and serves.
app.get('/api/storage-proxy', async (req, res) => {
    try {
        const url = req.query.url as string;
        if (!url || !url.startsWith('http')) {
            return res.status(400).json({ error: 'Missing or invalid url parameter' });
        }

        const buffer = await storageService.getFileBuffer(url);

        // Determine content type from extension
        const ext = path.extname(url.split('?')[0]).toLowerCase();
        const contentTypes: Record<string, string> = {
            '.pdf': 'application/pdf',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        };
        const contentType = contentTypes[ext] || 'application/octet-stream';

        res.set('Content-Type', contentType);
        res.set('Content-Length', String(buffer.length));
        res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24h
        res.send(buffer);
    } catch (err: any) {
        logger.warn(`[Storage Proxy] Failed: ${err.message}`);
        res.status(404).json({ error: 'File not found' });
    }
});

// Fallback static serving (still good for files that ARE there)
app.use('/uploads', express.static(uploadDir));

// Configure Multer storage to use Memory (for cloud readiness)
const upload = multer({ storage: multer.memoryStorage() });

// Basic health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'LicitaSaaS API is running' });
});

// ── Admin: Backup Manual do Banco ──
app.post('/api/admin/backup', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
        const { runBackup } = await import('./scripts/backup-database');
        res.json({ message: 'Backup iniciado. Aguarde...' });
        // Run async (don't block response)
        runBackup().then(result => {
            if (result.success) {
                logger.info(`[Backup] ✅ Manual backup completed: ${result.fileName} (${result.sizeKB}KB)`);
            } else {
                logger.error(`[Backup] ❌ Manual backup failed: ${result.error}`);
            }
        });
    } catch (error: any) {
        logger.error('[Backup] Failed to start backup:', error);
        res.status(500).json({ error: 'Failed to start backup' });
    }
});

// Debug endpoint — safe counts only (no credential exposure)
app.get('/api/debug-db', authenticateToken, async (req: any, res) => {
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
    } catch (e: any) {
        handleApiError(res, e, 'debug-counts');
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
    } catch (e: any) {
        res.status(400).json({ error: e.message });
    }
});

// Recovery endpoint: finds docs missing from disk and recovers from DB fileContent
app.get('/api/debug-recovery', async (req, res) => {
    try {
        const recover = req.query.recover === 'true';
        const cleanup = req.query.cleanup === 'true';
        
        // Find all documents with /uploads/ URLs
        const docs = await prisma.document.findMany({
            where: { fileUrl: { startsWith: '/uploads/' } },
            select: { id: true, fileUrl: true, fileName: true, fileContent: true }
        });
        
        const onDisk: string[] = [];
        const missingWithContent: string[] = [];
        const missingNoContent: { id: string; fname: string }[] = [];
        let recovered = 0;
        let cleaned = 0;
        
        for (const doc of docs) {
            const fname = path.basename(doc.fileUrl);
            const filePath = path.join(uploadDir, fname);
            
            if (fs.existsSync(filePath)) {
                onDisk.push(fname);
            } else if (doc.fileContent && doc.fileContent.length > 0) {
                missingWithContent.push(fname);
                if (recover) {
                    fs.writeFileSync(filePath, doc.fileContent);
                    recovered++;
                    logger.info(`[Recovery] ✅ Restored from DB: ${fname} (${Math.round(doc.fileContent.length / 1024)}KB)`);
                }
            } else {
                missingNoContent.push({ id: doc.id, fname });
            }
        }
        
        // Cleanup: delete orphaned records (no file on disk, no fileContent in DB)
        if (cleanup && missingNoContent.length > 0) {
            const ids = missingNoContent.map(m => m.id);
            const result = await prisma.document.deleteMany({ where: { id: { in: ids } } });
            cleaned = result.count;
            logger.info(`[Cleanup] 🗑️ Deleted ${cleaned} orphaned document records`);
        }
        
        // Check TechnicalCertificate - just count missing (no fileContent column on this model)
        const certs = await prisma.technicalCertificate.findMany({
            where: { fileUrl: { startsWith: '/uploads/' } },
            select: { id: true, fileUrl: true }
        });
        
        let certsMissing = 0;
        for (const cert of certs) {
            const fname = path.basename(cert.fileUrl);
            const filePath = path.join(uploadDir, fname);
            if (!fs.existsSync(filePath)) {
                certsMissing++;
            }
        }
        
        res.json({
            totalDocs: docs.length,
            onDisk: onDisk.length,
            missingWithContent: missingWithContent.length,
            missingNoContent: missingNoContent.length,
            certsMissing,
            recovered: recover ? recovered : 'add ?recover=true to restore',
            cleaned: cleanup ? cleaned : 'add ?cleanup=true to delete orphans',
            missingFiles: missingNoContent.map(m => m.fname).slice(0, 20),
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Admin Management (Tenants, Quotas, Global Health, etc.)
app.use('/api/admin', adminRoutes);

// Team & Users Management
app.use('/api/team', teamRoutes);
// Companies, Credentials & Config  (router has /*, /credentials/*, /config/* paths)
app.use('/api', companiesRoutes);

// Documents & Technical Certificates (router has /*, /technical-certificates/* paths)
app.use('/api', documentsRoutes);

// Biddings CRUD + AutoEnrich + AutoMonitor (Sprint 8.1 — extracted from index.ts)
app.use('/api/biddings', biddingsRoutes);

// PNCP Searches, Scanner, Favorites (Sprint 8.1 — extracted from index.ts)
app.use('/api/pncp', pncpRoutes);
import pncpAnalyzeRoutes from './routes/pncpAnalyze';
app.use('/api/pncp', pncpAnalyzeRoutes);
import chatMonitorRoutes from './routes/chatMonitor';
import proposalRoutes from './routes/proposals';
import analysisRoutes, { injectAnalysisDeps } from './routes/analysis';
app.use('/api/chat-monitor', chatMonitorRoutes);
app.use('/api/proposals', proposalRoutes);  // proposals + dossier

// Inject dependencies required by analysis routes
injectAnalysisDeps({
    getFileBufferSafe,
    fetchPdfPartsForProcess,
    registerSSEClient,
    removeSSEClient,
    submitJob,
    getJob,
    listJobs,
});
app.use('/api/analyze-edital', analysisRoutes);  // analyze-edital + petitions + jobs + events

// V3 Pipeline — Zerox-enhanced analysis (parallel to V2)
import analysisV3Routes, { injectV3Deps } from './routes/analysisV3';
injectV3Deps({ getFileBufferSafe });
app.use('/api/analyze-edital', analysisV3Routes);  // v3 + v3/status

import declarationRoutes from './routes/declarations';
import governanceRoutes from './routes/governance';
app.use('/api', declarationRoutes);  // declarations
app.use('/api', governanceRoutes);   // ai governance + company + strategy

// ── Stub endpoints to prevent 404s that hold browser HTTP connections ──
// These endpoints are called by Dashboard, BiddingPage, and SSE hooks on mount.
// Without stubs, they return 404 and keep TCP connections in pending/closing state,
// saturating the browser's per-domain connection limit (6 for HTTP/1.1).
app.get('/api/documents', authenticateToken, (_req: any, res: any) => { res.json([]); });
app.get('/api/jobs', authenticateToken, (_req: any, res: any) => { res.json([]); });
app.get('/api/admin/monitoring-audit', authenticateToken, (_req: any, res: any) => { res.json({ recentAnalyses: [], errorRate: 0, avgLatency: 0 }); });
// ═══════════════════════════════════════════════════════════════

app.post('/api/internal/scanner/reset-and-scan', async (req: any, res) => {
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
        logger.info(`[OpportunityScanner] 🔄 Internal reset: ${deleted.count} registros removidos para tenant ${tenantId}`);
        
        const { runOpportunityScan } = await import('./services/monitoring/opportunity-scanner.service');
        runOpportunityScan().catch(err => logger.error('[OpportunityScanner] Scan error:', err));
        
        res.json({ success: true, deleted: deleted.count, message: `Reset OK (${deleted.count} removed). Scan triggered.` });
    } catch (error: any) {
        logger.error("Internal reset error:", error);
        handleApiError(res, error, 'scanner-reset');
    }
});

// ─── AI Services Imports estão no topo do arquivo ───


// Ai Analysis

// ── Utility Functions (shared with extracted routes) ──
const ADMIN_TELEGRAM_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID || '';
const pollerLastSuccess = new Map<string, Date>();
const watchdogActiveAlerts = new Set<string>();

async function sendAdminAlert(message: string) {
    if (!ADMIN_TELEGRAM_CHAT_ID) return;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return;
    try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: ADMIN_TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML',
        }, { timeout: 10000 });
    } catch (err: any) {
        logger.error(`[Watchdog] ❌ Failed to send admin alert:`, err.message);
    }
}

async function runWatchdogCheck() {
    const now = new Date();
    const alerts: string[] = [];
    const pollerThresholds: Record<string, number> = {
        'BLL+BNC': 10 * 60_000, 'PCP': 15 * 60_000, 'Licitanet': 15 * 60_000, 'LMB': 15 * 60_000,
    };
    for (const [name, thresholdMs] of Object.entries(pollerThresholds)) {
        const lastSuccess = pollerLastSuccess.get(name);
        if (!lastSuccess) continue;
        const elapsedMs = now.getTime() - lastSuccess.getTime();
        if (elapsedMs > thresholdMs) {
            const mins = Math.floor(elapsedMs / 60_000);
            if (!watchdogActiveAlerts.has(name)) {
                alerts.push(`⚠️ <b>${name}</b> não completa um ciclo há <b>${mins} minutos</b>`);
                watchdogActiveAlerts.add(name);
            }
        } else {
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
        } else {
            watchdogActiveAlerts.delete('NotificationQueue');
        }
    } catch { }
    if (alerts.length > 0) {
        const msg = `🔴 <b>ALERTA DO SISTEMA — LicitaSaaS</b>\n\n` + alerts.join('\n') + '\n\n' +
                    `<i>${now.toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })}</i>`;
        await sendAdminAlert(msg);
    }
}

async function runAutoSetup() {
    try {
        logger.info('🔍 Verificando integridade dos dados e tenants...');
        let tenant = await prisma.tenant.findUnique({ where: { rootCnpj: '00000000' } });
        if (!tenant) {
            logger.info('🏗️ Criando Tenant Principal...');
            tenant = await prisma.tenant.create({ data: { razaoSocial: 'LicitaSaaS Brasil', rootCnpj: '00000000' } });
        }
        const adminEmail = 'admin@licitasaas.com';
        const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
        if (!admin) {
            logger.info('🏗️ Criando Usuário Administrador...');
            const salt = await bcrypt.genSalt(BCRYPT_COST);
            const passwordHash = await bcrypt.hash('admin123', salt);
            await prisma.user.create({ data: { email: adminEmail, name: 'Administrador', passwordHash, role: 'ADMIN', tenantId: tenant.id } });
        } else if (admin.tenantId !== tenant.id) {
            await prisma.user.update({ where: { email: adminEmail }, data: { tenantId: tenant.id } });
        }
    } catch (error) {
        logger.error('❌ Erro no runAutoSetup:', error);
    }
}

async function fetchPdfPartsForProcess(biddingProcessId: string | null, fileNamesRaw: string[], tenantId: string): Promise<any[]> {
    const pdfParts: any[] = [];
    const biddingLinks = biddingProcessId ? (await prisma.biddingProcess.findUnique({ where: { id: biddingProcessId } }))?.link || "" : "";
    for (let fileName of fileNamesRaw) {
        fileName = decodeURIComponent(fileName).split('?')[0];
        const doc = await prisma.document.findFirst({ where: { fileUrl: { contains: fileName }, tenantId } });
        const hasPrefix = fileName.startsWith(tenantId) || fileName.startsWith(`pncp_${tenantId}`);
        const isExplicitlyLinked = biddingLinks.includes(fileName);
        if (!(!!doc || hasPrefix || isExplicitlyLinked)) continue;
        const fileToFetch = doc ? doc.fileUrl : fileName;
        const pdfBuffer = await getFileBufferSafe(fileToFetch, tenantId);
        if (pdfBuffer) {
            pdfParts.push({ inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' } });
        }
    }
    return pdfParts;
}

// ── Frontend Static Serving (Vite dist / Docker public) ──
const possibleDistPaths = [
    path.join(SERVER_ROOT, 'public'),              // Dockerfile production path (moved from dist -> public)
    path.join(SERVER_ROOT, '..', 'dist'),          // Parent dir (local monorepo root)
    path.join(SERVER_ROOT, 'dist'),                // Inside server root
    path.join(process.cwd(), '..', 'dist'),        // Using cwd
    path.join(process.cwd(), 'dist'),              // Using cwd direct
    '/app/dist',                                   // Railway Nixpacks specific
    '/workspace/dist'                              // Railway standard path
];

let frontendDist = '';
for (const p of possibleDistPaths) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, 'index.html'))) {
        frontendDist = p;
        break;
    }
}

if (frontendDist) {
    logger.info(`[Frontend] Found and serving static UI from: ${frontendDist}`);
    app.use(express.static(frontendDist));
    
    // Fallback for React Router (catch-all)
    // Using app.use() instead of app.get('*') to avoid Express 5 path-to-regexp crash
    app.use((req, res, next) => {
        if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/uploads/')) {
            res.sendFile(path.join(frontendDist, 'index.html'));
        } else {
            next();
        }
    });
} else {
    logger.error(`[Frontend] CRITICAL: UI Build (dist) not found in any expected location!`);
    logger.error(`Tested paths: ${possibleDistPaths.join(', ')}`);
}

app.listen(PORT, async () => {
    logger.info(`Server is running on port ${PORT} (mode: ${process.env.NODE_ENV || 'development'})`);
    logger.info(`Upload directory: ${uploadDir}`);
    await runAutoSetup();

    // Initialize version catalog
    registerInitialVersions();
    logger.info(`[Governance] Version catalog initialized with ${getAllVersions().length} components`);

    // ── Background Job Worker — Process async AI tasks ──
    registerJobHandler('edital_analysis', async (job: any) => {
        const { fileNames, biddingProcessId } = job.input;
        const tenantId = job.tenantId;

        await updateJobProgress(job.id, tenantId, { progress: 10, progressMsg: 'Preparando documentos...' });

        // Re-use the existing sync pipeline by making an internal HTTP call
        // This ensures zero code duplication and the legacy endpoint stays as-is
        const internalUrl = `http://localhost:${PORT}/api/analyze-edital/v2`;

        // Get a valid token for this user/tenant
        const jwt = require('jsonwebtoken');
        const internalToken = jwt.sign(
            { id: job.userId, tenantId: job.tenantId, role: 'Admin' },
            JWT_SECRET,
            { expiresIn: '10m' }
        );

        await updateJobProgress(job.id, tenantId, { progress: 20, progressMsg: 'Etapa 1/3 — Extração Factual...' });

        // Simulate progress updates while the pipeline runs
        let progressPercent = 20;
        const progressTimer = setInterval(async () => {
            progressPercent = Math.min(progressPercent + 10, 90);
            const stages: Record<number, string> = {
                30: 'Etapa 1/3 — Extração Factual...',
                50: 'Etapa 2/3 — Normalização...',
                70: 'Etapa 3/3 — Revisão de Risco...',
                85: 'Validando e finalizando...',
            };
            const msg = stages[Math.round(progressPercent / 10) * 10] || `Processando... (${progressPercent}%)`;
            try {
                await updateJobProgress(job.id, tenantId, { progress: progressPercent, progressMsg: msg });
            } catch { /* ignore */ }
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

            await updateJobProgress(job.id, tenantId, { progress: 95, progressMsg: 'Salvando resultado...' });

            return result;
        } catch (err) {
            clearInterval(progressTimer);
            throw err;
        }
    });

    registerJobHandler('pncp_analysis', async (job: any) => {
        const { orgao_cnpj, ano, numero_sequencial, link_sistema } = job.input;
        const tenantId = job.tenantId;

        await updateJobProgress(job.id, tenantId, { progress: 5, progressMsg: 'Iniciando análise PNCP...' });

        const internalUrl = `http://localhost:${PORT}/api/pncp/analyze`;
        const jwt = require('jsonwebtoken');
        const internalToken = jwt.sign(
            { id: job.userId, tenantId: job.tenantId, role: 'Admin' },
            JWT_SECRET,
            { expiresIn: '10m' }
        );

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

            if (!response.body) throw new Error('Falha ao abrir stream de resposta local');

            // Parse SSE chunks manually in Node.js
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finalResult: any = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const parts = buffer.split('\n\n');
                buffer = parts.pop() || '';
                for (const part of parts) {
                    const line = part.trim();
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const event = JSON.parse(line.slice(6));
                        if (event.type === 'progress') {
                            await updateJobProgress(job.id, tenantId, {
                                progress: event.percent,
                                progressMsg: event.message
                            });
                        } else if (event.type === 'result') {
                            finalResult = event.payload;
                        } else if (event.type === 'error') {
                            throw new Error(event.error || 'Erro interno na stream');
                        }
                    } catch (e: any) {
                        if (e.message && !e.message.includes('JSON')) throw e;
                    }
                }
            }

            if (!finalResult) throw new Error('Nenhum dado final recebido do pipeline PNCP');
            
            await updateJobProgress(job.id, tenantId, { progress: 100, progressMsg: 'Concluído' });
            return finalResult;
        } catch (err) {
            throw err;
        }
    });

    registerJobHandler('oracle', async (job: any) => {
        const tenantId = job.tenantId;
        await updateJobProgress(job.id, tenantId, { progress: 10, progressMsg: 'Iniciando verificação de compatibilidade no Oráculo...' });

        const internalUrl = `http://localhost:${PORT}/api/technical-certificates/compare`;
        const jwt = require('jsonwebtoken');
        const internalToken = jwt.sign(
            { id: job.userId, tenantId: job.tenantId, role: 'Admin' },
            JWT_SECRET,
            { expiresIn: '10m' }
        );

        let progressPercent = 10;
        const progressTimer = setInterval(async () => {
            progressPercent = Math.min(progressPercent + 15, 95);
            await updateJobProgress(job.id, tenantId, { progress: progressPercent, progressMsg: 'Analisando acervos contra exigências...' }).catch(() => {});
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

            await updateJobProgress(job.id, tenantId, { progress: 100, progressMsg: 'Concluído' });
            return await response.json();
        } finally {
            clearInterval(progressTimer);
        }
    });

    registerJobHandler('proposal_populate', async (job: any) => {
        const tenantId = job.tenantId;
        await updateJobProgress(job.id, tenantId, { progress: 10, progressMsg: 'Iniciando preenchimento da proposta...' });

        const internalUrl = `http://localhost:${PORT}/api/proposals/ai-populate`;
        const jwt = require('jsonwebtoken');
        const internalToken = jwt.sign(
            { id: job.userId, tenantId: job.tenantId, role: 'Admin' },
            JWT_SECRET,
            { expiresIn: '10m' }
        );

        let progressPercent = 10;
        const progressTimer = setInterval(async () => {
            progressPercent = Math.min(progressPercent + 10, 95);
            await updateJobProgress(job.id, tenantId, { progress: progressPercent, progressMsg: 'Extraindo e preenchendo itens comerciais...' }).catch(() => {});
        }, 4000);

        try {
            const response = await fetch(internalUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${internalToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ...job.input, __jobId: job.id }),
            });
            clearInterval(progressTimer);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.error || `Preenchimento retornou ${response.status}`);
            }

            await updateJobProgress(job.id, tenantId, { progress: 100, progressMsg: 'Concluído' });
            return await response.json();
        } finally {
            clearInterval(progressTimer);
        }
    });

    registerJobHandler('petition', async (job: any) => {
        const tenantId = job.tenantId;
        await updateJobProgress(job.id, tenantId, { progress: 10, progressMsg: 'Preparando contexto da petição...' });

        const internalUrl = `http://localhost:${PORT}/api/petitions/generate`;
        const jwt = require('jsonwebtoken');
        const internalToken = jwt.sign(
            { id: job.userId, tenantId: job.tenantId, role: 'Admin' },
            JWT_SECRET,
            { expiresIn: '10m' }
        );

        let progressPercent = 10;
        const progressTimer = setInterval(async () => {
            progressPercent = Math.min(progressPercent + 20, 95);
            await updateJobProgress(job.id, tenantId, { progress: progressPercent, progressMsg: 'Redigindo fundamentação e documentos...' }).catch(() => {});
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

            await updateJobProgress(job.id, tenantId, { progress: 100, progressMsg: 'Concluído' });
            return await response.json();
        } finally {
            clearInterval(progressTimer);
        }
    });

    registerJobHandler('declaration', async (job: any) => {
        const tenantId = job.tenantId;
        await updateJobProgress(job.id, tenantId, { progress: 10, progressMsg: 'Iniciando geração de declaração...' });

        const internalUrl = `http://localhost:${PORT}/api/generate-declaration`;
        const jwt = require('jsonwebtoken');
        const internalToken = jwt.sign(
            { id: job.userId, tenantId: job.tenantId, role: 'Admin' },
            JWT_SECRET,
            { expiresIn: '10m' }
        );

        let progressPercent = 10;
        const progressTimer = setInterval(async () => {
            progressPercent = Math.min(progressPercent + 25, 95);
            await updateJobProgress(job.id, tenantId, { progress: progressPercent, progressMsg: 'Formatando declarações jurídicas...' }).catch(() => {});
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

            await updateJobProgress(job.id, tenantId, { progress: 100, progressMsg: 'Concluído' });
            return await response.json();
        } finally {
            clearInterval(progressTimer);
        }
    });

    startJobWorker();
    logger.info('[BackgroundJob] 🚀 Worker started — async AI operations enabled');
    
    // PNCP Monitor disabled — ComprasNet Watcher handles all chat monitoring
    // pncpMonitor.startPolling(5);

    // ── System Health Watchdog: check every 5 minutes ──
    if (ADMIN_TELEGRAM_CHAT_ID) {
        setTimeout(() => {
            logger.info('[Watchdog] 🐕 System health watchdog started (interval: 5 min)');
            setInterval(runWatchdogCheck, 5 * 60_000);
        }, 3 * 60_000); // Start 3 min after boot (give pollers time to initialize)
    } else {
        logger.info('[Watchdog] ⚠️ ADMIN_TELEGRAM_CHAT_ID not set — watchdog disabled');
    }

    // ── Background Workers (only run when PROCESS_ROLE is 'all' or 'worker') ──
    if (PROCESS_ROLE === 'api') {
        logger.info('[Server] PROCESS_ROLE=api — background pollers disabled (running in separate worker process)');
    } else {
        // Start all chat monitoring pollers (shared module — same code as worker.ts)
        startAllPollers({
            prisma,
            onCycleSuccess: (pollerName) => {
                pollerLastSuccess.set(pollerName, new Date());
            },
            delays: [30_000, 45_000, 60_000, 75_000], // Slightly longer delays in server context
        });
    } // end of PROCESS_ROLE !== 'api' block

});


// ── Opportunity Scanner: Auto-scan saved PNCP searches every 4 hours ──
if (PROCESS_ROLE !== 'api') {
    startOpportunityScanner(4);
    
    // ── PNCP Aggregator: sincroniza base local a cada 20 minutos ──
    // Re-ativado inline pois o serviço dedicado pncp-aggregator foi removido.
    // Intervalo de 20min (vs 15min do worker) para reduzir carga no processo API.
    setTimeout(async () => {
        try {
            const { runPncpSync, getPncpAggregatorStats } = await import('./workers/pncpAggregator');
            logger.info('[PNCP-AGG] 🚀 Aggregator inline iniciado (intervalo: 20min)');
            try {
                await runPncpSync();
                const stats = await getPncpAggregatorStats();
                logger.info(`[PNCP-AGG] ✅ Primeira sync: ${stats.totalContratacoes} contratações, ${stats.totalAbertos} abertas`);
            } catch (e: any) {
                logger.error('[PNCP-AGG] ❌ Primeira sync falhou:', e.message);
            }
            setInterval(async () => {
                try {
                    const { runPncpSync } = await import('./workers/pncpAggregator');
                    await runPncpSync();
                } catch (e: any) { logger.error('[PNCP-AGG] sync error:', e.message); }
            }, 20 * 60_000); // 20 minutos
        } catch (e: any) {
            logger.error('[PNCP-AGG] ❌ Falha ao carregar módulo aggregator:', e.message);
        }
    }, 120_000); // 2 min após boot (depois dos pollers)
} else {
    logger.info('[Server] Opportunity Scanner disabled (PROCESS_ROLE=api)');
}

// Keep event loop alive (required in this environment)
setInterval(() => { }, 1 << 30);
