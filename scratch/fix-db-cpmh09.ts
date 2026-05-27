import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const proposalId = "614215bf-a2f3-4bc8-8b15-c9ccaf21bac3";
  const dbName = `PROPRIA_${proposalId}`;

  console.log(`\n=== Locating Composition CPMH09 in database ${dbName} ===`);
  const composition = await prisma.engineeringComposition.findFirst({
    where: {
      code: "CPMH09",
      database: { name: dbName }
    },
    include: {
      database: true
    }
  });

  if (!composition) {
    console.error("❌ Error: Composition CPMH09 not found!");
    return;
  }

  console.log(`Found Composition: ID=${composition.id}, Code=${composition.code}, Description="${composition.description}"`);

  console.log("\n=== Locating Composition Item for I7413 (Plaqueta) ===");
  const compItem = await prisma.engineeringCompositionItem.findFirst({
    where: {
      compositionId: composition.id,
      item: { code: "I7413" }
    },
    include: {
      item: true
    }
  });

  if (!compItem) {
    console.error("❌ Error: Composition item for I7413 not found in CPMH09!");
    return;
  }

  console.log(`Found Composition Item: ID=${compItem.id}, ItemCode=${compItem.item?.code}, Current Coefficient=${compItem.coefficient}, Current Subtotal Price=${compItem.price}`);

  console.log("\n=== Updating Coefficient and Price ===");
  const updated = await prisma.engineeringCompositionItem.update({
    where: { id: compItem.id },
    data: {
      coefficient: 1.0,
      price: 8.08
    }
  });

  console.log(`✅ Update Successful! New Coefficient=${updated.coefficient}, New Subtotal Price=${updated.price}`);

  // Optional: check other items in CPMH09 to make sure they are correct
  console.log("\n=== Checking all items in CPMH09 post-update ===");
  const allItems = await prisma.engineeringCompositionItem.findMany({
    where: { compositionId: composition.id },
    include: { item: true }
  });

  for (const it of allItems) {
    console.log(`- Code: ${it.item?.code || 'AUX'}, Coefficient: ${it.coefficient}, Subtotal Price: ${it.price}`);
  }
}

main()
  .catch(err => console.error("❌ Execution failed:", err))
  .finally(() => prisma.$disconnect());
