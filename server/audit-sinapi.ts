import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const bases = await prisma.engineeringDatabase.findMany({
    where: { name: 'SINAPI', uf: { in: ['CE', 'AC'] } },
    orderBy: [
      { uf: 'asc' },
      { referenceYear: 'desc' },
      { referenceMonth: 'desc' },
      { payrollExemption: 'asc' }
    ]
  });

  for (const b of bases) {
    console.log(`UF: ${b.uf} | Ano: ${b.referenceYear} | Mês: ${b.referenceMonth} | Desonerado: ${b.payrollExemption} | Itens: ${b.itemCount} | Composição: ${b.compositionCount}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
