const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const where = {};
    where.uf = 'CE';
    const mapped = ['Divulgada', 'Aberta'];
    
    // Exactly what the route does:
    where.OR = [
        { situacao: { in: mapped } },
        { situacao: null },
    ];
    
    console.log("Querying with where:", JSON.stringify(where, null, 2));
    const count = await prisma.pncpContratacao.count({ where });
    console.log("Total CE + Abertas:", count);

    const checkNulls = await prisma.pncpContratacao.count({ where: { uf: 'CE' } });
    console.log("Total CE (any status):", checkNulls);

    const checkNullStatus = await prisma.pncpContratacao.count({ where: { uf: 'CE', situacao: null } });
    console.log("Total CE with NULL status:", checkNullStatus);
    
    const checkDivulgada = await prisma.pncpContratacao.count({ where: { uf: 'CE', situacao: 'Divulgada' } });
    console.log("Total CE with Divulgada status:", checkDivulgada);
}
run().catch(console.error).finally(() => prisma.$disconnect());
