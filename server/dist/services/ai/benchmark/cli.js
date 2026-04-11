"use strict";
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
    console.log(`\n======================================================`);
    console.log(`🛡️  LICITASAAS AI PIPELINE V2 - BENCHMARK RUNNER (FASE 4)`);
    console.log(`======================================================`);
    console.log(`Casos de Gold Standard Carregados: ${manifesto.total_cases}`);
    console.log(`Prompt Analisado (Baseline): ${manifesto.prompt_version}\n`);
    if (args.length === 0) {
        console.log(`Uso:`);
        console.log(`1. Avaliar um caso isolado:`);
        console.log(`   npm run benchmark:run <case-id> <caminho_para_json_extraido>`);
        console.log(`2. Listar todos os casos de teste:`);
        console.log(`   npm run benchmark:run list\n`);
        console.log(`EXEMPLO: npm run benchmark:run case-003 ./test_data/analise_case_003_raw.json\n`);
        return;
    }
    const command = args[0];
    if (command === 'list') {
        console.log(`Lista de Casos Gabarito Disponíveis:`);
        for (const c of manifesto.cases) {
            console.log(`  - ${c.id}: [${c.tipo_objeto}] ${c.name} (${c.complexity})`);
        }
        return;
    }
    const caseId = command;
    const jsonPath = args[1];
    if (!jsonPath) {
        console.error(`❌ Erro: Por favor, forneça o caminho do arquivo JSON que contém o output da IA.`);
        return;
    }
    try {
        const fullPath = path.resolve(process.cwd(), jsonPath);
        if (!fs.existsSync(fullPath)) {
            console.error(`❌ Erro: Arquivo não encontrado: ${fullPath}`);
            return;
        }
        const rawData = fs.readFileSync(fullPath, 'utf-8');
        const analysisData = JSON.parse(rawData);
        console.log(`⏳ Executando avaliação contra o gabarito do caso: ${caseId}...`);
        const result = (0, benchmarkRunner_1.evaluateAgainstBenchmark)(caseId, analysisData);
        if (!result) {
            console.error(`❌ Falha na avaliação. Caso não encontrado ou erro de processamento.`);
            return;
        }
        const summary = (0, benchmarkRunner_1.generateBenchmarkSummary)([result]);
        if (result.details.length > 0) {
            console.log(`\n🚧 DETALHES DOS DESVIOS (GAP ANALISYS):`);
            result.details.forEach(detail => console.log(`   • ${detail}`));
        }
        else {
            console.log(`\n✅ O Output atingiu precisão EXCELENTE e bateu com o caso de Ouro.`);
        }
    }
    catch (e) {
        console.error(`❌ Erro na execução: ${e.message}`);
    }
}
run();
