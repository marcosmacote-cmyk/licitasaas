import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  console.log("=== BUSCANDO ITENS QUE TERMINAM COM '0698' EM TODO O BANCO ===");
  const items = await prisma.engineeringItem.findMany({
    where: { code: { endsWith: "0698" } },
    include: { database: true },
    take: 50
  });
  console.log(`Encontrados ${items.length} insumos terminando com '0698':`);
  console.log(items.map(i => ({ code: i.code, type: i.type, desc: i.description.substring(0, 60), base: `${i.database.name} ${i.database.uf || ''}` })));

  const comps = await prisma.engineeringComposition.findMany({
    where: { code: { endsWith: "0698" } },
    include: { database: true },
    take: 50
  });
  console.log(`\nEncontradas ${comps.length} composições terminando com '0698':`);
  console.log(comps.map(c => ({ code: c.code, desc: c.description.substring(0, 60), base: `${c.database.name} ${c.database.uf || ''}` })));

  console.log("\n=== BUSCANDO 'ARAME' NA SEINFRA CE ===");
  const arames = await prisma.engineeringItem.findMany({
    where: {
      database: { name: { contains: "SEINFRA", mode: 'insensitive' } },
      description: { contains: "arame", mode: 'insensitive' }
    },
    include: { database: true },
    take: 10
  });
  console.log("Amostra de insumos com 'arame' na SEINFRA CE:", arames.map(a => ({ code: a.code, desc: a.description.substring(0, 60), base: a.database.name })));

  console.log("\n=== CONTAGEM GERAL DE CÓDIGOS QUE INICIAM COM 'G' EM TODO O BANCO ===");
  const countGAllItems = await prisma.engineeringItem.count({
    where: { code: { startsWith: "G", mode: 'insensitive' } }
  });
  console.log("Total de insumos com código iniciando com 'G' em todo o banco:", countGAllItems);

  const countGAllComps = await prisma.engineeringComposition.count({
    where: { code: { startsWith: "G", mode: 'insensitive' } }
  });
  console.log("Total de composições com código iniciando com 'G' em todo o banco:", countGAllComps);

  if (countGAllItems > 0) {
    const gAllItems = await prisma.engineeringItem.findMany({
      where: { code: { startsWith: "G", mode: 'insensitive' } },
      include: { database: true },
      take: 10
    });
    console.log("Amostra de insumos iniciando com 'G' no banco:", gAllItems.map(i => ({ code: i.code, desc: i.description.substring(0, 60), base: i.database.name })));
  }

  if (countGAllComps > 0) {
    const gAllComps = await prisma.engineeringComposition.findMany({
      where: { code: { startsWith: "G", mode: 'insensitive' } },
      include: { database: true },
      take: 10
    });
    console.log("Amostra de composições iniciando com 'G' no banco:", gAllComps.map(c => ({ code: c.code, desc: c.description.substring(0, 60), base: c.database.name })));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
