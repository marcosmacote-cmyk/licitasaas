import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const codes = ["101375", "101399"];
  for (const code of codes) {
    const comps = await prisma.engineeringComposition.findMany({
      where: { code },
      include: { database: true }
    });
    console.log(`\n=== Code: ${code} ===`);
    for (const c of comps) {
      console.log(`- ID: ${c.id}, Database: ${c.database.name}, Price: ${c.totalPrice}`);
    }
  }
}

main().finally(() => prisma.$disconnect());
