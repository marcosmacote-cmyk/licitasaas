import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  console.log("=== Database check ===");
  const db = await prisma.engineeringDatabase.findUnique({
    where: { id: "7cbfaedb-fd58-4510-aa4d-f727f23b9f32" }
  });
  if (db) {
    console.log(`Database name: ${db.name}, Type: ${db.type}, UF: ${db.uf}`);
  } else {
    console.log("Database not found");
  }
}

main()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
