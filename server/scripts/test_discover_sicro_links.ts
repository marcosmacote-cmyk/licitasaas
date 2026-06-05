import 'dotenv/config';
import * as cheerio from 'cheerio';

async function discoverLinks() {
  const url = 'https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/custos-referenciais/sistemas-de-custos/sicro/relatorios/relatorios-sicro/nordeste/ceara/2026/janeiro/janeiro-2026';
  const url2 = 'https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/custos-referenciais/sistemas-de-custos/sicro/relatorios/relatorios-sicro/nordeste/ceara/2026/janeiro';

  const urls = [url, url2];

  for (const targetUrl of urls) {
    console.log(`\nFetching: ${targetUrl}`);
    try {
      const response = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
      });
      console.log(`Status: ${response.status} ${response.statusText}`);
      if (!response.ok) continue;

      const html = await response.text();
      const $ = cheerio.load(html);
      
      console.log("Found links:");
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (href && (href.includes('.7z') || href.includes('.zip') || href.includes('.xlsx') || href.includes('desonera') || href.includes('relatorios-sicro'))) {
          console.log(` - Text: "${text}" | Href: "${href}"`);
        }
      });
    } catch (e: any) {
      console.error(`Error fetching: ${e.message}`);
    }
  }
}

discoverLinks();
