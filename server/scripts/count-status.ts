import { prisma } from '../lib/prisma';

async function main() {
  console.log('Counting official databases by month & regime...');
  const groups = await prisma.engineeringDatabase.groupBy({
    by: ['referenceYear', 'referenceMonth', 'payrollExemption'],
    where: {
      type: 'OFICIAL',
      name: 'SINAPI'
    },
    _count: {
      uf: true
    },
    _sum: {
      itemCount: true,
      compositionCount: true
    },
    orderBy: [
      { referenceYear: 'desc' },
      { referenceMonth: 'desc' }
    ]
  });

  console.log('\nYear-Month | Regime | UF Count | Sum Items | Sum Compositions');
  console.log('------------------------------------------------------------');
  for (const g of groups) {
    const period = `${g.referenceYear}-${String(g.referenceMonth).padStart(2, '0')}`;
    const regime = g.payrollExemption ? 'Desonerado' : 'Onerado';
    console.log(`${period} | ${regime.padEnd(10)} | ${String(g._count.uf).padStart(8)} | ${String(g._sum.itemCount || 0).padStart(9)} | ${String(g._sum.compositionCount || 0).padStart(16)}`);
    
    if (g._count.uf < 27) {
      const dbs = await prisma.engineeringDatabase.findMany({
        where: {
          type: 'OFICIAL',
          name: 'SINAPI',
          referenceYear: g.referenceYear,
          referenceMonth: g.referenceMonth,
          payrollExemption: g.payrollExemption
        },
        select: { uf: true }
      });
      const ufs = dbs.map(d => d.uf).sort();
      console.log(`  -> UFs present (${ufs.length}): ${ufs.join(', ')}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

