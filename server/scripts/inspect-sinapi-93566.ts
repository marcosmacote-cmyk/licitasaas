import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const code = "93566";
  const comps = await prisma.engineeringComposition.findMany({
    where: { code },
    include: {
      database: true,
      items: {
        include: {
          item: true
        }
      }
    }
  });

  for (const c of comps) {
    console.log(`\nComposition ID: ${c.id}, Database: ${c.database.name}, Price: ${c.totalPrice}`);
    let sum = 0;
    for (const ci of c.items) {
      if (ci.item) {
        sum += ci.price;
        console.log(`  - ITEM: ${ci.item.code} | Coef: ${ci.coefficient} | Saved Price: ${ci.price} | Item Base Price: ${ci.item.price}`);
      } else if (ci.auxiliaryCompositionId) {
        console.log(`  - AUX: ${ci.auxiliaryCompositionId} | Coef: ${ci.coefficient} | Saved Price: ${ci.price}`);
      }
    }
    console.log(`Calculated Item Sum: ${sum}`);
  }
}

main().finally(() => prisma.$disconnect());
