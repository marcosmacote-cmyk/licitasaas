import 'dotenv/config';
import { prisma } from '../lib/prisma';

async function main() {
  const dbs = await prisma.engineeringDatabase.findMany({
    orderBy: [
      { name: 'asc' },
      { uf: 'asc' },
      { referenceYear: 'desc' },
      { referenceMonth: 'desc' }
    ]
  });

  console.log(`Total databases: ${dbs.length}`);
  for (const db of dbs) {
    console.log(`- ID: ${db.id} | Name: ${db.name} | UF: ${db.uf} | Version: ${db.version} | Period: ${db.referenceMonth}/${db.referenceYear} | Regime: ${db.payrollExemption ? 'Desonerada' : 'Onerada'} | Items: ${db.itemCount} | Comps: ${db.compositionCount}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
