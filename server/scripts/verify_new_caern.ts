import { prisma } from '../lib/prisma';

async function main() {
  console.log("=== Verifying New CAERN Databases ===");
  const databases = await prisma.engineeringDatabase.findMany({
    where: { name: 'CAERN', uf: 'RN', type: 'OFICIAL' },
    orderBy: [
      { referenceYear: 'desc' },
      { referenceMonth: 'desc' }
    ]
  });

  for (const db of databases) {
    const comps = await prisma.engineeringComposition.findMany({
      where: { databaseId: db.id }
    });
    const sevenDigit = comps.filter(c => c.code.length === 7);
    console.log(`Database: ${db.version} (ID: ${db.id})`);
    console.log(`  Total Comps: ${comps.length}`);
    console.log(`  7-digit Comps (Custom CAERN): ${sevenDigit.length}`);
    if (sevenDigit.length > 0) {
      console.log("  Sample 7-digit codes:");
      sevenDigit.slice(0, 3).forEach(c => {
        console.log(`    - ${c.code}: ${c.description.substring(0, 60)} | Price: R$ ${c.totalPrice}`);
      });
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
