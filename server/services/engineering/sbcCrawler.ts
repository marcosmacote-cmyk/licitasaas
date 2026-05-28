/**
 * SBC Crawler — Informativo SBC (informativosbc.com.br)
 * Full Puppeteer end-to-end: login → sidebar nav → select filters → parse table
 * 
 * KEY INSIGHT: page.goto() to /mgw URLs creates a NEW MGW session (unauthenticated).
 * Must navigate via sidebar clicks within the SAME authenticated session.
 */
import { prisma } from '../../lib/prisma';
import { classifyInsumoType } from './insumoClassifier';

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

interface ParsedItem { code: string; description: string; unit: string; price: number; type: string; }
interface SyncResult { success: boolean; message: string; databaseId?: string; itemCount?: number; compositionCount?: number; }

function parseBrPrice(text: string): number {
  if (!text) return 0;
  const c = text.replace(/[^\d.,\-]/g, '');
  if (!c) return 0;
  if (c.includes(',') && (!c.includes('.') || c.lastIndexOf(',') > c.lastIndexOf('.')))
    return parseFloat(c.replace(/\./g, '').replace(',', '.')) || 0;
  return parseFloat(c.replace(/,/g, '')) || 0;
}

// ═══════════════════════════════════════════════════════════
// Launch browser
// ═══════════════════════════════════════════════════════════
async function launchBrowser(): Promise<any> {
  let ppt: any;
  try { ppt = require('puppeteer-core'); } catch { try { ppt = require('puppeteer'); } catch { throw new Error('Puppeteer not available'); } }
  for (const p of ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome', process.env.CHROME_PATH].filter(Boolean)) {
    try { return await ppt.launch({ executablePath: p as string, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] }); } catch { continue; }
  }
  throw new Error('No Chrome/Chromium found');
}

// ═══════════════════════════════════════════════════════════
// Find the frame that contains actual content (SBC uses iframes)
// ═══════════════════════════════════════════════════════════
async function getContentFrame(page: any): Promise<any> {
  await new Promise(r => setTimeout(r, 2000));
  for (const frame of page.frames()) {
    try {
      const hasSelect = await frame.evaluate(() => document.querySelectorAll('select').length > 0);
      if (hasSelect) return frame;
    } catch { continue; }
  }
  // Fallback: check for table in any frame
  for (const frame of page.frames()) {
    try {
      const hasTable = await frame.evaluate(() => document.querySelectorAll('table').length > 0);
      if (hasTable) return frame;
    } catch { continue; }
  }
  return page; // fallback to main frame
}

// ═══════════════════════════════════════════════════════════
// Navigate within authenticated session using sidebar links
// Instead of page.goto() which creates a new MGW session
// ═══════════════════════════════════════════════════════════
async function navigateViaSidebar(page: any, sectionText: string): Promise<boolean> {
  try {
    // Try clicking sidebar link in main frame and all iframes
    for (const frame of [page, ...page.frames()]) {
      try {
        const clicked = await frame.evaluate((text: string) => {
          const links = document.querySelectorAll('a, .ls-menu-item, li a, nav a');
          for (const link of links) {
            const t = (link as HTMLElement).innerText || link.textContent || '';
            if (t.trim().toLowerCase().includes(text.toLowerCase())) {
              (link as HTMLElement).click();
              return true;
            }
          }
          return false;
        }, sectionText);
        if (clicked) {
          await new Promise(r => setTimeout(r, 4000));
          return true;
        }
      } catch { continue; }
    }
    console.log(`[SBC Crawler] ⚠️ Sidebar link "${sectionText}" não encontrado`);
    return false;
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════
// Diagnostic: dump page state for debugging
// ═══════════════════════════════════════════════════════════
async function dumpPageState(page: any, label: string): Promise<void> {
  try {
    const url = page.url();
    const frameCount = page.frames().length;
    let bodySnippet = '';
    for (const frame of [page, ...page.frames()]) {
      try {
        bodySnippet = await frame.evaluate(() => {
          const body = document.body?.innerText || '';
          return body.substring(0, 300);
        });
        if (bodySnippet.length > 20) break;
      } catch { continue; }
    }
    // Count selects and tables across all frames
    let selectCount = 0, tableCount = 0;
    for (const frame of [page, ...page.frames()]) {
      try {
        const counts = await frame.evaluate(() => ({
          selects: document.querySelectorAll('select').length,
          tables: document.querySelectorAll('table').length,
        }));
        selectCount += counts.selects;
        tableCount += counts.tables;
      } catch { continue; }
    }
    console.log(`[SBC Diag] ${label}: url=${url}, frames=${frameCount}, selects=${selectCount}, tables=${tableCount}, body="${bodySnippet.substring(0, 100)}..."`);
  } catch (e: any) {
    console.log(`[SBC Diag] ${label}: error=${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
// Set dropdowns and submit search within a frame
// ═══════════════════════════════════════════════════════════
async function setFiltersAndSubmit(frame: any, regionCode: string, dtBase: string): Promise<void> {
  // Dump available selects for debugging
  const selectInfo = await frame.evaluate(() => {
    const selects = document.querySelectorAll('select');
    return Array.from(selects).map((s: HTMLSelectElement) => ({
      name: s.name, id: s.id,
      optCount: s.options.length,
      firstOpts: Array.from(s.options).slice(0, 3).map((o: HTMLOptionElement) => `${o.value}|${o.text.substring(0, 30)}`),
    }));
  });
  console.log(`[SBC Diag] Selects found: ${JSON.stringify(selectInfo)}`);

  // Set region: find select with options matching region codes
  await frame.evaluate((code: string) => {
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      for (let i = 0; i < sel.options.length; i++) {
        const opt = sel.options[i];
        if (opt.value === code || opt.text.includes(code)) {
          sel.selectedIndex = i;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
    }
  }, regionCode);

  await new Promise(r => setTimeout(r, 500));

  // Set date
  await frame.evaluate((dt: string) => {
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      for (let i = 0; i < sel.options.length; i++) {
        const opt = sel.options[i];
        if (opt.value === dt || opt.value.includes(dt)) {
          sel.selectedIndex = i;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
    }
  }, dtBase);

  await new Promise(r => setTimeout(r, 500));

  // Click OK / Submit
  await frame.evaluate(() => {
    // Try buttons
    const btns = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
    for (const btn of btns) {
      const text = ((btn as HTMLElement).innerText || (btn as HTMLInputElement).value || '').trim().toUpperCase();
      if (text === 'OK' || text === 'PESQUISAR' || text === 'CONSULTAR') {
        (btn as HTMLElement).click();
        return;
      }
    }
    // Fallback: submit form
    const form = document.querySelector('form');
    if (form) form.submit();
  });

  // Wait for results to load
  await new Promise(r => setTimeout(r, 6000));
}

// ═══════════════════════════════════════════════════════════
// Parse results table from frame
// ═══════════════════════════════════════════════════════════
async function parseResultsTable(frame: any, itemType: string): Promise<ParsedItem[]> {
  const raw = await frame.evaluate(() => {
    const results: { code: string; desc: string; unit: string; price: string }[] = [];
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) continue;
        const code = cells[0]?.textContent?.trim() || '';
        const desc = cells[1]?.textContent?.trim() || '';
        if (!code || !desc || code.length < 1 || /^(código|codigo|listados?)/i.test(code)) continue;
        const unit = cells.length >= 4 ? (cells[cells.length - 2]?.textContent?.trim() || 'UN') : 'UN';
        const price = cells.length >= 4 ? (cells[cells.length - 1]?.textContent?.trim() || '0') : '0';
        results.push({ code, desc, unit, price });
      }
    }
    return results;
  });

  console.log(`[SBC Crawler] 📊 Table rows found: ${raw.length}`);
  return raw.map((r: { code: string; desc: string; unit: string; price: string }) => {
    const price = parseBrPrice(r.price);
    // Classify by description instead of using fixed itemType
    const classification = classifyInsumoType(r.desc, r.unit, itemType);
    return {
      code: r.code, description: r.desc, unit: r.unit, price, type: classification.type,
    };
  }).filter((it: ParsedItem) => it.code.length >= 1 && it.description.length > 2);
}

// ═══════════════════════════════════════════════════════════
// Scrape one section (Insumos or Composições)
// ═══════════════════════════════════════════════════════════
async function scrapeSection(page: any, sectionName: string, regionCode: string, dtBase: string, itemType: string): Promise<ParsedItem[]> {
  try {
    // Navigate via sidebar click
    const navOk = await navigateViaSidebar(page, sectionName);
    if (!navOk) {
      // Fallback: try direct URL but with waitForNavigation
      console.log(`[SBC Crawler] 🔄 Tentando nav direta para ${sectionName}...`);
      const origin = sectionName.toLowerCase().includes('insumo') ? 'insumos1' : 'composicoes1';
      await page.goto(`https://informativosbc.com.br/mgw?MGWCHD=0&wlapp=SBC&trgt=_blank&orgn=${origin}`, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
    }

    await dumpPageState(page, `After nav to ${sectionName}`);

    // Find frame with form controls
    const frame = await getContentFrame(page);

    // Set filters and submit
    await setFiltersAndSubmit(frame, regionCode, dtBase);

    // After submit, the page may reload or update — find content frame again
    await dumpPageState(page, `After submit ${sectionName}`);
    const resultFrame = await getContentFrame(page);

    // Parse results
    return await parseResultsTable(resultFrame, itemType);
  } catch (e: any) {
    console.error(`[SBC Crawler] ❌ ${sectionName} scrape error: ${e.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// Persist to database
// ═══════════════════════════════════════════════════════════
async function persistSbcItems(regionCode: string, uf: string, month: number, year: number, data: ParsedItem[]): Promise<SyncResult> {
  const version = `${String(month).padStart(2, '0')}/${year}`;
  const ufKey = `${uf}-${regionCode}`;

  let db = await prisma.engineeringDatabase.findFirst({ where: { name: 'SBC', uf: ufKey, referenceMonth: month, referenceYear: year, type: 'OFICIAL' } });
  if (db) {
    await prisma.engineeringItem.deleteMany({ where: { databaseId: db.id } });
    await prisma.engineeringComposition.deleteMany({ where: { databaseId: db.id } });
  } else {
    db = await prisma.engineeringDatabase.create({ data: { name: 'SBC', uf: ufKey, version, type: 'OFICIAL', payrollExemption: false, referenceMonth: month, referenceYear: year } });
  }

  const basics = data.filter((it: ParsedItem) => it.type !== 'SERVICO');
  const services = data.filter((it: ParsedItem) => it.type === 'SERVICO');

  let insItems = 0;
  for (let i = 0; i < basics.length; i += 1000) {
    const r = await prisma.engineeringItem.createMany({ data: basics.slice(i, i + 1000).map((it: ParsedItem) => ({ databaseId: db!.id, ...it })), skipDuplicates: true });
    insItems += r.count;
  }
  let insComps = 0;
  for (let i = 0; i < services.length; i += 1000) {
    const r = await prisma.engineeringComposition.createMany({ data: services.slice(i, i + 1000).map((s: ParsedItem) => ({ databaseId: db!.id, code: s.code, description: s.description, unit: s.unit, totalPrice: s.price })), skipDuplicates: true });
    insComps += r.count;
  }

  await prisma.engineeringDatabase.update({ where: { id: db!.id }, data: { itemCount: insItems, compositionCount: insComps } });
  console.log(`[SBC Crawler] ✅ SBC ${ufKey} ${version}: ${insItems} insumos + ${insComps} composições`);
  return { success: true, message: `SBC ${ufKey} ${version}: ${insItems} insumos + ${insComps} composições`, databaseId: db!.id, itemCount: insItems, compositionCount: insComps };
}

// ═══════════════════════════════════════════════════════════
// Main Orchestrator
// ═══════════════════════════════════════════════════════════
export interface SbcSyncOptions { regions: string[]; months: number; email: string; password: string; }
export interface SbcSyncReport { started: string; finished: string; totalAttempted: number; totalSuccess: number; totalFailed: number; results: SyncResult[]; }

export async function syncSbc(options: SbcSyncOptions): Promise<SbcSyncReport> {
  const { regions: reqRegions, months, email, password } = options;
  const isAll = reqRegions.includes('ALL') || reqRegions.length >= 30;
  const regions = isAll ? SBC_REGIONS : SBC_REGIONS.filter(r => reqRegions.includes(r.code));
  const started = new Date().toISOString();
  const results: SyncResult[] = [];

  console.log(`\n[SBC Crawler] 🚀 Sync SBC: ${isAll ? 'ALL (30 regiões)' : regions.map(r => r.code).join(',')} × ${months} meses`);

  let browser: any;
  try { browser = await launchBrowser(); } catch (e: any) {
    console.error(`[SBC Crawler] ❌ ${e.message}`);
    return { started, finished: new Date().toISOString(), totalAttempted: 0, totalSuccess: 0, totalFailed: 1, results: [{ success: false, message: e.message }] };
  }

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });

    // Login
    await page.goto('https://informativosbc.com.br/index1.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    // Find login frame and fill credentials
    let loginDone = false;
    for (const frame of [page, ...page.frames()]) {
      try {
        const hasLogin = await frame.evaluate(() => {
          const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="password"]');
          return inputs.length >= 2;
        });
        if (!hasLogin) continue;

        await frame.evaluate((e: string, p: string) => {
          const inputs = document.querySelectorAll('input');
          for (const inp of inputs) {
            const t = inp.type.toLowerCase();
            const n = (inp.name || '').toLowerCase();
            if (t === 'password' || n.includes('senha') || n.includes('pass')) {
              inp.value = p; inp.dispatchEvent(new Event('input', { bubbles: true }));
            } else if ((t === 'text' || t === 'email') && !n.includes('hidden')) {
              inp.value = e; inp.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
        }, email, password);
        await new Promise(r => setTimeout(r, 500));

        await frame.evaluate(() => {
          const btn = document.querySelector('input[type="submit"], button[type="submit"], button.btn, .ls-btn-primary') as HTMLElement;
          if (btn) btn.click(); else { const f = document.querySelector('form'); if (f) f.submit(); }
        });
        loginDone = true;
        break;
      } catch { continue; }
    }

    if (!loginDone) {
      console.error('[SBC Crawler] ❌ Login form not found');
      return { started, finished: new Date().toISOString(), totalAttempted: 0, totalSuccess: 0, totalFailed: 1, results: [{ success: false, message: 'Login form not found' }] };
    }

    await new Promise(r => setTimeout(r, 6000));
    await dumpPageState(page, 'After login');

    // Verify login
    let loggedIn = false;
    for (const frame of [page, ...page.frames()]) {
      try {
        loggedIn = await frame.evaluate(() => {
          const t = document.body?.innerText || '';
          return t.includes('Conteúdo do Informativo') || t.includes('Insumos') || t.includes('Composições') || t.includes('Sair');
        });
        if (loggedIn) break;
      } catch { continue; }
    }

    if (!loggedIn) {
      console.error('[SBC Crawler] ❌ Login failed');
      return { started, finished: new Date().toISOString(), totalAttempted: 0, totalSuccess: 0, totalFailed: 1, results: [{ success: false, message: 'Login failed' }] };
    }
    console.log('[SBC Crawler] ✅ Login bem-sucedido');

    // Generate target dates
    const now = new Date();
    const targets: { dtBase: string; month: number; year: number }[] = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = d.getMonth() + 1, y = d.getFullYear();
      targets.push({ dtBase: `${y}${String(m).padStart(2, '0')}01`, month: m, year: y });
    }

    // Iterate
    for (const region of regions) {
      for (const { dtBase, month, year } of targets) {
        const version = `${String(month).padStart(2, '0')}/${year}`;
        const ufKey = `${region.uf}-${region.code}`;

        const existing = await prisma.engineeringDatabase.findFirst({
          where: { name: 'SBC', uf: ufKey, referenceMonth: month, referenceYear: year, type: 'OFICIAL', itemCount: { gt: 0 } }
        });
        if (existing && (existing.itemCount || 0) > 0) {
          console.log(`[SBC Crawler] ⏭️ ${ufKey} ${version}: já existente`);
          results.push({ success: true, message: `Já existente: ${ufKey} ${version}` });
          continue;
        }

        console.log(`[SBC Crawler] 📥 Buscando: ${region.code} (${region.name}-${region.uf}) ${version}...`);

        try {
          const insumos = await scrapeSection(page, 'Insumos', region.code, dtBase, 'MATERIAL');
          console.log(`[SBC Crawler] 📋 ${region.code} insumos: ${insumos.length}`);

          const composicoes = await scrapeSection(page, 'Composições', region.code, dtBase, 'SERVICO');
          console.log(`[SBC Crawler] 📋 ${region.code} composições: ${composicoes.length}`);

          const allData = [...insumos, ...composicoes];
          if (allData.length === 0) {
            console.log(`[SBC Crawler] ⚠️ ${ufKey} ${version}: sem dados`);
            results.push({ success: false, message: `Sem dados: ${ufKey} ${version}` });
            continue;
          }
          results.push(await persistSbcItems(region.code, region.uf, month, year, allData));
        } catch (e: any) {
          console.error(`[SBC Crawler] ❌ ${ufKey} ${version}: ${e.message}`);
          results.push({ success: false, message: `Erro: ${ufKey} ${version} - ${e.message}` });
        }
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  } finally {
    try { await browser.close(); } catch {}
  }

  const finished = new Date().toISOString();
  const ok = results.filter(r => r.success).length;
  const fail = results.filter(r => !r.success).length;
  console.log(`\n[SBC Crawler] 🏁 Sync completo: ${ok} sucesso, ${fail} falhas`);
  return { started, finished, totalAttempted: results.length, totalSuccess: ok, totalFailed: fail, results };
}

export function getSbcRegions() { return SBC_REGIONS; }
