"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function promoteToSuperAdmin(email) {
    if (!email) {
        console.error('Uso: npx ts-node server/scripts/promote-to-superadmin.ts <email>');
        process.exit(1);
    }
    try {
        const user = await prisma.user.findUnique({
            where: { email },
            include: { tenant: true }
        });
        if (!user) {
            console.error(`Usuário com o e-mail ${email} não encontrado.`);
            process.exit(1);
        }
        const updated = await prisma.user.update({
            where: { email },
            data: { role: 'SUPER_ADMIN' }
        });
        console.log(`✅ Sucesso! O usuário ${updated.name} (${updated.email}) foi promovido a SUPER_ADMIN.`);
        console.log(`Organização vinculada: ${user.tenant.razaoSocial}`);
    }
    catch (error) {
        console.error('Erro ao promover usuário:', error);
    }
    finally {
        await prisma.$disconnect();
    }
}
const targetEmail = process.argv[2];
promoteToSuperAdmin(targetEmail);
