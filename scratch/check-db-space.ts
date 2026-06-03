import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  console.log("=== Checking Database Sizes ===");
  try {
    // Database size
    const dbSizeResult: any = await prisma.$queryRawUnsafe(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size;
    `);
    console.log(`Database Size: ${dbSizeResult[0]?.size}`);

    // Table sizes
    const tableSizes: any = await prisma.$queryRawUnsafe(`
      SELECT
        relname AS table_name,
        pg_size_pretty(pg_total_relation_size(pg_class.oid)) AS total_size,
        pg_size_pretty(pg_relation_size(pg_class.oid)) AS table_size,
        pg_size_pretty(pg_total_relation_size(pg_class.oid) - pg_relation_size(pg_class.oid)) AS index_size,
        reltuples::bigint AS row_count
      FROM pg_class
      JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE nspname = 'public'
        AND relkind = 'r'
      ORDER BY pg_total_relation_size(pg_class.oid) DESC;
    `);
    console.log("\nTable Sizes:");
    console.table(tableSizes);

    // Disk space info (PostgreSQL pg_stat_file or shell command, but pg_stat_file doesn't show free space. We can check pg_tablespace_size or others)
    const tablespaceResult: any = await prisma.$queryRawUnsafe(`
      SELECT pg_size_pretty(pg_tablespace_size('pg_default')) as size;
    `);
    console.log(`\nDefault Tablespace Size: ${tablespaceResult[0]?.size}`);

  } catch (err: any) {
    console.error("Error checking sizes:", err.message || err);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
