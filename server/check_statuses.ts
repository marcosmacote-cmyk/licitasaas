import prisma from './lib/prisma';

async function main() {
    try {
        console.log("=== Querying Unique BiddingProcess Statuses ===");
        const statuses = await prisma.biddingProcess.groupBy({
            by: ['status'],
            _count: { id: true }
        });
        console.log("Unique statuses in BiddingProcess:", statuses);

        console.log("=== Querying some processes with null or weird statuses ===");
        const samples = await prisma.biddingProcess.findMany({
            take: 20,
            select: {
                id: true,
                title: true,
                status: true,
                substage: true
            }
        });
        console.log("Samples:", samples);
    } catch (e) {
        console.error("Error executing query:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
