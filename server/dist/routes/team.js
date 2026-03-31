"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middlewares/auth");
const router = express_1.default.Router();
// --- Team & Users Management --- //
// 1. List all users for the tenant (excluding password hashes)
router.get('/', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    try {
        const users = await prisma_1.default.user.findMany({
            where: { tenantId: req.user.tenantId },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                opportunityScannerEnabled: true
            },
            orderBy: { name: 'asc' }
        });
        res.json(users);
    }
    catch (error) {
        console.error("Erro ao listar equipe:", error);
        res.status(500).json({ error: 'Erro ao listar equipe.' });
    }
});
// 2. Create a new user (Admin only)
router.post('/', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    try {
        const { name, email, password, role, isActive, opportunityScannerEnabled } = req.body;
        // Verifica se o e-mail já existe
        const existing = await prisma_1.default.user.findUnique({ where: { email } });
        if (existing) {
            return res.status(400).json({ error: 'Este e-mail já está em uso.' });
        }
        // Prevenir criação de SUPER_ADMIN por admins comuns
        const safeRole = (role === 'SUPER_ADMIN') ? 'ADMIN' : (role || 'Analista');
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        const newUser = await prisma_1.default.user.create({
            data: {
                tenantId: req.user.tenantId,
                name,
                email,
                passwordHash,
                role: safeRole,
                isActive: isActive ?? true,
                opportunityScannerEnabled: opportunityScannerEnabled ?? true
            },
            select: { id: true, name: true, email: true, role: true, isActive: true, opportunityScannerEnabled: true }
        });
        res.status(201).json(newUser);
    }
    catch (error) {
        console.error("Erro ao criar usuário:", error);
        res.status(500).json({ error: 'Erro ao registrar membro da equipe.' });
    }
});
// 3. Update user (Admin only)
router.put('/:id', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, role, isActive, opportunityScannerEnabled } = req.body;
        // Ensure user belongs to the same tenant before updating
        const user = await prisma_1.default.user.findFirst({ where: { id, tenantId: req.user.tenantId } });
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado nesta organização.' });
        }
        // Prevent admin from deactivating themselves
        if (id === req.user.userId && isActive === false) {
            return res.status(400).json({ error: 'Você não pode desativar sua própria conta ativa.' });
        }
        // Prevenir escalonamento de privilégios na edição
        const safeRoleUpdate = (role === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN') ? 'ADMIN' : role;
        const updateData = {
            ...(name && { name }),
            ...(safeRoleUpdate && { role: safeRoleUpdate }),
            ...(isActive !== undefined && { isActive }),
            ...(opportunityScannerEnabled !== undefined && { opportunityScannerEnabled })
        };
        const updatedUser = await prisma_1.default.user.update({
            where: { id },
            data: updateData,
            select: { id: true, name: true, email: true, role: true, isActive: true, opportunityScannerEnabled: true }
        });
        res.json(updatedUser);
    }
    catch (error) {
        console.error("Erro ao atualizar usuário:", error);
        res.status(500).json({ error: 'Erro ao atualizar dados da equipe.' });
    }
});
// 4. Force reset password (Admin only)
router.put('/:id/reset', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;
        const user = await prisma_1.default.user.findFirst({ where: { id, tenantId: req.user.tenantId } });
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }
        const passwordHash = await bcryptjs_1.default.hash(newPassword, 10);
        await prisma_1.default.user.update({
            where: { id },
            data: { passwordHash }
        });
        res.json({ success: true, message: 'Senha redefinida com sucesso.' });
    }
    catch (error) {
        console.error("Erro no reset de senha:", error);
        res.status(500).json({ error: 'Erro ao redefinir a senha do usuário.' });
    }
});
exports.default = router;
