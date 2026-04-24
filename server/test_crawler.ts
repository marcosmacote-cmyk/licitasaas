import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

function parseExcelToItems(buffer: Buffer, uf?: string): any[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true });
  const items: any[] = [];
  const targetUf = (uf || 'CE').toUpperCase();

  const compSheets = ['CSD', 'CCD'];

  for (const sheetName of workbook.SheetNames) {
    const upper = sheetName.toUpperCase().trim();
    if (!compSheets.includes(upper)) continue;

    const rows: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    
    let headerIdx = -1, ufColIdx = -1;
    let codeCol = -1, descCol = -1, unitCol = -1;

    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const row = rows[i].map((c: any) => String(c).trim().toUpperCase());
      const ceIdx = row.indexOf(targetUf);
      if (ceIdx >= 0) {
        headerIdx = i;
        ufColIdx = ceIdx;
        for (let j = Math.max(0, i - 3); j <= i; j++) {
          const r2 = rows[j].map((c: any) => String(c).trim().toUpperCase());
          if (codeCol < 0) codeCol = r2.findIndex((c: string) => c.includes('CODIGO') || c.includes('CÓDIGO') || c === 'CÓDIGO SINAPI' || c.includes('COMPOSIÇÃO'));
          if (descCol < 0) descCol = r2.findIndex((c: string) => c.includes('DESCRI'));
          if (unitCol < 0) unitCol = r2.findIndex((c: string) => c.includes('UNID') || c === 'UN' || c === 'UNIDADE');
        }
        break;
      }
    }

    if (codeCol < 0) codeCol = 1; 
    if (descCol < 0) descCol = codeCol + 1;

    let count = 0;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      let code = String(r[codeCol] ?? '').trim();
      
      if (!code || code === '0' || code.length < 2) {
        const cell = workbook.Sheets[sheetName][XLSX.utils.encode_cell({ r: i, c: codeCol })];
        if (cell && cell.f) {
          const match = cell.f.match(/,?(\d+)\s*\)$/);
          if (match) code = match[1];
        }
      }

      if (count < 5 && (!code || code === '0' || code.length < 2)) {
         console.log(`Failed at row ${i}: code=${code}, cell=`, workbook.Sheets[sheetName][XLSX.utils.encode_cell({ r: i, c: codeCol })]);
      }

      const desc = String(r[descCol] ?? '').trim();
      if (!code || !desc || code.length < 2 || code === '0') continue;

      let price = 0;
      const raw = r[ufColIdx];
      if (typeof raw === 'number') price = raw;
      else if (raw) {
        const c = String(raw).replace(/[^\d.,\-]/g, '');
        price = c.includes(',') ? parseFloat(c.replace(/\./g, '').replace(',', '.')) || 0 : parseFloat(c.replace(/,/g, '')) || 0;
      }
      if (price <= 0) continue;

      items.push({ code, desc, price });
      count++;
    }
    console.log(`Parsed ${count} from ${sheetName}`);
  }
  return items;
}

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
  const items = parseExcelToItems(refBuf, 'CE');
  console.log('First 5:', items.slice(0, 5));
}
run();
