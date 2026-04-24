import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const dbs = await prisma.engineeringDatabase.findMany({
    where: { name: 'SINAPI' }
  });
  console.log(dbs.map(d => `${d.uf} ${d.referenceMonth}/${d.referenceYear} ${d.payrollExemption ? 'Desonerado' : 'Onerado'}: Items=${d.itemCount}, Comps=${d.compositionCount}`));
}
run();
