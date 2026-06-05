import { prisma } from '../lib/prisma';

async function main() {
  console.log("=== Cleaning up legacy CAERN databases ===");
  
  // Legacy databases to remove:
  // - 1/2025 (we have Abril 2025 now)
  // - 1/2024 (we have Maio 2024 now)
  // - 1/2023 (we have Maio 2023 / Novembro 2023 now, and it has 0 compositions)
  const legacyDbs = await prisma.engineeringDatabase.findMany({
    where: {
      name: 'CAERN',
      uf: 'RN',
      type: 'OFICIAL',
      referenceMonth: 1,
      referenceYear: { in: [2025, 2024, 2023] }
    }
  });

  console.log(`Found ${legacyDbs.length} legacy CAERN database(s) to remove:`);
  for (const db of legacyDbs) {
    console.log(`- Removing Database ID: ${db.id} | Name: ${db.name} | Month/Year: ${db.referenceMonth}/${db.referenceYear} | Comps: ${db.compositionCount}`);
    
    // Cascading deletes on compositions and items (handled by prisma onDelete: Cascade, but we can do it explicitly to be safe)
    await prisma.engineeringComposition.deleteMany({ where: { databaseId: db.id } });
    await prisma.engineeringItem.deleteMany({ where: { databaseId: db.id } });
    await prisma.engineeringDatabase.delete({ where: { id: db.id } });
  }
  
  console.log("Cleanup complete!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
