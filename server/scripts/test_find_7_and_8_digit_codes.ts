import fetch from 'node-fetch';

const urls = [
  'https://api.mziq.com/mzfilemanager/v2/d/2a1a75a3-21f9-46ef-9aa4-487f2d2b709b/6179bb18-4766-7bec-1b62-8914fd1a1633?origin=2', // PDF 1
  'https://api.mziq.com/mzfilemanager/v2/d/2a1a75a3-21f9-46ef-9aa4-487f2d2b709b/5c92c81e-e516-f24f-a23b-d794b8d4af4f?origin=2', // PDF 2
  'https://api.mziq.com/mzfilemanager/v2/d/2a1a75a3-21f9-46ef-9aa4-487f2d2b709b/6f57881c-ce79-6738-5e04-958dbac4b1a8?origin=2'  // PDF 3
];

async function inspectUrl(url: string, index: number) {
  console.log(`\n===================================`);
  console.log(`Downloading PDF ${index + 1}...`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!res.ok) {
    console.error(`Failed: HTTP ${res.status}`);
    return;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  
  const mod = require('pdf-parse');
  let text = '';
  if (mod.PDFParse) {
    const parser = new mod.PDFParse(new Uint8Array(buffer));
    await parser.load();
    const r = await parser.getText();
    text = r.text || '';
  } else if (typeof mod === 'function') {
    const pdfData = await mod(buffer);
    text = pdfData.text || '';
  }
  
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  console.log(`PDF ${index + 1}: Total lines = ${lines.length}`);
  
  // Look for 7-digit numbers
  const sevenDigitLines = [];
  lines.forEach((l, i) => {
    if (/^\d{7}$/.test(l)) sevenDigitLines.push(i);
  });
  console.log(`Found ${sevenDigitLines.length} lines with exactly 7-digit codes.`);
  for (const idx of sevenDigitLines.slice(0, 5)) {
    console.log(`  Line ${idx}: "${lines[idx]}"`);
    for (let i = Math.max(0, idx - 2); i <= Math.min(lines.length - 1, idx + 4); i++) {
      console.log(`    ${i === idx ? '->' : '  '} ${i}: "${lines[i]}"`);
    }
  }

  // Look for 8-digit numbers
  const eightDigitLines = [];
  lines.forEach((l, i) => {
    if (/^\d{8}$/.test(l)) eightDigitLines.push(i);
  });
  console.log(`Found ${eightDigitLines.length} lines with exactly 8-digit codes.`);
  for (const idx of eightDigitLines.slice(0, 5)) {
    console.log(`  Line ${idx}: "${lines[idx]}"`);
    for (let i = Math.max(0, idx - 2); i <= Math.min(lines.length - 1, idx + 4); i++) {
      console.log(`    ${i === idx ? '->' : '  '} ${i}: "${lines[i]}"`);
    }
  }
}

async function main() {
  for (let i = 0; i < urls.length; i++) {
    await inspectUrl(urls[i], i);
  }
}

main().catch(console.error);
