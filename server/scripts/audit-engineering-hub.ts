import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';

type Severity = 'critical' | 'high' | 'medium' | 'low';

type Finding = {
  severity: Severity;
  code: string;
  message: string;
  databaseId?: string;
  database?: string;
  sample?: unknown;
  count?: number;
  fixable?: boolean;
};

type DatabaseSummary = {
  id: string;
  key: string;
  name: string;
  uf: string | null;
  version: string | null;
  reference: string;
  regime: string;
  itemCount: number;
  actualItems: number;
  compositionCount: number;
  actualCompositions: number;
  compositionItems: number;
};

type AuditReport = {
  startedAt: string;
  finishedAt: string;
  filters: {
    source?: string;
    uf?: string;
    period?: string;
  };
  totals: Record<string, number>;
  databases: DatabaseSummary[];
  findings: Finding[];
};

const SOURCE_WITH_REGIME = new Set(['SINAPI', 'SEINFRA', 'SICOR']);
const NUMERIC_CODE_SOURCES = new Set(['SINAPI', 'SEDOP']);

function readArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function normalizeSource(value?: string): string | undefined {
  const source = value?.trim().toUpperCase();
  return source || undefined;
}

function normalizeUf(value?: string): string | undefined {
  const uf = value?.trim().toUpperCase();
  if (!uf || uf === 'ALL') return undefined;
  return uf;
}

function parsePeriod(value?: string): { month: number; year: number; label: string } | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error('--period deve usar AAAA-MM.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error('--period deve usar mes 01-12.');
  return { month, year, label: `${year}-${String(month).padStart(2, '0')}` };
}

function referenceLabel(month?: number | null, year?: number | null, version?: string | null): string {
  if (month && year) return `${year}-${String(month).padStart(2, '0')}`;
  return version || 'sem-data';
}

function databaseKey(db: any): string {
  return [
    db.name,
    db.uf || 'BR',
    referenceLabel(db.referenceMonth, db.referenceYear, db.version),
    SOURCE_WITH_REGIME.has(String(db.name).toUpperCase()) ? (db.payrollExemption ? 'DESONERADO' : 'ONERADO') : 'UNICO',
    db.type,
    db.tenantId || 'GLOBAL',
  ].join('|');
}

function normalizeMatchCode(source: string, code: string): string {
  const cleaned = String(code || '').trim().toUpperCase();
  if (NUMERIC_CODE_SOURCES.has(source) && /^\d+$/.test(cleaned)) {
    return cleaned.replace(/^0+/, '') || '0';
  }
  return cleaned.replace(/\s+/g, '');
}

function addFinding(findings: Finding[], finding: Finding) {
  findings.push(finding);
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
Uso:
  npm --prefix server run hub:audit
  npm --prefix server run hub:audit -- --source SINAPI --period 2026-02
  npm --prefix server run hub:audit -- --source SINAPI --uf PA --period 2026-02 --fix-counters

Padrao: somente leitura. Use --fix-counters apenas para corrigir contadores exibidos no Hub.
`);
    return;
  }

  const source = normalizeSource(readArg('--source'));
  const uf = normalizeUf(readArg('--uf'));
  const period = parsePeriod(readArg('--period'));
  const fixCounters = hasFlag('--fix-counters');
  const outFile = readArg('--out');

  const startedAt = new Date().toISOString();
  const findings: Finding[] = [];

  const where: any = {};
  if (source) where.name = source;
  if (uf) where.uf = uf;
  if (period) {
    where.referenceMonth = period.month;
    where.referenceYear = period.year;
  }

  const databases = await prisma.engineeringDatabase.findMany({
    where,
    orderBy: [{ name: 'asc' }, { uf: 'asc' }, { referenceYear: 'desc' }, { referenceMonth: 'desc' }, { payrollExemption: 'asc' }],
  });

  const summaries: DatabaseSummary[] = [];
  const logicalKeys = new Map<string, string[]>();

  for (const db of databases) {
    const [actualItems, actualCompositions, compositionItems] = await Promise.all([
      prisma.engineeringItem.count({ where: { databaseId: db.id } }),
      prisma.engineeringComposition.count({ where: { databaseId: db.id } }),
      prisma.engineeringCompositionItem.count({ where: { composition: { databaseId: db.id } } }),
    ]);

    const key = databaseKey(db);
    logicalKeys.set(key, [...(logicalKeys.get(key) || []), db.id]);

    summaries.push({
      id: db.id,
      key,
      name: db.name,
      uf: db.uf,
      version: db.version,
      reference: referenceLabel(db.referenceMonth, db.referenceYear, db.version),
      regime: db.payrollExemption ? 'Desonerado' : 'Onerado',
      itemCount: db.itemCount,
      actualItems,
      compositionCount: db.compositionCount,
      actualCompositions,
      compositionItems,
    });

    if (db.itemCount !== actualItems || db.compositionCount !== actualCompositions) {
      addFinding(findings, {
        severity: 'medium',
        code: 'COUNTER_MISMATCH',
        databaseId: db.id,
        database: key,
        message: `Contadores do Hub divergentes: itemCount ${db.itemCount} vs ${actualItems}; compositionCount ${db.compositionCount} vs ${actualCompositions}.`,
        fixable: true,
      });

      if (fixCounters) {
        await prisma.engineeringDatabase.update({
          where: { id: db.id },
          data: { itemCount: actualItems, compositionCount: actualCompositions },
        });
      }
    }

    const sourceName = String(db.name || '').toUpperCase();
    if (db.type === 'OFICIAL') {
      if (!db.name?.trim()) {
        addFinding(findings, { severity: 'critical', code: 'DATABASE_WITHOUT_SOURCE', databaseId: db.id, database: key, message: 'Base oficial sem nome/fonte.' });
      }
      if (!db.uf?.trim() && sourceName !== 'SINAPI' && sourceName !== 'ORSE') {
        addFinding(findings, { severity: 'medium', code: 'DATABASE_WITHOUT_UF', databaseId: db.id, database: key, message: 'Base oficial sem UF/regiao.' });
      }
      if (sourceName === 'SINAPI' && (!db.referenceMonth || !db.referenceYear)) {
        addFinding(findings, { severity: 'high', code: 'SINAPI_WITHOUT_REFERENCE', databaseId: db.id, database: key, message: 'Base SINAPI sem referenceMonth/referenceYear, prejudicando match por data-base.' });
      }
    }

    if (actualItems === 0 && actualCompositions === 0) {
      addFinding(findings, { severity: 'high', code: 'EMPTY_DATABASE', databaseId: db.id, database: key, message: 'Base sem itens e sem composicoes.' });
    }

    if (actualCompositions > 0 && compositionItems === 0) {
      addFinding(findings, { severity: 'high', code: 'NO_ANALYTICAL_ROWS', databaseId: db.id, database: key, message: 'Base possui composicoes sinteticas, mas nenhuma linha analitica.' });
    }

    const malformedItems = await prisma.engineeringItem.findMany({
      where: {
        databaseId: db.id,
        OR: [
          { code: '' },
          { description: '' },
          { unit: '' },
          { price: { lte: 0 } },
        ],
      },
      take: 10,
      select: { id: true, code: true, description: true, unit: true, price: true },
    });
    if (malformedItems.length > 0) {
      addFinding(findings, {
        severity: 'medium',
        code: 'MALFORMED_ITEMS',
        databaseId: db.id,
        database: key,
        message: 'Itens com codigo/descricao/unidade vazios ou preco <= 0.',
        count: malformedItems.length,
        sample: malformedItems,
      });
    }

    const malformedCompositions = await prisma.engineeringComposition.findMany({
      where: {
        databaseId: db.id,
        OR: [
          { code: '' },
          { description: '' },
          { unit: '' },
          { totalPrice: { lte: 0 } },
        ],
      },
      take: 10,
      select: { id: true, code: true, description: true, unit: true, totalPrice: true },
    });
    if (malformedCompositions.length > 0) {
      addFinding(findings, {
        severity: 'medium',
        code: 'MALFORMED_COMPOSITIONS',
        databaseId: db.id,
        database: key,
        message: 'Composicoes com codigo/descricao/unidade vazios ou totalPrice <= 0.',
        count: malformedCompositions.length,
        sample: malformedCompositions,
      });
    }

    const items = await prisma.engineeringItem.findMany({
      where: { databaseId: db.id },
      select: { code: true },
    });
    const itemCodes = new Map<string, number>();
    for (const item of items) {
      const code = normalizeMatchCode(sourceName, item.code);
      itemCodes.set(code, (itemCodes.get(code) || 0) + 1);
    }
    const duplicatedItemCodes = [...itemCodes.entries()].filter(([, count]) => count > 1).slice(0, 10);
    if (duplicatedItemCodes.length > 0) {
      addFinding(findings, {
        severity: 'high',
        code: 'MATCH_DUPLICATE_ITEM_CODES',
        databaseId: db.id,
        database: key,
        message: 'Codigos de itens colidem apos normalizacao de match.',
        sample: duplicatedItemCodes,
      });
    }

    const compositions = await prisma.engineeringComposition.findMany({
      where: { databaseId: db.id },
      select: { code: true },
    });
    const compositionCodes = new Map<string, number>();
    for (const composition of compositions) {
      const code = normalizeMatchCode(sourceName, composition.code);
      compositionCodes.set(code, (compositionCodes.get(code) || 0) + 1);
    }
    const duplicatedCompositionCodes = [...compositionCodes.entries()].filter(([, count]) => count > 1).slice(0, 10);
    if (duplicatedCompositionCodes.length > 0) {
      addFinding(findings, {
        severity: 'high',
        code: 'MATCH_DUPLICATE_COMPOSITION_CODES',
        databaseId: db.id,
        database: key,
        message: 'Codigos de composicoes colidem apos normalizacao de match.',
        sample: duplicatedCompositionCodes,
      });
    }

    const relationProblems = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        COUNT(*) FILTER (WHERE ci."itemId" IS NULL AND ci."auxiliaryCompositionId" IS NULL) AS "missingChild",
        COUNT(*) FILTER (WHERE ci."itemId" IS NOT NULL AND ci."auxiliaryCompositionId" IS NOT NULL) AS "doubleChild",
        COUNT(*) FILTER (WHERE ci."coefficient" <= 0) AS "invalidCoefficient",
        COUNT(*) FILTER (WHERE ci."itemId" IS NOT NULL AND child."databaseId" <> c."databaseId") AS "crossDatabaseItems",
        COUNT(*) FILTER (WHERE ci."auxiliaryCompositionId" IS NOT NULL AND aux."databaseId" <> c."databaseId") AS "crossDatabaseAux"
      FROM "EngineeringCompositionItem" ci
      JOIN "EngineeringComposition" c ON c.id = ci."compositionId"
      LEFT JOIN "EngineeringItem" child ON child.id = ci."itemId"
      LEFT JOIN "EngineeringComposition" aux ON aux.id = ci."auxiliaryCompositionId"
      WHERE c."databaseId" = $1
    `, db.id);

    const relation = relationProblems[0] || {};
    const relationCounts = {
      missingChild: Number(relation.missingChild || 0),
      doubleChild: Number(relation.doubleChild || 0),
      invalidCoefficient: Number(relation.invalidCoefficient || 0),
      crossDatabaseItems: Number(relation.crossDatabaseItems || 0),
      crossDatabaseAux: Number(relation.crossDatabaseAux || 0),
    };
    for (const [problem, count] of Object.entries(relationCounts)) {
      if (count > 0) {
        addFinding(findings, {
          severity: problem.startsWith('crossDatabase') ? 'critical' : 'high',
          code: `COMPOSITION_ITEM_${problem.toUpperCase()}`,
          databaseId: db.id,
          database: key,
          message: `Itens analiticos com problema relacional: ${problem}.`,
          count,
        });
      }
    }

    const priceDivergence = await prisma.$queryRawUnsafe<any[]>(`
      SELECT COUNT(*) AS count
      FROM "EngineeringCompositionItem" ci
      JOIN "EngineeringComposition" c ON c.id = ci."compositionId"
      LEFT JOIN "EngineeringItem" item ON item.id = ci."itemId"
      LEFT JOIN "EngineeringComposition" aux ON aux.id = ci."auxiliaryCompositionId"
      WHERE c."databaseId" = $1
        AND ABS(ci.price - COALESCE(item.price, aux."totalPrice", 0) * ci.coefficient) > GREATEST(0.02, ABS(COALESCE(item.price, aux."totalPrice", 0) * ci.coefficient) * 0.01)
    `, db.id);
    const divergentRows = Number(priceDivergence[0]?.count || 0);
    if (divergentRows > 0) {
      addFinding(findings, {
        severity: 'medium',
        code: 'COMPOSITION_ITEM_PRICE_DIVERGENCE',
        databaseId: db.id,
        database: key,
        message: 'Linhas analiticas com subtotal diferente de preco unitario x coeficiente.',
        count: divergentRows,
      });
    }

    const coverageRows = await prisma.$queryRawUnsafe<any[]>(`
      WITH totals AS (
        SELECT
          c.id,
          c.code,
          c."totalPrice",
          COALESCE(SUM(ci.price), 0) AS analytic
        FROM "EngineeringComposition" c
        LEFT JOIN "EngineeringCompositionItem" ci ON ci."compositionId" = c.id
        WHERE c."databaseId" = $1
        GROUP BY c.id
      )
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE analytic = 0) AS zero,
        COUNT(*) FILTER (
          WHERE "totalPrice" > 0
            AND analytic > 0
            AND analytic / NULLIF("totalPrice", 0) < 0.85
        ) AS below85,
        COUNT(*) FILTER (
          WHERE "totalPrice" > 0
            AND analytic > 0
            AND ABS(analytic - "totalPrice") / NULLIF("totalPrice", 0) > 0.05
        ) AS divergence5,
        MIN(CASE WHEN "totalPrice" > 0 THEN analytic / NULLIF("totalPrice", 0) END) AS "worstCoverage"
      FROM totals
    `, db.id);
    const coverage = coverageRows[0] || {};
    const zero = Number(coverage.zero || 0);
    const below85 = Number(coverage.below85 || 0);
    const divergence5 = Number(coverage.divergence5 || 0);
    if (zero > 0) {
      addFinding(findings, {
        severity: 'high',
        code: 'COMPOSITIONS_WITHOUT_ANALYTICAL_ITEMS',
        databaseId: db.id,
        database: key,
        message: 'Composicoes sem nenhum item analitico.',
        count: zero,
      });
    }
    if (below85 > 0) {
      addFinding(findings, {
        severity: 'high',
        code: 'LOW_ANALYTICAL_COVERAGE',
        databaseId: db.id,
        database: key,
        message: `Composicoes com soma analitica abaixo de 85% do preco sintetico. Pior cobertura: ${(Number(coverage.worstCoverage || 0) * 100).toFixed(1)}%.`,
        count: below85,
      });
    }
    if (divergence5 > 0) {
      addFinding(findings, {
        severity: 'low',
        code: 'ANALYTICAL_TOTAL_DIVERGENCE',
        databaseId: db.id,
        database: key,
        message: 'Composicoes com soma analitica divergindo mais de 5% do preco sintetico.',
        count: divergence5,
      });
    }
  }

  for (const [key, ids] of logicalKeys.entries()) {
    if (ids.length > 1) {
      addFinding(findings, {
        severity: 'critical',
        code: 'DUPLICATE_LOGICAL_DATABASE',
        database: key,
        message: 'Ha mais de uma base com a mesma fonte/UF/data/regime/tipo/tenant. O match pode escolher uma base inesperada.',
        count: ids.length,
        sample: ids,
      });
    }
  }

  const totals = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] || 0) + 1;
    acc[finding.code] = (acc[finding.code] || 0) + 1;
    return acc;
  }, {});

  const report: AuditReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    filters: { source, uf, period: period?.label },
    totals,
    databases: summaries,
    findings,
  };

  const outputPath = outFile || path.join(process.cwd(), 'engineering-hub-audit-report.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log('[Engineering Hub Audit] Bases analisadas:', summaries.length);
  console.log('[Engineering Hub Audit] Findings:', findings.length);
  console.log('[Engineering Hub Audit] Severidade:', {
    critical: totals.critical || 0,
    high: totals.high || 0,
    medium: totals.medium || 0,
    low: totals.low || 0,
  });
  console.log('[Engineering Hub Audit] Relatorio:', outputPath);

  const topFindings = findings
    .filter(finding => finding.severity === 'critical' || finding.severity === 'high')
    .slice(0, 20);
  if (topFindings.length > 0) {
    console.log('[Engineering Hub Audit] Principais falhas:');
    for (const finding of topFindings) {
      console.log(`  [${finding.severity}] ${finding.code}: ${finding.database || finding.databaseId || ''} ${finding.message}${finding.count ? ` (${finding.count})` : ''}`);
    }
  }
}

main()
  .catch(error => {
    console.error('[Engineering Hub Audit] Erro:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
