import { prisma } from '../lib/prisma';

async function main() {
  const db = await prisma.engineeringDatabase.findFirst({
    where: { name: 'SINAPI', uf: 'CE', referenceMonth: 12, referenceYear: 2025 }
  });

  if (!db) {
    console.log('Database not found');
    return;
  }

  console.log(`Testing query performance for database ${db.id}...`);
  
  const start = Date.now();
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
  const end = Date.now();
  console.log(`Query completed in ${end - start}ms`);
  console.log('Result:', rows[0]);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
