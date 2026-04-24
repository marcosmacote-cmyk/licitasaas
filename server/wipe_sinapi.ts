import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const dbs = await prisma.engineeringDatabase.findMany({
    where: { name: 'SINAPI', uf: 'CE', type: 'OFICIAL' }
  });
  
  for (const db of dbs) {
    console.log(`Deletando base ${db.id} - ${db.version} - Desonerado: ${db.payrollExemption}`);
    await prisma.engineeringDatabase.delete({ where: { id: db.id } });
  }
  console.log('Tudo limpo! Pode rodar o sync novamente.');
}
run();
