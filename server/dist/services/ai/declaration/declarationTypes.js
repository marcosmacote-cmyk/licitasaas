"use strict";
/**
 * ══════════════════════════════════════════════════════════════════
 *  Declaration Module — Types & Interfaces (v3.0.0)
 * ══════════════════════════════════════════════════════════════════
 *
 *  Tipos canônicos para o módulo de Declarações IA.
 *
 *  Convenções seguidas:
 *    - Nomes em camelCase alinhados ao padrão do Prisma/CompanyProfile
 *    - Severidades reusam padrões de ModuleQualityIssue ('low'|'medium'|'high'|'critical')
 *    - DeclarationFamily usa UPPER_SNAKE (como enums de domínio, não DB)
 *    - QualityReport é self-contained (não depende de ModuleQualityReport)
 *      porque tem semântica distinta: fidelidade factual, não estrutura de output
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEVERITY_PENALTIES = exports.VALIDATION_CODES = exports.DECLARATION_PROMPT_VERSION = exports.DECLARATION_MODULE_NAME = exports.TITLE_FALLBACK_MAP = exports.TITLE_TRAILING_PREPOSITIONS = exports.ANTI_GENERIC_PHRASES = exports.DECLARATION_SEMANTIC_MAP = exports.FAMILY_LENGTH_CONSTRAINTS = void 0;
/** Restrições de extensão por família — usadas no prompt builder e validator */
exports.FAMILY_LENGTH_CONSTRAINTS = {
    SIMPLE_COMPLIANCE: { minParagraphs: 2, maxParagraphs: 4, styleHint: 'Objetiva e concisa. 2 a 3 parágrafos. Sem contextualização longa.' },
    OPERATIONAL_COMMITMENT: { minParagraphs: 3, maxParagraphs: 6, styleHint: 'Formal e completa. 3 a 5 parágrafos.' },
    TECHNICAL_PERSONAL: { minParagraphs: 3, maxParagraphs: 8, styleHint: 'Extensão estritamente necessária para dados técnicos.' },
    CORPORATE_STATUS: { minParagraphs: 2, maxParagraphs: 5, styleHint: 'Formal e precisa. 2 a 4 parágrafos.' },
    CUSTOM_GENERIC: { minParagraphs: 2, maxParagraphs: 6, styleHint: 'Adequada ao tipo solicitado. Sem prolixidade.' },
};
exports.DECLARATION_SEMANTIC_MAP = [
    {
        keywords: ['vínculo', 'vinculo', 'impedimento', 'parentesco'],
        titleGuidance: 'Use "INEXISTÊNCIA DE VÍNCULO FUNCIONAL, EMPREGATÍCIO OU CONTRATUAL COM O MUNICÍPIO" ou o nome exato do edital.',
        coreConceptsMustCover: 'vínculo empregatício, funcional, contratual, cargo/emprego/função pública, relação incompatível com a lisura do certame',
    },
    {
        keywords: ['menor', 'menores', 'trabalho infantil'],
        titleGuidance: 'Use "NÃO EMPREGO DE MENORES" ou o nome exato do edital.',
        coreConceptsMustCover: 'não emprega menor de 18 em trabalho noturno/perigoso/insalubre, não emprega menor de 16 salvo aprendiz a partir de 14 anos, Art. 7º XXXIII CF, Art. 68 V Lei 14.133/2021',
    },
    {
        keywords: ['idoneidade', 'inidoneidade', 'fato impeditivo'],
        titleGuidance: 'Use "IDONEIDADE" ou "INEXISTÊNCIA DE FATO IMPEDITIVO" ou o nome exato do edital.',
        coreConceptsMustCover: 'não declarada inidônea, não suspensa de licitar/contratar, não impedida por nenhum órgão ou entidade da administração pública',
    },
    {
        keywords: ['me', 'epp', 'microempresa', 'pequeno porte', 'enquadramento'],
        titleGuidance: 'Use "ENQUADRAMENTO COMO MICROEMPRESA OU EMPRESA DE PEQUENO PORTE" ou o nome exato do edital.',
        coreConceptsMustCover: 'enquadra-se como ME/EPP nos termos da LC 123/2006, não incorre nas vedações do §4º do art. 3º, faturamento dentro do limite legal',
    },
    {
        keywords: ['visita', 'vistoria'],
        titleGuidance: 'Use "DECLARAÇÃO DE VISITA TÉCNICA" ou "DECLARAÇÃO DE CONHECIMENTO DAS CONDIÇÕES LOCAIS" ou o nome exato do edital.',
        coreConceptsMustCover: 'visitou o local, tomou conhecimento das condições, não alegará desconhecimento posterior',
    },
    {
        keywords: ['reserv', 'cota', 'exclusiv'],
        titleGuidance: 'Use o nome exato do edital ou "DECLARAÇÃO DE ATENDIMENTO AO CRITÉRIO DE PARTICIPAÇÃO".',
        coreConceptsMustCover: 'atende ao critério de participação exclusiva ou reservada conforme edital',
    },
    {
        keywords: ['elabor', 'independen', 'proposta'],
        titleGuidance: 'Use "DECLARAÇÃO DE ELABORAÇÃO INDEPENDENTE DE PROPOSTA" ou o nome exato do edital.',
        coreConceptsMustCover: 'proposta elaborada de forma independente, sem consulta/acordo com concorrentes, sem coordenação de preços com outro licitante',
    },
    {
        keywords: ['sigilo', 'confidencialidade'],
        titleGuidance: 'Use o nome exato do edital.',
        coreConceptsMustCover: 'compromisso de sigilo, não divulgar informações confidenciais, responsabilidade por eventual quebra',
    },
];
/** Frases genéricas de IA que devem ser evitadas ou minimizadas */
exports.ANTI_GENERIC_PHRASES = [
    'em conformidade com as exigências editalícias e os princípios',
    'em consonância com os ditames legais',
    'no bojo do presente certame',
    'em atenção aos princípios norteadores da administração pública',
    'visando à plena observância',
    'em estrita obediência aos preceitos',
];
/** Preposições/palavras que NÃO podem encerrar um título */
exports.TITLE_TRAILING_PREPOSITIONS = [
    'com', 'de', 'para', 'contra', 'sobre', 'em', 'por', 'sob',
    'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas',
    'ao', 'à', 'aos', 'às', 'ou', 'e', 'que', 'a', 'o',
];
/** Biblioteca de títulos fallback canônicos por keyword do tipo */
exports.TITLE_FALLBACK_MAP = [
    { keywords: ['menor', 'menores'], title: 'DECLARAÇÃO DE NÃO EMPREGO DE MENORES' },
    { keywords: ['idoneidade', 'inidoneidade'], title: 'DECLARAÇÃO DE IDONEIDADE' },
    { keywords: ['fato impeditivo', 'impeditivo'], title: 'DECLARAÇÃO DE INEXISTÊNCIA DE FATO IMPEDITIVO' },
    { keywords: ['vínculo', 'vinculo', 'parentesco'], title: 'DECLARAÇÃO DE INEXISTÊNCIA DE VÍNCULO COM A ADMINISTRAÇÃO MUNICIPAL' },
    { keywords: ['me', 'epp', 'microempresa', 'pequeno porte', 'enquadramento'], title: 'DECLARAÇÃO DE ENQUADRAMENTO COMO MICROEMPRESA OU EMPRESA DE PEQUENO PORTE' },
    { keywords: ['visita', 'vistoria'], title: 'DECLARAÇÃO DE VISITA TÉCNICA' },
    { keywords: ['equipamento', 'disponibilidade de equip'], title: 'DECLARAÇÃO DE DISPONIBILIDADE DE EQUIPAMENTOS' },
    { keywords: ['equipe técnica', 'equipe'], title: 'DECLARAÇÃO DE DISPONIBILIDADE DE EQUIPE TÉCNICA' },
    { keywords: ['responsável técnico', 'indicação'], title: 'DECLARAÇÃO DE INDICAÇÃO DE RESPONSÁVEL TÉCNICO' },
    { keywords: ['elaboração independente', 'independen'], title: 'DECLARAÇÃO DE ELABORAÇÃO INDEPENDENTE DE PROPOSTA' },
    { keywords: ['conhecimento', 'aceitação', 'aceite do edital'], title: 'DECLARAÇÃO DE CONHECIMENTO E ACEITAÇÃO DO EDITAL' },
    { keywords: ['sigilo', 'confidencialidade'], title: 'DECLARAÇÃO DE SIGILO E CONFIDENCIALIDADE' },
    { keywords: ['reserv', 'cota', 'exclusiv'], title: 'DECLARAÇÃO DE ATENDIMENTO AO CRITÉRIO DE PARTICIPAÇÃO' },
    { keywords: ['nepotismo'], title: 'DECLARAÇÃO DE INEXISTÊNCIA DE NEPOTISMO' },
    { keywords: ['trabalho escravo', 'forçado', 'degradante'], title: 'DECLARAÇÃO DE NÃO UTILIZAÇÃO DE TRABALHO DEGRADANTE OU FORÇADO' },
    { keywords: ['cumprir', 'cumprimento', 'obrigação'], title: 'DECLARAÇÃO DE CUMPRIMENTO DE OBRIGAÇÕES' },
    { keywords: ['regularidade fiscal', 'fiscal'], title: 'DECLARAÇÃO DE REGULARIDADE FISCAL E TRABALHISTA' },
];
// ═══════════════════════════════════════════════════════════════
// 7. CONSTANTES DO MÓDULO
// ═══════════════════════════════════════════════════════════════
/** Nome do módulo, alinhado ao ModuleName type */
exports.DECLARATION_MODULE_NAME = 'declaration';
/** Versão do prompt (para versionGovernance) */
exports.DECLARATION_PROMPT_VERSION = 'declaration-v3.0.0';
/** Códigos de validação — centralizados para evitar strings soltas */
exports.VALIDATION_CODES = {
    COMPANY_MISSING: 'COMPANY_MISSING',
    CNPJ_MISSING: 'CNPJ_MISSING',
    ORGAO_CONTAMINATED: 'ORGAO_CONTAMINATED',
    ORGAO_CORRECT_MISSING: 'ORGAO_CORRECT_MISSING',
    PLACEHOLDER_FOUND: 'PLACEHOLDER_FOUND',
    STRUCTURE_TOO_SHORT: 'STRUCTURE_TOO_SHORT',
    STRUCTURE_TOO_LONG: 'STRUCTURE_TOO_LONG',
    EDITAL_CONTAMINATED: 'EDITAL_CONTAMINATED',
    PROCESS_CONTAMINATED: 'PROCESS_CONTAMINATED',
    // v8: Título
    TITLE_TRUNCATED: 'TITLE_TRUNCATED',
    TITLE_NARROW: 'TITLE_NARROW',
    // v8: Semântica
    SEMANTIC_NARROW: 'SEMANTIC_NARROW',
    GENERIC_LANGUAGE: 'GENERIC_LANGUAGE',
    // v8: Fechamento
    WEAK_CLOSURE: 'WEAK_CLOSURE',
};
/** Penalidades por severidade (usadas no scoreCalculator) */
exports.SEVERITY_PENALTIES = {
    critical: 25,
    major: 12,
    minor: 5,
};
