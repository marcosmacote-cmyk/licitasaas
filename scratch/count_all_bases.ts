import pkg from '@prisma/client';
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function main() {
  const counts = await prisma.engineeringDatabase.groupBy({
    by: ['uf'],
    where: { name: 'SINAPI' },
    _count: { id: true }
  });

  const details = await prisma.engineeringDatabase.findMany({
    where: { name: 'SINAPI' },
    select: {
      uf: true,
      referenceMonth: true,
      referenceYear: true,
      payrollExemption: true,
      itemCount: true,
      compositionCount: true
    },
    orderBy: [
      { uf: 'asc' },
      { referenceYear: 'desc' },
      { referenceMonth: 'desc' },
      { payrollExemption: 'asc' }
    ]
  });

  console.log("=== RESUMO POR UF ===");
  const countMap = new Map<string, number>();
  for (const c of counts) {
    countMap.set(c.uf, c._count.id);
  }
  
  const allUfs = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
  for (const uf of allUfs) {
    console.log(`${uf}: ${countMap.get(uf) || 0} bases`);
  }

  console.log("\n=== TOP 20 MAIS RECENTES ===");
  for (const d of details.slice(0, 20)) {
    console.log(`UF: ${d.uf} | Period: ${d.referenceYear}-${d.referenceMonth} | Desonerado: ${d.payrollExemption} | Items: ${d.itemCount} | Comps: ${d.compositionCount}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
