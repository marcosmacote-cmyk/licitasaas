import 'dotenv/config';
import { prisma } from '../lib/prisma';

async function main() {
  const db = await prisma.engineeringDatabase.findFirst({
    where: { name: 'SICRO', uf: 'CE', referenceMonth: 1, referenceYear: 2026 }
  });

  if (!db) {
    console.log("No SICRO database found.");
    return;
  }

  console.log(`Checking codes for database ID: ${db.id} (${db.version})`);

  // Count items by first character of the code
  const items = await prisma.engineeringItem.findMany({
    where: { databaseId: db.id },
    select: { code: true, type: true }
  });

  const itemPrefixes: Record<string, number> = {};
  for (const it of items) {
    const prefix = it.code.charAt(0).toUpperCase();
    itemPrefixes[prefix] = (itemPrefixes[prefix] || 0) + 1;
  }

  console.log("\nItems prefix count:", itemPrefixes);

  // Count compositions by first character of the code
  const comps = await prisma.engineeringComposition.findMany({
    where: { databaseId: db.id },
    select: { code: true }
  });

  const compPrefixes: Record<string, number> = {};
  for (const c of comps) {
    const prefix = c.code.charAt(0).toUpperCase();
    compPrefixes[prefix] = (compPrefixes[prefix] || 0) + 1;
  }

  console.log("\nCompositions prefix count:", compPrefixes);
}

main().catch(console.error).finally(() => prisma.$disconnect());
