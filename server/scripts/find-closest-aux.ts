import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const queries = [
    { code: "93566", target: 4298.74 },
    { code: "101375", target: 4548.97 },
    { code: "101399", target: 5367.86 },
    { code: "93565", target: 24856.68 },
    { code: "101401", target: 7329.82 },
    { code: "100309", target: 1246.40 },
    { code: "101460", target: 4643.86 }
  ];

  for (const q of queries) {
    const comps = await prisma.engineeringComposition.findMany({
      where: { code: q.code, database: { name: "SINAPI" } }
    });

    console.log(`\n=== Code: ${q.code} (Target: ${q.target}) ===`);
    let closest = null;
    let minDiff = Infinity;
    
    for (const c of comps) {
      const diff = Math.abs(c.totalPrice - q.target);
      console.log(`  - ID: ${c.id} | Price: ${c.totalPrice} | Diff: ${diff}`);
      if (diff < minDiff) {
        minDiff = diff;
        closest = c;
      }
    }
    
    if (closest) {
      console.log(`  👉 CLOSEST: ID: ${closest.id} | Price: ${closest.totalPrice} (diff: ${minDiff})`);
    }
  }
}

main().finally(() => prisma.$disconnect());
