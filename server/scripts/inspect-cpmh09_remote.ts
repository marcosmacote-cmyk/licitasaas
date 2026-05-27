import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  console.log("=== Engineering Proposal Items ===");
  const items = await prisma.engineeringProposalItem.findMany({
    where: { code: "CPMH09" },
    orderBy: { id: 'desc' }
  });
  console.log("Found CPMH09 items count:", items.length);
  for (const it of items) {
    console.log(`ID: ${it.id}, ProposalID: ${it.proposalId}, Number: ${it.itemNumber}, unitCost: ${it.unitCost}, unitPrice: ${it.unitPrice}, quantity: ${it.quantity}, totalPrice: ${it.totalPrice}`);
    console.log(`  priceAudit:`, JSON.stringify(it.priceAudit));
  }

  console.log("\n=== Engineering Compositions ===");
  const comps = await prisma.engineeringComposition.findMany({
    where: { code: "CPMH09" },
    include: {
      items: {
        include: {
          item: true
        }
      },
      database: true
    }
  });
  console.log("Found CPMH09 compositions:", comps.length);
  for (const c of comps) {
    console.log(`ID: ${c.id}, Database: ${c.database?.name} (${c.database?.type}), Price: ${c.totalPrice}`);
    console.log(`  Metadata:`, JSON.stringify(c.metadata));
    for (const item of c.items) {
      let auxDesc = "";
      let auxPrice = 0;
      if (item.auxiliaryCompositionId) {
        const aux = await prisma.engineeringComposition.findUnique({
          where: { id: item.auxiliaryCompositionId }
        });
        auxDesc = aux?.description || "";
        auxPrice = aux?.totalPrice || 0;
      }
      console.log(`  - Item: Code=${item.item?.code || "AUX"}, Description=${item.item?.description || auxDesc}, Coef=${item.coefficient}, Price=${item.price}, UnitPrice=${item.item?.price !== undefined ? item.item.price : auxPrice}`);
    }
  }
}

main()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
