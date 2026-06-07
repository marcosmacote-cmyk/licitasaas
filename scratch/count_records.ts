import pkg from '@prisma/client';
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function main() {
    const total = await prisma.pncpContratacao.count();
    const active = await prisma.pncpContratacao.count({
        where: {
            OR: [
                { situacao: { in: ['Divulgada', 'Aberta'] } },
                { situacao: null }
            ],
            OR: [
                { dataEncerramento: { gte: new Date() } },
                { dataEncerramento: null }
            ]
        }
    });
    const byState = await prisma.pncpContratacao.groupBy({
        by: ['uf'],
        _count: { _all: true }
    });

    console.log('Total records:', total);
    console.log('Active (recebendo_proposta) records:', active);
    console.log('Grouped by state:', JSON.stringify(byState, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
