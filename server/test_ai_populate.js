const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const bidding = await prisma.biddingProcess.findFirst({
    where: { aiAnalysis: { isNot: null } },
    include: { aiAnalysis: true }
  });
  console.log("Bidding:", bidding?.id);
  console.log("Has items:", !!bidding?.aiAnalysis?.biddingItems);
  
  // Let's test the query
  const item = await prisma.engineeringItem.findFirst({ where: { code: "123" } });
  console.log("Item query works:", !!item);
}
run().catch(console.error).finally(() => prisma.$disconnect());
