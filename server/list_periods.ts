import pkg from '@prisma/client';
const { PrismaClient } = pkg;
const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const periods = await prisma.engineeringDatabase.findMany({
    where: { name: 'SINAPI' },
    select: {
      uf: true,
      referenceMonth: true,
      referenceYear: true,
      payrollExemption: true
    },
    orderBy: [
      { referenceYear: 'desc' },
      { referenceMonth: 'desc' }
    ]
  });

  const ufPeriods = new Map<string, string[]>();
  for (const p of periods) {
    const key = `${p.referenceYear}-${String(p.referenceMonth).padStart(2, '0')} (${p.payrollExemption ? 'D' : 'O'})`;
    if (p.uf) {
      if (!ufPeriods.has(p.uf)) ufPeriods.set(p.uf, []);
      ufPeriods.get(p.uf)!.push(key);
    }
  }

  for (const [uf, list] of ufPeriods.entries()) {
    console.log(`${uf} (${list.length}): ${list.slice(0, 10).join(', ')}${list.length > 10 ? ' ...' : ''}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
