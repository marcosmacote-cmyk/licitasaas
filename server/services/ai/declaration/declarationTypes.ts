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

import type { ModuleName } from '../modules/moduleContextContracts';

// ═══════════════════════════════════════════════════════════════
// 1. FAMÍLIA DE DECLARAÇÃO
// ═══════════════════════════════════════════════════════════════

/**
 * Classificação funcional da declaração.
 * Determina qual recorte do edital será injetado como contexto
 * e qual estilo de validação será aplicado.
 */
export type DeclarationFamily =
    | 'SIMPLE_COMPLIANCE'       // Menores, idoneidade, fato impeditivo, vedações legais
    | 'OPERATIONAL_COMMITMENT'  // Visita técnica, disponibilidade, equipamentos
    | 'TECHNICAL_PERSONAL'      // Pessoal técnico, equipe, RT, CREA/CAU
    | 'CORPORATE_STATUS'        // ME/EPP, enquadramento, regularidade fiscal/econômica
    | 'CUSTOM_GENERIC';         // Declarações atípicas não classificáveis

/**
 * Estilo de redação solicitado pelo usuário.
 * Default: 'objetiva' (anti-prolixidade).
 */
export type DeclarationStyle = 'objetiva' | 'formal' | 'robusta';

/** Restrições de extensão por família — usadas no prompt builder e validator */
export const FAMILY_LENGTH_CONSTRAINTS: Record<DeclarationFamily, {
    minParagraphs: number;
    maxParagraphs: number;
    styleHint: string;
}> = {
    SIMPLE_COMPLIANCE:      { minParagraphs: 2, maxParagraphs: 4,  styleHint: 'Objetiva e concisa. 2 a 3 parágrafos. Sem contextualização longa.' },
    OPERATIONAL_COMMITMENT: { minParagraphs: 3, maxParagraphs: 6,  styleHint: 'Formal e completa. 3 a 5 parágrafos.' },
    TECHNICAL_PERSONAL:     { minParagraphs: 3, maxParagraphs: 8,  styleHint: 'Extensão estritamente necessária para dados técnicos.' },
    CORPORATE_STATUS:       { minParagraphs: 2, maxParagraphs: 5,  styleHint: 'Formal e precisa. 2 a 4 parágrafos.' },
    CUSTOM_GENERIC:         { minParagraphs: 2, maxParagraphs: 6,  styleHint: 'Adequada ao tipo solicitado. Sem prolixidade.' },
};

// ═══════════════════════════════════════════════════════════════
// 2. FATOS AUTORITATIVOS
// ═══════════════════════════════════════════════════════════════

/** Tipo do emissor da declaração */
export type DeclarationIssuerType = 'company' | 'technical';

/**
 * Bloco imutável de dados factuais.
 *
 * Hierarquia de prevalência: AuthoritativeFacts > Prompt > SchemaV2.
 * Nenhuma informação do resumo do edital pode sobrepor estes dados.
 *
 * Nomes de campo alinhados ao Prisma (CompanyProfile) e SchemaV2,
 * mas organizados em blocos semânticos com prefixo.
 */
export interface AuthoritativeFacts {
    // ── Processo Licitatório ──
    orgaoLicitante: string;            // Nome do órgão (fonte: título do processo ou user override)
    modalidade?: string;               // Ex: "Pregão Eletrônico"
    editalNumero?: string;             // Nº do edital (fonte: schemaV2 ou título)
    processoNumero?: string;           // Nº do processo administrativo
    objeto?: string;                   // Objeto resumido da licitação
    biddingTitle: string;              // Título completo do BiddingProcess (DB)

    // ── Declaração ──
    declarationType: string;           // Tipo textual (ex: "Declaração de Idoneidade")
    declarationFamily: DeclarationFamily;

    // ── Emitente ──
    issuerType: DeclarationIssuerType;

    // ── Empresa (fonte: CompanyProfile) ──
    empresaRazaoSocial: string;        // Alinhado a CompanyProfile.razaoSocial
    empresaCnpj: string;               // Alinhado a CompanyProfile.cnpj
    empresaEndereco?: string;          // Extraído de qualification ou CompanyProfile.address
    qualificacaoCompleta?: string;     // Texto completo de CompanyProfile.qualification — passado à IA literalmente

    // ── Representante Legal (fonte: qualification parsing) ──
    representanteNome?: string;        // Extraído via regex de CompanyProfile.qualification
    representanteCpf?: string;         // Extraído via regex
    representanteCargo?: string;       // Ex: "Sócio Administrador"

    // ── Responsável Técnico (se issuerType === 'technical') ──
    tecnicoNome?: string;              // Extraído de CompanyProfile.technicalQualification
    tecnicoCpf?: string;
    tecnicoRegistro?: string;          // Nº CREA/CAU
    tecnicoProfissao?: string;         // Ex: "Engenheiro Civil"

    // ── Assinatura ──
    municipioAssinatura?: string;      // Cidade para o fecho (ex: "Fortaleza/CE")

    // ── Cross-check de contaminação ──
    /** Órgão extraído do schemaV2 — pode divergir do orgaoLicitante quando o schema é de outro certame */
    orgaoFromSchema?: string;
    /** Edital extraído do schemaV2 */
    editalFromSchema?: string;
    /** Processo extraído do schemaV2 */
    processFromSchema?: string;
    /** true quando orgaoFromSchema diverge do orgaoLicitante (contaminação) */
    hasDivergence: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 3. VALIDAÇÃO PÓS-GERAÇÃO
// ═══════════════════════════════════════════════════════════════

/**
 * Issue detectada pelo validador pós-geração.
 *
 * O campo `severity` segue a mesma escala de ModuleQualityIssue,
 * mas usa apenas 3 níveis para simplificar o fluxo de repair:
 *   - critical: bloqueia qualidade A, dispara repair via IA
 *   - major: penaliza score, não dispara repair
 *   - minor: informativo
 */
export interface DeclarationValidationIssue {
    /** Código único (ex: COMPANY_MISSING, ORGAO_CONTAMINATED) */
    code: string;
    /** Severidade alinhada ao padrão do projeto */
    severity: 'critical' | 'major' | 'minor';
    /** Mensagem legível para log e debug */
    message: string;
}

// ═══════════════════════════════════════════════════════════════
// 4. QUALITY REPORT
// ═══════════════════════════════════════════════════════════════

/**
 * Relatório de qualidade retornado pela API.
 *
 * Difere de ModuleQualityReport (que é genérico e baseado em checks/dimensões)
 * porque aqui o foco é fidelidade factual e contaminação documental.
 *
 * O frontend consome `score`, `grade`, `corrections` e `family` diretamente.
 */
export interface DeclarationQualityReport {
    /** Score numérico 0-100 */
    score: number;
    /** Grade derivado do score */
    grade: 'A' | 'B' | 'C' | 'D';
    /** Issues detectadas pelo validador */
    issues: DeclarationValidationIssue[];
    /** Correções aplicadas automaticamente (log textual) */
    corrections: string[];
    /** true se alguma correção foi aplicada via repair */
    corrected: boolean;
    /** Família classificada da declaração */
    family: DeclarationFamily;
    /** Número de chamadas à IA (1 = geração, 2 = geração + repair) */
    attempts: number;

    // ── Checks booleanos diretos (consumidos pelo frontend v2) ──

    /** true se empresa + CNPJ foram encontrados no texto */
    factualConsistency: boolean;
    /** true se o tipo da declaração aparece coerente no texto */
    declarationTypeMatch: boolean;
    /** true se o texto tem o mínimo de parágrafos e fecho formal */
    structureAdequate: boolean;
    /** true se dados de outro certame foram detectados */
    contaminationDetected: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 5. API CONTRACT — REQUEST & RESPONSE
// ═══════════════════════════════════════════════════════════════

/**
 * Corpo do POST /api/generate-declaration.
 * Alinhado ao que o hook useAiDeclaration.ts já envia.
 */
export interface GenerateDeclarationRequest {
    biddingProcessId: string;
    companyId: string;
    declarationType: string;
    issuerType?: DeclarationIssuerType;
    customPrompt?: string;
    signatureCity?: string;
    signatureDate?: string;
}

/**
 * Resposta do POST /api/generate-declaration.
 * O frontend (useAiDeclaration) já consome data.text, data.title, data.quality.
 */
export interface GenerateDeclarationResponse {
    text: string;
    title: string;
    quality: DeclarationQualityReport;
    /** Presente quando grade === 'D' e havia issues críticas */
    warning?: string;
}

// ═══════════════════════════════════════════════════════════════
// 6. OUTPUT SCHEMA ESTENDIDO
// ═══════════════════════════════════════════════════════════════

/**
 * Schema de saída estendido para o módulo declaration.
 *
 * Estende o DeclarationSchema existente em moduleOutputSchemas.ts
 * com os campos do v5 (qualityReport, family, etc.).
 *
 * O moduleOutputSchemas.ts original continua inalterado.
 * Este tipo é usado apenas pelo novo fluxo.
 */
export interface DeclarationOutputV3 {
    /** Tipo da declaração (entrada do usuário) */
    documentType: string;
    /** Texto gerado pela IA */
    generatedText: string;
    /** Título gerado pela IA */
    generatedTitle: string;
    /** Campos que ainda precisam preenchimento manual */
    requiredInputs: string[];
    /** Avisos para o usuário */
    warnings: string[];
    /** Relatório de qualidade (v5) */
    qualityReport: DeclarationQualityReport;
    /** Fatos que alimentaram o prompt */
    authoritativeFacts: AuthoritativeFacts;
}

// ═══════════════════════════════════════════════════════════════
// 7. CONSTANTES DO MÓDULO
// ═══════════════════════════════════════════════════════════════

/** Nome do módulo, alinhado ao ModuleName type */
export const DECLARATION_MODULE_NAME: ModuleName = 'declaration';

/** Versão do prompt (para versionGovernance) */
export const DECLARATION_PROMPT_VERSION = 'declaration-v3.0.0';

/** Códigos de validação — centralizados para evitar strings soltas */
export const VALIDATION_CODES = {
    COMPANY_MISSING: 'COMPANY_MISSING',
    CNPJ_MISSING: 'CNPJ_MISSING',
    ORGAO_CONTAMINATED: 'ORGAO_CONTAMINATED',
    ORGAO_CORRECT_MISSING: 'ORGAO_CORRECT_MISSING',
    PLACEHOLDER_FOUND: 'PLACEHOLDER_FOUND',
    STRUCTURE_TOO_SHORT: 'STRUCTURE_TOO_SHORT',
    STRUCTURE_TOO_LONG: 'STRUCTURE_TOO_LONG',
    EDITAL_CONTAMINATED: 'EDITAL_CONTAMINATED',
    PROCESS_CONTAMINATED: 'PROCESS_CONTAMINATED',
} as const;

export type ValidationCode = typeof VALIDATION_CODES[keyof typeof VALIDATION_CODES];

/** Penalidades por severidade (usadas no scoreCalculator) */
export const SEVERITY_PENALTIES: Record<DeclarationValidationIssue['severity'], number> = {
    critical: 25,
    major: 12,
    minor: 5,
};
