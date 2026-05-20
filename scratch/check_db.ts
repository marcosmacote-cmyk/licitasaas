import pkg from '@prisma/client';
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function main() {
    const processes = await prisma.biddingProcess.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { aiAnalysis: true }
    });

    for (const p of processes) {
        console.log(`ID: ${p.id}`);
        console.log(`Title/Objeto: ${p.objeto || p.description}`);
        console.log(`PNCP Link: ${p.pncpLink}`);
        const schemaV2 = p.aiAnalysis?.schemaV2 as any;
        const attachments = schemaV2?.pncp_source?.attachments || [];
        console.log(`Attachments count: ${attachments.length}`);
        for (const att of attachments) {
            console.log(`  - Title: ${att.title}, URL: ${att.url}`);
        }
        console.log('--------------------------------------------------');
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
