import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const biddings = await prisma.biddingProcess.findMany({
        where: {
            title: {
                contains: 'Jaguaruana',
                mode: 'insensitive'
            }
        }
    });
    console.log(JSON.stringify(biddings, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
