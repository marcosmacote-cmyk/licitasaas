import 'dotenv/config';
import { prisma } from '../lib/prisma';

type PurgeTarget = {
  id: string;
  name: string;
  uf: string | null;
  type: string;
  version: string | null;
  referenceMonth: number | null;
  referenceYear: number | null;
  payrollExemption: boolean;
  itemCount: number;
  compositionCount: number;
  actualItems: number;
  actualCompositions: number;
  compositionItems: number;
};

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

function normalizeSource(value?: string): string {
  return String(value || '').trim().toUpperCase();
}

function normalizeUf(value?: string): string | undefined {
  const uf = String(value || '').trim().toUpperCase();
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

function parseRegime(value?: string): boolean | undefined {
  const regime = String(value || '').trim().toLowerCase();
  if (!regime || regime === 'all' || regime === 'todos') return undefined;
  if (['desonerado', 'desonerada', 'd', 'true'].includes(regime)) return true;
  if (['onerado', 'onerada', 'o', 'false'].includes(regime)) return false;
  throw new Error('--regime deve ser onerado, desonerado ou all.');
}

function referenceLabel(target: Pick<PurgeTarget, 'referenceMonth' | 'referenceYear' | 'version'>): string {
  if (target.referenceMonth && target.referenceYear) {
    return `${target.referenceYear}-${String(target.referenceMonth).padStart(2, '0')}`;
  }
  return target.version || 'sem-data';
}

function formatTarget(target: PurgeTarget): string {
  return [
    target.name,
    target.uf || 'BR',
    referenceLabel(target),
    target.payrollExemption ? 'Desonerado' : 'Onerado',
    target.type,
  ].join(' | ');
}

async function collectTargets(where: any): Promise<PurgeTarget[]> {
  const databases = await prisma.engineeringDatabase.findMany({
    where,
    orderBy: [{ name: 'asc' }, { uf: 'asc' }, { referenceYear: 'desc' }, { referenceMonth: 'desc' }, { payrollExemption: 'asc' }],
    select: {
      id: true,
      name: true,
      uf: true,
      type: true,
      version: true,
      referenceMonth: true,
      referenceYear: true,
      payrollExemption: true,
      itemCount: true,
      compositionCount: true,
    },
  });

  const targets: PurgeTarget[] = [];
  for (const db of databases) {
    const [actualItems, actualCompositions, compositionItems] = await Promise.all([
      prisma.engineeringItem.count({ where: { databaseId: db.id } }),
      prisma.engineeringComposition.count({ where: { databaseId: db.id } }),
      prisma.engineeringCompositionItem.count({ where: { composition: { databaseId: db.id } } }),
    ]);

    targets.push({ ...db, actualItems, actualCompositions, compositionItems });
  }
  return targets;
}

async function purgeTargets(targets: PurgeTarget[]) {
  const ids = targets.map(target => target.id);
  if (ids.length === 0) return { compositionItems: 0, compositions: 0, items: 0, databases: 0 };

  return prisma.$transaction(async tx => {
    const compositionItemsFromParents = await tx.engineeringCompositionItem.deleteMany({
      where: { composition: { databaseId: { in: ids } } },
    });

    const compositionItemsFromChildren = await tx.engineeringCompositionItem.deleteMany({
      where: { item: { databaseId: { in: ids } } },
    });

    const compositionItemsFromAux = await tx.$executeRawUnsafe(`
      DELETE FROM "EngineeringCompositionItem" ci
      USING "EngineeringComposition" aux
      WHERE ci."auxiliaryCompositionId" = aux.id
        AND aux."databaseId" = ANY($1::text[])
    `, ids);

    const compositions = await tx.engineeringComposition.deleteMany({ where: { databaseId: { in: ids } } });
    const items = await tx.engineeringItem.deleteMany({ where: { databaseId: { in: ids } } });
    const databases = await tx.engineeringDatabase.deleteMany({ where: { id: { in: ids } } });

    return {
      compositionItems: compositionItemsFromParents.count + compositionItemsFromChildren.count + Number(compositionItemsFromAux || 0),
      compositions: compositions.count,
      items: items.count,
      databases: databases.count,
    };
  }, { timeout: 120_000 });
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
Uso:
  npm --prefix server run hub:purge -- --source SINAPI --period 2026-02
  npm --prefix server run hub:purge -- --source SINAPI --period 2026-02 --uf PA
  npm --prefix server run hub:purge -- --source SINAPI --period 2026-02 --regime desonerado --confirm-delete

Padrao: dry-run, nao apaga nada.
Para apagar, use --confirm-delete.
Para apagar uma fonte inteira sem --period/--uf, use tambem --all-source (trava extra).
`);
    return;
  }

  const source = normalizeSource(readArg('--source'));
  const uf = normalizeUf(readArg('--uf'));
  const period = parsePeriod(readArg('--period'));
  const regime = parseRegime(readArg('--regime'));
  const type = String(readArg('--type') || 'OFICIAL').trim().toUpperCase();
  const confirmDelete = hasFlag('--confirm-delete');
  const allSource = hasFlag('--all-source');

  if (!source) throw new Error('--source e obrigatorio.');
  if (type !== 'OFICIAL') throw new Error('Por seguranca, este comando limpa apenas bases OFICIAL.');
  if (!period && !uf && !allSource) {
    throw new Error('Informe --period e/ou --uf. Para apagar a fonte inteira, use --all-source explicitamente.');
  }

  const where: any = { name: source, type };
  if (uf) where.uf = uf;
  if (period) {
    where.referenceMonth = period.month;
    where.referenceYear = period.year;
  }
  if (regime !== undefined) where.payrollExemption = regime;

  const targets = await collectTargets(where);
  const totals = targets.reduce((acc, target) => ({
    databases: acc.databases + 1,
    items: acc.items + target.actualItems,
    compositions: acc.compositions + target.actualCompositions,
    compositionItems: acc.compositionItems + target.compositionItems,
  }), { databases: 0, items: 0, compositions: 0, compositionItems: 0 });

  console.log(`[Engineering Hub Purge] Modo: ${confirmDelete ? 'DELETE CONFIRMADO' : 'DRY-RUN'}`);
  console.log('[Engineering Hub Purge] Filtro:', {
    source,
    uf: uf || 'ALL',
    period: period?.label || 'ALL',
    regime: regime === undefined ? 'ALL' : (regime ? 'Desonerado' : 'Onerado'),
    type,
  });
  console.log('[Engineering Hub Purge] Bases encontradas:', totals.databases);
  console.log('[Engineering Hub Purge] Registros alvo:', {
    items: totals.items,
    compositions: totals.compositions,
    compositionItems: totals.compositionItems,
  });

  for (const target of targets.slice(0, 30)) {
    console.log(`  - ${formatTarget(target)} | items=${target.actualItems} comps=${target.actualCompositions} deps=${target.compositionItems}`);
  }
  if (targets.length > 30) console.log(`  ... e mais ${targets.length - 30} base(s)`);

  if (!confirmDelete) {
    console.log('[Engineering Hub Purge] Nenhum dado apagado. Rode novamente com --confirm-delete para executar.');
    return;
  }

  const deleted = await purgeTargets(targets);
  console.log('[Engineering Hub Purge] Apagado:', deleted);
}

main()
  .catch(error => {
    console.error('[Engineering Hub Purge] Erro:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
