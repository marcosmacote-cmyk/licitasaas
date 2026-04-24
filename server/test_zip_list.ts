const AdmZip = require('adm-zip');

async function run() {
  const fileUrl = 'https://www.caixa.gov.br/Downloads/sinapi-relatorios-mensais/SINAPI-2026-03-formato-xlsx.zip';
  const resp = await fetch(fileUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const buf = await resp.arrayBuffer();
  const zip = new AdmZip(Buffer.from(buf));
  
  console.log('Zip Entries:');
  for (const entry of zip.getEntries()) {
    console.log(entry.entryName);
  }
}
run();
