import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const activities: any[] = await prisma.$queryRaw`
    SELECT
      pid,
      state,
      age(clock_timestamp(), query_start)::text as duration,
      query
    FROM pg_stat_activity
    WHERE state != 'idle' AND query NOT LIKE '%pg_stat_activity%'
    ORDER BY age(clock_timestamp(), query_start) DESC
  `;

  console.log("=== ACTIVE QUERIES ===");
  for (const act of activities) {
    console.log(`PID: ${act.pid} | State: ${act.state} | Duration: ${act.duration} | Query: ${act.query.substring(0, 200)}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
