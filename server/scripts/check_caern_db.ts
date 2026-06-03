import { prisma } from '../lib/prisma';

async function main() {
  const databases = await prisma.engineeringDatabase.findMany({
    orderBy: [
      { name: 'asc' },
      { referenceYear: 'desc' },
      { referenceMonth: 'desc' }
    ]
  });

  console.log(`Found ${databases.length} databases in DB:`);
  for (const db of databases) {
    console.log(`- ID: ${db.id}`);
    console.log(`  Name: ${db.name}`);
    console.log(`  UF: ${db.uf}`);
    console.log(`  Year/Month: ${db.referenceMonth}/${db.referenceYear}`);
    console.log(`  Version: ${db.version}`);
    console.log(`  Items (Insumos): ${db.itemCount || 0}`);
    console.log(`  Compositions (Composições): ${db.compositionCount || 0}`);
    console.log('-----------------------------------------');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
