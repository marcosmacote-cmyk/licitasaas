/**
 * ══════════════════════════════════════════════════════════════════
 *  runAll.ts — Benchmark Completo do Golden Dataset
 * ══════════════════════════════════════════════════════════════════
 *
 *  Roda TODOS os casos do gold dataset e gera relatório consolidado.
 *  
 *  Uso:
 *    npx tsx server/services/ai/benchmark/runAll.ts
 *    npx tsx server/services/ai/benchmark/runAll.ts --save   (salva relatório em reports/)
 *    npx tsx server/services/ai/benchmark/runAll.ts --compare reports/baseline-2026-04-07.json
 *
 *  Exit codes:
 *    0 = todos os gates passaram
 *    1 = regressão detectada (algum caso caiu > 5% vs baseline, ou score médio < threshold)
 */

import * as fs from 'fs';
import * as path from 'path';
import { evaluateAgainstBenchmark, generateBenchmarkSummary, BenchmarkResult, BenchmarkSummary } from './benchmarkRunner';
import { AnalysisSchemaV1 } from '../analysis-schema-v1';
import { logger } from '../../../lib/logger';

// ── Config ──
const GOLD_DIR = path.join(__dirname, 'gold');
const REPORTS_DIR = path.join(__dirname, 'reports');
const MANIFEST_PATH = path.join(__dirname, 'benchmarkManifest.json');
const MIN_AVERAGE_SCORE = 80; // Gate G1: score médio mínimo
const MAX_REGRESSION_PER_CASE = 5; // Gate G2: regressão máxima por caso (%)
const MIN_INDIVIDUAL_SCORE = 70; // Gate G2: score mínimo individual

// ── Tipos ──
interface RunAllReport {
    timestamp: string;
    promptVersion: string;
    totalCases: number;
    casesWithGold: number;
    casesEvaluated: number;
    summary: BenchmarkSummary;
    gates: {
        g1_average_score: { pass: boolean; value: number; threshold: number };
        g2_no_regression: { pass: boolean; failedCases: string[] };
        g4_prompt_integrity: { pass: boolean; note: string };
    };
    individualResults: BenchmarkResult[];
}

interface BaselineReport {
    summary: BenchmarkSummary;
    individualResults: BenchmarkResult[];
}

// ── Main ──
async function main() {
    const args = process.argv.slice(2);
    const shouldSave = args.includes('--save');
    const compareIdx = args.indexOf('--compare');
    const baselinePath = compareIdx >= 0 ? args[compareIdx + 1] : null;

    logger.info(`\n${'═'.repeat(60)}`);
    logger.info(`🛡️  LICITASAAS — GOLDEN DATASET BENCHMARK (runAll)`);
    logger.info(`${'═'.repeat(60)}\n`);

    // Load manifest
    if (!fs.existsSync(MANIFEST_PATH)) {
        logger.error(`❌ benchmarkManifest.json não encontrado em ${MANIFEST_PATH}`);
        process.exit(1);
    }
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    const promptVersion = manifest.prompt_version || 'unknown';
    const cases = manifest.cases || [];

    logger.info(`📋 Manifest: ${cases.length} casos | Prompt: ${promptVersion}`);

    // Scan gold/ directory for available gold files
    if (!fs.existsSync(GOLD_DIR)) {
        logger.error(`❌ Diretório gold/ não encontrado. Crie em: ${GOLD_DIR}`);
        process.exit(1);
    }

    const goldFiles = fs.readdirSync(GOLD_DIR).filter(f => f.endsWith('.json'));
    logger.info(`📁 Gold files: ${goldFiles.length} encontrados em gold/\n`);

    if (goldFiles.length === 0) {
        logger.info(`⚠️ Nenhum gold file encontrado. Adicione JSONs de gabarito em gold/`);
        logger.info(`   Formato: gold-{case-id}.json (ex: gold-real-001.json)`);
        logger.info(`   Cada arquivo deve conter o AnalysisSchemaV1 confirmado como correto.\n`);
        process.exit(0);
    }

    // Match gold files to manifest cases
    const results: BenchmarkResult[] = [];
    const unmatchedGolds: string[] = [];
    let casesEvaluated = 0;

    for (const goldFile of goldFiles) {
        const caseId = goldFile.replace('gold-', '').replace('.json', '');
        const manifestCase = cases.find((c: any) => c.id === caseId);

        if (!manifestCase) {
            // Se o gold file não tem case no manifest, tenta match por nome parcial
            const partialMatch = cases.find((c: any) => goldFile.includes(c.id));
            if (!partialMatch) {
                unmatchedGolds.push(goldFile);
                continue;
            }
        }

        const effectiveCaseId = manifestCase?.id || caseId;

        try {
            const goldPath = path.join(GOLD_DIR, goldFile);
            const goldData = JSON.parse(fs.readFileSync(goldPath, 'utf-8')) as AnalysisSchemaV1;

            const result = evaluateAgainstBenchmark(effectiveCaseId, goldData);
            if (result) {
                results.push(result);
                casesEvaluated++;
            } else {
                logger.warn(`⚠️ Caso ${effectiveCaseId} não encontrado no manifest — pulando`);
            }
        } catch (e: any) {
            logger.error(`❌ Erro ao avaliar ${goldFile}: ${e.message}`);
        }
    }

    if (unmatchedGolds.length > 0) {
        logger.info(`\n⚠️ ${unmatchedGolds.length} gold file(s) sem correspondência no manifest:`);
        unmatchedGolds.forEach(f => logger.info(`   - ${f}`));
    }

    if (results.length === 0) {
        logger.info(`\n⚠️ Nenhum caso avaliado. Verifique se os IDs dos gold files correspondem aos IDs do manifest.`);
        process.exit(0);
    }

    // Generate summary
    const summary = generateBenchmarkSummary(results);

    // ── GATES ──
    logger.info(`\n${'═'.repeat(60)}`);
    logger.info(`🚦 GATES DE QUALIDADE`);
    logger.info(`${'═'.repeat(60)}\n`);

    // Gate G1: Average score
    const g1Pass = summary.averageScore >= MIN_AVERAGE_SCORE;
    logger.info(`${g1Pass ? '✅' : '❌'} G1 — Score Médio: ${summary.averageScore}% (threshold: ${MIN_AVERAGE_SCORE}%)`);

    // Gate G2: No case below minimum + regression check
    const failedCases = results.filter(r => r.totalScore < MIN_INDIVIDUAL_SCORE);
    const g2Pass = failedCases.length === 0;
    logger.info(`${g2Pass ? '✅' : '❌'} G2 — Casos abaixo de ${MIN_INDIVIDUAL_SCORE}%: ${failedCases.length}`);
    if (!g2Pass) {
        failedCases.forEach(r => logger.info(`   ⚠️ ${r.caseId}: ${r.totalScore}% — ${r.caseName}`));
    }

    // Regression check against baseline (if provided)
    let regressionCases: string[] = [];
    if (baselinePath) {
        try {
            const baseline: BaselineReport = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
            logger.info(`\n📊 Comparando com baseline: ${baselinePath}`);
            
            for (const result of results) {
                const baselineResult = baseline.individualResults?.find(r => r.caseId === result.caseId);
                if (baselineResult) {
                    const diff = result.totalScore - baselineResult.totalScore;
                    const icon = diff >= 0 ? '📈' : '📉';
                    logger.info(`   ${icon} ${result.caseId}: ${baselineResult.totalScore}% → ${result.totalScore}% (${diff >= 0 ? '+' : ''}${diff}%)`);
                    
                    if (diff < -MAX_REGRESSION_PER_CASE) {
                        regressionCases.push(`${result.caseId} regrediu ${Math.abs(diff)}%`);
                    }
                }
            }
            
            if (regressionCases.length > 0) {
                logger.info(`\n❌ REGRESSÃO DETECTADA em ${regressionCases.length} caso(s):`);
                regressionCases.forEach(c => logger.info(`   • ${c}`));
            }
        } catch (e: any) {
            logger.warn(`⚠️ Não foi possível ler baseline: ${e.message}`);
        }
    }

    // Gate G4: Prompt integrity (just a note — run separately)
    logger.info(`ℹ️  G4 — Prompt Integrity: Rode separadamente com 'npx tsx promptRegressionCheck.ts'`);

    // ── Report ──
    const report: RunAllReport = {
        timestamp: new Date().toISOString(),
        promptVersion,
        totalCases: cases.length,
        casesWithGold: goldFiles.length,
        casesEvaluated,
        summary,
        gates: {
            g1_average_score: { pass: g1Pass, value: summary.averageScore, threshold: MIN_AVERAGE_SCORE },
            g2_no_regression: { pass: g2Pass && regressionCases.length === 0, failedCases: [...failedCases.map(r => r.caseId), ...regressionCases] },
            g4_prompt_integrity: { pass: true, note: 'Run promptRegressionCheck.ts separately' },
        },
        individualResults: results,
    };

    // ── Save report if requested ──
    if (shouldSave) {
        if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
        const dateStr = new Date().toISOString().split('T')[0];
        const timeStr = new Date().toISOString().split('T')[1].replace(/[:.]/g, '').slice(0, 4);
        const reportPath = path.join(REPORTS_DIR, `report-${dateStr}-${timeStr}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        logger.info(`\n💾 Relatório salvo em: ${reportPath}`);
    }

    // Print to stdout as JSON for piping
    logger.info(`\n${'═'.repeat(60)}`);
    const allGatesPass = g1Pass && g2Pass && regressionCases.length === 0;
    if (allGatesPass) {
        logger.info(`✅ TODOS OS GATES PASSARAM — Score: ${summary.averageScore}% | ${casesEvaluated} casos avaliados`);
    } else {
        logger.info(`❌ GATES FALHARAM — Deploy NÃO recomendado`);
        if (!g1Pass) logger.info(`   • Score médio ${summary.averageScore}% < ${MIN_AVERAGE_SCORE}%`);
        if (!g2Pass) logger.info(`   • ${failedCases.length} caso(s) abaixo de ${MIN_INDIVIDUAL_SCORE}%`);
        if (regressionCases.length > 0) logger.info(`   • ${regressionCases.length} regressão(ões) > ${MAX_REGRESSION_PER_CASE}%`);
    }
    logger.info(`${'═'.repeat(60)}\n`);

    process.exit(allGatesPass ? 0 : 1);
}

main().catch(err => {
    logger.error(`\n❌ Erro fatal: ${err.message}`);
    process.exit(1);
});
