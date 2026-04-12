import express from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { authenticateToken, requireAdmin, requireSuperAdmin } from '../middlewares/auth';
import { handleApiError } from '../middlewares/errorHandler';
import { getPipelineHealth } from '../services/ai/telemetry/analysisTelemetry';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// GESTÃO DE TENANTS & ONBOARDING (Admin-only)
// ═══════════════════════════════════════════════════════════════

// List all tenants with user count (super-admin)
router.get('/tenants', authenticateToken, requireSuperAdmin, async (req: any, res) => {
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
        logger.error('[Admin] Erro ao listar tenants:', error?.message);
        res.status(500).json({ error: 'Erro ao listar organizações' });
    }
});

// Legacy: Create tenant (now protected)
// Needs to be at the root of admin router or handled gracefully since original was /api/tenants, not /api/admin/tenants.
// Note: original was app.post('/api/tenants', ...). Let's mount this carefully.
// If we mount the router at /api/admin, then this will be /api/admin/tenants.
// I will keep the original path in index.ts for /api/tenants or rewrite it here. Let's map it here as POST /tenants
router.post('/tenants', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
        const tenant = await prisma.tenant.create({ data: req.body });
        res.json(tenant);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create tenant' });
    }
});

// Audit Log List (Admin-only)
router.get('/audit-logs', authenticateToken, requireAdmin, async (req: any, res) => {
    try {
        const { AuditLogService } = await import('../services/auditLog.service');
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;
        
        const result = await AuditLogService.getLogs(req.user.tenantId, limit, offset);
        res.json(result);
    } catch (error: any) {
        logger.error('[AuditLog] Erro ao buscar logs:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico de auditoria' });
    }
});

// Onboard new client — creates Tenant + Admin User in one step
router.post('/onboard', authenticateToken, requireSuperAdmin, async (req: any, res) => {
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

        logger.info(`[Onboard] ✅ Novo cliente: "${razaoSocial}" (${rootCnpj}) → Admin: ${adminEmail}`);

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
        logger.error('[Onboard] Erro ao provisionar cliente:', error?.message);
        res.status(500).json({ error: 'Erro ao provisionar novo cliente' });
    }
});

// ═══════════════════════════════════════════════════════════════
// GESTÃO DE COTAS DE IA (Admin-only)
// ═══════════════════════════════════════════════════════════════

router.get('/ai-quotas', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
        const { getTenantQuotaLimits } = await import('../lib/aiUsageTracker');

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
        logger.error('[Admin] Erro ao listar cotas de IA:', error?.message);
        res.status(500).json({ error: 'Erro ao listar cotas de IA' });
    }
});

router.put('/ai-quotas/:tenantId', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
        const { tenantId } = req.params;
        const { hardLimit, softLimit } = req.body;
        const { invalidateTenantQuotaCache } = await import('../lib/aiUsageTracker');

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
        logger.info(`[Admin] Cotas de IA atualizadas para "${tenant?.razaoSocial || tenantId}": hard=${hardLimit}, soft=${conf.aiQuota.softLimit}`);

        res.json({ ok: true, aiQuota: conf.aiQuota });
    } catch (error: any) {
        logger.error('[Admin] Erro ao atualizar cota de IA:', error?.message);
        res.status(500).json({ error: 'Erro ao atualizar cota de IA' });
    }
});

router.post('/ai-quotas/:tenantId/reset', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
        const { tenantId } = req.params;
        const { invalidateTenantQuotaCache } = await import('../lib/aiUsageTracker');
        invalidateTenantQuotaCache(tenantId);
        logger.info(`[Admin] Cache de cota de IA resetado para tenant ${tenantId}`);
        res.json({ ok: true, message: 'Cache limpo. Limites serão reavaliados na próxima chamada de IA.' });
    } catch (error: any) {
        res.status(500).json({ error: 'Erro ao resetar cache' });
    }
});

router.get('/ai-usage/:tenantId', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
        const { tenantId } = req.params;
        const periodDays = parseInt(req.query.period as string) || 30;
        const { getDailyBreakdown, getQuotaStatus, getUsageSummary } = await import('../lib/aiUsageTracker');

        const [summary, daily, quota] = await Promise.all([
            getUsageSummary(prisma, tenantId, periodDays),
            getDailyBreakdown(prisma, tenantId, periodDays),
            getQuotaStatus(prisma, tenantId),
        ]);

        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { razaoSocial: true, rootCnpj: true } });

        res.json({ ok: true, tenant, ...summary, daily, quota });
    } catch (e: any) {
        logger.error('[Admin] AI usage drill-down error:', e?.message);
        res.status(500).json({ error: 'Falha ao buscar consumo de IA do tenant.' });
    }
});

// ── Pipeline Health Dashboard (Telemetry) ──
router.get('/pipeline-health', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
        const days = parseInt(req.query.days || '7');
        const health = await getPipelineHealth(days);
        res.json({ ok: true, ...health });
    } catch (e: any) {
        logger.error('[Admin] Pipeline health error:', e?.message);
        res.status(500).json({ error: 'Falha ao buscar métricas do pipeline.' });
    }
});

// ── Golden Dataset Snapshot Capture ──
router.get('/capture-golden/:processId', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
        const { processId } = req.params;
        const analysis = await prisma.aiAnalysis.findFirst({
            where: { biddingProcessId: processId },
            select: { schemaV2: true, modelUsed: true, promptVersion: true, pipelineDurationS: true, overallConfidence: true, analyzedAt: true },
        });
        if (!analysis || !analysis.schemaV2) {
            return res.status(404).json({ error: 'Análise não encontrada ou sem schemaV2.' });
        }
        const process = await prisma.biddingProcess.findUnique({
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
    } catch (e: any) {
        logger.error('[Admin] Capture golden error:', e?.message);
        res.status(500).json({ error: 'Falha ao capturar snapshot.' });
    }
});

// ── Golden Dataset: Search processes by title (to find processId) ──
router.get('/golden-search', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
        const q = (req.query.q || '').toString().trim();
        if (!q || q.length < 3) {
            return res.status(400).json({ error: 'Busca precisa de pelo menos 3 caracteres. Use ?q=macau' });
        }
        const processes = await prisma.biddingProcess.findMany({
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
    } catch (e: any) {
        logger.error('[Admin] Golden search error:', e?.message);
        res.status(500).json({ error: 'Falha na busca.' });
    }
});

// GET /api/admin/health — Healthcheck for background workers
router.get('/health', authenticateToken, async (req: any, res: any) => {
    try {
        if (req.user.role !== 'Admin' && req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        
        const queuedJobs = await prisma.backgroundJob.count({ where: { status: 'QUEUED' } });
        const runningJobs = await prisma.backgroundJob.count({ where: { status: 'PROCESSING' } });
        const errorJobs = await prisma.backgroundJob.count({ 
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
    } catch (err: any) {
        handleApiError(res, err, 'healthcheck');
    }
});

export default router;
