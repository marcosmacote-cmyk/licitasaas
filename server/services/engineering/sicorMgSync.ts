import * as XLSX from 'xlsx';
import { prisma } from '../../lib/prisma';

const SICOR_BASE_URL = 'https://portal.der.mg.gov.br';
const SICOR_API_BASE = `${SICOR_BASE_URL}/sco-portal-service/api/publicacao`;
const USER_AGENT = 'LicitaSaaS-SICOR-MG-Sync/1.0';

type SicorConditionCode = 'CD' | 'SD';

export interface SicorRegion {
  code: string;
  description: string;
}

export interface SicorPeriod {
  year: number;
  month: number;
  label: string;
  version: string;
}

export interface SicorPublication {
  id: string | number;
  conditionCode: SicorConditionCode;
  payrollExemption: boolean;
  conditionDescription: string;
  regionCode: string;
  regionDescription: string;
  period: SicorPeriod;
  publishedAt?: string;
  raw: any;
  xlsServicesAttachment?: SicorAttachment;
  xlsCompositionsAttachment?: SicorAttachment;
}

export interface SicorAttachment {
  id: string | number;
  fileName?: string;
}

export interface SicorParsedRow {
  code: string;
  description: string;
  unit: string;
  price: number;
  type: 'MATERIAL' | 'MAO_DE_OBRA' | 'EQUIPAMENTO' | 'SERVICO';
}

export interface SicorSyncOptions {
  authToken?: string;
  months?: number;
  force?: boolean;
  conditions?: SicorConditionCode[];
  regionCodes?: string[];
  includeCompositionWorkbook?: boolean;
}

export interface SicorSyncResult {
  success: boolean;
  message: string;
  databaseId?: string;
  publication?: Pick<SicorPublication, 'id' | 'conditionCode' | 'regionCode' | 'period'>;
  itemCount?: number;
  compositionCount?: number;
}

export interface SicorSyncReport {
  started: string;
  finished: string;
  totalAttempted: number;
  totalSuccess: number;
  totalFailed: number;
  results: SicorSyncResult[];
}

function getAuthToken(input?: string): string {
  const token = input || process.env.SICOR_MG_TOKEN || process.env.DER_MG_SCO_TOKEN || '';
  if (!token.trim()) {
    throw new Error('Token SICOR-MG ausente. Informe authToken ou configure SICOR_MG_TOKEN/DER_MG_SCO_TOKEN.');
  }
  return token.trim();
}

async function sicorFetch(path: string, authToken: string, timeoutMs = 120000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SICOR_API_BASE}${path}`, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${authToken}`,
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${path}${body ? `: ${body.slice(0, 240)}` : ''}`);
    }
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

async function sicorJson<T>(path: string, authToken: string): Promise<T> {
  const res = await sicorFetch(path, authToken);
  return await res.json() as T;
}

function parseMonth(value: any): number {
  if (typeof value === 'number') return value >= 1 && value <= 12 ? value : 0;
  const text = String(value || '').trim().toUpperCase();
  if (/^\d{1,2}$/.test(text)) {
    const parsed = Number(text);
    return parsed >= 1 && parsed <= 12 ? parsed : 0;
  }
  const months: Record<string, number> = {
    JAN: 1, JANEIRO: 1,
    FEV: 2, FEVEREIRO: 2,
    MAR: 3, MARCO: 3, MARÇO: 3,
    ABR: 4, ABRIL: 4,
    MAI: 5, MAIO: 5,
    JUN: 6, JUNHO: 6,
    JUL: 7, JULHO: 7,
    AGO: 8, AGOSTO: 8,
    SET: 9, SETEMBRO: 9,
    OUT: 10, OUTUBRO: 10,
    NOV: 11, NOVEMBRO: 11,
    DEZ: 12, DEZEMBRO: 12,
  };
  return months[text] || 0;
}

function normalizeCondition(value: any): SicorConditionCode | null {
  const code = String(value?.codigo || value || '').trim().toUpperCase();
  if (code === 'CD' || code === 'SD') return code;
  return null;
}

function conditionToPayrollExemption(condition: SicorConditionCode): boolean {
  return condition === 'CD';
}

function extractAttachment(value: any): SicorAttachment | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const id = value.id ?? value.idAnexo ?? value.cdAnexo;
  if (id === null || id === undefined || id === '') return undefined;
  return { id, fileName: value.nmArquivo || value.nome || value.fileName };
}

function normalizeRegion(value: any): SicorRegion | null {
  const tpRegiao = value?.tpRegiao || value;
  const code = String(tpRegiao?.codigo || tpRegiao?.id || '').trim();
  const description = String(tpRegiao?.descricao || tpRegiao?.deRegiao || '').trim();
  if (!code) return null;
  return { code, description: description || code };
}

export function normalizeSicorPublication(row: any): SicorPublication | null {
  const conditionCode = normalizeCondition(row?.tpCondicao);
  const region = normalizeRegion(row?.tpRegiao);
  const year = Number(row?.publicacao?.nrAno || row?.nrAno || row?.ano || 0);
  const month = parseMonth(row?.publicacao?.tpMes || row?.tpMes || row?.mes);
  if (!conditionCode || !region || !year || !month) return null;

  return {
    id: row.id,
    conditionCode,
    payrollExemption: conditionToPayrollExemption(conditionCode),
    conditionDescription: String(row?.tpCondicao?.descricao || conditionCode),
    regionCode: region.code,
    regionDescription: region.description,
    period: {
      year,
      month,
      label: `${String(month).padStart(2, '0')}/${year}`,
      version: `${String(month).padStart(2, '0')}/${year}`,
    },
    publishedAt: row?.publicacao?.dtPublicacao || row?.dtPublicacao,
    raw: row,
    xlsServicesAttachment: extractAttachment(row.xlsServicos),
    xlsCompositionsAttachment: extractAttachment(row.xlsComposicoes),
  };
}

function publicationSort(a: SicorPublication, b: SicorPublication): number {
  return b.period.year - a.period.year
    || b.period.month - a.period.month
    || String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));
}

export async function getSicorRegions(authToken?: string): Promise<SicorRegion[]> {
  const token = getAuthToken(authToken);
  const rows = await sicorJson<any[]>('/municipios?sort=deMunicipio&deMunicipio=', token);
  const byCode = new Map<string, SicorRegion>();
  for (const row of rows || []) {
    const region = normalizeRegion(row);
    if (region) byCode.set(region.code, region);
  }
  return [...byCode.values()].sort((a, b) => a.description.localeCompare(b.description));
}

async function getSicorYears(authToken: string): Promise<number[]> {
  const rows = await sicorJson<any[]>('/anos', authToken);
  return [...new Set((rows || [])
    .map((row: any) => Number(row?.nrAno || row?.ano || row))
    .filter(Boolean))]
    .sort((a, b) => b - a);
}

async function listSicorPublicationsFor(authToken: string, year: number, condition: SicorConditionCode, regionCode: string): Promise<SicorPublication[]> {
  const params = new URLSearchParams({
    tpCondicao: condition,
    nrAno: String(year),
    tpRegiao: regionCode,
  });
  const rows = await sicorJson<any[]>(`/itens?${params.toString()}`, authToken);
  return (rows || [])
    .map(normalizeSicorPublication)
    .filter((publication): publication is SicorPublication => Boolean(publication));
}

export async function getLatestSicorPublications(options: SicorSyncOptions = {}): Promise<SicorPublication[]> {
  const token = getAuthToken(options.authToken);
  const months = Math.max(1, Math.min(Number(options.months || 12), 24));
  const conditions = (options.conditions?.length ? options.conditions : ['SD', 'CD'])
    .map(normalizeCondition)
    .filter((condition): condition is SicorConditionCode => Boolean(condition));
  if (conditions.length === 0) throw new Error('Nenhuma condição SICOR-MG válida. Use CD e/ou SD.');
  const regions = options.regionCodes?.length
    ? options.regionCodes.map(String)
    : (await getSicorRegions(token)).map(region => region.code);
  const years = await getSicorYears(token);
  const publications: SicorPublication[] = [];

  for (const year of years) {
    for (const regionCode of regions) {
      for (const condition of conditions) {
        try {
          publications.push(...await listSicorPublicationsFor(token, year, condition, regionCode));
        } catch (e: any) {
          console.warn(`[SICOR-MG Sync] Falha ao listar ${year}/${regionCode}/${condition}: ${e.message}`);
        }
      }
    }
    const periodCount = new Set(publications.map(item => `${item.period.year}-${item.period.month}`)).size;
    if (periodCount >= months) break;
  }

  const latestPeriodKeys = [...new Set(publications
    .sort(publicationSort)
    .map(item => `${item.period.year}-${String(item.period.month).padStart(2, '0')}`))]
    .slice(0, months);
  const allowed = new Set(latestPeriodKeys);
  return publications
    .filter(item => allowed.has(`${item.period.year}-${String(item.period.month).padStart(2, '0')}`))
    .sort(publicationSort);
}

async function downloadSicorAttachment(attachment: SicorAttachment, authToken: string): Promise<Buffer> {
  const params = new URLSearchParams({ idAnexo: String(attachment.id) });
  const res = await sicorFetch(`/download?${params.toString()}`, authToken, 180000);
  return Buffer.from(await res.arrayBuffer());
}

function parseBrNumber(value: any): number {
  if (typeof value === 'number') return value;
  const cleaned = String(value || '').replace(/[^\d,.\-]/g, '');
  if (!cleaned) return 0;
  return cleaned.includes(',') && (!cleaned.includes('.') || cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.'))
    ? parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0
    : parseFloat(cleaned.replace(/,/g, '')) || 0;
}

function normalizeHeader(value: any): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function findHeader(rows: any[][]): { index: number; columns: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const row = rows[i].map(normalizeHeader);
    const code = row.findIndex(col => col === 'CODIGO' || col.includes('CODIGO AUXILIAR') || col.includes('CD AUXILIAR') || col.includes('CODIGO DO SERVICO'));
    const desc = row.findIndex(col => col.includes('DESCRICAO') || col.includes('SERVICO') || col.includes('ITEM'));
    const unit = row.findIndex(col => col === 'UN' || col.includes('UNIDADE') || col === 'UNID.');
    const price = row.findIndex(col => col.includes('CUSTO UNITARIO') || col.includes('PRECO') || col.includes('VALOR') || col.includes('CUSTO'));
    if (code >= 0 && desc >= 0 && price >= 0) return { index: i, columns: { code, desc, unit, price } };
  }
  return null;
}

function detectType(code: string, description: string, defaultType: SicorParsedRow['type']): SicorParsedRow['type'] {
  const desc = normalizeHeader(description);
  if (defaultType === 'SERVICO') return 'SERVICO';
  if (desc.includes('PEDREIRO') || desc.includes('SERVENTE') || desc.includes('ENGENHEIRO') ||
    desc.includes('OPERADOR') || desc.includes('MOTORISTA') || desc.includes('MAO DE OBRA')) return 'MAO_DE_OBRA';
  if (desc.includes('CAMINHAO') || desc.includes('ESCAVADEIRA') || desc.includes('TRATOR') ||
    desc.includes('ROLO ') || desc.includes('EQUIPAMENTO') || desc.includes('MAQUINA')) return 'EQUIPAMENTO';
  if (/^[A-Z]{1,4}\d{3,}/i.test(code)) return 'SERVICO';
  return 'MATERIAL';
}

export function parseSicorWorkbook(buffer: Buffer, defaultType: SicorParsedRow['type'] = 'SERVICO'): SicorParsedRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const byCode = new Map<string, SicorParsedRow>();

  for (const sheetName of workbook.SheetNames) {
    const rows: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    const header = findHeader(rows);
    if (!header) continue;

    for (let i = header.index + 1; i < rows.length; i++) {
      const row = rows[i];
      const code = String(row[header.columns.code] || '').trim().toUpperCase();
      const description = String(row[header.columns.desc] || '').replace(/\s+/g, ' ').trim();
      const unit = header.columns.unit >= 0 ? String(row[header.columns.unit] || 'UN').trim().toUpperCase() : 'UN';
      const price = parseBrNumber(row[header.columns.price]);
      if (!code || code.length < 2 || !description || price <= 0) continue;
      byCode.set(code, {
        code,
        description,
        unit: unit || 'UN',
        price,
        type: detectType(code, description, defaultType),
      });
    }
  }

  return [...byCode.values()];
}

async function persistSicorPublication(publication: SicorPublication, rows: SicorParsedRow[], force: boolean): Promise<SicorSyncResult> {
  let db = await prisma.engineeringDatabase.findFirst({
    where: {
      name: 'SICOR',
      uf: `MG-${publication.regionCode}`,
      type: 'OFICIAL',
      referenceMonth: publication.period.month,
      referenceYear: publication.period.year,
      payrollExemption: publication.payrollExemption,
    },
  });

  if (db && !force && (db.itemCount > 0 || db.compositionCount > 0)) {
    return {
      success: true,
      message: `Already synced: SICOR-MG ${publication.regionDescription} ${publication.period.version} ${publication.conditionCode}`,
      databaseId: db.id,
      publication,
      itemCount: db.itemCount,
      compositionCount: db.compositionCount,
    };
  }

  if (db) {
    await prisma.engineeringItem.deleteMany({ where: { databaseId: db.id } });
    await prisma.engineeringComposition.deleteMany({ where: { databaseId: db.id } });
  } else {
    db = await prisma.engineeringDatabase.create({
      data: {
        name: 'SICOR',
        uf: `MG-${publication.regionCode}`,
        version: publication.period.version,
        type: 'OFICIAL',
        payrollExemption: publication.payrollExemption,
        referenceMonth: publication.period.month,
        referenceYear: publication.period.year,
      },
    });
  }

  const items = rows.filter(row => row.type !== 'SERVICO');
  const services = rows.filter(row => row.type === 'SERVICO');
  let itemCount = 0;
  let compositionCount = 0;

  for (let i = 0; i < items.length; i += 1000) {
    const result = await prisma.engineeringItem.createMany({
      data: items.slice(i, i + 1000).map(item => ({ databaseId: db!.id, ...item })),
      skipDuplicates: true,
    });
    itemCount += result.count;
  }

  for (let i = 0; i < services.length; i += 1000) {
    const result = await prisma.engineeringComposition.createMany({
      data: services.slice(i, i + 1000).map(service => ({
        databaseId: db!.id,
        code: service.code,
        description: service.description,
        unit: service.unit,
        totalPrice: service.price,
      })),
      skipDuplicates: true,
    });
    compositionCount += result.count;
  }

  await prisma.engineeringDatabase.update({
    where: { id: db.id },
    data: {
      itemCount,
      compositionCount,
      version: publication.period.version,
      payrollExemption: publication.payrollExemption,
    },
  });

  return {
    success: true,
    message: `SICOR-MG ${publication.regionDescription} ${publication.period.version} ${publication.conditionCode}: ${itemCount} insumos + ${compositionCount} serviços`,
    databaseId: db.id,
    publication,
    itemCount,
    compositionCount,
  };
}

export async function syncSicorMg(options: SicorSyncOptions = {}): Promise<SicorSyncReport> {
  const started = new Date().toISOString();
  const token = getAuthToken(options.authToken);
  const publications = await getLatestSicorPublications({ ...options, authToken: token });
  const results: SicorSyncResult[] = [];

  console.log(`[SICOR-MG Sync] Starting sync for ${publications.length} publicações`);

  for (const publication of publications) {
    try {
      const attachment = publication.xlsServicesAttachment;
      if (!attachment) {
        results.push({ success: false, message: `SICOR-MG ${publication.period.version}: XLS de serviços indisponível`, publication });
        continue;
      }

      const serviceBuffer = await downloadSicorAttachment(attachment, token);
      let rows = parseSicorWorkbook(serviceBuffer, 'SERVICO');

      if (options.includeCompositionWorkbook && publication.xlsCompositionsAttachment) {
        const compositionBuffer = await downloadSicorAttachment(publication.xlsCompositionsAttachment, token);
        rows = [...rows, ...parseSicorWorkbook(compositionBuffer, 'MATERIAL')];
      }

      if (rows.length === 0) {
        results.push({ success: false, message: `SICOR-MG ${publication.period.version}: nenhum item válido no XLS`, publication });
        continue;
      }

      results.push(await persistSicorPublication(publication, rows, Boolean(options.force)));
    } catch (e: any) {
      console.error(`[SICOR-MG Sync] Failed ${publication.period.version}/${publication.regionCode}/${publication.conditionCode}:`, e);
      results.push({ success: false, message: `SICOR-MG ${publication.period.version}: ${e.message}`, publication });
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
