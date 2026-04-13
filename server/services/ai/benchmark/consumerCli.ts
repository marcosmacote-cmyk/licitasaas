import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../lib/logger';

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

function mockEvaluate(moduleOutput: any, expected: any): { score: number, details: string[] } {
    // Basic mock evaluator for consumer modules
    let score = 100;
    const details: string[] = [];

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

    logger.info(`\n======================================================`);
    logger.info(`🎯 LICITASAAS AI ENGINE - CONSUMER BENCHMARK (V3)`);
    logger.info(`======================================================`);
    
    if (args.length === 0 || args[0] === 'list') {
        logger.info(`Uso: npm run test:ai <module_name> <json_path>\n`);
        logger.info(`Módulos Disponíveis para Avaliação:`);
        for (const mod in manifesto.modules) {
            const cases = manifesto.modules[mod].cases.length;
            logger.info(`  - ${mod} (${cases} casos)`);
            if (args[0] === 'list') {
                for(const c of manifesto.modules[mod].cases) {
                     logger.info(`      -> ${c.id}`);
                }
            }
        }
        return;
    }

    const moduleName = args[0];
    const jsonPath = args[1];

    if (!manifesto.modules[moduleName]) {
         logger.error(`❌ Módulo '${moduleName}' não encontrado na suite de testes.`);
         return;
    }

    if (!jsonPath) {
        logger.error(`❌ Forneça o arquivo .json do output para avaliação.`);
        return;
    }
    
    try {
        const fullPath = path.resolve(process.cwd(), jsonPath);
        if (!fs.existsSync(fullPath)) {
            logger.error(`❌ Arquivo não encontrado: ${fullPath}`);
            return;
        }

        const rawData = fs.readFileSync(fullPath, 'utf-8');
        const moduleOutput = JSON.parse(rawData);

        logger.info(`⏳ Executando avaliação de qualidade para o módulo [${moduleName.toUpperCase()}]...`);
        
        let totalScore = 0;
        let count = 0;
        
        // Simular testar contra o primeiro caso do manifest que tenha output compativel 
        // ou rodar todos (simplificado)
        const cases = manifesto.modules[moduleName].cases;
        for (const c of cases) {
            const evalRes = mockEvaluate(moduleOutput, c.expected);
            logger.info(`[Caso: ${c.id}] -> Nota: ${evalRes.score}% ${evalRes.details.length ? '⚠️' : '✅'}`);
            if (evalRes.details.length > 0) {
                 evalRes.details.forEach(d => logger.info(`   • Desvio: ${d}`));
            }
            totalScore += evalRes.score;
            count++;
        }
        
        const finalScore = Math.round(totalScore / count);
        logger.info(`\n📊 RESULTADO FINAL [${moduleName}]: ${finalScore}% DE PRECISÃO`);

        if (finalScore < 80) {
             logger.error(`❌ Reprovado na Malha Fina (Nota < 80%). Não envie esse prompt para Produção!`);
             process.exit(1);
        } else {
             logger.info(`🚀 Passou com Sucesso de Ouro! Padrão LicitaSaaS Nota 10 mantido.`);
        }
        
    } catch (e: any) {
        logger.error(`❌ Erro na execução: ${e.message}`);
    }
}

run();
