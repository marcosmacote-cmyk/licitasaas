import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  console.log("Dropping GIN indexes...");
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS eng_item_desc_trgm_idx;`);
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS eng_comp_desc_trgm_idx;`);
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS eng_item_code_trgm_idx;`);
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS eng_comp_code_trgm_idx;`);
  console.log("GIN indexes dropped successfully.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
