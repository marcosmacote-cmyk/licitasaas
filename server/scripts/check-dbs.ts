import { prisma } from '../lib/prisma';

async function main() {
  const dbs = await prisma.engineeringDatabase.findMany({
    where: {
      type: 'OFICIAL',
      name: 'SINAPI',
      referenceYear: 2023,
      referenceMonth: 9
    },
    select: {
      id: true,
      uf: true,
      referenceYear: true,
      referenceMonth: true,
      payrollExemption: true,
      createdAt: true
    }
  });
  console.log("Databases for 2023-09:", dbs);
}

main().finally(() => prisma.$disconnect());
