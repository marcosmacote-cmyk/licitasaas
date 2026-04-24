import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
const AdmZip = require('adm-zip');

async function run() {
  const fileUrl = 'https://www.caixa.gov.br/Downloads/sinapi-relatorios-mensais/SINAPI-2026-03-formato-xlsx.zip';
  const resp = await fetch(fileUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const buf = await resp.arrayBuffer();
  const zip = new AdmZip(Buffer.from(buf));
  
  let refBuf = null;
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.toUpperCase();
    if (name.includes('REFER') && name.endsWith('.XLSX')) {
       refBuf = entry.getData(); break;
    }
  }

  const workbook = XLSX.read(refBuf, { type: 'buffer' });
  const sheet = workbook.Sheets['Analítico com Custo'] || workbook.Sheets['Analítico'];
  if (!sheet) { console.log('No analitico found'); return; }

  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  
  console.log('First 20 rows of Analítico:');
  for (let i = 0; i < 20; i++) {
    console.log(`Row ${i}:`, rows[i].slice(0, 10)); // print first 10 cols
  }
}
run();
