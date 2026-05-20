import pkg from '../server/node_modules/@prisma/client/index.js';
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function main() {
    const databases = await prisma.engineeringDatabase.findMany({
        orderBy: { name: 'asc' }
    });

    console.log(`Found ${databases.length} databases in DB:`);
    for (const db of databases) {
        console.log(`- ID: ${db.id}`);
        console.log(`  Name: ${db.name}`);
        console.log(`  UF: ${db.uf}`);
        console.log(`  Year/Month: ${db.referenceMonth}/${db.referenceYear}`);
        console.log(`  Version: ${db.version}`);
        console.log(`  Type: ${db.type}`);
        console.log(`  Items: ${db.itemCount || 0} | Compositions: ${db.compositionCount || 0}`);
        console.log('-----------------------------------------');
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
