import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const proposalId = "614215bf-a2f3-4bc8-8b15-c9ccaf21bac3";
  const dbName = `PROPRIA_${proposalId}`;
  
  // 1. Find all databases
  const databases = await prisma.engineeringDatabase.findMany();
  console.log("Databases:");
  for (const d of databases) {
    console.log(`- ${d.name} (id: ${d.id})`);
  }

  // 2. Search CPMH07 in all databases
  console.log("\nSearching CPMH07 in all databases:");
  const cpmh07s = await prisma.engineeringComposition.findMany({
    where: { code: "CPMH07" },
    include: { database: true }
  });
  for (const c of cpmh07s) {
    console.log(`- ID: ${c.id}, Code: ${c.code}, Database: ${c.database.name}, Price: ${c.totalPrice}`);
  }

  // 3. Look at proposal items and see what they are
  console.log("\nProposal Items:");
  const items = await prisma.engineeringProposalItem.findMany({
    where: { proposalId }
  });
  for (const it of items) {
    console.log(`- Code: ${it.code}, Desc: ${it.description.substring(0, 30)}, Qty: ${it.quantity}, UnitCost: ${it.unitCost}, Total: ${it.quantity * it.unitCost}, Base: ${it.sourceName}`);
  }
}

main().finally(() => prisma.$disconnect());
