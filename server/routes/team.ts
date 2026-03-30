import express from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { authenticateToken, requireAdmin } from '../middlewares/auth';

const router = express.Router();

// --- Team & Users Management --- //

// 1. List all users for the tenant (excluding password hashes)
router.get('/', authenticateToken, requireAdmin, async (req: any, res) => {
    try {
        const users = await prisma.user.findMany({
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
    } catch (error) {
        console.error("Erro ao listar equipe:", error);
        res.status(500).json({ error: 'Erro ao listar equipe.' });
    }
});

// 2. Create a new user (Admin only)
router.post('/', authenticateToken, requireAdmin, async (req: any, res) => {
    try {
        const { name, email, password, role, isActive, opportunityScannerEnabled } = req.body;
        
        // Verifica se o e-mail já existe
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return res.status(400).json({ error: 'Este e-mail já está em uso.' });
        }

        // Prevenir criação de SUPER_ADMIN por admins comuns
        const safeRole = (role === 'SUPER_ADMIN') ? 'ADMIN' : (role || 'Analista');

        const passwordHash = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
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
    } catch (error) {
        console.error("Erro ao criar usuário:", error);
        res.status(500).json({ error: 'Erro ao registrar membro da equipe.' });
    }
});

// 3. Update user (Admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req: any, res) => {
    try {
        const { id } = req.params;
        const { name, role, isActive, opportunityScannerEnabled } = req.body;

        // Ensure user belongs to the same tenant before updating
        const user = await prisma.user.findFirst({ where: { id, tenantId: req.user.tenantId } });
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado nesta organização.' });
        }

        // Prevent admin from deactivating themselves
        if (id === req.user.userId && isActive === false) {
            return res.status(400).json({ error: 'Você não pode desativar sua própria conta ativa.' });
        }

        // Prevenir escalonamento de privilégios na edição
        const safeRoleUpdate = (role === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN') ? 'ADMIN' : role;

        const updateData: any = { 
            ...(name && { name }), 
            ...(safeRoleUpdate && { role: safeRoleUpdate }), 
            ...(isActive !== undefined && { isActive }),  
            ...(opportunityScannerEnabled !== undefined && { opportunityScannerEnabled })
        };
        
        const updatedUser = await prisma.user.update({
            where: { id },
            data: updateData,
            select: { id: true, name: true, email: true, role: true, isActive: true, opportunityScannerEnabled: true }
        });

        res.json(updatedUser);
    } catch (error) {
        console.error("Erro ao atualizar usuário:", error);
        res.status(500).json({ error: 'Erro ao atualizar dados da equipe.' });
    }
});

// 4. Force reset password (Admin only)
router.put('/:id/reset', authenticateToken, requireAdmin, async (req: any, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;

        const user = await prisma.user.findFirst({ where: { id, tenantId: req.user.tenantId } });
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id },
            data: { passwordHash }
        });

        res.json({ success: true, message: 'Senha redefinida com sucesso.' });
    } catch (error) {
        console.error("Erro no reset de senha:", error);
        res.status(500).json({ error: 'Erro ao redefinir a senha do usuário.' });
    }
});

export default router;
