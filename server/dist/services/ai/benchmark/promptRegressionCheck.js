"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../../../lib/logger");
/**
 * ══════════════════════════════════════════════════════════════════
 *  Prompt Regression Check — Verificação estática de regressões
 * ══════════════════════════════════════════════════════════════════
 *
 * Verifica se o V2_EXTRACTION_PROMPT e V2_EXTRACTION_USER_INSTRUCTION
 * mantêm invariantes críticas que não devem ser violadas.
 *
 * Uso: npx tsx server/services/ai/benchmark/promptRegressionCheck.ts
 */
const prompt_service_1 = require("../prompt.service");
const results = [];
function check(name, pass, detail, severity = 'critical') {
    results.push({ name, pass, detail, severity });
}
// ══════════════════════════════════════════════════════════════════
// INVARIANTES DO PROMPT COMPARTILHADO (NÃO devem ser violados)
// ══════════════════════════════════════════════════════════════════
logger_1.logger.info(`\n🔍 PROMPT REGRESSION CHECK — v${prompt_service_1.V2_PROMPT_VERSION}`);
logger_1.logger.info(`═══════════════════════════════════════════════\n`);
// 1. prompt NÃO deve conter regras de valor/portal/data que pertencem ao manual
check('PNCP-ISOLATION: valor_estimado_global ausente do prompt compartilhado', !prompt_service_1.V2_EXTRACTION_PROMPT.includes('valor_estimado_global'), 'O V2_EXTRACTION_PROMPT NÃO deve conter "valor_estimado_global" — esse campo é do MANUAL_EXTRACTION_ADDON');
check('PNCP-ISOLATION: portal_licitacao ausente do prompt compartilhado', !prompt_service_1.V2_EXTRACTION_PROMPT.includes('portal_licitacao'), 'O V2_EXTRACTION_PROMPT NÃO deve conter "portal_licitacao" — esse campo é do MANUAL_EXTRACTION_ADDON');
check('PNCP-ISOLATION: Regra 16 ausente do prompt compartilhado', !prompt_service_1.V2_EXTRACTION_PROMPT.includes('VALOR ESTIMADO GLOBAL'), 'Regra 16 (VALOR ESTIMADO GLOBAL) NÃO deve estar no prompt compartilhado');
check('PNCP-ISOLATION: Regra 17 ausente do prompt compartilhado', !prompt_service_1.V2_EXTRACTION_PROMPT.includes('PORTAL DE LICITAÇÃO'), 'Regra 17 (PORTAL DE LICITAÇÃO) NÃO deve estar no prompt compartilhado');
check('PNCP-ISOLATION: Regra 18 ausente do prompt compartilhado', !prompt_service_1.V2_EXTRACTION_PROMPT.includes('DATA DA SESSÃO COM HORÁRIO'), 'Regra 18 (DATA DA SESSÃO COM HORÁRIO) NÃO deve estar no prompt compartilhado');
// 2. MANUAL_EXTRACTION_ADDON deve existir e conter as regras isoladas
check('MANUAL-ADDON: MANUAL_EXTRACTION_ADDON existe', typeof prompt_service_1.MANUAL_EXTRACTION_ADDON === 'string' && prompt_service_1.MANUAL_EXTRACTION_ADDON.length > 50, 'O MANUAL_EXTRACTION_ADDON deve existir e ter conteúdo significativo');
check('MANUAL-ADDON: contém regra de valor', prompt_service_1.MANUAL_EXTRACTION_ADDON.includes('valor_estimado_global'), 'O MANUAL_EXTRACTION_ADDON deve conter "valor_estimado_global"');
check('MANUAL-ADDON: contém regra de portal', prompt_service_1.MANUAL_EXTRACTION_ADDON.includes('portal_licitacao'), 'O MANUAL_EXTRACTION_ADDON deve conter "portal_licitacao"');
// 3. JSON template do prompt compartilhado NÃO deve ter campos do manual
const jsonTemplateMatch = prompt_service_1.V2_EXTRACTION_PROMPT.match(/FORMATO DE SAÍDA.*?\{[\s\S]*?"process_identification"[\s\S]*?\}/m);
const jsonSection = jsonTemplateMatch ? jsonTemplateMatch[0] : '';
check('JSON-TEMPLATE: valor_estimado_global ausente do template JSON', !jsonSection.includes('valor_estimado_global'), 'O template JSON no prompt compartilhado NÃO deve ter "valor_estimado_global"');
check('JSON-TEMPLATE: portal_licitacao ausente do template JSON', !jsonSection.includes('portal_licitacao'), 'O template JSON no prompt compartilhado NÃO deve ter "portal_licitacao"');
// ══════════════════════════════════════════════════════════════════
// INVARIANTES DE COMPLETUDE (devem estar presentes)
// ══════════════════════════════════════════════════════════════════
// 4. Regras fundamentais 1-15 devem existir
for (let i = 1; i <= 15; i++) {
    check(`COMPLETUDE: Regra ${i} presente`, prompt_service_1.V2_EXTRACTION_PROMPT.includes(`${i}.`), `A regra ${i} deve estar presente no V2_EXTRACTION_PROMPT`, 'warning');
}
// 5. Categorias obrigatórias no JSON template
const requiredCategories = [
    'habilitacao_juridica', 'regularidade_fiscal_trabalhista',
    'qualificacao_economico_financeira', 'qualificacao_tecnica_operacional',
    'qualificacao_tecnica_profissional', 'proposta_comercial', 'documentos_complementares'
];
for (const cat of requiredCategories) {
    check(`COMPLETUDE: Categoria ${cat} no template`, prompt_service_1.V2_EXTRACTION_PROMPT.includes(cat), `A categoria "${cat}" deve estar no template JSON do prompt`, 'warning');
}
// 6. Seções obrigatórias do JSON template
const requiredSections = [
    'process_identification', 'timeline', 'requirements',
    'evidence_registry', 'participation_conditions',
    'technical_analysis', 'economic_financial_analysis',
    'proposal_analysis', 'contractual_analysis'
];
for (const section of requiredSections) {
    check(`COMPLETUDE: Seção ${section} no template`, prompt_service_1.V2_EXTRACTION_PROMPT.includes(section), `A seção "${section}" deve estar no template JSON do prompt`, 'warning');
}
// ══════════════════════════════════════════════════════════════════
// DETECÇÃO DE ANTI-PADRÕES (presença de regras que podem causar omissão)
// ══════════════════════════════════════════════════════════════════
// 7. Exceções de pré-qualificação — verificar amplitude
const preQualMentions = (prompt_service_1.V2_EXTRACTION_PROMPT.match(/pré-qualificação|pre-qualificação|CRC|SICAF/gi) || []).length;
check('ANTI-PATTERN: Número de menções a pré-qualificação no prompt', preQualMentions <= 5, `O prompt tem ${preQualMentions} menções a pré-qualificação/CRC/SICAF. Muitas menções podem fazer a IA ser excessivamente conservadora.`, preQualMentions > 8 ? 'critical' : 'warning');
// Verificar se as exceções têm salvaguardas
const hasExclusively = prompt_service_1.V2_EXTRACTION_PROMPT.toLowerCase().includes('exclusivamente');
check('SAFEGUARD: Exceção pré-qual limitada a "exclusivamente"', hasExclusively, `A exceção de pré-qualificação deve conter "exclusivamente" para limitar seu escopo. ${hasExclusively ? 'OK' : 'FALTA — a IA pode interpretar de forma ampla'}`, 'warning');
// 8. USER INSTRUCTION — verificar exceções paralelas
const userInstrPreQualMentions = (prompt_service_1.V2_EXTRACTION_USER_INSTRUCTION.match(/pré-qualificação|pre-qualificação|SALVO/gi) || []).length;
check('USER-INSTRUCTION: Menções a exceções na instrução do usuário', userInstrPreQualMentions <= 4, `A USER_INSTRUCTION tem ${userInstrPreQualMentions} menções a exceções (SALVO/pré-qualificação). Muitas podem confundir a IA.`, userInstrPreQualMentions > 6 ? 'critical' : 'warning');
// 9. Normalização NÃO deve ter regras de Manual
check('NORM-ISOLATION: Normalização limpa', !prompt_service_1.V2_NORMALIZATION_PROMPT.includes('valor_estimado_global') && !prompt_service_1.V2_NORMALIZATION_PROMPT.includes('portal_licitacao'), 'O prompt de normalização NÃO deve conter campos do manual');
// 10. Risk Review NÃO deve ter regras de Manual
check('RISK-ISOLATION: Risk Review limpo', !prompt_service_1.V2_RISK_REVIEW_PROMPT.includes('valor_estimado_global') && !prompt_service_1.V2_RISK_REVIEW_PROMPT.includes('portal_licitacao'), 'O prompt de risk review NÃO deve conter campos do manual');
// ══════════════════════════════════════════════════════════════════
// RELATÓRIO
// ══════════════════════════════════════════════════════════════════
logger_1.logger.info(`\n${'═'.repeat(60)}`);
logger_1.logger.info(`📊 RESULTADOS`);
logger_1.logger.info(`${'═'.repeat(60)}\n`);
const passed = results.filter(r => r.pass);
const failed = results.filter(r => !r.pass);
const criticalFails = failed.filter(r => r.severity === 'critical');
const warningFails = failed.filter(r => r.severity === 'warning');
for (const r of results) {
    const icon = r.pass ? '✅' : (r.severity === 'critical' ? '❌' : '⚠️');
    logger_1.logger.info(`${icon} ${r.name}`);
    if (!r.pass) {
        logger_1.logger.info(`   └→ ${r.detail}`);
    }
}
logger_1.logger.info(`\n${'═'.repeat(60)}`);
logger_1.logger.info(`TOTAL: ${results.length} checks | ✅ ${passed.length} passed | ❌ ${criticalFails.length} critical | ⚠️ ${warningFails.length} warnings`);
if (criticalFails.length > 0) {
    logger_1.logger.info(`\n🚨 REGRESSÃO CRÍTICA DETECTADA — ${criticalFails.length} falha(s) crítica(s)!`);
    logger_1.logger.info(`   Ações imediatas necessárias:`);
    for (const f of criticalFails) {
        logger_1.logger.info(`   • ${f.name}: ${f.detail}`);
    }
    process.exit(1);
}
else if (warningFails.length > 0) {
    logger_1.logger.info(`\n⚠️ ${warningFails.length} warning(s) detectado(s) — revisar manualmente.`);
    process.exit(0);
}
else {
    logger_1.logger.info(`\n✅ PROMPT ÍNTEGRO — Nenhuma regressão detectada.`);
    process.exit(0);
}
