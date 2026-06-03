import pkg from '@prisma/client';
const { PrismaClient } = pkg;
const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const db = await prisma.engineeringDatabase.findFirst({
    where: { name: 'SINAPI', uf: 'CE', referenceMonth: 4, referenceYear: 2026 },
    select: { id: true }
  });

  if (!db) {
    console.log("Database not found");
    return;
  }

  const databaseId = db.id;
  console.log(`Running query for database: ${databaseId}...`);
  
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
      WHERE comp."databaseId" = ${databaseId}
      GROUP BY ci."compositionId"
    ) ci ON ci."compositionId" = c.id
    WHERE c."databaseId" = ${databaseId}
  `;
  const duration = Date.now() - start;
  console.log("Result:", rows[0]);
  console.log(`Duration: ${duration}ms`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
