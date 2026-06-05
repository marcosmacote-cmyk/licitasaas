import fetch from 'node-fetch';
import AdmZip from 'adm-zip';

async function main() {
  const url = 'https://api.mziq.com/mzfilemanager/v2/d/2a1a75a3-21f9-46ef-9aa4-487f2d2b709b/24471ec8-e605-9afe-10e9-c0816306395c?origin=2';
  console.log(`Downloading Janeiro 2026 zip from ${url}...`);
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
  
  // Find "1. BANCO DE PREÇOS"
  const entry = entries.find(e => e.entryName.includes('BANCO DE PREÇOS') || e.entryName.includes('1.'));
  if (!entry) {
    console.error("1. BANCO DE PREÇOS entry not found in zip!");
    return;
  }
  
  console.log(`Extracting ${entry.entryName} (${entry.header.size} bytes)...`);
  const pdfBuffer = entry.getData();
  
  // Parse PDF
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
  
  if (!text) {
    console.error("Could not extract text from PDF!");
    return;
  }
  
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  console.log(`Total lines extracted: ${lines.length}`);
  console.log("First 100 lines of Banco de Preços:");
  lines.slice(0, 100).forEach((l, idx) => console.log(`  ${idx}: "${l}"`));
}

main().catch(console.error);
