const { PrismaClient } = require('/app/server/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Check what database these specific codes belong to
    const codes = ['2436', '247', '6160', '6110', '252', 'I2171'];
    
    for (const code of codes) {
        const items = await prisma.$queryRawUnsafe(
            `SELECT i.code, i.description, i.type, d.name as db_name
             FROM "EngineeringItem" i
             JOIN "EngineeringDatabase" d ON d.id = i."databaseId"
             WHERE i.code = $1
             LIMIT 5`, code
        );
        console.log(code + ':');
        for (const i of items) {
            console.log('  DB:', i.db_name, '| type:', i.type, '|', (i.description || '').substring(0, 50));
        }
        if (items.length === 0) console.log('  NOT FOUND');
    }

    // Also check: what official databases exist?
    const dbs = await prisma.$queryRawUnsafe(
        `SELECT name, type, COUNT(*) as items FROM "EngineeringDatabase" d
         LEFT JOIN "EngineeringItem" i ON i."databaseId" = d.id
         GROUP BY d.id, d.name, d.type
         HAVING COUNT(*) > 0
         ORDER BY d.name LIMIT 20`
    );
    console.log('\n=== DATABASES WITH ITEMS ===');
    for (const db of dbs) console.log(db.name, '| type:', db.type, '| items:', Number(db.items));

    await prisma.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
