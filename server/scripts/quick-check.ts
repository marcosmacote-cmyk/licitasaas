import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const proposalId = "614215bf-a2f3-4bc8-8b15-c9ccaf21bac3";
  const dbName = `PROPRIA_${proposalId}`;

  console.log(`\n=== Checking CPMH06 items in database ${dbName} ===`);
  const composition = await prisma.engineeringComposition.findFirst({
    where: {
      code: "CPMH06",
      database: { name: dbName }
    },
    include: {
      database: true
    }
  });

  if (!composition) {
    console.error("❌ Error: Composition CPMH06 not found!");
    return;
  }

  const items = await prisma.engineeringCompositionItem.findMany({
    where: { compositionId: composition.id },
    include: { item: true }
  });

  for (const it of items) {
    if (it.item) {
      console.log(`- Item: Code=${it.item.code}, Desc=${it.item.description.substring(0, 50)}, Coef=${it.coefficient}, Price=${it.price}, ItemPrice=${it.item.price}`);
    } else if (it.auxiliaryCompositionId) {
      const aux = await prisma.engineeringComposition.findUnique({
        where: { id: it.auxiliaryCompositionId }
      });
      console.log(`- Aux: Code=${aux?.code}, Desc=${aux?.description.substring(0, 50)}, Coef=${it.coefficient}, Price=${it.price}, AuxPrice=${aux?.totalPrice}`);
      
      // Let's dump this aux's items
      if (aux) {
        const auxItems = await prisma.engineeringCompositionItem.findMany({
          where: { compositionId: aux.id },
          include: { item: true }
        });
        for (const ai of auxItems) {
          if (ai.item) {
            console.log(`    * Item: Code=${ai.item.code}, Desc=${ai.item.description.substring(0, 40)}, Coef=${ai.coefficient}, Price=${ai.price}, ItemPrice=${ai.item.price}`);
          } else if (ai.auxiliaryCompositionId) {
            const nested = await prisma.engineeringComposition.findUnique({ where: { id: ai.auxiliaryCompositionId } });
            console.log(`    * Aux: Code=${nested?.code}, Coef=${ai.coefficient}, Price=${ai.price}, AuxPrice=${nested?.totalPrice}`);
          }
        }
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
