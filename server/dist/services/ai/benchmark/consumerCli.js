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
const logger_1 = require("../../../lib/logger");
/**
 * ══════════════════════════════════════════════════════════════════
 *  Consumer Benchmark CLI — Ferramenta de Linha de Comando (Fase 11)
 * ══════════════════════════════════════════════════════════════════
 * Uso: npm run test:ai [module] [json_path]
 */
function carregarManifesto() {
    const raw = fs.readFileSync(path.join(process.cwd(), 'server', 'services', 'ai', 'benchmark', 'consumerBenchmarkManifest.json'), 'utf-8');
    return JSON.parse(raw);
}
function mockEvaluate(moduleOutput, expected) {
    // Basic mock evaluator for consumer modules
    let score = 100;
    const details = [];
    // Evaluate based on expected keys
    if (expected.mustMention) {
        const textToSearch = JSON.stringify(moduleOutput).toLowerCase();
        for (const term of expected.mustMention) {
            if (!textToSearch.includes(term.toLowerCase())) {
                score -= 20;
                details.push(`Falta o termo exigido: '${term}'`);
            }
        }
    }
    if (expected.mustHaveRisk && !moduleOutput?.risks) {
        score -= 30;
        details.push(`Falta mapeamento de riscos onde era exigido.`);
    }
    if (expected.mustHaveThesis && !moduleOutput?.thesis) {
        score -= 40;
        details.push(`Falta tese jurídica para a petição.`);
    }
    // Prevent score < 0
    score = Math.max(score, 0);
    return { score, details };
}
async function run() {
    const args = process.argv.slice(2);
    const manifesto = carregarManifesto();
    logger_1.logger.info(`\n======================================================`);
    logger_1.logger.info(`🎯 LICITASAAS AI ENGINE - CONSUMER BENCHMARK (V3)`);
    logger_1.logger.info(`======================================================`);
    if (args.length === 0 || args[0] === 'list') {
        logger_1.logger.info(`Uso: npm run test:ai <module_name> <json_path>\n`);
        logger_1.logger.info(`Módulos Disponíveis para Avaliação:`);
        for (const mod in manifesto.modules) {
            const cases = manifesto.modules[mod].cases.length;
            logger_1.logger.info(`  - ${mod} (${cases} casos)`);
            if (args[0] === 'list') {
                for (const c of manifesto.modules[mod].cases) {
                    logger_1.logger.info(`      -> ${c.id}`);
                }
            }
        }
        return;
    }
    const moduleName = args[0];
    const jsonPath = args[1];
    if (!manifesto.modules[moduleName]) {
        logger_1.logger.error(`❌ Módulo '${moduleName}' não encontrado na suite de testes.`);
        return;
    }
    if (!jsonPath) {
        logger_1.logger.error(`❌ Forneça o arquivo .json do output para avaliação.`);
        return;
    }
    try {
        const fullPath = path.resolve(process.cwd(), jsonPath);
        if (!fs.existsSync(fullPath)) {
            logger_1.logger.error(`❌ Arquivo não encontrado: ${fullPath}`);
            return;
        }
        const rawData = fs.readFileSync(fullPath, 'utf-8');
        const moduleOutput = JSON.parse(rawData);
        logger_1.logger.info(`⏳ Executando avaliação de qualidade para o módulo [${moduleName.toUpperCase()}]...`);
        let totalScore = 0;
        let count = 0;
        // Simular testar contra o primeiro caso do manifest que tenha output compativel 
        // ou rodar todos (simplificado)
        const cases = manifesto.modules[moduleName].cases;
        for (const c of cases) {
            const evalRes = mockEvaluate(moduleOutput, c.expected);
            logger_1.logger.info(`[Caso: ${c.id}] -> Nota: ${evalRes.score}% ${evalRes.details.length ? '⚠️' : '✅'}`);
            if (evalRes.details.length > 0) {
                evalRes.details.forEach(d => logger_1.logger.info(`   • Desvio: ${d}`));
            }
            totalScore += evalRes.score;
            count++;
        }
        const finalScore = Math.round(totalScore / count);
        logger_1.logger.info(`\n📊 RESULTADO FINAL [${moduleName}]: ${finalScore}% DE PRECISÃO`);
        if (finalScore < 80) {
            logger_1.logger.error(`❌ Reprovado na Malha Fina (Nota < 80%). Não envie esse prompt para Produção!`);
            process.exit(1);
        }
        else {
            logger_1.logger.info(`🚀 Passou com Sucesso de Ouro! Padrão LicitaSaaS Nota 10 mantido.`);
        }
    }
    catch (e) {
        logger_1.logger.error(`❌ Erro na execução: ${e.message}`);
    }
}
run();
