"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const security_1 = require("../lib/security");
const auditLog_service_1 = require("../services/auditLog.service");
const constants_1 = require("../lib/constants");
const qrcode_1 = __importDefault(require("qrcode"));
const speakeasy_1 = __importDefault(require("speakeasy"));
const router = express_1.default.Router();
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://licitasaas.com';
// ── Sprint 5.1: 2FA & Session Verification ──
// Requires user to be authenticated first to edit their own 2FA
const auth_1 = require("../middlewares/auth");
// Login route
router.post('/login', security_1.authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await prisma_1.default.user.findUnique({
            where: { email },
            include: { tenant: true }
        });
        if (!user || !(await bcryptjs_1.default.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: 'Email ou senha inválidos' });
        }
        if (!user.isActive) {
            return res.status(403).json({ error: 'Acesso bloqueado. Esta conta foi desativada pelo administrador.' });
        }
        const token = jsonwebtoken_1.default.sign({ userId: user.id, tenantId: user.tenantId, role: user.role }, constants_1.JWT_SECRET, { expiresIn: '8h' });
        // Sprint 5: Create UserSession and AuditLog
        const sessionToken = crypto_1.default.randomBytes(32).toString('hex');
        await prisma_1.default.userSession.create({
            data: {
                userId: user.id,
                token: sessionToken,
                device: req.headers['user-agent']?.substring(0, 255),
                ipAddress: req.ip,
                expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000) // 8h
            }
        });
        await auditLog_service_1.AuditLogService.log({
            tenantId: user.tenantId,
            userId: user.id,
            action: 'USER_LOGIN',
            entityType: 'Auth',
            ipAddress: req.ip
        });
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
    }
    catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: 'Erro interno ao realizar login' });
    }
});
// Generate long-lived worker token (for ComprasNet/BBMNET watchers)
// Auth: requires CHAT_WORKER_SECRET or valid admin credentials
router.post('/worker-token', security_1.authLimiter, async (req, res) => {
    try {
        const { email, password, workerSecret, tenantId: requestedTenantId, label } = req.body;
        const WORKER_SECRET = process.env.CHAT_WORKER_SECRET || '';
        let userId;
        let tenantId;
        let role;
        // Auth method 1: Worker Secret + tenantId
        if (workerSecret && requestedTenantId) {
            if (!WORKER_SECRET || workerSecret !== WORKER_SECRET) {
                return res.status(403).json({ error: 'Worker secret inválido' });
            }
            // Find an ADMIN user for the given tenant
            const adminUser = await prisma_1.default.user.findFirst({
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
            const user = await prisma_1.default.user.findUnique({ where: { email } });
            if (!user || !(await bcryptjs_1.default.compare(password, user.passwordHash))) {
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
        }
        else {
            return res.status(400).json({ error: 'Forneça {workerSecret, tenantId} ou {email, password}' });
        }
        const token = jsonwebtoken_1.default.sign({ userId, tenantId, role, purpose: 'worker', label: label || 'generic-worker' }, constants_1.JWT_SECRET, { expiresIn: '365d' });
        console.log(`[WorkerToken] Generated for tenant ${tenantId}, label: ${label || 'generic-worker'}`);
        res.json({
            token,
            expiresIn: '365 days',
            tenantId,
            label: label || 'generic-worker',
        });
    }
    catch (error) {
        console.error('[WorkerToken] Error:', error?.message || error);
        res.status(500).json({ error: 'Erro ao gerar worker token' });
    }
});
// ══════════════════════════════════════════════════════════════════
//  SPRINT 5.1: AUTENTICAÇÃO AVANÇADA (2FA)
// ══════════════════════════════════════════════════════════════════
// 1. Initial login (returns temp token if 2fa enabled, or full token if not)
router.post('/login-v2', security_1.authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await prisma_1.default.user.findUnique({
            where: { email },
            include: { tenant: true }
        });
        if (!user || !(await bcryptjs_1.default.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: 'Email ou senha inválidos' });
        }
        if (!user.isActive) {
            return res.status(403).json({ error: 'Acesso bloqueado.' });
        }
        if (user.is2faEnabled) {
            // Return temporary token specifically for 2FA validation
            const tempToken = jsonwebtoken_1.default.sign({ userId: user.id, isPre2fa: true }, constants_1.JWT_SECRET, { expiresIn: '5m' });
            return res.json({ requires2fa: true, tempToken });
        }
        // Se não tiver 2FA, emite o token normal (Refresh token flow simplificado na V1)
        const token = jsonwebtoken_1.default.sign({ userId: user.id, tenantId: user.tenantId, role: user.role }, constants_1.JWT_SECRET, { expiresIn: '8h' });
        // Audit & Session
        const sessionToken = crypto_1.default.randomBytes(32).toString('hex');
        await prisma_1.default.userSession.create({
            data: {
                userId: user.id,
                token: sessionToken,
                device: req.headers['user-agent']?.substring(0, 255),
                ipAddress: req.ip,
                expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000)
            }
        });
        await auditLog_service_1.AuditLogService.log({ tenantId: user.tenantId, userId: user.id, action: 'LOGIN', entityType: 'Auth' });
        res.json({ token, user: { id: user.id, name: user.name, role: user.role, tenantId: user.tenantId } });
    }
    catch (e) {
        res.status(500).json({ error: 'Erro interno' });
    }
});
// 2. Setup 2FA (Returns QR Code for Google Auth)
router.post('/2fa/setup', auth_1.authenticateToken, async (req, res) => {
    try {
        // Gerar secret único para o usuário
        const secret = speakeasy_1.default.generateSecret({ name: `LicitaSaaS (${req.user.email})` });
        // Salvar provisoriamente no usuário (sem ativar ainda)
        await prisma_1.default.user.update({
            where: { id: req.user.userId },
            data: { totpSecret: secret.base32 }
        });
        // Gerar QR Code em base64
        const qrCodeUrl = await qrcode_1.default.toDataURL(secret.otpauth_url);
        // Audit Log
        await auditLog_service_1.AuditLogService.log({ tenantId: req.user.tenantId, userId: req.user.userId, action: 'SETUP_2FA', entityType: 'User' });
        res.json({ qrCodeUrl, secret: secret.base32 });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao configurar 2FA' });
    }
});
// 3. Confirm & Enable 2FA
router.post('/2fa/enable', auth_1.authenticateToken, async (req, res) => {
    try {
        const { token } = req.body; // user inputs the 6 digit code
        const user = await prisma_1.default.user.findUnique({ where: { id: req.user.userId } });
        if (!user || !user.totpSecret)
            return res.status(400).json({ error: 'Configuração 2FA não iniciada.' });
        const verified = speakeasy_1.default.totp.verify({
            secret: user.totpSecret,
            encoding: 'base32',
            token
        });
        if (!verified)
            return res.status(401).json({ error: 'Código inválido. Tente novamente.' });
        await prisma_1.default.user.update({
            where: { id: user.id },
            data: { is2faEnabled: true }
        });
        await auditLog_service_1.AuditLogService.log({ tenantId: req.user.tenantId, userId: user.id, action: 'ENABLE_2FA', entityType: 'User' });
        res.json({ message: '2FA ativado com sucesso!' });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao ativar 2FA' });
    }
});
// 4. Validate 2FA on Login (Receives tempToken and 6-digit code)
router.post('/2fa/verify', security_1.authLimiter, async (req, res) => {
    try {
        const { tempToken, code } = req.body;
        const decoded = jsonwebtoken_1.default.verify(tempToken, constants_1.JWT_SECRET);
        if (!decoded.isPre2fa)
            return res.status(401).json({ error: 'Sessão inválida.' });
        const user = await prisma_1.default.user.findUnique({ where: { id: decoded.userId }, include: { tenant: true } });
        if (!user || !user.totpSecret)
            return res.status(400).json({ error: 'Sessão expirada ou usuário inválido.' });
        const verified = speakeasy_1.default.totp.verify({
            secret: user.totpSecret,
            encoding: 'base32',
            token: code
        });
        if (!verified)
            return res.status(401).json({ error: 'Código 2FA incorreto.' });
        // Generate full session token
        const fullToken = jsonwebtoken_1.default.sign({ userId: user.id, tenantId: user.tenantId, role: user.role }, constants_1.JWT_SECRET, { expiresIn: '8h' });
        // Audit Log
        await auditLog_service_1.AuditLogService.log({ tenantId: user.tenantId, userId: user.id, action: 'LOGIN_2FA', entityType: 'Auth' });
        res.json({
            token: fullToken,
            user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenantId }
        });
    }
    catch (error) {
        res.status(401).json({ error: 'Sessão expirada. Volte e faça login novamente.' });
    }
});
exports.default = router;
