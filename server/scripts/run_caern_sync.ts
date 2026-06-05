import { syncCaern } from '../services/engineering/caernCrawler';

async function main() {
  console.log("Running CAERN sync locally for 2024, 2025, 2026...");
  const report = await syncCaern({ years: [2026, 2025, 2024, 2023] });
  console.log("CAERN sync report:", JSON.stringify(report, null, 2));
}

main().catch(console.error);
