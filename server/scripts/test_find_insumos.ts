import fetch from 'node-fetch';
import AdmZip from 'adm-zip';

async function main() {
  const url = 'https://api.mziq.com/mzfilemanager/v2/d/2a1a75a3-21f9-46ef-9aa4-487f2d2b709b/24471ec8-e605-9afe-10e9-c0816306395c?origin=2';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!res.ok) return;
  const buffer = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const entry = entries.find(e => e.entryName.includes('BANCO DE PREÇOS') || e.entryName.includes('1.'));
  if (!entry) return;
  const pdfBuffer = entry.getData();
  
  const mod = require('pdf-parse');
  let text = '';
  if (mod.PDFParse) {
    const parser = new mod.PDFParse(new Uint8Array(pdfBuffer));
    await parser.load();
    const r = await parser.getText();
    text = r.text || '';
  } else if (typeof mod === 'function') {
    const pdfData = await mod(pdfBuffer);
    text = pdfData.text || '';
  }
  
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  console.log(`Total lines: ${lines.length}`);
  
  // Search for keywords
  const keywords = ['insumo', 'material', 'mão de obra', 'equipamento', 'tabela de insumos'];
  for (const kw of keywords) {
    const idxs = [];
    lines.forEach((l, i) => {
      if (l.toLowerCase().includes(kw)) idxs.push(i);
    });
    console.log(`Keyword "${kw}" found ${idxs.length} times. First 5 line indexes:`, idxs.slice(0, 5));
    for (const idx of idxs.slice(0, 3)) {
      console.log(`  Line ${idx}: "${lines[idx]}"`);
      console.log(`    Lines around:`);
      for (let i = Math.max(0, idx - 2); i <= Math.min(lines.length - 1, idx + 4); i++) {
        console.log(`      ${i}: "${lines[i]}"`);
      }
    }
  }

  // Count 8-digit codes (SINAPI Insumo codes are 8 digits: e.g. 00001234 or 00045678)
  const eightDigitLines = [];
  lines.forEach((l, i) => {
    if (/^\d{8}$/.test(l)) eightDigitLines.push(i);
  });
  console.log(`Found ${eightDigitLines.length} lines with exactly 8-digit codes.`);
  for (const idx of eightDigitLines.slice(0, 5)) {
    console.log(`  Line ${idx}: "${lines[idx]}"`);
    console.log(`    Lines around:`);
    for (let i = Math.max(0, idx - 2); i <= Math.min(lines.length - 1, idx + 4); i++) {
      console.log(`      ${i}: "${lines[i]}"`);
    }
  }
}

main().catch(console.error);
