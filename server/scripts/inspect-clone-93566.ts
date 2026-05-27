import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const proposalId = "614215bf-a2f3-4bc8-8b15-c9ccaf21bac3";
  const dbName = `PROPRIA_${proposalId}`;
  
  const db = await prisma.engineeringDatabase.findFirst({ where: { name: dbName } });
  if (!db) {
    console.error("Database not found");
    return;
  }
  const databaseId = db.id;

  const comps = await prisma.engineeringComposition.findMany({
    where: { code: "93566", databaseId },
    include: {
      items: {
        include: {
          item: true
        }
      }
    }
  });

  console.log(`Clones of 93566 in proposal database (count: ${comps.length}):`);
  for (const c of comps) {
    console.log(`- ID: ${c.id}, Price: ${c.totalPrice}`);
    for (const ci of c.items) {
      if (ci.item) {
        console.log(`  - ITEM: ${ci.item.code} | Coef: ${ci.coefficient} | Saved Price: ${ci.price} | Item Table Price: ${ci.item.price}`);
      }
    }
  }
}

main().finally(() => prisma.$disconnect());
