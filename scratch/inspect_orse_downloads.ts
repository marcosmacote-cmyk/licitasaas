import * as cheerio from 'cheerio';

async function main() {
  const url = 'https://orse.cehop.se.gov.br/downloads.asp?tarefa=consultar&base=orse';
  console.log(`Fetching downloads page...`);
  
  // Let's test for year 2026, 2025, 2024
  for (const year of [2026, 2025]) {
    console.log(`\n--- Year: ${year} ---`);
    const body = new URLSearchParams({ AnoORSE: String(year) });
    const res = await fetch(url, {
      method: 'POST',
      body,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    });

    if (!res.ok) {
      console.error(`HTTP error for ${year}: ${res.status}`);
      continue;
    }

    const buffer = await res.arrayBuffer();
    const html = new TextDecoder('iso-8859-1').decode(buffer);
    const $ = cheerio.load(html);

    $('tr').each((_, tr) => {
      const links = $(tr).find('a[href]');
      if (links.length === 0) return;
      
      const rowText = $(tr).text().replace(/\s+/g, ' ').trim();
      console.log(`Row: ${rowText}`);
      links.each((_, el) => {
        console.log(`  Link: ${$(el).attr('href')} | Text: ${$(el).text().trim()}`);
      });
    });
  }
}

main().catch(console.error);
