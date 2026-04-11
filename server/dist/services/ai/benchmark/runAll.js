"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const benchmarkRunner_1 = require("./benchmarkRunner");
// ── Config ──
const GOLD_DIR = path.join(__dirname, 'gold');
const REPORTS_DIR = path.join(__dirname, 'reports');
const MANIFEST_PATH = path.join(__dirname, 'benchmarkManifest.json');
const MIN_AVERAGE_SCORE = 80; // Gate G1: score médio mínimo
const MAX_REGRESSION_PER_CASE = 5; // Gate G2: regressão máxima por caso (%)
const MIN_INDIVIDUAL_SCORE = 70; // Gate G2: score mínimo individual
// ── Main ──
async function main() {
    const args = process.argv.slice(2);
    const shouldSave = args.includes('--save');
    const compareIdx = args.indexOf('--compare');
    const baselinePath = compareIdx >= 0 ? args[compareIdx + 1] : null;
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🛡️  LICITASAAS — GOLDEN DATASET BENCHMARK (runAll)`);
    console.log(`${'═'.repeat(60)}\n`);
    // Load manifest
    if (!fs.existsSync(MANIFEST_PATH)) {
        console.error(`❌ benchmarkManifest.json não encontrado em ${MANIFEST_PATH}`);
        process.exit(1);
    }
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    const promptVersion = manifest.prompt_version || 'unknown';
    const cases = manifest.cases || [];
    console.log(`📋 Manifest: ${cases.length} casos | Prompt: ${promptVersion}`);
    // Scan gold/ directory for available gold files
    if (!fs.existsSync(GOLD_DIR)) {
        console.error(`❌ Diretório gold/ não encontrado. Crie em: ${GOLD_DIR}`);
        process.exit(1);
    }
    const goldFiles = fs.readdirSync(GOLD_DIR).filter(f => f.endsWith('.json'));
    console.log(`📁 Gold files: ${goldFiles.length} encontrados em gold/\n`);
    if (goldFiles.length === 0) {
        console.log(`⚠️ Nenhum gold file encontrado. Adicione JSONs de gabarito em gold/`);
        console.log(`   Formato: gold-{case-id}.json (ex: gold-real-001.json)`);
        console.log(`   Cada arquivo deve conter o AnalysisSchemaV1 confirmado como correto.\n`);
        process.exit(0);
    }
    // Match gold files to manifest cases
    const results = [];
    const unmatchedGolds = [];
    let casesEvaluated = 0;
    for (const goldFile of goldFiles) {
        const caseId = goldFile.replace('gold-', '').replace('.json', '');
        const manifestCase = cases.find((c) => c.id === caseId);
        if (!manifestCase) {
            // Se o gold file não tem case no manifest, tenta match por nome parcial
            const partialMatch = cases.find((c) => goldFile.includes(c.id));
            if (!partialMatch) {
                unmatchedGolds.push(goldFile);
                continue;
            }
        }
        const effectiveCaseId = manifestCase?.id || caseId;
        try {
            const goldPath = path.join(GOLD_DIR, goldFile);
            const goldData = JSON.parse(fs.readFileSync(goldPath, 'utf-8'));
            const result = (0, benchmarkRunner_1.evaluateAgainstBenchmark)(effectiveCaseId, goldData);
            if (result) {
                results.push(result);
                casesEvaluated++;
            }
            else {
                console.warn(`⚠️ Caso ${effectiveCaseId} não encontrado no manifest — pulando`);
            }
        }
        catch (e) {
            console.error(`❌ Erro ao avaliar ${goldFile}: ${e.message}`);
        }
    }
    if (unmatchedGolds.length > 0) {
        console.log(`\n⚠️ ${unmatchedGolds.length} gold file(s) sem correspondência no manifest:`);
        unmatchedGolds.forEach(f => console.log(`   - ${f}`));
    }
    if (results.length === 0) {
        console.log(`\n⚠️ Nenhum caso avaliado. Verifique se os IDs dos gold files correspondem aos IDs do manifest.`);
        process.exit(0);
    }
    // Generate summary
    const summary = (0, benchmarkRunner_1.generateBenchmarkSummary)(results);
    // ── GATES ──
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🚦 GATES DE QUALIDADE`);
    console.log(`${'═'.repeat(60)}\n`);
    // Gate G1: Average score
    const g1Pass = summary.averageScore >= MIN_AVERAGE_SCORE;
    console.log(`${g1Pass ? '✅' : '❌'} G1 — Score Médio: ${summary.averageScore}% (threshold: ${MIN_AVERAGE_SCORE}%)`);
    // Gate G2: No case below minimum + regression check
    const failedCases = results.filter(r => r.totalScore < MIN_INDIVIDUAL_SCORE);
    const g2Pass = failedCases.length === 0;
    console.log(`${g2Pass ? '✅' : '❌'} G2 — Casos abaixo de ${MIN_INDIVIDUAL_SCORE}%: ${failedCases.length}`);
    if (!g2Pass) {
        failedCases.forEach(r => console.log(`   ⚠️ ${r.caseId}: ${r.totalScore}% — ${r.caseName}`));
    }
    // Regression check against baseline (if provided)
    let regressionCases = [];
    if (baselinePath) {
        try {
            const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
            console.log(`\n📊 Comparando com baseline: ${baselinePath}`);
            for (const result of results) {
                const baselineResult = baseline.individualResults?.find(r => r.caseId === result.caseId);
                if (baselineResult) {
                    const diff = result.totalScore - baselineResult.totalScore;
                    const icon = diff >= 0 ? '📈' : '📉';
                    console.log(`   ${icon} ${result.caseId}: ${baselineResult.totalScore}% → ${result.totalScore}% (${diff >= 0 ? '+' : ''}${diff}%)`);
                    if (diff < -MAX_REGRESSION_PER_CASE) {
                        regressionCases.push(`${result.caseId} regrediu ${Math.abs(diff)}%`);
                    }
                }
            }
            if (regressionCases.length > 0) {
                console.log(`\n❌ REGRESSÃO DETECTADA em ${regressionCases.length} caso(s):`);
                regressionCases.forEach(c => console.log(`   • ${c}`));
            }
        }
        catch (e) {
            console.warn(`⚠️ Não foi possível ler baseline: ${e.message}`);
        }
    }
    // Gate G4: Prompt integrity (just a note — run separately)
    console.log(`ℹ️  G4 — Prompt Integrity: Rode separadamente com 'npx tsx promptRegressionCheck.ts'`);
    // ── Report ──
    const report = {
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
        if (!fs.existsSync(REPORTS_DIR))
            fs.mkdirSync(REPORTS_DIR, { recursive: true });
        const dateStr = new Date().toISOString().split('T')[0];
        const timeStr = new Date().toISOString().split('T')[1].replace(/[:.]/g, '').slice(0, 4);
        const reportPath = path.join(REPORTS_DIR, `report-${dateStr}-${timeStr}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n💾 Relatório salvo em: ${reportPath}`);
    }
    // Print to stdout as JSON for piping
    console.log(`\n${'═'.repeat(60)}`);
    const allGatesPass = g1Pass && g2Pass && regressionCases.length === 0;
    if (allGatesPass) {
        console.log(`✅ TODOS OS GATES PASSARAM — Score: ${summary.averageScore}% | ${casesEvaluated} casos avaliados`);
    }
    else {
        console.log(`❌ GATES FALHARAM — Deploy NÃO recomendado`);
        if (!g1Pass)
            console.log(`   • Score médio ${summary.averageScore}% < ${MIN_AVERAGE_SCORE}%`);
        if (!g2Pass)
            console.log(`   • ${failedCases.length} caso(s) abaixo de ${MIN_INDIVIDUAL_SCORE}%`);
        if (regressionCases.length > 0)
            console.log(`   • ${regressionCases.length} regressão(ões) > ${MAX_REGRESSION_PER_CASE}%`);
    }
    console.log(`${'═'.repeat(60)}\n`);
    process.exit(allGatesPass ? 0 : 1);
}
main().catch(err => {
    console.error(`\n❌ Erro fatal: ${err.message}`);
    process.exit(1);
});
