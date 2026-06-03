import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import { toCanonicalCode } from './services/engineering/sinapiCrawler';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const db = await prisma.engineeringDatabase.findFirst({
    where: { name: 'SINAPI', uf: 'AC', referenceMonth: 10, referenceYear: 2025, payrollExemption: false },
  });

  if (!db) {
    console.log("Database for AC 10/2025 not found. Please sync it first.");
    return;
  }

  console.log(`Benchmarking database re-import for: ${db.id}`);

  // Fetch some items and compositions to simulate the parsed data
  const startFetch = Date.now();
  const items = await prisma.engineeringItem.findMany({ where: { databaseId: db.id } });
  const compositions = await prisma.engineeringComposition.findMany({ where: { databaseId: db.id } });
  const compItems = await prisma.engineeringCompositionItem.findMany({
    where: { composition: { databaseId: db.id } },
    include: { item: true, composition: true }
  });
  console.log(`Fetched ${items.length} items, ${compositions.length} compositions, ${compItems.length} comp items in ${Date.now() - startFetch}ms`);

  // Map back to ParsedItem and ParsedCompositionItem structure
  const parsedItems = [
    ...items.map(it => ({ code: it.code, description: it.description, unit: it.unit, price: it.price, type: it.type })),
    ...compositions.map(c => ({ code: c.code, description: c.description, unit: c.unit, price: c.totalPrice, type: 'SERVICO' }))
  ];

  const parsedCompItems = compItems.map(ci => ({
    parentCode: ci.composition.code,
    type: ci.item ? ci.item.type : 'SERVICO',
    code: ci.item ? ci.item.code : 'AUX_COMP', // fallback placeholder
    description: ci.item ? ci.item.description : 'Auxiliary composition',
    unit: ci.item ? ci.item.unit : 'UN',
    quantity: ci.coefficient
  }));

  console.log("Starting benchmark of persistItems steps...");

  // 1. Delete
  const startDelete = Date.now();
  await prisma.engineeringComposition.deleteMany({ where: { databaseId: db.id } });
  await prisma.engineeringItem.deleteMany({ where: { databaseId: db.id } });
  console.log(`Step 1: Delete took ${Date.now() - startDelete}ms`);

  const basicItems = parsedItems.filter(it => it.type !== 'SERVICO');
  const serviceItems = parsedItems.filter(it => it.type === 'SERVICO');

  // 2. Insert items
  const startInsertItems = Date.now();
  let insertedItems = 0;
  for (let i = 0; i < basicItems.length; i += 5000) {
    const r = await prisma.engineeringItem.createMany({
      data: basicItems.slice(i, i + 5000).map(it => ({ databaseId: db.id, ...it })),
      skipDuplicates: true
    });
    insertedItems += r.count;
  }
  console.log(`Step 2: Insert items (${insertedItems}) took ${Date.now() - startInsertItems}ms`);

  // 3. Insert compositions
  const startInsertComps = Date.now();
  let insertedComps = 0;
  for (let i = 0; i < serviceItems.length; i += 8000) {
    const chunk = serviceItems.slice(i, i + 8000);
    const r = await prisma.engineeringComposition.createMany({
      data: chunk.map(svc => ({ databaseId: db.id, code: svc.code, description: svc.description, unit: svc.unit, totalPrice: svc.price })),
      skipDuplicates: true
    });
    insertedComps += r.count;
  }
  console.log(`Step 3: Insert compositions (${insertedComps}) took ${Date.now() - startInsertComps}ms`);

  // 4. Build lookup maps and comp items
  const startMaps = Date.now();
  const comps = await prisma.engineeringComposition.findMany({ where: { databaseId: db.id }, select: { id: true, code: true } });
  const compIdMap = new Map<string, string>();
  for (const c of comps) compIdMap.set(toCanonicalCode(c.code), c.id);

  const itms = await prisma.engineeringItem.findMany({ where: { databaseId: db.id }, select: { id: true, code: true } });
  const itemIdMap = new Map<string, string>();
  for (const i of itms) itemIdMap.set(toCanonicalCode(i.code), i.id);

  const priceMap = new Map<string, number>();
  for (const it of parsedItems) priceMap.set(toCanonicalCode(it.code), it.price);

  const dbCompItems = [];
  for (const ci of parsedCompItems) {
    const parentId = compIdMap.get(toCanonicalCode(ci.parentCode));
    if (!parentId) continue;

    const childKey = toCanonicalCode(ci.code);
    const unitPrice = priceMap.get(childKey) || 0;
    const totalPrice = unitPrice * ci.quantity;

    const isSvc = ci.type === 'SERVICO';
    const itemId = isSvc ? null : (itemIdMap.get(childKey) || null);
    const auxCompId = isSvc ? (compIdMap.get(childKey) || null) : null;

    if (!itemId && !auxCompId) continue;

    dbCompItems.push({
      compositionId: parentId,
      itemId,
      auxiliaryCompositionId: auxCompId,
      coefficient: ci.quantity,
      price: totalPrice
    });
  }
  console.log(`Step 4: Maps & array building (${dbCompItems.length} items) took ${Date.now() - startMaps}ms`);

  // 5. Insert composition items
  const startInsertCompItems = Date.now();
  let insertedCompItems = 0;
  for (let i = 0; i < dbCompItems.length; i += 10000) {
    const chunk = dbCompItems.slice(i, i + 10000);
    const r = await prisma.engineeringCompositionItem.createMany({ data: chunk, skipDuplicates: true });
    insertedCompItems += r.count;
  }
  console.log(`Step 5: Insert composition items (${insertedCompItems}) took ${Date.now() - startInsertCompItems}ms`);

  // 6. Update database counters
  const startUpdateDb = Date.now();
  await prisma.engineeringDatabase.update({ where: { id: db.id }, data: { itemCount: insertedItems, compositionCount: insertedComps } });
  console.log(`Step 6: Update database counters took ${Date.now() - startUpdateDb}ms`);

  // 7. Get analytical coverage
  const startCoverage = Date.now();
  const rows: any[] = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE c."totalPrice" > 0
          AND COALESCE(ci.total, 0) < (c."totalPrice" * 0.85)
      )::int AS incomplete,
      COALESCE(MIN(
        CASE
          WHEN c."totalPrice" > 0 THEN COALESCE(ci.total, 0) / c."totalPrice"
          ELSE 1
        END
      ), 1)::float AS "worstCoverage"
    FROM "EngineeringComposition" c
    LEFT JOIN (
      SELECT ci."compositionId", SUM(ci.price) AS total
      FROM "EngineeringCompositionItem" ci
      INNER JOIN "EngineeringComposition" comp ON comp.id = ci."compositionId"
      WHERE comp."databaseId" = ${db.id}
      GROUP BY ci."compositionId"
    ) ci ON ci."compositionId" = c.id
    WHERE c."databaseId" = ${db.id}
  `;
  console.log(`Step 7: getAnalyticalCoverage took ${Date.now() - startCoverage}ms (result total=${rows[0].total})`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
