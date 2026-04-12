import * as fs from 'fs';
import * as path from 'path';
import { evaluateAgainstBenchmark, generateBenchmarkSummary, BenchmarkResult } from './benchmarkRunner';
import { AnalysisSchemaV1 } from '../analysis-schema-v1';
import { logger } from '../../../lib/logger';

/**
 * ══════════════════════════════════════════════════════════════════
 *  Benchmark CLI — Ferramenta de Linha de Comando para Fase 4
 * ══════════════════════════════════════════════════════════════════
 * Uso: npx tsx cli.ts [dirPath_com_analises_extraidas | caseId] [analise_json_path]
 */

function carregarManifesto() {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'server', 'services', 'ai', 'benchmark', 'benchmarkManifest.json'), 'utf-8'));
}

async function run() {
    const args = process.argv.slice(2);
    const manifesto = carregarManifesto();

    logger.info(`\n======================================================`);
    logger.info(`🛡️  LICITASAAS AI PIPELINE V2 - BENCHMARK RUNNER (FASE 4)`);
    logger.info(`======================================================`);
    logger.info(`Casos de Gold Standard Carregados: ${manifesto.total_cases}`);
    logger.info(`Prompt Analisado (Baseline): ${manifesto.prompt_version}\n`);

    if (args.length === 0) {
        logger.info(`Uso:`);
        logger.info(`1. Avaliar um caso isolado:`);
        logger.info(`   npm run benchmark:run <case-id> <caminho_para_json_extraido>`);
        logger.info(`2. Listar todos os casos de teste:`);
        logger.info(`   npm run benchmark:run list\n`);
        
        logger.info(`EXEMPLO: npm run benchmark:run case-003 ./test_data/analise_case_003_raw.json\n`);
        return;
    }

    const command = args[0];

    if (command === 'list') {
        logger.info(`Lista de Casos Gabarito Disponíveis:`);
        for (const c of manifesto.cases) {
            logger.info(`  - ${c.id}: [${c.tipo_objeto}] ${c.name} (${c.complexity})`);
        }
        return;
    }

    const caseId = command;
    const jsonPath = args[1];

    if (!jsonPath) {
        logger.error(`❌ Erro: Por favor, forneça o caminho do arquivo JSON que contém o output da IA.`);
        return;
    }

    try {
        const fullPath = path.resolve(process.cwd(), jsonPath);
        if (!fs.existsSync(fullPath)) {
            logger.error(`❌ Erro: Arquivo não encontrado: ${fullPath}`);
            return;
        }

        const rawData = fs.readFileSync(fullPath, 'utf-8');
        const analysisData = JSON.parse(rawData) as AnalysisSchemaV1;

        logger.info(`⏳ Executando avaliação contra o gabarito do caso: ${caseId}...`);
        const result = evaluateAgainstBenchmark(caseId, analysisData);

        if (!result) {
            logger.error(`❌ Falha na avaliação. Caso não encontrado ou erro de processamento.`);
            return;
        }

        const summary = generateBenchmarkSummary([result]);
        
        if (result.details.length > 0) {
            logger.info(`\n🚧 DETALHES DOS DESVIOS (GAP ANALISYS):`);
            result.details.forEach(detail => logger.info(`   • ${detail}`));
        } else {
            logger.info(`\n✅ O Output atingiu precisão EXCELENTE e bateu com o caso de Ouro.`);
        }

    } catch (e: any) {
        logger.error(`❌ Erro na execução: ${e.message}`);
    }
}

run();
