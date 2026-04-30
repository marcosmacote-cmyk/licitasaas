/**
 * SBC Crawler — Informativo SBC (informativosbc.com.br)
 * Strategy: Puppeteer login → extract session guid → HTTP POST scrape → parse HTML tables
 * 
 * SBC uses a Magic Web Gateway (MGW) with session-based GUIDs.
 * All data queries go through POST to /mgw with hidden fields MGWCHD, wlapp, guid.
 * 
 * Data structure:
 *   - Insumos: Código, Descrição, Unidade, Preço Unit.
 *   - Composições: Código, Descrição, Unidade, Preço Unit. (with drill-down analytical)
 *   - 30 regions (praças) across Brazil
 *   - Monthly data references (DTBASE in YYYYMMDD format)
 */
import * as cheerio from 'cheerio';
import { prisma } from '../../lib/prisma';

// ═══════════════════════════════════════════════════════════
// SBC Region codes → UF mapping
// Each region is a city/market (praça), mapped to the state
// ═══════════════════════════════════════════════════════════
const SBC_REGIONS: { code: string; name: string; uf: string }[] = [
  { code: 'AJU', name: 'Aracajú', uf: 'SE' },
  { code: 'BHE', name: 'Belo Horizonte', uf: 'MG' },
  { code: 'BLM', name: 'Belém', uf: 'PA' },
  { code: 'BSA', name: 'Brasília', uf: 'DF' },
  { code: 'BVA', name: 'Boa Vista', uf: 'RR' },
  { code: 'CBA', name: 'Cuiabá', uf: 'MT' },
  { code: 'CPE', name: 'Campo Grande', uf: 'MS' },
  { code: 'CTA', name: 'Curitiba', uf: 'PR' },
  { code: 'FLA', name: 'Fortaleza', uf: 'CE' },
  { code: 'FNS', name: 'Florianópolis', uf: 'SC' },
  { code: 'GNA', name: 'Goiânia', uf: 'GO' },
  { code: 'JFA', name: 'Juiz de Fora', uf: 'MG' },
  { code: 'JPA', name: 'João Pessoa', uf: 'PB' },
  { code: 'MCO', name: 'Maceió', uf: 'AL' },
  { code: 'MNS', name: 'Manaus', uf: 'AM' },
  { code: 'MPA', name: 'Macapá', uf: 'AP' },
  { code: 'NTL', name: 'Natal', uf: 'RN' },
  { code: 'PAE', name: 'Porto Alegre', uf: 'RS' },
  { code: 'PMG', name: 'Palmas', uf: 'TO' },
  { code: 'PVO', name: 'Porto Velho', uf: 'RO' },
  { code: 'RBO', name: 'Rio Branco', uf: 'AC' },
  { code: 'RCE', name: 'Recife', uf: 'PE' },
  { code: 'RJO', name: 'Rio de Janeiro', uf: 'RJ' },
  { code: 'RPO', name: 'Ribeirão Preto', uf: 'SP' },
  { code: 'SDR', name: 'Salvador', uf: 'BA' },
  { code: 'SLS', name: 'São Luis', uf: 'MA' },
  { code: 'SPO', name: 'São Paulo', uf: 'SP' },
  { code: 'TSA', name: 'Teresina', uf: 'PI' },
  { code: 'ULA', name: 'Uberlândia', uf: 'MG' },
  { code: 'VTA', name: 'Vitória', uf: 'ES' },
];

const MGW_URL = 'https://informativosbc.com.br/mgw';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════
interface ParsedItem {
  code: string;
  description: string;
  unit: string;
  price: number;
  type: string;
}

interface SyncResult {
  success: boolean;
  message: string;
  databaseId?: string;
  itemCount?: number;
  compositionCount?: number;
}

// ═══════════════════════════════════════════════════════════
// Step 1: Login via Puppeteer and extract session GUID + cookies
// ═══════════════════════════════════════════════════════════
async function loginAndGetSession(email: string, password: string): Promise<{ guid: string; cookies: string } | null> {
  let puppeteer: any;
  try {
    puppeteer = require('puppeteer-core');
  } catch (e) {
    try { puppeteer = require('puppeteer'); } catch (e2) {
      console.error('[SBC Crawler] Puppeteer not available');
      return null;
    }
  }

  const chromePaths = [
    '/usr/bin/chromium-browser',  // Alpine/Railway
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    process.env.CHROME_PATH,
  ].filter(Boolean);

  let browser: any = null;
  for (const chromePath of chromePaths) {
    try {
      browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      break;
    } catch (e) { continue; }
  }

  if (!browser) {
    console.error('[SBC Crawler] ❌ Could not launch Puppeteer');
    return null;
  }

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    // Navigate to login page
    await page.goto('https://informativosbc.com.br/index1.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    // Fill login form - find the email/password fields
    // The login form uses standard input fields
    const frames = page.frames();
    let loginFrame = page;

    // Try to find the login form in iframes or main frame
    for (const frame of frames) {
      try {
        const hasLoginForm = await frame.evaluate(() => {
          const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="password"]');
          return inputs.length >= 2;
        });
        if (hasLoginForm) {
          loginFrame = frame;
          break;
        }
      } catch (e) { continue; }
    }

    // Type credentials
    await loginFrame.evaluate((e: string, p: string) => {
      const inputs = document.querySelectorAll('input');
      let emailField: any = null;
      let passField: any = null;
      for (const inp of inputs) {
        const type = inp.type.toLowerCase();
        const name = (inp.name || '').toLowerCase();
        const placeholder = (inp.placeholder || '').toLowerCase();
        if (type === 'password' || name.includes('senha') || name.includes('pass')) {
          passField = inp;
        } else if (type === 'text' || type === 'email' || name.includes('email') || name.includes('user') || name.includes('login')) {
          emailField = inp;
        }
      }
      if (emailField) { emailField.value = e; emailField.dispatchEvent(new Event('input', { bubbles: true })); }
      if (passField) { passField.value = p; passField.dispatchEvent(new Event('input', { bubbles: true })); }
    }, email, password);

    await new Promise(r => setTimeout(r, 500));

    // Submit the form
    await loginFrame.evaluate(() => {
      const btn = document.querySelector('input[type="submit"], button[type="submit"], .ls-btn-primary') as any;
      if (btn) btn.click();
      else {
        const form = document.querySelector('form');
        if (form) form.submit();
      }
    });

    // Wait for navigation after login
    await new Promise(r => setTimeout(r, 5000));

    // Now navigate to Insumos to get a page with GUID
    await page.goto('https://informativosbc.com.br/mgw?MGWCHD=0&wlapp=SBC&trgt=_blank&orgn=insumos1', {
      waitUntil: 'networkidle2', timeout: 30000
    });
    await new Promise(r => setTimeout(r, 3000));

    // Extract GUID from the page
    let guid = '';
    const allFrames = page.frames();
    for (const frame of allFrames) {
      try {
        const foundGuid = await frame.evaluate(() => {
          // Look for guid in hidden inputs
          const input = document.querySelector('input[name="guid"]') as HTMLInputElement;
          if (input) return input.value;
          // Look for guid in URL
          const url = window.location.href;
          const match = url.match(/guid=([^&]+)/);
          if (match) return match[1];
          // Look for guid in any form action
          const form = document.querySelector('form');
          if (form) {
            const action = form.action;
            const actionMatch = action.match(/guid=([^&]+)/);
            if (actionMatch) return actionMatch[1];
          }
          return '';
        });
        if (foundGuid) {
          guid = foundGuid;
          break;
        }
      } catch (e) { continue; }
    }

    // Extract cookies
    const cookieArray = await page.cookies();
    const cookies = cookieArray.map((c: any) => `${c.name}=${c.value}`).join('; ');

    console.log(`[SBC Crawler] ✅ Login OK, guid=${guid ? guid.substring(0, 10) + '...' : 'NOT FOUND'}, cookies=${cookies.length} chars`);

    await browser.close();
    return guid ? { guid, cookies } : null;

  } catch (e: any) {
    console.error(`[SBC Crawler] ❌ Login error: ${e.message}`);
    try { await browser.close(); } catch (_) {}
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// Step 2: Fetch insumos/composições via HTTP POST
// ═══════════════════════════════════════════════════════════
async function fetchSbcData(
  guid: string,
  cookies: string,
  type: 'insumos' | 'composicoes',
  regionCode: string,
  dtBase: string,
  keyword: string = ''
): Promise<ParsedItem[]> {
  const items: ParsedItem[] = [];

  // Build form data
  const formData = new URLSearchParams();
  formData.append('MGWCHD', '0');
  formData.append('wlapp', 'SBC');
  formData.append('guid', guid);
  formData.append('Chave', keyword); // código
  formData.append('TPFILTRO', '1'); // CONTÉM
  formData.append('Chave', keyword); // palavra chave (yes, same name twice)
  formData.append('LOC', regionCode);
  formData.append('DTBASE', dtBase);

  if (type === 'composicoes') {
    formData.append('ITENS', 'TODOS');
  }

  try {
    const response = await fetch(MGW_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://informativosbc.com.br/mgw',
        'Origin': 'https://informativosbc.com.br',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      console.log(`[SBC Crawler] ⚠️ HTTP ${response.status} for ${type} ${regionCode} ${dtBase}`);
      return [];
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Parse the HTML table
    // SBC tables have columns: Código | Descrição | Unidade | Preço Unit.
    const rows = $('table tr, .ls-table tr, tbody tr');
    
    rows.each((_: number, row: any) => {
      const cells = $(row).find('td');
      if (cells.length < 3) return;

      const code = $(cells[0]).text().trim();
      const description = $(cells[1]).text().trim();

      if (!code || !description || code.length < 1) return;
      if (code.toUpperCase() === 'CÓDIGO' || code.toUpperCase() === 'CODIGO') return; // header row

      // Find unit and price columns (may vary)
      let unit = '';
      let price = 0;

      if (cells.length >= 4) {
        // Standard layout: Code | Description | Unit | Price
        unit = $(cells[cells.length - 2]).text().trim();
        const priceText = $(cells[cells.length - 1]).text().trim();
        price = parseBrazilianPrice(priceText);
      } else if (cells.length === 3) {
        unit = $(cells[2]).text().trim();
      }

      if (!unit) unit = 'UN';
      
      const itemType = type === 'composicoes' ? 'SERVICO' : 'MATERIAL';

      items.push({ code, description, unit, price, type: itemType });
    });

    // Also try parsing divs with structured data (some SBC pages use divs instead of tables)
    if (items.length === 0) {
      // Try alternative parsing for div-based layouts
      $('div[class*="row"], div[class*="item"], div[class*="resultado"]').each((_: number, div: any) => {
        const text = $(div).text().trim();
        // Try to extract code | description | unit | price pattern
        const parts = text.split(/\t|\n/).map((s: string) => s.trim()).filter(Boolean);
        if (parts.length >= 3) {
          const code = parts[0];
          const desc = parts[1];
          if (code && desc && code.length < 20 && desc.length > 3) {
            const unit = parts.length >= 4 ? parts[parts.length - 2] : 'UN';
            const price = parts.length >= 4 ? parseBrazilianPrice(parts[parts.length - 1]) : 0;
            items.push({ code, description: desc, unit, price, type: type === 'composicoes' ? 'SERVICO' : 'MATERIAL' });
          }
        }
      });
    }

  } catch (e: any) {
    console.error(`[SBC Crawler] ❌ Fetch error: ${e.message}`);
  }

  return items;
}

function parseBrazilianPrice(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/[^\d.,\-]/g, '');
  if (!cleaned) return 0;
  // Brazilian format: 1.234,56
  if (cleaned.includes(',') && (!cleaned.includes('.') || cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.'))) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  }
  return parseFloat(cleaned.replace(/,/g, '')) || 0;
}

// ═══════════════════════════════════════════════════════════
// Step 3: Fetch ALL insumos for a region by iterating alphabet
// SBC requires a keyword, so we iterate A-Z to get full coverage
// ═══════════════════════════════════════════════════════════
async function fetchAllInsumos(guid: string, cookies: string, regionCode: string, dtBase: string): Promise<ParsedItem[]> {
  const allItems = new Map<string, ParsedItem>();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  
  // First try empty keyword (might return all)
  const allResult = await fetchSbcData(guid, cookies, 'insumos', regionCode, dtBase, '');
  if (allResult.length > 50) {
    // Got a good batch, return it
    for (const item of allResult) allItems.set(item.code, item);
    console.log(`[SBC Crawler] 📋 ${regionCode}: ${allItems.size} insumos (full query)`);
    return Array.from(allItems.values());
  }

  // Otherwise iterate letter by letter
  for (const letter of alphabet) {
    const result = await fetchSbcData(guid, cookies, 'insumos', regionCode, dtBase, letter);
    for (const item of result) allItems.set(item.code, item);
    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }

  // Also try number prefixes for code-based items
  for (let i = 0; i <= 9; i++) {
    const result = await fetchSbcData(guid, cookies, 'insumos', regionCode, dtBase, String(i));
    for (const item of result) allItems.set(item.code, item);
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`[SBC Crawler] 📋 ${regionCode}: ${allItems.size} insumos (A-Z + 0-9 scan)`);
  return Array.from(allItems.values());
}

async function fetchAllComposicoes(guid: string, cookies: string, regionCode: string, dtBase: string): Promise<ParsedItem[]> {
  const allItems = new Map<string, ParsedItem>();

  // Try empty keyword first
  const allResult = await fetchSbcData(guid, cookies, 'composicoes', regionCode, dtBase, '');
  if (allResult.length > 50) {
    for (const item of allResult) allItems.set(item.code, item);
    console.log(`[SBC Crawler] 📋 ${regionCode}: ${allItems.size} composições (full query)`);
    return Array.from(allItems.values());
  }

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  for (const letter of alphabet) {
    const result = await fetchSbcData(guid, cookies, 'composicoes', regionCode, dtBase, letter);
    for (const item of result) allItems.set(item.code, item);
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`[SBC Crawler] 📋 ${regionCode}: ${allItems.size} composições (A-Z scan)`);
  return Array.from(allItems.values());
}

// ═══════════════════════════════════════════════════════════
// Step 4: Persist to database
// ═══════════════════════════════════════════════════════════
async function persistSbcItems(regionCode: string, uf: string, month: number, year: number, data: ParsedItem[]): Promise<SyncResult> {
  const baseName = 'SBC';
  const version = `${String(month).padStart(2, '0')}/${year}`;

  let db = await prisma.engineeringDatabase.findFirst({
    where: { name: baseName, uf, referenceMonth: month, referenceYear: year, type: 'OFICIAL' }
  });

  if (db) {
    await prisma.engineeringItem.deleteMany({ where: { databaseId: db.id } });
    await prisma.engineeringComposition.deleteMany({ where: { databaseId: db.id } });
  } else {
    db = await prisma.engineeringDatabase.create({
      data: {
        name: baseName,
        uf: `${uf}-${regionCode}`,
        version,
        type: 'OFICIAL',
        payrollExemption: false,
        referenceMonth: month,
        referenceYear: year,
      }
    });
  }

  const basicItems = data.filter(it => it.type !== 'SERVICO');
  const serviceItems = data.filter(it => it.type === 'SERVICO');

  let insertedItems = 0;
  for (let i = 0; i < basicItems.length; i += 1000) {
    const r = await prisma.engineeringItem.createMany({
      data: basicItems.slice(i, i + 1000).map(it => ({ databaseId: db!.id, ...it })),
      skipDuplicates: true
    });
    insertedItems += r.count;
  }

  let insertedComps = 0;
  for (let i = 0; i < serviceItems.length; i += 1000) {
    const chunk = serviceItems.slice(i, i + 1000);
    const r = await prisma.engineeringComposition.createMany({
      data: chunk.map(svc => ({ databaseId: db!.id, code: svc.code, description: svc.description, unit: svc.unit, totalPrice: svc.price })),
      skipDuplicates: true
    });
    insertedComps += r.count;
  }

  await prisma.engineeringDatabase.update({
    where: { id: db!.id },
    data: { itemCount: insertedItems, compositionCount: insertedComps }
  });

  console.log(`[SBC Crawler] ✅ SBC ${uf}-${regionCode} ${version}: ${insertedItems} insumos + ${insertedComps} composições`);
  return {
    success: true,
    message: `SBC ${uf}-${regionCode} ${version}: ${insertedItems} insumos + ${insertedComps} composições`,
    databaseId: db!.id,
    itemCount: insertedItems,
    compositionCount: insertedComps,
  };
}

// ═══════════════════════════════════════════════════════════
// Main Orchestrator
// ═══════════════════════════════════════════════════════════
export interface SbcSyncOptions {
  regions: string[];  // SBC region codes (e.g. ['RJO', 'SPO']) or ['ALL']
  months: number;
  email: string;
  password: string;
}

export interface SbcSyncReport {
  started: string;
  finished: string;
  totalAttempted: number;
  totalSuccess: number;
  totalFailed: number;
  results: SyncResult[];
}

export async function syncSbc(options: SbcSyncOptions): Promise<SbcSyncReport> {
  const { regions: requestedRegions, months, email, password } = options;
  const isAll = requestedRegions.includes('ALL') || requestedRegions.length >= 30;
  const regions = isAll ? SBC_REGIONS : SBC_REGIONS.filter(r => requestedRegions.includes(r.code));
  const started = new Date().toISOString();
  const results: SyncResult[] = [];

  // Step 1: Login
  console.log(`\n[SBC Crawler] 🚀 Sync SBC: ${isAll ? 'ALL (30 regiões)' : regions.map(r => r.code).join(',')} × ${months} meses`);
  const session = await loginAndGetSession(email, password);
  if (!session) {
    return { started, finished: new Date().toISOString(), totalAttempted: 0, totalSuccess: 0, totalFailed: 1, results: [{ success: false, message: 'Falha no login SBC' }] };
  }

  // Generate target dates (last N months)
  const now = new Date();
  const targetDates: { dtBase: string; month: number; year: number }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    targetDates.push({
      dtBase: `${y}${String(m).padStart(2, '0')}01`,
      month: m,
      year: y,
    });
  }

  // Step 2: Iterate regions × dates
  for (const region of regions) {
    for (const { dtBase, month, year } of targetDates) {
      const version = `${String(month).padStart(2, '0')}/${year}`;

      // Idempotency check
      const existing = await prisma.engineeringDatabase.findFirst({
        where: {
          name: 'SBC',
          uf: `${region.uf}-${region.code}`,
          referenceMonth: month,
          referenceYear: year,
          type: 'OFICIAL',
          itemCount: { gt: 0 },
        }
      });
      if (existing && (existing.itemCount || 0) > 0) {
        console.log(`[SBC Crawler] ⏭️ SBC ${region.uf}-${region.code} ${version}: já existente (${existing.itemCount} itens)`);
        results.push({ success: true, message: `Já existente: ${region.code} ${version}` });
        continue;
      }

      console.log(`[SBC Crawler] 📥 Buscando: ${region.code} (${region.name}-${region.uf}) ${version}...`);

      try {
        // Fetch insumos
        const insumos = await fetchAllInsumos(session.guid, session.cookies, region.code, dtBase);

        // Fetch composições
        const composicoes = await fetchAllComposicoes(session.guid, session.cookies, region.code, dtBase);

        const allData = [...insumos, ...composicoes];
        if (allData.length === 0) {
          console.log(`[SBC Crawler] ⚠️ SBC ${region.code} ${version}: sem dados`);
          results.push({ success: false, message: `Sem dados: ${region.code} ${version}` });
          continue;
        }

        const result = await persistSbcItems(region.code, region.uf, month, year, allData);
        results.push(result);
      } catch (e: any) {
        console.error(`[SBC Crawler] ❌ SBC ${region.code} ${version}: ${e.message}`);
        results.push({ success: false, message: `Erro: ${region.code} ${version} - ${e.message}` });
      }

      // Rate limit between regions
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  const finished = new Date().toISOString();
  const totalSuccess = results.filter(r => r.success).length;
  const totalFailed = results.filter(r => !r.success).length;
  console.log(`\n[SBC Crawler] 🏁 Sync completo: ${totalSuccess} sucesso, ${totalFailed} falhas`);

  return { started, finished, totalAttempted: results.length, totalSuccess, totalFailed, results };
}

// Export region list for frontend
export function getSbcRegions() {
  return SBC_REGIONS;
}
