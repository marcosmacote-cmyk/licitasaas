import 'dotenv/config';
import { syncOrse } from '../services/engineering/orseCrawler';

async function main() {
  console.log("=== STARTING ORSE 36-MONTH HISTORICAL SYNC ===");
  const startedAt = new Date().toISOString();
  
  // Sincronizar os últimos 36 meses
  // force: false para não sobrescrever bases já importadas (otimização)
  const report = await syncOrse({ months: 36, force: false });
  
  const finishedAt = new Date().toISOString();
  console.log("\n=== ORSE SYNC COMPLETE ===");
  console.log(`Started: ${startedAt}`);
  console.log(`Finished: ${finishedAt}`);
  console.log(`Total Attempted: ${report.totalAttempted}`);
  console.log(`Total Success: ${report.totalSuccess}`);
  console.log(`Total Failed: ${report.totalFailed}`);
  
  console.log("\nResults Breakdown:");
  for (const res of report.results) {
    const statusSymbol = res.success ? "✅" : "❌";
    console.log(`${statusSymbol} [${res.period?.version || 'UNKNOWN'}] - ${res.message}`);
  }
}

main()
  .catch(error => {
    console.error("❌ Sync script error:", error);
    process.exit(1);
  });
