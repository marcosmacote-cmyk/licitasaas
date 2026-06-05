import { prisma } from '../lib/prisma';

async function main() {
  const db = await prisma.engineeringDatabase.findFirst({
    where: { name: 'CAERN', referenceYear: 2025 }
  });
  if (!db) {
    console.error("No CAERN 2025 db found");
    return;
  }
  
  // Find compositions that don't match standard numeric SINAPI pattern
  const comps = await prisma.engineeringComposition.findMany({
    where: { databaseId: db.id }
  });
  
  const customComps = comps.filter(c => !/^\d+$/.test(c.code));
  console.log(`Total CAERN 2025 compositions: ${comps.length}`);
  console.log(`Custom (non-numeric code) compositions: ${customComps.length}`);
  console.log("Sample custom compositions (first 20):");
  customComps.slice(0, 20).forEach(c => {
    console.log(`- Code: "${c.code}" | Unit: "${c.unit}" | Price: R$ ${c.totalPrice}`);
    console.log(`  Desc: "${c.description.substring(0, 100)}"`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
