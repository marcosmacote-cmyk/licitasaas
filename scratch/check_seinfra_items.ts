import pkg from '@prisma/client';
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function main() {
    // 1. Search for items starting with I or 1 that look like 7396
    const items = await prisma.engineeringItem.findMany({
        where: {
            code: {
                in: ['I7396', '17396', '7396', 'C17396']
            }
        },
        include: {
            database: true
        }
    });
    console.log('--- Items found for I7396/17396/7396 ---');
    console.log(items.map(i => ({
        id: i.id,
        code: i.code,
        description: i.description.substring(0, 50),
        database: i.database.name,
        uf: i.database.uf,
        price: Number(i.price)
    })));

    // 2. Search for items with description containing 'ARRUELA LISA EM ACO INOX'
    const descItems = await prisma.engineeringItem.findMany({
        where: {
            description: {
                contains: 'ARRUELA LISA EM AÇO INOX',
                mode: 'insensitive'
            }
        },
        include: {
            database: true
        },
        take: 5
    });
    console.log('\n--- Items found by description ---');
    console.log(descItems.map(i => ({
        id: i.id,
        code: i.code,
        description: i.description.substring(0, 50),
        database: i.database.name,
        price: Number(i.price)
    })));

    // 3. Search for compositions with code starting with C2667 or C-something similar
    const comps = await prisma.engineeringComposition.findMany({
        where: {
            code: {
                in: ['C2667', '2667', 'C2667/SEINFRA']
            }
        },
        include: {
            database: true
        }
    });
    console.log('\n--- Compositions found for C2667 ---');
    console.log(comps.map(c => ({
        id: c.id,
        code: c.code,
        description: c.description.substring(0, 50),
        database: c.database.name,
        price: Number(c.totalPrice)
    })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
