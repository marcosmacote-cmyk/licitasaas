import prisma from '../server/lib/prisma';

async function main() {
    const totalContratacoes = await prisma.pncpContratacao.count();
    const totalLogs = await prisma.pncpHydrationLog.count();
    
    console.log('Total PncpContratacao:', totalContratacoes);
    console.log('Total PncpHydrationLog:', totalLogs);

    // Let's see some samples of PncpHydrationLog
    const sampleLogs = await prisma.pncpHydrationLog.findMany({
        orderBy: { date: 'asc' },
        take: 10
    });
    console.log('Oldest hydration logs:', sampleLogs);

    const sampleLogsDesc = await prisma.pncpHydrationLog.findMany({
        orderBy: { date: 'desc' },
        take: 10
    });
    console.log('Newest hydration logs:', sampleLogsDesc);

    // Let's see if there are any PncpContratacao matching July to December 2025
    const count2025 = await prisma.pncpContratacao.count({
        where: {
            dataPublicacao: {
                gte: new Date('2025-07-01T00:00:00Z'),
                lte: new Date('2025-12-31T23:59:59Z')
            }
        }
    });
    console.log('Total PncpContratacao in date range July-Dec 2025:', count2025);
}

main().catch(console.error).finally(() => prisma.$disconnect());
