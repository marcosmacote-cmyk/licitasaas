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
  const sheet = workbook.Sheets['Analítico'];
  if (!sheet) { console.log('No Analítico found'); return; }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  
  console.log(`Analítico has ${rows.length} rows`);
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    console.log(`Row ${i}:`, rows[i].slice(0, 10)); // print first 10 cols
  }
}
run();
