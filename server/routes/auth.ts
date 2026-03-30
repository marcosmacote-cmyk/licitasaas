import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { authLimiter } from '../lib/security';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

// Login route
router.post('/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await prisma.user.findUnique({
            where: { email },
            include: { tenant: true }
        });

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: 'Email ou senha inválidos' });
        }
        if (!user.isActive) {
            return res.status(403).json({ error: 'Acesso bloqueado. Esta conta foi desativada pelo administrador.' });
        }

        const token = jwt.sign(
            { userId: user.id, tenantId: user.tenantId, role: user.role },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                tenantId: user.tenantId,
                tenantName: user.tenant.razaoSocial
            }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: 'Erro interno ao realizar login' });
    }
});

// Generate long-lived worker token (for ComprasNet/BBMNET watchers)
// Auth: requires CHAT_WORKER_SECRET or valid admin credentials
router.post('/worker-token', authLimiter, async (req, res) => {
    try {
        const { email, password, workerSecret, tenantId: requestedTenantId, label } = req.body;
        const WORKER_SECRET = process.env.CHAT_WORKER_SECRET || '';

        let userId: string;
        let tenantId: string;
        let role: string;

        // Auth method 1: Worker Secret + tenantId
        if (workerSecret && requestedTenantId) {
            if (!WORKER_SECRET || workerSecret !== WORKER_SECRET) {
                return res.status(403).json({ error: 'Worker secret inválido' });
            }
            // Find an ADMIN user for the given tenant
            const adminUser = await prisma.user.findFirst({
                where: { tenantId: requestedTenantId, role: 'ADMIN', isActive: true }
            });
            if (!adminUser) {
                return res.status(404).json({ error: 'Nenhum admin encontrado para o tenant informado' });
            }
            userId = adminUser.id;
            tenantId = adminUser.tenantId;
            role = adminUser.role;
        }
        // Auth method 2: Admin login credentials
        else if (email && password) {
            const user = await prisma.user.findUnique({ where: { email } });
            if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
                return res.status(401).json({ error: 'Email ou senha inválidos' });
            }
            if (!user.isActive) {
                return res.status(403).json({ error: 'Conta desativada' });
            }
            if (user.role !== 'ADMIN') {
                return res.status(403).json({ error: 'Apenas ADMIN pode gerar worker tokens' });
            }
            userId = user.id;
            tenantId = user.tenantId;
            role = user.role;
        } else {
            return res.status(400).json({ error: 'Forneça {workerSecret, tenantId} ou {email, password}' });
        }

        const token = jwt.sign(
            { userId, tenantId, role, purpose: 'worker', label: label || 'generic-worker' },
            JWT_SECRET,
            { expiresIn: '365d' }
        );

        console.log(`[WorkerToken] Generated for tenant ${tenantId}, label: ${label || 'generic-worker'}`);
        res.json({
            token,
            expiresIn: '365 days',
            tenantId,
            label: label || 'generic-worker',
        });
    } catch (error: any) {
        console.error('[WorkerToken] Error:', error?.message || error);
        res.status(500).json({ error: 'Erro ao gerar worker token' });
    }
});

export default router;
