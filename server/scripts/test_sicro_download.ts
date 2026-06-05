import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { syncSicro } from '../services/engineering/sicroCrawler';

async function testDownload() {
  console.log("Starting SICRO crawler test download...");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sicro-test-'));
  console.log(`Temp dir created: ${tmpDir}`);
  
  try {
    const report = await syncSicro({
      ufs: ['CE'],
      months: 1,
      targetPeriods: [{ month: 1, year: 2026 }],
      force: true
    });
    
    console.log("Report result:", JSON.stringify(report, null, 2));
  } catch (error) {
    console.error("Error running syncSicro:", error);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

testDownload();
