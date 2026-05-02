import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    // 1. Check all databases and their composition items
    const dbs = await prisma.engineeringDatabase.findMany({
        select: { id: true, name: true, type: true, compositionCount: true, itemCount: true }
    });
    
    console.log('\n=== DATABASES ===');
    for (const db of dbs) {
        const compCount = await prisma.engineeringComposition.count({ where: { databaseId: db.id } });
        const compItemCount = await prisma.engineeringCompositionItem.count({
            where: { composition: { databaseId: db.id } }
        });
        console.log(`${db.name} (${db.type}): ${compCount} compositions, ${compItemCount} analytical items`);
    }

    // 2. Check specific composition 91877 (SINAPI)
    console.log('\n=== COMPOSITION 91877 ===');
    const comp91877 = await prisma.engineeringComposition.findMany({
        where: { code: '91877' },
        include: { 
            items: { include: { item: true } },
            database: { select: { name: true } }
        }
    });
    
    for (const c of comp91877) {
        console.log(`DB: ${c.database.name}, Code: ${c.code}, Desc: ${c.description.substring(0, 60)}`);
        console.log(`  totalPrice: ${c.totalPrice}, items count: ${c.items.length}`);
        for (const ci of c.items.slice(0, 5)) {
            const desc = ci.item?.description || '(aux composition)';
            console.log(`  - [${ci.item?.type || 'AUX'}] ${desc.substring(0, 50)} | coef: ${ci.coefficient} | price: ${ci.price}`);
        }
    }

    // 3. Find any composition with analytical items
    console.log('\n=== COMPOSITIONS WITH ITEMS (sample) ===');
    const withItems = await prisma.engineeringComposition.findMany({
        where: { items: { some: {} } },
        include: { 
            items: { take: 3, include: { item: true } },
            database: { select: { name: true } }
        },
        take: 5
    });
    for (const c of withItems) {
        console.log(`${c.database.name} | ${c.code} | ${c.description.substring(0, 50)} | ${c.items.length} items`);
    }

    await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
