import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const biddings = await prisma.biddingProcess.findMany({
    include: { aiAnalysis: true }
  });
  console.log(JSON.stringify(biddings.map(b => ({
    id: b.id,
    title: b.title,
    modality: b.modality,
    hasAnalysis: !!b.aiAnalysis,
    requiredDocuments: b.aiAnalysis?.requiredDocuments ? JSON.stringify(b.aiAnalysis.requiredDocuments).substring(0, 300) : null,
    schemaV2: b.aiAnalysis?.schemaV2 ? JSON.stringify(b.aiAnalysis.schemaV2).substring(0, 300) : null,
  })), null, 2));
}
run().catch(console.error).finally(() => prisma.$disconnect());
