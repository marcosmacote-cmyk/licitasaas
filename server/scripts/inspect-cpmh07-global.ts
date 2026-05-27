import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const globalPropriaDb = await prisma.engineeringDatabase.findFirst({ where: { name: "PROPRIA" } });
  if (!globalPropriaDb) {
    console.error("Global PROPRIA DB not found");
    return;
  }

  const cpmh07 = await prisma.engineeringComposition.findFirst({
    where: { code: "CPMH07", databaseId: globalPropriaDb.id },
    include: {
      items: {
        include: {
          item: true
        }
      }
    }
  });

  if (!cpmh07) {
    console.error("CPMH07 not found in global PROPRIA");
    return;
  }

  console.log(`\n======================================`);
  console.log(`CPMH07 Global Price: ${cpmh07.totalPrice}`);
  
  let calculatedSum = 0;
  for (const ci of cpmh07.items) {
    if (ci.item) {
      const derivedPrice = ci.coefficient > 0 ? (ci.price / ci.coefficient) : 0;
      console.log(`  - ITEM: ${ci.item.code} (${ci.item.description.substring(0, 30)}) | Coef: ${ci.coefficient} | Saved Price: ${ci.price} | Derived UnitPrice: ${derivedPrice}`);
      calculatedSum += ci.price;
    } else if (ci.auxiliaryCompositionId) {
      const aux = await prisma.engineeringComposition.findUnique({
        where: { id: ci.auxiliaryCompositionId },
        include: { database: true }
      });
      console.log(`  - AUX: ${aux?.code} (DB: ${aux?.database.name}) | Coef: ${ci.coefficient} | Saved Price: ${ci.price}`);
      calculatedSum += ci.price;
    }
  }
  console.log(`Calculated Sum: ${calculatedSum}`);
}

main().finally(() => prisma.$disconnect());
