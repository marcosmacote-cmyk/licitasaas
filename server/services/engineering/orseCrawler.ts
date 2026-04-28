import * as cheerio from 'cheerio';
import { prisma } from '../../lib/prisma';

const ORSE_BASE_URL = 'https://orse.cehop.se.gov.br';
const ORSE_SERVICES_URL = `${ORSE_BASE_URL}/servicosargumento.asp`;
const ORSE_DOWNLOADS_URL = `${ORSE_BASE_URL}/downloads.asp`;
const USER_AGENT = 'LicitaSaaS-ORSE-Sync/1.0';

export interface OrsePeriod {
  value: string;
  label: string;
  year: number;
  month: number;
  order: number;
  version: string;
  downloadUrl?: string;
  downloadFile?: string;
}

export interface OrseServiceRow {
  code: string;
  rawCode: string;
  description: string;
  unit: string;
  price: number;
  detailUrl?: string;
}

export interface OrseSearchResult {
  period: OrsePeriod;
  page: number;
  totalPages: number;
  totalServices: number;
  services: OrseServiceRow[];
}

export interface OrseSyncOptions {
  months?: number;
  force?: boolean;
  maxPagesPerPeriod?: number;
}

export interface OrseSyncResult {
  success: boolean;
  message: string;
  databaseId?: string;
  period?: OrsePeriod;
  compositionCount?: number;
}

export interface OrseSyncReport {
  started: string;
  finished: string;
  totalAttempted: number;
  totalSuccess: number;
  totalFailed: number;
  results: OrseSyncResult[];
}

function decodeLatin1(buffer: ArrayBuffer): string {
  return new TextDecoder('iso-8859-1').decode(buffer);
}

async function downloadText(url: string, init?: RequestInit, timeoutMs = 90000): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return decodeLatin1(await res.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

function parseBrNumber(value: string): number {
  const cleaned = String(value || '').replace(/[^\d,.\-]/g, '');
  if (!cleaned) return 0;
  return parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
}

function normalizeOrseCode(code: string): string {
  const cleaned = String(code || '').trim().toUpperCase();
  const match = cleaned.match(/^0*(\d+)\/ORSE$/);
  return match ? `${match[1]}/ORSE` : cleaned;
}

function parsePeriodValue(value: string, label?: string): OrsePeriod | null {
  const match = String(value || '').match(/^(\d{4})-(\d{1,2})-(\d+)$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const order = Number(match[3]);
  return {
    value,
    label: label || `${String(month).padStart(2, '0')}/${year}-${order}`,
    year,
    month,
    order,
    version: `${String(month).padStart(2, '0')}/${year}-${order}`,
  };
}

export async function discoverOrseUpdateFiles(year: number): Promise<Map<string, { url: string; file: string }>> {
  const body = new URLSearchParams({ AnoORSE: String(year) });
  const html = await downloadText(`${ORSE_DOWNLOADS_URL}?tarefa=consultar&base=orse`, {
    method: 'POST',
    body,
  });
  const $ = cheerio.load(html);
  const files = new Map<string, { url: string; file: string }>();

  $('a[href]').each((_, el) => {
    const href = String($(el).attr('href') || '');
    const match = href.match(/url=(downloads\/(\d{4})(\d{2})\d{2}-\d+\.ORSE)/i)
      || href.match(/(downloads\/(\d{4})(\d{2})\d{2}-\d+\.ORSE)/i);
    if (!match) return;

    const relativeFile = match[1];
    const file = relativeFile.split('/').pop() || relativeFile;
    const fileYear = Number(match[2]);
    const fileMonth = Number(match[3]);
    const key = `${fileYear}-${fileMonth}`;
    files.set(key, {
      file,
      url: new URL(relativeFile, ORSE_BASE_URL).toString(),
    });
  });

  return files;
}

export async function getLatestOrsePeriods(months = 12): Promise<OrsePeriod[]> {
  const html = await downloadText(ORSE_SERVICES_URL);
  const $ = cheerio.load(html);
  const periods: OrsePeriod[] = [];

  $('select[name="sltPeriodo"] option').each((_, option) => {
    const value = String($(option).attr('value') || '').trim();
    const label = $(option).text().replace(/\s+/g, ' ').trim();
    const period = parsePeriodValue(value, label);
    if (period) periods.push(period);
  });

  const latest = periods
    .sort((a, b) => b.year - a.year || b.month - a.month || b.order - a.order)
    .slice(0, months);

  const years = [...new Set(latest.map(period => period.year))];
  const downloadMaps = await Promise.all(years.map(async year => {
    try {
      return [year, await discoverOrseUpdateFiles(year)] as const;
    } catch (e: any) {
      console.warn(`[ORSE Sync] Could not discover update files for ${year}: ${e.message}`);
      return [year, new Map<string, { url: string; file: string }>()] as const;
    }
  }));
  const downloadsByYear = new Map(downloadMaps);

  for (const period of latest) {
    const updateFile = downloadsByYear.get(period.year)?.get(`${period.year}-${period.month}`);
    if (updateFile) {
      period.downloadUrl = updateFile.url;
      period.downloadFile = updateFile.file;
    }
  }

  return latest;
}

function buildSearchBody(period: OrsePeriod, query: string): URLSearchParams {
  return new URLSearchParams({
    sltFonte: 'ORSE',
    sltPeriodo: period.value,
    sltGrupoServico: '0',
    rdbCriterio: '2',
    txtDescricao: query,
  });
}

function parseServicesHtml(html: string, period: OrsePeriod, page: number): OrseSearchResult {
  const $ = cheerio.load(html);
  const services: OrseServiceRow[] = [];

  $('td.CorpoTabela').each((_, cell) => {
    const firstLink = $(cell).find('a').first();
    const rawCode = firstLink.text().replace(/\s+/g, ' ').trim().toUpperCase();
    if (!/^\d+\/ORSE$/.test(rawCode)) return;

    const row = $(cell).closest('tr');
    const cells = row.find('td.CorpoTabela');
    if (cells.length < 4) return;

    const description = cells.eq(1).text().replace(/\s+/g, ' ').trim();
    const unit = cells.eq(2).text().replace(/\s+/g, ' ').trim().toUpperCase() || 'UN';
    const price = parseBrNumber(cells.eq(3).text());
    if (!description || price <= 0) return;

    const href = String(firstLink.attr('href') || '');
    services.push({
      code: normalizeOrseCode(rawCode),
      rawCode,
      description,
      unit,
      price: Math.round(price * 100) / 100,
      detailUrl: href ? new URL(href, ORSE_BASE_URL).toString() : undefined,
    });
  });

  const footerText = $.root().text().replace(/\s+/g, ' ');
  const footerMatch = footerText.match(/Total de Servi\S+os\s+(\d+)\s+-\s+P\S+gina\s+(\d+)\s+de\s+(\d+)/i);
  const totalServices = footerMatch ? Number(footerMatch[1]) : services.length;
  const currentPage = footerMatch ? Number(footerMatch[2]) : page;
  const totalPages = footerMatch ? Number(footerMatch[3]) : Math.max(1, page);

  return {
    period,
    page: currentPage,
    totalPages,
    totalServices,
    services,
  };
}

export async function searchOrseServices(periodValue: string, query = '', page = 1): Promise<OrseSearchResult> {
  const period = parsePeriodValue(periodValue) || (await getLatestOrsePeriods(1))[0];
  const url = `${ORSE_SERVICES_URL}?tarefa=consultar&page=${Math.max(1, page)}`;
  const html = await downloadText(url, {
    method: 'POST',
    body: buildSearchBody(period, query),
  });
  return parseServicesHtml(html, period, page);
}

async function crawlPeriodServices(period: OrsePeriod, maxPagesPerPeriod?: number): Promise<OrseServiceRow[]> {
  console.log(`[ORSE Sync] Period ${period.version}: fetching page 1`);
  const first = await searchOrseServices(period.value, '', 1);
  const totalPages = maxPagesPerPeriod
    ? Math.min(first.totalPages, maxPagesPerPeriod)
    : first.totalPages;
  const byCode = new Map<string, OrseServiceRow>();
  for (const service of first.services) byCode.set(service.code, service);

  const concurrency = 6;
  for (let nextPage = 2; nextPage <= totalPages; nextPage += concurrency) {
    const pages = Array.from({ length: Math.min(concurrency, totalPages - nextPage + 1) }, (_, idx) => nextPage + idx);
    const results = await Promise.all(pages.map(page => searchOrseServices(period.value, '', page).catch((e: any) => {
      console.warn(`[ORSE Sync] Page ${page}/${totalPages} failed for ${period.version}: ${e.message}`);
      return null;
    })));
    for (const result of results) {
      for (const service of result?.services || []) byCode.set(service.code, service);
    }
    console.log(`[ORSE Sync] Period ${period.version}: ${Math.min(nextPage + concurrency - 1, totalPages)}/${totalPages} pages, ${byCode.size} services`);
  }

  return [...byCode.values()];
}

async function persistOrsePeriod(period: OrsePeriod, services: OrseServiceRow[], force: boolean): Promise<OrseSyncResult> {
  let db = await prisma.engineeringDatabase.findFirst({
    where: {
      name: 'ORSE',
      uf: 'SE',
      type: 'OFICIAL',
      referenceMonth: period.month,
      referenceYear: period.year,
      version: period.version,
    },
  });

  if (db && !force && db.compositionCount > 0) {
    return {
      success: true,
      message: `Already synced: ORSE ${period.version} (${db.compositionCount} compositions)`,
      databaseId: db.id,
      period,
      compositionCount: db.compositionCount,
    };
  }

  if (db) {
    await prisma.engineeringItem.deleteMany({ where: { databaseId: db.id } });
    await prisma.engineeringComposition.deleteMany({ where: { databaseId: db.id } });
  } else {
    db = await prisma.engineeringDatabase.create({
      data: {
        name: 'ORSE',
        uf: 'SE',
        version: period.version,
        type: 'OFICIAL',
        payrollExemption: false,
        referenceMonth: period.month,
        referenceYear: period.year,
      },
    });
  }

  let inserted = 0;
  for (let i = 0; i < services.length; i += 1000) {
    const chunk = services.slice(i, i + 1000);
    const result = await prisma.engineeringComposition.createMany({
      data: chunk.map(service => ({
        databaseId: db!.id,
        code: service.code,
        description: service.description,
        unit: service.unit,
        totalPrice: service.price,
      })),
      skipDuplicates: true,
    });
    inserted += result.count;
  }

  await prisma.engineeringDatabase.update({
    where: { id: db.id },
    data: {
      itemCount: 0,
      compositionCount: inserted,
      payrollExemption: false,
      version: period.version,
    },
  });

  return {
    success: true,
    message: `ORSE ${period.version}: ${inserted} compositions synced`,
    databaseId: db.id,
    period,
    compositionCount: inserted,
  };
}

export async function syncOrse(options: OrseSyncOptions = {}): Promise<OrseSyncReport> {
  const started = new Date().toISOString();
  const months = Math.max(1, Math.min(Number(options.months || 12), 24));
  const periods = await getLatestOrsePeriods(months);
  const results: OrseSyncResult[] = [];

  console.log(`[ORSE Sync] Starting sync for ${periods.length} periods`);

  for (const period of periods) {
    try {
      const existing = await prisma.engineeringDatabase.findFirst({
        where: {
          name: 'ORSE',
          uf: 'SE',
          type: 'OFICIAL',
          referenceMonth: period.month,
          referenceYear: period.year,
          version: period.version,
        },
      });

      if (existing && !options.force && existing.compositionCount > 0) {
        results.push({
          success: true,
          message: `Already synced: ORSE ${period.version} (${existing.compositionCount} compositions)`,
          databaseId: existing.id,
          period,
          compositionCount: existing.compositionCount,
        });
        continue;
      }

      const services = await crawlPeriodServices(period, options.maxPagesPerPeriod);
      if (services.length === 0) {
        results.push({ success: false, message: `No services found for ORSE ${period.version}`, period });
        continue;
      }
      results.push(await persistOrsePeriod(period, services, Boolean(options.force)));
    } catch (e: any) {
      console.error(`[ORSE Sync] Failed for ${period.version}:`, e);
      results.push({ success: false, message: `ORSE ${period.version}: ${e.message}`, period });
    }
  }

  const finished = new Date().toISOString();
  return {
    started,
    finished,
    totalAttempted: results.length,
    totalSuccess: results.filter(result => result.success).length,
    totalFailed: results.filter(result => !result.success).length,
    results,
  };
}
