import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

async function run() {
  const count = await prisma.engineeringComposition.count();
  console.log('Total Compositions:', count);
  const seinfra = await prisma.engineeringComposition.findFirst({
    where: { code: 'C2784' }
  });
  console.log('C2784:', seinfra);
}
run();
