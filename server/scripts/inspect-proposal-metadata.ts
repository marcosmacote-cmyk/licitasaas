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
  if (!db) return;
  const databaseId = db.id;

  const comps = await prisma.engineeringComposition.findMany({
    where: { databaseId }
  });

  for (const c of comps) {
    console.log(`\nComposition: ${c.code}`);
    console.log(`  TotalPrice: ${c.totalPrice}`);
    console.log(`  Metadata:`, c.metadata);
  }
}

main().finally(() => prisma.$disconnect());
