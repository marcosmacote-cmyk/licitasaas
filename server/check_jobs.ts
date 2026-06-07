import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});
async function main() {
  const jobs = await prisma.backgroundJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  console.log("=== RECENT BACKGROUND JOBS ===");
  jobs.forEach(j => {
    console.log(`ID: ${j.id}`);
    console.log(`Type: ${j.type}`);
    console.log(`Status: ${j.status}`);
    console.log(`Progress: ${j.progress}% - ${j.progressMsg}`);
    console.log(`Target: ${j.targetTitle} (ID: ${j.targetId})`);
    console.log(`Created: ${j.createdAt}`);
    if (j.error) {
      console.log(`Error: ${j.error}`);
    }
    console.log("--------------------------------------");
  });
}
main().finally(() => prisma.$disconnect());
