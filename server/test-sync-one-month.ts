import { syncSinapi } from './services/engineering/sinapiCrawler';
import { prisma } from './lib/prisma';

async function main() {
  // Setup environment for macOS running
  process.env.PUPPETEER_EXECUTABLE_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  process.env.DATABASE_URL = "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway";

  console.log('Starting sync for 2025-10...');
  try {
    const report = await syncSinapi({
      ufs: ['ALL'],
      months: 1,
      includeDesonerado: true,
      force: true, // Force to skip existing check
      targetPeriods: [{ month: 10, year: 2025 }]
    });
    console.log('Sync finished with report:', JSON.stringify(report, null, 2));
  } catch (err: any) {
    console.error('Fatal sync error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
