import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const gCount = await prisma.engineeringItem.count({
    where: { code: { startsWith: 'G' } }
  });
  const rCount = await prisma.engineeringItem.count({
    where: { code: { startsWith: 'R' } }
  });
  console.log(`\nContagem atual no Banco de Produção:`);
  console.log(`- Insumos 'G': ${gCount}`);
  console.log(`- Insumos 'R': ${rCount}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
