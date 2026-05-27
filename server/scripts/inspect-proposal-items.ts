import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const proposalId = "614215bf-a2f3-4bc8-8b15-c9ccaf21bac3";

  console.log("=== Engineering Proposal Items ===");
  const items = await prisma.engineeringProposalItem.findMany({
    where: { proposalId },
    orderBy: { sortOrder: 'asc' }
  });
  
  for (const it of items) {
    console.log(`ID: ${it.id}, Number: ${it.itemNumber}, Code: ${it.code}, Type: ${it.type}, Unit: ${it.unit}, Qty: ${it.quantity}, unitCost: ${it.unitCost}, unitPrice: ${it.unitPrice}, totalPrice: ${it.totalPrice}`);
    
    // Look up composition
    if (it.code) {
      const comp = await prisma.engineeringComposition.findFirst({
        where: { code: it.code, database: { name: `PROPRIA_${proposalId}` } }
      });
      if (comp) {
        console.log(`  -> Backing Composition: Price=${comp.totalPrice}, Metadata=${JSON.stringify(comp.metadata)}`);
      }
    }
  }
}

main()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
