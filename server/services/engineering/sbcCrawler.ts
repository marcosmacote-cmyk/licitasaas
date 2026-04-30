/**
 * SBC Crawler — Informativo SBC (informativosbc.com.br)
 * Strategy: FULL Puppeteer end-to-end scraping
 *
 * The SBC portal uses Magic Web Gateway (MGW) with strict server-side sessions.
 * HTTP-only POST with extracted GUID does NOT work — the session is tied to the
 * Puppeteer browser instance. All operations must happen within the same browser.
 *
 * Flow:
 *   1. Puppeteer login → dashboard
 *   2. Navigate to Insumos page
 *   3. Select region (LOC dropdown) + date (DTBASE dropdown)
 *   4. Leave keyword empty → click OK → parse HTML table
 *   5. Repeat for Composições
 *   6. Persist all items to database
 */
import { prisma } from '../../lib/prisma';

// ═══════════════════════════════════════════════════════════
// SBC Region codes → UF mapping
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

function parseBrazilianPrice(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/[^\d.,\-]/g, '');
  if (!cleaned) return 0;
  if (cleaned.includes(',') && (!cleaned.includes('.') || cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.'))) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  }
  return parseFloat(cleaned.replace(/,/g, '')) || 0;
}

// ═══════════════════════════════════════════════════════════
// Launch Puppeteer browser
// ═══════════════════════════════════════════════════════════
async function launchBrowser(): Promise<any> {
  let puppeteer: any;
  try {
    puppeteer = require('puppeteer-core');
  } catch (e) {
    try { puppeteer = require('puppeteer'); } catch (e2) {
      throw new Error('Puppeteer not available');
    }
  }

  const chromePaths = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    process.env.CHROME_PATH,
  ].filter(Boolean);

  for (const chromePath of chromePaths) {
    try {
      return await puppeteer.launch({
        executablePath: chromePath as string,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
    } catch (e) { continue; }
  }
  throw new Error('Could not launch Puppeteer — no Chrome/Chromium found');
}

// ═══════════════════════════════════════════════════════════
// Login to SBC portal
// ═══════════════════════════════════════════════════════════
async function loginToSbc(page: any, email: string, password: string): Promise<boolean> {
  try {
    await page.goto('https://informativosbc.com.br/index1.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    // The login form may be in the main page or in an iframe
    const targetFrame = await findFrameWithLogin(page);

    // Fill credentials
    await targetFrame.evaluate((e: string, p: string) => {
      const inputs = document.querySelectorAll('input');
      let emailField: HTMLInputElement | null = null;
      let passField: HTMLInputElement | null = null;
      for (const inp of inputs) {
        const type = inp.type.toLowerCase();
        const name = (inp.name || '').toLowerCase();
        if (type === 'password' || name.includes('senha') || name.includes('pass')) {
          passField = inp;
        } else if ((type === 'text' || type === 'email') && !emailField) {
          emailField = inp;
        }
      }
      if (emailField) { emailField.value = e; emailField.dispatchEvent(new Event('input', { bubbles: true })); }
      if (passField) { passField.value = p; passField.dispatchEvent(new Event('input', { bubbles: true })); }
    }, email, password);

    await new Promise(r => setTimeout(r, 500));

    // Submit
    await targetFrame.evaluate(() => {
      const btn = document.querySelector('input[type="submit"], button[type="submit"], .ls-btn-primary, button.btn') as HTMLElement;
      if (btn) btn.click();
      else {
        const form = document.querySelector('form');
        if (form) form.submit();
      }
    });

    // Wait for navigation
    await new Promise(r => setTimeout(r, 5000));

    // Verify login succeeded by checking for dashboard elements
    const loggedIn = await page.evaluate(() => {
      const body = document.body.innerText || '';
      return body.includes('Conteúdo do Informativo') || body.includes('Insumos') || body.includes('Composições') || body.includes('Sair');
    });

    if (loggedIn) {
      console.log(`[SBC Crawler] ✅ Login bem-sucedido`);
      return true;
    }

    // Check in iframes
    for (const frame of page.frames()) {
      try {
        const found = await frame.evaluate(() => {
          return document.body.innerText.includes('Conteúdo do Informativo') || document.body.innerText.includes('Composições');
        });
        if (found) {
          console.log(`[SBC Crawler] ✅ Login bem-sucedido (via iframe)`);
          return true;
        }
      } catch (e) { continue; }
    }

    console.error(`[SBC Crawler] ❌ Login falhou — dashboard não encontrado`);
    return false;
  } catch (e: any) {
    console.error(`[SBC Crawler] ❌ Login error: ${e.message}`);
    return false;
  }
}

async function findFrameWithLogin(page: any): Promise<any> {
  for (const frame of page.frames()) {
    try {
      const has = await frame.evaluate(() => {
        const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="password"]');
        return inputs.length >= 2;
      });
      if (has) return frame;
    } catch (e) { continue; }
  }
  return page;
}

// ═══════════════════════════════════════════════════════════
// Scrape Insumos page via Puppeteer
// Navigate to Insumos → set region/date → click OK → parse table
// ═══════════════════════════════════════════════════════════
async function scrapeInsumos(page: any, regionCode: string, dtBase: string): Promise<ParsedItem[]> {
  try {
    // Navigate to Insumos page
    await page.goto(`https://informativosbc.com.br/mgw?MGWCHD=0&wlapp=SBC&trgt=_blank&orgn=insumos1`, {
      waitUntil: 'networkidle2', timeout: 30000
    });
    await new Promise(r => setTimeout(r, 3000));

    // Find the content frame (SBC uses iframes)
    const contentFrame = await findContentFrame(page, 'Insumos');

    // Set region dropdown
    await contentFrame.evaluate((code: string) => {
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const name = (sel.name || '').toUpperCase();
        // LOC select — look for options that match region codes
        for (const opt of sel.options) {
          if (opt.value === code || opt.text.startsWith(code)) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }
    }, regionCode);

    // Set date dropdown
    await contentFrame.evaluate((dt: string) => {
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const name = (sel.name || '').toUpperCase();
        for (const opt of sel.options) {
          if (opt.value === dt || opt.value.includes(dt)) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }
    }, dtBase);

    await new Promise(r => setTimeout(r, 500));

    // Click OK button
    await contentFrame.evaluate(() => {
      const btns = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
      for (const btn of btns) {
        const text = (btn as HTMLElement).innerText || (btn as HTMLInputElement).value || '';
        if (text.trim().toUpperCase() === 'OK') {
          (btn as HTMLElement).click();
          return;
        }
      }
      // Fallback: submit form
      const form = document.querySelector('form');
      if (form) form.submit();
    });

    // Wait for results
    await new Promise(r => setTimeout(r, 5000));

    // Parse the results table
    const items = await contentFrame.evaluate(() => {
      const results: { code: string; description: string; unit: string; price: string; type: string }[] = [];
      const tables = document.querySelectorAll('table');

      for (const table of tables) {
        const rows = table.querySelectorAll('tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 3) continue;

          const code = cells[0]?.textContent?.trim() || '';
          const desc = cells[1]?.textContent?.trim() || '';

          if (!code || !desc || code.length < 1) continue;
          if (code.toUpperCase() === 'CÓDIGO' || code.toUpperCase() === 'CODIGO') continue;
          if (/^listados?\s/i.test(code)) continue;

          const unit = cells.length >= 4 ? (cells[cells.length - 2]?.textContent?.trim() || 'UN') : 'UN';
          const price = cells.length >= 4 ? (cells[cells.length - 1]?.textContent?.trim() || '0') : '0';

          results.push({ code, description: desc, unit, price, type: 'MATERIAL' });
        }
      }
      return results;
    });

    return items.map(it => ({
      code: it.code,
      description: it.description,
      unit: it.unit,
      price: parseBrazilianPrice(it.price),
      type: it.type,
    })).filter(it => it.code.length >= 1 && it.description.length > 2);

  } catch (e: any) {
    console.error(`[SBC Crawler] ❌ Insumos scrape error: ${e.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// Scrape Composições page via Puppeteer
// ═══════════════════════════════════════════════════════════
async function scrapeComposicoes(page: any, regionCode: string, dtBase: string): Promise<ParsedItem[]> {
  try {
    await page.goto(`https://informativosbc.com.br/mgw?MGWCHD=0&wlapp=SBC&trgt=_blank&orgn=composicoes1`, {
      waitUntil: 'networkidle2', timeout: 30000
    });
    await new Promise(r => setTimeout(r, 3000));

    const contentFrame = await findContentFrame(page, 'Composições');

    // Set region
    await contentFrame.evaluate((code: string) => {
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        for (const opt of sel.options) {
          if (opt.value === code || opt.text.startsWith(code)) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }
    }, regionCode);

    // Set date
    await contentFrame.evaluate((dt: string) => {
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        for (const opt of sel.options) {
          if (opt.value === dt || opt.value.includes(dt)) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }
    }, dtBase);

    await new Promise(r => setTimeout(r, 500));

    // Click OK
    await contentFrame.evaluate(() => {
      const btns = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
      for (const btn of btns) {
        const text = (btn as HTMLElement).innerText || (btn as HTMLInputElement).value || '';
        if (text.trim().toUpperCase() === 'OK') {
          (btn as HTMLElement).click();
          return;
        }
      }
      const form = document.querySelector('form');
      if (form) form.submit();
    });

    await new Promise(r => setTimeout(r, 5000));

    // Parse results
    const items = await contentFrame.evaluate(() => {
      const results: { code: string; description: string; unit: string; price: string }[] = [];
      const tables = document.querySelectorAll('table');

      for (const table of tables) {
        const rows = table.querySelectorAll('tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 3) continue;

          const code = cells[0]?.textContent?.trim() || '';
          const desc = cells[1]?.textContent?.trim() || '';

          if (!code || !desc || code.length < 1) continue;
          if (code.toUpperCase() === 'CÓDIGO' || code.toUpperCase() === 'CODIGO') continue;
          if (/^listados?\s/i.test(code)) continue;

          const unit = cells.length >= 4 ? (cells[cells.length - 2]?.textContent?.trim() || 'UN') : 'UN';
          const price = cells.length >= 4 ? (cells[cells.length - 1]?.textContent?.trim() || '0') : '0';

          results.push({ code, description: desc, unit, price });
        }
      }
      return results;
    });

    return items.map(it => ({
      code: it.code,
      description: it.description,
      unit: it.unit,
      price: parseBrazilianPrice(it.price),
      type: 'SERVICO',
    })).filter(it => it.code.length >= 1 && it.description.length > 2);

  } catch (e: any) {
    console.error(`[SBC Crawler] ❌ Composições scrape error: ${e.message}`);
    return [];
  }
}

async function findContentFrame(page: any, sectionHint: string): Promise<any> {
  // Try iframes first
  for (const frame of page.frames()) {
    try {
      const has = await frame.evaluate((hint: string) => {
        const body = document.body?.innerText || '';
        return body.includes(hint) || body.includes('Código') || body.includes('Região');
      }, sectionHint);
      if (has) return frame;
    } catch (e) { continue; }
  }
  return page;
}

// ═══════════════════════════════════════════════════════════
// Persist to database
// ═══════════════════════════════════════════════════════════
async function persistSbcItems(regionCode: string, uf: string, month: number, year: number, data: ParsedItem[]): Promise<SyncResult> {
  const baseName = 'SBC';
  const version = `${String(month).padStart(2, '0')}/${year}`;
  const ufKey = `${uf}-${regionCode}`;

  let db = await prisma.engineeringDatabase.findFirst({
    where: { name: baseName, uf: ufKey, referenceMonth: month, referenceYear: year, type: 'OFICIAL' }
  });

  if (db) {
    await prisma.engineeringItem.deleteMany({ where: { databaseId: db.id } });
    await prisma.engineeringComposition.deleteMany({ where: { databaseId: db.id } });
  } else {
    db = await prisma.engineeringDatabase.create({
      data: { name: baseName, uf: ufKey, version, type: 'OFICIAL', payrollExemption: false, referenceMonth: month, referenceYear: year }
    });
  }

  const basicItems = data.filter(it => it.type !== 'SERVICO');
  const serviceItems = data.filter(it => it.type === 'SERVICO');

  let insertedItems = 0;
  for (let i = 0; i < basicItems.length; i += 1000) {
    const r = await prisma.engineeringItem.createMany({
      data: basicItems.slice(i, i + 1000).map(it => ({ databaseId: db!.id, ...it })),
      skipDuplicates: true,
    });
    insertedItems += r.count;
  }

  let insertedComps = 0;
  for (let i = 0; i < serviceItems.length; i += 1000) {
    const r = await prisma.engineeringComposition.createMany({
      data: serviceItems.slice(i, i + 1000).map(svc => ({ databaseId: db!.id, code: svc.code, description: svc.description, unit: svc.unit, totalPrice: svc.price })),
      skipDuplicates: true,
    });
    insertedComps += r.count;
  }

  await prisma.engineeringDatabase.update({ where: { id: db!.id }, data: { itemCount: insertedItems, compositionCount: insertedComps } });
  console.log(`[SBC Crawler] ✅ SBC ${ufKey} ${version}: ${insertedItems} insumos + ${insertedComps} composições`);
  return { success: true, message: `SBC ${ufKey} ${version}: ${insertedItems} insumos + ${insertedComps} composições`, databaseId: db!.id, itemCount: insertedItems, compositionCount: insertedComps };
}

// ═══════════════════════════════════════════════════════════
// Main Orchestrator
// ═══════════════════════════════════════════════════════════
export interface SbcSyncOptions {
  regions: string[];
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

  console.log(`\n[SBC Crawler] 🚀 Sync SBC: ${isAll ? 'ALL (30 regiões)' : regions.map(r => r.code).join(',')} × ${months} meses`);

  // Launch browser (kept alive for entire sync)
  let browser: any;
  try {
    browser = await launchBrowser();
  } catch (e: any) {
    console.error(`[SBC Crawler] ❌ ${e.message}`);
    return { started, finished: new Date().toISOString(), totalAttempted: 0, totalSuccess: 0, totalFailed: 1, results: [{ success: false, message: e.message }] };
  }

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });

    // Step 1: Login
    const loggedIn = await loginToSbc(page, email, password);
    if (!loggedIn) {
      await browser.close();
      return { started, finished: new Date().toISOString(), totalAttempted: 0, totalSuccess: 0, totalFailed: 1, results: [{ success: false, message: 'Falha no login SBC' }] };
    }

    // Generate target dates
    const now = new Date();
    const targetDates: { dtBase: string; month: number; year: number }[] = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();
      targetDates.push({ dtBase: `${y}${String(m).padStart(2, '0')}01`, month: m, year: y });
    }

    // Step 2: Iterate regions × dates
    for (const region of regions) {
      for (const { dtBase, month, year } of targetDates) {
        const version = `${String(month).padStart(2, '0')}/${year}`;
        const ufKey = `${region.uf}-${region.code}`;

        // Idempotency check
        const existing = await prisma.engineeringDatabase.findFirst({
          where: { name: 'SBC', uf: ufKey, referenceMonth: month, referenceYear: year, type: 'OFICIAL', itemCount: { gt: 0 } }
        });
        if (existing && (existing.itemCount || 0) > 0) {
          console.log(`[SBC Crawler] ⏭️ SBC ${ufKey} ${version}: já existente (${existing.itemCount} itens)`);
          results.push({ success: true, message: `Já existente: ${ufKey} ${version}` });
          continue;
        }

        console.log(`[SBC Crawler] 📥 Buscando: ${region.code} (${region.name}-${region.uf}) ${version}...`);

        try {
          // Scrape insumos
          const insumos = await scrapeInsumos(page, region.code, dtBase);
          console.log(`[SBC Crawler] 📋 ${region.code} insumos: ${insumos.length}`);

          // Scrape composições
          const composicoes = await scrapeComposicoes(page, region.code, dtBase);
          console.log(`[SBC Crawler] 📋 ${region.code} composições: ${composicoes.length}`);

          const allData = [...insumos, ...composicoes];
          if (allData.length === 0) {
            console.log(`[SBC Crawler] ⚠️ SBC ${ufKey} ${version}: sem dados`);
            results.push({ success: false, message: `Sem dados: ${ufKey} ${version}` });
            continue;
          }

          const result = await persistSbcItems(region.code, region.uf, month, year, allData);
          results.push(result);
        } catch (e: any) {
          console.error(`[SBC Crawler] ❌ SBC ${ufKey} ${version}: ${e.message}`);
          results.push({ success: false, message: `Erro: ${ufKey} ${version} - ${e.message}` });
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  } finally {
    try { await browser.close(); } catch (_) {}
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
