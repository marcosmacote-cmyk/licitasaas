import fetch from 'node-fetch';
import AdmZip from 'adm-zip';

async function main() {
  const url = 'https://api.mziq.com/mzfilemanager/v2/d/2a1a75a3-21f9-46ef-9aa4-487f2d2b709b/ff79fc57-6f8a-8380-376a-bb10aeccfb0d?origin=2';
  console.log(`Downloading Julho 2025 zip from ${url}...`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!res.ok) {
    console.error(`HTTP Error: ${res.status}`);
    return;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  console.log(`Julho 2025 zip has ${entries.length} entries:`);
  for (const entry of entries) {
    console.log(`- ${entry.entryName} (IsDir: ${entry.isDirectory}, Size: ${entry.header.size} bytes)`);
  }
}

main().catch(console.error);
