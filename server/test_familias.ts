import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
const AdmZip = require('adm-zip');

async function run() {
  const fileUrl = 'https://www.caixa.gov.br/Downloads/sinapi-relatorios-mensais/SINAPI-2026-03-formato-xlsx.zip';
  const resp = await fetch(fileUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const buf = await resp.arrayBuffer();
  const zip = new AdmZip(Buffer.from(buf));
  
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.toUpperCase();
    if (name.includes('FAMILIAS_E_COEFICIENTES') && name.endsWith('.XLSX')) {
       const refBuf = entry.getData();
       const workbook = XLSX.read(refBuf, { type: 'buffer' });
       for (const sheetName of workbook.SheetNames) {
           const sheet = workbook.Sheets[sheetName];
           const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
           console.log(`\n--- First 20 rows of ${sheetName} ---`);
           for (let i = 0; i < 20; i++) {
               console.log(rows[i]?.slice(0, 10));
           }
       }
    }
  }
}
run();
