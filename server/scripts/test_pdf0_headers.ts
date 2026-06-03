import fetch from 'node-fetch';

async function main() {
  const url = "https://api.mziq.com/mzfilemanager/v2/d/2a1a75a3-21f9-46ef-9aa4-487f2d2b709b/ff79fc57-6f8a-8380-376a-bb10aeccfb0d?origin=2";
  console.log("Fetching PDF 0 URL:", url);
  
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  
  console.log("Response status:", res.status);
  console.log("Response headers:", JSON.stringify(Object.fromEntries(res.headers.entries()), null, 2));
  
  const buffer = Buffer.from(await res.arrayBuffer());
  console.log("Response size in bytes:", buffer.length);
  
  const sample = buffer.toString('utf8', 0, 500);
  console.log("First 500 bytes as string:");
  console.log(sample);
  
  const isPdf = sample.startsWith('%PDF');
  console.log("Is PDF (%PDF header present):", isPdf);
}

main().catch(console.error);
