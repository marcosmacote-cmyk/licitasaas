import fetch from 'node-fetch';
import AdmZip from 'adm-zip';

async function main() {
  const url = "https://api.mziq.com/mzfilemanager/v2/d/2a1a75a3-21f9-46ef-9aa4-487f2d2b709b/24471ec8-e605-9afe-10e9-c0816306395c?origin=2"; // Janeiro 2026 zip
  console.log("Downloading Janeiro 2026 ZIP...");
  
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const entries = zip.getEntries();
  
  const entry = entries.find(e => e.entryName.includes("1. BANCO DE"));
  if (!entry) {
    console.error("1. BANCO DE not found!");
    return;
  }
  
  console.log(`Parsing ${entry.entryName}...`);
  const mod = require('pdf-parse');
  const pdfData = await mod(entry.getData());
  const text = pdfData.text || '';
  
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  console.log(`Total lines in PDF 1: ${lines.length}`);
  
  // Search for section headers
  const keywords = ["MATERIAIS", "INSUMO", "MÃO DE OBRA", "MAO DE OBRA", "EQUIPAMENTO", "SERVIÇO", "COMPOSIÇÃO", "TABELA DE PREÇOS"];
  
  console.log("\nSearching for potential section headers/keywords:");
  lines.forEach((line, idx) => {
    const upper = line.toUpperCase();
    if (keywords.some(k => upper.includes(k) && line.length < 50)) {
      console.log(`Line ${idx}: "${line}"`);
    }
  });

  // Let's print some lines from page headers
  console.log("\nSample header lines:");
  const headerLines = lines.filter(l => l.includes("Pág") || l.includes("PAG") || l.includes("CAERN") || l.includes("Tabela"));
  console.log(headerLines.slice(0, 10));
}

main().catch(console.error);
