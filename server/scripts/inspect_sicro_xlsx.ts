import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as XLSX from 'xlsx';
import { execSync } from 'child_process';

// Simple direct downloader & extractor for inspection
async function inspectSicro() {
  const uf = 'CE';
  const month = 1;
  const year = 2026;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sicro-inspect-'));
  const extractDir = path.join(tmpDir, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });

  const url = `https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/custos-referenciais/sistemas-de-custos/sicro/relatorios/relatorios-sicro/nordeste/ceara/2026/janeiro/ce-01-2026.7z`;

  console.log(`Downloading: ${url}`);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const filePath = path.join(tmpDir, 'ce-01-2026.7z');
    fs.writeFileSync(filePath, buffer);
    console.log("Download complete. Extracting...");

    const sevenBin = require('7zip-bin');
    execSync(`"${sevenBin.path7za}" x "${filePath}" -o"${extractDir}" -y`, { stdio: 'pipe' });
    console.log("Extraction complete.");

    // List all files in extractDir
    const files = readdirRecursive(extractDir);
    console.log("Extracted files:");
    files.forEach(f => console.log(` - ${path.basename(f)}`));

    // Inspect each excel file's sheets and columns
    for (const file of files) {
      if (!/\.xlsx$/i.test(file)) continue;
      const baseName = path.basename(file);
      console.log(`\n=========================================`);
      console.log(`File: ${baseName}`);
      console.log(`=========================================`);

      const workbook = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
      for (const sheetName of workbook.SheetNames) {
        console.log(`Sheet: "${sheetName}"`);
        const sheet = workbook.Sheets[sheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        
        console.log(`Total rows: ${rows.length}`);
        
        // Print first 5 rows (usually has headers or metadata)
        console.log("First 8 rows:");
        rows.slice(0, 8).forEach((row, i) => {
          console.log(`  Row ${i}:`, row.slice(0, 10).map(c => String(c).trim()));
        });
      }
    }
  } catch (error) {
    console.error("Error inspecting:", error);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function readdirRecursive(dir: string): string[] {
  const results: string[] = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results.push(...readdirRecursive(fullPath));
    } else {
      results.push(fullPath);
    }
  });
  return results;
}

inspectSicro();
