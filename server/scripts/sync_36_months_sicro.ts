import 'dotenv/config';
import { syncSicro } from '../services/engineering/sicroCrawler';

async function main() {
  console.log("=== STARTING SICRO 36-MONTH HISTORICAL SYNC ===");
  const startedAt = new Date().toISOString();
  
  // Sync last 36 months for CE (Ceará)
  // force: false to avoid overwriting existing databases for speed and efficiency
  const report = await syncSicro({
    ufs: ['CE'],
    months: 36,
    force: false
  });
  
  const finishedAt = new Date().toISOString();
  console.log("\n=== SICRO SYNC COMPLETE ===");
  console.log(`Started: ${startedAt}`);
  console.log(`Finished: ${finishedAt}`);
  console.log(`Total Attempted: ${report.totalAttempted}`);
  console.log(`Total Success: ${report.totalSuccess}`);
  console.log(`Total Failed: ${report.totalFailed}`);
  
  console.log("\nResults Breakdown:");
  for (const res of report.results) {
    const statusSymbol = res.success ? "✅" : "❌";
    console.log(`${statusSymbol} - ${res.message}`);
  }
}

main()
  .catch(error => {
    console.error("❌ Sync script error:", error);
    process.exit(1);
  });
