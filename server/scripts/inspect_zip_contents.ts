import fetch from 'node-fetch';
import AdmZip from 'adm-zip';

async function main() {
  const url = "https://api.mziq.com/mzfilemanager/v2/d/2a1a75a3-21f9-46ef-9aa4-487f2d2b709b/24471ec8-e605-9afe-10e9-c0816306395c?origin=2"; // Janeiro 2026 zip
  console.log("Downloading Janeiro 2026 ZIP...");
  
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!res.ok) {
    console.error(`Failed to download: HTTP ${res.status}`);
    return;
  }
  
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const entries = zip.getEntries();
  
  console.log(`Extracting and inspecting ${entries.length} files...`);
  
  const mod = require('pdf-parse');
  
  for (const entry of entries) {
    if (entry.isDirectory || !entry.entryName.toLowerCase().endsWith('.pdf')) continue;
    
    console.log(`\n======================================================`);
    console.log(`File: ${entry.entryName} (${entry.header.size} bytes)`);
    
    const buffer = entry.getData();
    
    let text = '';
    try {
      if (mod.PDFParse) {
        const parser = new mod.PDFParse(new Uint8Array(buffer));
        await parser.load();
        const r = await parser.getText();
        text = r.text || '';
      } else if (typeof mod === 'function') {
        const pdfData = await mod(buffer);
        text = pdfData.text || '';
      }
    } catch (e: any) {
      console.log(`Failed to parse PDF text: ${e.message}`);
      continue;
    }
    
    if (!text) {
      console.log("No text extracted.");
      continue;
    }
    
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    console.log(`Lines: ${lines.length}`);
    console.log(`First 40 lines:`);
    lines.slice(0, 40).forEach((l, i) => console.log(`  ${i}: "${l}"`));
    
    // Look at unit price patterns or code patterns
    const codes = lines.filter(l => /^\d{3,6}$/.test(l)).slice(0, 5);
    console.log(`Sample codes found:`, codes);
    
    // Check if it has lines matching our unit price regexes
    const KNOWN_UNITS_LIST = [
      'UN', 'M', 'M2', 'M²', 'M3', 'M³', 'KG', 'L', 'CJ', 'VB', 'GB', 'PC', 'H',
      'MÊS', 'MES', 'DIA', 'KM', 'PAR', 'JG', 'BD', 'GL', 'CX', 'TB', 'SC', 'LT',
      'TN', 'TF', 'CH', 'CM', 'T', 'KWH', 'HA', 'CHP', 'CHI', 'MJ', 'CONJ',
    ];
    const UNIT_PRICE_REGEX = new RegExp(
      `^(${KNOWN_UNITS_LIST.join('|')})\\s*(\\d[\\d.,]*?\\,\\d{2})\\s*(\\d[\\d.,]*?\\,\\d{2})\\s*$`, 'i'
    );
    const UNIT_SINGLE_PRICE_REGEX = new RegExp(
      `^(${KNOWN_UNITS_LIST.join('|')})\\s*(\\d[\\d.,]*?\\,\\d{2})\\s*$`, 'i'
    );
    
    const matches = lines.filter(l => UNIT_PRICE_REGEX.test(l) || UNIT_SINGLE_PRICE_REGEX.test(l)).slice(0, 5);
    console.log(`Sample matched price lines:`, matches);
  }
}

main().catch(console.error);
