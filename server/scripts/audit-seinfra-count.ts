import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const dbs = await prisma.engineeringDatabase.findMany({
    where: { name: { contains: "SEINFRA", mode: 'insensitive' } }
  });

  console.log("=== BASES SEINFRA NO BANCO ===");
  for (const db of dbs) {
    const actualItemCount = await prisma.engineeringItem.count({ where: { databaseId: db.id } });
    const actualCompCount = await prisma.engineeringComposition.count({ where: { databaseId: db.id } });
    console.log({
      id: db.id,
      name: db.name,
      uf: db.uf,
      version: db.version,
      referenceMonth: db.referenceMonth,
      referenceYear: db.referenceYear,
      payrollExemption: db.payrollExemption,
      registeredItemCount: db.itemCount,
      actualItemCount,
      registeredCompCount: db.compositionCount,
      actualCompCount
    });
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
