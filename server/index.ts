import { robustJsonParse, robustJsonParseDetailed } from "./services/ai/parser.service";
import { callGeminiWithRetry } from "./services/ai/gemini.service";
import { ANALYZE_EDITAL_SYSTEM_PROMPT, USER_ANALYSIS_INSTRUCTION, EXTRACT_CERTIFICATE_SYSTEM_PROMPT, COMPARE_CERTIFICATE_SYSTEM_PROMPT, MASTER_PETITION_SYSTEM_PROMPT, PETITION_USER_INSTRUCTION, V2_EXTRACTION_PROMPT, V2_NORMALIZATION_PROMPT, V2_RISK_REVIEW_PROMPT, V2_EXTRACTION_USER_INSTRUCTION, V2_NORMALIZATION_USER_INSTRUCTION, V2_RISK_REVIEW_USER_INSTRUCTION, V2_PROMPT_VERSION, getDomainRoutingInstruction, NORM_CATEGORIES, buildCategoryNormPrompt, buildCategoryNormUser, MANUAL_EXTRACTION_ADDON } from "./services/ai/prompt.service";
import { AnalysisSchemaV1, createEmptyAnalysisSchema } from "./services/ai/analysis-schema-v1";
import { fallbackToOpenAi, fallbackToOpenAiV2 } from "./services/ai/openai.service";
import { indexDocumentChunks, searchSimilarChunks } from "./services/ai/rag.service";
import { executeRiskRules } from "./services/ai/riskRulesEngine";
import { evaluateAnalysisQuality } from "./services/ai/analysisQualityEvaluator";
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
import { ALERT_TAXONOMY, getCategoriesBySeverity, DEFAULT_ENABLED_CATEGORIES } from "./services/monitoring/alertTaxonomy";
import { NotificationService } from "./services/monitoring/notification.service";
import { startOpportunityScanner } from "./services/monitoring/opportunity-scanner.service";
import { BatchPlatformMonitor } from "./services/monitoring/batch-platform-monitor.service";
import { PCPMonitor } from "./services/monitoring/pcp-monitor.service";
import { LicitanetMonitor } from "./services/monitoring/licitanet-monitor.service";
import { LicitaMaisBrasilMonitor } from "./services/monitoring/licitamaisbrasil-monitor.service";
import { IngestService } from "./services/monitoring/ingest.service";
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
import teamRoutes from './routes/team';
import companiesRoutes from './routes/companies';
import documentsRoutes from './routes/documents';

// Resolve server root (handles both ts-node and compiled dist/)
const SERVER_ROOT = __dirname.endsWith('dist') ? path.resolve(__dirname, '..') : __dirname;

// Load .env only if it exists (don't override Railway/Docker env vars)
dotenv.config({ path: path.join(SERVER_ROOT, '.env'), override: false });

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

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
        console.warn(`[Storage] StorageService failed for ${fileNameOrUrl}, trying fallbacks...`);

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
const uploadDir = path.join(SERVER_ROOT, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Gemini Setup (lazy - don't crash if key missing)
const apiKey = process.env.GEMINI_API_KEY || '';
console.log('Gemini API Key present:', !!apiKey);
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
            console.log(`[Persistence] Recovering ${filename} from database to disk...`);
            fs.writeFileSync(filePath, doc.fileContent);
            return res.sendFile(filePath);
        }

        next();
    } catch (error) {
        console.error(`[Persistence] Error during file recovery:`, error);
        next();
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
                console.log(`[Backup] ✅ Manual backup completed: ${result.fileName} (${result.sizeKB}KB)`);
            } else {
                console.error(`[Backup] ❌ Manual backup failed: ${result.error}`);
            }
        });
    } catch (error: any) {
        console.error('[Backup] Failed to start backup:', error);
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
        res.status(500).json({ error: e.message });
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

// ═══════════════════════════════════════════════════════════════
// GESTÃO DE TENANTS & ONBOARDING (Admin-only)
// ═══════════════════════════════════════════════════════════════

// List all tenants with user count (super-admin)
app.get('/api/admin/tenants', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
        const tenants = await prisma.tenant.findMany({
            include: {
                _count: { select: { users: true, companies: true, biddingProcesses: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(tenants.map(t => ({
            id: t.id,
            razaoSocial: t.razaoSocial,
            rootCnpj: t.rootCnpj,
            createdAt: t.createdAt,
            stats: {
                users: t._count.users,
                companies: t._count.companies,
                biddings: t._count.biddingProcesses,
            }
        })));
    } catch (error: any) {
        console.error('[Admin] Erro ao listar tenants:', error?.message);
        res.status(500).json({ error: 'Erro ao listar organizações' });
    }
});

// Onboard new client — creates Tenant + Admin User in one step
app.post('/api/admin/onboard', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
        const { razaoSocial, rootCnpj, adminName, adminEmail, adminPassword } = req.body;

        // ── Validações ──
        if (!razaoSocial || !rootCnpj || !adminName || !adminEmail || !adminPassword) {
            return res.status(400).json({
                error: 'Campos obrigatórios: razaoSocial, rootCnpj, adminName, adminEmail, adminPassword'
            });
        }
        if (adminPassword.length < 6) {
            return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
        }

        // ── Verificar duplicatas ──
        const existingTenant = await prisma.tenant.findUnique({ where: { rootCnpj } });
        if (existingTenant) {
            return res.status(409).json({ error: `Já existe uma organização com CNPJ ${rootCnpj}` });
        }
        const existingUser = await prisma.user.findUnique({ where: { email: adminEmail } });
        if (existingUser) {
            return res.status(409).json({ error: `O e-mail ${adminEmail} já está em uso` });
        }

        // ── Criar Tenant + Admin em transação ──
        const result = await prisma.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({
                data: { razaoSocial, rootCnpj }
            });

            const passwordHash = await bcrypt.hash(adminPassword, 10);
            const admin = await tx.user.create({
                data: {
                    tenantId: tenant.id,
                    name: adminName,
                    email: adminEmail,
                    passwordHash,
                    role: 'ADMIN',
                    isActive: true,
                }
            });

            return { tenant, admin };
        });

        console.log(`[Onboard] ✅ Novo cliente: "${razaoSocial}" (${rootCnpj}) → Admin: ${adminEmail}`);

        res.status(201).json({
            message: `Cliente "${razaoSocial}" provisionado com sucesso!`,
            tenant: {
                id: result.tenant.id,
                razaoSocial: result.tenant.razaoSocial,
                rootCnpj: result.tenant.rootCnpj,
            },
            admin: {
                id: result.admin.id,
                name: result.admin.name,
                email: result.admin.email,
                role: result.admin.role,
            },
            loginUrl: `${process.env.FRONTEND_URL || 'https://licitasaas-production.up.railway.app'}`,
            instructions: 'Envie o e-mail e senha ao cliente. Ele pode alterar a senha após o primeiro login.',
        });
    } catch (error: any) {
        console.error('[Onboard] Erro ao provisionar cliente:', error?.message);
        res.status(500).json({ error: 'Erro ao provisionar novo cliente' });
    }
});

// Legacy: Create tenant (now protected)
app.post('/api/tenants', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
        const tenant = await prisma.tenant.create({ data: req.body });
        res.json(tenant);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create tenant' });
    }
});

// ═══════════════════════════════════════════════════════════════
// GESTÃO DE COTAS DE IA (Admin-only)
// ═══════════════════════════════════════════════════════════════

// Get all tenants with AI usage summary (for admin quota management)
app.get('/api/admin/ai-quotas', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
        const { getTenantQuotaLimits } = await import('./lib/aiUsageTracker');

        const tenants = await prisma.tenant.findMany({
            select: { id: true, razaoSocial: true, rootCnpj: true },
            orderBy: { razaoSocial: 'asc' },
        });

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        // Aggregate usage per tenant in one query
        const usageByTenant = await prisma.aiUsageLog.groupBy({
            by: ['tenantId'],
            where: { createdAt: { gte: startOfMonth } },
            _sum: { totalTokens: true, inputTokens: true, outputTokens: true },
            _count: { id: true },
        });
        const usageMap = new Map(usageByTenant.map((u: any) => [u.tenantId, u]));

        const result = await Promise.all(tenants.map(async (t: any) => {
            const usage = usageMap.get(t.id);
            const { hardLimit, softLimit } = await getTenantQuotaLimits(prisma, t.id);
            const currentTokens = usage?._sum?.totalTokens || 0;
            const percentUsed = hardLimit > 0 ? Math.round((currentTokens / hardLimit) * 100) : 0;

            return {
                id: t.id,
                razaoSocial: t.razaoSocial,
                rootCnpj: t.rootCnpj,
                currentTokens,
                totalCalls: usage?._count?.id || 0,
                hardLimit,
                softLimit,
                percentUsed,
                status: currentTokens >= hardLimit ? 'critical' : currentTokens >= softLimit ? 'warning' : 'ok',
            };
        }));

        res.json(result);
    } catch (error: any) {
        console.error('[Admin] Erro ao listar cotas de IA:', error?.message);
        res.status(500).json({ error: 'Erro ao listar cotas de IA' });
    }
});

// Update AI quota for a specific tenant
app.put('/api/admin/ai-quotas/:tenantId', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
        const { tenantId } = req.params;
        const { hardLimit, softLimit } = req.body;
        const { invalidateTenantQuotaCache } = await import('./lib/aiUsageTracker');

        if (!hardLimit || hardLimit < 0) {
            return res.status(400).json({ error: 'hardLimit é obrigatório e deve ser positivo.' });
        }

        // Read or create GlobalConfig
        const gc = await prisma.globalConfig.upsert({
            where: { tenantId },
            create: { tenantId, config: JSON.stringify({ aiQuota: { hardLimit, softLimit: softLimit || Math.round(hardLimit * 0.75) } }) },
            update: {},
        });

        // Merge aiQuota into existing config
        let conf: any = {};
        try { conf = JSON.parse(gc.config || '{}'); } catch {}
        conf.aiQuota = {
            hardLimit,
            softLimit: softLimit || Math.round(hardLimit * 0.75),
        };

        await prisma.globalConfig.update({
            where: { tenantId },
            data: { config: JSON.stringify(conf) },
        });

        // Invalidate caches
        invalidateTenantQuotaCache(tenantId);

        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { razaoSocial: true } });
        console.log(`[Admin] Cotas de IA atualizadas para "${tenant?.razaoSocial || tenantId}": hard=${hardLimit}, soft=${conf.aiQuota.softLimit}`);

        res.json({ ok: true, aiQuota: conf.aiQuota });
    } catch (error: any) {
        console.error('[Admin] Erro ao atualizar cota de IA:', error?.message);
        res.status(500).json({ error: 'Erro ao atualizar cota de IA' });
    }
});

// Reset quota cache for a tenant (instant unblock without changing limits)
app.post('/api/admin/ai-quotas/:tenantId/reset', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
        const { tenantId } = req.params;
        const { invalidateTenantQuotaCache } = await import('./lib/aiUsageTracker');
        invalidateTenantQuotaCache(tenantId);
        console.log(`[Admin] Cache de cota de IA resetado para tenant ${tenantId}`);
        res.json({ ok: true, message: 'Cache limpo. Limites serão reavaliados na próxima chamada de IA.' });
    } catch (error: any) {
        res.status(500).json({ error: 'Erro ao resetar cache' });
    }
});

// Get detailed AI usage for a specific tenant (admin drill-down)
app.get('/api/admin/ai-usage/:tenantId', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
        const { tenantId } = req.params;
        const periodDays = parseInt(req.query.period as string) || 30;
        const { getDailyBreakdown, getQuotaStatus } = await import('./lib/aiUsageTracker');

        const [summary, daily, quota] = await Promise.all([
            getUsageSummary(prisma, tenantId, periodDays),
            getDailyBreakdown(prisma, tenantId, periodDays),
            getQuotaStatus(prisma, tenantId),
        ]);

        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { razaoSocial: true, rootCnpj: true } });

        res.json({ ok: true, tenant, ...summary, daily, quota });
    } catch (e: any) {
        console.error('[Admin] AI usage drill-down error:', e?.message);
        res.status(500).json({ error: 'Falha ao buscar consumo de IA do tenant.' });
    }
});

// Team & Users Management
app.use('/api/team', teamRoutes);


// Companies, Credentials & Config  (router has /*, /credentials/*, /config/* paths)
app.use('/api', companiesRoutes);

// Documents & Technical Certificates (router has /*, /technical-certificates/* paths)
app.use('/api', documentsRoutes);
// ═══════════════════════════════════════════════════════════════
// MÓDULO DECLARAÇÕES IA v5 — Gerador Juridicamente Confiável
// Fluxo-alvo: 12 etapas com validação + repair IA + re-validação
// Tipos: AuthoritativeFacts, DeclarationFamily → importados de services/ai/declaration
// ═══════════════════════════════════════════════════════════════


// ── Step 4: Classificação por Família ──

function classifyFamily(declarationType: string): DeclarationFamily {
    const lower = declarationType.toLowerCase();

    // TECHNICAL_PERSONAL — pessoal técnico, equipe, RT
    if (lower.includes('técnic') || lower.includes('equipe') ||
        lower.includes('pessoal') || lower.includes('engenhei') ||
        lower.includes('crea') || lower.includes('cau') ||
        lower.includes('responsável técnico') || lower.includes('indicação'))
        return 'TECHNICAL_PERSONAL';

    // CORPORATE_STATUS — enquadramento, ME/EPP, regularidade fiscal, econômica
    if (lower.includes('me/epp') || lower.includes('microempresa') ||
        lower.includes('pequeno porte') || lower.includes('enquadramento') ||
        lower.includes('econômic') || lower.includes('financei') ||
        lower.includes('patrimônio') || lower.includes('balanço') ||
        lower.includes('fiscal') || lower.includes('tribut') ||
        lower.includes('fgts') || lower.includes('inss') ||
        lower.includes('fazenda') || lower.includes('débito') ||
        lower.includes('falência') || lower.includes('recuperação judicial'))
        return 'CORPORATE_STATUS';

    // OPERATIONAL_COMMITMENT — compromissos operacionais
    if (lower.includes('visita') || lower.includes('disponibilidade') ||
        lower.includes('equipamento') || lower.includes('prazo') ||
        lower.includes('elaboração independente') || lower.includes('conhecimento') ||
        lower.includes('atestado') || lower.includes('vistoria'))
        return 'OPERATIONAL_COMMITMENT';

    // SIMPLE_COMPLIANCE — conformidade legal simples
    if (lower.includes('menor') || lower.includes('trabalho infantil') ||
        lower.includes('art. 7') || lower.includes('xxxiii') ||
        lower.includes('fato impeditivo') || lower.includes('idoneidade') ||
        lower.includes('nepotismo') || lower.includes('impedimento') ||
        lower.includes('vedação') || lower.includes('proibição') ||
        lower.includes('inexistência'))
        return 'SIMPLE_COMPLIANCE';

    return 'CUSTOM_GENERIC';
}

// ── Step 5: Contexto Específico do Edital ──

function extractFamilyContext(family: DeclarationFamily, schema: any): string {
    if (!schema) return '';
    const sections: string[] = [];
    const qi = schema?.qualification_requirements || schema?.requirements;
    const oo = schema?.operational_outputs;
    const pi = schema?.process_identification;
    const pc = schema?.participation_conditions;

    switch (family) {
        case 'SIMPLE_COMPLIANCE':
            if (pc) sections.push(`CONDIÇÕES DE PARTICIPAÇÃO:\n${JSON.stringify(pc, null, 1)}`);
            if (pi?.objeto) sections.push(`OBJETO: ${pi.objeto_completo || pi.objeto_resumido || pi.objeto}`);
            break;

        case 'OPERATIONAL_COMMITMENT':
            if (pi?.objeto) sections.push(`OBJETO: ${pi.objeto_completo || pi.objeto_resumido || pi.objeto}`);
            if (pc?.exige_visita_tecnica) sections.push(`VISITA TÉCNICA: ${pc.visita_tecnica_detalhes || 'Exigida'}`);
            if (pc?.exige_garantia_proposta) sections.push(`GARANTIA PROPOSTA: ${pc.garantia_proposta_detalhes || 'Exigida'}`);
            if (pc?.exige_garantia_contratual) sections.push(`GARANTIA CONTRATUAL: ${pc.garantia_contratual_detalhes || 'Exigida'}`);
            if (oo?.declaration_routes?.length > 0) {
                sections.push('DECLARAÇÕES PREVISTAS:\n' + oo.declaration_routes.map(
                    (d: any) => `  • ${typeof d === 'string' ? d : d.name || d.title || JSON.stringify(d)}`
                ).join('\n'));
            }
            break;

        case 'TECHNICAL_PERSONAL':
            if (qi?.qualificacao_tecnica_profissional) sections.push(`QUALIFICAÇÃO TÉCNICA PROFISSIONAL:\n${JSON.stringify(qi.qualificacao_tecnica_profissional, null, 1)}`);
            if (qi?.qualificacao_tecnica_operacional) sections.push(`QUALIFICAÇÃO TÉCNICA OPERACIONAL:\n${JSON.stringify(qi.qualificacao_tecnica_operacional, null, 1)}`);
            if (qi?.qualificacao_tecnica) sections.push(`QUALIFICAÇÃO TÉCNICA:\n${JSON.stringify(qi.qualificacao_tecnica, null, 1)}`);
            if (oo?.technical_requirements) sections.push(`REQUISITOS TÉCNICOS:\n${JSON.stringify(oo.technical_requirements, null, 1)}`);
            break;

        case 'CORPORATE_STATUS':
            if (qi?.habilitacao_juridica) sections.push(`HABILITAÇÃO JURÍDICA:\n${JSON.stringify(qi.habilitacao_juridica, null, 1)}`);
            if (qi?.regularidade_fiscal_trabalhista) sections.push(`REGULARIDADE FISCAL:\n${JSON.stringify(qi.regularidade_fiscal_trabalhista, null, 1)}`);
            if (qi?.regularidade_fiscal) sections.push(`REGULARIDADE FISCAL:\n${JSON.stringify(qi.regularidade_fiscal, null, 1)}`);
            if (qi?.qualificacao_economico_financeira) sections.push(`QUALIFICAÇÃO ECONÔMICO-FINANCEIRA:\n${JSON.stringify(qi.qualificacao_economico_financeira, null, 1)}`);
            if (qi?.qualificacao_economica) sections.push(`QUALIFICAÇÃO ECONÔMICA:\n${JSON.stringify(qi.qualificacao_economica, null, 1)}`);
            if (pc?.tratamento_me_epp) sections.push(`TRATAMENTO ME/EPP: ${pc.tratamento_me_epp}`);
            break;

        default: // CUSTOM_GENERIC
            if (oo?.declaration_routes?.length > 0) {
                sections.push('DECLARAÇÕES PREVISTAS NO EDITAL:\n' + oo.declaration_routes.map(
                    (d: any) => `  • ${typeof d === 'string' ? d : d.name || d.title || JSON.stringify(d)}`
                ).join('\n'));
            }
    }

    return sections.length > 0 ? sections.join('\n\n') : '';
}

// ── Step 6: Prompt Builder ──

function buildDeclarationPrompt(
    facts: AuthoritativeFacts,
    family: DeclarationFamily,
    familyContext: string,
    editalContext: string,
    issuerBlock: string,
    customPrompt: string | undefined,
    isTechnical: boolean,
    style: DeclarationStyle = 'objetiva',
    editalClause?: string,
): string {
    // Buscar mapa semântico que corresponde ao tipo da declaração
    const declLower = facts.declarationType.toLowerCase();
    const semanticMatch = DECLARATION_SEMANTIC_MAP.find(m =>
        m.keywords.some(kw => declLower.includes(kw.toLowerCase()))
    );

    return `Você é um Advogado Sênior especializado em Direito Administrativo e Contratações Públicas (Lei 14.133/2021).
Sua tarefa é redigir a declaração abaixo com RIGOR JURÍDICO MÁXIMO e ABSOLUTA FIDELIDADE FACTUAL.

TIPO: "${facts.declarationType}"
FAMÍLIA: ${family}

${issuerBlock}

╔══════════════════════════════════════════════════════════════╗
║  FATOS AUTORITATIVOS — IMUTÁVEIS (PREVALÊNCIA ABSOLUTA)     ║
╠══════════════════════════════════════════════════════════════╣
║  Empresa: ${facts.empresaRazaoSocial}
║  CNPJ: ${facts.empresaCnpj}
║  QUALIFICAÇÃO COMPLETA (transcrever LITERALMENTE como abertura da declaração):
║  ${facts.qualificacaoCompleta || `${facts.empresaRazaoSocial}, inscrita no CNPJ sob o nº ${facts.empresaCnpj}${facts.empresaEndereco ? `, com sede ${facts.empresaEndereco}` : ''}${facts.representanteNome ? `, neste ato representada por seu ${facts.representanteCargo || 'Representante Legal'} ${facts.representanteNome}${facts.representanteCpf ? `, CPF ${facts.representanteCpf}` : ''}` : ''}`}
║  Órgão: ${facts.orgaoLicitante}
║  Modalidade: ${facts.modalidade}
║  Edital nº: ${facts.editalNumero || 'Não identificado'}
║  Processo nº: ${facts.processoNumero || 'Não identificado'}
║  Objeto: ${facts.objeto || 'Conforme edital'}
║  Título: ${facts.biddingTitle}
╚══════════════════════════════════════════════════════════════╝

REGRA ABSOLUTA: Os dados acima são a ÚNICA fonte válida para identificação. QUALQUER dado divergente no resumo abaixo DEVE SER IGNORADO.
${facts.hasDivergence ? `\n⚠️ CONTAMINAÇÃO DETECTADA: O resumo contém referências a "${facts.orgaoFromSchema}" de OUTRO certame. USE EXCLUSIVAMENTE "${facts.orgaoLicitante}".` : ''}
${familyContext ? `\nCONTEXTO ESPECÍFICO (${family}):\n${familyContext}\n` : ''}
RESUMO AUXILIAR (APENAS para conteúdo jurídico — NÃO para identificação):
${editalContext}

INSTRUÇÕES RÍGIDAS:

1. FIDELIDADE: Se o edital impuser texto específico para "${facts.declarationType}", transcreva-o integralmente.

2. EXTENSÃO (${(() => { const c = FAMILY_LENGTH_CONSTRAINTS[family]; return `${c.minParagraphs} a ${c.maxParagraphs} parágrafos — ${c.styleHint}`; })()}):
   Estrutura recomendada:
   a) QUALIFICAÇÃO COMPLETA (REGRA INVIOLÁVEL): Transcreva LITERALMENTE o texto da QUALIFICAÇÃO COMPLETA dos Fatos Autoritativos acima como parágrafo de abertura. NÃO resuma. NÃO omita campos. Inclua TODOS os dados pessoais do representante (nacionalidade, estado civil, profissão, nascimento, CPF, RG, endereço comercial).
   b) REFERÊNCIA: "${facts.orgaoLicitante}", Edital nº "${facts.editalNumero}", Processo nº "${facts.processoNumero}"
   c) DECLARAÇÃO PRINCIPAL: fundamento legal pertinente
   d) CIÊNCIA DAS SANÇÕES + FECHO FORMAL
   Para ${family === 'SIMPLE_COMPLIANCE' ? 'esta família, os blocos a) e b) PODEM ser fundidos em 1 parágrafo. NÃO desdobre artificialmente.' : 'famílias complexas, use parágrafos separados.'}${ family === 'SIMPLE_COMPLIANCE' ? '\n   REGRA ANTI-PROLIXIDADE: NÃO descreva o objeto, NÃO recontar histórico, NÃO multiplique compromissos além do necessário.' : ''}

3. NOMES: Transcreva EXATAMENTE como nos FATOS AUTORITATIVOS. NUNCA abrevie, NUNCA invente dados.

4. SEM PLACEHOLDERS: NÃO use [NOME], [CNPJ] etc. Use os dados reais fornecidos acima. Colchetes APENAS para dados opcionais ausentes.
${facts.representanteNome ? '' : '\n   EXCEÇÃO: O nome do representante não foi fornecido. Use colchetes: [Nome do Representante Legal]'}

5. EQUIPE TÉCNICA: ${family === 'TECHNICAL_PERSONAL' ? 'Cite NOMINALMENTE os dados do RT fornecidos acima.' : 'N/A para este tipo.'}

${customPrompt ? `6. INSTRUÇÃO DO USUÁRIO: ${customPrompt}\n` : ''}
${(() => {
    const styleDirectives: Record<DeclarationStyle, string> = {
        objetiva: '7. ESTILO: OBJETIVA — Vá direto ao ponto. Sem contextualização do objeto. Sem histórico do processo. Mínimo de parágrafos possível dentro do range da família.',
        formal: '7. ESTILO: FORMAL — Linguagem jurídica completa com todos os blocos. Use extensão moderada.',
        robusta: '7. ESTILO: ROBUSTA — Texto detalhado com referências extensas, compromissos explícitos e fundamentação legal ampla.',
    };
    return styleDirectives[style] || styleDirectives.objetiva;
})()}

${editalClause ? `8. CLÁUSULA DO EDITAL (PRIORIDADE MÁXIMA):
   Nome exato da exigência: "${editalClause}"
   USE este nome LITERALMENTE como título ("title") se for um nome de declaração válido.
   O núcleo declaratório DEVE aderir ao teor exato desta cláusula.\n` : ''}
${semanticMatch ? `9. ORIENTAÇÃO DE TÍTULO: ${semanticMatch.titleGuidance}

10. COBERTURA SEMÂNTICA EXIGIDA (o núcleo declaratório DEVE cobrir TODOS estes conceitos):
    ${semanticMatch.coreConceptsMustCover}\n` : ''}
11. ANTI-GENERICISMO: EVITE frases ornamentais como: ${ANTI_GENERIC_PHRASES.slice(0, 3).map(p => `"${p}"`).join(', ')}. Prefira linguagem seca e assertiva.

12. FORMATO JSON PURO:
   { "title": "DECLARAÇÃO DE ...", "text": "A empresa ..." }
   - SEM blocos markdown. SEM negritos. SEM ${'```'}.
   - O "text" começa com qualificação: "${isTechnical ? 'Eu, [Nome], [profissão], inscrito no CREA/CAU..., DECLARO...' : `A empresa ${facts.empresaRazaoSocial}, inscrita no CNPJ sob nº ${facts.empresaCnpj}...DECLARA...`}"
   - NÃO inclua Local, Data, Assinatura — o sistema adiciona.

13. CITAÇÃO EXPLÍCITA: Use "${facts.orgaoLicitante}" e "${facts.editalNumero || facts.processoNumero}". NUNCA use genéricos.`;
}

// ── Step 8-12: Agora modularizados em services/ai/declaration/ ──

// ── Helpers (qualification parsing — será movido para declarationFacts.ts) ──

function extractFromQualification(qualification: string, field: 'address' | 'name' | 'cpf' | 'cargo'): string {
    if (!qualification) return '';
    switch (field) {
        case 'address': {
            const match = qualification.match(/sediada\s+(?:na|no|em)\s+(.+?)(?:,\s*neste\s+ato|,\s*inscrita|$)/i);
            return match?.[1]?.trim() || '';
        }
        case 'name': {
            const match = qualification.match(/representada\s+por\s+(?:seu\s+)?(?:Sócio\s+Administrador|representante\s+legal\s+)?(?:,\s*)?(?:a\s+Sra\.\s+|o\s+Sr\.\s+)?([^,.(0-9]{3,60})(?=\s*,\s*|,\s*brasileir|,\s*solteir|$)/i);
            return match?.[1]?.trim() || '';
        }
        case 'cpf': {
            const match = qualification.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/);
            return match?.[0] || '';
        }
        case 'cargo': {
            const match = qualification.match(/(Sócio[\s-]?Administrador|Representante\s+Legal|Diretor|Gerente|Procurador|Sócio|Administrador)/i);
            return match?.[1]?.trim() || 'Representante Legal';
        }
    }
}

// ═══════════════════════════════════════════════
// ROTA PRINCIPAL — 12 STEPS
// ═══════════════════════════════════════════════

app.post('/api/generate-declaration', authenticateToken, async (req: any, res) => {
    try {
        // ── Step 1: Receber request ──
        const { biddingProcessId, companyId, declarationType, issuerType, customPrompt, style: requestedStyle } = req.body;
        const style: DeclarationStyle = (['objetiva', 'formal', 'robusta'].includes(requestedStyle) ? requestedStyle : 'objetiva') as DeclarationStyle;
        console.log(`[Declaration v5] Step 1: "${declarationType}" (${issuerType || 'company'}) style=${style} BID:${biddingProcessId}`);

        if (!biddingProcessId || !companyId || !declarationType) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // ── Step 2: Buscar dados ──
        const bidding = await prisma.biddingProcess.findUnique({
            where: { id: biddingProcessId, tenantId: req.user.tenantId },
            include: { aiAnalysis: true }
        });

        const company = await prisma.companyProfile.findUnique({
            where: { id: companyId, tenantId: req.user.tenantId }
        });

        if (!bidding || !company) {
            return res.status(404).json({ error: 'Bidding or Company not found' });
        }

        // ── Step 3: Montar authoritativeFacts ──
        const schema = bidding.aiAnalysis?.schemaV2;
        const pi = (schema as any)?.process_identification || {};
        const orgaoFromSchema = pi.orgao || '';
        const editalFromSchema = pi.numero_edital || '';
        const processFromSchema = pi.numero_processo || '';
        const objetoFromSchema = pi.objeto_completo || pi.objeto_resumido || pi.objeto || '';

        const biddingTitle = (bidding.title || '').trim();
        const biddingMod = (bidding.modality || '').trim();

        // Cross-check órgão
        let orgaoFromTitle = '';
        const titleParts = biddingTitle.split(/\s+-\s+/);
        if (titleParts.length >= 2) {
            orgaoFromTitle = titleParts.slice(1).join(' - ').trim();
        }
        const schemaMatchesTitle = orgaoFromSchema && biddingTitle.toLowerCase().includes(orgaoFromSchema.toLowerCase().substring(0, 15));
        const orgaoName = schemaMatchesTitle ? orgaoFromSchema : (orgaoFromTitle || orgaoFromSchema || 'Não identificado');
        const editalNum = editalFromSchema || '';
        const processNum = processFromSchema || '';
        const hasDivergence = !!(orgaoFromSchema && !schemaMatchesTitle);

        // Extrair dados estruturados da empresa
        const qual = company.qualification || '';
        const representanteName = extractFromQualification(qual, 'name') || company.contactName || '';
        const representanteCpf = extractFromQualification(qual, 'cpf') || company.contactCpf || '';
        const representanteCargo = extractFromQualification(qual, 'cargo');
        const companyAddress = company.address || extractFromQualification(qual, 'address') || '';

        // ── Step 4: Classificar família (precisa ser ANTES do facts) ──
        const family = classifyFamily(declarationType);
        console.log(`[Declaration v5] Step 4: Family → ${family}`);

        const facts: AuthoritativeFacts = {
            orgaoLicitante: orgaoName,
            modalidade: biddingMod,
            editalNumero: editalNum,
            processoNumero: processNum,
            objeto: objetoFromSchema,
            biddingTitle,
            declarationType,
            declarationFamily: family,
            issuerType: (issuerType || 'company') as 'company' | 'technical',
            empresaRazaoSocial: company.razaoSocial,
            empresaCnpj: company.cnpj,
            empresaEndereco: companyAddress,
            qualificacaoCompleta: qual.trim() || undefined,
            representanteNome: representanteName,
            representanteCpf: representanteCpf,
            representanteCargo: representanteCargo,
            orgaoFromSchema,
            editalFromSchema,
            processFromSchema,
            hasDivergence,
        };

        console.log(`[Declaration v5] Step 3: Facts → org="${orgaoName}" div=${hasDivergence} rep="${representanteName}"`);


        // ── Step 5: Contexto específico ──
        const familyContext = extractFamilyContext(family, schema);

        // ── Issuer Block ──
        const isTechnical = issuerType === 'technical';
        let issuerBlock = '';

        if (isTechnical) {
            const techQual = company.technicalQualification || '';
            issuerBlock = `EMITENTE: PROFISSIONAL TÉCNICO (Responsável Técnico)

DADOS DO PROFISSIONAL TÉCNICO:
${techQual || 'Dados cadastrados na qualificação técnica da empresa.'}

DADOS DA EMPRESA VINCULADA:
${company.razaoSocial} | CNPJ: ${company.cnpj}
${company.qualification || ''}

INSTRUÇÃO ESPECIAL (RT): A declaração DEVE ser redigida na PRIMEIRA PESSOA do profissional técnico.
Exemplo: "Eu, [Nome], [Nacionalidade], [Estado Civil], [Engenheiro Civil], inscrito no CREA sob nº [Nº], CPF nº [CPF], Responsável Técnico pela empresa [Razão Social], DECLARO..."`;
        } else {
            issuerBlock = `EMITENTE: A EMPRESA (por seu representante legal)

DADOS DA EMPRESA:
${company.razaoSocial} | CNPJ: ${company.cnpj}
${company.qualification || ''}

DADOS DO RESPONSÁVEL TÉCNICO VINCULADO:
${company.technicalQualification || 'Nenhum profissional técnico cadastrado.'}`;
        }

        // ── Step 6: Montar prompt v3 ──
        const editalContext = bidding.aiAnalysis?.schemaV2
            ? buildModuleContext(bidding.aiAnalysis.schemaV2, 'declaration')
            : (bidding.aiAnalysis?.fullSummary || bidding.summary || '').substring(0, 3500);

        // Extrair cláusula exata do edital (declaration_routes)
        const oo = (schema as any)?.operational_outputs;
        let editalClause: string | undefined;
        if (oo?.declaration_routes?.length > 0) {
            const matchEntry = oo.declaration_routes.find((d: any) => {
                const name = typeof d === 'string' ? d : (d.name || d.title || '');
                return name.toLowerCase().includes(declarationType.toLowerCase().substring(0, 15))
                    || declarationType.toLowerCase().includes(name.toLowerCase().substring(0, 15));
            });
            if (matchEntry) {
                editalClause = typeof matchEntry === 'string' ? matchEntry : (matchEntry.name || matchEntry.title || undefined);
            }
        }

        const prompt = buildDeclarationPrompt(facts, family, familyContext, editalContext, issuerBlock, customPrompt, isTechnical, style, editalClause);

        if (!genAI) {
            return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });
        }

        // ── Step 7: Chamar IA ──
        console.log(`[Declaration v5] Step 7: Calling Gemini (attempt 1)...`);
        const result = await callGeminiWithRetry(genAI.models, {
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
                temperature: 0.3,
                maxOutputTokens: 4096,
                systemInstruction: DECLARATION_SYSTEM_PROMPT
            }
        }, 3, { tenantId: req.user.tenantId, operation: 'generate_declaration', metadata: { docType: 'declaration' } });

        // ── Step 8: Parser + Sanitize (modular) ──
        const rawResponse = (result.text || '').trim();
        const parsed = parseDeclaration(rawResponse);
        if (!parsed || !parsed.text) {
            return res.status(500).json({ error: 'Falha ao interpretar resposta da IA. Tente novamente.' });
        }

        let finalText = parsed.text;
        let finalTitle = parsed.title || declarationType.substring(0, 50);

        // ── Step 8.5: Title validation & auto-fix (v8) ──
        const titleResult = validateAndFixTitle(finalTitle, declarationType);
        if (titleResult.fixed) {
            console.log(`[Declaration v8] Title fixed: "${finalTitle}" → "${titleResult.title}"`);
            finalTitle = titleResult.title;
        }

        // ── Step 9: Validação pós-geração ──
        console.log(`[Declaration v8] Step 9: Validating...`);
        let issues = validateDeclaration(finalText, facts);

        // Adicionar issue de título se houver
        if (titleResult.issue) issues.push(titleResult.issue);

        let corrections: string[] = [];
        if (titleResult.correction) corrections.push(titleResult.correction);

        let attempts = 1;

        // ── Step 10: Repair automático via IA (se critical) ──
        if (hasCriticalIssues(issues)) {
            console.log(`[Declaration v5] Step 10: ${issues.filter(i => i.severity === 'critical').length} critical issues. Repair via IA...`);
            attempts = 2;

            const aiCallFn = createGeminiRepairFn(genAI.models, callGeminiWithRetry, 'gemini-2.5-flash', { tenantId: req.user.tenantId, operation: 'repair_declaration', metadata: { docType: 'declaration' } });
            const repair = await repairDeclaration(
                finalText, finalTitle, issues, facts,
                validateDeclaration, aiCallFn,
            );

            if (repair.improved) {
                finalText = repair.text;
                finalTitle = repair.title;
                issues = repair.issuesAfterRepair;
                corrections = repair.corrections;
            }
        }

        // ── Step 11/12: Quality Report + Resposta ──
        const qualityReport = calculateQualityReport(issues, corrections, family, attempts);
        console.log(`[Declaration v5] ${summarizeReport(qualityReport)}`);

        if (qualityReport.grade === 'D' && qualityReport.contaminationDetected) {
            return res.json({
                text: finalText,
                title: finalTitle,
                quality: qualityReport,
                warning: 'Qualidade insuficiente. A declaração contém erros factuais que não puderam ser corrigidos automaticamente. Revise manualmente.',
            });
        }

        res.json({
            text: finalText,
            title: finalTitle,
            quality: qualityReport,
        });

    } catch (error: any) {
        console.error("[Declaration v5] Fatal error:", error);
        res.status(500).json({ error: 'Failed to generate declaration', details: error?.message || 'Erro desconhecido' });
    }
});

// PNCP Proxy and Saved Searches
app.get('/api/pncp/searches', authenticateToken, async (req: any, res) => {
    try {
        const searches = await prisma.pncpSavedSearch.findMany({
            where: { tenantId: req.user.tenantId },
            include: { company: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(searches);
    } catch (error) {
        console.error("Fetch saved searches error:", error);
        res.status(500).json({ error: 'Failed to fetch saved searches' });
    }
});

app.post('/api/pncp/searches', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const search = await prisma.pncpSavedSearch.create({
            data: { ...req.body, tenantId }
        });
        res.json(search);
    } catch (error) {
        console.error("Create saved search error:", error);
        res.status(500).json({ error: 'Failed to create saved search' });
    }
});

app.delete('/api/pncp/searches/:id', authenticateToken, async (req: any, res) => {
    try {
        const id = req.params.id;
        const tenantId = req.user.tenantId;
        await prisma.pncpSavedSearch.deleteMany({
            where: { id, tenantId }
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Delete saved search error:", error);
        res.status(500).json({ error: 'Failed to delete saved search' });
    }
});

// ── Update a single saved search ──
app.put('/api/pncp/searches/:id', authenticateToken, async (req: any, res) => {
    try {
        const id = req.params.id;
        const tenantId = req.user.tenantId;
        const { name, keywords, status, states, listName, companyProfileId } = req.body;
        const data: any = {};
        if (name !== undefined) data.name = name;
        if (keywords !== undefined) data.keywords = keywords;
        if (status !== undefined) data.status = status;
        if (states !== undefined) data.states = states;
        if (listName !== undefined) data.listName = listName;
        if (companyProfileId !== undefined) data.companyProfileId = companyProfileId || null;
        await prisma.pncpSavedSearch.updateMany({
            where: { id, tenantId },
            data
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Update saved search error:", error);
        res.status(500).json({ error: 'Failed to update saved search' });
    }
});

// ── Rename a saved search list (bulk update listName) ──
app.put('/api/pncp/searches/list/rename', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { oldName, newName } = req.body;
        if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName required' });
        await prisma.pncpSavedSearch.updateMany({
            where: { tenantId, listName: oldName },
            data: { listName: newName.trim() }
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Rename search list error:", error);
        res.status(500).json({ error: 'Failed to rename list' });
    }
});

// ── Delete a saved search list (migrate items to default) ──
app.delete('/api/pncp/searches/list/:name', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const listName = decodeURIComponent(req.params.name);
        if (listName === 'Pesquisas Gerais') return res.status(400).json({ error: 'Cannot delete default list' });
        // Move all searches from this list to the default list
        await prisma.pncpSavedSearch.updateMany({
            where: { tenantId, listName },
            data: { listName: 'Pesquisas Gerais' }
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Delete search list error:", error);
        res.status(500).json({ error: 'Failed to delete list' });
    }
});
// ── Opportunity Scanner Global Toggle ──
app.get('/api/pncp/scanner/status', authenticateToken, async (req: any, res) => {
    try {
        const globalConfig = await prisma.globalConfig.findUnique({
            where: { tenantId: req.user.tenantId }
        });
        if (!globalConfig) return res.json({ enabled: true });
        
        try {
            const conf = JSON.parse(globalConfig.config || '{}');
            res.json({ 
                enabled: conf.opportunityScannerEnabled !== false,
                lastScanAt: conf.lastScanAt || null,
                lastScanTotalNew: conf.lastScanTotalNew || 0,
                lastScanResults: conf.lastScanResults || [],
                nextScanAt: conf.nextScanAt || null,
            });
        } catch {
            res.json({ enabled: true });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to get scanner status' });
    }
});

app.post('/api/pncp/scanner/toggle', authenticateToken, async (req: any, res) => {
    try {
        const { enabled } = req.body;
        const tenantId = req.user.tenantId;

        const globalConfig = await prisma.globalConfig.upsert({
            where: { tenantId },
            update: {},
            create: { tenantId, config: '{}' }
        });

        let conf = {};
        try { conf = JSON.parse(globalConfig.config || '{}'); } catch {}
        
        (conf as any).opportunityScannerEnabled = enabled;

        await prisma.globalConfig.update({
            where: { tenantId },
            data: { config: JSON.stringify(conf) }
        });

        res.json({ success: true, enabled });
    } catch (error) {
        res.status(500).json({ error: 'Failed to toggle scanner status' });
    }
});

// ── Manual trigger for Opportunity Scanner ──
app.post('/api/pncp/scan-opportunities', authenticateToken, async (req: any, res) => {
    try {
        const { runOpportunityScan } = await import('./services/monitoring/opportunity-scanner.service');
        console.log(`[OpportunityScanner] Manual scan triggered by tenant ${req.user.tenantId}`);
        // Run async — don't block the response
        runOpportunityScan(req.user.tenantId).catch(err => console.error('[OpportunityScanner] Manual scan error:', err));
        res.json({ success: true, message: 'Varredura de oportunidades iniciada. Você receberá notificações se houver novos editais.' });
    } catch (error) {
        console.error("Manual scan trigger error:", error);
        res.status(500).json({ error: 'Failed to trigger scan' });
    }
});

// ── List scanner-found opportunities (for "Encontradas" tab) ──
// Sorted by closest deadline first (dataEncerramentoProposta ASC, nulls last)
app.get('/api/pncp/scanner/opportunities', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const searchId = req.query.searchId as string | undefined;
        const page = parseInt(req.query.page as string) || 1;
        const pageSize = 50;

        const where: any = { tenantId };
        if (searchId) where.searchId = searchId;

        // Fetch ordered items directly from DB (avoids memory leak)
        const [items, total] = await Promise.all([
            prisma.opportunityScannerLog.findMany({
                where,
                select: {
                    id: true,
                    pncpId: true,
                    searchId: true,
                    searchName: true,
                    titulo: true,
                    objeto: true,
                    orgaoNome: true,
                    uf: true,
                    municipio: true,
                    valorEstimado: true,
                    dataEncerramentoProposta: true,
                    modalidadeNome: true,
                    linkSistema: true,
                    isViewed: true,
                    createdAt: true,
                },
                orderBy: [
                    { dataEncerramentoProposta: { sort: 'asc', nulls: 'last' } },
                    { createdAt: 'desc' }
                ],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            prisma.opportunityScannerLog.count({ where })
        ]);

        res.json({ items, total, page, pageSize });
    } catch (error) {
        console.error("Scanner opportunities error:", error);
        res.status(500).json({ error: 'Failed to list scanner opportunities' });
    }
});

// ── Mark opportunities as viewed ──
app.patch('/api/pncp/scanner/opportunities/mark-viewed', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { ids } = req.body; // Array of log IDs to mark as viewed, or "all"
        
        if (ids === 'all') {
            await prisma.opportunityScannerLog.updateMany({
                where: { tenantId, isViewed: false },
                data: { isViewed: true }
            });
        } else if (Array.isArray(ids) && ids.length > 0) {
            await prisma.opportunityScannerLog.updateMany({
                where: { tenantId, id: { in: ids } },
                data: { isViewed: true }
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Mark viewed error:", error);
        res.status(500).json({ error: 'Failed to mark as viewed' });
    }
});

// ── Get unread count (for sidebar badge) ──
app.get('/api/pncp/scanner/opportunities/unread-count', authenticateToken, async (req: any, res) => {
    try {
        const count = await prisma.opportunityScannerLog.count({
            where: { tenantId: req.user.tenantId, isViewed: false }
        });
        res.json({ count });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get unread count' });
    }
});

// ═══ PNCP Favorites (persisted in DB — syncs across devices) ═══

// ── Get all favorites (lists + items) ──
app.get('/api/pncp/favorites', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const lists = await prisma.pncpFavoriteList.findMany({
            where: { tenantId },
            include: { items: true },
            orderBy: { createdAt: 'asc' }
        });
        res.json({ lists });
    } catch (error) {
        console.error("Fetch favorites error:", error);
        res.status(500).json({ error: 'Failed to fetch favorites' });
    }
});

// ── Create a favorite list ──
app.post('/api/pncp/favorites/lists', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { name } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
        const list = await prisma.pncpFavoriteList.upsert({
            where: { tenantId_name: { tenantId, name: name.trim() } },
            update: {},
            create: { tenantId, name: name.trim() }
        });
        res.json(list);
    } catch (error) {
        console.error("Create fav list error:", error);
        res.status(500).json({ error: 'Failed to create list' });
    }
});

// ── Rename a favorite list ──
app.put('/api/pncp/favorites/lists/:id', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { name } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
        await prisma.pncpFavoriteList.updateMany({
            where: { id: req.params.id, tenantId },
            data: { name: name.trim() }
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Rename fav list error:", error);
        res.status(500).json({ error: 'Failed to rename list' });
    }
});

// ── Delete a favorite list (moves items to default list) ──
app.delete('/api/pncp/favorites/lists/:id', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const listId = req.params.id;
        // Find or create default list
        const defaultList = await prisma.pncpFavoriteList.upsert({
            where: { tenantId_name: { tenantId, name: 'Favoritos Gerais' } },
            update: {},
            create: { tenantId, name: 'Favoritos Gerais' }
        });
        if (listId === defaultList.id) return res.status(400).json({ error: 'Cannot delete default list' });
        // Move items to default list (skip duplicates)
        const itemsToMove = await prisma.pncpFavoriteItem.findMany({ where: { listId, tenantId } });
        for (const item of itemsToMove) {
            try {
                await prisma.pncpFavoriteItem.update({ where: { id: item.id }, data: { listId: defaultList.id } });
            } catch { /* duplicate — delete instead */ await prisma.pncpFavoriteItem.delete({ where: { id: item.id } }).catch(() => {}); }
        }
        await prisma.pncpFavoriteList.deleteMany({ where: { id: listId, tenantId } });
        res.json({ success: true });
    } catch (error) {
        console.error("Delete fav list error:", error);
        res.status(500).json({ error: 'Failed to delete list' });
    }
});

// ── Add item to a favorites list ──
app.post('/api/pncp/favorites/items', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { listId, pncpId, data } = req.body;
        if (!listId || !pncpId) return res.status(400).json({ error: 'listId and pncpId required' });
        const item = await prisma.pncpFavoriteItem.upsert({
            where: { tenantId_listId_pncpId: { tenantId, listId, pncpId } },
            update: { data },
            create: { tenantId, listId, pncpId, data }
        });
        res.json(item);
    } catch (error) {
        console.error("Add fav item error:", error);
        res.status(500).json({ error: 'Failed to add favorite' });
    }
});

// ── Remove item from favorites ──
app.delete('/api/pncp/favorites/items/:id', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        await prisma.pncpFavoriteItem.deleteMany({ where: { id: req.params.id, tenantId } });
        res.json({ success: true });
    } catch (error) {
        console.error("Remove fav item error:", error);
        res.status(500).json({ error: 'Failed to remove favorite' });
    }
});

// ── Remove item by pncpId (from all lists) ──
app.delete('/api/pncp/favorites/items/by-pncp/:pncpId', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const pncpId = decodeURIComponent(req.params.pncpId);
        await prisma.pncpFavoriteItem.deleteMany({ where: { tenantId, pncpId } });
        res.json({ success: true });
    } catch (error) {
        console.error("Remove fav by pncpId error:", error);
        res.status(500).json({ error: 'Failed to remove favorite' });
    }
});

// ── Bulk import favorites (migration from localStorage) ──
app.post('/api/pncp/favorites/import', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { lists, items } = req.body; // { lists: [{name}], items: [{listName, pncpId, data}] }
        let imported = 0;

        // Ensure all lists exist
        const listMap = new Map<string, string>(); // name → id
        for (const l of (lists || [])) {
            const list = await prisma.pncpFavoriteList.upsert({
                where: { tenantId_name: { tenantId, name: l.name } },
                update: {},
                create: { tenantId, name: l.name }
            });
            listMap.set(l.name, list.id);
        }

        // Import items
        for (const item of (items || [])) {
            const listId = listMap.get(item.listName) || listMap.get('Favoritos Gerais');
            if (!listId || !item.pncpId) continue;
            try {
                await prisma.pncpFavoriteItem.upsert({
                    where: { tenantId_listId_pncpId: { tenantId, listId, pncpId: item.pncpId } },
                    update: { data: item.data },
                    create: { tenantId, listId, pncpId: item.pncpId, data: item.data }
                });
                imported++;
            } catch { /* skip duplicates */ }
        }

        res.json({ success: true, imported, listsCreated: listMap.size });
    } catch (error) {
        console.error("Import favorites error:", error);
        res.status(500).json({ error: 'Failed to import favorites' });
    }
});

// ── Reset scanner dedup history (re-send notifications on next scan) ──
app.post('/api/pncp/scanner/reset', authenticateToken, async (req: any, res) => {
    try {
        const deleted = await prisma.opportunityScannerLog.deleteMany({
            where: { tenantId: req.user.tenantId }
        });
        console.log(`[OpportunityScanner] 🔄 Histórico de dedup resetado para tenant ${req.user.tenantId} (${deleted.count} registros removidos)`);
        res.json({ success: true, deleted: deleted.count, message: `Histórico limpo. ${deleted.count} registros removidos. Próxima varredura reenviará notificações.` });
    } catch (error) {
        console.error("Scanner reset error:", error);
        res.status(500).json({ error: 'Failed to reset scanner history' });
    }
});

// ── Internal: Reset + Scan (for admin/worker use without JWT) ──
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
        console.log(`[OpportunityScanner] 🔄 Internal reset: ${deleted.count} registros removidos para tenant ${tenantId}`);
        
        const { runOpportunityScan } = await import('./services/monitoring/opportunity-scanner.service');
        runOpportunityScan().catch(err => console.error('[OpportunityScanner] Scan error:', err));
        
        res.json({ success: true, deleted: deleted.count, message: `Reset OK (${deleted.count} removed). Scan triggered.` });
    } catch (error: any) {
        console.error("Internal reset error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/pncp/search', authenticateToken, async (req: any, res) => {
    try {
        const { keywords, status, uf, pagina = 1, modalidade, dataInicio, dataFim, esfera, orgao, orgaosLista, excludeKeywords } = req.body;
        const pageSize = 10;

        let kwList: string[] = [];
        if (keywords) {
            if (keywords.includes(',')) {
                kwList = keywords.split(',')
                    .map((k: string) => k.trim().replace(/^"|"$/g, ''))
                    .filter((k: string) => k.length > 0)
                    .map((k: string) => k.includes(' ') ? `"${k}"` : k);
            } else {
                kwList = [keywords.includes(' ') && !keywords.startsWith('"') ? `"${keywords}"` : keywords];
            }
        }

        // Merge single orgao into orgaosLista if it contains commas
        let effectiveOrgao = orgao || '';
        let effectiveOrgaosLista = orgaosLista || '';
        if (effectiveOrgao.includes(',')) {
            effectiveOrgaosLista = effectiveOrgaosLista
                ? `${effectiveOrgaosLista},${effectiveOrgao}`
                : effectiveOrgao;
            effectiveOrgao = '';
        }

        // Expand region UF groups into individual UFs for separate fetches
        let ufsToIterate: string[] = [];
        if (uf && uf.includes(',')) {
            ufsToIterate = uf.split(',').map((u: string) => u.trim()).filter(Boolean);
        } else if (uf) {
            ufsToIterate = [uf];
        }

        const buildBaseUrl = (qItems: string[], overrideCnpj?: string, singleUf?: string) => {
            let url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=${overrideCnpj ? 100 : 500}&pagina=1`;
            if (overrideCnpj) {
                url += `&cnpj=${overrideCnpj}`;
            }
            if (qItems.length > 0) {
                url += `&q=${encodeURIComponent(qItems.join(' '))}`;
            }
            if (status && status !== 'todas') url += `&status=${status}`;
            // Use single UF per request (region groups are split upstream)
            if (singleUf) url += `&ufs=${singleUf}`;
            if (modalidade && modalidade !== 'todas') url += `&modalidades_licitacao=${encodeURIComponent(modalidade)}`;
            if (dataInicio) url += `&data_inicio=${dataInicio}`;
            if (dataFim) url += `&data_fim=${dataFim}`;
            if (esfera && esfera !== 'todas') url += `&esferas=${esfera}`;
            return url;
        };

        let extractedNames: string[] = [];
        if (effectiveOrgaosLista) {
            extractedNames = effectiveOrgaosLista.split(/[\n,;]+/).map((s: string) => s.trim().replace(/^"|"$/g, '')).filter((s: string) => s.length > 0);
            extractedNames = [...new Set(extractedNames)]; // Remove duplicates
        }

        let urlsToFetch: string[] = [];
        const keywordsToIterate = kwList.length > 0 ? kwList : [null];
        const orgaosToIterate = extractedNames.length > 0 ? extractedNames : (effectiveOrgao ? [effectiveOrgao] : [null]);
        const ufsForIteration = ufsToIterate.length > 0 ? ufsToIterate : [null];

        for (const kw of keywordsToIterate) {
            for (const org of orgaosToIterate) {
                for (const singleUf of ufsForIteration) {
                    let localParams: string[] = [];
                    let overrideCnpj: string | undefined = undefined;

                    if (kw) localParams.push(kw);

                    if (org) {
                        const onlyNumbers = org.replace(/\D/g, '');
                        if (onlyNumbers.length === 14) {
                            overrideCnpj = onlyNumbers;
                        } else {
                            const exactOrgName = org.includes(' ') && !org.startsWith('"') ? `"${org}"` : org;
                            localParams.push(exactOrgName);
                        }
                    }

                    urlsToFetch.push(buildBaseUrl(localParams, overrideCnpj, singleUf || undefined));
                }
            }
        }

        // Limit max generated combinations to 1000 to avoid complete application DOS (extreme user input).
        urlsToFetch = urlsToFetch.slice(0, 1000);

        const agent = new https.Agent({ rejectUnauthorized: false });
        const startTime = Date.now();
        console.log(`[PNCP] START GET ${urlsToFetch.length} url(s) in batches...`);

        let rawItems: any[] = [];
        const chunkSize = 60;

        for (let i = 0; i < urlsToFetch.length; i += chunkSize) {
            const chunk = urlsToFetch.slice(i, i + chunkSize);
            const responses = await Promise.allSettled(
                chunk.map(u => axios.get(u, {
                    headers: { 'Accept': 'application/json' },
                    httpsAgent: agent,
                    timeout: 25000
                } as any))
            );

            responses.forEach((res) => {
                if (res.status === 'fulfilled') {
                    const data = res.value.data as any;
                    const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.data) ? data.data : []);
                    rawItems = rawItems.concat(items);
                } else {
                    console.error('[PNCP] Request failed:', res.reason?.message);
                }
            });
        }

        // First pass: extract what we can from search results
        // Also ensure no duplicate results based on PNCP ID just in case
        const seenIds = new Set<string>();
        const items = rawItems.filter(item => item != null).map((item: any) => {
            const cnpj = item.orgao_cnpj || item.orgaoEntidade?.cnpj || item.cnpj || '';
            const ano = item.ano || item.anoCompra || '';
            const nSeq = item.numero_sequencial || item.sequencialCompra || item.numero_compra || '';

            // Extract value from all possible fields aggressively (null-safe)
            const rawVal = item.valor_estimado ?? item.valor_global ?? item.valorTotalEstimado
                ?? item.valorTotalHomologado ?? item.amountInfo?.amount ?? item.valorTotalLicitacao ?? null;
            const valorEstimado = rawVal != null ? (Number(rawVal) || 0) : 0;

            // Extract modalidade from API response
            const modalidadeNome = item.modalidade_licitacao_nome || item.modalidade_nome || item.modalidadeNome
                || item.modalidadeLicitacaoNome || '';

            const pncpId = item.numeroControlePNCP || (cnpj && ano && nSeq ? `${cnpj}-${ano}-${nSeq}` : null) || item.id || Math.random().toString();
            return {
                id: pncpId,
                orgao_nome: item.orgao_nome || item.orgaoEntidade?.razaoSocial || item.nomeOrgao || 'Órgão não informado',
                orgao_cnpj: cnpj,
                ano,
                numero_sequencial: nSeq,
                titulo: item.title || item.titulo || item.identificador || 'Sem título',
                objeto: item.description || item.objetoCompra || item.objeto || item.resumo || 'Sem objeto',
                data_publicacao: item.createdAt || item.dataPublicacaoPncp || item.data_publicacao || new Date().toISOString(),
                data_abertura: item.dataAberturaProposta || item.data_inicio_vigencia || item.data_abertura || '',
                data_encerramento_proposta: item.dataEncerramentoProposta || item.data_fim_vigencia || '',
                valor_estimado: valorEstimado,
                uf: item.uf || item.unidadeOrgao?.ufSigla || uf || '--',
                municipio: item.municipio_nome || item.unidadeOrgao?.municipioNome || item.municipio || '--',
                modalidade_nome: modalidadeNome,
                link_sistema: (cnpj && ano && nSeq)
                    ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${nSeq}`
                    : (item.linkSistemaOrigem || item.link || ''),
                link_comprasnet: item.linkSistemaOrigem || '',
                status: item.situacao_nome || item.situacaoCompraNome || item.status || status || '',
                esfera_id: item.esferaId || item.orgaoEntidade?.esferaId || '',
            };
        }).filter(item => {
            if (seenIds.has(item.id)) return false;
            seenIds.add(item.id);
            return true;
        });

        // ── Post-filter by modalidade (API may not filter precisely) ──
        const modalidadeMap: Record<string, string> = {
            '1': 'Pregão - Eletrônico', '2': 'Concorrência', '3': 'Concurso',
            '4': 'Leilão', '5': 'Diálogo Competitivo', '6': 'Dispensa de Licitação',
            '7': 'Inexigibilidade', '8': 'Tomada de Preços', '9': 'Convite',
        };
        let filteredItems = items;
        if (modalidade && modalidade !== 'todas') {
            const modalidadeLabel = (modalidadeMap[modalidade] || '').toLowerCase();
            if (modalidadeLabel) {
                filteredItems = filteredItems.filter((it: any) => {
                    const nome = (it.modalidade_nome || '').toLowerCase();
                    return nome.includes(modalidadeLabel.split(' - ')[0]) || nome.includes(modalidadeLabel);
                });
            }
        }

        // ── Post-filter by exclude keywords (remove results with unwanted terms in objeto) ──
        if (excludeKeywords && typeof excludeKeywords === 'string' && excludeKeywords.trim()) {
            const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const excludeTerms = excludeKeywords.split(',')
                .map((t: string) => normalize(t.trim()))
                .filter((t: string) => t.length > 0);
            if (excludeTerms.length > 0) {
                filteredItems = filteredItems.filter((it: any) => {
                    const objNorm = normalize((it.objeto || '') + ' ' + (it.titulo || ''));
                    return !excludeTerms.some((term: string) => objNorm.includes(term));
                });
            }
        }

        // ── Post-filter by esfera (additional accuracy) ──
        // The PNCP API esfera param works on the search API but results may leak
        // We don't post-filter esfera since the API handles it and we don't have esfera in results

        // GLOBAL sort ALL items by closest deadline using search API dates
        const now = Date.now();
        filteredItems.sort((a: any, b: any) => {
            const dateA = new Date(a.data_encerramento_proposta || a.data_abertura || '9999').getTime();
            const dateB = new Date(b.data_encerramento_proposta || b.data_abertura || '9999').getTime();
            const absA = isNaN(dateA) ? Infinity : Math.abs(dateA - now);
            const absB = isNaN(dateB) ? Infinity : Math.abs(dateB - now);
            return absA - absB;
        });

        // Paginate first, then hydrate ONLY the page items (fast!)
        const totalResults = filteredItems.length;
        const startIdx = (Number(pagina) - 1) * pageSize;
        const pageItems = filteredItems.slice(startIdx, startIdx + pageSize);

        // Hydrate only the 10 items on this page from detail API
        const hydratedPageItems = await Promise.all(pageItems.map(async (item: any) => {
            if (item.orgao_cnpj && item.ano && item.numero_sequencial) {
                try {
                    const detailUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${item.orgao_cnpj}/compras/${item.ano}/${item.numero_sequencial}`;
                    const detailRes = await axios.get(detailUrl, { httpsAgent: agent, timeout: 5000 } as any);
                    const d: any = detailRes.data;
                    if (d) {
                        if (!item.valor_estimado) {
                            const v = Number(d.valorTotalEstimado ?? d.valorTotalHomologado ?? d.valorGlobal ?? 0);
                            if (v > 0) item.valor_estimado = v;
                        }
                        if (!item.modalidade_nome) {
                            item.modalidade_nome = d.modalidadeNome || d.modalidadeLicitacaoNome || d.modalidade?.nome || '';
                        }
                        // Hydrate dates from detail API
                        if (d.dataEncerramentoProposta) {
                            item.data_encerramento_proposta = d.dataEncerramentoProposta;
                        }
                        if (d.dataAberturaProposta) {
                            item.data_abertura = d.dataAberturaProposta;
                        }
                    }
                } catch (e) {
                    // Safe mute — detail endpoint can fail for some items
                }
            }
            return item;
        }));

        const endTime = Date.now();
        console.log(`[PNCP] END GET (${endTime - startTime}ms) - Total: ${totalResults}, Page ${pagina}: items ${startIdx}-${startIdx + hydratedPageItems.length}`);

        res.json({
            items: hydratedPageItems,
            total: totalResults
        });
    } catch (error: any) {
        console.error("PNCP search error:", error?.message || error);
        res.status(502).json({ error: 'Falha ao comunicar com a API do PNCP', details: error?.message || 'Erro desconhecido' });
    }
});

// ─── AI Services Imports estão no topo do arquivo ───

// PNCP AI Analysis — analyzes a PNCP edital directly by fetching its PDF files
app.post('/api/pncp/analyze', authenticateToken, aiLimiter, async (req: any, res) => {
    // ── SSE Setup ──
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
    });
    res.flushHeaders();

    const TOTAL_STEPS = 8;
    const sendProgress = (step: number, message: string, detail?: string) => {
        try {
            res.write(`data: ${JSON.stringify({
                type: 'progress', step, total: TOTAL_STEPS, message, detail,
                percent: Math.round((step / TOTAL_STEPS) * 100)
            })}\n\n`);
        } catch (_) { /* connection closed */ }
    };
    const sendError = (error: string, details?: string) => {
        try {
            res.write(`data: ${JSON.stringify({ type: 'error', error, details })}\n\n`);
            res.end();
        } catch (_) { /* connection closed */ }
    };
    const sendResult = (payload: any) => {
        try {
            res.write(`data: ${JSON.stringify({ type: 'result', payload })}\n\n`);
            res.end();
        } catch (_) { /* connection closed */ }
    };

    // SSE keepalive: send a comment every 15s to prevent Railway/Nginx/browser from killing the connection
    const sseKeepAlive = setInterval(() => {
        try {
            res.write(`: keepalive ${new Date().toISOString()}\n\n`);
        } catch (_) {
            clearInterval(sseKeepAlive);
        }
    }, 15000);
    // Clean up on connection close
    res.on('close', () => clearInterval(sseKeepAlive));
    res.on('finish', () => clearInterval(sseKeepAlive));

    try {
        const { orgao_cnpj, ano, numero_sequencial, link_sistema } = req.body;
        if (!orgao_cnpj || !ano || !numero_sequencial) {
            return sendError('orgao_cnpj, ano e numero_sequencial são obrigatórios');
        }

        const agent = new https.Agent({ rejectUnauthorized: false });
        const JSZip = require('jszip');

        // 1. Fetch edital attachments from PNCP API (correct endpoint: /api/pncp/v1/)
        sendProgress(1, 'Buscando documentos no PNCP...', 'Consultando lista de anexos do edital');
        const arquivosUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${orgao_cnpj}/compras/${ano}/${numero_sequencial}/arquivos`;
        console.log(`[PNCP-AI] Fetching attachments: ${arquivosUrl}`);

        let arquivos: any[] = [];
        try {
            const arquivosRes = await axios.get(arquivosUrl, { httpsAgent: agent, timeout: 10000 } as any);
            arquivos = Array.isArray(arquivosRes.data) ? arquivosRes.data : [];
            console.log(`[PNCP-AI] Found ${arquivos.length} attachments`);
        } catch (e: any) {
            console.warn(`[PNCP-AI] Failed to fetch attachments: ${e.message}`);
        }

        // 2. Sort to prioritize: Edital (tipoDocumentoId=2) > Termo de Referência (4) > Others
        // Sort by legal/technical priority: Edital > TR > Projeto Básico > Planilhas > Proposta > Minuta > outros
        arquivos.sort((a: any, b: any) => {
            const nameScore = (name: string): number => {
                const n = (name || '').toLowerCase();
                if (n.includes('edital') && !n.includes('anexo')) return 0;
                if (n.includes('termo_referencia') || n.includes('termo de referencia') || n.includes('tr_') || (a.tipoDocumentoId === 4)) return 1;
                if (n.includes('projeto_basico') || n.includes('projeto basico')) return 2;
                if (n.includes('planilha') || n.includes('orcamento')) return 3;
                if (n.includes('proposta') || n.includes('modelo_proposta')) return 4;
                if (n.includes('etp') || n.includes('estudo_tecnico')) return 5;
                if (n.includes('minuta') || n.includes('contrato')) return 8;
                if (n.includes('anexo')) return 6;
                return 7;
            };
            const pa = (a.tipoDocumentoId === 2) ? -1 : nameScore(a.titulo || a.nomeArquivo || '');
            const pb = (b.tipoDocumentoId === 2) ? -1 : nameScore(b.titulo || b.nomeArquivo || '');
            return pa - pb;
        });

        // 3. Download and process files — SMART PDF FILTER
        // Only download PDFs that contribute to habilitação extraction
        const MAX_PDF_PARTS = 5; // Send only top 5 most important docs to Stage 1 (Edital + TR + Planilha + etc)
        const MAX_TOTAL_PDF_SIZE_KB = 15000; // 15MB inline budget — base64 expands to ~20MB which is the REST limit
        let totalPdfSizeAccum = 0;
        const pdfParts: any[] = [];
        const downloadedFiles: string[] = [];
        const discardedFiles: string[] = [];

        // Pre-filter: exclude templates, project drawings, and irrelevant attachments BEFORE download
        const EXCLUDE_PATTERNS = [
            // Templates / Modelos
            'modelo_proposta', 'modelo_de_proposta', 'modelo proposta',
            'modelo_recibo', 'modelo recibo', 'modelo_declarac', 'modelo declarac',
            'modelo_ata', 'modelo ata', 'modelo_contrato', 'modelo_carta',
            'carta_fian', 'carta fian',
            // Publicações / Atas / Avisos
            'aviso_publicac', 'aviso publicac', 'aviso_licitac',
            'aviso_de_licit', 'aviso de licit', 'aviso_licit',
            'aviso_de_publicac', 'aviso de publicac',
            'quadro_de_aviso', 'quadro de aviso',
            'd.o.u', 'diario_oficial', 'diario oficial',
            'retificac', 'errata', 'ata_sessao', 'ata_da_sessao',
            'comprovante', 'recibo_garantia', 'modelo_recibo_garantia',
            'minuta_contrato', 'minuta contrato', 'minuta_de_contrato',
            // Projetos de engenharia / plantas / memoriais / peças gráficas
            'projeto_arq', 'projeto arq', 'planta_', 'planta ',
            'memorial_descritivo', 'memorial descritivo',
            'croqui', 'layout_', 'layout ',
            'detalhamento_', 'det_arq', 'det arq',
            'pecas_graficas', 'pecas graficas', 'peas_grficas', 'peas_graficas',
            'desenho_tecnico', 'desenho tecnico', 'peca_grafica',
        ];

        // ── Smart-Sort: priorizar PDFs dentro de RAR/ZIP por relevância ──
        const ARCHIVE_EXCLUDE_PATTERNS = [
            'relatorio_fot', 'relatorio fot', 'relatório fot',
            'licenca_ambiental', 'licença ambiental', 'licenca ambiental',
            'art_de_projeto', 'art de projeto', 'anotacao_responsabilidade',
            'marco_zero', 'marco zero',
        ];

        const archivePriorityScore = (name: string): number => {
            const n = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            // Máxima prioridade: edital principal
            if ((n.includes('edital') || n.includes('edital_bll') || n.includes('edital bll')) && !n.includes('modelo')) return 0;
            if (n.includes('termo_referencia') || n.includes('termo de referencia') || n.includes('tr_')) return 1;
            if (n.includes('planilha') || n.includes('orcamento') || n.includes('orcamentaria')) return 2;
            if (n.includes('cronograma')) return 3;
            if (n.includes('bdi') || n.includes('encargos')) return 4;
            if (n.includes('composic')) return 5;
            if (n.includes('memoria') || n.includes('calculo')) return 6;
            // Prioridade média: documentos complementares
            if (n.includes('memorial')) return 50;
            if (n.includes('projeto') || n.includes('pavimentac')) return 60;
            // Baixa prioridade: fotos, licenças, ARTs
            if (n.includes('relatorio_fot') || n.includes('relatorio fot') || n.includes('foto') || n.includes('marco_zero') || n.includes('marco zero')) return 90;
            if (n.includes('licenca') || n.includes('licença')) return 91;
            if (n.includes('art_') || n.includes('art ') || n.includes('anotacao')) return 92;
            return 40; // Default
        };

        // Keywords that indicate edital/TR content (should NOT be excluded even if "Outros Documentos")
        const ESSENTIAL_KEYWORDS = [
            'edital', 'termo_referencia', 'termo de referencia', 'tr_',
            'projeto_basico', 'projeto basico', 'planilha', 'orcamento',
            'cronograma', 'bdi', 'etp', 'estudo_tecnico',
        ];

        const filteredArquivos = arquivos.filter((arq: any) => {
            const name = (arq.titulo || arq.nomeArquivo || arq.nome || '').toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const tipoDesc = (arq.tipoDocumentoDescricao || '').toLowerCase();
            const tipoId = arq.tipoDocumentoId;

            // Rule 1: Exclude by explicit pattern match
            const isExcludedByPattern = EXCLUDE_PATTERNS.some(pat => name.includes(pat));
            if (isExcludedByPattern) {
                console.log(`[PNCP-AI] 🚫 Excluído (template/padrão): "${arq.titulo}" (tipo: ${tipoDesc || tipoId})`);
                discardedFiles.push(`${arq.titulo} (excluído: template/padrão)`);
                return false;
            }

            // Rule 2: "Outros Documentos" with generic "ANEXO" names and no essential keywords → likely project files
            const isOutros = tipoDesc.includes('outros') || (tipoId !== 2 && tipoId !== 4); // Not Edital (2) nor TR (4)
            const hasEssentialKeyword = ESSENTIAL_KEYWORDS.some(kw => name.includes(kw));
            const isGenericAnexo = /^anexo[_\s]+(i|ii|iii|iv|v|vi|vii|viii|ix|x|[0-9])/.test(name);

            if (isOutros && isGenericAnexo && !hasEssentialKeyword) {
                console.log(`[PNCP-AI] 🚫 Excluído (anexo genérico/projeto): "${arq.titulo}" (tipo: ${tipoDesc || tipoId})`);
                discardedFiles.push(`${arq.titulo} (excluído: anexo genérico)`);
                return false;
            }

            return true;
        });

        // ── BUILD FULL ATTACHMENT CATALOG (for Proposal module) ──
        // Classifies ALL files by purpose so they can be downloaded on demand later
        const classifyAttachment = (arq: any): string => {
            const n = (arq.titulo || arq.nomeArquivo || '').toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const tipoId = arq.tipoDocumentoId;
            if (tipoId === 2 || (n.includes('edital') && !n.includes('anexo'))) return 'edital';
            if (tipoId === 4 || n.includes('termo_referencia') || n.includes('tr_')) return 'termo_referencia';
            if (n.includes('planilha') || n.includes('orcamento') || n.includes('orçamento')) return 'planilha_orcamentaria';
            if (n.includes('cronograma')) return 'cronograma';
            if (n.includes('bdi') || n.includes('encargos')) return 'bdi_encargos';
            if (n.includes('modelo_proposta') || n.includes('modelo de proposta') || n.includes('modelo_carta')) return 'modelo_proposta';
            if (n.includes('modelo_recibo') || n.includes('modelo_garantia')) return 'modelo_documento';
            if (n.includes('minuta') || n.includes('contrato')) return 'minuta_contrato';
            if (n.includes('projeto') || n.includes('planta') || n.includes('memorial')) return 'projeto_engenharia';
            if (n.includes('aviso')) return 'aviso_publicacao';
            if (n.includes('composic') || n.includes('custo')) return 'composicao_custos';
            return 'anexo_geral';
        };

        const pncpAttachments = arquivos.map((arq: any) => {
            const name = arq.titulo || arq.nomeArquivo || arq.nome || 'arquivo';
            const purpose = classifyAttachment(arq);
            const isDownloaded = filteredArquivos.includes(arq);
            return {
                titulo: name,
                url: arq.url || arq.uri || '',
                tipoDocumentoId: arq.tipoDocumentoId,
                tipoDocumentoDescricao: arq.tipoDocumentoDescricao || '',
                purpose,
                downloaded: isDownloaded,
                sequencial: arq.sequencialDocumento || arq.sequencial || null,
                ativo: arq.statusAtivo ?? true,
            };
        });

        const purposeCounts = pncpAttachments.reduce((acc: Record<string, number>, a: any) => {
            acc[a.purpose] = (acc[a.purpose] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        console.log(`[PNCP-AI] 📋 Catálogo completo: ${pncpAttachments.length} arquivos — ${JSON.stringify(purposeCounts)}`);

        console.log(`[PNCP-AI] 📊 Filtro inteligente: ${arquivos.length} anexos → ${filteredArquivos.length} relevantes (${arquivos.length - filteredArquivos.length} excluídos)`);
        sendProgress(2, 'Baixando documentos...', `${filteredArquivos.length} arquivos relevantes de ${arquivos.length} total`);

        // Sort by priority: Edital > TR > Orçamento > Cronograma > rest
        filteredArquivos.sort((a: any, b: any) => {
            const nameA = a.titulo || a.nomeArquivo || a.nome || '';
            const nameB = b.titulo || b.nomeArquivo || b.nome || '';
            // Edital tipo always first
            const aIsEdital = ([1, 2].includes(a.tipoDocumentoId) || /edital/i.test(a.tipoDocumentoDescricao));
            const bIsEdital = ([1, 2].includes(b.tipoDocumentoId) || /edital/i.test(b.tipoDocumentoDescricao));
            if (aIsEdital && !bIsEdital) return -1;
            if (!aIsEdital && bIsEdital) return 1;
            return archivePriorityScore(nameA) - archivePriorityScore(nameB);
        });

        let dlIndex = 0;
        for (const arq of filteredArquivos) {
            const pdfPartsFull = pdfParts.length >= MAX_PDF_PARTS;


            const fileUrl = arq.url || arq.uri || '';
            const fileName = arq.titulo || arq.nomeArquivo || arq.nome || 'arquivo';
            if (!fileUrl || !arq.statusAtivo) continue;

            try {
                dlIndex++;
                sendProgress(2, `Baixando documento ${dlIndex}/${filteredArquivos.length}...`, `"${fileName}"`);
                console.log(`[PNCP-AI] Downloading: "${fileName}" (tipo: ${arq.tipoDocumentoDescricao || arq.tipoDocumentoId}) from ${fileUrl}`);
                const fileRes = await axios.get(fileUrl, {
                    httpsAgent: agent,
                    timeout: 90000,
                    responseType: 'arraybuffer',
                    maxRedirects: 5
                } as any);

                const buffer = Buffer.from(fileRes.data as ArrayBuffer);
                if (buffer.length === 0) continue;

                // Detect file type by magic bytes
                const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46; // %PDF
                const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B; // PK
                const isRar = buffer[0] === 0x52 && buffer[1] === 0x61 && buffer[2] === 0x72 && buffer[3] === 0x21; // Rar!

                if (isPdf) {
                    const MAX_INLINE_FILE_KB = 8000; // 8MB per file — keeps base64 under ~11MB per part
                    const bufferSizeKB = buffer.length / 1024;
                    
                    // Only add to pdfParts if we haven't reached the limit for Stage 1
                    if (!pdfPartsFull) {
                    if (bufferSizeKB > MAX_INLINE_FILE_KB) {
                        // Large PDF: use Gemini Files API (supports up to 50MB, works with scanned PDFs)
                        console.log(`[PNCP-AI] ⚡ Arquivo grande (${Math.round(bufferSizeKB)}KB > ${MAX_INLINE_FILE_KB}KB). Usando Gemini Files API para upload...`);
                        try {
                            const apiKey = process.env.GEMINI_API_KEY;
                            if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');
                            const filesAi = new GoogleGenAI({ apiKey });
                            const tempFilePath = path.join(uploadDir, `temp_upload_${Date.now()}_${fileName.replace(/[^a-z0-9._-]/gi, '_')}`);
                            fs.writeFileSync(tempFilePath, buffer);
                            const uploadedFile = await filesAi.files.upload({
                                file: tempFilePath,
                                config: { mimeType: 'application/pdf', displayName: fileName }
                            });
                            // Clean up temp file
                            try { fs.unlinkSync(tempFilePath); } catch (_e) {}
                            if (uploadedFile && uploadedFile.uri) {
                                pdfParts.push(createPartFromUri(uploadedFile.uri, uploadedFile.mimeType || 'application/pdf'));
                                console.log(`[PNCP-AI] ✅ Upload via Files API concluído: ${uploadedFile.name} (URI: ${uploadedFile.uri})`);
                            } else {
                                console.warn(`[PNCP-AI] ⚠️ Files API não retornou URI para ${fileName}`);
                            }
                        } catch (e: any) {
                            console.warn(`[PNCP-AI] ⚠️ Falha no upload via Files API para ${fileName}:`, e.message);
                        }
                        totalPdfSizeAccum += 1; // Files API handles storage; minimal budget impact
                    } else {
                        // Budget check: if inline budget exceeded, use Files API as fallback
                        if (totalPdfSizeAccum + bufferSizeKB > MAX_TOTAL_PDF_SIZE_KB && pdfParts.length > 0) {
                            console.log(`[PNCP-AI] ⚡ Orçamento inline de ${MAX_TOTAL_PDF_SIZE_KB}KB atingido. Enviando "${fileName}" via Files API...`);
                            try {
                                const apiKey = process.env.GEMINI_API_KEY;
                                if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');
                                const filesAi = new GoogleGenAI({ apiKey });
                                const tempPath = path.join(uploadDir, `temp_overflow_${Date.now()}_${fileName.replace(/[^a-z0-9._-]/gi, '_')}`);
                                fs.writeFileSync(tempPath, buffer);
                                const uploadedFile = await filesAi.files.upload({
                                    file: tempPath,
                                    config: { mimeType: 'application/pdf', displayName: fileName }
                                });
                                try { fs.unlinkSync(tempPath); } catch (_e) {}
                                if (uploadedFile && uploadedFile.uri) {
                                    pdfParts.push(createPartFromUri(uploadedFile.uri, uploadedFile.mimeType || 'application/pdf'));
                                    console.log(`[PNCP-AI] ✅ Overflow via Files API: ${uploadedFile.name}`);
                                }
                            } catch (e: any) {
                                console.warn(`[PNCP-AI] ⚠️ Files API overflow falhou para ${fileName}:`, e.message);
                                discardedFiles.push(`${fileName} (${Math.round(bufferSizeKB)}KB)`);
                            }
                            totalPdfSizeAccum += 1;
                        } else {
                            totalPdfSizeAccum += bufferSizeKB;
                            pdfParts.push({ inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' } });
                        }
                    }
                    } else {
                        console.log(`[PNCP-AI] 📁 Salvando "${fileName}" (${Math.round(bufferSizeKB)}KB) apenas no storage (limite de ${MAX_PDF_PARTS} docs para IA atingido)`);
                    }
                    
                    const safeFileName = `pncp_${req.user.tenantId}_${fileName.replace(/[^a-z0-9._-]/gi, '_')}`;
                    fs.writeFileSync(path.join(uploadDir, safeFileName), buffer);

                    let storageFileName = safeFileName;
                    try {
                        const up = await storageService.uploadFile({
                            originalname: safeFileName,
                            buffer: buffer,
                            mimetype: 'application/pdf'
                        } as any, req.user.tenantId);
                        storageFileName = up.fileName;
                    } catch (e) {
                        console.error(`[PNCP-AI] Erro upload PDF Storage:`, e);
                    }

                    // Note: pdfParts is pushed either as text or inlineData above

                    downloadedFiles.push(storageFileName);
                    console.log(`[PNCP-AI] ✅ PDF: ${fileName} saved as ${storageFileName} (${(buffer.length / 1024).toFixed(0)} KB)`);
                } else if (isZip) {
                    console.log(`[PNCP-AI] 📦 ZIP detected: ${fileName} (${(buffer.length / 1024).toFixed(0)} KB) — extracting PDFs...`);
                    try {
                        const zip = await JSZip.loadAsync(buffer);
                        let zipEntries = Object.keys(zip.files).filter((name: string) => {
                            if (!name.toLowerCase().endsWith('.pdf') || zip.files[name].dir) return false;
                            const n = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                            const excluded = ARCHIVE_EXCLUDE_PATTERNS.some(pat => n.includes(pat));
                            if (excluded) { console.log(`[PNCP-AI] 🚫 ZIP: Excluído "${name}" (padrão filtrado)`); discardedFiles.push(`${name} (ZIP, filtrado)`); }
                            return !excluded;
                        });
                        // Smart-sort: priorizar edital > TR > planilha > cronograma > BDI > resto
                        zipEntries.sort((a, b) => archivePriorityScore(a) - archivePriorityScore(b));
                        console.log(`[PNCP-AI] ZIP contains ${zipEntries.length} PDF(s) (sorted): ${zipEntries.join(', ')}`);

                        for (const entryName of zipEntries) {
                            const pdfPartsFull = pdfParts.length >= MAX_PDF_PARTS;
                            const pdfBuffer = await zip.files[entryName].async('nodebuffer');
                            const entrySizeKB = pdfBuffer.length / 1024;
                            const MAX_SINGLE_FILE_KB = 8000;
                            
                            if (!pdfPartsFull) {
                                if (entrySizeKB > MAX_SINGLE_FILE_KB) {
                                    console.log(`[PNCP-AI] ⚡ ZIP Entry grande (${Math.round(entrySizeKB)}KB), usando Gemini Files API...`);
                                    try {
                                        const apiKey = process.env.GEMINI_API_KEY;
                                        if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');
                                        const filesAi = new GoogleGenAI({ apiKey });
                                        const tempPath = path.join(uploadDir, `temp_zip_${Date.now()}_${entryName.replace(/[^a-z0-9._-]/gi, '_')}`);
                                        fs.writeFileSync(tempPath, pdfBuffer);
                                        const uploadedFile = await filesAi.files.upload({
                                            file: tempPath,
                                            config: { mimeType: 'application/pdf', displayName: entryName }
                                        });
                                        try { fs.unlinkSync(tempPath); } catch (_e) {}
                                        if (uploadedFile && uploadedFile.uri) {
                                            pdfParts.push(createPartFromUri(uploadedFile.uri, uploadedFile.mimeType || 'application/pdf'));
                                            console.log(`[PNCP-AI] ✅ ZIP Entry via Files API: ${uploadedFile.name}`);
                                        }
                                    } catch (e: any) {
                                        console.warn(`[PNCP-AI] ⚠️ Falha Files API para ZIP entry ${entryName}:`, e.message);
                                    }
                                    totalPdfSizeAccum += 1;
                                } else {
                                    if (pdfBuffer.length > 0) {
                                        if (totalPdfSizeAccum + entrySizeKB > MAX_TOTAL_PDF_SIZE_KB && pdfParts.length > 0) {
                                            console.warn(`[PNCP-AI] \u26a0\ufe0f Orçamento de ${MAX_TOTAL_PDF_SIZE_KB}KB atingido. Apenas salvando no disco ZIP entry "${entryName}" (${Math.round(entrySizeKB)}KB)`);
                                        } else {
                                            totalPdfSizeAccum += entrySizeKB;
                                            pdfParts.push({
                                                inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' }
                                            });
                                        }
                                    }
                                }
                            } else {
                                console.log(`[PNCP-AI] 📁 Salvando "${entryName}" (${Math.round(entrySizeKB)}KB) do ZIP apenas no storage (limite da IA atingido)`);
                            }

                            if (pdfBuffer.length > 0) {
                                const safeName = `pncp_${req.user.tenantId}_${entryName.replace(/[^a-z0-9._-]/gi, '_')}`;
                                fs.writeFileSync(path.join(uploadDir, safeName), pdfBuffer);

                                let storageFileName = safeName;
                                try {
                                    const up = await storageService.uploadFile({
                                        originalname: safeName,
                                        buffer: pdfBuffer,
                                        mimetype: 'application/pdf'
                                    } as any, req.user.tenantId);
                                    storageFileName = up.fileName;
                                } catch (e) {
                                    console.error(`[PNCP-AI] Erro upload ZIP-PDF Storage:`, e);
                                }
                                downloadedFiles.push(storageFileName);
                                console.log(`[PNCP-AI] ✅ Extracted from ZIP: ${entryName} saved as ${storageFileName} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);
                            }
                        }
                    } catch (zipErr: any) {
                        console.warn(`[PNCP-AI] Failed to extract ZIP ${fileName}: ${zipErr.message}`);
                    }
                } else if (isRar) {
                    console.log(`[PNCP-AI] 📦 RAR detected: ${fileName} (${(buffer.length / 1024).toFixed(0)} KB) — extracting PDFs...`);
                    try {
                        const extractor = await createExtractorFromData({ data: new Uint8Array(buffer).buffer });
                        const extracted = extractor.extract({});
                        const files = [...extracted.files];
                        const pdfFiles = files.filter(f => {
                            if (!f.fileHeader.name.toLowerCase().endsWith('.pdf')) return false;
                            if (f.fileHeader.flags.directory || !f.extraction) return false;
                            const n = f.fileHeader.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                            const excluded = ARCHIVE_EXCLUDE_PATTERNS.some(pat => n.includes(pat));
                            if (excluded) { console.log(`[PNCP-AI] 🚫 RAR: Excluído "${f.fileHeader.name}" (padrão filtrado)`); discardedFiles.push(`${f.fileHeader.name} (RAR, filtrado)`); }
                            return !excluded;
                        });
                        // Smart-sort: priorizar edital > TR > planilha > cronograma > BDI > resto
                        pdfFiles.sort((a, b) => archivePriorityScore(a.fileHeader.name) - archivePriorityScore(b.fileHeader.name));
                        console.log(`[PNCP-AI] RAR contains ${pdfFiles.length} PDF(s) (sorted): ${pdfFiles.map(f => f.fileHeader.name).join(', ')}`);

                        for (const rarFile of pdfFiles) {
                            const pdfPartsFull = pdfParts.length >= MAX_PDF_PARTS;
                            if (rarFile.extraction && rarFile.extraction.length > 0) {
                                const pdfBuffer = Buffer.from(rarFile.extraction);
                                const entrySizeKB = pdfBuffer.length / 1024;
                                const MAX_SINGLE_FILE_KB = 8000;
                                
                                if (!pdfPartsFull) {
                                    if (entrySizeKB > MAX_SINGLE_FILE_KB) {
                                        console.log(`[PNCP-AI] ⚡ RAR Entry grande (${Math.round(entrySizeKB)}KB), usando Gemini Files API...`);
                                        try {
                                            const apiKey = process.env.GEMINI_API_KEY;
                                            if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');
                                            const filesAi = new GoogleGenAI({ apiKey });
                                            const tempPath = path.join(uploadDir, `temp_rar_${Date.now()}_${rarFile.fileHeader.name.replace(/[^a-z0-9._-]/gi, '_')}`);
                                            fs.writeFileSync(tempPath, pdfBuffer);
                                            const uploadedFile = await filesAi.files.upload({
                                                file: tempPath,
                                                config: { mimeType: 'application/pdf', displayName: rarFile.fileHeader.name }
                                            });
                                            try { fs.unlinkSync(tempPath); } catch (_e) {}
                                            if (uploadedFile && uploadedFile.uri) {
                                                pdfParts.push(createPartFromUri(uploadedFile.uri, uploadedFile.mimeType || 'application/pdf'));
                                                console.log(`[PNCP-AI] ✅ RAR Entry via Files API: ${uploadedFile.name}`);
                                            }
                                        } catch (e: any) {
                                            console.warn(`[PNCP-AI] ⚠️ Falha Files API para RAR entry ${rarFile.fileHeader.name}:`, e.message);
                                        }
                                        totalPdfSizeAccum += 1;
                                    } else {
                                        if (totalPdfSizeAccum + entrySizeKB > MAX_TOTAL_PDF_SIZE_KB && pdfParts.length > 0) {
                                            console.warn(`[PNCP-AI] ⚠️ Orçamento de ${MAX_TOTAL_PDF_SIZE_KB}KB atingido. Apenas salvando no disco RAR entry "${rarFile.fileHeader.name}" (${Math.round(entrySizeKB)}KB)`);
                                        } else {
                                            totalPdfSizeAccum += entrySizeKB;
                                            pdfParts.push({
                                                inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' }
                                            });
                                        }
                                    }
                                } else {
                                    console.log(`[PNCP-AI] 📁 Salvando "${rarFile.fileHeader.name}" (${Math.round(entrySizeKB)}KB) do RAR apenas no storage (limite da IA atingido)`);
                                }

                                const safeName = `pncp_${req.user.tenantId}_${rarFile.fileHeader.name.replace(/[^a-z0-9._-]/gi, '_')}`;
                                fs.writeFileSync(path.join(uploadDir, safeName), pdfBuffer);

                                let storageFileName = safeName;
                                try {
                                    const up = await storageService.uploadFile({
                                        originalname: safeName,
                                        buffer: pdfBuffer,
                                        mimetype: 'application/pdf'
                                    } as any, req.user.tenantId);
                                    storageFileName = up.fileName;
                                } catch (e) {
                                    console.error(`[PNCP-AI] Erro upload RAR-PDF Storage:`, e);
                                }
                                downloadedFiles.push(storageFileName);
                                console.log(`[PNCP-AI] ✅ Extracted from RAR: ${rarFile.fileHeader.name} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);
                            }
                        }
                    } catch (rarErr: any) {
                        console.warn(`[PNCP-AI] Failed to extract RAR ${fileName}: ${rarErr.message}`);
                    }
                } else {
                    console.log(`[PNCP-AI] ⏭️ Skipped non-PDF/non-ZIP/non-RAR: ${fileName} (first bytes: ${buffer[0].toString(16)} ${buffer[1].toString(16)})`);
                }
            } catch (dlErr: any) {
                console.warn(`[PNCP-AI] Failed to download ${fileName}: ${dlErr.message}`);
            }
        }

        if (pdfParts.length === 0) {
            return sendError(
                'Nenhum arquivo PDF encontrado para este edital no PNCP.',
                `Encontramos ${arquivos.length} arquivo(s) mas nenhum era PDF ou ZIP com PDFs.`
            );
        }

        // ═══════════════════════════════════════════════════════════════════════
        // V2 PIPELINE — 3-Stage Analysis (migrated from /api/analyze-edital/v2)
        // ═══════════════════════════════════════════════════════════════════════
        
        // ── MODEL CONFIGURATION ──
        // Each pipeline stage uses the optimal model for its task
        const PIPELINE_MODELS = {
            extraction: 'gemini-2.5-flash',         // Etapa 1: PDF parsing (multimodal, proven)
            reExtraction: 'gemini-2.5-flash',       // Re-extraction fallback  
            normalization: 'gemini-2.5-flash',       // Etapa 2: text-only JSON→JSON — upgraded from flash-lite (QTO/QTP confusion fix)
            normQtp: 'gemini-2.5-flash',             // Etapa 2 QTP: needs full Flash for Rule 18 (CAT explosion)
            riskReview: 'gemini-2.5-flash',          // Etapa 3: text-only risk analysis — upgraded from flash-lite (better critical_points)
        };
        console.log(`[PNCP-V2] 🤖 Modelos: E1=${PIPELINE_MODELS.extraction} | E2=${PIPELINE_MODELS.normalization} (QTP=${PIPELINE_MODELS.normQtp}) | E3=${PIPELINE_MODELS.riskReview}`);

        sendProgress(3, 'Documentos prontos para análise', `${pdfParts.length} PDFs`);

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return sendError('GEMINI_API_KEY não configurada');
        }
        const ai = new GoogleGenAI({ apiKey });
        const analysisStartTime = Date.now();

        // Initialize V2 result schema
        const v2Result = createEmptyAnalysisSchema();
        v2Result.analysis_meta.analysis_id = `pncp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        v2Result.analysis_meta.generated_at = new Date().toISOString();
        v2Result.analysis_meta.source_files = downloadedFiles;
        v2Result.analysis_meta.source_type = 'pncp_download';

        let modelsUsed: string[] = [];
        const stageTimes: Record<string, number> = {};
        // Pipeline health tracking for honest confidence scoring
        const pipelineHealth = {
            parseRepairs: 0,
            fallbacksUsed: 0,
            stagesFailed: 0,
        };

        console.log(`[PNCP-V2] ═══ PIPELINE INICIADO ═══ (${pdfParts.length} PDFs, ${downloadedFiles.join(', ')})`);

        // ── Stage 1: Factual Extraction (with PDFs) ──
        // Log diagnostic info about PDFs being sent
        const pdfSizes = pdfParts.map((p: any, i: number) => {
            if (p.inlineData?.data) {
                const sizeKB = Math.round(Buffer.from(p.inlineData.data, 'base64').length / 1024);
                return `Doc${i + 1}: ${sizeKB}KB`;
            } else if (p.fileData?.fileUri) {
                return `Doc${i + 1}: FilesAPI`;
            } else {
                return `Doc${i + 1}: text`;
            }
        });
        const totalPdfSizeKB = pdfParts.reduce((sum: number, p: any) => {
            if (p.inlineData?.data) return sum + Buffer.from(p.inlineData.data, 'base64').length;
            return sum;
        }, 0) / 1024;
        sendProgress(4, 'IA extraindo dados dos documentos...', `Etapa 1/3 — ${pdfParts.length} PDFs (${Math.round(totalPdfSizeKB)}KB inline)`);
        console.log(`[PNCP-V2] ── Etapa 1/3: Extração Factual (${pdfParts.length} partes, ${Math.round(totalPdfSizeKB)}KB inline — ${pdfSizes.join(', ')})...`);
        let extractionJson: any;
        const t1Start = Date.now();

        try {
            const extractionResponse = await callGeminiWithRetry(ai.models, {
                model: PIPELINE_MODELS.extraction,
                contents: [{
                    role: 'user',
                    parts: [
                        ...pdfParts,
                        { text: V2_EXTRACTION_USER_INSTRUCTION.replace('{domainReinforcement}', '') }
                    ]
                }],
                config: {
                    systemInstruction: V2_EXTRACTION_PROMPT,
                    temperature: 0.05,
                    maxOutputTokens: 65536,
                    responseMimeType: 'application/json'
                }
            }, 5, { tenantId: req.user.tenantId, operation: 'analysis', metadata: { stage: 'raw_extraction' } });
            const extractionText = extractionResponse.text;
            if (!extractionText) throw new Error('Etapa 1 retornou vazio');
            const parseResult1 = robustJsonParseDetailed(extractionText, 'PNCP-V2-Extraction');
            extractionJson = parseResult1.data;
            if (parseResult1.repaired) pipelineHealth.parseRepairs++;
            v2Result.analysis_meta.workflow_stage_status.extraction = 'done';
            modelsUsed.push(PIPELINE_MODELS.extraction);
            stageTimes.extraction = (Date.now() - t1Start) / 1000;
            console.log(`[PNCP-V2] ✅ Etapa 1 em ${stageTimes.extraction.toFixed(1)}s — ${(extractionJson.evidence_registry || []).length} evidências, ${Object.values(extractionJson.requirements || {}).flat().length} exigências`);
        } catch (err: any) {
            const errMsg = err?.message || String(err);
            const isServiceOverload = errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('high demand') || errMsg.includes('429');
            console.warn(`[PNCP-V2] ⚠️ Etapa 1 Gemini falhou (${isServiceOverload ? 'SOBRECARGA' : 'ERRO'}): ${errMsg}. Tentando OpenAI...`);
            pipelineHealth.fallbacksUsed++;
            try {
                const openAiResult = await fallbackToOpenAiV2({
                    systemPrompt: V2_EXTRACTION_PROMPT,
                    userPrompt: V2_EXTRACTION_USER_INSTRUCTION.replace('{domainReinforcement}', ''),
                    pdfParts,
                    temperature: 0.05,
                    maxTokens: 65536,
                    stageName: 'PNCP Etapa 1 (Extração)'
                });
                if (!openAiResult.text) throw new Error('OpenAI retornou vazio');
                extractionJson = robustJsonParse(openAiResult.text, 'PNCP-V2-Extraction-OpenAI');
                v2Result.analysis_meta.workflow_stage_status.extraction = 'done';
                modelsUsed.push(openAiResult.model);
                stageTimes.extraction = (Date.now() - t1Start) / 1000;
                console.log(`[PNCP-V2] ✅ Etapa 1 via OpenAI em ${stageTimes.extraction.toFixed(1)}s`);
            } catch (openAiErr: any) {
                console.error(`[PNCP-V2] ❌ Etapa 1 falhou (ambos modelos)`);
                // User-friendly error message that distinguishes service overload from document issues
                if (isServiceOverload) {
                    throw new Error(`A IA está temporariamente sobrecarregada (5 tentativas em ~90s). ` +
                        `Tente novamente em 1-2 minutos. O edital está salvo e será processado.`);
                }
                throw new Error(`Etapa 1 (Extração) falhou. Gemini: ${errMsg} | OpenAI: ${openAiErr.message}`);
            }
        }

        // Merge extraction into V2 result
        if (extractionJson.process_identification) v2Result.process_identification = extractionJson.process_identification;
        if (extractionJson.timeline) v2Result.timeline = extractionJson.timeline;
        if (extractionJson.participation_conditions) v2Result.participation_conditions = extractionJson.participation_conditions;
        if (extractionJson.requirements) v2Result.requirements = extractionJson.requirements;
        if (extractionJson.technical_analysis) v2Result.technical_analysis = extractionJson.technical_analysis;
        if (extractionJson.economic_financial_analysis) v2Result.economic_financial_analysis = extractionJson.economic_financial_analysis;
        if (extractionJson.proposal_analysis) v2Result.proposal_analysis = extractionJson.proposal_analysis;
        if (extractionJson.contractual_analysis) v2Result.contractual_analysis = extractionJson.contractual_analysis;
        if (extractionJson.evidence_registry) v2Result.evidence_registry = extractionJson.evidence_registry;

        // Diagnostic: check itens_licitados extraction
        const extractedItens = v2Result.proposal_analysis?.itens_licitados || [];
        console.log(`[PNCP-V2] 📋 itens_licitados: ${Array.isArray(extractedItens) ? extractedItens.length : 0} itens extraídos pela Etapa 1`);

        // ── MANDATORY RFT COMPLETENESS INJECTION ──
        // The AI model consistently omits "obvious" fiscal documents (CNPJ, inscrições).
        // This server-side safety net ensures they're always present.
        const rftItems = Array.isArray((extractionJson.requirements as any)?.regularidade_fiscal_trabalhista)
            ? (extractionJson.requirements as any).regularidade_fiscal_trabalhista as any[]
            : [];
        const rftTexts = rftItems.map((r: any) => `${r.title || ''} ${r.description || ''}`.toLowerCase()).join(' ');

        // Find an existing source_ref from RFT items to reuse
        const existingRftSourceRef = rftItems.find((r: any) => r.source_ref && r.source_ref !== 'referência não localizada')?.source_ref || 'Edital, seção de habilitação';

        const mandatoryRftDocs = [
            {
                keywords: ['cnpj', 'cadastro nacional'],
                item: { requirement_id: 'RFT-CNPJ', title: 'Prova de inscrição no CNPJ', description: 'Comprovação de inscrição e situação cadastral no Cadastro Nacional da Pessoa Jurídica (CNPJ)', obligation_type: 'obrigatoria_universal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: existingRftSourceRef, entry_type: 'exigencia_principal' }
            },
            {
                keywords: ['inscrição estadual', 'inscricao estadual', 'cadastro estadual'],
                item: { requirement_id: 'RFT-IE', title: 'Inscrição estadual no cadastro de contribuintes', description: 'Prova de inscrição no cadastro de contribuintes estadual, relativo ao domicílio ou sede do licitante, pertinente ao seu ramo de atividade', obligation_type: 'se_aplicavel', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: existingRftSourceRef, entry_type: 'exigencia_principal' }
            },
            {
                keywords: ['inscrição municipal', 'inscricao municipal', 'cadastro municipal'],
                item: { requirement_id: 'RFT-IM', title: 'Inscrição municipal no cadastro de contribuintes', description: 'Prova de inscrição no cadastro de contribuintes municipal, relativo ao domicílio ou sede do licitante, pertinente ao seu ramo de atividade', obligation_type: 'se_aplicavel', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: existingRftSourceRef, entry_type: 'exigencia_principal' }
            },
        ];

        let injectedCount = 0;
        for (const doc of mandatoryRftDocs) {
            const alreadyExists = doc.keywords.some(kw => rftTexts.includes(kw));
            if (!alreadyExists) {
                // CNPJ is always mandatory; inscrições only if edital has habilitação section
                const isCnpj = doc.item.requirement_id === 'RFT-CNPJ';
                const hasHabilitacao = rftItems.length > 0; // If there are ANY RFT items, habilitação exists
                if (isCnpj || hasHabilitacao) {
                    rftItems.push(doc.item);
                    injectedCount++;
                }
            }
        }

        if (injectedCount > 0) {
            (extractionJson.requirements as any).regularidade_fiscal_trabalhista = rftItems;
            (v2Result.requirements as any).regularidade_fiscal_trabalhista = rftItems;
            console.log(`[PNCP-V2] 🔧 RFT completude: +${injectedCount} doc(s) injetado(s) (CNPJ/inscrições omitidos pela IA)`);
        }

        // ── M3: DEDUP — remove generic "estadual ou municipal" if IE/IM are separate ──
        const hasIE = rftItems.some((r: any) => r.requirement_id === 'RFT-IE' || /inscri[çc][ãa]o\s+estadual/i.test(r.title || ''));
        const hasIM = rftItems.some((r: any) => r.requirement_id === 'RFT-IM' || /inscri[çc][ãa]o\s+municipal/i.test(r.title || ''));
        if (hasIE && hasIM) {
            // Remove generic combined IE+IM items ("estadual ou municipal" / "estadual e municipal")
            const beforeLen = rftItems.length;
            const dedupedRft = rftItems.filter((r: any) => {
                const title = (r.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const isGenericCombined = (title.includes('estadual') && title.includes('municipal'))
                    && r.requirement_id !== 'RFT-IE' && r.requirement_id !== 'RFT-IM';
                return !isGenericCombined;
            });
            if (dedupedRft.length < beforeLen) {
                (extractionJson.requirements as any).regularidade_fiscal_trabalhista = dedupedRft;
                (v2Result.requirements as any).regularidade_fiscal_trabalhista = dedupedRft;
                console.log(`[PNCP-V2] 🧹 Dedup IE/IM: removido(s) ${beforeLen - dedupedRft.length} item(ns) genérico(s) (IE+IM separados existem)`);
            }
        }


        // ── HARD FAILURE GATE: Check extraction quality ──
        const extractedReqs = Object.values(extractionJson.requirements || {}).flat().length;
        const extractedEvidence = (extractionJson.evidence_registry || []).length;
        const hasProcessId = !!(extractionJson.process_identification?.objeto_resumido || extractionJson.process_identification?.objeto_completo);

        // Log detailed per-category extraction
        if (extractionJson.requirements) {
            const catCounts = Object.entries(extractionJson.requirements)
                .map(([cat, items]: [string, any]) => `${cat}: ${Array.isArray(items) ? items.length : 0}`)
                .join(' | ');
            console.log(`[PNCP-V2] 📋 Exigências por categoria: ${catCounts}`);
        }
        console.log(`[PNCP-V2] 📊 Extração: ${extractedReqs} exigências, ${extractedEvidence} evidências, processo=${hasProcessId}`);

        // ── ANTI-HALLUCINATION GATE (V4.7.1) ──
        // Detect when the AI generates template/example data from prompt examples
        // instead of reading the actual PDF documents.
        const hallucinationSignals: string[] = [];
        const processId = extractionJson.process_identification || {};
        const allProcessText = [
            processId.orgao, processId.objeto_resumido, processId.objeto_completo,
            processId.municipio_uf, processId.link_sistema, processId.fonte_oficial,
        ].filter(Boolean).join(' ').toLowerCase();

        // Known template/example patterns from prompt examples and taxonomy
        const HALLUCINATION_PATTERNS = [
            { pattern: /prefeitura\s+municipal\s+de\s+exemplo/i, label: 'orgão fictício "Prefeitura Municipal de Exemplo"' },
            { pattern: /exemplo\.gov/i, label: 'URL fictícia "exemplo.gov"' },
            { pattern: /exemplo\/ex\b/i, label: 'UF fictícia "EX"' },
            { pattern: /\bmunicípio\s+de\s+exemplo\b/i, label: 'município fictício "Exemplo"' },
            { pattern: /\borgão\s+de\s+exemplo\b/i, label: 'órgão fictício' },
            { pattern: /\bcidade\s+exemplo\b/i, label: 'cidade fictícia' },
        ];

        for (const hp of HALLUCINATION_PATTERNS) {
            if (hp.pattern.test(allProcessText)) {
                hallucinationSignals.push(hp.label);
            }
        }

        // Additional check: if ALL source_refs are generic "Edital, item X.X" with sequential numbering
        // AND the orgao contains "Exemplo" — strong hallucination signal
        const evidences = extractionJson.evidence_registry || [];
        if (evidences.length > 0) {
            const genericRefCount = evidences.filter((e: any) => /^Edital,\s*item\s+\d+\.\d+$/i.test(e.source_ref || '')).length;
            if (genericRefCount === evidences.length && hallucinationSignals.length > 0) {
                hallucinationSignals.push('todas as referências são genéricas "Edital, item X.X"');
            }
        }

        if (hallucinationSignals.length > 0) {
            console.error(`[PNCP-V2] 🚨 ALUCINAÇÃO DETECTADA: ${hallucinationSignals.join(', ')}`);
            console.error(`[PNCP-V2] 🚨 A IA gerou dados de TEMPLATE em vez de ler o PDF real. Abortando análise.`);
            v2Result.analysis_meta.workflow_stage_status.extraction = 'failed';
            return sendError(
                'Alucinação detectada — a IA não conseguiu ler os documentos',
                `A IA gerou dados fictícios (${hallucinationSignals.join('; ')}) em vez de extrair do edital real. ` +
                    `Isso geralmente ocorre quando o PDF está protegido, escaneado sem OCR, ou houve falha de comunicação com a IA. ` +
                    `Tente novamente em alguns minutos.`
            );
        }

        // Hard failure: Extraction returned materially empty content
        const MIN_REQUIREMENTS = 3;
        const MIN_EVIDENCE = 1;
        if (extractedReqs < MIN_REQUIREMENTS && extractedEvidence < MIN_EVIDENCE && !hasProcessId) {
            console.error(`[PNCP-V2] ❌ FALHA FACTUAL DURA: ${extractedReqs} exigências (mín: ${MIN_REQUIREMENTS}), ${extractedEvidence} evidências (mín: ${MIN_EVIDENCE}), sem identificação do processo`);
            v2Result.analysis_meta.workflow_stage_status.extraction = 'failed';
            const totalDuration = ((Date.now() - analysisStartTime) / 1000).toFixed(1);
            return sendError(
                'Extração factual insuficiente',
                `A IA não conseguiu extrair dados suficientes dos ${pdfParts.length} documento(s). ` +
                    `Foram encontradas apenas ${extractedReqs} exigência(s) e ${extractedEvidence} evidência(s). ` +
                    `Isso pode indicar que os documentos estão escaneados com baixa qualidade, protegidos, ou em formato não-textual.`
            );
        }

        // Soft warning: Low quality extraction (still continues)
        if (extractedReqs < MIN_REQUIREMENTS || extractedEvidence < MIN_EVIDENCE) {
            console.warn(`[PNCP-V2] ⚠️ Extração abaixo do ideal: ${extractedReqs} exigências, ${extractedEvidence} evidências — pipeline continua com degradação`);
            v2Result.confidence.warnings.push(`Extração com qualidade reduzida: ${extractedReqs} exigências, ${extractedEvidence} evidências`);
            if (extractedReqs < MIN_REQUIREMENTS) {
                v2Result.confidence.warnings.push(`Extração retornou apenas ${extractedReqs} exigência(s) — possível truncamento ou PDF protegido`);
            }
        }

        // Domain Routing
        const detectedObjectType = v2Result.process_identification?.tipo_objeto || 'outro';
        const domainReinforcement = getDomainRoutingInstruction(detectedObjectType);
        if (domainReinforcement) {
            console.log(`[PNCP-V2] 🎯 Roteamento por tipo: ${detectedObjectType}`);
        }

        // ── CATEGORY GAP DETECTION + TARGETED RE-EXTRACTION (V4.7.0) ──
        // Reativado com otimização: só dispara quando há truncamento detectado (parseRepairs>0)
        // OU quando ≥2 categorias críticas estão vazias para o tipo de objeto.
        // Usa apenas 1-2 PDFs e prompt focado → ~15-25s extra (vs 60s+ na V1).
        const expectedCategories: Record<string, string[]> = {
            'obra_engenharia': ['qualificacao_tecnica_operacional', 'qualificacao_tecnica_profissional', 'qualificacao_economico_financeira', 'proposta_comercial'],
            'servico_comum_engenharia': ['qualificacao_tecnica_operacional', 'qualificacao_tecnica_profissional', 'qualificacao_economico_financeira', 'proposta_comercial'],
            'servico_comum': ['qualificacao_tecnica_operacional', 'qualificacao_economico_financeira', 'proposta_comercial'],
            'fornecimento': ['qualificacao_economico_financeira', 'proposta_comercial'],
            'locacao': ['qualificacao_economico_financeira', 'proposta_comercial'],
            'outro': ['qualificacao_economico_financeira', 'proposta_comercial'],
        };
        const objType = detectedObjectType || 'outro';
        const expected = expectedCategories[objType] || expectedCategories['outro'];
        const missingCategories = expected.filter(cat => {
            const items = Array.isArray((extractionJson.requirements as any)?.[cat]) ? (extractionJson.requirements as any)[cat] : [];
            return items.length === 0;
        });

        // Trigger conditions: (A) JSON was repaired (truncation likely) OR (B) ≥2 critical categories empty
        const hasTruncationSignal = pipelineHealth.parseRepairs > 0;
        const hasCriticalGap = missingCategories.length >= 2;
        // Also check if RFT is suspiciously thin (only CNPJ/IE/IM injected, no CNDs) — sign of truncation
        const rftOnlyInjected = rftItems.length <= 3 + injectedCount && injectedCount > 0;
        const shouldReExtract = missingCategories.length > 0 && (hasTruncationSignal || hasCriticalGap || rftOnlyInjected);

        if (shouldReExtract) {
            console.warn(`[PNCP-V2] 🔍 GAP DETECTADO: ${missingCategories.length} categorias vazias para ${objType}: ${missingCategories.join(', ')} ` +
                `(truncamento=${hasTruncationSignal}, gap_critico=${hasCriticalGap}, rft_thin=${rftOnlyInjected})`);
            sendProgress(5, 'Completando categorias faltantes...', `${missingCategories.length} categorias precisam re-extração`);
            console.log(`[PNCP-V2] ── Re-extração focada para categorias faltantes...`);

            const missingCatLabels: Record<string, string> = {
                'qualificacao_tecnica_operacional': 'Qualificação Técnica Operacional (atestados da empresa, parcelas relevantes, visita técnica)',
                'qualificacao_tecnica_profissional': 'Qualificação Técnica Profissional (RT, CAT, acervo técnico do profissional)',
                'qualificacao_economico_financeira': 'Qualificação Econômico-Financeira (balanço, índices contábeis LG/LC/SG/EG, certidão falência, patrimônio/capital social mínimo)',
                'proposta_comercial': 'Proposta Comercial (envelope de preços, planilha, BDI, validade, formato)',
                'documentos_complementares': 'Documentos Complementares e Declarações (declarações, procurações, docs auxiliares)',
                'regularidade_fiscal_trabalhista': 'Regularidade Fiscal e Trabalhista (CND Federal, Estadual, Municipal, FGTS, CNDT)',
            };

            // Also add RFT to re-extraction if it seems truncated (only injected items, no CNDs)
            const rftMissingCnds = rftOnlyInjected && !missingCategories.includes('regularidade_fiscal_trabalhista');
            const effectiveMissingCategories = rftMissingCnds
                ? [...missingCategories, 'regularidade_fiscal_trabalhista']
                : missingCategories;

            const catDescriptions = effectiveMissingCategories.map(c => `- ${missingCatLabels[c] || c}`).join('\n');

            // Already-captured categories for exclusion instructions
            const capturedCategories = Object.entries(extractionJson.requirements || {})
                .filter(([, items]) => Array.isArray(items) && items.length > 0)
                .map(([cat]) => cat);

            const reExtractionPrompt = `ATENÇÃO: a extração anterior capturou apenas ${extractedReqs} exigências e OMITIU categorias inteiras (provável truncamento de output).

As seguintes categorias estão VAZIAS e precisam ser COMPLETAMENTE extraídas dos documentos:
${catDescriptions}

Categorias JÁ CAPTURADAS (NÃO re-extraia): ${capturedCategories.join(', ')}

INSTRUÇÕES:
1. Leia ATENTAMENTE todo o edital e TR/ETP procurando as seções de HABILITAÇÃO, QUALIFICAÇÃO TÉCNICA e REQUISITOS FINANCEIROS.
2. Extraia TODAS as exigências das categorias faltantes listadas acima.
3. Para QTO/QTP, transcreva LITERALMENTE cada parcela de maior relevância com quantitativos exatos.
4. Para QEF, extraia balanço, índices (LG, LC, SG, EG), patrimônio/capital mínimo, certidão de falência.
5. Para RFT (se listada), extraia TODAS as certidões: CND Federal (Receita + PGFN), Estadual, Municipal, CRF/FGTS, CNDT.
6. Inclua evidence_registry com ao menos 1 evidência por exigência principal.

${domainReinforcement || ''}

Retorne JSON com: { "requirements": { ... apenas categorias faltantes ... }, "evidence_registry": [...] }`;

            const t15Start = Date.now();
            try {
                // Use first 2 PDFs (edital + TR typically) for re-extraction
                const reExtractionParts = pdfParts.slice(0, Math.min(2, pdfParts.length));
                const reExtractionResponse = await callGeminiWithRetry(ai.models, {
                    model: PIPELINE_MODELS.reExtraction,
                    contents: [{
                        role: 'user',
                        parts: [
                            ...reExtractionParts,
                            { text: reExtractionPrompt }
                        ]
                    }],
                    config: {
                        systemInstruction: V2_EXTRACTION_PROMPT,
                        temperature: 0.05,
                        maxOutputTokens: 32768,
                        responseMimeType: 'application/json'
                    }
                }, 4, { tenantId: req.user.tenantId, operation: 'analysis', metadata: { stage: 're-extraction' } });
                const reText = reExtractionResponse.text;
                if (reText) {
                    const reParseResult = robustJsonParseDetailed(reText, 'PNCP-V2-ReExtraction');
                    const reData = reParseResult.data;
                    if (reParseResult.repaired) pipelineHealth.parseRepairs++;

                    // Merge re-extracted categories into the main extraction
                    let reExtractedCount = 0;
                    if (reData.requirements) {
                        for (const [cat, items] of Object.entries(reData.requirements)) {
                            if (Array.isArray(items) && items.length > 0) {
                                const existing = Array.isArray((extractionJson.requirements as any)?.[cat]) ? (extractionJson.requirements as any)[cat] : [];
                                if (existing.length === 0) {
                                    // Category was completely empty — fill with re-extracted data
                                    (extractionJson.requirements as any)[cat] = items;
                                    (v2Result.requirements as any)[cat] = items;
                                    reExtractedCount += (items as any[]).length;
                                    console.log(`[PNCP-V2] ✅ Re-extração ${cat}: +${(items as any[]).length} itens`);
                                } else if (cat === 'regularidade_fiscal_trabalhista' && rftOnlyInjected) {
                                    // RFT had only injected items — merge real CNDs from re-extraction
                                    const newItems = (items as any[]).filter((item: any) => {
                                        const title = (item.title || '').toLowerCase();
                                        // Don't duplicate CNPJ/IE/IM already injected
                                        return !title.includes('cnpj') && !title.includes('inscrição estadual') && !title.includes('inscrição municipal');
                                    });
                                    if (newItems.length > 0) {
                                        existing.push(...newItems);
                                        (extractionJson.requirements as any).regularidade_fiscal_trabalhista = existing;
                                        (v2Result.requirements as any).regularidade_fiscal_trabalhista = existing;
                                        reExtractedCount += newItems.length;
                                        console.log(`[PNCP-V2] ✅ Re-extração RFT (CNDs): +${newItems.length} itens adicionais`);
                                    }
                                }
                            }
                        }
                    }
                    // Merge evidence_registry
                    if (reData.evidence_registry && Array.isArray(reData.evidence_registry)) {
                        extractionJson.evidence_registry = [
                            ...(extractionJson.evidence_registry || []),
                            ...reData.evidence_registry
                        ];
                        v2Result.evidence_registry = extractionJson.evidence_registry;
                    }

                    const reDuration = ((Date.now() - t15Start) / 1000).toFixed(1);
                    stageTimes.re_extraction = parseFloat(reDuration);
                    console.log(`[PNCP-V2] ✅ Re-extração concluída em ${reDuration}s: +${reExtractedCount} exigências, +${(reData.evidence_registry || []).length} evidências`);
                    if (reExtractedCount > 0) {
                        v2Result.confidence.warnings.push(`Re-extração recuperou ${reExtractedCount} exigência(s) de ${effectiveMissingCategories.length} categoria(s) truncada(s)`);
                    }
                }
            } catch (reErr: any) {
                const reDuration = ((Date.now() - t15Start) / 1000).toFixed(1);
                console.warn(`[PNCP-V2] ⚠️ Re-extração falhou em ${reDuration}s: ${reErr.message}. Continuando com dados parciais.`);
                v2Result.confidence.warnings.push(`Re-extração de categorias faltantes falhou: ${reErr.message}`);
                pipelineHealth.fallbacksUsed++;
            }
        } else if (missingCategories.length > 0) {
            console.log(`[PNCP-V2] ℹ️ ${missingCategories.length} categorias vazias (${missingCategories.join(', ')}) — sem sinal de truncamento, mantendo extração original`);
        }

        // ── Stages 2+3: Normalization + Risk Review (PARALLEL — text-only, no PDFs) ──
        sendProgress(6, 'Normalizando exigências e avaliando riscos...', 'Etapas 2+3/3 em paralelo');
        console.log(`[PNCP-V2] ── Etapas 2+3/3: Normalização + Risco (paralelo)...`);
        let normalizationJson: any = {};
        const extractionJsonCompact = JSON.stringify(extractionJson);  // Compact — saves ~20-30% tokens
        const t2t3Start = Date.now();

        // Run both stages concurrently
        const [normSettled, riskSettled, itemsSettled] = await Promise.allSettled([
            // ── Stage 2: Per-Category Normalization (7 parallel micro-calls) ──
            (async () => {
                const t2Start = Date.now();
                const mergedRequirements: Record<string, any[]> = {};
                const mergedDocs: any[] = [];
                let totalNormalized = 0;
                let categoriesFailed = 0;
                let categoriesSkipped = 0;
                let usedFallback = false;
                let hadRepair = false;

                // Build parallel tasks for categories that have items
                const categoryTasks = NORM_CATEGORIES.map(cat => {
                    const items = Array.isArray((extractionJson.requirements as any)?.[cat.key])
                        ? (extractionJson.requirements as any)[cat.key]
                        : [];

                    if (items.length === 0) {
                        mergedRequirements[cat.key] = [];
                        categoriesSkipped++;
                        return null; // Skip empty categories
                    }

                    // ── FAST-PATH: HJ, RFT, QEF — server-side normalization (no AI call) ──
                    const FAST_NORM_CATEGORIES = ['habilitacao_juridica', 'regularidade_fiscal_trabalhista', 'qualificacao_economico_financeira'];
                    if (FAST_NORM_CATEGORIES.includes(cat.key)) {
                        // Deterministic normalization — assign IDs, entry_type, risk_if_missing
                        const riskDefault = cat.key === 'habilitacao_juridica' ? 'inabilitacao'
                            : cat.key === 'regularidade_fiscal_trabalhista' ? 'inabilitacao'
                            : 'inabilitacao';
                        const normalized = items.map((item: any, idx: number) => ({
                            ...item,
                            requirement_id: item.requirement_id || `${cat.prefix}-${String(idx + 1).padStart(2, '0')}`,
                            entry_type: item.entry_type || 'exigencia_principal',
                            risk_if_missing: item.risk_if_missing || riskDefault,
                            applies_to: item.applies_to || 'licitante',
                            obligation_type: item.obligation_type || 'obrigatoria_universal',
                            phase: item.phase || 'habilitacao',
                            source_ref: item.source_ref || 'referência não localizada',
                        }));
                        mergedRequirements[cat.key] = normalized;
                        totalNormalized += normalized.length;
                        // Generate documents_to_prepare
                        normalized.filter((n: any) => n.entry_type === 'exigencia_principal').forEach((n: any) => {
                            mergedDocs.push({
                                document_name: n.title || n.requirement_id,
                                category: cat.key,
                                priority: n.risk_if_missing === 'inabilitacao' ? 'critica' : 'alta',
                                responsible_area: cat.key === 'regularidade_fiscal_trabalhista' ? 'contabil'
                                    : cat.key === 'qualificacao_economico_financeira' ? 'contabil'
                                    : 'juridico',
                                notes: ''
                            });
                        });
                        console.log(`[PNCP-V2] ⚡ FastNorm ${cat.prefix}: ${normalized.length} itens (server-side, 0 API calls)`);
                        return { cat: cat.key, success: true, fastPath: true };
                    }

                    // ── AI NORMALIZATION: QTO, QTP, PC, DC (interpretation needed) ──
                    // QTP uses full Flash model for Rule 18 (CAT explosion) reliability
                    const normModel = cat.key === 'qualificacao_tecnica_profissional'
                        ? PIPELINE_MODELS.normQtp
                        : PIPELINE_MODELS.normalization;
                    return (async () => {
                        const systemPrompt = buildCategoryNormPrompt(cat);
                        const userPrompt = buildCategoryNormUser(cat, items);

                        try {
                            const resp = await callGeminiWithRetry(ai.models, {
                                model: normModel,
                                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                                config: {
                                    systemInstruction: systemPrompt,
                                    temperature: 0.1,
                                    maxOutputTokens: 16384,
                                    responseMimeType: 'application/json'
                                }
                            }, 1, { tenantId: req.user.tenantId, operation: 'analysis', metadata: { stage: 'normalization', category: cat.key } });

                            const text = resp.text;
                            if (!text) throw new Error(`${cat.prefix} retornou vazio`);
                            const parsed = robustJsonParseDetailed(text, `Norm-${cat.prefix}`);
                            if (parsed.repaired) hadRepair = true;
                            const data = parsed.data;

                            // Validate block schema
                            if (Array.isArray(data.items) && data.items.length > 0) {
                                mergedRequirements[cat.key] = data.items;
                                totalNormalized += data.items.length;
                            } else {
                                // Response valid but no items — keep originals
                                mergedRequirements[cat.key] = items;
                                totalNormalized += items.length;
                            }
                            if (Array.isArray(data.documents_to_prepare)) {
                                mergedDocs.push(...data.documents_to_prepare);
                            }
                            console.log(`[PNCP-V2] ✅ Norm ${cat.prefix}: ${(data.items || []).length} itens (${normModel})`);
                            return { cat: cat.key, success: true };
                        } catch (geminiErr: any) {
                            // Per-block fallback to OpenAI
                            console.warn(`[PNCP-V2] ⚠️ Norm ${cat.prefix} Gemini falhou: ${geminiErr.message}. Fallback OpenAI...`);
                            usedFallback = true;
                            try {
                                const oaiResult = await fallbackToOpenAiV2({
                                    systemPrompt,
                                    userPrompt,
                                    temperature: 0.1,
                                    stageName: `Norm-${cat.prefix}`
                                });
                                if (!oaiResult.text) throw new Error('OpenAI vazio');
                                const parsed = robustJsonParseDetailed(oaiResult.text, `Norm-${cat.prefix}-OAI`);
                                if (parsed.repaired) hadRepair = true;
                                const data = parsed.data;
                                if (Array.isArray(data.items) && data.items.length > 0) {
                                    mergedRequirements[cat.key] = data.items;
                                    totalNormalized += data.items.length;
                                } else {
                                    mergedRequirements[cat.key] = items;
                                    totalNormalized += items.length;
                                }
                                if (Array.isArray(data.documents_to_prepare)) {
                                    mergedDocs.push(...data.documents_to_prepare);
                                }
                                console.log(`[PNCP-V2] ✅ Norm ${cat.prefix} via OpenAI: ${(data.items || []).length} itens`);
                                return { cat: cat.key, success: true, fallback: true };
                            } catch (oaiErr: any) {
                                // Both failed — keep original extraction data
                                console.error(`[PNCP-V2] ❌ Norm ${cat.prefix} falhou (ambos): ${oaiErr.message}`);
                                mergedRequirements[cat.key] = items;
                                totalNormalized += items.length;
                                categoriesFailed++;
                                return { cat: cat.key, success: false };
                            }
                        }
                    })();
                }).filter(Boolean);

                // Execute all categories in parallel
                const results = await Promise.allSettled(categoryTasks as Promise<any>[]);

                stageTimes.normalization = (Date.now() - t2Start) / 1000;
                const successCount = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
                const fastPathCount = results.filter(r => r.status === 'fulfilled' && r.value?.fastPath).length;
                const aiNormCount = successCount - fastPathCount;
                console.log(`[PNCP-V2] ✅ Etapa 2 em ${stageTimes.normalization.toFixed(1)}s — ${totalNormalized} itens normalizados, ${successCount}/${NORM_CATEGORIES.length - categoriesSkipped} OK (⚡${fastPathCount} fast + 🤖${aiNormCount} AI), ${categoriesFailed} falhas`);

                // Build merged normalization result
                const json = {
                    requirements_normalized: mergedRequirements,
                    operational_outputs: {
                        documents_to_prepare: mergedDocs,
                    },
                    confidence: {
                        overall_confidence: categoriesFailed > 2 ? 'baixa' : categoriesFailed > 0 ? 'media' : 'alta',
                        section_confidence: {} as any,
                        warnings: categoriesFailed > 0 ? [`${categoriesFailed} categoria(s) não normalizada(s) — dados originais preservados`] : [],
                    }
                };

                return { json, model: PIPELINE_MODELS.normalization, repaired: hadRepair, fallback: usedFallback };
            })(),

            // ── Stage 3: Risk Review ──
            (async () => {
                const t3Start = Date.now();
                const riskUserInstruction = V2_RISK_REVIEW_USER_INSTRUCTION
                    .replace('{extractionJson}', extractionJsonCompact)
                    .replace('{normalizationJson}', '{}')  // Norm not yet available in parallel, use empty
                    + (domainReinforcement ? `\n\n${domainReinforcement}` : '');
                try {
                    const riskResponse = await callGeminiWithRetry(ai.models, {
                        model: PIPELINE_MODELS.riskReview,
                        contents: [{ role: 'user', parts: [{ text: riskUserInstruction }] }],
                        config: {
                            systemInstruction: V2_RISK_REVIEW_PROMPT,
                            temperature: 0.2,
                            maxOutputTokens: 16384,
                            responseMimeType: 'application/json'
                        }
                    }, 4, { tenantId: req.user.tenantId, operation: 'analysis', metadata: { stage: 'risk-review' } });
                    const riskText = riskResponse.text;
                    if (!riskText) throw new Error('Etapa 3 retornou vazio');
                    const parseR = robustJsonParseDetailed(riskText, 'PNCP-V2-RiskReview');
                    const json = parseR.data;
                    stageTimes.risk_review = (Date.now() - t3Start) / 1000;
                    console.log(`[PNCP-V2] ✅ Etapa 3 em ${stageTimes.risk_review.toFixed(1)}s — ${(json.legal_risk_review?.critical_points || []).length} pontos críticos`);
                    return { json, model: PIPELINE_MODELS.riskReview, repaired: parseR.repaired, fallback: false };
                } catch (err: any) {
                    console.warn(`[PNCP-V2] ⚠️ Etapa 3 Gemini falhou: ${err.message}. Tentando OpenAI...`);
                    const openAiResult = await fallbackToOpenAiV2({
                        systemPrompt: V2_RISK_REVIEW_PROMPT,
                        userPrompt: riskUserInstruction,
                        temperature: 0.2,
                        stageName: 'PNCP Etapa 3 (Risco)'
                    });
                    if (!openAiResult.text) throw new Error('OpenAI retornou vazio');
                    const parseROai = robustJsonParseDetailed(openAiResult.text, 'PNCP-V2-RiskReview-OpenAI');
                    const json = parseROai.data;
                    stageTimes.risk_review = (Date.now() - t3Start) / 1000;
                    console.log(`[PNCP-V2] ✅ Etapa 3 via OpenAI em ${stageTimes.risk_review.toFixed(1)}s`);
                    return { json, model: openAiResult.model, repaired: parseROai.repaired, fallback: true };
                }
            })(),

            // ── Stage 1.5: Parallel Item Extraction (runs concurrently with 2+3) ──
            // When itens_licitados is empty AND we have planilha-like PDFs in the catalog,
            // download and extract items NOW instead of waiting for ai-populate
            (async () => {
                const currentItens = v2Result.proposal_analysis?.itens_licitados || [];
                if (Array.isArray(currentItens) && currentItens.length > 0) {
                    console.log(`[PNCP-V2] ⚡ Etapa 1.5 SKIP — itens_licitados já tem ${currentItens.length} itens`);
                    return { items: currentItens, skipped: true };
                }

                // Find planilha/budget PDFs from catalog (including excluded-due-to-size ones)
                const planilhaAttachments = pncpAttachments.filter((a: any) =>
                    a.ativo && a.url && (
                        a.purpose === 'planilha_orcamentaria' ||
                        a.purpose === 'composicao_custos' ||
                        a.purpose === 'anexo_geral' ||
                        a.purpose === 'termo_referencia'
                    )
                );

                if (planilhaAttachments.length === 0) {
                    console.log(`[PNCP-V2] ⚡ Etapa 1.5 SKIP — sem planilhas no catálogo`);
                    return { items: [], skipped: true };
                }

                console.log(`[PNCP-V2] 📋 Etapa 1.5: Extraindo itens de ${planilhaAttachments.length} PDF(s) em paralelo...`);
                const t15Start = Date.now();

                try {
                    // Download the first planilha PDF (prioritize: planilha > composicao > anexo > TR)
                    const priorityOrder = ['planilha_orcamentaria', 'composicao_custos', 'anexo_geral', 'termo_referencia'];
                    const sorted = planilhaAttachments.sort((a: any, b: any) => 
                        priorityOrder.indexOf(a.purpose) - priorityOrder.indexOf(b.purpose)
                    );
                    const target = sorted[0];
                    
                    const agent15 = new (require('https').Agent)({ rejectUnauthorized: false });
                    const pdfResp = await axios.get(target.url, { 
                        responseType: 'arraybuffer', 
                        httpsAgent: agent15, 
                        timeout: 30000,
                        maxContentLength: 50 * 1024 * 1024 // 50MB max
                    } as any);
                    const pdfBuffer = Buffer.from(pdfResp.data as ArrayBuffer);
                    console.log(`[PNCP-V2] 📋 Etapa 1.5: PDF "${target.titulo}" (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);

                    const itemExtractionPrompt = `Você é um extrator de itens de planilhas orçamentárias de licitações brasileiras.

Analise o PDF e extraia TODOS os itens/lotes com preço.

Para CADA item extraia:
- itemNumber: número do item/lote
- description: descrição técnica COMPLETA (NÃO resuma)
- unit: unidade de medida (UN, KG, M², M³, ML, MÊS, HORA, DIA, DIÁRIA, KM, LITRO, CJ, VB, SV)
- quantity: quantidade numérica
- referencePrice: valor unitário de referência/estimado (número, sem R$)
- multiplier: se há período (ex: 12 meses), retorne o multiplicador
- multiplierLabel: rótulo do multiplicador (ex: "Meses")

REGRAS:
- Extraia APENAS itens PRINCIPAIS (totalizadores), NÃO sub-itens de composição
- referencePrice é NUMÉRICO (ex: 15000.00, não "R$ 15.000,00")
- Se não encontrar itens com preço, retorne array vazio []
- NUNCA invente itens

Responda APENAS com JSON array:
[{"itemNumber":"1","description":"...","unit":"UN","quantity":1,"referencePrice":0,"multiplier":1,"multiplierLabel":""}]`;

                    const itemResult = await callGeminiWithRetry(ai.models, {
                        model: 'gemini-2.5-flash',
                        contents: [{
                            role: 'user',
                            parts: [
                                { inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' } },
                                { text: itemExtractionPrompt }
                            ]
                        }],
                        config: { temperature: 0.05, maxOutputTokens: 16384 }
                    }, 4, { tenantId: req.user.tenantId, operation: 'analysis', metadata: { stage: 'item_extraction' } });

                    const responseText = itemResult.text?.trim() || '';
                    let jsonStr = responseText;
                    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
                    if (jsonMatch) jsonStr = jsonMatch[0];
                    
                    let items: any[] = [];
                    try { items = JSON.parse(jsonStr); } catch { items = []; }
                    
                    // Filter valid items
                    items = items.filter((it: any) => it.description && it.description.trim().length > 5);
                    
                    const elapsed = ((Date.now() - t15Start) / 1000).toFixed(1);
                    console.log(`[PNCP-V2] ✅ Etapa 1.5 em ${elapsed}s — ${items.length} itens extraídos de "${target.titulo}"`);
                    
                    return { items, skipped: false, source: target.titulo, elapsed };
                } catch (err: any) {
                    console.warn(`[PNCP-V2] ⚠️ Etapa 1.5 falhou: ${err.message}`);
                    return { items: [], skipped: false, error: err.message };
                }
            })()
        ]);

        console.log(`[PNCP-V2] Etapas 2+3 paralelas concluídas em ${((Date.now() - t2t3Start) / 1000).toFixed(1)}s`);

        // Process normalization result
        if (normSettled.status === 'fulfilled') {
            normalizationJson = normSettled.value.json;
            v2Result.analysis_meta.workflow_stage_status.normalization = 'done';
            modelsUsed.push(normSettled.value.model);
            if (normSettled.value.repaired) pipelineHealth.parseRepairs++;
            if (normSettled.value.fallback) pipelineHealth.fallbacksUsed++;
        } else {
            console.error(`[PNCP-V2] ❌ Etapa 2 falhou — continuando sem normalização`);
            v2Result.analysis_meta.workflow_stage_status.normalization = 'failed';
            v2Result.confidence.warnings.push(`Etapa 2 (Normalização) falhou: ${normSettled.reason?.message || 'erro desconhecido'}`);
            stageTimes.normalization = stageTimes.normalization || 0;
        }

        // Merge normalization
        if (normalizationJson.requirements_normalized) {
            v2Result.requirements = normalizationJson.requirements_normalized;
        }
        if (normalizationJson.operational_outputs) {
            v2Result.operational_outputs = { ...v2Result.operational_outputs, ...normalizationJson.operational_outputs };
        }
        if (normalizationJson.confidence) {
            v2Result.confidence = { ...v2Result.confidence, ...normalizationJson.confidence };
        }

        // Process risk review result
        if (riskSettled.status === 'fulfilled') {
            const riskJson = riskSettled.value.json;
            v2Result.analysis_meta.workflow_stage_status.risk_review = 'done';
            modelsUsed.push(riskSettled.value.model);
            if (riskSettled.value.repaired) pipelineHealth.parseRepairs++;
            if (riskSettled.value.fallback) pipelineHealth.fallbacksUsed++;
            if (riskJson.legal_risk_review) v2Result.legal_risk_review = riskJson.legal_risk_review;
            if (riskJson.operational_outputs_risk) {
                if (riskJson.operational_outputs_risk.questions_for_consultor_chat) {
                    v2Result.operational_outputs.questions_for_consultor_chat = riskJson.operational_outputs_risk.questions_for_consultor_chat;
                }
                if (riskJson.operational_outputs_risk.possible_petition_routes) {
                    v2Result.operational_outputs.possible_petition_routes = riskJson.operational_outputs_risk.possible_petition_routes;
                }
            }
            if (riskJson.confidence_update) {
                v2Result.confidence.section_confidence.risk_review = riskJson.confidence_update.risk_review || 'media';
            }
        } else {
            console.error(`[PNCP-V2] ❌ Etapa 3 falhou — continuando sem revisão de risco`);
            v2Result.analysis_meta.workflow_stage_status.risk_review = 'failed';
            v2Result.confidence.warnings.push(`Etapa 3 (Risco) falhou: ${riskSettled.reason?.message || 'erro desconhecido'}`);
            stageTimes.risk_review = stageTimes.risk_review || 0;
        }

        // Process item extraction result (Etapa 1.5)
        if (itemsSettled.status === 'fulfilled' && !itemsSettled.value.skipped) {
            const extractedItems = itemsSettled.value.items || [];
            if (extractedItems.length > 0) {
                if (!v2Result.proposal_analysis) v2Result.proposal_analysis = {} as any;
                v2Result.proposal_analysis.itens_licitados = extractedItems;
                stageTimes.item_extraction = parseFloat(itemsSettled.value.elapsed || '0');
                console.log(`[PNCP-V2] ✅ Etapa 1.5 merge: ${extractedItems.length} itens → proposal_analysis.itens_licitados`);
            }
        } else if (itemsSettled.status === 'rejected') {
            console.warn(`[PNCP-V2] ⚠️ Etapa 1.5 rejected: ${itemsSettled.reason?.message || 'erro'}`);
        }

        // ── Schema Sanitization: Safe defaults for all arrays/collections ──
        // Prevents "Cannot read properties of undefined (reading 'length')" crashes
        const reqCategories = ['habilitacao_juridica', 'regularidade_fiscal_trabalhista', 'qualificacao_economico_financeira',
            'qualificacao_tecnica_operacional', 'qualificacao_tecnica_profissional', 'proposta_comercial', 'documentos_complementares'];
        if (!v2Result.requirements) v2Result.requirements = {} as any;
        for (const cat of reqCategories) {
            if (!Array.isArray((v2Result.requirements as any)[cat])) {
                (v2Result.requirements as any)[cat] = [];
            }
        }
        if (!Array.isArray(v2Result.evidence_registry)) v2Result.evidence_registry = [];
        if (!v2Result.legal_risk_review) v2Result.legal_risk_review = { critical_points: [], ambiguities: [], inconsistencies: [], omissions: [], possible_restrictive_clauses: [], points_for_impugnation_or_clarification: [] } as any;
        if (!Array.isArray(v2Result.legal_risk_review.critical_points)) v2Result.legal_risk_review.critical_points = [];
        if (!v2Result.operational_outputs) v2Result.operational_outputs = { documents_to_prepare: [], internal_checklist: [], questions_for_consultor_chat: [], possible_petition_routes: [] } as any;
        if (!v2Result.confidence) v2Result.confidence = { overall_confidence: 'baixa', section_confidence: {} as any, warnings: [] } as any;
        if (!Array.isArray(v2Result.confidence.warnings)) v2Result.confidence.warnings = [];
        if (!v2Result.economic_financial_analysis) v2Result.economic_financial_analysis = { indices_exigidos: [] } as any;
        if (!Array.isArray(v2Result.economic_financial_analysis.indices_exigidos)) v2Result.economic_financial_analysis.indices_exigidos = [];
        if (!v2Result.technical_analysis) v2Result.technical_analysis = { parcelas_relevantes: [] } as any;
        if (!Array.isArray(v2Result.technical_analysis.parcelas_relevantes)) v2Result.technical_analysis.parcelas_relevantes = [];

        // Record discarded files in analysis metadata
        if (discardedFiles.length > 0) {
            (v2Result.analysis_meta as any).discarded_files = discardedFiles;
            v2Result.confidence.warnings.push(`${discardedFiles.length} anexo(s) ignorado(s) por limite de tamanho: ${discardedFiles.join(', ')}`);
        }

        // ── Schema Enforcement (Level 1, 2, 3) — ANTES da validação ──
        // Corrige campos vazios com defaults inteligentes, normaliza formatos,
        // e injeta categorias faltantes. Beneficia todos os 8 módulos downstream.
        const enforceResult = enforceSchema(v2Result);
        if (enforceResult.corrections > 0) {
            v2Result.confidence.warnings.push(
                `SchemaEnforcer: ${enforceResult.corrections} campo(s) padronizado(s) automaticamente`
            );
            (v2Result.analysis_meta as any).schema_enforcer = {
                corrections: enforceResult.corrections,
                details: enforceResult.details.slice(0, 20),
            };
        }

        // ── Validation (no AI) ──
        const validation = validateAnalysisCompleteness(v2Result);
        v2Result.analysis_meta.workflow_stage_status.validation = validation.valid ? 'done' : 'failed';
        if (validation.issues.length > 0) {
            v2Result.confidence.warnings.push(...validation.issues);
        }

        // ── Risk Rules Engine ──
        let ruleFindings: any[] = [];
        try {
            ruleFindings = executeRiskRules(v2Result);
            if (ruleFindings.length > 0) {
                (v2Result.analysis_meta as any).rule_findings = ruleFindings;
            }
        } catch (ruleErr: any) {
            console.warn(`[PNCP-V2] Motor de regras falhou: ${ruleErr.message}`);
        }

        // ── Quality Evaluator ──
        let qualityReport: any = null;
        try {
            qualityReport = evaluateAnalysisQuality(v2Result, ruleFindings, v2Result.analysis_meta.analysis_id);
            (v2Result.analysis_meta as any).quality_report = {
                overallScore: qualityReport.overallScore,
                categoryScores: qualityReport.categoryScores,
                issueCount: qualityReport.issues.length,
                summary: qualityReport.summary
            };
        } catch (qualErr: any) {
            console.warn(`[PNCP-V2] Avaliador de qualidade falhou: ${qualErr.message}`);
        }

        // ── Confidence Score V2.5 (calibrado para refletir precisão real) ──
        const stagesDone = Object.values(v2Result.analysis_meta.workflow_stage_status).filter(s => s === 'done').length;
        const stagesTotal = 4;
        const stageScore = (stagesDone / stagesTotal) * 100;
        const qualityScore = qualityReport?.overallScore || 50;
        // Rebalanceado: stages 30% + validation 25% + quality 25% + bônus excelência 20%
        let combinedScore = Math.round((stageScore * 0.30) + (validation.confidence_score * 0.25) + (qualityScore * 0.25));

        // Traceability assessment: count requirements with valid source_ref
        const evidenceCount = v2Result.evidence_registry?.length || 0;
        const allReqArrays = Object.values(v2Result.requirements || {}).flat() as any[];
        const principalReqs = allReqArrays.filter((r: any) => !r.entry_type || r.entry_type === 'exigencia_principal');
        const requirementCount = principalReqs.length;
        const tracedCount = principalReqs.filter((r: any) => r.source_ref && r.source_ref !== 'referência não localizada' && r.source_ref.trim() !== '').length;
        const traceabilityRatio = requirementCount > 0 ? tracedCount / requirementCount : 0;

        // Bônus de excelência: análises ricas recebem até 20% extra
        if (requirementCount >= 20 && traceabilityRatio >= 0.7) {
            combinedScore += 20; // Pipeline maduro com boa extração
        } else if (requirementCount >= 10 && traceabilityRatio >= 0.5) {
            combinedScore += 15;
        } else if (requirementCount >= 5) {
            combinedScore += 10;
        }

        // Traceability penalty (suavizada na V2.5)
        if (traceabilityRatio < 0.3 && requirementCount > 5) {
            combinedScore -= 5;
            v2Result.confidence.warnings.push(`Apenas ${Math.round(traceabilityRatio * 100)}% das exigências têm referência documental — rastreabilidade comprometida`);
        }

        // Parse repair penalty (suavizada: 3/reparo, max -10)
        if (pipelineHealth.parseRepairs > 0) {
            const repairPenalty = Math.min(pipelineHealth.parseRepairs * 3, 10);
            combinedScore -= repairPenalty;
            v2Result.confidence.warnings.push(`${pipelineHealth.parseRepairs} reparos de JSON foram necessários`);
        }

        // Fallback penalty (suavizada: 5/fallback, max -12)
        if (pipelineHealth.fallbacksUsed > 0) {
            const fallbackPenalty = Math.min(pipelineHealth.fallbacksUsed * 5, 12);
            combinedScore -= fallbackPenalty;
            v2Result.confidence.warnings.push(`${pipelineHealth.fallbacksUsed} fallback(s) para OpenAI acionado(s)`);
        }

        // Stage failure penalty
        const stagesFailed = Object.values(v2Result.analysis_meta.workflow_stage_status).filter(s => s === 'failed').length;
        if (stagesFailed > 0) {
            combinedScore -= stagesFailed * 10;
        }

        // Floor: análises com todas as stages concluídas nunca ficam abaixo de 80%
        const allStagesOk = stagesFailed === 0 && stagesDone === stagesTotal;
        const scoreFloor = allStagesOk ? 80 : 5;
        combinedScore = Math.max(scoreFloor, Math.min(100, combinedScore));

        // Confidence level V2.5 (flexibilizado — reflete precisão real)
        if (combinedScore >= 85 && traceabilityRatio >= 0.5) {
            v2Result.confidence.overall_confidence = 'alta';
        } else if (combinedScore >= 70) {
            v2Result.confidence.overall_confidence = 'alta';
        } else if (combinedScore >= 50) {
            v2Result.confidence.overall_confidence = 'media';
        } else {
            v2Result.confidence.overall_confidence = 'baixa';
        }
        (v2Result.confidence as any).score_percentage = combinedScore;
        (v2Result.confidence as any).pipeline_health = pipelineHealth;
        (v2Result.confidence as any).traceability = {
            total_requirements: requirementCount,
            traced_requirements: tracedCount,
            traceability_percentage: Math.round(traceabilityRatio * 100),
            evidence_registry_count: evidenceCount,
        };

        const uniqueModels = [...new Set(modelsUsed)];
        v2Result.analysis_meta.model_used = uniqueModels.join('+');
        (v2Result.analysis_meta as any).prompt_version = V2_PROMPT_VERSION;
        (v2Result.analysis_meta as any).models_per_stage = {
            extraction: modelsUsed[0] || 'failed',
            normalization: modelsUsed[1] || 'failed',
            risk_review: modelsUsed[2] || 'failed'
        };
        (v2Result.analysis_meta as any).stage_times = stageTimes;

        const totalDuration = ((Date.now() - analysisStartTime) / 1000).toFixed(1);
        const totalReqs = Object.values(v2Result.requirements).reduce((sum, arr) => sum + arr.length, 0);
        sendProgress(7, 'Validando completude da análise...', `${totalReqs} exigências, ${v2Result.evidence_registry.length} evidências`);
        console.log(`[PNCP-V2] ═══ PIPELINE CONCLUÍDO ═══ ${totalDuration}s total | ` +
            `Modelos: ${uniqueModels.join('+')} | ` +
            `${totalReqs} exigências | ${v2Result.legal_risk_review.critical_points.length} riscos | ` +
            `${v2Result.evidence_registry.length} evidências | Score: ${combinedScore}% (${v2Result.confidence.overall_confidence})`);

        // ── Legacy V1 Compatibility ──
        // Build process/analysis format expected by frontend
        const allReqs = Object.entries(v2Result.requirements).reduce((acc: Record<string, any[]>, [cat, items]) => {
            acc[cat] = items.map((r: any) => ({ item: r.requirement_id, description: `${r.title}: ${r.description}` }));
            return acc;
        }, {} as Record<string, any[]>);

        // ── PNCP Metadata Enrichment: Fetch valorTotalEstimado from PNCP API ──
        let pncpApiValue = 0;
        let pncpApiSessionDate = '';
        try {
            const detailUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${orgao_cnpj}/compras/${ano}/${numero_sequencial}`;
            const detailRes = await axios.get(detailUrl, { httpsAgent: agent, timeout: 5000 } as any);
            const d: any = detailRes.data;
            if (d) {
                pncpApiValue = Number(d.valorTotalEstimado ?? d.valorTotalHomologado ?? d.valorGlobal ?? 0) || 0;
                // dataAberturaProposta = início do recebimento de propostas (NÃO é a sessão!)
                // dataInicioDisputa ou dataAberturaEdital são mais próximos da sessão real
                pncpApiSessionDate = d.dataInicioDisputa || d.dataAberturaEdital || '';
                console.log(`[PNCP-V2] 💰 API metadata: valor=${pncpApiValue}, sessionDate=${pncpApiSessionDate || '(vazio)'}`);
            }
        } catch (e: any) {
            console.warn(`[PNCP-V2] Failed to fetch PNCP metadata for value: ${e.message}`);
        }

        // Resolve estimatedValue: AI extraction > PNCP API > 0
        const aiExtractedValue = Number(v2Result.process_identification?.valor_estimado_global) || 0;
        const resolvedEstimatedValue = aiExtractedValue > 0 ? aiExtractedValue : pncpApiValue;
        console.log(`[PNCP-V2] 💰 Valor resolução: AI=${aiExtractedValue}, API=${pncpApiValue}, final=${resolvedEstimatedValue}`);

        // Resolve sessionDate: AI timeline > PNCP API data_abertura
        const resolvedSessionDateRaw = v2Result.timeline.data_sessao || pncpApiSessionDate || '';

        // Convert Brazilian "DD/MM/AAAA às HH:MM" to ISO for frontend Date() compatibility
        const parseBrazilianDateToISO = (dateStr: string): string => {
            if (!dateStr) return '';
            // Already ISO? Return as-is
            if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr;
            // Parse "DD/MM/AAAA às HH:MM" or "DD/MM/AAAA HH:MM"
            const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(?:às\s+)?(\d{2}):(\d{2}))?/);
            if (match) {
                const [, day, month, year, hour = '00', minute = '00'] = match;
                return `${year}-${month}-${day}T${hour}:${minute}:00-03:00`;
            }
            return dateStr; // Can't parse, return as-is
        };
        const resolvedSessionDateISO = parseBrazilianDateToISO(resolvedSessionDateRaw);

        // ── SANITIZAÇÃO DO OBJETO (anti-poluição por Minuta) ──
        const sanitizeObjeto = (text: string): string => {
            if (!text) return '';
            let s = text
                .replace(/^TERMO DE CONTRATO QUE ENTRE SI FAZEM[\s\S]*?DECLARA:\s*/i, '')
                .replace(/^O presente contrato tem por objeto a execu..o dos servi.os de\s*\[espa.o em branco\]\s*conforme[\s\S]*?processo\.\s*/i, '')
                .replace(/\(Minuta,\s*Cl.usula[\s\S]*?\)\.\s*/gi, '')
                .replace(/\[espa.o em branco\]/gi, '')
                .replace(/\[nome[^\]]*\]/gi, '').replace(/\[CNPJ[^\]]*\]/gi, '')
                .replace(/\bXX\/\d{4}\b/g, '').trim();
            if (s.length < 20) return '';
            return s;
        };
        const rawObjResumo = v2Result.process_identification.objeto_resumido || '';
        const rawObjCompleto = v2Result.process_identification.objeto_completo || '';
        const cleanObjResumo = sanitizeObjeto(rawObjResumo);
        const cleanObjCompleto = sanitizeObjeto(rawObjCompleto);
        const bestObjResumo = cleanObjResumo || cleanObjCompleto.slice(0, 150) || rawObjResumo;
        const bestObjCompleto = cleanObjCompleto || cleanObjResumo || rawObjCompleto;
        let cleanNumProcesso = v2Result.process_identification.numero_processo || '';
        let cleanNumEdital = v2Result.process_identification.numero_edital || '';
        if (/XX\/\d{4}/.test(cleanNumProcesso)) cleanNumProcesso = '';
        if (/XX\/\d{4}/.test(cleanNumEdital)) cleanNumEdital = '';
        if (rawObjResumo !== bestObjResumo) {
            console.log(`[PNCP-V2] 🧹 Sanitização anti-Minuta: obj "${rawObjResumo.slice(0,50)}..." → "${bestObjResumo.slice(0,50)}..."`);
        }


        const legacyProcess = {
            title: cleanNumEdital
                ? `${v2Result.process_identification.modalidade} ${cleanNumEdital} - ${v2Result.process_identification.orgao}`
                : bestObjResumo || '',
            summary: `${bestObjResumo || bestObjCompleto || ''}\n\n` +
                `Modalidade: ${v2Result.process_identification.modalidade || ''}\n` +
                `Critério: ${v2Result.process_identification.criterio_julgamento || ''}\n` +
                `Regime: ${v2Result.process_identification.regime_execucao || ''}\n` +
                `Município: ${v2Result.process_identification.municipio_uf || ''}\n` +
                `Sessão: ${resolvedSessionDateRaw}\n` +
                (v2Result.participation_conditions.exige_visita_tecnica ? `Visita Técnica: ${v2Result.participation_conditions.visita_tecnica_detalhes}\n` : '') +
                (v2Result.participation_conditions.exige_garantia_proposta ? `Garantia de Proposta: ${v2Result.participation_conditions.garantia_proposta_detalhes}\n` : '') +
                (v2Result.participation_conditions.exige_garantia_contratual ? `Garantia Contratual: ${v2Result.participation_conditions.garantia_contratual_detalhes}\n` : '') +
                `\n--- RISCOS CRÍTICOS (${v2Result.legal_risk_review.critical_points.length}) ---\n` +
                v2Result.legal_risk_review.critical_points.map(cp =>
                    `[${(cp.severity || '').toUpperCase()}] ${cp.title}: ${cp.description} → ${cp.recommended_action}`
                ).join('\n'),
            modality: normalizeModality(v2Result.process_identification.modalidade),
            portal: normalizePortal(v2Result.process_identification.fonte_oficial || 'PNCP', link_sistema),
            estimatedValue: resolvedEstimatedValue,
            risk: v2Result.legal_risk_review.critical_points.some(cp => cp.severity === 'critica') ? 'Crítico'
                : v2Result.legal_risk_review.critical_points.some(cp => cp.severity === 'alta') ? 'Alto'
                : v2Result.legal_risk_review.critical_points.length > 0 ? 'Médio' : 'Baixo',
            sessionDate: resolvedSessionDateISO,
            link_sistema: (() => {
                // Sanitize: strip generic ComprasNet links that are NOT actual monitoring URLs
                // Only cnetmobile.estaleiro.serpro.gov.br/...?compra=XXX is a valid monitoring link
                const rawLink = (v2Result.process_identification.link_sistema || '').trim();
                if (!rawLink) return '';
                const lower = rawLink.toLowerCase();
                const isGenericComprasNet = (
                    lower.includes('comprasnet.gov.br') ||
                    lower.includes('www.gov.br/compras') ||
                    lower.includes('compras.gov.br') && !lower.includes('cnetmobile')
                );
                if (isGenericComprasNet) {
                    console.log(`[PNCP-V2] 🧹 Sanitização: link_sistema genérico removido: "${rawLink.substring(0, 60)}"`);
                    return '';
                }
                return rawLink;
            })()
        };

        // ── AUTO-ENRICH: Buscar link de monitoramento via API PNCP ──
        // Se link_sistema está vazio OU é genérico (sem parâmetros funcionais para chat monitor),
        // buscamos linkSistemaOrigem da API PNCP para TODAS as plataformas monitoráveis.
        // V4.6.0: Expandido para BLL, BNC, BBMNET, PCP, Licitanet, LMB (antes: só cnetmobile).
        const isAnalysisLinkFunctional = (() => {
            const l = (legacyProcess.link_sistema || '').toLowerCase();
            if (!l) return false;
            // BLL: functional links need param1= or ProcessView
            if ((l.includes('bllcompras') || l.includes('bll.org')) && !l.includes('param1=') && !l.includes('processview')) return false;
            // M2A: functional links need /certame/
            if (l.includes('m2atecnologia') && !l.includes('/certame/')) return false;
            // Generic domain-only links (e.g. "www.bll.org.br", "bllcompras.com") without path
            try {
                const url = new URL(l.startsWith('http') ? l : `https://${l}`);
                if (url.pathname === '/' || url.pathname === '' || url.pathname === '/Home/PublicAccess') return false;
            } catch { /* not a parseable URL, treat as non-functional */ return false; }
            return true;
        })();
        const needsAutoEnrich = (!legacyProcess.link_sistema || !isAnalysisLinkFunctional) && orgao_cnpj && ano && numero_sequencial;
        if (needsAutoEnrich) {
            try {
                const enrichUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${orgao_cnpj}/compras/${ano}/${numero_sequencial}`;
                console.log(`[PNCP-V2] 🔍 Buscando linkSistemaOrigem: ${enrichUrl} (link_sistema=${legacyProcess.link_sistema ? 'genérico' : 'vazio'})`);
                const controller = new AbortController();
                const enrichTimeout = setTimeout(() => controller.abort(), 8000);
                const enrichRes = await fetch(enrichUrl, { signal: controller.signal });
                clearTimeout(enrichTimeout);
                if (enrichRes.ok) {
                    const enrichData = await enrichRes.json();
                    const lso = (enrichData.linkSistemaOrigem || '').trim();
                    if (lso && hasMonitorableDomain(lso)) {
                        legacyProcess.link_sistema = lso;
                        const platform = detectPlatformFromLink(lso) || 'desconhecida';
                        console.log(`[PNCP-V2] ✅ linkSistemaOrigem enriquecido (${platform}): ${lso.substring(0, 80)}`);
                    } else {
                        console.log(`[PNCP-V2] ⚠️ linkSistemaOrigem=${lso ? lso.substring(0, 60) : 'VAZIO'} → tentando Fallback B (edital)`);

                        // ── FALLBACK B: Construir URL ComprasNet a partir dos dados do edital ──
                        // Quando linkSistemaOrigem é null (ex: CE-SOP), o edital pode conter
                        // "UASG: 943001" e "Número Comprasnet: (95033/2026)" que são diferentes
                        // da unidade/número do PNCP (081401/202606994).
                        // Fórmula: UASG(6) + coModalidade(2) + nuCompra(5) + ano(4) = 17 dígitos
                        try {
                            // Fontes: (1) campo IA, (2) regex nos campos IA, (3) regex no PDF direto
                            const aiNumComprasnet = ((v2Result.process_identification as any).numero_comprasnet || '').trim();
                            const aiUasg = ((v2Result.process_identification as any).uasg_comprasnet || '').trim();
                            
                            const allTextFields = [
                                v2Result.process_identification.numero_edital || '',
                                v2Result.process_identification.numero_processo || '',
                                v2Result.process_identification.objeto_completo || '',
                                v2Result.process_identification.fonte_oficial || '',
                                v2Result.process_identification.unidade_compradora || '',
                            ].join(' ');

                            const aiModalidade = (v2Result.process_identification.modalidade || '').toLowerCase();
                            const pncpUasg = enrichData.unidadeOrgao?.codigoUnidade || '';
                            
                            // ── Resolução de numero_comprasnet ──
                            // Prioridade: campo IA > regex campos IA > regex PDF direto
                            let nuCompraRaw = aiNumComprasnet;
                            let compraAno = ano;
                            let resolvedUasg = aiUasg;
                            let extractionSrc = aiNumComprasnet ? 'AI' : '';
                            
                            if (!nuCompraRaw) {
                                const comprasnetMatch = allTextFields.match(/[Nn][uú]mero\s+[Cc]omprasnet\s*:?\s*\(?(\d{4,6})\s*[/\\]?\s*(\d{4})?\)?/);
                                if (comprasnetMatch) {
                                    nuCompraRaw = comprasnetMatch[1];
                                    compraAno = comprasnetMatch[2] || ano;
                                    extractionSrc = 'REGEX-FIELD';
                                }
                            }
                            
                            if (!resolvedUasg) {
                                const uasgMatch = allTextFields.match(/UASG\s*:?\s*(\d{6})/i);
                                if (uasgMatch) resolvedUasg = uasgMatch[1];
                            }
                            
                            // ── Fallback C: Extração direta do PDF via pdf-parse ──
                            // Se a IA e o regex nos campos IA falharam, buscar no texto bruto do PDF
                            if ((!nuCompraRaw || !resolvedUasg) && pdfParts.length > 0) {
                                try {
                                    const pdfParse = require('pdf-parse');
                                    const firstPdf = pdfParts[0];
                                    let pdfBuffer: Buffer | null = null;
                                    if (firstPdf?.inlineData?.data) {
                                        pdfBuffer = Buffer.from(firstPdf.inlineData.data, 'base64');
                                    }
                                    if (pdfBuffer) {
                                        const pdfData = await pdfParse(pdfBuffer);
                                        // Buscar apenas nos primeiros 3000 chars (cabeçalho)
                                        const headerText = (pdfData.text || '').substring(0, 3000);
                                        
                                        if (!nuCompraRaw) {
                                            const pdfNumMatch = headerText.match(/[Nn][uú]mero\s+[Cc]omprasnet\s*:?\s*\(?(\d{4,6})\s*[/\\]?\s*(\d{4})?\)?/);
                                            if (pdfNumMatch) {
                                                nuCompraRaw = pdfNumMatch[1];
                                                compraAno = pdfNumMatch[2] || ano;
                                                extractionSrc = 'PDF-PARSE';
                                                console.log(`[PNCP-V2] 📄 Fallback C: numero_comprasnet=${nuCompraRaw} extraído do PDF direto`);
                                            }
                                        }
                                        if (!resolvedUasg) {
                                            const pdfUasgMatch = headerText.match(/UASG\s*:?\s*(\d{6})/i);
                                            if (pdfUasgMatch) {
                                                resolvedUasg = pdfUasgMatch[1];
                                                console.log(`[PNCP-V2] 📄 Fallback C: uasg=${resolvedUasg} extraído do PDF direto`);
                                            }
                                        }
                                    }
                                } catch (pdfErr: any) {
                                    console.warn(`[PNCP-V2] ⚠️ Fallback C (pdf-parse) falhou: ${pdfErr.message}`);
                                }
                            }
                            
                            // Fallback final para UASG: usar PNCP API
                            if (!resolvedUasg) resolvedUasg = pncpUasg;
                            
                            // Mapeamento de modalidade → código ComprasNet (SISG)
                            const MODALIDADE_TO_CODE: Record<string, string> = {
                                'pregão': '05', 'pregao': '05',
                                'concorrência': '03', 'concorrencia': '03',
                                'tomada de preço': '02', 'tomada de preco': '02',
                                'convite': '04', 'concurso': '01',
                                'leilão': '07', 'leilao': '07',
                                'dispensa': '08', 'inexigibilidade': '09',
                            };
                            
                            let coModalidade = '';
                            for (const [key, code] of Object.entries(MODALIDADE_TO_CODE)) {
                                if (aiModalidade.includes(key)) { coModalidade = code; break; }
                            }

                            if (nuCompraRaw && coModalidade && resolvedUasg && resolvedUasg.length === 6) {
                                const nuCompra = nuCompraRaw.padStart(5, '0');
                                const compraId = `${resolvedUasg}${coModalidade}${nuCompra}${compraAno}`;
                                const fallbackUrl = `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=${compraId}`;
                                
                                legacyProcess.link_sistema = fallbackUrl;
                                console.log(`[PNCP-V2] 🔧 Fallback B: URL construída do edital → ${fallbackUrl}`);
                                console.log(`[PNCP-V2]    UASG=${resolvedUasg} mod=${coModalidade} num=${nuCompra} ano=${compraAno} src=${extractionSrc}`);
                            } else {
                                console.log(`[PNCP-V2] ℹ️ Fallback B+C: dados insuficientes (nuCompra=${nuCompraRaw || 'N/A'}, coMod=${coModalidade || 'N/A'}, uasg=${resolvedUasg || 'N/A'})`);
                            }
                        } catch (fbErr: any) {
                            console.warn(`[PNCP-V2] ⚠️ Fallback B falhou: ${fbErr.message}`);
                        }
                    }
                }
            } catch (err: any) {
                console.warn(`[PNCP-V2] ⏱️ Enrich falhou: ${err.message}`);
            }
        }

        // ── Re-normalize portal after Auto-Enrich ──
        // If we enriched link_sistema to a platform URL (BLL, BNC, etc.), the portal
        // was still set to "PNCP" from L3216. Re-normalize with the enriched link.
        if (legacyProcess.link_sistema && hasMonitorableDomain(legacyProcess.link_sistema)) {
            const enrichedPortal = normalizePortal(legacyProcess.portal || 'PNCP', legacyProcess.link_sistema);
            if (enrichedPortal !== legacyProcess.portal) {
                console.log(`[PNCP-V2] 🔄 Portal re-normalizado: "${legacyProcess.portal}" → "${enrichedPortal}" (Auto-Enrich)`);
                legacyProcess.portal = enrichedPortal;
            }
        }

        const legacyAnalysis = {
            requiredDocuments: allReqs,
            pricingConsiderations: v2Result.economic_financial_analysis.indices_exigidos
                .map(i => `${i.indice}: ${i.formula_ou_descricao} (mín: ${i.valor_minimo})`).join('\n')
                + (v2Result.contractual_analysis.medicao_pagamento ? `\nPagamento: ${v2Result.contractual_analysis.medicao_pagamento}` : '')
                + (v2Result.contractual_analysis.reajuste ? `\nReajuste: ${v2Result.contractual_analysis.reajuste}` : ''),
            irregularitiesFlags: v2Result.legal_risk_review.critical_points.map(cp => `[${(cp.severity || '').toUpperCase()}] ${cp.title}: ${cp.description}`),
            fullSummary: `ANÁLISE V2 PIPELINE — ${bestObjResumo || ''}\n\n` +
                `Objeto: ${bestObjCompleto || ''}\n` +
                `Órgão: ${v2Result.process_identification.orgao || ''}\n` +
                `Sessão: ${v2Result.timeline.data_sessao || ''}\n\n` +
                `--- CONDIÇÕES ---\n` +
                `Consórcio: ${v2Result.participation_conditions.permite_consorcio ?? 'Não informado'}\n` +
                `Subcontratação: ${v2Result.participation_conditions.permite_subcontratacao ?? 'Não informado'}\n` +
                `Visita Técnica: ${v2Result.participation_conditions.exige_visita_tecnica ?? 'Não informado'}\n\n` +
                `--- PENALIDADES ---\n` +
                (v2Result.contractual_analysis.penalidades || []).join('\n') +
                `\n\n--- RISCOS (${v2Result.legal_risk_review.critical_points.length}) ---\n` +
                v2Result.legal_risk_review.critical_points.map(cp =>
                    `[${(cp.severity || '').toUpperCase()}] ${cp.title}: ${cp.description} → ${cp.recommended_action}`
                ).join('\n'),
            deadlines: [
                v2Result.timeline.data_sessao ? `${v2Result.timeline.data_sessao} - Sessão Pública` : '',
                v2Result.timeline.prazo_impugnacao ? `${v2Result.timeline.prazo_impugnacao} - Impugnação` : '',
                v2Result.timeline.prazo_esclarecimento ? `${v2Result.timeline.prazo_esclarecimento} - Esclarecimento` : '',
                v2Result.timeline.prazo_envio_proposta ? `${v2Result.timeline.prazo_envio_proposta} - Envio de Proposta` : '',
                v2Result.contractual_analysis.prazo_execucao ? `Prazo de Execução: ${v2Result.contractual_analysis.prazo_execucao}` : '',
                v2Result.contractual_analysis.prazo_vigencia ? `Vigência: ${v2Result.contractual_analysis.prazo_vigencia}` : '',
                ...(v2Result.timeline.outros_prazos || []).map(p => `${p.data || ''} - ${p.descricao || ''}`)
            ].filter(Boolean),
            penalties: (v2Result.contractual_analysis.penalidades || []).join('\n'),
            qualificationRequirements: Object.values(v2Result.requirements)
                .flat()
                .map(r => `[${r.requirement_id}] ${r.title}: ${r.description}`)
                .join('\n'),
            biddingItems: (() => {
                // Primary: structured items from itens_licitados (V2 pipeline extraction)
                const itens = v2Result.proposal_analysis?.itens_licitados || [];
                if (Array.isArray(itens) && itens.length > 0) {
                    return itens.map((it: any) => 
                        `Item ${it.itemNumber || '?'}: ${it.description || ''} | Unid: ${it.unit || 'UN'} | Qtd: ${it.quantity || 1}${it.multiplier && it.multiplier > 1 ? ` × ${it.multiplier} ${it.multiplierLabel || ''}` : ''} | Ref: R$ ${it.referencePrice || 0}`
                    ).join('\n');
                }
                // Fallback: observacoes_proposta (legacy, but usually short/useless)
                return (v2Result.proposal_analysis.observacoes_proposta || []).join('\n');
            })()
        };

        // Embed pncpSource inside schemaV2 so it's persisted in the DB
        (v2Result as any).pncp_source = {
            link_sistema,
            downloaded_files: downloadedFiles,
            discarded_files: discardedFiles,
            attachments: pncpAttachments,
            analyzed_at: new Date().toISOString()
        };

        // Build final response with both V1 compat and V2 schema
        const finalPayload = {
            process: legacyProcess,
            analysis: legacyAnalysis,
            schemaV2: v2Result,
            pncpSource: {
                link_sistema,
                downloadedFiles,
                discardedFiles,
                attachments: pncpAttachments,  // Full catalog with URLs for proposal module
                analyzedAt: new Date().toISOString()
            },
            _version: '2.0',
            _pipeline_duration_s: parseFloat(totalDuration),
            _prompt_version: V2_PROMPT_VERSION,
            _model_used: uniqueModels.join('+'),
            _overall_confidence: v2Result.confidence.overall_confidence,
            _stage_times: stageTimes,
            _quality_score: qualityReport?.overallScore || null,
            _evidence_count: v2Result.evidence_registry.length,
            _risk_count: v2Result.legal_risk_review.critical_points.length,
            _requirement_count: totalReqs
        };

        console.log(`[PNCP-V2] SUCCESS — Score: ${combinedScore}% | ${totalReqs} exigências | ${v2Result.evidence_registry.length} evidências`);
        sendProgress(8, 'Análise concluída!', `Score: ${combinedScore}% • ${totalReqs} exigências • ${v2Result.legal_risk_review.critical_points.length} riscos`);
        sendResult(finalPayload);

    } catch (error: any) {
        console.error('[PNCP-V2] Error:', error?.message || error);
        sendError(`Erro na análise IA do PNCP: ${error?.message || 'Erro desconhecido'}`);
    }
});

// ══════════════════════════════════════════
// ── Portal & Modality Normalization + Monitoring Helpers ──
// ══════════════════════════════════════════

// Canonical list of monitorable platform domains (used in create, update, and backfill)
// NOTE: Only include domains that have an active monitor/worker/cron.
// Removed 'compras.fortaleza.ce.gov.br' — no monitor exists, was causing false-positive isMonitored=true.
const MONITORABLE_DOMAINS = [
    'cnetmobile', 'licitamaisbrasil', 'bllcompras', 'bll.org',
    'bnccompras', 'portaldecompraspublicas', 'licitanet.com.br', 'bbmnet', 'm2atecnologia',
    'precodereferencia',
    // ⚠️ NÃO incluir 'comprasnet' aqui! O domínio www.comprasnet.gov.br é o portal antigo de LOGIN
    // (ex: https://www.comprasnet.gov.br/seguro/loginPortal.asp) — NÃO é monitorável.
    // O único domínio ComprasNet monitorável é 'cnetmobile' (cnetmobile.estaleiro.serpro.gov.br).
    // Incluir 'comprasnet' causa falso-positivo que impede o AutoEnrich de buscar o link correto.
];

// Map platform canonical names → domains they use (for credential matching)
const PLATFORM_DOMAINS: Record<string, string[]> = {
    'Compras.gov.br':            ['cnetmobile', 'comprasnet', 'compras.gov.br', 'gov.br/compras', 'pncp.gov.br'],
    'M2A':                       ['m2atecnologia', 'precodereferencia'],
    'BLL':                       ['bllcompras', 'bll.org'],
    'BBMNET':                    ['bbmnet'],
    'BNC':                       ['bnccompras'],
    'Licita Mais Brasil':        ['licitamaisbrasil'],
    'Portal de Compras Públicas': ['portaldecompraspublicas'],
    'Licitanet':                 ['licitanet.com.br'],
};

/**
 * Normaliza o campo "modalidade" para um valor canônico conforme Lei 14.133/2021.
 * 
 * MODALIDADES LICITATÓRIAS (Art. 28):
 *   - Pregão (eletrônico ou presencial — mesma modalidade)
 *   - Concorrência (eletrônica, internacional — mesma modalidade)
 *   - Diálogo Competitivo
 *   - Concurso
 *   - Leilão
 * 
 * CONTRATAÇÃO DIRETA (Art. 72-75):
 *   - Dispensa de Licitação
 *   - Inexigibilidade
 * 
 * PROCEDIMENTOS AUXILIARES (Art. 78):
 *   - Pré-Qualificação, Credenciamento, etc.
 */
function normalizeModality(raw: string | undefined | null): string {
    if (!raw || !raw.trim()) return '';
    // Strip accents, lowercase, remove Nº/numbers/SRP suffixes
    const s = raw.trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s*n[°ºo]?\s*[\d/.]+.*/i, '')
        .replace(/\s*-?\s*srp$/i, '')
        .replace(/\s*-?\s*sispp$/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    // ── 5 Modalidades Licitatórias (Lei 14.133, Art. 28) ──
    if (s.includes('pregao')) return 'Pregão';
    if (s.includes('concorrencia')) return 'Concorrência';
    if (s.includes('dialogo competitivo')) return 'Diálogo Competitivo';
    if (s.includes('concurso')) return 'Concurso';
    if (s.includes('leilao')) return 'Leilão';

    // ── Contratação Direta (Art. 72-75) ──
    if (s.includes('dispensa')) return 'Dispensa';
    if (s.includes('inexigibilidade')) return 'Inexigibilidade';

    // ── Procedimentos Auxiliares (Art. 78) ──
    if (s.includes('pre-qualificacao') || s.includes('pre qualificacao')) return 'Procedimento Auxiliar';
    if (s.includes('credenciamento')) return 'Procedimento Auxiliar';
    if (s.includes('manifestacao de interesse')) return 'Procedimento Auxiliar';

    // ── Termos genéricos → inferir ──
    if (s.includes('licitacao eletronica') || s.includes('licitacao')) return 'Pregão';
    if (s.includes('chamada publica')) return 'Chamada Pública';
    if (s.includes('tomada de precos')) return 'Concorrência';
    if (s.includes('convite')) return 'Concorrência';
    if (s === 'rdc' || s.includes('regime diferenciado')) return 'Concorrência';

    // Fallback: Title Case limpo
    return raw.trim()
        .replace(/\s*[Nn][°ºo]?\s*[\d/.]+.*/i, '')
        .replace(/\s*-?\s*SRP$/i, '')
        .split(' ')
        .map(w => {
            const lower = w.toLowerCase();
            if (['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'para', 'em'].includes(lower)) return lower;
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(' ').trim();
}

/**
 * Normaliza o campo "portal" para o nome canônico da PLATAFORMA.
 * PNCP é repositório, NÃO plataforma. ComprasNet/Compras.gov.br/PNCP → "Compras.gov.br"
 */
function normalizePortal(portal: string, link?: string | null): string {
    if (!portal && !link) return 'Não Informado';
    const p = (portal || '').toLowerCase().trim();
    const l = (link || '').toLowerCase();

    // ═══════════════════════════════════════════════════════════
    // Prioridade 0: Texto do portal contém URL/nome ESPECÍFICO de plataforma
    // (Deve ser avaliado ANTES do link genérico PNCP para não ser sobrescrito)
    // ═══════════════════════════════════════════════════════════
    if (p.includes('m2a') || p.includes('m2atecnologia')) return 'M2A';
    if (p.includes('bbmnet')) return 'BBMNET';
    if (p.includes('bll')) return 'BLL';
    if (p.includes('bnc') && !p.includes('banco')) return 'BNC';
    if (p.includes('licita mais') || p.includes('licitamaisbrasil')) return 'Licita Mais Brasil';
    if (p.includes('portal de compras') || p.includes('portaldecompras')) return 'Portal de Compras Públicas';
    if (p.includes('licitanet')) return 'Licitanet';
    if (p.includes('bolsa de licita')) return 'Bolsa de Licitações';

    // Prioridade 1: Inferir pelo link (mais confiável para portais de disputa)
    if (l) {
        if (l.includes('m2atecnologia') || l.includes('precodereferencia')) return 'M2A';
        if (l.includes('bbmnet') || l.includes('novabbmnet')) return 'BBMNET';
        if (l.includes('bllcompras') || l.includes('bll.org')) return 'BLL';
        if (l.includes('bnccompras')) return 'BNC';
        if (l.includes('licitamaisbrasil')) return 'Licita Mais Brasil';
        if (l.includes('portaldecompraspublicas')) return 'Portal de Compras Públicas';
        if (l.includes('licitanet.com.br')) return 'Licitanet';
        if (l.includes('bolsadelicitacoes') || l.includes('bfrr.com')) return 'Bolsa de Licitações';
        if (l.includes('cnetmobile') || l.includes('comprasnet') || l.includes('compras.gov.br') || l.includes('gov.br/compras') || l.includes('pncp.gov.br')) return 'Compras.gov.br';
    }

    // Prioridade 2: Texto do portal → Compras.gov.br (genérico, avaliado por último)
    if (p.includes('compras.gov') || p.includes('comprasnet') || p.includes('comprasgov') || p.includes('www.gov.br/compras') || p.includes('cnetmobile') || p.includes('pncp')) return 'Compras.gov.br';

    // Prioridade 3: URL crua → tentar extrair plataforma
    if (portal) {
        // Remove embedded URLs: "Nome (https://...)" or "Nome: https://..."
        const cleaned = portal
            .replace(/\s*\(?\s*https?:\/\/[^\s)]+\s*\)?\s*/gi, '')
            .replace(/\s*:\s*https?:\/\/[^\s]+/gi, '')
            .trim();
        if (cleaned && cleaned.length > 2) return cleaned;

        // Se é URL pura, extrair domínio
        const urlMatch = portal.match(/https?:\/\/(?:www\.)?([^/\s]+)/i);
        if (urlMatch) {
            const domain = urlMatch[1];
            // Portais municipais conhecidos
            if (domain.includes('comprasquixelo') || domain.includes('licitacesmilagres') || domain.includes('licitamoraisjoice'))
                return 'Portal Municipal';
            return domain;
        }
    }

    return portal || 'Não Informado';
}

/**
 * Detecta se um link contém domínio de plataforma monitorável.
 */
function hasMonitorableDomain(link: string): boolean {
    const l = link.toLowerCase();
    return MONITORABLE_DOMAINS.some(d => l.includes(d));
}

/**
 * Detecta a plataforma canônica a partir de um link.
 */
function detectPlatformFromLink(link: string): string | null {
    const l = link.toLowerCase();
    for (const [platform, domains] of Object.entries(PLATFORM_DOMAINS)) {
        if (domains.some(d => l.includes(d))) return platform;
    }
    return null;
}

// ── Sanitize BiddingProcess fields — only allow valid Prisma scalar fields ──
const BIDDING_ALLOWED_FIELDS = new Set([
    'title', 'summary', 'portal', 'modality', 'status', 'substage',
    'risk', 'estimatedValue', 'sessionDate', 'link', 'pncpLink',
    'uasg', 'modalityCode', 'processNumber', 'processYear',
    'isMonitored', 'observations', 'reminderDate', 'reminderStatus',
    'reminderType', 'reminderDays',
]);
function sanitizeBiddingData(raw: Record<string, any>): Record<string, any> {
    const clean: Record<string, any> = {};
    for (const key of Object.keys(raw)) {
        if (BIDDING_ALLOWED_FIELDS.has(key)) {
            clean[key] = raw[key];
        }
    }
    // Ensure sessionDate is a valid ISO string
    if (clean.sessionDate && typeof clean.sessionDate === 'string') {
        const parsed = new Date(clean.sessionDate);
        if (isNaN(parsed.getTime())) {
            console.warn(`[Sanitize] Invalid sessionDate "${clean.sessionDate}", using current date`);
            clean.sessionDate = new Date().toISOString();
        } else {
            clean.sessionDate = parsed.toISOString();
        }
    }
    // Ensure reminderDate is valid or null
    if (clean.reminderDate !== undefined) {
        if (clean.reminderDate === null || clean.reminderDate === '' || clean.reminderDate === 'null') {
            clean.reminderDate = null;
        } else if (typeof clean.reminderDate === 'string') {
            const parsed = new Date(clean.reminderDate);
            if (isNaN(parsed.getTime())) {
                console.warn(`[Sanitize] Invalid reminderDate "${clean.reminderDate}", setting null`);
                clean.reminderDate = null;
            } else {
                clean.reminderDate = parsed.toISOString();
            }
        }
    }
    return clean;
}

// Bidding Processes
app.get('/api/biddings', authenticateToken, async (req: any, res) => {
    try {
        const biddings = await prisma.biddingProcess.findMany({
            where: { tenantId: req.user.tenantId },
            include: { aiAnalysis: true }
        });
        res.json(biddings);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch biddings' });
    }
});

app.post('/api/biddings', authenticateToken, async (req: any, res) => {
    try {
        let { companyProfileId, ...rawData } = req.body;
        const tenantId = req.user.tenantId;
        let biddingData = sanitizeBiddingData(rawData);

        if (companyProfileId === '') {
            companyProfileId = null;
        }

        // ── Step 0: Normalize portal & modality ──
        biddingData.portal = normalizePortal(biddingData.portal || '', biddingData.link);
        if (biddingData.modality) biddingData.modality = normalizeModality(biddingData.modality);

        // ── Step 1: Auto-enrich — fetch platform link from PNCP API if missing ──
        let enrichedLink = biddingData.link || '';
        const hasPlatformLink = hasMonitorableDomain(enrichedLink);

        // Check if the platform link is "functional" (has the params needed for chat monitoring).
        // A link like "bllcompras.com/Home/PublicAccess" is monitorable-by-domain but NOT functional
        // because it lacks param1. Similarly, "compras.m2atecnologia.com.br/processos/publicacao/..."
        // is monitorable but lacks /certame/{id}. In these cases, we still need AutoEnrich.
        const isGenericPlatformLink = hasPlatformLink && (() => {
            const l = enrichedLink.toLowerCase();
            // BLL: functional links have "param1=" or "ProcessView"
            if (l.includes('bllcompras') && !l.includes('param1=') && !l.includes('processview')) return true;
            // M2A: functional links have "/certame/" (not the public "/publicacao/" vitrine)
            if (l.includes('m2atecnologia') && !l.includes('/certame/') && !l.includes('precodereferencia')) return true;
            return false;
        })();

        if ((!hasPlatformLink || isGenericPlatformLink) && enrichedLink.includes('pncp.gov.br') && enrichedLink.includes('editais')) {
            try {
                const pncpMatch = enrichedLink.match(/editais\/(\d+)\/(\d+)\/(\d+)/);
                if (pncpMatch) {
                    const [, cnpj, ano, seq] = pncpMatch;
                    const enrichUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
                    console.log(`[AutoEnrich] 🔍 Buscando linkSistemaOrigem: ${enrichUrl}`);
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 10000);
                    try {
                        const apiRes = await fetch(enrichUrl, { signal: controller.signal });
                        clearTimeout(timeout);
                        if (apiRes.ok) {
                            const apiData = await apiRes.json();
                            const platformUrl = (apiData.linkSistemaOrigem || '').trim();
                            console.log(`[AutoEnrich] 📋 linkSistemaOrigem=${platformUrl ? platformUrl.substring(0, 80) : 'VAZIO'}`);
                            if (platformUrl && hasMonitorableDomain(platformUrl)) {
                                // Case 1: linkSistemaOrigem IS monitorable (e.g., cnetmobile, bllcompras)
                                const existingParts = enrichedLink.split(',').map((s: string) => s.trim());
                                
                                if (isGenericPlatformLink) {
                                    // REPLACE: Remove the generic link and add the functional one
                                    // e.g., "bllcompras.com/Home/PublicAccess" → "bllcompras.com/Process/ProcessView?param1=..."
                                    const platformDomain = (() => {
                                        try { return new URL(platformUrl).hostname.replace('www.', ''); } catch { return ''; }
                                    })();
                                    const filteredParts = existingParts.filter((part: string) => {
                                        try {
                                            const partDomain = new URL(part).hostname.replace('www.', '');
                                            // Remove parts from the same platform domain (the generic link)
                                            return partDomain !== platformDomain;
                                        } catch { return true; } // keep non-URL parts
                                    });
                                    filteredParts.push(platformUrl);
                                    enrichedLink = filteredParts.join(', ');
                                    biddingData.link = enrichedLink;
                                    console.log(`[AutoEnrich] 🔄 Link genérico SUBSTITUÍDO pelo funcional: ${platformUrl.substring(0, 60)}`);
                                } else if (!existingParts.some((part: string) => part === platformUrl)) {
                                    // APPEND: No generic link — just add alongside existing
                                    enrichedLink = `${enrichedLink}, ${platformUrl}`;
                                    biddingData.link = enrichedLink;
                                    console.log(`[AutoEnrich] ✅ Link monitorável adicionado: ${platformUrl.substring(0, 60)}`);
                                }
                                // Re-normalize portal with the enriched link
                                biddingData.portal = normalizePortal(biddingData.portal, enrichedLink);
                            } else if (platformUrl) {
                                // Case 2: linkSistemaOrigem is NOT monitorable (e.g., portalcompras.ce.gov.br)
                                const existingParts = enrichedLink.split(',').map((s: string) => s.trim());
                                if (!existingParts.some((part: string) => part === platformUrl)) {
                                    enrichedLink = `${enrichedLink}, ${platformUrl}`;
                                    biddingData.link = enrichedLink;
                                }
                                console.log(`[AutoEnrich] ⚠️ linkSistemaOrigem is not monitorable: ${platformUrl.substring(0, 60)} — portal: ${biddingData.portal}`);
                            } else {
                                console.log(`[AutoEnrich] ⚠️ linkSistemaOrigem VAZIO para ${cnpj}/${ano}/${seq}`);
                            }
                        } else {
                            console.log(`[AutoEnrich] ⚠️ API retornou status ${apiRes.status} para ${cnpj}/${ano}/${seq}`);
                        }
                    } catch (fetchErr: any) {
                        clearTimeout(timeout);
                        console.warn(`[AutoEnrich] ⏱️ Fetch falhou (timeout ou rede): ${fetchErr.message}`);
                    }
                }
            } catch (e) {
                console.warn('[AutoEnrich] Failed to fetch platform link:', e);
            }
        } else if (!hasPlatformLink) {
            console.log(`[AutoEnrich] ⏭ Skipped: link="${enrichedLink?.substring(0, 60)}" hasPlatform=${hasPlatformLink} pncp=${enrichedLink.includes('pncp.gov.br')} editais=${enrichedLink.includes('editais')}`);
        }

        // ── Step 2: Auto-enable monitoring for all supported platforms ──
        // Also enable for Compras.gov.br processes (even without cnetmobile link — worker can use URL Discovery)
        const portalLower = (biddingData.portal || '').toLowerCase();
        const isComprasGovPortal = portalLower.includes('compras.gov') || portalLower.includes('comprasnet');
        if (hasMonitorableDomain(enrichedLink) || isComprasGovPortal) {
            biddingData.isMonitored = true;
            if (isComprasGovPortal && !hasMonitorableDomain(enrichedLink)) {
                console.log(`[AutoMonitor] Auto-enabled monitoring for Compras.gov.br process (needs cnetmobile link for worker). Portal: ${biddingData.portal}`);
            } else {
                console.log(`[AutoMonitor] Auto-enabled monitoring for new process (portal: ${biddingData.portal})`);
            }
        }

        // ── Step 3: Auto-backfill pncpLink from link ──
        if (!biddingData.pncpLink) {
            const allLinks = (biddingData.link || '').split(',').map((s: string) => s.trim());
            const pncpUrl = allLinks.find((s: string) => s.includes('pncp.gov.br/app/editais'));
            if (pncpUrl) biddingData.pncpLink = pncpUrl;
        }

        const bidding = await prisma.biddingProcess.create({
            data: { ...biddingData, tenantId, companyProfileId } as any
        });
        res.json(bidding);
    } catch (error) {
        console.error("Create bidding error:", error);
        res.status(500).json({ error: 'Failed to create bidding', details: error instanceof Error ? error.message : String(error) });
    }
});

// ── Universal backfill: fetch platform links from PNCP API for ALL platforms ──
app.post('/api/backfill-platform-links', authenticateToken, async (req: any, res) => {
    const testMode = req.query.test === '1';
    try {
        // Fetch all processes with PNCP link but missing platform link
        const allProcesses = await prisma.biddingProcess.findMany({
            where: { link: { contains: 'pncp.gov.br' } },
            select: { id: true, link: true, portal: true, isMonitored: true, pncpLink: true }
        });
        const processes = allProcesses.filter(p => {
            const link = (p.link || '').toLowerCase();
            // Keep processes that don't have ANY monitorable domain yet
            return !hasMonitorableDomain(link);
        });

        if (processes.length === 0) {
            return res.json({ message: 'All PNCP processes already have platform links', updated: 0, total: allProcesses.length });
        }

        // Test mode: debug one process and return
        if (testMode) {
            const proc = processes[0];
            const match = (proc.link || '').match(/editais\/(\d+)\/(\d+)\/(\d+)/);
            if (!match) return res.json({ debug: 'no match in link', link: proc.link });
            const [, cnpj, ano, seq] = match;
            const apiUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
            try {
                const apiRes = await fetch(apiUrl);
                const text = await apiRes.text();
                let parsed: any = null;
                try { parsed = JSON.parse(text); } catch {}
                return res.json({
                    processId: proc.id, link: proc.link, portal: proc.portal, apiUrl, httpStatus: apiRes.status,
                    linkSistemaOrigem: parsed?.linkSistemaOrigem || null,
                    detectedPlatform: parsed?.linkSistemaOrigem ? detectPlatformFromLink(parsed.linkSistemaOrigem) : null,
                    responseSnippet: text.substring(0, 500),
                });
            } catch (e) {
                return res.json({ processId: proc.id, apiUrl, error: String(e) });
            }
        }

        // Full mode: respond immediately, process in background
        res.json({ message: `Universal backfill started for ${processes.length} processes (${allProcesses.length} total PNCP). Check server logs.`, total: processes.length });

        (async () => {
            // Step 1: Clean up duplicate links in all PNCP processes
            for (const proc of allProcesses) {
                const parts = (proc.link || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                const unique = [...new Set(parts)];
                if (unique.length < parts.length) {
                    await prisma.biddingProcess.update({
                        where: { id: proc.id },
                        data: { link: unique.join(', ') }
                    });
                    console.log(`[Backfill] 🧹 ${proc.id.slice(0,8)}: cleaned ${parts.length - unique.length} duplicate links`);
                }
            }

            // Step 2: Normalize portals for ALL processes (not just ones missing links)
            let portalNormalized = 0;
            for (const proc of allProcesses) {
                const normalized = normalizePortal(proc.portal || '', proc.link);
                if (normalized !== proc.portal) {
                    await prisma.biddingProcess.update({
                        where: { id: proc.id },
                        data: { portal: normalized }
                    });
                    portalNormalized++;
                    console.log(`[Backfill] 🏷️ ${proc.id.slice(0,8)}: portal "${proc.portal}" → "${normalized}"`);
                }
            }

            // Step 3: Add platform links where missing (ALL platforms, not just ComprasNet)
            let updated = 0;
            let noLinkAvailable = 0;
            for (const proc of processes) {
                const match = (proc.link || '').match(/editais\/(\d+)\/(\d+)\/(\d+)/);
                if (!match) continue;
                const [, cnpj, ano, seq] = match;
                try {
                    const apiRes = await fetch(`https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`);
                    if (!apiRes.ok) { console.log(`[Backfill] ${proc.id.slice(0,8)}: API ${apiRes.status}`); continue; }
                    const data = await apiRes.json();
                    const lso = (data.linkSistemaOrigem || '').trim();

                    if (lso && hasMonitorableDomain(lso)) {
                        // Prevent duplicate links
                        const existingLinks = (proc.link || '').split(',').map((s: string) => s.trim());
                        if (!existingLinks.includes(lso)) {
                            const newLink = [...existingLinks, lso].join(', ');
                            const detectedPlatform = detectPlatformFromLink(lso);
                            const updateData: any = { link: newLink, isMonitored: true };
                            if (detectedPlatform) updateData.portal = detectedPlatform;
                            // Auto-backfill pncpLink if missing
                            if (!proc.pncpLink) {
                                const pncpUrl = existingLinks.find((s: string) => s.includes('pncp.gov.br/app/editais'));
                                if (pncpUrl) updateData.pncpLink = pncpUrl;
                            }
                            await prisma.biddingProcess.update({
                                where: { id: proc.id },
                                data: updateData
                            });
                            updated++;
                            console.log(`[Backfill] ✅ ${proc.id.slice(0,8)}: ${detectedPlatform || 'platform'} link added (${lso.substring(0,60)})`);
                        }
                    } else if (lso) {
                        console.log(`[Backfill] ⏭ ${proc.id.slice(0,8)}: non-monitorable link (${lso.substring(0,60)})`);
                    } else {
                        noLinkAvailable++;
                        console.log(`[Backfill] ⏭ ${proc.id.slice(0,8)}: linkSistemaOrigem empty`);
                    }
                    await new Promise(r => setTimeout(r, 300));
                } catch (e) {
                    console.log(`[Backfill] ❌ ${proc.id.slice(0,8)}: ${e}`);
                }
            }
            console.log(`[Backfill] ✅ Complete: ${updated} enriched, ${portalNormalized} portals normalized, ${noLinkAvailable} empty, ${processes.length} total`);
        })();
    } catch (error) {
        console.error('[Backfill] Error:', error);
        res.status(500).json({ error: 'Backfill failed', details: error instanceof Error ? error.message : String(error) });
    }
});

// Keep backward-compatible alias
app.post('/api/backfill-comprasnet-links', authenticateToken, async (req: any, res) => {
    // Redirect to universal backfill
    res.redirect(307, `/api/backfill-platform-links${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`);
});

// ── Normalize portals for ALL existing processes ──
app.post('/api/admin/normalize-portals', authenticateToken, async (req: any, res) => {
    try {
        const allProcesses = await prisma.biddingProcess.findMany({
            where: { tenantId: req.user.tenantId },
            select: { id: true, portal: true, link: true }
        });

        let updated = 0;
        const changes: Array<{ id: string; from: string; to: string }> = [];

        for (const proc of allProcesses) {
            const normalized = normalizePortal(proc.portal || '', proc.link);
            if (normalized !== proc.portal) {
                await prisma.biddingProcess.update({
                    where: { id: proc.id },
                    data: { portal: normalized }
                });
                changes.push({ id: proc.id.slice(0, 8), from: proc.portal || '(vazio)', to: normalized });
                updated++;
            }
        }

        console.log(`[NormalizePortals] ${updated}/${allProcesses.length} portals normalized for tenant ${req.user.tenantId}`);
        res.json({ message: `${updated} portals normalized`, total: allProcesses.length, updated, changes });
    } catch (error) {
        console.error('[NormalizePortals] Error:', error);
        res.status(500).json({ error: 'Failed to normalize portals' });
    }
});

// ── Normalize BOTH portals AND modalities for ALL existing processes ──
app.post('/api/admin/normalize-all', authenticateToken, async (req: any, res) => {
    try {
        const allProcesses = await prisma.biddingProcess.findMany({
            where: { tenantId: req.user.tenantId },
            select: { id: true, portal: true, modality: true, link: true }
        });

        let portalUpdated = 0, modalityUpdated = 0;
        const portalChanges: Array<{ id: string; from: string; to: string }> = [];
        const modalityChanges: Array<{ id: string; from: string; to: string }> = [];

        for (const proc of allProcesses) {
            const updateData: Record<string, string> = {};

            const normPortal = normalizePortal(proc.portal || '', proc.link);
            if (normPortal !== proc.portal) {
                updateData.portal = normPortal;
                portalChanges.push({ id: proc.id.slice(0, 8), from: proc.portal || '(vazio)', to: normPortal });
                portalUpdated++;
            }

            const normModality = normalizeModality(proc.modality);
            if (normModality && normModality !== proc.modality) {
                updateData.modality = normModality;
                modalityChanges.push({ id: proc.id.slice(0, 8), from: proc.modality || '(vazio)', to: normModality });
                modalityUpdated++;
            }

            if (Object.keys(updateData).length > 0) {
                await prisma.biddingProcess.update({
                    where: { id: proc.id },
                    data: updateData
                });
            }
        }

        console.log(`[NormalizeAll] tenant=${req.user.tenantId} | portals: ${portalUpdated}, modalities: ${modalityUpdated} / ${allProcesses.length} total`);
        res.json({
            message: `Normalização concluída: ${portalUpdated} portais + ${modalityUpdated} modalidades atualizadas`,
            total: allProcesses.length,
            portalUpdated, modalityUpdated,
            portalChanges, modalityChanges
        });
    } catch (error) {
        console.error('[NormalizeAll] Error:', error);
        res.status(500).json({ error: 'Failed to normalize data' });
    }
});

app.get('/api/admin/monitoring-audit', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const biddings = await prisma.biddingProcess.findMany({
            where: { tenantId, isMonitored: true },
            select: { 
                id: true, 
                portal: true, 
                link: true, 
                title: true,
                companyProfileId: true, 
                company: { select: { credentials: true } } 
            }
        });

        let totalMonitored = biddings.length;
        let readyCount = 0;
        let missingCredsCount = 0;
        let invalidLinkCount = 0;

        const issues: any[] = [];

        for (const b of biddings) {
            const portal = (b.portal || '').toLowerCase();
            const link = (b.link || '').toLowerCase();
            const credentials = b.company?.credentials || [];
            
            // Verificação de Link
            if (!hasMonitorableDomain(link)) {
                invalidLinkCount++;
                issues.push({ id: b.id, title: b.title, portal: b.portal, issue: 'Link inválido ou não suportado', link: b.link });
                // We still check credentials below even if link is bad
            }

            if (!b.companyProfileId || credentials.length === 0) {
                missingCredsCount++;
                issues.push({ id: b.id, title: b.title, portal: b.portal, issue: 'Sem credenciais para a empresa vinculada', companyId: b.companyProfileId });
                continue;
            }

            const isComprasNet = portal.includes('comprasnet') || link.includes('comprasnet');
            const isBLL = portal === 'bll' || link.includes('bll');
            const isBNC = portal.includes('bnc') || link.includes('bnc');
            const isM2A = portal.includes('m2a') || link.includes('m2a') || link.includes('precodereferencia');
            const isBBMNet = portal.includes('bbmnet') || link.includes('bbmnet');

            let hasMatch = false;
            for (const cred of credentials) {
                const cp = (cred.platform || '').toLowerCase();
                const cu = (cred.url || '').toLowerCase();
                if (isComprasNet && (cp.includes('comprasnet') || cu.includes('comprasnet'))) hasMatch = true;
                if (isBLL && (cp.includes('bll') || cu.includes('bll'))) hasMatch = true;
                if (isBNC && (cp.includes('bnc') || cu.includes('bnc'))) hasMatch = true;
                if (isM2A && (cp.includes('m2a') || cu.includes('m2a'))) hasMatch = true;
                if (isBBMNet && (cp.includes('bbmnet') || cu.includes('bbmnet'))) hasMatch = true;
            }

            if (!hasMatch) {
                missingCredsCount++;
                issues.push({ id: b.id, title: b.title, portal: b.portal, issue: 'Sem credenciais para este portal', companyId: b.companyProfileId });
            } else {
                readyCount++;
            }
        }

        res.json({
            ok: true,
            stats: {
                totalMonitored,
                readyCount,
                missingCredsCount,
                invalidLinkCount,
                issuesCount: new Set(issues.map(i => i.id)).size
            },
            issues
        });
    } catch (e) {
        console.error('[MonitoringAudit]', e);
        res.status(500).json({ error: 'Falha na auditoria.' });
    }
});

// ── AI Usage Dashboard (per-tenant token consumption) ──
app.get('/api/admin/ai-usage', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const periodDays = parseInt(req.query.period as string) || 30;

        const { getDailyBreakdown, getQuotaStatus } = await import('./lib/aiUsageTracker');

        const [summary, daily, quota] = await Promise.all([
            getUsageSummary(prisma, tenantId, periodDays),
            getDailyBreakdown(prisma, tenantId, periodDays),
            getQuotaStatus(prisma, tenantId),
        ]);

        res.json({ ok: true, ...summary, daily, quota });
    } catch (e: any) {
        console.error('[AiUsage]', e);
        res.status(500).json({ error: 'Falha ao buscar consumo de IA.' });
    }
});

// ── Oracle Evidence Persistence ──
app.put('/api/biddings/:id/oracle-evidence', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const { oracleEvidence } = req.body;
        const tenantId = req.user.tenantId;

        const bidding = await prisma.biddingProcess.findFirst({
            where: { id, tenantId },
            include: { aiAnalysis: true }
        });

        if (!bidding) {
            return res.status(404).json({ error: 'Processo não encontrado.' });
        }

        // Persist oracle evidence alongside existing schemaV2 metadata
        if (bidding.aiAnalysis) {
            const existingSchema = (bidding.aiAnalysis.schemaV2 as any) || {};
            await prisma.aiAnalysis.update({
                where: { id: bidding.aiAnalysis.id },
                data: {
                    schemaV2: {
                        ...existingSchema,
                        oracle_evidence: oracleEvidence
                    }
                }
            });
            console.log(`[Oracle] Evidências persistidas para bidding ${id} (${Object.keys(oracleEvidence || {}).length} exigências)`);
        }

        res.json({ success: true });
    } catch (error: any) {
        console.error('[Oracle Evidence]', error);
        res.status(500).json({ error: 'Falha ao persistir evidências.' });
    }
});

app.put('/api/biddings/:id', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;

        // Extract companyProfileId separately; sanitize the rest
        const { companyProfileId, ...rawData } = req.body;
        const biddingData = sanitizeBiddingData(rawData);

        // ── Step 0: Normalize portal & modality ──
        if (biddingData.portal !== undefined) {
            biddingData.portal = normalizePortal(biddingData.portal || '', biddingData.link);
        }
        if (biddingData.modality !== undefined && biddingData.modality) {
            biddingData.modality = normalizeModality(biddingData.modality);
        }

        // ── Step 1: Auto-enrich — fetch platform link from PNCP API if missing ──
        let enrichedLink = biddingData.link || '';
        const hasPlatformLink = hasMonitorableDomain(enrichedLink);

        // Same generic-link detection as POST (see POST /api/biddings for full docs)
        const isGenericPlatformLink = hasPlatformLink && (() => {
            const l = enrichedLink.toLowerCase();
            if (l.includes('bllcompras') && !l.includes('param1=') && !l.includes('processview')) return true;
            if (l.includes('m2atecnologia') && !l.includes('/certame/') && !l.includes('precodereferencia')) return true;
            return false;
        })();

        if ((!hasPlatformLink || isGenericPlatformLink) && enrichedLink.includes('pncp.gov.br') && enrichedLink.includes('editais')) {
            try {
                const pncpMatch = enrichedLink.match(/editais\/(\d+)\/(\d+)\/(\d+)/);
                if (pncpMatch) {
                    const [, cnpj, ano, seq] = pncpMatch;
                    const enrichUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
                    console.log(`[AutoEnrich] 🔍 Update: Buscando linkSistemaOrigem: ${enrichUrl}`);
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 10000);
                    try {
                        const apiRes = await fetch(enrichUrl, { signal: controller.signal });
                        clearTimeout(timeout);
                        if (apiRes.ok) {
                            const apiData = await apiRes.json();
                            const platformUrl = (apiData.linkSistemaOrigem || '').trim();
                            console.log(`[AutoEnrich] 📋 Update: linkSistemaOrigem=${platformUrl ? platformUrl.substring(0, 80) : 'VAZIO'}`);
                            if (platformUrl && hasMonitorableDomain(platformUrl)) {
                                const existingParts = enrichedLink.split(',').map((s: string) => s.trim());
                                
                                if (isGenericPlatformLink) {
                                    // REPLACE: Remove the generic link and add the functional one
                                    const platformDomain = (() => {
                                        try { return new URL(platformUrl).hostname.replace('www.', ''); } catch { return ''; }
                                    })();
                                    const filteredParts = existingParts.filter((part: string) => {
                                        try {
                                            const partDomain = new URL(part).hostname.replace('www.', '');
                                            return partDomain !== platformDomain;
                                        } catch { return true; }
                                    });
                                    filteredParts.push(platformUrl);
                                    enrichedLink = filteredParts.join(', ');
                                    biddingData.link = enrichedLink;
                                    console.log(`[AutoEnrich] 🔄 Update: Link genérico SUBSTITUÍDO pelo funcional: ${platformUrl.substring(0, 60)}`);
                                } else if (!existingParts.some((part: string) => part === platformUrl)) {
                                    enrichedLink = `${enrichedLink}, ${platformUrl}`;
                                    biddingData.link = enrichedLink;
                                    console.log(`[AutoEnrich] ✅ Update: link monitorável adicionado para "${id}": ${platformUrl.substring(0, 60)}`);
                                }
                                if (biddingData.portal !== undefined) {
                                    biddingData.portal = normalizePortal(biddingData.portal, enrichedLink);
                                }
                            } else if (platformUrl) {
                                const existingParts = enrichedLink.split(',').map((s: string) => s.trim());
                                if (!existingParts.some((part: string) => part === platformUrl)) {
                                    enrichedLink = `${enrichedLink}, ${platformUrl}`;
                                    biddingData.link = enrichedLink;
                                }
                                console.log(`[AutoEnrich] ⚠️ linkSistemaOrigem is not monitorable for "${id}": ${platformUrl.substring(0, 60)} — portal: ${biddingData.portal || 'N/A'}`);
                            }
                        }
                    } catch (fetchErr: any) {
                        clearTimeout(timeout);
                        console.warn(`[AutoEnrich] ⏱️ Update fetch falhou: ${fetchErr.message}`);
                    }
                }
            } catch (e) {
                console.warn('[AutoEnrich] Failed to fetch platform link:', e);
            }
        }

        // ── Step 2: Auto-enable monitoring for all supported platforms ──
        // Also enable for Compras.gov.br processes (even without cnetmobile link)
        const putPortalLower = (biddingData.portal || '').toLowerCase();
        const isPutComprasGovPortal = putPortalLower.includes('compras.gov') || putPortalLower.includes('comprasnet');
        if (biddingData.isMonitored === undefined) {
            const shouldAutoMonitor = hasMonitorableDomain(enrichedLink) || isPutComprasGovPortal;
            if (shouldAutoMonitor) {
                const current = await prisma.biddingProcess.findUnique({ where: { id }, select: { isMonitored: true } });
                if (current && !current.isMonitored) {
                    biddingData.isMonitored = true;
                    console.log(`[AutoMonitor] Auto-enabled monitoring for "${id}" (portal: ${biddingData.portal || 'N/A'})`);
                }
            }
        }

        // ── Step 3: Auto-backfill pncpLink from link ──
        if (!biddingData.pncpLink) {
            const allLinks = (biddingData.link || '').split(',').map((s: string) => s.trim());
            const pncpUrl = allLinks.find((s: string) => s.includes('pncp.gov.br/app/editais'));
            if (pncpUrl) biddingData.pncpLink = pncpUrl;
        }

        const bidding = await prisma.biddingProcess.update({
            where: {
                id,
                tenantId // Ensure user can only update their own tenant's data
            },
            data: {
                ...biddingData,
                companyProfileId: companyProfileId === '' ? null : companyProfileId
            }
        });
        res.json(bidding);
    } catch (error) {
        console.error("Update bidding error:", error);
        res.status(500).json({ error: 'Failed to update bidding', details: error instanceof Error ? error.message : String(error) });
    }
});

app.delete('/api/biddings/:id', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const bidding = await prisma.biddingProcess.findUnique({ where: { id } });

        if (bidding && bidding.tenantId === req.user.tenantId) {
            await prisma.biddingProcess.delete({ where: { id } });
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Bidding not found or unauthorized' });
        }
    } catch (error) {
        console.error("Delete bidding error:", error);
        res.status(500).json({ error: 'Failed to delete bidding' });
    }
});

// Ai Analysis
app.post('/api/analysis', authenticateToken, async (req: any, res) => {
    try {
        const payload = { ...req.body };

        // Verify if biddingProcess belongs to the tenant
        const bidding = await prisma.biddingProcess.findUnique({
            where: { id: payload.biddingProcessId }
        });

        if (!bidding || bidding.tenantId !== req.user.tenantId) {
            return res.status(403).json({ error: 'Unauthorized to add analysis to this process' });
        }

        if (typeof payload.requiredDocuments === 'object') {
            payload.requiredDocuments = JSON.stringify(payload.requiredDocuments);
        }
        if (typeof payload.deadlines === 'object') {
            payload.deadlines = JSON.stringify(payload.deadlines);
        }
        if (typeof payload.chatHistory === 'object') {
            payload.chatHistory = JSON.stringify(payload.chatHistory);
        }

        const stringifyIfObject = (field: string) => {
            if (payload[field] && typeof payload[field] === 'object') {
                payload[field] = JSON.stringify(payload[field]);
            }
        };

        ['biddingItems', 'pricingConsiderations', 'fullSummary', 'penalties', 'qualificationRequirements', 'irregularitiesFlags', 'sourceFileNames'].forEach(stringifyIfObject);

        // V2 fields — persist structured schema and metadata
        const v2Fields: any = {};
        if (payload.schemaV2 && typeof payload.schemaV2 === 'object') {
            v2Fields.schemaV2 = payload.schemaV2;
        }
        if (payload.promptVersion) v2Fields.promptVersion = payload.promptVersion;
        if (payload.modelUsed) v2Fields.modelUsed = payload.modelUsed;
        if (payload.pipelineDurationS !== undefined) v2Fields.pipelineDurationS = parseFloat(payload.pipelineDurationS);
        if (payload.overallConfidence) v2Fields.overallConfidence = payload.overallConfidence;

        // Remove V2 fields from payload to avoid Prisma unknown field error
        delete payload.schemaV2;
        delete payload.promptVersion;
        delete payload.modelUsed;
        delete payload.pipelineDurationS;
        delete payload.overallConfidence;

        const mergedPayload = { ...payload, ...v2Fields };

        console.log(`[Analysis] Upserting analysis for process ${mergedPayload.biddingProcessId}. Payload summary length: ${mergedPayload.fullSummary?.length || 0}. Files: ${mergedPayload.sourceFileNames}. V2: ${!!v2Fields.schemaV2}`);

        const analysis = await prisma.aiAnalysis.upsert({
            where: {
                biddingProcessId: mergedPayload.biddingProcessId
            },
            create: mergedPayload,
            update: mergedPayload
        });

        // Debug log to confirm what was actually saved
        console.log(`[Analysis] SUCCESS for ${payload.biddingProcessId}. Saved sourceFiles: ${analysis.sourceFileNames?.substring(0, 100)}`);

        // Fire & Forget Indexing -> Vector Database para RAG
        if (payload.biddingProcessId && payload.sourceFileNames) {
            try {
                const parsedFileNames = JSON.parse(payload.sourceFileNames);
                if (Array.isArray(parsedFileNames) && parsedFileNames.length > 0) {
                    console.log(`[Background RAG] Disparando indexação assíncrona para ${payload.biddingProcessId}...`);
                    fetchPdfPartsForProcess(payload.biddingProcessId, parsedFileNames, req.user.tenantId)
                        .then(pdfParts => {
                            if (pdfParts && pdfParts.length > 0) {
                                return indexDocumentChunks(payload.biddingProcessId, pdfParts);
                            }
                        })
                        .catch(err => console.error(`[Background RAG] Erro interno: ${err.message}`));
                }
            } catch (e) {
                console.warn(`[Background RAG] Não foi possível mapear sourceFileNames para o processo ${payload.biddingProcessId}`);
            }
        }

        res.json(analysis);
    } catch (error) {
        console.error("Create analysis error:", error);
        res.status(500).json({ error: 'Failed to save AI analysis' });
    }
});

// GET structured analysis for a process (frontend consumption)
app.get('/api/analysis/:processId', authenticateToken, async (req: any, res) => {
    try {
        const { processId } = req.params;
        const tenantId = req.user.tenantId;

        // Verify process ownership
        const process = await prisma.biddingProcess.findUnique({
            where: { id: processId, tenantId }
        });
        if (!process) {
            return res.status(404).json({ error: 'Processo não encontrado' });
        }

        const analysis = await prisma.aiAnalysis.findUnique({
            where: { biddingProcessId: processId }
        });

        if (!analysis) {
            return res.status(404).json({ error: 'Análise não encontrada para este processo' });
        }

        res.json({
            id: analysis.id,
            biddingProcessId: analysis.biddingProcessId,
            schemaV2: analysis.schemaV2 || null,
            promptVersion: analysis.promptVersion || null,
            modelUsed: analysis.modelUsed || null,
            pipelineDurationS: analysis.pipelineDurationS || null,
            overallConfidence: analysis.overallConfidence || null,
            analyzedAt: analysis.analyzedAt,
            hasV2: !!analysis.schemaV2,
            // Legacy fields for backward compatibility
            fullSummary: analysis.fullSummary,
            qualificationRequirements: analysis.qualificationRequirements,
            biddingItems: analysis.biddingItems,
        });
    } catch (error: any) {
        console.error("Get analysis error:", error);
        res.status(500).json({ error: 'Failed to fetch analysis' });
    }
});

// Basic Documents Fetch (Scoped)
app.get('/api/documents', authenticateToken, async (req: any, res) => {
    try {
        const documents = await prisma.document.findMany({
            where: { tenantId: req.user.tenantId },
            select: {
                id: true,
                tenantId: true,
                companyProfileId: true,
                docType: true,
                fileUrl: true,
                expirationDate: true,
                status: true,
                autoRenew: true,
                docGroup: true,
                issuerLink: true,
                fileName: true,
                alertDays: true,
                uploadDate: true
            },
            orderBy: { uploadDate: 'desc' }
        });
        res.json(documents);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});

// File Upload endpoint (Protected)
app.post('/api/upload', authenticateToken, upload.single('file'), async (req: any, res: any) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { url: fileUrl, fileName } = await storageService.uploadFile(req.file, req.user.tenantId);

        // Register in Document table (Crucial for security and context mapping)
        const document = await prisma.document.create({
            data: {
                tenantId: req.user.tenantId,
                docType: "Edital/Anexo",
                fileUrl: fileUrl,
                fileName: req.file.originalname,
                expirationDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
                status: "Válido"
            }
        });

        res.json({
            message: 'File uploaded successfully',
            fileUrl,
            fileName: req.file.originalname,
            storageName: fileName,
            originalName: req.file.originalname,
            documentId: document.id
        });
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: 'File upload failed' });
    }
});


// ═══════════════════════════════════════════════════════════════════════
// Price Proposal CRUD + AI Populate
// ═══════════════════════════════════════════════════════════════════════

// GET proposals for a bidding process
app.get('/api/proposals/:biddingId', authenticateToken, async (req: any, res) => {
    try {
        const proposals = await prisma.priceProposal.findMany({
            where: { biddingProcessId: req.params.biddingId, tenantId: req.user.tenantId },
            include: { items: { orderBy: { sortOrder: 'asc' } }, company: true },
            orderBy: { version: 'desc' },
        });
        res.json(proposals);
    } catch (error: any) {
        console.error('[Proposals] GET error:', error.message);
        res.status(500).json({ error: 'Failed to fetch proposals' });
    }
});

// GET single proposal with items
app.get('/api/proposals/detail/:id', authenticateToken, async (req: any, res) => {
    try {
        const proposal = await prisma.priceProposal.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
            include: { items: { orderBy: { sortOrder: 'asc' } }, company: true, biddingProcess: true },
        });
        if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
        res.json(proposal);
    } catch (error: any) {
        console.error('[Proposals] GET detail error:', error.message);
        res.status(500).json({ error: 'Failed to fetch proposal' });
    }
});

// POST create proposal
app.post('/api/proposals', authenticateToken, async (req: any, res) => {
    try {
        const { biddingProcessId, companyProfileId, bdiPercentage, taxPercentage, socialCharges, validityDays, notes } = req.body;

        // Fetch company for default images and letter
        const company = await prisma.companyProfile.findUnique({ where: { id: companyProfileId } });

        // Count existing versions
        const existingCount = await prisma.priceProposal.count({
            where: { biddingProcessId, tenantId: req.user.tenantId },
        });

        const proposal = await prisma.priceProposal.create({
            data: {
                tenantId: req.user.tenantId,
                biddingProcessId,
                companyProfileId,
                version: existingCount + 1,
                bdiPercentage: bdiPercentage || 0,
                taxPercentage: taxPercentage || 0,
                socialCharges: socialCharges || 0,
                validityDays: validityDays || 60,
                notes: notes || null,
                headerImage: company?.defaultProposalHeader || null,
                footerImage: company?.defaultProposalFooter || null,
                headerImageHeight: company?.defaultProposalHeaderHeight || 150,
                footerImageHeight: company?.defaultProposalFooterHeight || 100,
                letterContent: company?.defaultLetterContent || null
            },
            include: { items: true, company: true },
        });
        console.log(`[Proposals] Created proposal ${proposal.id} v${proposal.version} for bidding ${biddingProcessId}`);
        res.status(201).json(proposal);
    } catch (error: any) {
        console.error('[Proposals] POST error:', error.message);
        res.status(500).json({ error: 'Failed to create proposal' });
    }
});

// PUT update proposal
app.put('/api/proposals/:id', authenticateToken, async (req: any, res) => {
    try {
        const { bdiPercentage, taxPercentage, socialCharges, validityDays, notes, status, letterContent, companyLogo, headerImage, footerImage, headerImageHeight, footerImageHeight, signatureMode, signatureCity,
            adjustedBdi, adjustedDiscount, adjustedTotalValue, adjustedLetterContent } = req.body;

        const existing = await prisma.priceProposal.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!existing) return res.status(404).json({ error: 'Proposal not found' });

        const updated = await prisma.priceProposal.update({
            where: { id: req.params.id },
            data: {
                bdiPercentage: bdiPercentage ?? existing.bdiPercentage,
                taxPercentage: taxPercentage ?? existing.taxPercentage,
                socialCharges: socialCharges ?? existing.socialCharges,
                validityDays: validityDays ?? existing.validityDays,
                notes: notes !== undefined ? notes : existing.notes,
                status: status ?? existing.status,
                letterContent: letterContent !== undefined ? letterContent : existing.letterContent,
                companyLogo: companyLogo !== undefined ? companyLogo : existing.companyLogo,
                headerImage: headerImage !== undefined ? headerImage : existing.headerImage,
                footerImage: footerImage !== undefined ? footerImage : existing.footerImage,
                headerImageHeight: headerImageHeight ?? existing.headerImageHeight,
                footerImageHeight: footerImageHeight ?? existing.footerImageHeight,
                signatureMode: signatureMode ?? existing.signatureMode,
                signatureCity: signatureCity !== undefined ? signatureCity : existing.signatureCity,
                // Cenário Proposta Ajustada
                adjustedBdi: adjustedBdi !== undefined ? adjustedBdi : existing.adjustedBdi,
                adjustedDiscount: adjustedDiscount !== undefined ? adjustedDiscount : existing.adjustedDiscount,
                adjustedTotalValue: adjustedTotalValue !== undefined ? adjustedTotalValue : existing.adjustedTotalValue,
                adjustedLetterContent: adjustedLetterContent !== undefined ? adjustedLetterContent : existing.adjustedLetterContent,
            },
            include: { items: { orderBy: { sortOrder: 'asc' } }, company: true },
        });

        // Recalculate total
        const totalValue = updated.items.reduce((sum: number, item: any) => sum + (item.totalPrice || 0), 0);
        await prisma.priceProposal.update({ where: { id: req.params.id }, data: { totalValue } });
        updated.totalValue = totalValue;

        res.json(updated);
    } catch (error: any) {
        console.error('[Proposals] PUT error:', error.message);
        res.status(500).json({ error: 'Failed to update proposal' });
    }
});

// DELETE proposal
app.delete('/api/proposals/:id', authenticateToken, async (req: any, res) => {
    try {
        const existing = await prisma.priceProposal.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!existing) return res.status(404).json({ error: 'Proposal not found' });

        await prisma.priceProposal.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (error: any) {
        console.error('[Proposals] DELETE error:', error.message);
        res.status(500).json({ error: 'Failed to delete proposal' });
    }
});

// POST add/replace items in bulk (used by AI populate and manual add)
app.post('/api/proposals/:id/items', authenticateToken, async (req: any, res) => {
    try {
        const { items, replaceAll, roundingMode: reqRoundingMode } = req.body;
        const proposalId = req.params.id;

        const existing = await prisma.priceProposal.findFirst({
            where: { id: proposalId, tenantId: req.user.tenantId },
        });
        if (!existing) return res.status(404).json({ error: 'Proposal not found' });

        // F6: Respect rounding mode — from request, or from stored flag (socialCharges=1 means TRUNCATE)
        const useRounding = reqRoundingMode || (existing.socialCharges === 1 ? 'TRUNCATE' : 'ROUND');
        const roundFn = useRounding === 'TRUNCATE'
            ? (v: number) => Math.floor(v * 100) / 100
            : (v: number) => Math.round(v * 100) / 100;

        // Optionally clear existing items
        if (replaceAll) {
            await prisma.proposalItem.deleteMany({ where: { proposalId } });
        }

        // Create items
        const created = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const bdi = existing.bdiPercentage || 0;
            const linearDisc = existing.taxPercentage || 0;
            const itemDisc = item.discountPercentage ?? 0;
            // Descontos cumulativos: linear + individual (compostos)
            const linearFactor = 1 - linearDisc / 100;
            const itemFactor = 1 - itemDisc / 100;

            const rawUnitPrice = (item.unitCost || 0) * (1 + bdi / 100) * linearFactor * itemFactor;
            const unitPrice = roundFn(rawUnitPrice);

            const multiplier = item.multiplier ?? 1;
            const rawTotalPrice = (item.quantity || 0) * multiplier * unitPrice;
            const totalPrice = roundFn(rawTotalPrice);

            const dbItem = await prisma.proposalItem.create({
                data: {
                    proposalId,
                    itemNumber: item.itemNumber || String(i + 1),
                    description: item.description,
                    unit: item.unit || 'UN',
                    quantity: item.quantity || 0,
                    multiplier: multiplier,
                    multiplierLabel: item.multiplierLabel || null,
                    unitCost: item.unitCost || 0,
                    unitPrice,
                    totalPrice,
                    referencePrice: item.referencePrice || null,
                    discountPercentage: itemDisc,
                    brand: item.brand || null,
                    model: item.model || null,
                    sortOrder: item.sortOrder ?? i,
                    // Cenário Ajustada
                    adjustedUnitCost: item.adjustedUnitCost ?? null,
                    adjustedUnitPrice: item.adjustedUnitPrice ?? null,
                    adjustedTotalPrice: item.adjustedTotalPrice ?? null,
                    adjustedItemDiscount: item.adjustedItemDiscount ?? 0,
                    // Composição de Preços
                    costComposition: item.costComposition || null,
                },
            });
            created.push(dbItem);
        }

        // Recalculate totals
        const allItems = await prisma.proposalItem.findMany({ where: { proposalId } });
        const totalValue = allItems.reduce((sum: number, it: any) => sum + (it.totalPrice || 0), 0);
        const adjustedTotalValue = allItems.reduce((sum: number, it: any) => sum + (it.adjustedTotalPrice || 0), 0);
        await prisma.priceProposal.update({ where: { id: proposalId }, data: { totalValue, ...(adjustedTotalValue > 0 ? { adjustedTotalValue } : {}) } });

        console.log(`[Proposals] Added ${created.length} items to proposal ${proposalId}, rounding: ${useRounding}, total: R$ ${totalValue.toFixed(2)}${adjustedTotalValue > 0 ? `, adjusted: R$ ${adjustedTotalValue.toFixed(2)}` : ''}`);
        res.json({ items: created, totalValue });
    } catch (error: any) {
        console.error('[Proposals] POST items error:', error.message);
        res.status(500).json({ error: 'Failed to add items' });
    }
});

// PUT update single item
app.put('/api/proposals/:id/items/:itemId', authenticateToken, async (req: any, res) => {
    try {
        const { itemNumber, description, unit, quantity, multiplier, multiplierLabel, unitCost, referencePrice, brand, model, discountPercentage } = req.body;
        const proposalId = req.params.id;
        const itemId = req.params.itemId;

        const proposal = await prisma.priceProposal.findFirst({
            where: { id: proposalId, tenantId: req.user.tenantId },
        });
        if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

        const bdi = proposal.bdiPercentage || 0;
        const linearDisc = proposal.taxPercentage || 0;
        const itemDisc = discountPercentage ?? 0;
        // Descontos cumulativos: linear + individual (compostos)
        const linearFactor = 1 - linearDisc / 100;
        const itemFactor = 1 - itemDisc / 100;

        const finalUnitCost = unitCost !== undefined ? unitCost : 0;
        const finalQuantity = quantity !== undefined ? quantity : 0;
        const finalMultiplier = multiplier !== undefined ? multiplier : 1;

        const unitPrice = finalUnitCost * (1 + bdi / 100) * linearFactor * itemFactor;
        const totalPrice = finalQuantity * finalMultiplier * unitPrice;

        const updated = await prisma.proposalItem.update({
            where: { id: itemId },
            data: {
                itemNumber: itemNumber,
                description: description,
                unit: unit,
                quantity: finalQuantity,
                multiplier: finalMultiplier,
                multiplierLabel: multiplierLabel !== undefined ? multiplierLabel : null,
                unitCost: finalUnitCost,
                unitPrice: Math.round(unitPrice * 100) / 100,
                totalPrice: Math.round(totalPrice * 100) / 100,
                referencePrice: referencePrice ?? null,
                discountPercentage: itemDisc,
                brand: brand ?? null,
                model: model ?? null,
            },
        });

        // Recalculate total
        const allItems = await prisma.proposalItem.findMany({ where: { proposalId } });
        const totalValue = allItems.reduce((sum: number, it: any) => sum + (it.totalPrice || 0), 0);
        await prisma.priceProposal.update({ where: { id: proposalId }, data: { totalValue } });

        res.json({ item: updated, totalValue });
    } catch (error: any) {
        console.error('[Proposals] PUT item error:', error.message);
        res.status(500).json({ error: 'Failed to update item' });
    }
});

// DELETE single item
app.delete('/api/proposals/:id/items/:itemId', authenticateToken, async (req: any, res) => {
    try {
        const proposalId = req.params.id;

        const proposal = await prisma.priceProposal.findFirst({
            where: { id: proposalId, tenantId: req.user.tenantId },
        });
        if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

        await prisma.proposalItem.delete({ where: { id: req.params.itemId } });

        // Recalculate total
        const allItems = await prisma.proposalItem.findMany({ where: { proposalId } });
        const totalValue = allItems.reduce((sum: number, it: any) => sum + (it.totalPrice || 0), 0);
        await prisma.priceProposal.update({ where: { id: proposalId }, data: { totalValue } });

        res.json({ success: true, totalValue });
    } catch (error: any) {
        console.error('[Proposals] DELETE item error:', error.message);
        res.status(500).json({ error: 'Failed to delete item' });
    }
});

// POST AI Populate — extract items from AI analysis
app.post('/api/proposals/ai-populate', authenticateToken, async (req: any, res) => {
    try {
        const { biddingProcessId } = req.body;

        // Get bidding with AI analysis
        const bidding = await prisma.biddingProcess.findFirst({
            where: { id: biddingProcessId, tenantId: req.user.tenantId },
            include: { aiAnalysis: true },
        });

        if (!bidding) return res.status(404).json({ error: 'Bidding process not found' });
        if (!bidding.aiAnalysis) return res.status(400).json({ error: 'No AI analysis found for this bidding. Run the AI analysis first.' });

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
        const ai = new GoogleGenAI({ apiKey });

        // ── Helper: natural sort items by itemNumber (1, 2, 1.1, 1.2, 2.1, etc.) ──
        const naturalSortItems = (items: any[]) => {
            return items.sort((a, b) => {
                const partsA = String(a.itemNumber || '').split('.').map(Number);
                const partsB = String(b.itemNumber || '').split('.').map(Number);
                const maxLen = Math.max(partsA.length, partsB.length);
                for (let i = 0; i < maxLen; i++) {
                    const va = partsA[i] ?? 0;
                    const vb = partsB[i] ?? 0;
                    if (va !== vb) return va - vb;
                }
                return 0;
            });
        };

        const biddingItems = bidding.aiAnalysis.biddingItems || '';
        const pricingInfo = bidding.aiAnalysis.pricingConsiderations || '';
        const schemaV2 = bidding.aiAnalysis.schemaV2 as any;

        // ── Strategy 0: Structured items from V2 analysis (FASTEST — no AI call needed) ──
        const itensLicitados = schemaV2?.proposal_analysis?.itens_licitados;
        if (Array.isArray(itensLicitados) && itensLicitados.length > 0) {
            console.log(`[AI Populate] ✅ Strategy 0: Using ${itensLicitados.length} pre-extracted items from schemaV2`);
            // Normalize items format
            const items = itensLicitados.map((it: any, idx: number) => ({
                itemNumber: it.itemNumber || String(idx + 1),
                description: it.description || '',
                unit: it.unit || 'UN',
                quantity: it.quantity || 1,
                multiplier: it.multiplier || 1,
                multiplierLabel: it.multiplierLabel || '',
                referencePrice: it.referencePrice || 0,
            }));
            return res.json({ items, totalItems: items.length, source: 'schemaV2_itens_licitados' });
        }

        // ── Strategy 1: Legacy biddingItems (text-based, from older analyses) ──
        // Minimum 200 chars — real bid items have descriptions, quantities, units
        // Below 200 chars is likely observacoes_proposta garbage, skip to Strategy 2/3
        const hasRealBiddingItems = biddingItems && biddingItems.trim().length >= 200;
        if (hasRealBiddingItems) {
            console.log(`[AI Populate] Using legacy biddingItems (${biddingItems.length} chars)`);

            const prompt = `Você é um especialista em licitações brasileiras. Analise os ITENS LICITADOS abaixo e extraia uma lista estruturada para uma proposta de preços.

ITENS DO EDITAL:
${biddingItems}

INFORMAÇÕES DE PREÇO:
${pricingInfo}

REGRAS:
1. Extraia CADA item/lote individualmente
2. Identifique: número do item, descrição completa, unidade de medida (UN, KG, M², HORA, MÊS, KM, LITRO, DIÁRIA, etc.), quantidade
3. Se houver valor de referência/estimado, inclua
4. Mantenha descrições técnicas completas, não simplifique
5. Se a unidade não estiver clara, use "UN"
6. Se a quantidade não estiver clara, use 1
7. MUITO IMPORTANTE: Procure ativamente por períodos ou múltiplos que devam ser multiplicados. Por exemplo, se a licitação é para o ano todo e os pagamentos são mensais (12 meses), a quantidade é X e o MULTIPLICADOR é 12. Retorne 'multiplier': 12 e 'multiplierLabel': 'Meses'. Caso contrário, retorne 1.

ORGANIZAÇÃO DE LOTES E ITENS (itemNumber):
8. O campo itemNumber DEVE seguir padrão hierárquico organizado:
   - SEM lotes: "1", "2", "3" (numeração sequencial)
   - COM lotes, múltiplos itens: "1.1", "1.2", "2.1", "2.2" (Lote.Item)
   - COM subgrupos: "1.1.1", "1.1.2" (Grupo.Subgrupo.Item)
9. Se o edital usa "Lote 1 - Item 1", converta para "1.1"
10. Retorne os itens SEMPRE na ordem natural crescente: 1, 2, 3... ou 1.1, 1.2, 2.1...
11. NUNCA misture formatos no mesmo array

⚠️ ANTI-TRUNCAMENTO:
12. Você DEVE retornar ABSOLUTAMENTE TODOS os itens — se houver 200 itens, retorne 200. NUNCA pare antes de completar a lista inteira.
13. NÃO duplique a descrição (ex: "EXAME DE X EXAME DE X" → use apenas "EXAME DE X")
14. Para descrições curtas (ex: nome de exame), NÃO adicione texto extra — use a descrição literal do edital.

Responda APENAS com um JSON array válido:
[{"itemNumber":"1","description":"Descrição completa","unit":"Mês","quantity":3,"multiplier":12,"multiplierLabel":"Meses","referencePrice":22465.00}]`;

            const result = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { temperature: 0.05, maxOutputTokens: 65536, responseMimeType: 'application/json' },
            }, 3, { tenantId: req.user.tenantId, operation: 'proposal_populate', metadata: { source: 'analysis' } });

            const responseText = result.text?.trim() || '';
            let jsonStr = responseText;
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) jsonStr = jsonMatch[0];

            let items: any[];
            try { items = JSON.parse(jsonStr); }
            catch { return res.status(500).json({ error: 'AI returned invalid format', raw: responseText.substring(0, 200) }); }

            // ── Truncation guard: if legacy biddingItems returned suspiciously few items, 
            // fall through to Strategy 2/3 for fuller extraction from PNCP planilhas ──
            const estimatedValue = bidding.estimatedValue || 0;
            const isSuspiciouslyFew = items.length <= 10 && estimatedValue > 100000;
            if (isSuspiciouslyFew) {
                console.warn(`[AI Populate] ⚠️ Strategy 1 returned only ${items.length} items but estimatedValue=R$${estimatedValue.toLocaleString()} — likely truncated biddingItems. Falling through to Strategy 2/3...`);
                // Don't return — let it fall through to try PNCP planilha extraction
            } else {
                console.log(`[AI Populate] Extracted ${items.length} items (legacy mode)`);
                return res.json({ items: naturalSortItems(items), totalItems: items.length, source: 'legacy_biddingItems' });
            }
        }

        // ── Strategy 2: Download planilhas from PNCP catalog (new analyses) ──
        const pncpSource = schemaV2?.pncp_source;
        const attachments = pncpSource?.attachments || [];
        
        // Find planilha/orçamento files in the catalog
        let planilhaFiles = attachments.filter((a: any) => 
            a.ativo && a.url && (
                a.purpose === 'planilha_orcamentaria' || 
                a.purpose === 'composicao_custos' ||
                a.purpose === 'bdi_encargos' ||
                a.purpose === 'anexo_geral'  // Include ALL annexes (downloaded or not)
            )
        );
        
        // If no planilha found, fall back to Edital + TR (pregões de serviço have items inside these)
        if (planilhaFiles.length === 0) {
            planilhaFiles = attachments.filter((a: any) =>
                a.ativo && a.url && (
                    a.purpose === 'edital' ||
                    a.purpose === 'termo_referencia'
                )
            );
            if (planilhaFiles.length > 0) {
                console.log(`[AI Populate] No planilha found — using ${planilhaFiles.length} edital/TR as source for item extraction`);
            }
        }
        
        // Debug: log all attachment purposes to diagnose classification issues
        if (attachments.length > 0) {
            console.log(`[AI Populate] Catalog has ${attachments.length} attachments. Purposes: ${JSON.stringify(attachments.map((a: any) => ({ t: a.titulo?.substring(0, 40), p: a.purpose, d: a.downloaded })))}`);
        }

        // ── Strategy 3: No catalog? Fetch attachments from PNCP API on the fly ──
        const pncpUrl = bidding.pncpLink || bidding.link || '';
        console.log(`[AI Populate] Strategy check: planilhaFiles=${planilhaFiles.length}, attachments=${attachments.length}, pncpUrl=${pncpUrl}, hasBiddingItems=${!!(biddingItems && biddingItems.trim().length >= 10)}`);
        
        if (planilhaFiles.length === 0 && pncpUrl) {
            console.log(`[AI Populate] No planilha in catalog (${attachments.length} total attachments). Fetching from PNCP: ${pncpUrl}`);
            
            // Parse URL to extract CNPJ/ano/sequencial
            // Formats: .../editais/CNPJ/ANO/SEQ or .../orgaos/CNPJ/compras/ANO/SEQ
            const pncpMatch = pncpUrl.match(/editais\/([^/]+)\/(\d{4})\/(\d+)/) || 
                              pncpUrl.match(/orgaos\/([^/]+)\/compras\/(\d{4})\/(\d+)/);
            if (pncpMatch) {
                const [, cnpj, ano, seq] = pncpMatch;
                const arquivosUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}/arquivos`;
                
                try {
                    const agent2 = new (require('https').Agent)({ rejectUnauthorized: false });
                    const arquivosRes = await axios.get(arquivosUrl, { httpsAgent: agent2, timeout: 10000 } as any);
                    const allArquivos = Array.isArray(arquivosRes.data) ? arquivosRes.data : [];
                    console.log(`[AI Populate] PNCP returned ${allArquivos.length} attachments`);

                    // Classify and filter for planilha-type files
                    const classifyForProposal = (arq: any): string => {
                        const n = (arq.titulo || arq.nomeArquivo || '').toLowerCase()
                            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                        if (n.includes('planilha') || n.includes('orcamento') || n.includes('orçamento')) return 'planilha_orcamentaria';
                        if (n.includes('composic') || n.includes('custo')) return 'composicao_custos';
                        if (n.includes('bdi') || n.includes('encargos')) return 'bdi_encargos';
                        if (n.includes('cronograma')) return 'cronograma';
                        if (n.includes('termo') && n.includes('referencia') || n.includes('termo_referencia') || n.includes('tr_')) return 'termo_referencia';
                        if (n.includes('edital') && !n.includes('anexo')) return 'edital';
                        if (n.includes('aviso') || n.includes('publicacao')) return 'aviso';
                        if (n.includes('modelo') || n.includes('minuta')) return 'modelo';
                        if (/^anexo[_\s]+(i|ii|iii|iv|v|vi|[0-9])/.test(n)) return 'anexo_geral';
                        return 'outro';
                    };

                    // First pass: look for planilha-type files
                    for (const arq of allArquivos) {
                        const purpose = classifyForProposal(arq);
                        const url = arq.url || arq.uri || '';
                        if (!url || !arq.statusAtivo) continue;
                        if (purpose === 'planilha_orcamentaria' || purpose === 'composicao_custos' || 
                            purpose === 'bdi_encargos' || purpose === 'anexo_geral') {
                            planilhaFiles.push({
                                titulo: arq.titulo || arq.nomeArquivo || 'arquivo',
                                url,
                                purpose,
                                ativo: true,
                                downloaded: false
                            });
                        }
                    }
                    
                    // Second pass: if no planilha found, use edital/TR (pregões de serviço)
                    if (planilhaFiles.length === 0) {
                        for (const arq of allArquivos) {
                            const purpose = classifyForProposal(arq);
                            const url = arq.url || arq.uri || '';
                            if (!url || !arq.statusAtivo) continue;
                            if (purpose === 'edital' || purpose === 'termo_referencia' ||
                                [1, 2, 4].includes(arq.tipoDocumentoId)) {
                                planilhaFiles.push({
                                    titulo: arq.titulo || arq.nomeArquivo || 'arquivo',
                                    url,
                                    purpose,
                                    ativo: true,
                                    downloaded: false
                                });
                            }
                        }
                        if (planilhaFiles.length > 0) {
                            console.log(`[AI Populate] No planilha in PNCP fetch — using ${planilhaFiles.length} edital/TR instead`);
                        }
                    }
                    console.log(`[AI Populate] After PNCP fetch: ${planilhaFiles.length} candidates found`);
                } catch (fetchErr: any) {
                    console.warn(`[AI Populate] Failed to fetch PNCP attachments: ${fetchErr.message}`);
                }
            }
        }

        if (planilhaFiles.length === 0) {
            return res.status(400).json({ 
                error: 'Nenhuma planilha orçamentária encontrada. Este processo não possui itens de orçamento no edital nem planilhas anexas no PNCP.',
                hint: 'Para obras de engenharia, as planilhas geralmente estão nos Anexos do edital. Para pregões de serviço, tente re-analisar o processo.',
                attachments_found: attachments.length,
                has_pncpLink: !!bidding.pncpLink,
                attachments_purposes: [...new Set(attachments.map((a: any) => a.purpose))]
            });
        }

        console.log(`[AI Populate] Found ${planilhaFiles.length} planilha candidates in PNCP catalog`);

        // Download planilha PDFs on demand
        const pdfParts: any[] = [];
        const downloadedNames: string[] = [];
        const agent = new (require('https').Agent)({ rejectUnauthorized: false });

        for (const pf of planilhaFiles.slice(0, 5)) { // Max 5 files
            try {
                console.log(`[AI Populate] Downloading: "${pf.titulo}" (${pf.purpose}) from ${pf.url}`);
                const fileRes = await axios.get(pf.url, {
                    httpsAgent: agent,
                    timeout: 60000,
                    responseType: 'arraybuffer',
                    maxRedirects: 5
                } as any);

                const buffer = Buffer.from(fileRes.data as ArrayBuffer);
                if (buffer.length === 0) continue;

                // Check if PDF
                const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
                if (isPdf) {
                    pdfParts.push({
                        inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' }
                    });
                    downloadedNames.push(pf.titulo);
                    console.log(`[AI Populate] ✅ PDF: ${pf.titulo} (${(buffer.length / 1024).toFixed(0)} KB)`);
                } else {
                    console.log(`[AI Populate] ⚠️ Not a PDF: ${pf.titulo} — skipping`);
                }
            } catch (err: any) {
                console.warn(`[AI Populate] ⚠️ Failed to download ${pf.titulo}: ${err.message}`);
            }
        }

        if (pdfParts.length === 0) {
            return res.status(400).json({ 
                error: 'Não foi possível baixar nenhuma planilha do PNCP. Tente novamente ou adicione a planilha manualmente.',
                attempted: planilhaFiles.map((p: any) => p.titulo)
            });
        }

        // Extract items from planilha PDFs using Gemini multimodal
        const extractPrompt = `Você é um especialista em licitações brasileiras de obras e serviços de engenharia.
Analise a(s) planilha(s) orçamentária(s) abaixo e extraia TODOS os itens/serviços com seus dados.

REGRAS:
1. Extraia CADA serviço/item individualmente — NÃO agrupe
2. Para cada item identifique: número, descrição técnica COMPLETA, unidade de medida, quantidade, preço unitário de referência
3. Mantenha a hierarquia: Grupo/Subgrupo (se houver) como prefixo na descrição
4. NÃO inclua subtotais, totais gerais, BDI ou encargos como itens — apenas serviços
5. Se a quantidade ou unidade não estiver clara, use quantidade=1 e unidade="UN"
6. Para valores monetários, use ponto como separador decimal (ex: 1234.56)
7. Multiplier = 1 para itens de obra (não há recorrência mensal)

ORGANIZAÇÃO DE LOTES E ITENS (itemNumber):
8. O campo itemNumber DEVE seguir padrão hierárquico organizado:
   - SEM lotes: "1", "2", "3" (numeração sequencial)
   - COM lotes, múltiplos itens: "1.1", "1.2", "2.1", "2.2" (Lote.Item)
   - COM subgrupos: "1.1.1", "1.1.2" (Grupo.Subgrupo.Item)
9. Se a planilha usa numeração como "1.1", "1.2", "2.1", PRESERVE tal numeração
10. Se a planilha usa "Lote 1 - Item 1" ou "Grupo A / Item 1", converta para "1.1", "1.2"
11. Retorne os itens SEMPRE na ordem natural crescente
12. NUNCA misture formatos no mesmo array

${pricingInfo ? `INFORMAÇÕES ADICIONAIS DE PREÇO:\n${pricingInfo}\n` : ''}

Responda APENAS com um JSON array válido:
[{"itemNumber":"1.1","description":"Descrição completa do serviço incluindo grupo","unit":"M²","quantity":100,"multiplier":1,"multiplierLabel":"","referencePrice":45.67}]`;

        console.log(`[AI Populate] Sending ${pdfParts.length} PDFs to Gemini for item extraction...`);
        const result = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: [{
                role: 'user',
                parts: [
                    ...pdfParts,
                    { text: extractPrompt }
                ]
            }],
            config: { 
                temperature: 0.05, 
                maxOutputTokens: 65536,
                responseMimeType: 'application/json'
            }
        }, 3, { tenantId: req.user.tenantId, operation: 'proposal_populate', metadata: { source: 'pdf_extraction' } });

        const responseText = result.text?.trim() || '';
        console.log(`[AI Populate] Response length: ${responseText.length} chars (first 300): ${responseText.substring(0, 300)}`);

        let items: any[];
        try {
            const parsed = JSON.parse(responseText);
            items = Array.isArray(parsed) ? parsed : (parsed.items || parsed.data || []);
        } catch {
            // Try regex extract
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                try { items = JSON.parse(jsonMatch[0]); }
                catch { return res.status(500).json({ error: 'AI returned invalid JSON from planilha', raw: responseText.substring(0, 300) }); }
            } else {
                return res.status(500).json({ error: 'AI returned no extractable data from planilha' });
            }
        }

        console.log(`[AI Populate] ✅ Extracted ${items.length} items from ${downloadedNames.length} planilha(s): ${downloadedNames.join(', ')}`);
        res.json({ 
            items: naturalSortItems(items), 
            totalItems: items.length, 
            source: 'pncp_planilha',
            planilhas: downloadedNames
        });
    } catch (error: any) {
        console.error('[AI Populate] Error:', error.message);
        res.status(500).json({ error: 'AI populate failed: ' + (error.message || 'Unknown') });
    }
});

// ═══════════════════════════════════════════════════════════════════════
// AI Cost Composition — Specialist in unit price composition
// Generates detailed cost breakdowns for exequibilidade proof
// ═══════════════════════════════════════════════════════════════════════
app.post('/api/proposals/ai-composition', authenticateToken, async (req: any, res) => {
    try {
        const { biddingProcessId, items } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'items array is required (with id, description, unit, quantity, unitPrice)' });
        }

        // Get bidding context
        const bidding = await prisma.biddingProcess.findFirst({
            where: { id: biddingProcessId, tenantId: req.user.tenantId },
            include: { aiAnalysis: true },
        });

        if (!bidding) return res.status(404).json({ error: 'Bidding process not found' });

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
        const ai = new GoogleGenAI({ apiKey });

        const schemaV2 = bidding.aiAnalysis?.schemaV2 as any;
        const pricingInfo = bidding.aiAnalysis?.pricingConsiderations || '';
        const processId = schemaV2?.process_identification || {};
        const modalidade = bidding.modality || processId?.modalidade || '';
        const objeto = processId?.objeto_completo || processId?.objeto || bidding.summary || '';

        const t0 = Date.now();
        console.log(`[AI Composition] Generating compositions for ${items.length} item(s), bidding: ${biddingProcessId}`);

        // Build items context
        const itemsContext = items.map((it: any, idx: number) => 
            `Item ${it.itemNumber || idx + 1}: "${it.description}" | Unid: ${it.unit} | Qtd: ${it.quantity} | Preço Unit.: R$ ${(it.unitPrice || 0).toFixed(2)}`
        ).join('\n');

        const prompt = `Você é um engenheiro de custos especialista em composição de preços unitários para licitações públicas brasileiras (Lei 14.133/2021, Acórdãos do TCU sobre BDI).

═══ SEU PAPEL ═══
Gerar composições de preços unitários REALISTAS e DETALHADAS para cada item abaixo, comprovando a viabilidade (exequibilidade) do preço ofertado.

═══ CONTEXTO DA LICITAÇÃO ═══
Objeto: ${objeto.substring(0, 1500)}
Modalidade: ${modalidade}
${pricingInfo ? `Informações de preço do edital:\n${pricingInfo.substring(0, 1500)}` : ''}

═══ ITENS PARA COMPOR ═══
${itemsContext}

═══ REGRAS CRÍTICAS ═══
1. Para CADA item, gere uma composição detalhada com elementos de custo REAIS e COERENTES
2. O TOTAL da composição deve ser PRÓXIMO ao preço unitário informado (tolerância de ±5%)
3. Use os seguintes grupos de custo (campo "group"):
   - MATERIAL: matéria-prima, insumos, peças
   - MAO_DE_OBRA: salários, encargos, benefícios
     REGRA OBRIGATÓRIA para MAO_DE_OBRA: a "description" DEVE ser o NOME DO PROFISSIONAL/CARGO que executa o trabalho, NUNCA o nome do processo.
     Exemplos CORRETOS: "Costureiro (Incl. Encargos)", "Auxiliar de Corte (Incl. Encargos)", "Cortador (Incl. Encargos)", "Operador de Máquina (Incl. Encargos)", "Eletricista (Incl. Encargos)", "Pedreiro (Incl. Encargos)", "Servente (Incl. Encargos)"
     Exemplos ERRADOS (NÃO USAR): "Corte de tecido", "Costura e acabamento", "Revisão e embalagem", "Manutenção elétrica"
     SEMPRE adicione "(Incl. Encargos)" ao final da description de MAO_DE_OBRA.
   - EQUIPAMENTO: máquinas, ferramentas (depreciação/aluguel)
   - FRETE: frete, transporte, logística
   - TERCEIROS: serviços subcontratados
   - ADMIN_CENTRAL: administração central (% sobre custo direto, tipicamente 3-6%)
   - CUSTOS_FINANCEIROS: custo financeiro (% sobre custo direto, tipicamente 0.5-2%)
   - SEGUROS: seguros e garantias (% sobre custo direto, tipicamente 0.3-1%)
   - RISCOS: riscos e imprevistos (tipicamente 0.5-1.5%)
   - DESPESAS_OPERACIONAIS: despesas operacionais gerais
   - TRIBUTOS: impostos (PIS 0.65%, COFINS 3%, ISSQN/ICMS conforme tipo)
   - LUCRO: margem de lucro (tipicamente 5-10%)

4. Cada linha da composição deve ter:
   - group: um dos grupos acima
   - description: descrição específica do insumo/custo
   - unit: unidade de medida (UN, KG, M, M², HORA, DIA, MÊS, VB, %, etc.)
   - quantity: quantidade ou coeficiente
   - unitValue: valor unitário do insumo
   
5. Os custos indiretos (ADMIN_CENTRAL, CUSTOS_FINANCEIROS, SEGUROS, RISCOS) geralmente são percentuais sobre o custo direto total
6. TRIBUTOS são calculados sobre o preço de venda
7. LUCRO é percentual sobre o custo direto

═══ FORMATO DE RESPOSTA ═══
Retorne APENAS um JSON array, onde cada elemento corresponde a um item:
[
  {
    "itemId": "id_do_item",
    "templateUsed": "AI_GENERATED",
    "lines": [
      { "group": "MATERIAL", "description": "Tecido algodão 100%", "unit": "M", "quantity": 2.5, "unitValue": 8.50 },
      { "group": "MAO_DE_OBRA", "description": "Costureiro (Incl. Encargos)", "unit": "HORA", "quantity": 1.5, "unitValue": 12.00 },
      { "group": "TRIBUTOS", "description": "PIS (0,65%)", "unit": "VB", "quantity": 1, "unitValue": 0.35 },
      { "group": "LUCRO", "description": "Margem de lucro", "unit": "VB", "quantity": 1, "unitValue": 4.20 }
    ]
  }
]

IMPORTANTE:
- Seja REALISTA nos valores — use preços de mercado brasileiro
- Inclua TODOS os elementos relevantes, sem omissões
- A soma de (quantity × unitValue) de TODAS as linhas DEVE SER IGUAL ao preço unitário do item
- Use o LUCRO como variável de equilíbrio: ajuste a margem de lucro para que o total BATA EXATAMENTE com o preço unitário
- Exemplo: se custos diretos + indiretos + tributos = R$ 35,00 e preço unitário = R$ 41,98, o lucro deve ser EXATAMENTE R$ 6,98
- NÃO retorne texto, markdown ou explicações — APENAS o JSON`;

        const result = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { 
                temperature: 0.2, 
                maxOutputTokens: 65536,
                responseMimeType: 'application/json'
            },
        }, 3, { tenantId: req.user.tenantId, operation: 'proposal_composition' });

        const responseText = result.text?.trim() || '';
        const duration = Date.now() - t0;
        console.log(`[AI Composition] Response: ${responseText.length} chars in ${duration}ms`);

        let compositions: any[];
        try {
            const parsed = JSON.parse(responseText);
            compositions = Array.isArray(parsed) ? parsed : (parsed.compositions || parsed.data || [parsed]);
        } catch {
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                try { compositions = JSON.parse(jsonMatch[0]); }
                catch { return res.status(500).json({ error: 'AI returned invalid JSON', raw: responseText.substring(0, 300) }); }
            } else {
                return res.status(500).json({ error: 'AI returned no extractable data' });
            }
        }

        // Add IDs to lines, calculate totalValue, and FINE-TUNE to match unit price exactly
        for (let idx = 0; idx < compositions.length && idx < items.length; idx++) {
            const comp = compositions[idx];
            const targetPrice = items[idx].unitPrice || 0;
            if (!comp.lines) comp.lines = [];

            // Step 1: Add IDs and calculate line totals
            for (const line of comp.lines) {
                line.id = `cl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                line.totalValue = Math.round((line.quantity || 0) * (line.unitValue || 0) * 100) / 100;
                line.source = line.source || 'IA';
            }

            // Step 2: Calculate current grand total
            const currentTotal = comp.lines.reduce((s: number, l: any) => s + (l.totalValue || 0), 0);
            const diff = Math.round((targetPrice - currentTotal) * 100) / 100;

            // Step 3: If there's a difference, adjust LUCRO line to compensate
            if (Math.abs(diff) >= 0.01 && targetPrice > 0) {
                // Find existing LUCRO line
                let lucroLine = comp.lines.find((l: any) => l.group === 'LUCRO');

                if (lucroLine) {
                    // Adjust the LUCRO line value
                    lucroLine.unitValue = Math.round((lucroLine.unitValue + diff / (lucroLine.quantity || 1)) * 100) / 100;
                    lucroLine.totalValue = Math.round((lucroLine.quantity || 1) * lucroLine.unitValue * 100) / 100;
                    
                    // If LUCRO became negative, distribute via DESPESAS_OPERACIONAIS instead
                    if (lucroLine.unitValue < 0) {
                        // Revert LUCRO
                        lucroLine.unitValue = Math.round((lucroLine.unitValue - diff / (lucroLine.quantity || 1)) * 100) / 100;
                        lucroLine.totalValue = Math.round((lucroLine.quantity || 1) * lucroLine.unitValue * 100) / 100;
                        
                        // Add/adjust DESPESAS_OPERACIONAIS
                        let despLine = comp.lines.find((l: any) => l.group === 'DESPESAS_OPERACIONAIS');
                        if (despLine) {
                            despLine.unitValue = Math.round((despLine.unitValue + diff / (despLine.quantity || 1)) * 100) / 100;
                            despLine.totalValue = Math.round((despLine.quantity || 1) * despLine.unitValue * 100) / 100;
                        } else {
                            comp.lines.push({
                                id: `cl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                                group: 'DESPESAS_OPERACIONAIS',
                                description: 'Ajuste operacional',
                                unit: 'VB',
                                quantity: 1,
                                unitValue: diff,
                                totalValue: diff,
                                source: 'Ajuste',
                            });
                        }
                    }
                } else {
                    // Create LUCRO line with the difference
                    comp.lines.push({
                        id: `cl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        group: 'LUCRO',
                        description: 'Margem de lucro',
                        unit: 'VB',
                        quantity: 1,
                        unitValue: diff,
                        totalValue: diff,
                        source: 'IA',
                    });
                }

                // Final verification — recalculate and micro-adjust if needed (rounding quirks)
                const finalTotal = comp.lines.reduce((s: number, l: any) => s + (l.totalValue || 0), 0);
                const microDiff = Math.round((targetPrice - finalTotal) * 100) / 100;
                if (Math.abs(microDiff) >= 0.01) {
                    const adjustLine = comp.lines.find((l: any) => l.group === 'LUCRO') || comp.lines[comp.lines.length - 1];
                    adjustLine.unitValue = Math.round((adjustLine.unitValue + microDiff / (adjustLine.quantity || 1)) * 100) / 100;
                    adjustLine.totalValue = Math.round((adjustLine.quantity || 1) * adjustLine.unitValue * 100) / 100;
                }

                const adjustedTotal = comp.lines.reduce((s: number, l: any) => s + (l.totalValue || 0), 0);
                console.log(`[AI Composition] Item ${idx + 1}: ajustado ${currentTotal.toFixed(2)} → ${adjustedTotal.toFixed(2)} (alvo: ${targetPrice.toFixed(2)}, diff original: ${diff.toFixed(2)})`);
            }
        }

        console.log(`[AI Composition] ✅ Generated ${compositions.length} compositions with ${compositions.reduce((s: number, c: any) => s + (c.lines?.length || 0), 0)} total lines in ${duration}ms`);
        res.json({ 
            compositions, 
            totalItems: compositions.length,
            durationMs: duration,
        });
    } catch (error: any) {
        console.error('[AI Composition] Error:', error.message);
        res.status(500).json({ error: 'AI composition failed: ' + (error.message || 'Unknown') });
    }
});

// POST AI Letter — DEPRECATED, replaced by /api/proposals/ai-letter-blocks (Fase 2)
// Kept as stub returning 410 Gone for any remaining clients
app.post('/api/proposals/ai-letter', authenticateToken, async (req: any, res) => {
    console.warn('[AI Letter] DEPRECATED endpoint called. Use /api/proposals/ai-letter-blocks instead.');
    res.status(410).json({
        error: 'Este endpoint foi descontinuado. Use /api/proposals/ai-letter-blocks para geração controlada por blocos.',
        migration: 'POST /api/proposals/ai-letter-blocks',
    });
});
// ═══════════════════════════════════════════════════════════════════════
// AI Letter Blocks — Controlled AI generation for specific letter parts
// Generates ONLY variable text blocks within a predefined structure.
// The AI does NOT decide layout, structure, or mandatory sections.
// ═══════════════════════════════════════════════════════════════════════
app.post('/api/proposals/ai-letter-blocks', authenticateToken, async (req: any, res) => {
    try {
        const { biddingProcessId, requestedBlocks } = req.body;

        if (!biddingProcessId) {
            return res.status(400).json({ error: 'biddingProcessId is required' });
        }
        if (!requestedBlocks || !Array.isArray(requestedBlocks) || requestedBlocks.length === 0) {
            return res.status(400).json({ error: 'requestedBlocks array is required (objectBlock, executionBlock, commercialExtras)' });
        }

        const validBlocks = ['objectBlock', 'executionBlock', 'commercialExtras'];
        const invalid = requestedBlocks.filter((b: string) => !validBlocks.includes(b));
        if (invalid.length > 0) {
            return res.status(400).json({ error: `Invalid blocks: ${invalid.join(', ')}. Valid: ${validBlocks.join(', ')}` });
        }

        const bidding = await prisma.biddingProcess.findFirst({
            where: { id: biddingProcessId, tenantId: req.user.tenantId },
            include: { aiAnalysis: true }
        });

        if (!bidding) return res.status(404).json({ error: 'Bidding process not found' });

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

        const ai = new GoogleGenAI({ apiKey });
        const schemaV2 = bidding.aiAnalysis?.schemaV2 as any;
        const fullSummary = bidding.aiAnalysis?.fullSummary || '';
        const pricingInfo = bidding.aiAnalysis?.pricingConsiderations || '';
        const processId = schemaV2?.process_identification || {};
        const contractCond = schemaV2?.contract_conditions || {};

        const t0 = Date.now();
        console.log(`[AI Letter Blocks] Generating ${requestedBlocks.length} block(s) for bidding ${biddingProcessId}`);

        // ── Build prompts for each requested block ──
        const blockPromises: Promise<{ blockId: string; content: string; durationMs: number }>[] = [];

        for (const blockId of requestedBlocks) {
            if (blockId === 'objectBlock') {
                const objContext = processId?.objeto_completo || processId?.objeto || bidding.summary || '';
                blockPromises.push((async () => {
                    const tStart = Date.now();
                    const prompt = `Você é um redator especialista em licitações públicas brasileiras.

TAREFA: Extraia e transcreva NA ÍNTEGRA o OBJETO da licitação abaixo.
NÃO resuma. Transcreva EXATAMENTE como consta no edital.
Se houver itens, lotes ou grupos, mencione-os.
Se o objeto for extenso, inclua-o completo.

DADOS DO EDITAL:
Título: ${bidding.title}
${objContext ? `Objeto identificado: ${objContext.substring(0, 2000)}` : ''}
Resumo do Edital:
${fullSummary.substring(0, 4000)}

REGRAS:
- Retorne APENAS o texto do objeto, sem aspas, sem markdown, sem títulos.
- NÃO adicione interpretações, apenas transcreva.
- Se não encontrar o objeto claramente, retorne o trecho mais relevante que descreva o escopo da contratação.`;

                    const result = await callGeminiWithRetry(ai.models, {
                        model: 'gemini-2.5-flash',
                        contents: prompt,
                        config: { temperature: 0.1, maxOutputTokens: 2048 },
                    }, 3, { tenantId: req.user.tenantId, operation: 'proposal_letter', metadata: { block: 'object' } });
                    return { blockId: 'objectBlock', content: result.text?.trim() || '', durationMs: Date.now() - tStart };
                })());
            }

            if (blockId === 'executionBlock') {
                // Provide FULL contract conditions as context, not just 1 field
                const execContext = contractCond?.local_execucao || contractCond?.prazo_execucao || '';
                const contractCondJson = JSON.stringify(contractCond || {}, null, 0).substring(0, 3000);
                blockPromises.push((async () => {
                    const tStart = Date.now();
                    const prompt = `Você é um analista especialista em editais de licitação pública brasileira.

TAREFA: Extraia do edital abaixo APENAS os seguintes dados (se existirem):
1. LOCAL COMPLETO de execução/entrega dos serviços ou bens (endereço completo, cidade, UF)
2. PRAZO de execução, entrega ou conclusão (em dias, meses ou conforme consta)
3. VIGÊNCIA do contrato (se mencionado)

DADOS DO EDITAL:
Título: ${bidding.title}
${execContext ? `Dados já identificados: ${execContext}` : ''}
Condições contratuais (JSON):
${contractCondJson}
Resumo do Edital:
${fullSummary.substring(0, 4000)}

REGRAS CRÍTICAS:
- Responda em frases COMPLETAS e objetivas, sem markdown.
- NUNCA trunque o texto no meio de uma palavra ou frase.
- Cada informação deve terminar com ponto final.
- Inclua APENAS os dados que existirem no edital.
- Se nenhum dado for encontrado, retorne exatamente: ""
- NÃO invente informações.
- Formato obrigatório: "Local de execução: [endereço completo]. Prazo de execução: [prazo]. Vigência contratual: [vigência]."`;

                    const result = await callGeminiWithRetry(ai.models, {
                        model: 'gemini-2.5-flash',
                        contents: prompt,
                        config: { temperature: 0.1, maxOutputTokens: 1024 },
                    }, 3, { tenantId: req.user.tenantId, operation: 'proposal_letter', metadata: { block: 'execution' } });
                    const content = result.text?.trim() || '';
                    return { blockId: 'executionBlock', content, durationMs: Date.now() - tStart };
                })());
            }

            if (blockId === 'commercialExtras') {
                const contractCondJson = JSON.stringify(contractCond || {}, null, 0).substring(0, 3000);
                blockPromises.push((async () => {
                    const tStart = Date.now();
                    const prompt = `Você é um analista especialista em licitações públicas brasileiras (Lei 14.133/2021).

TAREFA: Analise as condições financeiras e comerciais ESPECÍFICAS deste edital e extraia APENAS:
- Condições de pagamento específicas (prazo, forma, documentos exigidos para liquidação)
- Exigência de garantia contratual (tipo e percentual)
- Critério de reajuste de preços
- Condições sobre composição de BDI
- Exigências específicas sobre a proposta (formato, prazo, documentos adicionais)

DADOS FINANCEIROS DO EDITAL:
${pricingInfo ? `Considerações sobre preços: ${pricingInfo.substring(0, 3000)}` : 'Não disponível'}
Condições contratuais (JSON):
${contractCondJson}

Resumo do Edital:
${fullSummary.substring(0, 4000)}

REGRAS CRÍTICAS:
- NÃO inclua declarações genéricas sobre tributos, custos ou encargos (já estão na carta padrão).
- Retorne APENAS condições ESPECÍFICAS deste edital, em frases declarativas formais.
- Cada frase/cláusula DEVE terminar com ponto final.
- NUNCA trunque o texto no meio de uma palavra ou frase — complete a sentença.
- Se não houver condições específicas além das padrão, retorne exatamente: ""
- NÃO invente informações.
- Sem markdown, sem títulos, sem numeração.`;

                    const result = await callGeminiWithRetry(ai.models, {
                        model: 'gemini-2.5-flash',
                        contents: prompt,
                        config: { temperature: 0.1, maxOutputTokens: 2048 },
                    }, 3, { tenantId: req.user.tenantId, operation: 'proposal_letter', metadata: { block: 'commercial_extras' } });
                    const content = result.text?.trim() || '';
                    return { blockId: 'commercialExtras', content, durationMs: Date.now() - tStart };
                })());
            }
        }

        // ── Execute all blocks in parallel ──
        const results = await Promise.allSettled(blockPromises);
        const blocks: Record<string, string> = {};
        const timings: Record<string, number> = {};
        const errors: string[] = [];

        for (const result of results) {
            if (result.status === 'fulfilled') {
                blocks[result.value.blockId] = result.value.content;
                timings[result.value.blockId] = result.value.durationMs;
            } else {
                errors.push(result.reason?.message || 'Unknown AI error');
            }
        }

        const totalMs = Date.now() - t0;
        console.log(`[AI Letter Blocks] Completed in ${totalMs}ms — blocks: ${Object.keys(blocks).join(', ')} | timings: ${JSON.stringify(timings)}`);

        if (errors.length > 0) {
            console.warn(`[AI Letter Blocks] ${errors.length} block(s) failed:`, errors);
        }

        res.json({
            blocks,
            timings,
            errors: errors.length > 0 ? errors : undefined,
            totalMs,
        });

    } catch (error: any) {
        console.error('[AI Letter Blocks] Error:', error.message);
        res.status(500).json({ error: 'AI block generation failed: ' + (error.message || 'Unknown') });
    }
});


// ═══════════════════════════════════════════════════════════════════════
app.post('/api/dossier/ai-match', authenticateToken, async (req: any, res) => {
    try {
        const { requirements, documents } = req.body;

        if (!requirements || !Array.isArray(requirements) || requirements.length === 0) {
            return res.status(400).json({ error: 'requirements array is required' });
        }
        if (!documents || !Array.isArray(documents) || documents.length === 0) {
            return res.status(400).json({ error: 'documents array is required' });
        }

        console.log(`[Dossier AI Match] ${requirements.length} requirements × ${documents.length} docs for tenant ${req.user.tenantId}`);

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
        }

        const ai = new GoogleGenAI({ apiKey });

        // Build compact document list
        const docListStr = documents.map((d: any, i: number) =>
            `  DOC[${i}]: Tipo="${d.docType}" | Arquivo="${d.fileName}" | Grupo="${d.docGroup || 'N/A'}" | Vencimento="${d.expirationDate || 'Sem vencimento'}"`
        ).join('\n');

        // Build compact requirements list
        const reqListStr = requirements.map((r: string, i: number) =>
            `  REQ[${i}]: "${r}"`
        ).join('\n');

        const prompt = `# TAREFA
Você é um especialista sênior em licitações públicas brasileiras com 20 anos de experiência em habilitação documental. Sua tarefa é vincular DOCUMENTOS de uma empresa às EXIGÊNCIAS DE HABILITAÇÃO de um edital.

# PRINCÍPIOS FUNDAMENTAIS
1. **MAXIMIZE as vinculações corretas.** Se existe um documento que pode atender uma exigência, VINCULE-O. Não deixe exigências simples sem vínculo.
2. **Um mesmo documento PODE atender múltiplas exigências** quando faz sentido (ex: Contrato Social atende tanto "ato constitutivo" quanto "comprovação do ramo de atividade").
3. **NÃO vincule quando claramente não há documento compatível** na lista.
4. **RIGOR NAS ESFERAS**: Jamais substitua uma exigência Federal por um documento Estadual ou Municipal (e vice-versa). O match deve ser na mesma esfera.
5. **PJ vs PF**: Documentos de identificação pessoal (RG, CPF, CNH) atendem APENAS exigências de sócios/representantes. NUNCA os use para Habilitação Jurídica da empresa (Contrato Social, CNPJ).
6. **HIERARQUIA**: Priorize 'docType' (Tipo do Documento) sobre o 'fileName' (Nome do Arquivo). Use o nome do arquivo apenas para desempate ou se o Tipo for genérico.
7. **Priorize documentos NÃO vencidos** sobre vencidos. Se só há documento vencido, ainda assim vincule.

# TABELA DE EQUIVALÊNCIAS E EXCLUSÕES
Use esta tabela como referência rigorosa:

| Exigência do Edital | Documentos Aceitos (pelo docType ou nome) | PROIBIDO VINCULAR |
|---|---|---|
| Contrato Social / Ato constitutivo | Contrato Social, Estatuto, Ato Constitutivo, Requerimento Empresário | RG, CPF, CNH, Comprovante de Endereço |
| Inscrição no CNPJ | Cartão CNPJ, Comprovante de Inscrição CNPJ | Inscrição Estadual, Inscrição Municipal |
| Inscrição Estadual (CAD. ICMS) | Inscrição Estadual, Certidão de Dados Cadastrais Estadual | Inscrição Municipal, CNPJ |
| Inscrição Municipal (ISS) | Inscrição Municipal, Alvará de Funcionamento, Cadastro ISS | Inscrição Estadual, CNPJ |
| Regularidade Federal (Tributos e Dívida) | CND Federal, Certidão Conjunta União, Certidão Federal | CND Estadual, CND Municipal |
| Regularidade Estadual | CND Estadual, Certidões da Fazenda Estadual, SEFAZ | CND Federal, CND Municipal, CNPJ |
| Regularidade Municipal | CND Municipal, Certidão Fazenda Municipal | CND Estadual, CND Federal |
| Regularidade FGTS | CRF, Certidão FGTS | CND Trabalhista (CNDT), CND Federal |
| Regularidade Trabalhista (CNDT) | CNDT, Certidão Negativa Débitos Trabalhistas | CRF, CND Federal |
| Falência e Recuperação Judicial | Certidão de Falência, Certidão de Distribuição Cível | Certidão de Débitos, CND |
| Atestados de Capacidade Técnica | Atestado Técnico, Atestado de Capacidade, CAT, Acervo | Balanço, Contrato Social |
| Registro no Conselho (CREA/CAU/etc) | Registro Profissional, Registro no Conselho, CREA, CAU | Registro na Junta Comercial |

# REGRAS DE DECISÃO
- Analise o SIGNIFICADO da exigência, não apenas palavras-chave.
- Se a exigência menciona "no caso de" uma situação específica (estrangeira, MEI, etc), vincule null se não houver doc correspondente.
- Se houver dúvida entre dois documentos, escolha o que tem o 'docType' mais próximo da exigência.
- Check de Exclusão: Antes de vincular, verifique: "Este documento é da esfera (Federal/Estadual/Municipal) correta?".

# DADOS

DOCUMENTOS DA EMPRESA (${documents.length} documentos):
${docListStr}

EXIGÊNCIAS DO EDITAL (${requirements.length} exigências):
${reqListStr}

# FORMATO DE RESPOSTA
Responda APENAS com um JSON array. Para CADA exigência REQ[i], inclua um objeto:
{"r":0,"d":2,"m":"motivo curto"} — quando há match (r=reqIndex, d=docIndex, m=motivo)
{"r":1,"d":null,"m":"sem documento compatível"} — quando não há match

IMPORTANTE: Inclua uma entrada para CADA exigência (R0 a R${requirements.length - 1}).

Responda somente com o JSON array, sem markdown, sem texto adicional:`;

        const result = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                temperature: 0.05,
                maxOutputTokens: 8192,
            }
        }, 3, { tenantId: req.user.tenantId, operation: 'dossier_match' });

        const responseText = result.text?.trim() || '';
        console.log(`[Dossier AI Match] Raw response (first 500 chars): ${responseText.substring(0, 500)}`);

        // Parse JSON from response (handle markdown code blocks)
        let jsonStr = responseText;
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            jsonStr = jsonMatch[0];
        }

        let matchResults: any[];
        try {
            matchResults = JSON.parse(jsonStr);
        } catch (parseErr) {
            console.error('[Dossier AI Match] Failed to parse JSON:', responseText.substring(0, 500));
            return res.status(500).json({ error: 'AI returned invalid JSON', raw: responseText.substring(0, 200) });
        }

        // Convert to { requirementText -> [docId] } map
        const matches: Record<string, string[]> = {};

        for (const m of matchResults) {
            // Support both {"reqIndex":0} and {"r":0} formats
            const reqIdx = typeof m.r === 'number' ? m.r
                : typeof m.reqIndex === 'number' ? m.reqIndex
                    : parseInt(String(m.r ?? m.reqIndex ?? '').replace('R', ''));

            if (isNaN(reqIdx) || reqIdx < 0 || reqIdx >= requirements.length) continue;

            const reqText = requirements[reqIdx];

            const docIdxRaw = m.d ?? m.docIndex;
            if (docIdxRaw === null || docIdxRaw === undefined || docIdxRaw === 'SKIP' || docIdxRaw === -1) {
                continue;
            }

            const docIdx = typeof docIdxRaw === 'number' ? docIdxRaw : parseInt(docIdxRaw);
            if (isNaN(docIdx) || docIdx < 0 || docIdx >= documents.length) continue;

            matches[reqText] = [documents[docIdx].id];
            const reason = m.m || m.reason || '';
            console.log(`[Dossier AI Match] ✅ R${reqIdx} → DOC[${docIdx}] "${documents[docIdx].docType}" | ${reason}`);
        }

        const matchCount = Object.keys(matches).length;
        const skipped = matchResults.filter((m: any) => {
            const d = m.d ?? m.docIndex;
            return d === null || d === undefined || d === 'SKIP' || d === -1;
        }).length;
        console.log(`[Dossier AI Match] Result: ${matchCount} matched, ${skipped} skipped, ${requirements.length - matchCount - skipped} unhandled`);

        res.json({ matches, matchCount, totalRequirements: requirements.length });

    } catch (error: any) {
        console.error('[Dossier AI Match] Error:', error?.message || error);
        res.status(500).json({ error: 'AI matching failed: ' + (error?.message || 'Unknown error') });
    }
});


// AI Services imports movidos para cima

// AI Analysis Endpoint
app.post('/api/analyze-edital', authenticateToken, aiLimiter, async (req: any, res) => {
    try {
        const { fileNames } = req.body;
        if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
            return res.status(400).json({ error: 'fileNames array is required' });
        }

        let fullText = "";
        const pdfParts: any[] = [];

        // 1. Prepare files for Gemini (and verify tenant ownership)
        for (let fileNameSource of fileNames) {
            const fileName = decodeURIComponent(fileNameSource).split('?')[0];

            // Security: Verify if file belongs to tenant
            const doc = await prisma.document.findFirst({
                where: {
                    fileUrl: { contains: fileName },
                    tenantId: req.user.tenantId
                }
            });

            const belongsToTenant = doc || fileName.startsWith(`${req.user.tenantId}_`) || fileName.includes(`${req.user.tenantId}/`);

            if (!belongsToTenant) {
                console.warn(`[AI] Unauthorized access attempt to file: ${fileName} by tenant: ${req.user.tenantId}`);
                continue;
            }

            const fileToFetch = doc ? doc.fileUrl : fileName;
            const pdfBuffer = await getFileBufferSafe(fileToFetch, req.user.tenantId);

            if (pdfBuffer) {
                console.log(`[AI] Read file ${fileName} (${pdfBuffer.length} bytes)`);
                pdfParts.push({
                    inlineData: {
                        data: pdfBuffer.toString('base64'),
                        mimeType: 'application/pdf'
                    }
                });
            } else {
                console.error(`[AI] Could not find file anywhere: ${fileName}`);
            }
        }

        if (pdfParts.length === 0) {
            console.warn(`[AI] No valid files found for analysis among: ${fileNames.join(', ')}`);
            return res.status(400).json({
                error: 'Nenhum arquivo válido encontrado para análise no servidor.',
                details: `Foram processados ${fileNames.length} arquivos, mas nenhum pôde ser resgatado do armazenamento. Verifique se o bucket do Supabase está correto.`
            });
        }

        // 2. Setup Gemini AI
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error(`[AI] GEMINI_API_KEY is missing!`);
            return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in the backend' });
        }
        const ai = new GoogleGenAI({ apiKey });

        // 3. System Prompt & Strict JSON Schema Definition (Enhanced with precision rules)
        const systemInstruction = ANALYZE_EDITAL_SYSTEM_PROMPT;

        console.log(`[AI] Calling Gemini API(${pdfParts.length} PDF parts)...`);
        let response: any;
        const startTime = Date.now();

        try {
            response = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [
                    {
                        role: 'user',
                        parts: [
                            ...pdfParts,
                            { text: USER_ANALYSIS_INSTRUCTION }
                        ]
                    }
                ],
                config: {
                    systemInstruction,
                    temperature: 0.1,
                    maxOutputTokens: 32768,
                    responseMimeType: 'application/json'
                }
            }, 3, { tenantId: req.user.tenantId, operation: 'oracle_analysis' });
        } catch (geminiError: any) {
            console.warn(`[AI] Gemini falhou: ${geminiError.message}. Realizando Fallback automático para OpenAI (gpt-4o-mini)...`);
            try {
                response = await fallbackToOpenAi(pdfParts, systemInstruction, USER_ANALYSIS_INSTRUCTION);
            } catch (openAiError: any) {
                console.error(`[AI] Fallback via OpenAI também falhou: ${openAiError.message}`);
                throw new Error(`As duas IAs falharam. Gemini: ${geminiError.message} | OpenAI: ${openAiError.message}`);
            }
        }
        const duration = (Date.now() - startTime) / 1000;
        console.log(`[AI] Gemini responded in ${duration.toFixed(1)} s`);

        const rawText = response.text;
        if (!rawText) {
            console.error(`[AI] Empty response text from Gemini.`);
            throw new Error("A IA não retornou nenhum texto.");
        }

        console.log(`[AI] Raw response length: ${rawText.length} `);

        // ---- Robust JSON extraction and repair ----
        const finalPayload = robustJsonParse(rawText, 'AI-Edital');

        console.log(`[AI] Successfully parsed JSON. Top-level keys: ${Object.keys(finalPayload).join(', ')}`);
        if (finalPayload.process) {
            console.log(`[AI] process keys: ${Object.keys(finalPayload.process).join(', ')}`);
        }
        if (finalPayload.analysis) {
            console.log(`[AI] analysis keys: ${Object.keys(finalPayload.analysis).join(', ')}`);
        }
        res.json(finalPayload);

    } catch (error: any) {
        console.error("AI Analysis Error (FULL):", JSON.stringify({ message: error?.message, status: error?.status, code: error?.code, stack: error?.stack?.substring(0, 500) }));
        const logMsg = `[${new Date().toISOString()}] AI Error: ${error?.message || String(error)}\nStatus: ${error?.status}\nCode: ${error?.code}\nStack: ${error?.stack || 'No stack'}\n\n`;
        fs.appendFileSync(path.join(uploadDir, 'debug-analysis.log'), logMsg);

        // Return the REAL error message for debugging
        const realError = error?.message || String(error);
        res.status(500).json({ error: `Erro na IA: ${realError}` });
    }
});

// ══════════════════════════════════════════════════════════════════════════
// V2 — Análise de Edital em Pipeline (3 Etapas)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Gera contexto textual estruturado a partir do schemaV2 para consumo
 * por módulos downstream (Chat, Petições, Oráculo, Dossiê, Declarações, Proposta).
 * 
 * @param schema - O objeto AnalysisSchemaV1 (ou JSON equivalente)
 * @param focus  - Opcional: foco do contexto para reduzir tokens
 */
function buildSchemaV2Context(schema: any, focus?: 'full' | 'chat' | 'petition' | 'oracle' | 'dossier' | 'proposal' | 'declaration'): string {
    if (!schema) return '';
    const f = focus || 'full';
    const sections: string[] = [];

    // ── Identificação (sempre incluso) ──
    const pid = schema.process_identification || {};
    sections.push(`══ IDENTIFICAÇÃO DO PROCESSO ══
Órgão: ${pid.orgao || 'N/A'}
Edital: ${pid.numero_edital || 'N/A'} | Processo: ${pid.numero_processo || 'N/A'}
Modalidade: ${pid.modalidade || 'N/A'} | Critério: ${pid.criterio_julgamento || 'N/A'}
Objeto: ${pid.objeto_completo || pid.objeto_resumido || 'N/A'}
Tipo: ${pid.tipo_objeto || 'N/A'} | Município/UF: ${pid.municipio_uf || 'N/A'}`);

    // ── Timeline (chat, petition, full) ──
    if (['full', 'chat', 'petition'].includes(f)) {
        const tl = schema.timeline || {};
        sections.push(`══ PRAZOS E DATAS ══
Sessão: ${tl.data_sessao || 'N/A'}
Publicação: ${tl.data_publicacao || 'N/A'}
Impugnação: ${tl.prazo_impugnacao || 'N/A'}
Esclarecimento: ${tl.prazo_esclarecimento || 'N/A'}
Proposta: ${tl.prazo_envio_proposta || 'N/A'}
Recurso: ${tl.prazo_recurso || 'N/A'}`);
    }

    // ── Condições de Participação (chat, petition, declaration, full) ──
    if (['full', 'chat', 'petition', 'declaration'].includes(f)) {
        const pc = schema.participation_conditions || {};
        sections.push(`══ CONDIÇÕES DE PARTICIPAÇÃO ══
Consórcio: ${pc.permite_consorcio === null ? 'Não informado' : pc.permite_consorcio ? 'SIM' : 'NÃO'}
Subcontratação: ${pc.permite_subcontratacao === null ? 'Não informado' : pc.permite_subcontratacao ? 'SIM' : 'NÃO'}
Visita Técnica: ${pc.exige_visita_tecnica === null ? 'Não informado' : pc.exige_visita_tecnica ? 'SIM' : 'NÃO'}${pc.visita_tecnica_detalhes ? ' — ' + pc.visita_tecnica_detalhes : ''}
Garantia Proposta: ${pc.exige_garantia_proposta ? 'SIM — ' + pc.garantia_proposta_detalhes : 'NÃO'}
Garantia Contratual: ${pc.exige_garantia_contratual ? 'SIM — ' + pc.garantia_contratual_detalhes : 'NÃO'}
Tratamento ME/EPP: ${pc.tratamento_me_epp || 'N/A'}`);
    }

    // ── Exigências de Habilitação (chat, dossier, oracle, declaration, full) ──
    if (['full', 'chat', 'dossier', 'oracle', 'declaration'].includes(f)) {
        const reqs = schema.requirements || {};
        const reqSections = [
            ['Habilitação Jurídica', reqs.habilitacao_juridica],
            ['Regularidade Fiscal/Trabalhista', reqs.regularidade_fiscal_trabalhista],
            ['Qualificação Econômico-Financeira', reqs.qualificacao_economico_financeira],
            ['Qualificação Técnica Operacional', reqs.qualificacao_tecnica_operacional],
            ['Qualificação Técnica Profissional', reqs.qualificacao_tecnica_profissional],
            ['Proposta Comercial', reqs.proposta_comercial],
            ['Documentos Complementares', reqs.documentos_complementares],
        ];
        let reqText = '══ EXIGÊNCIAS DE HABILITAÇÃO ══\n';
        for (const [cat, items] of reqSections) {
            if (Array.isArray(items) && items.length > 0) {
                reqText += `\n▸ ${cat}:\n`;
                for (const r of items) {
                    const oblLabel = r.obligation_type || (r.mandatory ? 'obrigatória' : 'opcional');
                    const srcLabel = r.source_ref ? ` — 📄 ${r.source_ref}` : '';
                    reqText += `  [${r.requirement_id}] ${r.title}: ${r.description} (${oblLabel})${srcLabel}\n`;
                }
            }
        }
        sections.push(reqText);
    }

    // ── Análise Técnica (oracle, dossier, full) ──
    if (['full', 'oracle', 'dossier', 'chat'].includes(f)) {
        const ta = schema.technical_analysis || {};
        let taText = '══ ANÁLISE TÉCNICA ══\n';
        taText += `Atestado Capacidade Técnica: ${ta.exige_atestado_capacidade_tecnica ? 'SIM' : 'NÃO/N.I.'}\n`;
        if (ta.parcelas_relevantes?.length > 0) {
            taText += 'Parcelas Relevantes:\n';
            for (const p of ta.parcelas_relevantes) {
                taText += `  • ${p.item}: ${p.descricao} (mín: ${p.quantitativo_minimo} ${p.unidade})\n`;
            }
        }
        sections.push(taText);
    }

    // ── Econômico-Financeira (chat, proposal, full) ──
    if (['full', 'chat', 'proposal'].includes(f)) {
        const ef = schema.economic_financial_analysis || {};
        let efText = '══ ANÁLISE ECONÔMICO-FINANCEIRA ══\n';
        if (ef.indices_exigidos?.length > 0) {
            for (const idx of ef.indices_exigidos) {
                efText += `  • ${idx.indice}: ${idx.formula_ou_descricao} (mín: ${idx.valor_minimo})\n`;
            }
        }
        if (ef.patrimonio_liquido_minimo) efText += `Patrimônio Líquido Mínimo: ${ef.patrimonio_liquido_minimo}\n`;
        if (ef.capital_social_minimo) efText += `Capital Social Mínimo: ${ef.capital_social_minimo}\n`;
        sections.push(efText);
    }

    // ── Proposta (proposal, chat, full) ──
    if (['full', 'chat', 'proposal'].includes(f)) {
        const pa = schema.proposal_analysis || {};
        let paText = '══ ANÁLISE DA PROPOSTA ══\n';
        paText += `Planilha Orçamentária: ${pa.exige_planilha_orcamentaria ? 'SIM' : 'NÃO/N.I.'}\n`;
        paText += `Carta Proposta: ${pa.exige_carta_proposta ? 'SIM' : 'NÃO/N.I.'}\n`;
        paText += `Composição BDI: ${pa.exige_composicao_bdi ? 'SIM' : 'NÃO/N.I.'}\n`;
        if (pa.criterios_desclassificacao_proposta?.length > 0) {
            paText += 'Critérios de Desclassificação:\n';
            pa.criterios_desclassificacao_proposta.forEach((c: string) => paText += `  ⚠️ ${c}\n`);
        }
        sections.push(paText);
    }

    // ── Riscos Críticos (petition, chat, full) ──
    if (['full', 'chat', 'petition'].includes(f)) {
        const rr = schema.legal_risk_review || {};
        if (rr.critical_points?.length > 0) {
            let rrText = '══ PONTOS CRÍTICOS E RISCOS ══\n';
            for (const cp of rr.critical_points) {
                rrText += `  🔴 [${cp.severity?.toUpperCase()}] ${cp.title}\n`;
                rrText += `     ${cp.description}\n`;
                rrText += `     ➜ Ação: ${cp.recommended_action}\n`;
            }
            sections.push(rrText);
        }
        if (rr.ambiguities?.length > 0) {
            sections.push('Ambiguidades:\n' + rr.ambiguities.map((a: string) => `  ⚠️ ${a}`).join('\n'));
        }
        if (rr.points_for_impugnation_or_clarification?.length > 0) {
            sections.push('Pontos para Impugnação/Esclarecimento:\n' +
                rr.points_for_impugnation_or_clarification.map((p: string) => `  📌 ${p}`).join('\n'));
        }
    }

    // ── Outputs Operacionais (dossier, declaration, full) ──
    if (['full', 'dossier', 'declaration'].includes(f)) {
        const oo = schema.operational_outputs || {};
        if (oo.documents_to_prepare?.length > 0) {
            let ooText = '══ DOCUMENTOS A PREPARAR ══\n';
            for (const doc of oo.documents_to_prepare) {
                ooText += `  📋 ${doc.document_name} [${doc.priority?.toUpperCase()}] — ${doc.responsible_area}\n`;
            }
            sections.push(ooText);
        }
    }

    // ── Confiança (sempre) ──
    const conf = schema.confidence || {};
    sections.push(`══ CONFIANÇA DA ANÁLISE ══
Nível: ${conf.overall_confidence || 'N/A'}${conf.score_percentage ? ` (${conf.score_percentage}%)` : ''}
Modelo: ${schema.analysis_meta?.model_used || 'N/A'}
Prompt: ${(schema.analysis_meta as any)?.prompt_version || 'N/A'}`);

    return sections.join('\n\n');
}


/**
 * Validador automático de completude (sem IA).
 * Verifica se o JSON extraído está minimamente preenchido.
 */
function validateAnalysisCompleteness(schema: AnalysisSchemaV1): { valid: boolean; issues: string[]; confidence_score: number } {
    const issues: string[] = [];
    let totalChecks = 0;
    let passedChecks = 0;

    const check = (condition: boolean, message: string) => {
        totalChecks++;
        if (condition) {
            passedChecks++;
        } else {
            issues.push(message);
        }
    };

    // ── 1. Identificação do Processo (peso alto) ──
    check(
        !!(schema.process_identification?.objeto_resumido || schema.process_identification?.objeto_completo),
        'Objeto da licitação não identificado'
    );
    check(!!schema.process_identification?.modalidade, 'Modalidade não identificada');
    check(!!schema.process_identification?.orgao, 'Órgão licitante não identificado');
    check(!!schema.process_identification?.numero_edital, 'Número do edital não identificado');

    // ── 2. Timeline ──
    check(!!schema.timeline?.data_sessao, 'Data da sessão não identificada');
    check(
        !!(schema.timeline?.data_publicacao || schema.timeline?.prazo_impugnacao || schema.timeline?.prazo_esclarecimento),
        'Nenhum prazo relevante identificado (publicação, impugnação ou esclarecimento)'
    );

    // ── 3. Exigências de Habilitação (V2.5 calibrado) ──
    const allReqItems = Object.values(schema.requirements || {}).reduce((acc: any[], arr) => acc.concat(Array.isArray(arr) ? arr : []), [] as any[]);
    const totalReqs = allReqItems.filter((r: any) => !r.entry_type || r.entry_type === 'exigencia_principal').length;
    check(totalReqs > 0, 'Nenhuma exigência de habilitação identificada');
    check(totalReqs >= 5, `Pouquíssimas exigências identificadas (apenas ${totalReqs}), possível extração incompleta`);

    // ── 4. Condições de Participação ──
    check(
        schema.participation_conditions?.permite_consorcio !== null ||
        schema.participation_conditions?.permite_subcontratacao !== null ||
        !!schema.participation_conditions?.tratamento_me_epp,
        'Nenhuma condição de participação identificada'
    );

    // ── 5. Análise Técnica (flexibilizado — editais de fornecimento simples nem sempre têm) ──
    check(
        (schema.requirements?.qualificacao_tecnica_operacional?.length || 0) > 0 ||
        (schema.requirements?.qualificacao_tecnica_profissional?.length || 0) > 0 ||
        schema.technical_analysis?.exige_atestado_capacidade_tecnica === true ||
        totalReqs >= 10, // editais com muitas exigências provavelmente têm técnica embutida
        'Nenhuma exigência técnica ou atestado identificado'
    );

    // ── 6. Análise Econômico-Financeira (flexibilizado — dispensas/pregões menores dispensam) ──
    // Apenas registra como issue informativa, não é check eliminatório
    const hasEconReqs = (schema.requirements?.qualificacao_economico_financeira?.length || 0) > 0 ||
        (schema.economic_financial_analysis?.indices_exigidos?.length || 0) > 0;
    if (!hasEconReqs) {
        issues.push('Nenhuma exigência econômico-financeira identificada (pode ser dispensada pelo tipo de edital)');
    }
    // Conta como check, mas sempre passa (não penaliza)
    totalChecks++;
    passedChecks++;

    // ── 7. Proposta/Preço ──
    check(
        !!schema.process_identification?.criterio_julgamento,
        'Critério de julgamento não identificado'
    );

    // ── 8. Evidências (threshold reduzido na V2.5) ──
    const evCount = schema.evidence_registry?.length || 0;
    check(evCount > 0, 'Nenhuma evidência textual registrada');
    check(
        evCount >= 5,
        `Poucas evidências registradas (apenas ${evCount}), rastreabilidade comprometida`
    );

    // ── 9. Outputs Operacionais (Desativado na V2 Otimizada) ──
    // O pipeline unificou isso nas exigências para ganhar performance.

    // ── 10. Revisão de Risco (suavizado — editais limpos não geram achados) ──
    // Registra como check que sempre passa; a ausência de achados é informativa, não punitiva
    totalChecks++;
    if ((schema.legal_risk_review?.critical_points?.length || 0) > 0 ||
        (schema.legal_risk_review?.ambiguities?.length || 0) > 0) {
        passedChecks++;
    } else {
        passedChecks++; // Não penaliza — edital limpo é legítimo
        issues.push('Nenhum ponto crítico ou ambiguidade identificada (edital pode ser objetivo)');
    }

    const confidence_score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;

    return {
        valid: confidence_score >= 80, // FASE 2: exigência mínima subiu de 60% para 80%
        issues,
        confidence_score
    };
}

app.post('/api/analyze-edital/v2', authenticateToken, aiLimiter, async (req: any, res) => {
    const analysisStartTime = Date.now();
    const result = createEmptyAnalysisSchema();
    result.analysis_meta.analysis_id = `analysis_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    result.analysis_meta.generated_at = new Date().toISOString();

    try {
        const { fileNames, biddingProcessId } = req.body;
        if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
            return res.status(400).json({ error: 'fileNames array is required' });
        }

        // ── 1. Ingestão Documental (Etapa 0) ──
        const pdfParts: any[] = [];
        const sourceFiles: string[] = [];

        for (let fileNameSource of fileNames) {
            const fileName = decodeURIComponent(fileNameSource).split('?')[0];

            const doc = await prisma.document.findFirst({
                where: {
                    fileUrl: { contains: fileName },
                    tenantId: req.user.tenantId
                }
            });

            const belongsToTenant = doc || fileName.startsWith(`${req.user.tenantId}_`) || fileName.includes(`${req.user.tenantId}/`);
            if (!belongsToTenant) {
                console.warn(`[AI-V2] Unauthorized access attempt to file: ${fileName}`);
                continue;
            }

            const fileToFetch = doc ? doc.fileUrl : fileName;
            const pdfBuffer = await getFileBufferSafe(fileToFetch, req.user.tenantId);

            if (pdfBuffer) {
                const magic = pdfBuffer.length >= 4 ? pdfBuffer.toString('hex', 0, 4) : '';
                const isPdf = fileName.toLowerCase().endsWith('.pdf') || magic.startsWith('25504446');
                const isZip = fileName.toLowerCase().endsWith('.zip') || magic.startsWith('504b0304');
                const isRar = fileName.toLowerCase().endsWith('.rar') || magic.startsWith('52617221');
                const MAX_PDF_PARTS = 15;

                if (isPdf) {
                    console.log(`[AI-V2] Read PDF file ${fileName} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);
                    pdfParts.push({ inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' } });
                    sourceFiles.push(fileName);
                } else if (isZip) {
                    console.log(`[AI-V2] 📦 ZIP detected: ${fileName} (${(pdfBuffer.length / 1024).toFixed(0)} KB) — extracting PDFs...`);
                    try {
                        const JSZip = require('jszip');
                        const zip = await JSZip.loadAsync(pdfBuffer);
                        let zipEntries = Object.keys(zip.files).filter((name: string) => !name.toLowerCase().endsWith('.pdf') || zip.files[name].dir ? false : !['comprovante','resumo'].some(pat => name.toLowerCase().includes(pat)));
                        for (const entryName of zipEntries) {
                            if (pdfParts.length >= MAX_PDF_PARTS) break;
                            const entryBuffer = await zip.files[entryName].async('nodebuffer');
                            if (entryBuffer.length > 0) {
                                pdfParts.push({ inlineData: { data: entryBuffer.toString('base64'), mimeType: 'application/pdf' } });
                                sourceFiles.push(`${fileName}/${entryName}`);
                                console.log(`[AI-V2] ✅ Extracted PDF from ZIP: ${entryName} (${(entryBuffer.length / 1024).toFixed(0)} KB)`);
                            }
                        }
                    } catch (e: any) { console.warn(`[AI-V2] Failed to extract ZIP ${fileName}: ${e.message}`); }
                } else if (isRar) {
                    console.log(`[AI-V2] 📦 RAR detected: ${fileName} (${(pdfBuffer.length / 1024).toFixed(0)} KB) — extracting PDFs...`);
                    try {
                        const extractor = await createExtractorFromData({ data: new Uint8Array(pdfBuffer).buffer });
                        const extracted = extractor.extract({});
                        const files = [...extracted.files].filter(f => f.fileHeader.name.toLowerCase().endsWith('.pdf') && !f.fileHeader.flags.directory && f.extraction);
                        for (const rarFile of files) {
                            if (pdfParts.length >= MAX_PDF_PARTS) break;
                            if (rarFile.extraction && rarFile.extraction.length > 0) {
                                const entryBuffer = Buffer.from(rarFile.extraction);
                                pdfParts.push({ inlineData: { data: entryBuffer.toString('base64'), mimeType: 'application/pdf' } });
                                sourceFiles.push(`${fileName}/${rarFile.fileHeader.name}`);
                                console.log(`[AI-V2] ✅ Extracted PDF from RAR: ${rarFile.fileHeader.name} (${(entryBuffer.length / 1024).toFixed(0)} KB)`);
                            }
                        }
                    } catch (e: any) { console.warn(`[AI-V2] Failed to extract RAR ${fileName}: ${e.message}`); }
                } else {
                    console.warn(`[AI-V2] ⏭️ Skipped non-PDF/ZIP/RAR: ${fileName} (magic: ${magic})`);
                }
            } else {
                console.error(`[AI-V2] Could not find file: ${fileName}`);
            }
        }

        if (pdfParts.length === 0) {
            return res.status(400).json({ error: 'Nenhum arquivo válido encontrado para análise.' });
        }

        result.analysis_meta.source_files = sourceFiles;
        result.analysis_meta.source_type = 'upload_manual';

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' });
        }
        const ai = new GoogleGenAI({ apiKey });

        console.log(`[AI-V2] ═══ PIPELINE INICIADO ═══ (${pdfParts.length} PDFs, ${sourceFiles.join(', ')})`);

        // ── 2. Etapa 1: Extração Factual ──
        console.log(`[AI-V2] ── Etapa 1/3: Extração Factual...`);
        let extractionJson: any;
        const t1Start = Date.now();

        let modelsUsed: string[] = [];
        // Append manual-only extraction rules (valor, portal, data+hora) — NOT used by PNCP
        const manualUserInstruction = V2_EXTRACTION_USER_INSTRUCTION.replace('{domainReinforcement}', '') + MANUAL_EXTRACTION_ADDON;

        try {
            const extractionResponse = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{
                    role: 'user',
                    parts: [
                        ...pdfParts,
                        { text: manualUserInstruction }
                    ]
                }],
                config: {
                    systemInstruction: V2_EXTRACTION_PROMPT,
                    temperature: 0.05,
                    maxOutputTokens: 32768,
                    responseMimeType: 'application/json'
                }
            }, 5, { tenantId: req.user.tenantId, operation: 'analysis', metadata: { stage: 'raw_extraction' } });

            const extractionText = extractionResponse.text;
            if (!extractionText) throw new Error('Etapa 1 retornou vazio');

            extractionJson = robustJsonParse(extractionText, 'V2-Extraction');
            result.analysis_meta.workflow_stage_status.extraction = 'done';
            modelsUsed.push('gemini-2.5-flash');
            console.log(`[AI-V2] ✅ Etapa 1 concluída em ${((Date.now() - t1Start) / 1000).toFixed(1)}s — ` +
                `${(extractionJson.evidence_registry || []).length} evidências, ` +
                `${Object.values(extractionJson.requirements || {}).flat().length} exigências`);

        } catch (err: any) {
            console.warn(`[AI-V2] ⚠️ Etapa 1 Gemini falhou: ${err.message}. Tentando OpenAI...`);

            try {
                const openAiResult = await fallbackToOpenAiV2({
                    systemPrompt: V2_EXTRACTION_PROMPT,
                    userPrompt: manualUserInstruction,
                    pdfParts,
                    temperature: 0.05,
                    stageName: 'Etapa 1 (Extração)'
                });

                if (!openAiResult.text) throw new Error('OpenAI retornou vazio');

                extractionJson = robustJsonParse(openAiResult.text, 'V2-Extraction-OpenAI');
                result.analysis_meta.workflow_stage_status.extraction = 'done';
                modelsUsed.push(openAiResult.model);
                console.log(`[AI-V2] ✅ Etapa 1 concluída via OpenAI em ${((Date.now() - t1Start) / 1000).toFixed(1)}s`);

            } catch (openAiErr: any) {
                console.error(`[AI-V2] ❌ Etapa 1 falhou (Gemini + OpenAI): ${openAiErr.message}`);
                result.analysis_meta.workflow_stage_status.extraction = 'failed';
                result.confidence.warnings.push(`Etapa 1 (Extração) falhou em ambos os modelos: Gemini: ${err.message} | OpenAI: ${openAiErr.message}`);
                result.confidence.overall_confidence = 'baixa';
                result.analysis_meta.model_used = 'gemini-2.5-flash+openai-failed';
                return res.json({ schemaV2: result, partial: true, error: `Etapa 1 falhou` });
            }
        }

        // Merge extraction into result
        if (extractionJson.process_identification) result.process_identification = extractionJson.process_identification;
        if (extractionJson.timeline) result.timeline = extractionJson.timeline;
        if (extractionJson.participation_conditions) result.participation_conditions = extractionJson.participation_conditions;
        if (extractionJson.requirements) result.requirements = extractionJson.requirements;
        if (extractionJson.technical_analysis) result.technical_analysis = extractionJson.technical_analysis;
        if (extractionJson.economic_financial_analysis) result.economic_financial_analysis = extractionJson.economic_financial_analysis;
        if (extractionJson.proposal_analysis) result.proposal_analysis = extractionJson.proposal_analysis;
        if (extractionJson.contractual_analysis) result.contractual_analysis = extractionJson.contractual_analysis;
        if (extractionJson.evidence_registry) result.evidence_registry = extractionJson.evidence_registry;

        // ── 2.5. Domain Routing — Reforço por Tipo de Objeto ──
        const detectedObjectType = result.process_identification?.tipo_objeto || 'outro';
        const domainReinforcement = getDomainRoutingInstruction(detectedObjectType);
        if (domainReinforcement) {
            console.log(`[AI-V2] 🎯 Roteamento por tipo: ${detectedObjectType} — reforço aplicado nas Etapas 2 e 3`);
        }

        // ── 3. Etapa 2: Normalização por Categoria (paralela) ──
        console.log(`[AI-V2] ── Etapa 2/3: Normalização por Categoria...`);
        let normalizationJson: any = {};
        const t2Start = Date.now();

        try {
            const mergedRequirements: Record<string, any[]> = {};
            const mergedDocs: any[] = [];
            let totalNormalized = 0;
            let categoriesFailed = 0;

            const categoryTasks = NORM_CATEGORIES.map(cat => {
                const items = Array.isArray((extractionJson.requirements as any)?.[cat.key])
                    ? (extractionJson.requirements as any)[cat.key]
                    : [];

                if (items.length === 0) {
                    mergedRequirements[cat.key] = [];
                    return null;
                }

                // ── FAST-PATH: HJ, RFT, QEF — server-side normalization ──
                const FAST_NORM_CATS = ['habilitacao_juridica', 'regularidade_fiscal_trabalhista', 'qualificacao_economico_financeira'];
                if (FAST_NORM_CATS.includes(cat.key)) {
                    const normalized = items.map((item: any, idx: number) => ({
                        ...item,
                        requirement_id: item.requirement_id || `${cat.prefix}-${String(idx + 1).padStart(2, '0')}`,
                        entry_type: item.entry_type || 'exigencia_principal',
                        risk_if_missing: item.risk_if_missing || 'inabilitacao',
                        applies_to: item.applies_to || 'licitante',
                        obligation_type: item.obligation_type || 'obrigatoria_universal',
                        phase: item.phase || 'habilitacao',
                        source_ref: item.source_ref || 'referência não localizada',
                    }));
                    mergedRequirements[cat.key] = normalized;
                    totalNormalized += normalized.length;
                    normalized.filter((n: any) => n.entry_type === 'exigencia_principal').forEach((n: any) => {
                        mergedDocs.push({
                            document_name: n.title || n.requirement_id,
                            category: cat.key,
                            priority: 'critica',
                            responsible_area: cat.key === 'habilitacao_juridica' ? 'juridico' : 'contabil',
                            notes: ''
                        });
                    });
                    console.log(`[AI-V2] ⚡ FastNorm ${cat.prefix}: ${normalized.length} itens (server-side)`);
                    return { success: true, fastPath: true };
                }

                // ── AI normalization for QTO, QTP, PC, DC ──
                return (async () => {
                    const systemPrompt = buildCategoryNormPrompt(cat);
                    const userPrompt = buildCategoryNormUser(cat, items);

                    try {
                        const resp = await callGeminiWithRetry(ai.models, {
                            model: 'gemini-2.5-flash',
                            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                            config: {
                                systemInstruction: systemPrompt,
                                temperature: 0.1,
                                maxOutputTokens: 16384,
                                responseMimeType: 'application/json'
                            }
                        }, 1, { tenantId: req.user.tenantId, operation: 'analysis', metadata: { stage: `normalization-${cat.key}` } });
                        const text = resp.text;
                        if (!text) throw new Error(`${cat.prefix} vazio`);
                        const data = robustJsonParse(text, `Norm-${cat.prefix}`);
                        if (Array.isArray(data.items) && data.items.length > 0) {
                            mergedRequirements[cat.key] = data.items;
                            totalNormalized += data.items.length;
                        } else {
                            mergedRequirements[cat.key] = items;
                            totalNormalized += items.length;
                        }
                        if (Array.isArray(data.documents_to_prepare)) mergedDocs.push(...data.documents_to_prepare);
                        return { success: true };
                    } catch (gErr: any) {
                        console.warn(`[AI-V2] ⚠️ Norm ${cat.prefix} Gemini falhou. Fallback OpenAI...`);
                        try {
                            const oai = await fallbackToOpenAiV2({ systemPrompt, userPrompt, temperature: 0.1, stageName: `Norm-${cat.prefix}` });
                            if (!oai.text) throw new Error('OpenAI vazio');
                            const data = robustJsonParse(oai.text, `Norm-${cat.prefix}-OAI`);
                            if (Array.isArray(data.items) && data.items.length > 0) {
                                mergedRequirements[cat.key] = data.items;
                                totalNormalized += data.items.length;
                            } else {
                                mergedRequirements[cat.key] = items;
                                totalNormalized += items.length;
                            }
                            if (Array.isArray(data.documents_to_prepare)) mergedDocs.push(...data.documents_to_prepare);
                            modelsUsed.push('gpt-4o-mini');
                            return { success: true };
                        } catch {
                            mergedRequirements[cat.key] = items;
                            totalNormalized += items.length;
                            categoriesFailed++;
                            return { success: false };
                        }
                    }
                })();
            }).filter(Boolean);

            await Promise.allSettled(categoryTasks as Promise<any>[]);

            normalizationJson = {
                requirements_normalized: mergedRequirements,
                operational_outputs: { documents_to_prepare: mergedDocs },
            };
            result.analysis_meta.workflow_stage_status.normalization = 'done';
            modelsUsed.push('gemini-2.5-flash');
            console.log(`[AI-V2] ✅ Etapa 2 em ${((Date.now() - t2Start) / 1000).toFixed(1)}s — ${totalNormalized} itens, ${categoriesFailed} falhas`);

            if (categoriesFailed > 0) {
                result.confidence.warnings.push(`${categoriesFailed} categoria(s) não normalizada(s)`);
            }
        } catch (err: any) {
            console.error(`[AI-V2] ❌ Etapa 2 falhou: ${err.message}`);
            result.analysis_meta.workflow_stage_status.normalization = 'failed';
            result.confidence.warnings.push(`Etapa 2 falhou: ${err.message}`);
        }

        // Merge normalization — requirements normalizados sobrescrevem os da extração
        if (normalizationJson.requirements_normalized) {
            result.requirements = normalizationJson.requirements_normalized;
        }
        if (normalizationJson.operational_outputs) {
            result.operational_outputs = { ...result.operational_outputs, ...normalizationJson.operational_outputs };
        }
        if (normalizationJson.confidence) {
            result.confidence = { ...result.confidence, ...normalizationJson.confidence };
        }

        // ── 4. Etapa 3: Revisão de Risco ──
        console.log(`[AI-V2] ── Etapa 3/3: Revisão de Risco...`);
        const t3Start = Date.now();

        try {
            const riskUserInstruction = V2_RISK_REVIEW_USER_INSTRUCTION
                .replace('{extractionJson}', JSON.stringify(extractionJson, null, 2))
                .replace('{normalizationJson}', JSON.stringify(normalizationJson, null, 2))
                + (domainReinforcement ? `\n\n${domainReinforcement}` : '');

            const riskResponse = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{
                    role: 'user',
                    parts: [{ text: riskUserInstruction }]
                }],
                config: {
                    systemInstruction: V2_RISK_REVIEW_PROMPT,
                    temperature: 0.2,
                    maxOutputTokens: 16384,
                    responseMimeType: 'application/json'
                }
            }, 4, { tenantId: req.user.tenantId, operation: 'analysis', metadata: { stage: 'raw_risk_review' } });

            const riskText = riskResponse.text;
            if (!riskText) throw new Error('Etapa 3 retornou vazio');

            const riskJson = robustJsonParse(riskText, 'V2-RiskReview');
            result.analysis_meta.workflow_stage_status.risk_review = 'done';
            modelsUsed.push('gemini-2.5-flash');
            console.log(`[AI-V2] ✅ Etapa 3 concluída em ${((Date.now() - t3Start) / 1000).toFixed(1)}s — ` +
                `${(riskJson.legal_risk_review?.critical_points || []).length} pontos críticos`);

            // Merge risk review
            if (riskJson.legal_risk_review) {
                result.legal_risk_review = riskJson.legal_risk_review;
            }
            if (riskJson.operational_outputs_risk) {
                if (riskJson.operational_outputs_risk.questions_for_consultor_chat) {
                    result.operational_outputs.questions_for_consultor_chat = riskJson.operational_outputs_risk.questions_for_consultor_chat;
                }
                if (riskJson.operational_outputs_risk.possible_petition_routes) {
                    result.operational_outputs.possible_petition_routes = riskJson.operational_outputs_risk.possible_petition_routes;
                }
            }
            if (riskJson.confidence_update) {
                result.confidence.section_confidence.risk_review = riskJson.confidence_update.risk_review || 'media';
            }

        } catch (err: any) {
            console.warn(`[AI-V2] ⚠️ Etapa 3 Gemini falhou: ${err.message}. Tentando OpenAI...`);

            try {
                const riskUserInstruction = V2_RISK_REVIEW_USER_INSTRUCTION
                    .replace('{extractionJson}', JSON.stringify(extractionJson, null, 2))
                    .replace('{normalizationJson}', JSON.stringify(normalizationJson, null, 2))
                    + (domainReinforcement ? `\n\n${domainReinforcement}` : '');

                const openAiResult = await fallbackToOpenAiV2({
                    systemPrompt: V2_RISK_REVIEW_PROMPT,
                    userPrompt: riskUserInstruction,
                    temperature: 0.2,
                    stageName: 'Etapa 3 (Risco)'
                });

                if (!openAiResult.text) throw new Error('OpenAI retornou vazio');

                const riskJson = robustJsonParse(openAiResult.text, 'V2-RiskReview-OpenAI');
                result.analysis_meta.workflow_stage_status.risk_review = 'done';
                modelsUsed.push(openAiResult.model);
                console.log(`[AI-V2] ✅ Etapa 3 concluída via OpenAI em ${((Date.now() - t3Start) / 1000).toFixed(1)}s`);

                if (riskJson.legal_risk_review) result.legal_risk_review = riskJson.legal_risk_review;
                if (riskJson.operational_outputs_risk) {
                    if (riskJson.operational_outputs_risk.questions_for_consultor_chat) {
                        result.operational_outputs.questions_for_consultor_chat = riskJson.operational_outputs_risk.questions_for_consultor_chat;
                    }
                    if (riskJson.operational_outputs_risk.possible_petition_routes) {
                        result.operational_outputs.possible_petition_routes = riskJson.operational_outputs_risk.possible_petition_routes;
                    }
                }
                if (riskJson.confidence_update) {
                    result.confidence.section_confidence.risk_review = riskJson.confidence_update.risk_review || 'media';
                }

            } catch (openAiErr: any) {
                console.error(`[AI-V2] ❌ Etapa 3 falhou (Gemini + OpenAI): ${openAiErr.message}`);
                result.analysis_meta.workflow_stage_status.risk_review = 'failed';
                result.confidence.warnings.push(`Etapa 3 (Risco) falhou: Gemini: ${err.message} | OpenAI: ${openAiErr.message}`);
            }
        }

        // ── Schema Enforcement (Level 1, 2, 3) ──
        const enforceResult = enforceSchema(result);
        if (enforceResult.corrections > 0) {
            result.confidence.warnings.push(
                `SchemaEnforcer: ${enforceResult.corrections} campo(s) padronizado(s) automaticamente`
            );
            (result.analysis_meta as any).schema_enforcer = {
                corrections: enforceResult.corrections,
                details: enforceResult.details.slice(0, 20),
            };
        }

        // ── 5. Validação Automática (sem IA) ──
        const validation = validateAnalysisCompleteness(result);
        result.analysis_meta.workflow_stage_status.validation = validation.valid ? 'done' : 'failed';
        if (validation.issues.length > 0) {
            result.confidence.warnings.push(...validation.issues);
            console.log(`[AI-V2] ⚠️ Validação: ${validation.confidence_score}% (${validation.issues.length} problemas: ${validation.issues.join('; ')})`);
        } else {
            console.log(`[AI-V2] ✅ Validação: ${validation.confidence_score}% — todas as checagens passaram`);
        }

        // ── 5.5. Motor de Regras de Domínio ──
        let ruleFindings: any[] = [];
        try {
            ruleFindings = executeRiskRules(result);
            if (ruleFindings.length > 0) {
                (result.analysis_meta as any).rule_findings = ruleFindings;
                const criticalFindings = ruleFindings.filter(f => f.severity === 'critical' || f.severity === 'high');
                if (criticalFindings.length > 0) {
                    result.confidence.warnings.push(`Motor de regras: ${criticalFindings.length} findings críticos/altos`);
                }
            }
            console.log(`[AI-V2] 🔧 Motor de Regras: ${ruleFindings.length} findings`);
        } catch (ruleErr: any) {
            console.warn(`[AI-V2] ⚠️ Motor de regras falhou: ${ruleErr.message}`);
        }

        // ── 5.6. Avaliador de Qualidade ──
        let qualityReport: any = null;
        try {
            qualityReport = evaluateAnalysisQuality(result, ruleFindings, result.analysis_meta.analysis_id);
            (result.analysis_meta as any).quality_report = {
                overallScore: qualityReport.overallScore,
                categoryScores: qualityReport.categoryScores,
                issueCount: qualityReport.issues.length,
                summary: qualityReport.summary
            };
            console.log(`[AI-V2] 📊 Qualidade: ${qualityReport.overallScore}% | ${qualityReport.summary}`);
        } catch (qualErr: any) {
            console.warn(`[AI-V2] ⚠️ Avaliador de qualidade falhou: ${qualErr.message}`);
        }

        // ── 6. Confidence Score Final V2.5 (calibrado para refletir precisão real) ──
        // Rebalanceado: stages 30% + validation 25% + quality 25% + bônus excelência 20%
        const stagesDone = Object.values(result.analysis_meta.workflow_stage_status).filter(s => s === 'done').length;
        const stagesTotal = 4;
        const stageScore = (stagesDone / stagesTotal) * 100;
        const qualityScore = qualityReport?.overallScore || 50;
        let combinedScore = Math.round((stageScore * 0.30) + (validation.confidence_score * 0.25) + (qualityScore * 0.25));

        // Traceability assessment
        const allReqArrays = Object.values(result.requirements || {}).flat() as any[];
        const principalReqs = allReqArrays.filter((r: any) => !r.entry_type || r.entry_type === 'exigencia_principal');
        const reqCount = principalReqs.length;
        const tracedCount = principalReqs.filter((r: any) => r.source_ref && r.source_ref !== 'referência não localizada' && r.source_ref.trim() !== '').length;
        const traceabilityRatio = reqCount > 0 ? tracedCount / reqCount : 0;

        // Bônus de excelência: análises ricas recebem até 20% extra
        if (reqCount >= 20 && traceabilityRatio >= 0.7) {
            combinedScore += 20;
        } else if (reqCount >= 10 && traceabilityRatio >= 0.5) {
            combinedScore += 15;
        } else if (reqCount >= 5) {
            combinedScore += 10;
        }

        // Traceability penalty (suavizada)
        if (traceabilityRatio < 0.3 && reqCount > 5) {
            combinedScore -= 5;
        }

        // Floor: análises com todas as stages concluídas nunca ficam abaixo de 80%
        const stagesFailed = Object.values(result.analysis_meta.workflow_stage_status).filter(s => s === 'failed').length;
        const allStagesOk = stagesFailed === 0 && stagesDone === stagesTotal;
        const scoreFloor = allStagesOk ? 80 : 5;
        combinedScore = Math.max(scoreFloor, Math.min(100, combinedScore));

        // Confidence level V2.5 (flexibilizado)
        if (combinedScore >= 85 && traceabilityRatio >= 0.5) {
            result.confidence.overall_confidence = 'alta';
        } else if (combinedScore >= 70) {
            result.confidence.overall_confidence = 'alta';
        } else if (combinedScore >= 50) {
            result.confidence.overall_confidence = 'media';
        } else {
            result.confidence.overall_confidence = 'baixa';
        }
        (result.confidence as any).score_percentage = combinedScore;
        (result.confidence as any).traceability = {
            total_requirements: reqCount,
            traced_requirements: tracedCount,
            traceability_percentage: Math.round(traceabilityRatio * 100),
            evidence_registry_count: result.evidence_registry?.length || 0,
        };

        // Track all models used (deduped)
        const uniqueModels = [...new Set(modelsUsed)];
        result.analysis_meta.model_used = uniqueModels.join('+');
        (result.analysis_meta as any).prompt_version = V2_PROMPT_VERSION;
        (result.analysis_meta as any).models_per_stage = {
            extraction: modelsUsed[0] || 'failed',
            normalization: modelsUsed[1] || 'failed',
            risk_review: modelsUsed[2] || 'failed'
        };

        // ── 7. Indexação RAG ──
        if (biddingProcessId && pdfParts.length > 0) {
            try {
                await indexDocumentChunks(biddingProcessId, pdfParts);
                console.log(`[AI-V2] 🔗 RAG indexado para processo ${biddingProcessId}`);
            } catch (ragErr: any) {
                console.warn(`[AI-V2] RAG indexação falhou: ${ragErr.message}`);
            }
        }

        const totalDuration = ((Date.now() - analysisStartTime) / 1000).toFixed(1);
        const totalReqs = Object.values(result.requirements).reduce((sum, arr) => sum + arr.length, 0);
        console.log(`[AI-V2] ═══ PIPELINE CONCLUÍDO ═══ ${totalDuration}s total | ` +
            `Modelos: ${uniqueModels.join('+')} | ` +
            `${totalReqs} exigências | ${result.legal_risk_review.critical_points.length} riscos | ` +
            `${result.evidence_registry.length} evidências | Score: ${combinedScore}% (${result.confidence.overall_confidence})`);

        // ── 8. Compatibilidade V1 ──
        // Gera campos legacy para consumo pelos módulos que ainda usam o formato antigo

        // ── Helper: Parse date in PT-BR or ISO format ──
        const parsePtBrDate = (dateStr: string): string => {
            if (!dateStr) return '';
            // Already ISO
            if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr;
            // PT-BR: "27/05/2025 às 09:00" (SchemaEnforcer normalized format)
            const mAux = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+às\s+(\d{2}):(\d{2})/);
            if (mAux) return `${mAux[3]}-${mAux[2]}-${mAux[1]}T${mAux[4]}:${mAux[5]}:00`;
            // PT-BR: "27/05/2025 09:00" or "27/05/2025"
            const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*(\d{2}:\d{2})?/);
            if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00:00'}:00`;
            return dateStr;
        };

        // ── Helper: Calculate estimated value from itens or schema ──
        const calcEstimatedValue = (): number => {
            // Strategy 1: Sum from itens_licitados
            const itens = result.proposal_analysis?.itens_licitados || [];
            if (Array.isArray(itens) && itens.length > 0) {
                const total = itens.reduce((sum: number, it: any) => {
                    const price = parseFloat(String(it.referencePrice || 0)) || 0;
                    const qty = parseFloat(String(it.quantity || 1)) || 1;
                    const mult = parseFloat(String(it.multiplier || 1)) || 1;
                    return sum + (price * qty * mult);
                }, 0);
                if (total > 0) return Math.round(total * 100) / 100;
            }

            // Strategy 2: Parse R$ value from ALL text fields in the result
            const textsToSearch = [
                result.process_identification?.objeto_completo || '',
                result.process_identification?.objeto_resumido || '',
                ...(result.contractual_analysis?.obrigacoes_contratada || []),
                ...(result.contractual_analysis?.obrigacoes_contratante || []),
                ...(result.contractual_analysis?.penalidades || []),
                ...(result.contractual_analysis?.matriz_risco_contratual || []),
                result.contractual_analysis?.medicao_pagamento || '',
                ...(result.proposal_analysis?.observacoes_proposta || []),
                ...(result.proposal_analysis?.criterios_exequibilidade || []),
                result.participation_conditions?.garantia_contratual_detalhes || '',
                result.participation_conditions?.garantia_proposta_detalhes || '',
                ...(result.evidence_registry || []).map((e: any) => e.excerpt || ''),
                ...(result.legal_risk_review?.critical_points || []).map((cp: any) => `${cp.description} ${cp.reason}`),
                ...(result.confidence?.warnings || []),
            ].join(' ');
            // Match: R$ 1.234.567,89 or R$1234567.89
            const allRValues = textsToSearch.matchAll(/R\$\s*([\d.]+,\d{2})/gi);
            let maxValue = 0;
            for (const m of allRValues) {
                const cleaned = m[1].replace(/\./g, '').replace(',', '.');
                const val = parseFloat(cleaned);
                if (val > maxValue) maxValue = val;
            }
            if (maxValue > 0) return Math.round(maxValue * 100) / 100;
            // Also try: "valor estimado de 1.234.567,89" (without R$)
            const altMatch = textsToSearch.match(/valor\s*(?:estimado|global|total|máximo|contrat)\w*\s*(?:de|:)?\s*(?:R\$\s*)?([\d.]+,\d{2})/i);
            if (altMatch) {
                const cleaned = altMatch[1].replace(/\./g, '').replace(',', '.');
                const val = parseFloat(cleaned);
                if (val > 0) return Math.round(val * 100) / 100;
            }

            // Strategy 3: Derive from capital_social_minimo (≈10% do valor)
            const csm = result.economic_financial_analysis?.capital_social_minimo;
            if (csm) {
                const v = parseFloat(String(csm).replace(/[^\d.,]/g, '').replace(',', '.'));
                if (v > 0) return Math.round(v * 10 * 100) / 100;
            }

            // Strategy 4: patrimonio_liquido_minimo (≈10% do valor)
            const plm = result.economic_financial_analysis?.patrimonio_liquido_minimo;
            if (plm) {
                const v = parseFloat(String(plm).replace(/[^\d.,]/g, '').replace(',', '.'));
                if (v > 0) return Math.round(v * 10 * 100) / 100;
            }

            return 0;
        };

        // ── Helper: Detect portal from schema ──
        const detectPortal = (): string => {
            const orgao = (result.process_identification?.orgao || '').toLowerCase();
            const fonte = (result.process_identification?.fonte_oficial || '').toLowerCase();
            const edital = (result.process_identification?.numero_edital || '').toLowerCase();
            const allText = `${orgao} ${fonte} ${edital}`;
            if (/compras\.gov|comprasnet|cnetmobile|pncp|uasg/i.test(allText)) return 'Compras.gov.br';
            if (/bnc\b|bolsa\s*nacional/i.test(allText)) return 'BNC';
            if (/bll\b|bolsadedigital/i.test(allText)) return 'BLL';
            if (/licitanet/i.test(allText)) return 'Licitanet';
            if (/bbmnet/i.test(allText)) return 'BBMNet';
            if (/licita\s*mais|licita\s*mais\s*brasil|licitamaisbrasil/i.test(allText)) return 'Licita Mais Brasil';
            if (/portaldecompras|portal\s*de\s*compras|portaldecompraspublicas/i.test(allText)) return 'Portal de Compras Públicas';
            if (/licita[çc][õo]es[\s-]*e|banco\s*do\s*brasil|bb\b/i.test(allText)) return 'Licitações-e (BB)';
            if (/bec[\s/]*sp|bolsa\s*eletr[ôo]nica/i.test(allText)) return 'BEC/SP';
            if (/m2a/i.test(allText)) return 'M2A Tecnologia';
            // Detect by orgao type — federal organs use Compras.gov.br
            if (/federal|ministério|minist[eé]rio|uni[aã]o|autarquia federal|ibama|inss|inpe|icmbio/i.test(orgao)) return 'Compras.gov.br';
            // Municipal/state organs — don't force a portal, leave empty for user to select
            return '';
        };

        // ── Helper: Auto-calculate risk from critical points ──
        const autoRisk = (): string => {
            const cps = result.legal_risk_review?.critical_points || [];
            const criticals = cps.filter(cp => cp.severity === 'critica' || cp.severity === 'alta');
            const medias = cps.filter(cp => cp.severity === 'media');
            if (criticals.length >= 2) return 'Crítico';
            if (criticals.length >= 1) return 'Alto';
            if (medias.length >= 2) return 'Médio';
            return 'Baixo';
        };

        const estimatedValueCalc = calcEstimatedValue();

        // Prefer AI-extracted value, fall back to regex-based extraction
        const finalEstimatedValue = result.process_identification.valor_estimado_global || estimatedValueCalc;
        // Prefer AI-extracted portal, fall back to regex-based detection
        const finalPortal = result.process_identification.portal_licitacao && result.process_identification.portal_licitacao !== 'outro'
            ? result.process_identification.portal_licitacao
            : detectPortal() || result.process_identification.portal_licitacao || '';

        const legacyCompat = {
            process: {
                title: (() => {
                    const mod = result.process_identification.modalidade || '';
                    const numProc = result.process_identification.numero_processo || '';
                    const numEdit = result.process_identification.numero_edital || '';
                    const orgao = (result.process_identification.orgao || '').toUpperCase();
                    const numero = numProc || numEdit;
                    // Format: "Pregão Eletrônico 2613030301-PE - PREFEITURA MUNICIPAL DE X"
                    if (mod && numero && orgao) return `${mod} ${numero} - ${orgao}`;
                    if (mod && numero) return `${mod} ${numero}`;
                    if (numero && orgao) return `${numero} - ${orgao}`;
                    return result.process_identification.objeto_resumido || numero || 'Sem título';
                })(),
                summary: result.process_identification.objeto_completo || result.process_identification.objeto_resumido,
                modality: normalizeModality(result.process_identification.modalidade),
                object: result.process_identification.objeto_completo,
                agency: result.process_identification.orgao,
                portal: finalPortal,
                estimatedValue: finalEstimatedValue,
                sessionDate: parsePtBrDate(result.timeline.data_sessao),
                risk: autoRisk(),
                link: result.process_identification.link_sistema || undefined,
            },
            analysis: {
                fullSummary: `ANÁLISE V2 — ${result.process_identification.objeto_resumido}\n\n` +
                    `Modalidade: ${result.process_identification.modalidade}\n` +
                    `Órgão: ${result.process_identification.orgao}\n` +
                    `Sessão: ${result.timeline.data_sessao}\n\n` +
                    `Objeto: ${result.process_identification.objeto_completo}\n\n` +
                    `--- CONDIÇÕES ---\n` +
                    `Consórcio: ${result.participation_conditions.permite_consorcio ?? 'Não informado'}\n` +
                    `Subcontratação: ${result.participation_conditions.permite_subcontratacao ?? 'Não informado'}\n` +
                    `Visita Técnica: ${result.participation_conditions.exige_visita_tecnica ?? 'Não informado'}\n\n` +
                    `--- RISCOS CRÍTICOS (${result.legal_risk_review.critical_points.length}) ---\n` +
                    result.legal_risk_review.critical_points.map(cp =>
                        `[${cp.severity.toUpperCase()}] ${cp.title}: ${cp.description} → ${cp.recommended_action}`
                    ).join('\n'),
                qualificationRequirements: Object.values(result.requirements)
                    .flat()
                    .map(r => `[${r.requirement_id}] ${r.title}: ${r.description}`)
                    .join('\n'),
                biddingItems: (() => {
                    const itens = result.proposal_analysis?.itens_licitados || [];
                    if (Array.isArray(itens) && itens.length > 0) {
                        return itens.map((it: any) => 
                            `Item ${it.itemNumber || '?'}: ${it.description || ''} | Unid: ${it.unit || 'UN'} | Qtd: ${it.quantity || 1}${it.multiplier && it.multiplier > 1 ? ` × ${it.multiplier} ${it.multiplierLabel || ''}` : ''} | Ref: R$ ${it.referencePrice || 0}`
                        ).join('\n');
                    }
                    return (result.proposal_analysis.observacoes_proposta || []).join('\n');
                })(),
                pricingConsiderations: result.economic_financial_analysis.indices_exigidos
                    .map(i => `${i.indice}: ${i.formula_ou_descricao} (mín: ${i.valor_minimo})`)
                    .join('\n'),
            }
        };

        res.json({
            ...legacyCompat,          // Campos V1 para compatibilidade
            schemaV2: result,          // Schema completo V2
            _version: '2.0',
            _pipeline_duration_s: parseFloat(totalDuration),
            _prompt_version: V2_PROMPT_VERSION,
            _model_used: uniqueModels.join('+'),
            _overall_confidence: result.confidence.overall_confidence
        });

    } catch (error: any) {
        console.error(`[AI-V2] ERRO FATAL:`, error?.message || error);
        const logMsg = `[${new Date().toISOString()}] V2 Pipeline Error: ${error?.message || String(error)}\n${error?.stack || ''}\n\n`;
        fs.appendFileSync(path.join(uploadDir, 'debug-analysis.log'), logMsg);
        res.status(500).json({
            error: `Erro no pipeline V2: ${error?.message || 'Erro desconhecido'}`,
            schemaV2: result  // Retorna o que conseguiu mesmo em erro
        });
    }
});

// Petition Generation Endpoint
app.post('/api/petitions/generate', authenticateToken, async (req: any, res) => {
    try {
        const { biddingProcessId, companyId, templateType, userContext, attachments } = req.body;
        const tenantId = req.user.tenantId;

        console.log(`[Petition] Generating ${templateType} for process ${biddingProcessId} with ${attachments?.length || 0} attachments`);


        const bidding = await prisma.biddingProcess.findUnique({
            where: { id: biddingProcessId, tenantId },
            include: { aiAnalysis: true }
        });

        const company = await prisma.companyProfile.findUnique({
            where: { id: companyId, tenantId }
        });

        if (!bidding || !company) {
            return res.status(404).json({ error: 'Processo ou Empresa não encontrados.' });
        }

        if (!biddingProcessId || !companyId || (!userContext && (attachments?.length || 0) === 0)) {
            return res.status(400).json({ error: 'Por favor, selecione o processo, a empresa e descreva os fatos ou anexe documentos.' });
        }
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });

        const ai = new GoogleGenAI({ apiKey });
        const aiAnalysis = bidding.aiAnalysis;

        let biddingAnalysisText = 'Nenhuma análise detalhada disponível.';
        if (aiAnalysis) {
            // Prefer V2 structured context for petitions (risk + impugnation focus)
            if (aiAnalysis.schemaV2) {
                biddingAnalysisText = `
${buildModuleContext(aiAnalysis.schemaV2, 'petition')}

Resumo Executivo: ${aiAnalysis.fullSummary || 'N/A'}
`.trim();
                console.log(`[Petition] Using buildModuleContext('petition') for generation`);
            } else {
                biddingAnalysisText = `
Resumo do Edital (Card): ${bidding.summary || 'Não disponível'}
Parecer Técnico-Jurídico Profundo: ${aiAnalysis.fullSummary || 'Não disponível'}
Documentos Exigidos: ${typeof aiAnalysis.requiredDocuments === 'string' ? aiAnalysis.requiredDocuments : JSON.stringify(aiAnalysis.requiredDocuments)}
Itens e Lotes: ${aiAnalysis.biddingItems || 'Não disponível'}
Exigências de Qualificação Técnica (LITERAL): ${aiAnalysis.qualificationRequirements || 'Não disponível'}
Prazos e Datas Críticas: ${typeof aiAnalysis.deadlines === 'string' ? aiAnalysis.deadlines : JSON.stringify(aiAnalysis.deadlines)}
Considerações de Preço: ${aiAnalysis.pricingConsiderations || 'Não disponível'}
Alertas e Irregularidades: ${typeof aiAnalysis.irregularitiesFlags === 'string' ? aiAnalysis.irregularitiesFlags : JSON.stringify(aiAnalysis.irregularitiesFlags)}
Penalidades: ${aiAnalysis.penalties || 'Não disponível'}
`.trim();
            }
        }

        const currentDateStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        const repName = company.contactName || '[Nome do Representante]';
        const repCpf = company.contactCpf || '[CPF]';

        let cleanCity = (company.city || '[Cidade]').split('/')[0].trim();
        const companyState = (company.state || '[UF]').toUpperCase().trim();

        const systemInstruction = MASTER_PETITION_SYSTEM_PROMPT
            .replace(/{currentDate}/g, currentDateStr)
            .replace(/{legalRepresentativeName}/g, repName)
            .replace(/{legalRepresentativeCpf}/g, repCpf)
            .replace(/{companyCity}/g, cleanCity)
            .replace(/{companyState}/g, companyState)
            .replace(/{companyName}/g, company.razaoSocial)
            .replace(/{companyCnpj}/g, company.cnpj);

        const fullBiddingObject = bidding.summary || bidding.title;

        const userInstruction = PETITION_USER_INSTRUCTION
            .replace('{petitionType}', templateType.toUpperCase())
            .replace(/{fullBiddingObject}/g, fullBiddingObject)
            .replace('{issuer}', bidding.portal)
            .replace('{modality}', bidding.modality)
            .replace('{portal}', bidding.portal)
            .replace('{biddingAnalysis}', biddingAnalysisText)
            .replace('{companyName}', company.razaoSocial)
            .replace('{companyCnpj}', company.cnpj)
            .replace('{companyQualification}', company.qualification || 'Não informada')
            .replace(/{legalRepresentativeName}/g, repName)
            .replace(/{legalRepresentativeCpf}/g, repCpf)
            .replace(/{companyCity}/g, cleanCity)
            .replace(/{companyState}/g, companyState)
            .replace(/{currentDate}/g, currentDateStr)
            .replace('{userContext}', userContext);

        // Preparar partes para o Gemini (Texto + Arquivos PDF/Imagens)
        const parts: any[] = [{ text: userInstruction }];

        if (attachments && Array.isArray(attachments)) {
            attachments.forEach((att: any) => {
                if (att.data && att.mimeType) {
                    parts.push({
                        inlineData: {
                            data: att.data,
                            mimeType: att.mimeType
                        }
                    });
                }
            });
        }

        const result = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.0-flash',
            contents: [
                {
                    role: 'user',
                    parts: parts
                }
            ],
            config: {
                systemInstruction: systemInstruction,


                temperature: 0.2,
                maxOutputTokens: 8192
            }
        }, 3, { tenantId: req.user.tenantId, operation: 'petition' });

        res.json({ text: result.text });
    } catch (error: any) {
        console.error('[Petition] Error:', error.message);
        res.status(500).json({ error: 'Erro ao gerar petição: ' + (error.message || 'Unknown error') });
    }
});

// AI Chat Endpoint
app.post('/api/analyze-edital/chat', authenticateToken, aiLimiter, async (req: any, res) => {
    try {
        const traceLog = (msg: string) => {
            const timestamp = new Date().toISOString();
            fs.appendFileSync(path.join(uploadDir, 'chat-trace.log'), `[${timestamp}] ${msg}\n`);
            console.log(msg);
        };

        let { fileNames, biddingProcessId, messages } = req.body;
        traceLog(`Chat Request Received. processId: ${biddingProcessId}, messages: ${messages?.length}`);

        // Fetch analysis data for context AND source file names
        let analysisContext = "";
        let sourceFileNamesFromAnalysis: string[] = [];
        if (biddingProcessId) {
            const analysis = await prisma.aiAnalysis.findUnique({
                where: { biddingProcessId }
            });
            if (analysis) {
                // Prefer V2 structured context when available
                if (analysis.schemaV2) {
                    analysisContext = `
ANÁLISE ESTRUTURADA V2 DO EDITAL (confiança: ${(analysis.schemaV2 as any)?.confidence?.overall_confidence || 'N/A'}):

${buildModuleContext(analysis.schemaV2, 'chat')}
`;
                    traceLog(`[V2] Chat context loaded via buildModuleContext (${analysisContext.length} chars). Confidence: ${(analysis.schemaV2 as any)?.confidence?.overall_confidence}`);
                } else {
                    // Fallback to legacy V1 fields
                    analysisContext = `
CONTEÚDO DO RELATÓRIO ANALÍTICO EXISTENTE:
Resumo Executivo: ${analysis.fullSummary || 'N/A'}
Itens Licitados: ${analysis.biddingItems || 'N/A'}
Requisitos de Qualificação Técnica: ${analysis.qualificationRequirements || 'N/A'}
Considerações de Preço: ${analysis.pricingConsiderations || 'N/A'}
Penalidades: ${analysis.penalties || 'N/A'}
Documentos Exigidos: ${analysis.requiredDocuments || '[]'}
Prazos: ${analysis.deadlines || '[]'}
Riscos e Irregularidades: ${analysis.irregularitiesFlags || '[]'}
`;
                    traceLog("Legacy V1 analysis context loaded.");
                }

                // Retrieve the original PDF file names used during analysis
                if (analysis.sourceFileNames) {
                    try {
                        sourceFileNamesFromAnalysis = JSON.parse(analysis.sourceFileNames);
                        traceLog(`Source file names from analysis: ${JSON.stringify(sourceFileNamesFromAnalysis)}`);
                    } catch (e) {
                        traceLog(`Failed to parse sourceFileNames: ${analysis.sourceFileNames}`);
                    }
                }
            }
        }

        // If processId is provided, lookup fileNames in DB (more robust)
        if (biddingProcessId) {
            const process = await prisma.biddingProcess.findUnique({
                where: { id: biddingProcessId, tenantId: req.user.tenantId }
            });
            traceLog(`Process lookup: ${process ? 'FOUND' : 'NOT FOUND'} for tenant ${req.user.tenantId}`);
            if (process && process.link) {
                traceLog(`Process links found: ${process.link}`);
                const urls = process.link.split(',').map(u => u.trim());
                const dbFileNames = urls.map(url => {
                    // Only process URLs that look like local uploads
                    if (!url.includes('/uploads/') && !url.includes(req.user.tenantId)) {
                        traceLog(`Skipping external/non-pdf link: ${url}`);
                        return null;
                    }
                    try {
                        const urlObj = new URL(url);
                        const pathname = urlObj.pathname;
                        return path.basename(pathname).split('?')[0];
                    } catch (e) {
                        // Fallback for malformed URLs or non-URL strings
                        return url.split('/').pop()?.split('?')[0] || '';
                    }
                }).filter(Boolean);
                traceLog(`Derived valid dbFileNames: ${JSON.stringify(dbFileNames)}`);
                // Merge or override
                fileNames = [...new Set([...(fileNames || []), ...dbFileNames])];
            }
        }

        // Merge sourceFileNames from analysis (most reliable source of uploaded PDFs)
        if (sourceFileNamesFromAnalysis.length > 0) {
            fileNames = [...new Set([...(fileNames || []), ...sourceFileNamesFromAnalysis])];
            traceLog(`Merged sourceFileNames from analysis. Final fileNames: ${JSON.stringify(fileNames)}`);
        }

        if ((!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) && !analysisContext) {
            traceLog(`ERROR: No fileNames found and no analysis context.`);
            return res.status(400).json({ error: 'Nenhum contexto de documento (fileNames ou biddingProcessId) foi fornecido.' });
        }
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'messages array is required' });
        }

        // Busca Vetorial RAG
        let ragContext = "";
        try {
            const queryText = messages[messages.length - 1]?.text;
            if (queryText && biddingProcessId) {
                const similarChunks = await searchSimilarChunks(biddingProcessId, queryText, 5);
                if (similarChunks && similarChunks.length > 0) {
                    ragContext = "\n\nTRECHOS DO EDITAL MAIS RELEVANTES PARA A PERGUNTA:\n" + similarChunks.map((c: any) => c.content).join("\n\n---\n\n");
                    traceLog(`[RAG] Encontrados ${similarChunks.length} trechos vetorizados com sucesso para: "${queryText.substring(0, 30)}..."`);
                    analysisContext += ragContext;
                }
            }
        } catch (ragErr: any) {
            traceLog(`[RAG] Erro ao buscar vetores: ${ragErr.message}`);
        }

        const pdfParts: any[] = [];
        traceLog(`Final fileNames for Gemini: ${JSON.stringify(fileNames)}`);

        // DYNAMIC DECISION: Só enviamos o pesado PDF inteiro (multimodal) se o banco de vetor falhar ou não achar contexto.
        if (!ragContext || ragContext.trim() === "") {
            traceLog(`[RAG] Sem trechos vetorizados. Realizando fallback doloroso para envio completo do(s) PDF(s) para a IA...`);
            const fetched = await fetchPdfPartsForProcess(biddingProcessId, fileNames || [], req.user.tenantId);
            pdfParts.push(...fetched);
        } else {
            traceLog(`[RAG] Trechos fornecidos pela busca vetorial! Omitindo Buffer PDF da payload (Economia de tokens ativada 🚀).`);
        }

        if (pdfParts.length === 0 && !analysisContext) {
            traceLog(`CRITICAL: No PDF parts and no analysis context found.`);
            return res.status(400).json({ error: 'Nenhum contexto de documento ou análise encontrado para este chat.' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in the backend' });
        }
        const ai = new GoogleGenAI({ apiKey });

        const systemInstruction = `${CHAT_SYSTEM_PROMPT}

CONDIÇÕES DE CONTEXTO DESTE EDITAL:
${pdfParts.length > 0 ? "- Documentos PDF originais do edital estão disponíveis para consulta direta." : "- Documentos PDF originais AUSENTES. Use exclusivamente os dados do relatório analítico abaixo como fonte."}

${analysisContext}
`;

        // Using standard format {role, parts:[{text}]} mandated by the new genai SDK
        const formattedHistory = messages.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
        }));

        // Prepend the PDF parts to the first user message or as a context message
        // Better: In Gemini 2.0+, we can just include them in the contents.
        const historyWithContext = [...formattedHistory];
        if (historyWithContext.length > 0 && historyWithContext[0].role === 'user') {
            // Add PDF context to the very first user message to establish base knowledge
            historyWithContext[0].parts = [...pdfParts, ...historyWithContext[0].parts];
        } else {
            // Fallback: add as a separate user message if history is empty (shouldn't happen)
            historyWithContext.unshift({
                role: 'user',
                parts: [...pdfParts, { text: "Estes são os documentos para nossa conversa." }]
            });
        }

        const chatResult = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: historyWithContext,
            config: {
                systemInstruction,
                temperature: 0.35,
                maxOutputTokens: 32768
            }
        }, 3, { tenantId: req.user.tenantId, operation: 'ai_chat' });

        res.json({ text: chatResult.text });
    } catch (error: any) {
        console.error("AI Chat Error:", error?.message || error);
        res.status(500).json({ error: 'Failed to answer via AI chat' });
    }
});

// ═══════════════════════════════════════════════════════════════════════
// Chat Monitor Configuration
// ═══════════════════════════════════════════════════════════════════════

// GET: Taxonomy (static — returns available categories for the UI)
app.get('/api/chat-monitor/taxonomy', authenticateToken, async (req: any, res) => {
    try {

        res.json({
            categories: ALERT_TAXONOMY.map((c: any) => ({
                id: c.id,
                label: c.label,
                emoji: c.emoji,
                severity: c.severity,
                description: c.description,
                enabledByDefault: c.enabledByDefault,
            })),
            bySeverity: {
                critical: getCategoriesBySeverity().critical.map((c: any) => c.id),
                warning: getCategoriesBySeverity().warning.map((c: any) => c.id),
                info: getCategoriesBySeverity().info.map((c: any) => c.id),
            },
            defaultEnabled: DEFAULT_ENABLED_CATEGORIES,
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch taxonomy' });
    }
});

app.get('/api/chat-monitor/config', authenticateToken, async (req: any, res) => {
    try {

        const config = await prisma.chatMonitorConfig.findUnique({
            where: { tenantId: req.user.tenantId }
        });
        if (!config) {
            return res.json({
                keywords: "suspensa,reaberta,vencedora",
                customKeywords: "[]",
                enabledCategories: JSON.stringify(DEFAULT_ENABLED_CATEGORIES),
                categoryCustomKeywords: "{}",
                isActive: true
            });
        }
        // Garante que configs antigos (sem os novos campos) retornem defaults
        res.json({
            ...config,
            customKeywords: config.customKeywords || "[]",
            enabledCategories: config.enabledCategories || JSON.stringify(DEFAULT_ENABLED_CATEGORIES),
            categoryCustomKeywords: config.categoryCustomKeywords || "{}",
            notificationEmail: config.notificationEmail || "",
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch chat monitor config' });
    }
});

app.post('/api/chat-monitor/config', authenticateToken, async (req: any, res) => {
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

        const config = await prisma.chatMonitorConfig.upsert({
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
    } catch (error: any) {
        console.error('[ChatMonitor Config POST] Error saving config:', error?.message || error);
        res.status(500).json({ error: 'Failed to save chat monitor config', detail: error?.message });
    }
});

app.get('/api/chat-monitor/logs', authenticateToken, async (req: any, res) => {
    try {
        const { keyword, search, status, page = '1', limit = '20' } = req.query;
        const pageNum = Math.max(1, parseInt(page as string) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
        const skip = (pageNum - 1) * limitNum;

        // Build dynamic where clause
        const where: any = { tenantId: req.user.tenantId };

        if (keyword) {
            where.detectedKeyword = { contains: keyword as string, mode: 'insensitive' };
        }
        if (search) {
            where.content = { contains: search as string, mode: 'insensitive' };
        }
        if (status) {
            where.status = status as string;
        }

        const [logs, total] = await Promise.all([
            prisma.chatMonitorLog.findMany({
                where,
                include: { biddingProcess: true },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limitNum
            }),
            prisma.chatMonitorLog.count({ where })
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
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch chat monitor logs' });
    }
});

// Test Notification Endpoint
app.post('/api/chat-monitor/test', authenticateToken, async (req: any, res) => {
    try {
        const { NotificationService } = await import('./services/monitoring/notification.service');
        const result = await NotificationService.sendTestNotification(req.user.tenantId);
        res.json({
            success: true,
            results: result,
            message: result.telegram === null && result.whatsapp === null && result.email === null
                ? 'Nenhum canal configurado. Insira um Telegram Chat ID ou WhatsApp nas Configurações.'
                : 'Teste de notificação enviado! Verifique seus canais.'
        });
    } catch (error: any) {
        console.error('[ChatMonitor] Test notification error:', error.message);
        res.status(500).json({ error: 'Falha ao enviar teste de notificação.' });
    }
});

// Monitor Health Status Endpoint
app.get('/api/chat-monitor/health', authenticateToken, async (req: any, res) => {
    try {
        const health = pncpMonitor.getHealthStatus();
        const monitoredCount = await prisma.biddingProcess.count({
            where: { isMonitored: true, tenantId: req.user.tenantId }
        });
        const totalAlerts = await prisma.chatMonitorLog.count({
            where: { tenantId: req.user.tenantId }
        });
        res.json({
            ...health,
            monitoredProcesses: monitoredCount,
            totalAlerts
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get monitor health' });
    }
});

// ══════════════════════════════════════════
// ── Chat Monitor Module v2 Endpoints ──
// ══════════════════════════════════════════

// Update pncpLink for a process (manual fix when link was overwritten)
app.patch('/api/chat-monitor/pncp-link/:processId', authenticateToken, async (req: any, res) => {
    try {
        const { processId } = req.params;
        const { pncpLink } = req.body;
        if (!pncpLink?.includes('editais')) {
            return res.status(400).json({ error: 'Link PNCP inválido. Deve conter /editais/CNPJ/ANO/SEQ' });
        }
        await (prisma.biddingProcess as any).update({
            where: { id: processId },
            data: { pncpLink }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao atualizar link PNCP' });
    }
});

// Get grouped processes with message counts (V3 — includes monitored processes without logs)
app.get('/api/chat-monitor/processes', authenticateToken, async (req: any, res) => {
    try {
        const { companyId, platform } = req.query;
        const tenantId = req.user.tenantId;

        // Step 1: Get ALL relevant processes — monitored OR with chat logs
        const processWhere: any = {
            tenantId,
            OR: [
                { isMonitored: true },
                { chatMonitorLogs: { some: {} } }
            ],
        };
        if (companyId) processWhere.companyProfileId = companyId as string;

        const processes = await prisma.biddingProcess.findMany({
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
        let lastMsgMap = new Map<string, any>();
        try {
            const lastMessages: any[] = await prisma.$queryRawUnsafe(`
                SELECT DISTINCT ON ("biddingProcessId") 
                    "biddingProcessId", "content", "createdAt", "authorType", "detectedKeyword"
                FROM "ChatMonitorLog" 
                WHERE "tenantId" = $1 AND "biddingProcessId" = ANY($2::text[])
                ORDER BY "biddingProcessId", "createdAt" DESC
            `, tenantId, processIds);
            lastMsgMap = new Map(lastMessages.map((m: any) => [m.biddingProcessId, m]));
        } catch (e) {
            console.log('[ChatMonitor] Raw query failed, skipping last messages:', e);
        }

        // Step 3: Safely get unread counts
        let unreadMap = new Map<string, number>();
        let unreadQueryOk = false;
        try {
            const unreadCounts: any[] = await (prisma.chatMonitorLog as any).groupBy({
                by: ['biddingProcessId'],
                where: { tenantId, isRead: false },
                _count: { id: true },
            });
            unreadMap = new Map(unreadCounts.map((u: any) => [u.biddingProcessId, u._count.id]));
            unreadQueryOk = true;
        } catch {
            // isRead column may not exist yet — fall back to total
        }

        // Step 4: Get important processes (keyword detected OR manually pinned)
        let importantSet = new Set<string>();
        try {
            const kwLogs: any[] = await prisma.chatMonitorLog.findMany({
                where: { tenantId, OR: [{ detectedKeyword: { not: null } }, { isImportant: true }] },
                select: { biddingProcessId: true },
                distinct: ['biddingProcessId'],
            });
            importantSet = new Set(kwLogs.map((k: any) => k.biddingProcessId));
        } catch { /* silent */ }

        // Step 4b: Get archived processes (ALL logs for process are archived)
        let archivedSet = new Set<string>();
        try {
            const archivedLogs: any[] = await prisma.chatMonitorLog.findMany({
                where: { tenantId, isArchived: true },
                select: { biddingProcessId: true },
                distinct: ['biddingProcessId'],
            });
            archivedSet = new Set(archivedLogs.map((k: any) => k.biddingProcessId));
        } catch { /* silent */ }

        // Step 4c: Detect closure events (encerramento_processo category)
        let closureMap = new Map<string, string>();
        try {
            const closureLogs: any[] = await prisma.chatMonitorLog.findMany({
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
        } catch { /* silent */ }

        // Step 5: Build result
        const result = processes.map((p: any) => {
            const total = p._count.chatMonitorLogs || 0;
            const lastMsg = lastMsgMap.get(p.id);
            // Determine best platform link (prefer non-PNCP)
            const rawLink = p.link || null;
            const pncpLink = p.pncpLink || null;
            const isPncpUrl = (url: string) => /pncp\.gov\.br/i.test(url || '');
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
            const pf = (platform as string).toLowerCase();
            filtered = result.filter((p: any) => {
                const portal = (p.portal || '').toLowerCase();
                const link = (p.link || '').toLowerCase();
                if (pf === 'comprasnet') return (link.includes('cnetmobile') || link.includes('comprasnet') || portal.includes('compras') || portal.includes('cnet')) && !link.includes('bllcompras') && !link.includes('bnccompras') && !link.includes('bbmnet') && !link.includes('portaldecompraspublicas') && !link.includes('licitanet.com.br') && !link.includes('licitamaisbrasil') && !link.includes('m2atecnologia') && !portal.includes('m2a');
                if (pf === 'bbmnet') return link.includes('bbmnet') || link.includes('sala.bbmnet') || portal.includes('bbmnet');
                if (pf === 'm2a') return link.includes('m2atecnologia') || portal.includes('m2a');
                if (pf === 'pncp') return portal.includes('pncp') || link.includes('pncp.gov.br');
                if (pf === 'pcp') return link.includes('portaldecompraspublicas') || portal.includes('portal de compras');
                if (pf === 'licitanet') return link.includes('licitanet.com.br') || portal.includes('licitanet');
                if (pf === 'licitamaisbrasil') return link.includes('licitamaisbrasil.com.br') || portal.includes('licita mais brasil') || portal.includes('licitamaisbrasil');
                if (pf === 'bll') return link.includes('bllcompras') || link.includes('bll.org') || portal.includes('bll');
                if (pf === 'bnc') return link.includes('bnccompras');
                return true;
            });
        }

        res.json(filtered);
    } catch (error) {
        console.error('[ChatMonitor] Error fetching processes:', error);
        res.status(500).json({ error: 'Failed to fetch chat monitor processes', details: String(error) });
    }
});

// ── Global Message Search ──
app.get('/api/chat-monitor/search', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const q = (req.query.q as string || '').trim();
        const limit = Number(req.query.limit) || 100;

        if (!q) return res.json({ results: [] });

        const messages = await prisma.chatMonitorLog.findMany({
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
        const formatted = messages.map((m: any) => ({
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
    } catch (error) {
        console.error('[ChatMonitor] Error searching global messages:', error);
        res.status(500).json({ error: 'Failed to search messages' });
    }
});

// ── Process Closure Action ──
// Handles closure events: move bidding to Perdido/Arquivado and archive from monitor
app.post('/api/chat-monitor/process-close/:processId', authenticateToken, async (req: any, res) => {
    try {
        const { processId } = req.params;
        const { action } = req.body; // 'lost' | 'archived' | 'dismiss'
        const tenantId = req.user.tenantId;

        if (!['lost', 'archived', 'dismiss', 'stop-monitoring'].includes(action)) {
            return res.status(400).json({ error: 'Invalid action. Use: lost, archived, dismiss, stop-monitoring' });
        }

        // Map action to bidding status
        const statusMap: Record<string, string> = {
            lost: 'Perdido',
            archived: 'Arquivado',
        };

        // 1. Update bidding process status (if not dismiss/stop-monitoring)
        if (action === 'stop-monitoring') {
            // Only disable monitoring, don't change status or archive logs
            await prisma.biddingProcess.update({
                where: { id: processId, tenantId },
                data: { isMonitored: false },
            });
            console.log(`[ChatMonitor] Process ${processId} monitoring stopped (status unchanged)`);
            return res.json({
                success: true,
                action,
                message: 'Monitoramento removido — o status do processo não foi alterado.',
            });
        }

        if (action !== 'dismiss') {
            await prisma.biddingProcess.update({
                where: { id: processId, tenantId },
                data: {
                    status: statusMap[action],
                    isMonitored: false,
                },
            });
        }

        // 2. Archive all monitor logs for this process
        await prisma.chatMonitorLog.updateMany({
            where: { biddingProcessId: processId, tenantId },
            data: { isArchived: true },
        });

        console.log(`[ChatMonitor] Process ${processId} closed with action: ${action}`);

        res.json({
            success: true,
            action,
            newStatus: statusMap[action] || null,
            message: action === 'dismiss'
                ? 'Processo mantido no monitoramento (logs arquivados)'
                : `Processo movido para "${statusMap[action]}" e arquivado do monitoramento`,
        });
    } catch (error: any) {
        console.error('[ChatMonitor] Error closing process:', error?.message || error);
        res.status(500).json({ error: 'Failed to close process', detail: error?.message });
    }
});

// Get messages for a specific process (paginated, ordered chronologically)
app.get('/api/chat-monitor/messages/:processId', authenticateToken, async (req: any, res) => {
    try {
        const { processId } = req.params;
        const { page = '1', limit = '100' } = req.query;
        const pageNum = Math.max(1, parseInt(page as string) || 1);
        const limitNum = Math.min(500, Math.max(1, parseInt(limit as string) || 100));
        const skip = (pageNum - 1) * limitNum;

        const [messages, total] = await Promise.all([
            prisma.chatMonitorLog.findMany({
                where: { biddingProcessId: processId, tenantId: req.user.tenantId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limitNum,
            }),
            prisma.chatMonitorLog.count({
                where: { biddingProcessId: processId, tenantId: req.user.tenantId },
            }),
        ]);

        // Also get the process details
        const process = await prisma.biddingProcess.findUnique({
            where: { id: processId },
            select: {
                id: true, title: true, portal: true, modality: true,
                companyProfileId: true,
            },
        });

        res.json({
            messages,
            process: process ? { ...process, uasg: (process as any).uasg } : null,
            pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
        });
    } catch (error) {
        console.error('[ChatMonitor] Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Get unread count (for sidebar badge)
app.get('/api/chat-monitor/unread-count', authenticateToken, async (req: any, res) => {
    try {
        const count = await (prisma.chatMonitorLog as any).count({
            where: { tenantId: req.user.tenantId, isRead: false, isArchived: false }
        });
        res.json({ count });
    } catch {
        // isRead/isArchived columns may not exist yet
        res.json({ count: 0 });
    }
});

// Toggle read/important/archive on a log
app.put('/api/chat-monitor/log/:logId', authenticateToken, async (req: any, res) => {
    try {
        const { logId } = req.params;
        const { isRead, isImportant, isArchived } = req.body;

        const data: any = {};
        if (isRead !== undefined) data.isRead = isRead;
        if (isImportant !== undefined) data.isImportant = isImportant;
        if (isArchived !== undefined) data.isArchived = isArchived;

        const updated = await prisma.chatMonitorLog.update({
            where: { id: logId },
            data,
        });

        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update log' });
    }
});

// Batch mark-read all messages for a process
app.put('/api/chat-monitor/read-all/:processId', authenticateToken, async (req: any, res) => {
    try {
        const { processId } = req.params;
        const result = await (prisma.chatMonitorLog as any).updateMany({
            where: { biddingProcessId: processId, tenantId: req.user.tenantId, isRead: false } as any,
            data: { isRead: true },
        });
        res.json({ updated: result.count });
    } catch (error) {
        res.status(500).json({ error: 'Failed to mark messages as read' });
    }
});

// Batch toggle important/archive for all messages of a process
app.put('/api/chat-monitor/process-action/:processId', authenticateToken, async (req: any, res) => {
    try {
        const { processId } = req.params;
        const { isImportant, isArchived } = req.body;

        const data: any = {};
        if (isImportant !== undefined) data.isImportant = isImportant;
        if (isArchived !== undefined) data.isArchived = isArchived;

        const result = await prisma.chatMonitorLog.updateMany({
            where: { biddingProcessId: processId, tenantId: req.user.tenantId },
            data,
        });
        res.json({ updated: result.count });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update process messages' });
    }
});

// ══════════════════════════════════════════
// ── Local Watcher (Agent) Endpoints ──
// ══════════════════════════════════════════

// In-memory store for Agent Heartbeats (Phase 1)
const agentHeartbeats = new Map<string, any>(); 

// ══════════════════════════════════════════════════════════════
// ── System Health Watchdog: Self-monitoring for silent deaths ──
// ══════════════════════════════════════════════════════════════
const ADMIN_TELEGRAM_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID || '';
const pollerLastSuccess = new Map<string, Date>();
// Track which alerts are currently active (avoid repeated spam)
const watchdogActiveAlerts = new Set<string>();

async function sendAdminAlert(message: string) {
    if (!ADMIN_TELEGRAM_CHAT_ID) {
        console.warn('[Watchdog] ⚠️ ADMIN_TELEGRAM_CHAT_ID not set — alert suppressed');
        return;
    }
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
        console.warn('[Watchdog] ⚠️ TELEGRAM_BOT_TOKEN not set — alert suppressed');
        return;
    }
    try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: ADMIN_TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML',
        }, { timeout: 10000 });
        console.log(`[Watchdog] ✅ Admin alert sent to ${ADMIN_TELEGRAM_CHAT_ID}`);
    } catch (err: any) {
        console.error(`[Watchdog] ❌ Failed to send admin alert:`, err.message);
    }
}

async function runWatchdogCheck() {
    const now = new Date();
    const alerts: string[] = [];

    // ── 1. Check Railway pollers (BLL, BNC, PCP, Licitanet, LMB) ──
    const pollerThresholds: Record<string, number> = {
        'BLL+BNC':    10 * 60_000,  // 10 min (polls every 60s)
        'PCP':        15 * 60_000,  // 15 min (polls every 90s)
        'Licitanet':  15 * 60_000,  // 15 min (polls every 90s)
        'LMB':        15 * 60_000,  // 15 min (polls every 90s)
    };

    for (const [name, thresholdMs] of Object.entries(pollerThresholds)) {
        const lastSuccess = pollerLastSuccess.get(name);
        if (!lastSuccess) continue; // Not started yet — skip (will fire after startup delay)
        const elapsedMs = now.getTime() - lastSuccess.getTime();
        if (elapsedMs > thresholdMs) {
            const mins = Math.floor(elapsedMs / 60_000);
            if (!watchdogActiveAlerts.has(name)) {
                alerts.push(`⚠️ <b>${name}</b> não completa um ciclo há <b>${mins} minutos</b>`);
                watchdogActiveAlerts.add(name);
            }
        } else {
            // Recovered — clear active alert
            if (watchdogActiveAlerts.has(name)) {
                watchdogActiveAlerts.delete(name);
                // Send recovery notification
                sendAdminAlert(`✅ <b>${name}</b> voltou a funcionar normalmente.`);
            }
        }
    }

    // ── 2. Check Worker heartbeats (ComprasNet, BBMNET) ──
    const workerThresholdMs = 30 * 60_000; // 30 min — workers do heartbeat less frequently
    let anyWorkerHeartbeat = false;
    for (const [_tid, hb] of agentHeartbeats.entries()) {
        if (hb.lastHeartbeatAt) {
            anyWorkerHeartbeat = true;
            const elapsedMs = now.getTime() - new Date(hb.lastHeartbeatAt).getTime();
            if (elapsedMs > workerThresholdMs) {
                const mins = Math.floor(elapsedMs / 60_000);
                const label = `Worker-${hb.machineName || 'unknown'}`;
                if (!watchdogActiveAlerts.has(label)) {
                    alerts.push(`⚠️ <b>${label}</b> não fez heartbeat há <b>${mins} minutos</b>`);
                    watchdogActiveAlerts.add(label);
                }
            } else {
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
        const pendingCount = await prisma.chatMonitorLog.count({
            where: { status: 'PENDING_NOTIFICATION' },
        });
        if (pendingCount > 20) {
            const label = 'NotificationQueue';
            if (!watchdogActiveAlerts.has(label)) {
                alerts.push(`⚠️ <b>Fila de notificações</b> com <b>${pendingCount}</b> mensagens pendentes (possível travamento)`);
                watchdogActiveAlerts.add(label);
            }
        } else {
            watchdogActiveAlerts.delete('NotificationQueue');
        }
    } catch { /* DB query failed — don't alert on watchdog errors */ }

    // ── Send consolidated alert ──
    if (alerts.length > 0) {
        const msg = `🔴 <b>ALERTA DO SISTEMA — LicitaSaaS</b>\n\n` +
                    alerts.join('\n') + '\n\n' +
                    `<i>${now.toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })}</i>`;
        await sendAdminAlert(msg);
    }
}


// 1. Get sessions the agent should monitor
app.get('/api/chat-monitor/agents/sessions', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const processes = await prisma.biddingProcess.findMany({
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
    } catch (error: any) {
        console.error('[Agent /sessions] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch agent sessions' });
    }
});

// 2. Agent Heartbeat (Ping from Local Watcher)
app.post('/api/chat-monitor/agents/heartbeat', authenticateToken, async (req: any, res) => {
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
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to register heartbeat' });
    }
});

// 3. Agent Status (Ping from React UI)
app.get('/api/chat-monitor/agents/status', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const status = agentHeartbeats.get(tenantId);
        
        if (!status) {
            return res.json({ isOnline: false });
        }
        
        // Agent is considered offline if missed heartbeat for > 3 minutes
        const isOnline = (new Date().getTime() - status.lastHeartbeatAt.getTime()) < 3 * 60 * 1000;
        
        res.json({ ...status, isOnline });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch agent status' });
    }
});

// Receives messages from local ComprasNet Watcher
// ══════════════════════════════════════════

// ── Internal Worker Endpoints (multi-tenant, API key auth) ──
// Used by the centralized chat worker running on the server.
// Authenticated via CHAT_WORKER_SECRET instead of user JWT.

const CHAT_WORKER_SECRET = process.env.CHAT_WORKER_SECRET || '';

function authenticateWorker(req: any, res: any, next: any) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace('Bearer ', '');
    if (!CHAT_WORKER_SECRET || token !== CHAT_WORKER_SECRET) {
        return res.status(403).json({ error: 'Invalid worker secret' });
    }
    next();
}

// Internal Worker Heartbeat (updates agentHeartbeats per-tenant)
app.post('/api/chat-monitor/internal/heartbeat', authenticateWorker, async (req: any, res) => {
    try {
        const { activeSessions, tenantIds, machineName } = req.body;
        const tenants: string[] = tenantIds || [];
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
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to register worker heartbeat' });
    }
});

// Get ALL monitored processes across ALL tenants (for centralized worker)
// v3.0: Inclui credenciais do portal vinculado para autenticação dinâmica
app.get('/api/chat-monitor/internal/all-sessions', authenticateWorker, async (req: any, res) => {
    try {
        const processes = await prisma.biddingProcess.findMany({
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
        const enriched = processes.map((p: any) => {
            const creds = p.company?.credentials || [];
            const link = (p.link || '').toLowerCase();
            const rawPortal = (p.portal || '');
            const normalizedPortal = normalizePortal(rawPortal, p.link || '');

            // Smart matching: score each credential
            let bestCred: any = null;
            let bestScore = 0;

            // Get expected domains for this process's normalized portal
            const expectedDomains = PLATFORM_DOMAINS[normalizedPortal] || [];

            for (const c of creds) {
                const cp = (c.platform || '').toLowerCase();
                const cu = (c.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
                let score = 0;

                // Layer 1: Exact URL match (strongest signal)
                if (cu && link && (link.includes(cu) || cu.includes(link.split('/')[2] || ''))) score += 10;

                // Layer 2: Domain-level match (link domain vs credential URL domain)
                const linkDomain = link.split('/')[2] || '';
                const credDomain = cu.split('/')[0] || '';
                if (linkDomain && credDomain && (linkDomain.includes(credDomain) || credDomain.includes(linkDomain))) score += 8;

                // Layer 3: Platform name match (normalized portal vs credential platform)
                const normalizedCredPlatform = normalizePortal(c.platform || '', c.url || '');
                if (normalizedCredPlatform === normalizedPortal) score += 7;
                if (cp && link && link.includes(cp.replace(/\s+/g, ''))) score += 5;

                // Layer 4: PLATFORM_DOMAINS fallback — match credential URL against expected domains
                if (expectedDomains.length > 0 && cu) {
                    if (expectedDomains.some(d => cu.includes(d))) score += 6;
                }
                // Also check if credential platform maps to any of expected domains
                const credPlatformDomains = PLATFORM_DOMAINS[normalizedCredPlatform] || [];
                if (expectedDomains.length > 0 && credPlatformDomains.some(d => expectedDomains.includes(d))) score += 5;

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
                    login: isEncryptionConfigured() && isEncrypted(bestCred.login) ? decryptCredential(bestCred.login) : bestCred.login,
                    password: isEncryptionConfigured() && isEncrypted(bestCred.password) ? decryptCredential(bestCred.password) : bestCred.password,
                    url: bestCred.url,
                    platform: bestCred.platform,
                } : null,
            };
        });

        console.log(`[Worker] Returning ${enriched.length} monitored processes across all tenants (${enriched.filter((p: any) => p.portalCredentials).length} with credentials)`);
        res.json(enriched);
    } catch (error: any) {
        console.error('[Worker /all-sessions] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch all sessions' });
    }
});

// Ingest messages from centralized worker (with explicit tenantId)
app.post('/api/chat-monitor/internal/ingest', authenticateWorker, async (req: any, res) => {
    try {
        const { processId, tenantId, messages } = req.body;

        if (!processId || !tenantId || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'processId, tenantId, and messages[] required' });
        }

        // Verify process belongs to tenant
        const processRecord = await prisma.biddingProcess.findFirst({
            where: { id: processId, tenantId }
        });
        if (!processRecord) {
            return res.status(404).json({ error: 'Process not found for given tenant' });
        }

        const result = await IngestService.ingestMessages(prisma, {
            processId, tenantId, messages, captureSource: 'server-worker'
        });

        console.log(`[Worker Ingest] ${result.created} msgs saved for ${processId.substring(0, 8)} (tenant ${tenantId.substring(0, 8)}, ${result.alerts} alerts)`);
        res.json(result);
    } catch (error: any) {
        console.error('[Worker Ingest] Error:', error.message);
        res.status(500).json({ error: 'Failed to ingest messages', details: error.message });
    }
});

// ── Diagnostic: check notification pipeline health ──
app.get('/api/chat-monitor/internal/notification-diag', authenticateWorker, async (req: any, res) => {
    try {
        const { NotificationService } = await import('./services/monitoring/notification.service');

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
        const statusCounts = await prisma.chatMonitorLog.groupBy({
            by: ['status'],
            _count: true,
        });

        // 3. Check tenant configs
        const configs = await prisma.chatMonitorConfig.findMany({
            select: {
                tenantId: true,
                isActive: true,
                telegramChatId: true,
                phoneNumber: true,
                notificationEmail: true,
            },
        });

        // 4. Recent logs with BLL/BNC
        const recentBatchLogs = await prisma.chatMonitorLog.findMany({
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
        const pendingCount = await prisma.chatMonitorLog.count({
            where: { status: 'PENDING_NOTIFICATION' },
        });

        res.json({
            envCheck,
            statusCounts: statusCounts.map((s: any) => ({ status: s.status, count: s._count })),
            tenantConfigs: configs.map((c: any) => ({
                tenantId: c.tenantId.substring(0, 8),
                isActive: c.isActive,
                hasTelegram: !!c.telegramChatId,
                telegramChatId: c.telegramChatId || 'NOT SET',
                hasWhatsApp: !!c.phoneNumber,
                hasEmail: !!c.notificationEmail,
            })),
            pendingNotifications: pendingCount,
            recentBatchLogs: recentBatchLogs.map((l: any) => ({
                id: l.id.substring(0, 8),
                status: l.status,
                sentTo: l.sentTo,
                source: l.captureSource,
                keyword: l.detectedKeyword,
                createdAt: l.createdAt,
                content: (l.content || '').substring(0, 80),
            })),
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ── Reprocess: retry PENDING/FAILED notifications ──
app.post('/api/chat-monitor/internal/reprocess-notifications', authenticateWorker, async (req: any, res) => {
    try {
        const { NotificationService } = await import('./services/monitoring/notification.service');

        // Reset FAILED back to PENDING_NOTIFICATION so they get reprocessed
        const resetResult = await prisma.chatMonitorLog.updateMany({
            where: { status: { in: ['FAILED', 'NO_CHANNEL'] } },
            data: { status: 'PENDING_NOTIFICATION' },
        });

        // Now process all pending
        await NotificationService.processPendingNotifications();

        const remaining = await prisma.chatMonitorLog.count({
            where: { status: 'PENDING_NOTIFICATION' },
        });

        res.json({
            success: true,
            resetCount: resetResult.count,
            remainingPending: remaining,
            message: `Reset ${resetResult.count} failed notifications and reprocessed. ${remaining} still pending.`,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ── Test Fetch BLL ──
app.get('/api/chat-monitor/internal/test-bll-fetch', authenticateWorker, async (req: any, res) => {
    try {
        const { processId, tenantId, param1 } = req.query;

        const { BatchPlatformMonitor, BATCH_PLATFORMS } = await import('./services/monitoring/batch-platform-monitor.service');
        const { IngestService } = await import('./services/monitoring/ingest.service');

        const platform = BATCH_PLATFORMS.find(p => p.id === 'bll');
        if (!platform) return res.status(500).json({ error: 'Platform not found' });

        const messages = await BatchPlatformMonitor.fetchAllMessages(param1 as string, platform);
        
        let result = null;
        let dedupErrors = null;
        if (messages.length > 0) {
            try {
                result = await IngestService.ingestMessages(prisma, {
                    processId: processId as string,
                    tenantId: tenantId as string,
                    messages: messages.map((m: any) => ({
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
            } catch (error: any) {
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

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ── Persist M2A certame_id link (worker write-back for stable matching) ──
// Called by M2A Watcher after a successful fuzzy-match to persist the canonical
// certame URL in the process link field. Subsequent runs use Strategy 1 (exact match).
app.patch('/api/chat-monitor/internal/sessions/:processId/link', authenticateWorker, async (req: any, res) => {
    try {
        const { processId } = req.params;
        const { certameId, certameUrl, link } = req.body;

        if (!certameId && !certameUrl && !link) {
            return res.status(400).json({ error: 'certameId, certameUrl, or link required' });
        }

        // Verify process exists
        const process = await prisma.biddingProcess.findUnique({
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
            await prisma.biddingProcess.update({
                where: { id: processId },
                data: { link: newLink },
            });
            console.log(`[Worker Discovery] Link updated for ${processId.substring(0, 8)} → ${link.substring(0, 60)}`);
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

        await prisma.biddingProcess.update({
            where: { id: processId },
            data: { link: canonicalUrl },
        });

        console.log(`[Worker M2A] Link updated for ${processId.substring(0, 8)} → certame/${certameId}`);
        res.json({ success: true, updated: true, newLink: canonicalUrl });
    } catch (error: any) {
        console.error('[Worker Link] Error updating link:', error.message);
        res.status(500).json({ error: 'Failed to update process link', details: error.message });
    }
});

// ── Purge chat monitor logs for a specific process (admin cleanup) ──
// Used to clean up data from incorrect certame matches or test data.
app.delete('/api/chat-monitor/internal/sessions/:processId/logs', authenticateWorker, async (req: any, res) => {
    try {
        const { processId } = req.params;
        const result = await prisma.chatMonitorLog.deleteMany({
            where: { biddingProcessId: processId },
        });
        console.log(`[Admin] Purged ${result.count} chat logs for process ${processId.substring(0, 8)}`);
        res.json({ success: true, deletedCount: result.count });
    } catch (error: any) {
        console.error('[Admin] Error purging logs:', error.message);
        res.status(500).json({ error: 'Failed to purge logs', details: error.message });
    }
});

// Receives messages from local ComprasNet / BBMNet Watcher
app.post('/api/chat-monitor/ingest', authenticateToken, async (req: any, res) => {
    try {
        const { processId, messages } = req.body;
        const tenantId = req.user.tenantId;

        if (!processId || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'processId and messages[] required' });
        }

        // Verify process belongs to tenant
        const processRecord = await prisma.biddingProcess.findFirst({
            where: { id: processId, tenantId }
        });
        if (!processRecord) {
            return res.status(404).json({ error: 'Process not found or not yours' });
        }

        const result = await IngestService.ingestMessages(prisma, {
            processId, tenantId, messages, captureSource: 'local-watcher'
        });

        console.log(`[Ingest] ${result.created} msgs saved for process ${processId.substring(0, 8)}... (${result.alerts} alerts)`);
        res.json(result);
    } catch (error: any) {
        console.error('[Ingest] Error:', error.message);
        res.status(500).json({ error: 'Failed to ingest messages', details: error.message });
    }
});

// ── Serve Frontend in Production ──
if (process.env.NODE_ENV === 'production') {
    const publicDir = path.join(SERVER_ROOT, 'public');
    app.use(express.static(publicDir));
    // SPA fallback: send index.html for any non-API route
    app.use((req, res) => {
        if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
            const publicDir = path.join(SERVER_ROOT, 'public');
            res.sendFile(path.join(publicDir, 'index.html'));
        } else if (req.path.startsWith('/uploads')) {
            res.status(404).json({
                error: 'Arquivo não encontrado',
                message: 'O documento solicitado não existe fisicamente no servidor. Como o sistema está no Railway sem volumes persistentes, arquivos são apagados a cada nova atualização/redeploy.',
                path: req.path
            });
        } else {
            res.status(404).json({ error: 'Rota não encontrada', path: req.path });
        }
    });
}

// Start server
// Função de Auto-Setup para o primeiro acesso e Recuperação de Dados
async function runAutoSetup() {
    try {
        console.log('🔍 Verificando integridade dos dados e tenants...');

        // 1. Garantir que o Tenant Padrão existe (usando rootCnpj como chave estável)
        let tenant = await prisma.tenant.findUnique({
            where: { rootCnpj: '00000000' }
        });

        if (!tenant) {
            console.log('🏗️ Criando Tenant Principal...');
            tenant = await prisma.tenant.create({
                data: {
                    razaoSocial: 'LicitaSaaS Brasil',
                    rootCnpj: '00000000'
                }
            });
        }

        // 2. Garantir que o Usuário Admin existe
        const adminEmail = 'admin@licitasaas.com';
        const admin = await prisma.user.findUnique({
            where: { email: adminEmail }
        });

        if (!admin) {
            console.log('🏗️ Criando Usuário Administrador...');
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash('admin123', salt);
            await prisma.user.create({
                data: {
                    email: adminEmail,
                    name: 'Administrador',
                    passwordHash,
                    role: 'ADMIN',
                    tenantId: tenant.id
                }
            });
        } else if (admin.tenantId !== tenant.id) {
            console.log('🏗️ Atualizando Tenant do Administrador para o ID estável...');
            await prisma.user.update({
                where: { email: adminEmail },
                data: { tenantId: tenant.id }
            });
        }

        // Removing bad "Modulo de Restauracao" that was moving data to other users
    } catch (error) {
        console.error('❌ Erro no runAutoSetup:', error);
    }
}

// Helpers
async function fetchPdfPartsForProcess(biddingProcessId: string | null, fileNamesRaw: string[], tenantId: string): Promise<any[]> {
    const pdfParts: any[] = [];
    const biddingLinks = biddingProcessId ? (await prisma.biddingProcess.findUnique({ where: { id: biddingProcessId } }))?.link || "" : "";

    for (let fileName of fileNamesRaw) {
        fileName = decodeURIComponent(fileName).split('?')[0];
        const doc = await prisma.document.findFirst({
            where: {
                fileUrl: { contains: fileName },
                tenantId: tenantId
            }
        });
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
// ══════════════════════════════════════════════════════════════════
//  Sprint 7 — Governance API Endpoints
// ══════════════════════════════════════════════════════════════════

// POST /api/ai/feedback — Submit structured feedback
app.post('/api/ai/feedback', authenticateToken, async (req: any, res: any) => {
    try {
        const feedback = submitFeedback(req.body as AIExecutionFeedback);
        res.json({ success: true, feedbackId: feedback.feedbackId });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ai/feedback/:moduleName — Get feedback by module
app.get('/api/ai/feedback/:moduleName', authenticateToken, async (req: any, res: any) => {
    try {
        const items = getFeedbackByModule(req.params.moduleName);
        const stats = getFeedbackStats(req.params.moduleName);
        res.json({ items, stats });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ai/metrics — System operational report
app.get('/api/ai/metrics', authenticateToken, async (_req: any, res: any) => {
    try {
        const report = generateSystemReport(30);
        res.json(report);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ai/versions — Version catalog
app.get('/api/ai/versions', authenticateToken, async (_req: any, res: any) => {
    try {
        const versions = getAllVersions();
        const promotions = getPromotionHistory();
        res.json({ versions, promotions });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ai/insights — Improvement insights
app.get('/api/ai/insights', authenticateToken, async (_req: any, res: any) => {
    try {
        const report = generateImprovementInsights(30);
        res.json(report);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/ai/golden-cases/convert — Convert feedback to golden cases
app.post('/api/ai/golden-cases/convert', authenticateToken, async (_req: any, res: any) => {
    try {
        const converted = convertFeedbackToGoldenCases();
        res.json({ success: true, converted: converted.length, cases: converted });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ══════════════════════════════════════════════════════════════════
//  Sprint 8 — Strategic Company API Endpoints
// ══════════════════════════════════════════════════════════════════

// POST /api/company/profile — Create or update company profile
app.post('/api/company/profile', authenticateToken, async (req: any, res: any) => {
    try {
        const profile = await createOrUpdateProfile(req.body as CompanyLicitationProfile);
        res.json({ success: true, companyId: profile.companyId });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/company/profiles — List all company profiles
app.get('/api/company/profiles', authenticateToken, async (_req: any, res: any) => {
    try {
        res.json(await getAllProfiles());
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/company/:companyId — Get company profile
app.get('/api/company/:companyId', authenticateToken, async (req: any, res: any) => {
    try {
        const profile = await getProfile(req.params.companyId);
        if (!profile) return res.status(404).json({ error: 'Company not found' });
        res.json(profile);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/strategy/analyze — Full strategic analysis: match + score + action plan
app.post('/api/strategy/analyze', authenticateToken, aiLimiter, async (req: any, res: any) => {
    try {
        const { companyId, biddingProcessId } = req.body;
        if (!companyId || !biddingProcessId) {
            return res.status(400).json({ error: 'companyId and biddingProcessId are required' });
        }

        const bidding = await prisma.biddingProcess.findUnique({
            where: { id: biddingProcessId },
            include: { aiAnalysis: true }
        });

        if (!bidding?.aiAnalysis?.schemaV2) {
            return res.status(404).json({ error: 'Bidding process or schemaV2 not found' });
        }

        const schemaV2 = bidding.aiAnalysis.schemaV2;
        const matchResult = await matchCompanyToEdital(companyId, schemaV2, biddingProcessId);
        const assessment = calculateParticipationScore(matchResult, schemaV2);
        const actionPlan = generateActionPlan(matchResult, assessment, schemaV2);

        // Record for learning
        await recordMatchHistory(companyId, biddingProcessId, {
            doc: matchResult.documentaryFit.score,
            tech: matchResult.technicalFit.score,
            ef: matchResult.economicFinancialFit.score,
            prop: matchResult.proposalFit.score,
            overall: assessment.overallScore
        }, assessment.recommendation);

        res.json({ matchResult, assessment, actionPlan });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/company/:companyId/insights — Company learning insights
app.get('/api/company/:companyId/insights', authenticateToken, async (req: any, res: any) => {
    try {
        const report = await generateCompanyInsights(req.params.companyId);
        res.json(report);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ── Global Error Handler (must be LAST middleware before listen) ──
app.use(globalErrorHandler as any);

app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT} (mode: ${process.env.NODE_ENV || 'development'})`);
    console.log(`Upload directory: ${uploadDir}`);
    await runAutoSetup();

    // Initialize version catalog
    registerInitialVersions();
    console.log(`[Governance] Version catalog initialized with ${getAllVersions().length} components`);
    
    // PNCP Monitor disabled — ComprasNet Watcher handles all chat monitoring
    // pncpMonitor.startPolling(5);

    // ── System Health Watchdog: check every 5 minutes ──
    if (ADMIN_TELEGRAM_CHAT_ID) {
        setTimeout(() => {
            console.log('[Watchdog] 🐕 System health watchdog started (interval: 5 min)');
            setInterval(runWatchdogCheck, 5 * 60_000);
        }, 3 * 60_000); // Start 3 min after boot (give pollers time to initialize)
    } else {
        console.log('[Watchdog] ⚠️ ADMIN_TELEGRAM_CHAT_ID not set — watchdog disabled');
    }

    // ── Background Workers (only run when PROCESS_ROLE is 'all' or 'worker') ──
    if (PROCESS_ROLE === 'api') {
        console.log('[Server] PROCESS_ROLE=api — background pollers disabled (running in separate worker process)');
    } else {

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
                console.log('[Backfill] All processes already have ComprasNet links or no PNCP links found.');
                return;
            }

            console.log(`[Backfill] Found ${processes.length} processes with PNCP links missing ComprasNet. Fetching...`);
            let updated = 0;

            for (const proc of processes) {
                try {
                    // Extract CNPJ/ANO/SEQ from PNCP link
                    const match = (proc.link || '').match(/editais\/(\d+)\/(\d+)\/(\d+)/);
                    if (!match) continue;

                    const [, cnpj, ano, seq] = match;
                    const apiUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
                    const res = await fetch(apiUrl);
                    if (!res.ok) continue;

                    const data = await res.json();
                    const comprasNetLink = data.linkSistemaOrigem;

                    if (comprasNetLink && (comprasNetLink.includes('cnetmobile') || comprasNetLink.includes('comprasnet'))) {
                        const newLink = `${proc.link}, ${comprasNetLink}`;
                        await prisma.biddingProcess.update({
                            where: { id: proc.id },
                            data: {
                                link: newLink,
                                isMonitored: true  // Auto-enable since we now have ComprasNet data
                            }
                        });
                        updated++;
                        console.log(`[Backfill] ✅ Updated process ${proc.id.slice(0, 8)} with ComprasNet link`);
                    }

                    // Rate limit: 500ms between API calls to avoid hammering PNCP
                    await new Promise(r => setTimeout(r, 500));
                } catch (e) {
                    // Skip individual failures silently
                }
            }

            console.log(`[Backfill] Done. Updated ${updated}/${processes.length} processes with ComprasNet links.`);
        } catch (e) {
            console.error('[Backfill] Error:', e);
        }
    })();

    // ══════════════════════════════════════════════════════════════
    // ── Batch Platforms (BLL + BNC): Polling via API REST ──
    // ══════════════════════════════════════════════════════════════
    const BATCH_POLL_INTERVAL_MS = 60_000; // 60 segundos

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

            if (batchProcesses.length === 0) return;

            let totalNew = 0;
            let totalAlerts = 0;

            for (const proc of batchProcesses) {
                try {
                    if (!proc.link) continue;

                    // 2. Detectar qual plataforma (BLL ou BNC)
                    const platform = BatchPlatformMonitor.detectPlatform(proc.link);
                    if (!platform) continue;

                    // 3. Extrair param1 da URL
                    const param1 = BatchPlatformMonitor.extractParam1(proc.link);
                    if (!param1) continue;

                    // 4. Buscar mensagens via API REST e HTML (processo + lotes)
                    const messages = await BatchPlatformMonitor.fetchAllMessages(param1, platform);
                    if (messages.length === 0) continue;

                    // 5. Ingerir via IngestService (dedup + keyword + notificação)
                    const result = await IngestService.ingestMessages(prisma, {
                        processId: proc.id,
                        tenantId: proc.tenantId,
                        messages: messages.map((m: any) => ({
                            messageId: m.messageId,
                            content: m.content,
                            authorType: m.authorType,
                            timestamp: m.timestamp || null,
                            itemRef: m.itemRef || null,
                        })),
                        captureSource: platform.captureSource,
                    });

                    if (result.created > 0) {
                        console.log(`[${platform.label} Poll] 📨 ${result.created} nova(s) msg(s) para ${proc.title?.substring(0, 40)} (${result.alerts} alertas)`);
                        totalNew += result.created;
                        totalAlerts += result.alerts;
                    }

                    // Gentil com a API: 1s entre processos
                    await new Promise(r => setTimeout(r, 1000));
                } catch (err: any) {
                    console.warn(`[Batch Poll] Erro no processo ${proc.id.substring(0, 8)}:`, err.message);
                }
            }

            if (totalNew > 0) {
                console.log(`[Batch Poll] ✅ Ciclo: ${totalNew} mensagens novas, ${totalAlerts} alertas de ${batchProcesses.length} processos`);
            }
            pollerLastSuccess.set('BLL+BNC', new Date());
        } catch (error: any) {
            console.error('[Batch Poll] Erro no ciclo:', error.message);
        }
    }

    // Iniciar polling com delay de 30s para não sobrecarregar startup
    setTimeout(() => {
        console.log(`[Batch Poll] 🚀 Monitor BLL+BNC iniciado (intervalo: ${BATCH_POLL_INTERVAL_MS / 1000}s)`);
        pollBatchProcesses();
        setInterval(pollBatchProcesses, BATCH_POLL_INTERVAL_MS);
    }, 30_000);

    // ══════════════════════════════════════════════════════════════
    // ── Portal de Compras Públicas (PCP): Polling via HTML SSR ──
    // ══════════════════════════════════════════════════════════════
    const PCP_POLL_INTERVAL_MS = 90_000; // 90 segundos (mais gentil — HTML é pesado)

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

            if (pcpProcesses.length === 0) return;

            let totalNew = 0;
            let totalAlerts = 0;

            for (const proc of pcpProcesses) {
                try {
                    if (!proc.link) continue;

                    // 2. Extrair a URL do PCP
                    const pcpUrl = PCPMonitor.extractPCPUrl(proc.link);
                    if (!pcpUrl) continue;

                    // 3. Buscar mensagens via scraping do HTML SSR
                    const messages = await PCPMonitor.fetchMessages(pcpUrl);
                    if (messages.length === 0) continue;

                    // 4. Ingerir via IngestService (com eventCategory e itemRef)
                    const result = await IngestService.ingestMessages(prisma, {
                        processId: proc.id,
                        tenantId: proc.tenantId,
                        messages: messages.map((m: any) => ({
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
                        console.log(`[PCP Poll] 📨 ${result.created} nova(s) msg(s) para ${proc.title?.substring(0, 40)} (${result.alerts} alertas)`);
                        totalNew += result.created;
                        totalAlerts += result.alerts;
                    }

                    // Gentil com o servidor: 2s entre processos (HTML é mais pesado)
                    await new Promise(r => setTimeout(r, 2000));
                } catch (err: any) {
                    console.warn(`[PCP Poll] Erro no processo ${proc.id.substring(0, 8)}:`, err.message);
                }
            }

            if (totalNew > 0) {
                console.log(`[PCP Poll] ✅ Ciclo: ${totalNew} mensagens novas, ${totalAlerts} alertas de ${pcpProcesses.length} processos`);
            }
            pollerLastSuccess.set('PCP', new Date());
        } catch (error: any) {
            console.error('[PCP Poll] Erro no ciclo:', error.message);
        }
    }

    // Iniciar polling PCP com delay de 45s (após BLL+BNC)
    setTimeout(() => {
        console.log(`[PCP Poll] 🚀 Monitor Portal de Compras Públicas iniciado (intervalo: ${PCP_POLL_INTERVAL_MS / 1000}s)`);
        pollPCPProcesses();
        setInterval(pollPCPProcesses, PCP_POLL_INTERVAL_MS);
    }, 45_000);

    // ══════════════════════════════════════════════════════════════
    // ── Licitanet: Polling via API REST JSON pública ──
    // ══════════════════════════════════════════════════════════════
    const LICITANET_POLL_INTERVAL_MS = 90_000; // 90 segundos

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

            if (licitanetProcesses.length === 0) return;

            let totalNew = 0;
            let totalAlerts = 0;

            for (const proc of licitanetProcesses) {
                try {
                    if (!proc.link) continue;

                    // 2. Extrair a URL da Licitanet
                    const licitanetUrl = LicitanetMonitor.extractLicitanetUrl(proc.link);
                    if (!licitanetUrl) continue;

                    // 3. Buscar mensagens via API REST JSON
                    const messages = await LicitanetMonitor.fetchMessages(licitanetUrl);
                    if (messages.length === 0) continue;

                    // 4. Ingerir via IngestService (com eventCategory e itemRef)
                    const result = await IngestService.ingestMessages(prisma, {
                        processId: proc.id,
                        tenantId: proc.tenantId,
                        messages: messages.map((m: any) => ({
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
                        console.log(`[Licitanet Poll] 📨 ${result.created} nova(s) msg(s) para ${proc.title?.substring(0, 40)} (${result.alerts} alertas)`);
                        totalNew += result.created;
                        totalAlerts += result.alerts;
                    }

                    // Gentil com o servidor: 1s entre processos (API JSON é leve)
                    await new Promise(r => setTimeout(r, 1000));
                } catch (err: any) {
                    console.warn(`[Licitanet Poll] Erro no processo ${proc.id.substring(0, 8)}:`, err.message);
                }
            }

            if (totalNew > 0) {
                console.log(`[Licitanet Poll] ✅ Ciclo: ${totalNew} mensagens novas, ${totalAlerts} alertas de ${licitanetProcesses.length} processos`);
            }
            pollerLastSuccess.set('Licitanet', new Date());
        } catch (error: any) {
            console.error('[Licitanet Poll] Erro no ciclo:', error.message);
        }
    }

    // Iniciar polling Licitanet com delay de 60s (após PCP)
    setTimeout(() => {
        console.log(`[Licitanet Poll] 🚀 Monitor Licitanet iniciado (intervalo: ${LICITANET_POLL_INTERVAL_MS / 1000}s)`);
        pollLicitanetProcesses();
        setInterval(pollLicitanetProcesses, LICITANET_POLL_INTERVAL_MS);
    }, 60_000);

    // ══════════════════════════════════════════════════════════════
    // ── Licita Mais Brasil: Polling via API REST JSON autenticada ──
    // ══════════════════════════════════════════════════════════════
    const LMB_POLL_INTERVAL_MS = 90_000; // 90 segundos

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

            if (lmbProcesses.length === 0) return;

            let totalNew = 0;
            let totalAlerts = 0;

            for (const proc of lmbProcesses) {
                try {
                    if (!proc.link) continue;

                    // 2. Extrair a URL da Licita Mais Brasil
                    const lmbUrl = LicitaMaisBrasilMonitor.extractLMBUrl(proc.link);
                    if (!lmbUrl) continue;

                    // 3. Buscar mensagens via API REST autenticada
                    const messages = await LicitaMaisBrasilMonitor.fetchMessages(lmbUrl);
                    if (messages.length === 0) continue;

                    // 4. Ingerir via IngestService (com eventCategory e itemRef)
                    const result = await IngestService.ingestMessages(prisma, {
                        processId: proc.id,
                        tenantId: proc.tenantId,
                        messages: messages.map((m: any) => ({
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
                        console.log(`[LMB Poll] 📨 ${result.created} nova(s) msg(s) para ${proc.title?.substring(0, 40)} (${result.alerts} alertas)`);
                        totalNew += result.created;
                        totalAlerts += result.alerts;
                    }

                    // Gentil com o servidor: 1.5s entre processos (API autenticada)
                    await new Promise(r => setTimeout(r, 1500));
                } catch (err: any) {
                    console.warn(`[LMB Poll] Erro no processo ${proc.id.substring(0, 8)}:`, err.message);
                }
            }

            if (totalNew > 0) {
                console.log(`[LMB Poll] ✅ Ciclo: ${totalNew} mensagens novas, ${totalAlerts} alertas de ${lmbProcesses.length} processos`);
            }
            pollerLastSuccess.set('LMB', new Date());
        } catch (error: any) {
            console.error('[LMB Poll] Erro no ciclo:', error.message);
        }
    }

    // Iniciar polling LMB com delay de 75s (após Licitanet)
    setTimeout(() => {
        console.log(`[LMB Poll] 🚀 Monitor Licita Mais Brasil iniciado (intervalo: ${LMB_POLL_INTERVAL_MS / 1000}s)`);
        pollLMBProcesses();
        setInterval(pollLMBProcesses, LMB_POLL_INTERVAL_MS);
    }, 75_000);

    } // end of PROCESS_ROLE !== 'api' block
});

// ── Opportunity Scanner: Auto-scan saved PNCP searches every 4 hours ──
if (PROCESS_ROLE !== 'api') {
    startOpportunityScanner(4);
} else {
    console.log('[Server] Opportunity Scanner disabled (PROCESS_ROLE=api)');
}

// Keep event loop alive (required in this environment)
setInterval(() => { }, 1 << 30);

