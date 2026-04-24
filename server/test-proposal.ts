import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const proposalItems = await prisma.engineeringProposalItem.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log(proposalItems);
}
run();
