import 'dotenv/config';
import { prisma } from '../lib/prisma';

async function main() {
  const dbs = await prisma.engineeringDatabase.findMany({
    where: { name: 'SICRO' },
    orderBy: [{ uf: 'asc' }, { referenceYear: 'desc' }, { referenceMonth: 'desc' }]
  });

  console.log(`Checking ${dbs.length} SICRO databases...`);
  
  let totalMisclassified = 0;
  
  for (const db of dbs) {
    const misclassifiedCount = await prisma.engineeringComposition.count({
      where: {
        databaseId: db.id,
        OR: [
          { code: { startsWith: 'M', mode: 'insensitive' } },
          { code: { startsWith: 'E', mode: 'insensitive' } },
          { code: { startsWith: 'P', mode: 'insensitive' } },
          { code: { startsWith: 'A', mode: 'insensitive' } }
        ]
      }
    });
    
    totalMisclassified += misclassifiedCount;
    
    console.log(`DB UF=${db.uf} | ${String(db.referenceMonth).padStart(2, '0')}/${db.referenceYear} | Regime=${db.payrollExemption ? 'Deson' : 'Oner'} | items=${db.itemCount} | comps=${db.compositionCount} | misclassified=${misclassifiedCount}`);
  }
  
  console.log(`\nTotal remaining misclassified: ${totalMisclassified}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
