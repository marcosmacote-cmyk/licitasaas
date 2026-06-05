import * as cheerio from 'cheerio';

async function main() {
  const url = 'https://orse.cehop.se.gov.br/servicosargumento.asp';
  console.log(`Fetching ${url}...`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    }
  });
  
  if (!res.ok) {
    console.error(`HTTP error: ${res.status}`);
    return;
  }
  
  const buffer = await res.arrayBuffer();
  const html = new TextDecoder('iso-8859-1').decode(buffer);
  const $ = cheerio.load(html);
  
  console.log("\n=== FORM FIELDS ===");
  $('form').each((i, form) => {
    console.log(`Form ${i}: name=${$(form).attr('name')}, action=${$(form).attr('action')}, method=${$(form).attr('method')}`);
    
    $(form).find('input, select, textarea').each((_, field) => {
      const name = $(field).attr('name');
      const type = $(field).attr('type') || field.tagName;
      const val = $(field).attr('value');
      
      if (type === 'select') {
        const options: string[] = [];
        $(field).find('option').each((_, opt) => {
          options.push(`${$(opt).attr('value')}: ${$(opt).text().trim()}`);
        });
        console.log(`  Field: ${name} [${type}] - Option count: ${options.length}`);
        if (name === 'sltFonte') {
          console.log("    Options:", options.slice(0, 10));
        }
      } else {
        console.log(`  Field: ${name} [${type}]${val ? ` value="${val}"` : ''}`);
      }
    });
  });
}

main().catch(console.error);
