import 'dotenv/config';
import { syncSinapi } from '../services/engineering/sinapiCrawler';
import { prisma } from '../lib/prisma';

type Period = { month: number; year: number };

const USAGE = `
Uso:
  npm --prefix server run sinapi:reprocess -- --period 2026-02 --confirm-all
  npm --prefix server run sinapi:reprocess -- --months 12 --confirm-all
  npm --prefix server run sinapi:reprocess -- --from 2025-10 --to 2026-03 --confirm-all

Opcoes:
  --period AAAA-MM      Reprocessa uma data-base especifica.
  --from AAAA-MM        Inicio do intervalo.
  --to AAAA-MM          Fim do intervalo.
  --months N           Ultimos N meses a partir de hoje. Padrao: 12.
  --uf UF|ALL          UF especifica ou ALL. Padrao: ALL.
  --force              Reimporta mesmo se a base ja existir. Padrao: true.
  --no-force           Pula bases completas ja existentes.
  --onerado-only       Importa somente onerado.
  --confirm-all        Confirmacao obrigatoria para ALL + force.
`;

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

function parsePeriod(value: string, label: string): Period {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error(`${label} invalido: use AAAA-MM.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`${label} invalido: mes deve ser 01-12.`);
  return { month, year };
}

function periodKey(period: Period): string {
  return `${period.year}-${String(period.month).padStart(2, '0')}`;
}

function buildRange(from: Period, to: Period): Period[] {
  const periods: Period[] = [];
  const cursor = new Date(from.year, from.month - 1, 1);
  const end = new Date(to.year, to.month - 1, 1);
  if (cursor > end) throw new Error('--from nao pode ser posterior a --to.');

  while (cursor <= end) {
    periods.push({ month: cursor.getMonth() + 1, year: cursor.getFullYear() });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return periods;
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(USAGE);
    return;
  }

  const uf = (readArg('--uf') || 'ALL').trim().toUpperCase();
  const force = !hasFlag('--no-force');
  const includeDesonerado = !hasFlag('--onerado-only');
  const singlePeriod = readArg('--period');
  const fromArg = readArg('--from');
  const toArg = readArg('--to');

  let targetPeriods: Period[] | undefined;
  let months = Number(readArg('--months') || 36);

  if (singlePeriod) {
    targetPeriods = [parsePeriod(singlePeriod, '--period')];
    months = targetPeriods.length;
  } else if (fromArg || toArg) {
    if (!fromArg || !toArg) throw new Error('Use --from e --to juntos.');
    targetPeriods = buildRange(parsePeriod(fromArg, '--from'), parsePeriod(toArg, '--to'));
    months = targetPeriods.length;
  } else if (!Number.isFinite(months) || months < 1 || months > 48) {
    throw new Error('--months deve ser um numero entre 1 e 48.');
  }

  if (uf === 'ALL' && force && !hasFlag('--confirm-all')) {
    throw new Error('Reprocessamento ALL + force exige --confirm-all para evitar execucao acidental.');
  }

  const scope = targetPeriods?.map(periodKey).join(', ') || `ultimos ${months} meses`;
  console.log('[SINAPI Reprocess] Escopo:');
  console.log(`  UFs: ${uf === 'ALL' ? 'todos os estados' : uf}`);
  console.log(`  Data-base: ${scope}`);
  console.log(`  Regimes: ${includeDesonerado ? 'onerado + desonerado' : 'somente onerado'}`);
  console.log(`  Force: ${force ? 'sim' : 'nao'}`);

  const started = Date.now();
  const report = await syncSinapi({
    ufs: [uf],
    months,
    includeDesonerado,
    force,
    targetPeriods,
  });

  const seconds = Math.round((Date.now() - started) / 1000);
  console.log('[SINAPI Reprocess] Finalizado:');
  console.log(`  Tentativas: ${report.totalAttempted}`);
  console.log(`  Sucesso: ${report.totalSuccess}`);
  console.log(`  Falhas: ${report.totalFailed}`);
  console.log(`  Duracao: ${seconds}s`);

  if (report.totalFailed > 0) {
    console.log('[SINAPI Reprocess] Falhas:');
    for (const result of report.results.filter(result => !result.success).slice(0, 30)) {
      console.log(`  - ${result.message}`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch(error => {
    console.error('[SINAPI Reprocess] Erro:', error?.message || error);
    console.error(USAGE);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
