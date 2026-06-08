import prisma from '../lib/prisma';

async function main() {
    const total = await prisma.pncpContratacao.count();
    console.log('Total items in PncpContratacao:', total);
    
    const items = await prisma.pncpContratacao.findMany({
        take: 5,
        orderBy: { dataPublicacao: 'asc' },
        select: {
            id: true,
            numeroControle: true,
            orgaoNome: true,
            dataPublicacao: true,
            dataEncerramento: true
        }
    });
    console.log('Oldest items by publication date:', JSON.stringify(items, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
