import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const code = "CPMH06";
  const comp = await prisma.engineeringComposition.findFirst({
    where: { code, database: { name: "PROPRIA" } },
    include: {
      items: {
        include: {
          item: true
        }
      }
    }
  });

  if (!comp) {
    console.error("Global CPMH06 not found");
    return;
  }

  console.log(`Global CPMH06 Price: ${comp.totalPrice}`);
  for (const ci of comp.items) {
    console.log(`- Item/Aux ID: ${ci.itemId || ci.auxiliaryCompositionId} | Coef: ${ci.coefficient} | Price: ${ci.price}`);
  }
}

main().finally(() => prisma.$disconnect());
