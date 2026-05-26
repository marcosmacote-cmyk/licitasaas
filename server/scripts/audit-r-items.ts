import * as XLSX from 'xlsx';

const url = 'https://sin.seinfra.ce.gov.br/site-seinfra/siproce/onerada/Tabela-de-Insumos-028---ENC.-SOCIAIS-114,15.xls';

async function main() {
  console.log("⬇️ Baixando planilha para ver itens com 'R'...");
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const items: any[] = [];
  
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    
    for (const row of rows) {
      if (!row || row.length < 3) continue;
      const code = String(row[0] || '').trim().toUpperCase();
      const desc = String(row[1] || '').trim();
      const unit = String(row[2] || '').trim();
      const price = typeof row[3] === 'number' ? row[3] : parseFloat(String(row[3] || '0').replace('.', '').replace(',', '.')) || 0;
      
      if (code.startsWith('R')) {
        items.push({ code, desc, unit, price });
      }
    }
  }
  
  console.log(`\nEncontrados ${items.length} itens iniciados com 'R':`);
  console.log(items);
}

main().catch(console.error);
