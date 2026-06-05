import { prisma } from '../lib/prisma';

async function main() {
  const db = await prisma.engineeringDatabase.findFirst({
    where: { name: 'CAERN', referenceYear: 2025 }
  });
  if (!db) {
    console.error("No CAERN 2025 db found");
    return;
  }
  
  const comps = await prisma.engineeringComposition.findMany({
    where: { databaseId: db.id }
  });
  
  const sevenDigitComps = comps.filter(c => c.code.length === 7);
  console.log(`Total CAERN 2025 compositions in DB: ${comps.length}`);
  console.log(`Compositions with 7-digit codes in DB: ${sevenDigitComps.length}`);
  if (sevenDigitComps.length > 0) {
    console.log("Samples:");
    sevenDigitComps.slice(0, 5).forEach(c => console.log(`- ${c.code}: ${c.description.substring(0, 50)}`));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
