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
const express_1 = __importDefault(require("express"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../lib/logger");
const auth_1 = require("../middlewares/auth");
const errorHandler_1 = require("../middlewares/errorHandler");
const analysisTelemetry_1 = require("../services/ai/telemetry/analysisTelemetry");
const router = express_1.default.Router();
// ═══════════════════════════════════════════════════════════════
// GESTÃO DE TENANTS & ONBOARDING (Admin-only)
// ═══════════════════════════════════════════════════════════════
// List all tenants with user count (super-admin)
router.get('/tenants', auth_1.authenticateToken, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const tenants = await prisma_1.prisma.tenant.findMany({
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
    }
    catch (error) {
        logger_1.logger.error('[Admin] Erro ao listar tenants:', error?.message);
        res.status(500).json({ error: 'Erro ao listar organizações' });
    }
});
// Legacy: Create tenant (now protected)
// Needs to be at the root of admin router or handled gracefully since original was /api/tenants, not /api/admin/tenants.
// Note: original was app.post('/api/tenants', ...). Let's mount this carefully.
// If we mount the router at /api/admin, then this will be /api/admin/tenants.
// I will keep the original path in index.ts for /api/tenants or rewrite it here. Let's map it here as POST /tenants
router.post('/tenants', auth_1.authenticateToken, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const tenant = await prisma_1.prisma.tenant.create({ data: req.body });
        res.json(tenant);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to create tenant' });
    }
});
// Audit Log List (Admin-only)
router.get('/audit-logs', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    try {
        const { AuditLogService } = await Promise.resolve().then(() => __importStar(require('../services/auditLog.service')));
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;
        const result = await AuditLogService.getLogs(req.user.tenantId, limit, offset);
        res.json(result);
    }
    catch (error) {
        logger_1.logger.error('[AuditLog] Erro ao buscar logs:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico de auditoria' });
    }
});
// Onboard new client — creates Tenant + Admin User in one step
router.post('/onboard', auth_1.authenticateToken, auth_1.requireSuperAdmin, async (req, res) => {
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
        const existingTenant = await prisma_1.prisma.tenant.findUnique({ where: { rootCnpj } });
        if (existingTenant) {
            return res.status(409).json({ error: `Já existe uma organização com CNPJ ${rootCnpj}` });
        }
        const existingUser = await prisma_1.prisma.user.findUnique({ where: { email: adminEmail } });
        if (existingUser) {
            return res.status(409).json({ error: `O e-mail ${adminEmail} já está em uso` });
        }
        // ── Criar Tenant + Admin em transação ──
        const result = await prisma_1.prisma.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({
                data: { razaoSocial, rootCnpj }
            });
            const passwordHash = await bcryptjs_1.default.hash(adminPassword, 10);
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
        logger_1.logger.info(`[Onboard] ✅ Novo cliente: "${razaoSocial}" (${rootCnpj}) → Admin: ${adminEmail}`);
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
    }
    catch (error) {
        logger_1.logger.error('[Onboard] Erro ao provisionar cliente:', error?.message);
        res.status(500).json({ error: 'Erro ao provisionar novo cliente' });
    }
});
// ═══════════════════════════════════════════════════════════════
// GESTÃO DE COTAS DE IA (Admin-only)
// ═══════════════════════════════════════════════════════════════
router.get('/ai-quotas', auth_1.authenticateToken, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const { getTenantQuotaLimits } = await Promise.resolve().then(() => __importStar(require('../lib/aiUsageTracker')));
        const tenants = await prisma_1.prisma.tenant.findMany({
            select: { id: true, razaoSocial: true, rootCnpj: true },
            orderBy: { razaoSocial: 'asc' },
        });
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        // Aggregate usage per tenant in one query
        const usageByTenant = await prisma_1.prisma.aiUsageLog.groupBy({
            by: ['tenantId'],
            where: { createdAt: { gte: startOfMonth } },
            _sum: { totalTokens: true, inputTokens: true, outputTokens: true },
            _count: { id: true },
        });
        const usageMap = new Map(usageByTenant.map((u) => [u.tenantId, u]));
        const result = await Promise.all(tenants.map(async (t) => {
            const usage = usageMap.get(t.id);
            const { hardLimit, softLimit } = await getTenantQuotaLimits(prisma_1.prisma, t.id);
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
    }
    catch (error) {
        logger_1.logger.error('[Admin] Erro ao listar cotas de IA:', error?.message);
        res.status(500).json({ error: 'Erro ao listar cotas de IA' });
    }
});
router.put('/ai-quotas/:tenantId', auth_1.authenticateToken, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { hardLimit, softLimit } = req.body;
        const { invalidateTenantQuotaCache } = await Promise.resolve().then(() => __importStar(require('../lib/aiUsageTracker')));
        if (!hardLimit || hardLimit < 0) {
            return res.status(400).json({ error: 'hardLimit é obrigatório e deve ser positivo.' });
        }
        // Read or create GlobalConfig
        const gc = await prisma_1.prisma.globalConfig.upsert({
            where: { tenantId },
            create: { tenantId, config: JSON.stringify({ aiQuota: { hardLimit, softLimit: softLimit || Math.round(hardLimit * 0.75) } }) },
            update: {},
        });
        // Merge aiQuota into existing config
        let conf = {};
        try {
            conf = JSON.parse(gc.config || '{}');
        }
        catch { }
        conf.aiQuota = {
            hardLimit,
            softLimit: softLimit || Math.round(hardLimit * 0.75),
        };
        await prisma_1.prisma.globalConfig.update({
            where: { tenantId },
            data: { config: JSON.stringify(conf) },
        });
        // Invalidate caches
        invalidateTenantQuotaCache(tenantId);
        const tenant = await prisma_1.prisma.tenant.findUnique({ where: { id: tenantId }, select: { razaoSocial: true } });
        logger_1.logger.info(`[Admin] Cotas de IA atualizadas para "${tenant?.razaoSocial || tenantId}": hard=${hardLimit}, soft=${conf.aiQuota.softLimit}`);
        res.json({ ok: true, aiQuota: conf.aiQuota });
    }
    catch (error) {
        logger_1.logger.error('[Admin] Erro ao atualizar cota de IA:', error?.message);
        res.status(500).json({ error: 'Erro ao atualizar cota de IA' });
    }
});
router.post('/ai-quotas/:tenantId/reset', auth_1.authenticateToken, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { invalidateTenantQuotaCache } = await Promise.resolve().then(() => __importStar(require('../lib/aiUsageTracker')));
        invalidateTenantQuotaCache(tenantId);
        logger_1.logger.info(`[Admin] Cache de cota de IA resetado para tenant ${tenantId}`);
        res.json({ ok: true, message: 'Cache limpo. Limites serão reavaliados na próxima chamada de IA.' });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao resetar cache' });
    }
});
router.get('/ai-usage/:tenantId', auth_1.authenticateToken, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const { tenantId } = req.params;
        const periodDays = parseInt(req.query.period) || 30;
        const { getDailyBreakdown, getQuotaStatus, getUsageSummary } = await Promise.resolve().then(() => __importStar(require('../lib/aiUsageTracker')));
        const [summary, daily, quota] = await Promise.all([
            getUsageSummary(prisma_1.prisma, tenantId, periodDays),
            getDailyBreakdown(prisma_1.prisma, tenantId, periodDays),
            getQuotaStatus(prisma_1.prisma, tenantId),
        ]);
        const tenant = await prisma_1.prisma.tenant.findUnique({ where: { id: tenantId }, select: { razaoSocial: true, rootCnpj: true } });
        res.json({ ok: true, tenant, ...summary, daily, quota });
    }
    catch (e) {
        logger_1.logger.error('[Admin] AI usage drill-down error:', e?.message);
        res.status(500).json({ error: 'Falha ao buscar consumo de IA do tenant.' });
    }
});
// ── Pipeline Health Dashboard (Telemetry) ──
router.get('/pipeline-health', auth_1.authenticateToken, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const days = parseInt(req.query.days || '7');
        const health = await (0, analysisTelemetry_1.getPipelineHealth)(days);
        res.json({ ok: true, ...health });
    }
    catch (e) {
        logger_1.logger.error('[Admin] Pipeline health error:', e?.message);
        res.status(500).json({ error: 'Falha ao buscar métricas do pipeline.' });
    }
});
// ── Golden Dataset Snapshot Capture ──
router.get('/capture-golden/:processId', auth_1.authenticateToken, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const { processId } = req.params;
        const analysis = await prisma_1.prisma.aiAnalysis.findFirst({
            where: { biddingProcessId: processId },
            select: { schemaV2: true, modelUsed: true, promptVersion: true, pipelineDurationS: true, overallConfidence: true, analyzedAt: true },
        });
        if (!analysis || !analysis.schemaV2) {
            return res.status(404).json({ error: 'Análise não encontrada ou sem schemaV2.' });
        }
        const process = await prisma_1.prisma.biddingProcess.findUnique({
            where: { id: processId },
            select: { title: true, modality: true, processNumber: true, estimatedValue: true, portal: true },
        });
        res.json({
            ok: true,
            snapshot: analysis.schemaV2,
            meta: {
                processId,
                process: process || {},
                modelUsed: analysis.modelUsed,
                promptVersion: analysis.promptVersion,
                pipelineDurationS: analysis.pipelineDurationS,
                overallConfidence: analysis.overallConfidence,
                analyzedAt: analysis.analyzedAt,
                capturedAt: new Date().toISOString(),
            },
            instructions: 'Save the "snapshot" field as golden/<id>.snapshot.json in the benchmark directory.',
        });
    }
    catch (e) {
        logger_1.logger.error('[Admin] Capture golden error:', e?.message);
        res.status(500).json({ error: 'Falha ao capturar snapshot.' });
    }
});
// ── Golden Dataset: Search processes by title (to find processId) ──
router.get('/golden-search', auth_1.authenticateToken, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const q = (req.query.q || '').toString().trim();
        if (!q || q.length < 3) {
            return res.status(400).json({ error: 'Busca precisa de pelo menos 3 caracteres. Use ?q=macau' });
        }
        const processes = await prisma_1.prisma.biddingProcess.findMany({
            where: {
                tenantId: req.user.tenantId,
                title: { contains: q, mode: 'insensitive' },
            },
            select: {
                id: true,
                title: true,
                portal: true,
                modality: true,
                estimatedValue: true,
                sessionDate: true,
                aiAnalysis: { select: { id: true, overallConfidence: true, analyzedAt: true } },
            },
            orderBy: { sessionDate: 'desc' },
            take: 10,
        });
        res.json({
            ok: true,
            query: q,
            found: processes.length,
            processes: processes.map(p => ({
                processId: p.id,
                title: p.title,
                portal: p.portal,
                modality: p.modality,
                estimatedValue: p.estimatedValue,
                sessionDate: p.sessionDate,
                hasAnalysis: !!p.aiAnalysis,
                analysisConfidence: p.aiAnalysis?.overallConfidence || null,
                captureUrl: p.aiAnalysis ? `/api/admin/capture-golden/${p.id}` : null,
            })),
        });
    }
    catch (e) {
        logger_1.logger.error('[Admin] Golden search error:', e?.message);
        res.status(500).json({ error: 'Falha na busca.' });
    }
});
// GET /api/admin/health — Healthcheck for background workers
router.get('/health', auth_1.authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'Admin' && req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        const queuedJobs = await prisma_1.prisma.backgroundJob.count({ where: { status: 'QUEUED' } });
        const runningJobs = await prisma_1.prisma.backgroundJob.count({ where: { status: 'PROCESSING' } });
        const errorJobs = await prisma_1.prisma.backgroundJob.count({
            where: {
                status: 'FAILED',
                createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            }
        });
        res.json({
            status: 'ok',
            worker: {
                active: true,
                queuedJobs,
                runningJobs,
                errorJobs24h: errorJobs
            },
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });
    }
    catch (err) {
        (0, errorHandler_1.handleApiError)(res, err, 'healthcheck');
    }
});
exports.default = router;
