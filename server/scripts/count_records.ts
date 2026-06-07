import prisma from '../lib/prisma';

async function main() {
    const statuses = await prisma.pncpContratacao.groupBy({
        by: ['situacao'],
        _count: { _all: true }
    });
    console.log('Unique statuses in DB:', JSON.stringify(statuses, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
