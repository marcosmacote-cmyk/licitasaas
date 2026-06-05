import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as XLSX from 'xlsx';
import { execSync } from 'child_process';

async function inspectAnalytical() {
  const url = `https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/custos-referenciais/sistemas-de-custos/sicro/relatorios/relatorios-sicro/nordeste/ceara/2026/janeiro/ce-01-2026.7z`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sicro-inspect-analytic-'));
  const filePath = path.join(tmpDir, 'ce-01-2026.7z');
  const extractDir = path.join(tmpDir, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });

  console.log("Downloading...");
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error("Fetch failed");
    fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
    
    console.log("Extracting...");
    const sevenBin = require('7zip-bin');
    execSync(`"${sevenBin.path7za}" x "${filePath}" -o"${extractDir}" -y`, { stdio: 'pipe' });

    const targetFile = fs.readdirSync(extractDir).find(f => f.includes('Relatório Analítico de Composições de Custos.xlsx'));
    if (!targetFile) throw new Error("Analytical file not found");
    const fullPath = path.join(extractDir, targetFile);

    console.log(`Loading workbook: ${targetFile}`);
    const workbook = XLSX.read(fs.readFileSync(fullPath), { type: 'buffer' });
    console.log("Sheets:", workbook.SheetNames);
    
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    console.log(`Total rows: ${rows.length}`);
    
    // Let's find some composition header and print its rows to see how items and prices are presented.
    let printedComps = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i].map(c => String(c).trim());
      // A composition header usually starts with a 7-digit code in the first column
      if (/^\d{7}$/.test(row[0]) && printedComps < 3) {
        console.log(`\n--- Composition found at row ${i} ---`);
        for (let j = Math.max(0, i - 2); j < Math.min(rows.length, i + 15); j++) {
          console.log(`Row ${j}:`, rows[j].map(c => String(c).trim()));
        }
        printedComps++;
        i += 15; // skip details
      }
    }

  } catch (e: any) {
    console.error("Error:", e.message);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

inspectAnalytical();
