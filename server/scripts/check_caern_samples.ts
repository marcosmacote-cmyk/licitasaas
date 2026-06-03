import { prisma } from '../lib/prisma';

async function main() {
  const db = await prisma.engineeringDatabase.findFirst({
    where: { name: 'CAERN', referenceYear: 2025 }
  });

  if (!db) {
    console.error("CAERN 2025 database not found in DB!");
    return;
  }

  console.log(`Database ID: ${db.id}`);
  console.log(`Name: ${db.name} | UF: ${db.uf} | Month/Year: ${db.referenceMonth}/${db.referenceYear}`);
  console.log(`Compositions count: ${db.compositionCount}`);

  const comps = await prisma.engineeringComposition.findMany({
    where: { databaseId: db.id },
    take: 20
  });

  console.log("\nSample Compositions:");
  comps.forEach(c => {
    console.log(`- Code: "${c.code}" | Unit: "${c.unit}" | Price: R$ ${c.totalPrice}`);
    console.log(`  Desc: "${c.description.substring(0, 100)}"`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
