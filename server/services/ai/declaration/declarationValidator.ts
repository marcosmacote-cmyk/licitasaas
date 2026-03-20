/**
 * ══════════════════════════════════════════════════════════════════
 *  Declaration Validator — Validação Pós-Geração (v3.0.0)
 * ══════════════════════════════════════════════════════════════════
 *
 *  Pipeline obrigatório entre a IA e o frontend.
 *  Nenhuma declaração é retornada sem passar por aqui.
 *
 *  Responsabilidades:
 *    1. validateDeclaration()  — detecta issues no texto gerado
 *    2. calculateQualityReport() — computa score, grade e booleanos
 *
 *  Design:
 *    - Cada regra é uma função pura (text, facts) → issue | null
 *    - Regras são organizadas por severidade (critical > major > minor)
 *    - Novas regras podem ser adicionadas sem alterar a estrutura
 *    - As constantes VALIDATION_CODES e SEVERITY_PENALTIES vêm de declarationTypes.ts
 */

import type {
    AuthoritativeFacts,
    DeclarationFamily,
    DeclarationValidationIssue,
    DeclarationQualityReport,
} from './declarationTypes';

import { VALIDATION_CODES, SEVERITY_PENALTIES, FAMILY_LENGTH_CONSTRAINTS } from './declarationTypes';

// ═══════════════════════════════════════════════════════════════
// TIPOS INTERNOS
// ═══════════════════════════════════════════════════════════════

type ValidationRule = {
    code: string;
    severity: DeclarationValidationIssue['severity'];
    /** Função pura: retorna mensagem se issue detectada, ou null se ok */
    check: (text: string, lower: string, facts: AuthoritativeFacts) => string | null;
};

// ═══════════════════════════════════════════════════════════════
// REGRAS DE VALIDAÇÃO
// ═══════════════════════════════════════════════════════════════
// Organizadas por severidade decrescente.
// Cada regra retorna uma mensagem de erro ou null (sem issue).

const VALIDATION_RULES: ValidationRule[] = [

    // ── CRITICAL: Erros factuais que invalidam o documento ──

    {
        code: VALIDATION_CODES.COMPANY_MISSING,
        severity: 'critical',
        check: (_text, lower, facts) => {
            if (!facts.empresaRazaoSocial) return null;
            // Busca pelos primeiros 20 chars da razão social (case-insensitive)
            const key = facts.empresaRazaoSocial.toLowerCase().substring(0, 20);
            if (!lower.includes(key)) {
                return `Empresa "${facts.empresaRazaoSocial}" não encontrada no texto.`;
            }
            return null;
        },
    },

    {
        code: VALIDATION_CODES.CNPJ_MISSING,
        severity: 'critical',
        check: (text, _lower, facts) => {
            if (!facts.empresaCnpj) return null;
            // Compara apenas dígitos para tolerar formatações diferentes
            const cnpjDigits = facts.empresaCnpj.replace(/[^\d]/g, '');
            if (cnpjDigits.length >= 14 && !text.replace(/[^\d]/g, '').includes(cnpjDigits)) {
                return `CNPJ "${facts.empresaCnpj}" não encontrado no texto.`;
            }
            return null;
        },
    },

    {
        code: VALIDATION_CODES.ORGAO_CONTAMINATED,
        severity: 'critical',
        check: (_text, lower, facts) => {
            // Só verifica se há divergência detectada entre título e schema
            if (!facts.hasDivergence || !facts.orgaoFromSchema) return null;
            const contaminant = facts.orgaoFromSchema.toLowerCase().substring(0, 20);
            if (contaminant.length > 3 && lower.includes(contaminant)) {
                return `Órgão contaminante "${facts.orgaoFromSchema}" encontrado no texto. Deveria ser "${facts.orgaoLicitante}".`;
            }
            return null;
        },
    },

    {
        code: VALIDATION_CODES.EDITAL_CONTAMINATED,
        severity: 'critical',
        check: (text, _lower, facts) => {
            if (!facts.hasDivergence) return null;
            if (facts.editalFromSchema && facts.editalNumero &&
                facts.editalFromSchema !== facts.editalNumero) {
                if (text.includes(facts.editalFromSchema)) {
                    return `Edital contaminante "${facts.editalFromSchema}" encontrado. Correto: "${facts.editalNumero}".`;
                }
            }
            return null;
        },
    },

    {
        code: VALIDATION_CODES.PROCESS_CONTAMINATED,
        severity: 'critical',
        check: (text, _lower, facts) => {
            if (!facts.hasDivergence) return null;
            if (facts.processFromSchema && facts.processoNumero &&
                facts.processFromSchema !== facts.processoNumero) {
                if (text.includes(facts.processFromSchema)) {
                    return `Processo contaminante "${facts.processFromSchema}" encontrado. Correto: "${facts.processoNumero}".`;
                }
            }
            return null;
        },
    },

    // ── MAJOR: Problemas que penalizam qualidade mas não invalidam ──

    {
        code: VALIDATION_CODES.ORGAO_CORRECT_MISSING,
        severity: 'major',
        check: (_text, lower, facts) => {
            if (!facts.orgaoLicitante || facts.orgaoLicitante === 'Não identificado') return null;
            const orgaoKey = facts.orgaoLicitante.toLowerCase().substring(0, 15);
            if (orgaoKey.length > 3 && !lower.includes(orgaoKey)) {
                return `Órgão correto "${facts.orgaoLicitante}" não citado no texto.`;
            }
            return null;
        },
    },

    {
        code: VALIDATION_CODES.PLACEHOLDER_FOUND,
        severity: 'major',
        check: (text, _lower, facts) => {
            // Detecta placeholders genéricos que deveriam ter sido preenchidos pela IA
            const placeholderPattern = /\[(NOME|CNPJ|CPF|ENDEREÇO|CARGO|ÓRGÃO|EDITAL|PROCESSO|RAZÃO SOCIAL|REPRESENTANTE)\]/gi;
            const placeholders = text.match(placeholderPattern);
            if (!placeholders || placeholders.length === 0) return null;

            // Filtra placeholders legítimos (campos opcionais não fornecidos)
            const illegitimate = placeholders.filter(p => {
                const inner = p.replace(/[\[\]]/g, '').toLowerCase();
                // Se o nome do representante não foi fornecido, [NOME] é legítimo
                if (inner.includes('nome') && !facts.representanteNome) return false;
                // Se CPF não fornecido, [CPF] é legítimo
                if (inner.includes('cpf') && !facts.representanteCpf) return false;
                return true;
            });

            if (illegitimate.length > 0) {
                return `Placeholders não resolvidos: ${illegitimate.join(', ')}`;
            }
            return null;
        },
    },

    {
        code: 'REPRESENTANTE_MISSING',
        severity: 'major',
        check: (_text, lower, facts) => {
            // Só valida se o representante foi fornecido E o emissor é empresa
            if (!facts.representanteNome || facts.issuerType === 'technical') return null;
            const nomeKey = facts.representanteNome.toLowerCase().substring(0, 15);
            if (nomeKey.length > 3 && !lower.includes(nomeKey)) {
                return `Representante legal "${facts.representanteNome}" não mencionado no texto (emissor: empresa).`;
            }
            return null;
        },
    },

    {
        code: 'TECNICO_MISSING',
        severity: 'major',
        check: (_text, lower, facts) => {
            // Só valida para declarações de pessoal técnico
            if (facts.issuerType !== 'technical' || !facts.tecnicoNome) return null;
            const nomeKey = facts.tecnicoNome.toLowerCase().substring(0, 15);
            if (nomeKey.length > 3 && !lower.includes(nomeKey)) {
                return `Responsável técnico "${facts.tecnicoNome}" não mencionado no texto (emissor: técnico).`;
            }
            return null;
        },
    },

    {
        code: 'DECLARATION_TYPE_MISMATCH',
        severity: 'major',
        check: (_text, lower, facts) => {
            // Verifica se o tipo da declaração é mencionado no texto
            const typeWords = facts.declarationType.toLowerCase()
                .replace(/declaração\s+de\s+/i, '')
                .split(/\s+/)
                .filter(w => w.length > 4); // Ignorar palavras curtas

            if (typeWords.length === 0) return null;

            // Pelo menos 1 palavra-chave do tipo deve aparecer
            const found = typeWords.some(w => lower.includes(w));
            if (!found) {
                return `Tipo da declaração "${facts.declarationType}" não parece estar refletido no corpo do texto.`;
            }
            return null;
        },
    },

    // ── MINOR: Informativo, não bloqueia ──

    {
        code: VALIDATION_CODES.STRUCTURE_TOO_SHORT,
        severity: 'minor',
        check: (text, _lower, facts) => {
            const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 30);
            const constraints = FAMILY_LENGTH_CONSTRAINTS[facts.declarationFamily] || FAMILY_LENGTH_CONSTRAINTS.CUSTOM_GENERIC;
            if (paragraphs.length < constraints.minParagraphs) {
                return `Declaração com apenas ${paragraphs.length} parágrafo(s) substantivo(s) (mínimo para ${facts.declarationFamily}: ${constraints.minParagraphs}).`;
            }
            return null;
        },
    },

    {
        code: VALIDATION_CODES.STRUCTURE_TOO_LONG,
        severity: 'major',
        check: (text, _lower, facts) => {
            const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 30);
            const constraints = FAMILY_LENGTH_CONSTRAINTS[facts.declarationFamily] || FAMILY_LENGTH_CONSTRAINTS.CUSTOM_GENERIC;
            if (paragraphs.length > constraints.maxParagraphs + 2) {
                // +2 de tolerância para não penalizar marginalmente
                return `Declaração com ${paragraphs.length} parágrafos — excessivamente extensa para família ${facts.declarationFamily} (máximo recomendado: ${constraints.maxParagraphs}). Reduza prolixidade.`;
            }
            return null;
        },
    },

    {
        code: 'MISSING_FORMAL_CLOSURE',
        severity: 'minor',
        check: (_text, lower, _facts) => {
            // Verifica se contém fecho formal típico
            const closurePatterns = [
                'expressão da verdade',
                'firma a presente',
                'fins de direito',
                'por ser verdade',
                'verdade, firmo',
                'presente declaração',
            ];
            const hasClosure = closurePatterns.some(p => lower.includes(p));
            if (!hasClosure) {
                return 'Fecho formal não detectado. Recomendado: "Por ser expressão da verdade, firma a presente declaração para todos os fins de direito."';
            }
            return null;
        },
    },

    {
        code: 'MISSING_LEGAL_REFERENCE',
        severity: 'minor',
        check: (_text, lower, _facts) => {
            // Verifica citação de legislação (Lei 14.133 ou equivalente)
            const legalPatterns = [
                'lei 14.133',
                'lei nº 14.133',
                'lei n° 14.133',
                'lei 8.666',
                'lei nº 8.666',
                'artigo',
                'art.',
                'inciso',
            ];
            const hasLegal = legalPatterns.some(p => lower.includes(p));
            if (!hasLegal) {
                return 'Nenhuma referência legislativa detectada. Recomendado citar fundamento legal (ex: Lei 14.133/2021).';
            }
            return null;
        },
    },

    {
        code: 'MISSING_SANCTIONS_AWARENESS',
        severity: 'minor',
        check: (_text, lower, _facts) => {
            // Verifica menção a sanções/penalidades
            const sanctionPatterns = [
                'sanç',
                'penalidade',
                'art. 155',
                'declaração falsa',
                'responsabilidade civil',
                'responsabilidade penal',
            ];
            const hasSanctions = sanctionPatterns.some(p => lower.includes(p));
            if (!hasSanctions) {
                return 'Ciência de sanções não detectada. Recomendado incluir menção ao art. 155 da Lei 14.133/2021.';
            }
            return null;
        },
    },

    {
        code: 'TEXT_TOO_SHORT',
        severity: 'minor',
        check: (text, _lower, _facts) => {
            if (text.length < 200) {
                return `Texto com apenas ${text.length} caracteres. Declarações robustas geralmente excedem 500 caracteres.`;
            }
            return null;
        },
    },
];

// ═══════════════════════════════════════════════════════════════
// FUNÇÃO PRINCIPAL: validateDeclaration
// ═══════════════════════════════════════════════════════════════

/**
 * Executa todas as regras de validação contra o texto gerado.
 *
 * Retorna uma lista de issues detectadas, ordenadas por severidade.
 * Se a lista estiver vazia, o texto passou em todas as verificações.
 *
 * @param text  Texto gerado pela IA (já sanitizado)
 * @param facts Fatos autoritativos usados na geração
 * @returns     Lista de issues (pode ser vazia)
 */
export function validateDeclaration(
    text: string,
    facts: AuthoritativeFacts,
): DeclarationValidationIssue[] {
    if (!text || text.trim().length === 0) {
        return [{
            code: 'EMPTY_TEXT',
            severity: 'critical',
            message: 'Texto gerado está vazio.',
        }];
    }

    const lower = text.toLowerCase();
    const issues: DeclarationValidationIssue[] = [];

    for (const rule of VALIDATION_RULES) {
        try {
            const message = rule.check(text, lower, facts);
            if (message) {
                issues.push({
                    code: rule.code,
                    severity: rule.severity,
                    message,
                });
            }
        } catch (err) {
            // Regra com erro interno — registra como minor para não bloquear
            console.error(`[DeclarationValidator] Rule ${rule.code} threw:`, err);
            issues.push({
                code: rule.code,
                severity: 'minor',
                message: `Verificação ${rule.code} falhou internamente.`,
            });
        }
    }

    // Ordenar: critical → major → minor
    const severityOrder: Record<string, number> = { critical: 0, major: 1, minor: 2 };
    issues.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

    // Log resumido
    const criticalCount = issues.filter(i => i.severity === 'critical').length;
    const majorCount = issues.filter(i => i.severity === 'major').length;
    const minorCount = issues.filter(i => i.severity === 'minor').length;
    console.log(`[DeclarationValidator] ${issues.length} issues: ${criticalCount} critical, ${majorCount} major, ${minorCount} minor`);

    return issues;
}

// ═══════════════════════════════════════════════════════════════
// QUALITY REPORT BUILDER
// ═══════════════════════════════════════════════════════════════

/**
 * Computa o relatório de qualidade final.
 *
 * Score = 100 - Σ(penalidades por issue) + bônus por correções.
 * Os booleanos (factualConsistency, contaminationDetected, etc.)
 * são derivados das issues — não há cálculo separado.
 *
 * @param issues      Issues detectadas pelo validador (pós-repair se aplicável)
 * @param corrections Correções aplicadas via repair IA
 * @param family      Família classificada da declaração
 * @param attempts    Número total de chamadas à IA
 */
export function calculateQualityReport(
    issues: DeclarationValidationIssue[],
    corrections: string[],
    family: DeclarationFamily,
    attempts: number,
): DeclarationQualityReport {

    // ── Score ──
    let score = 100;

    for (const issue of issues) {
        score -= SEVERITY_PENALTIES[issue.severity] ?? 0;
    }

    // Bônus por auto-correção (máximo 95 para sinalizar que houve intervenção)
    if (corrections.length > 0) {
        score = Math.min(score + 15, 95);
    }

    score = Math.max(0, Math.min(100, score));

    // ── Grade ──
    const grade: DeclarationQualityReport['grade'] =
        score >= 90 ? 'A' :
        score >= 70 ? 'B' :
        score >= 50 ? 'C' : 'D';

    // ── Booleanos derivados ──
    const issueCodes = new Set(issues.map(i => i.code));

    const factualConsistency = !issueCodes.has(VALIDATION_CODES.COMPANY_MISSING) &&
                               !issueCodes.has(VALIDATION_CODES.CNPJ_MISSING);

    const declarationTypeMatch = !issueCodes.has('DECLARATION_TYPE_MISMATCH');

    const structureAdequate = !issueCodes.has(VALIDATION_CODES.STRUCTURE_TOO_SHORT) &&
                              !issueCodes.has('TEXT_TOO_SHORT');

    const contaminationDetected = issueCodes.has(VALIDATION_CODES.ORGAO_CONTAMINATED) ||
                                  issueCodes.has(VALIDATION_CODES.EDITAL_CONTAMINATED) ||
                                  issueCodes.has(VALIDATION_CODES.PROCESS_CONTAMINATED);

    return {
        score,
        grade,
        issues,
        corrections,
        corrected: corrections.length > 0,
        family,
        attempts,
        factualConsistency,
        declarationTypeMatch,
        structureAdequate,
        contaminationDetected,
    };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS EXPORTADOS
// ═══════════════════════════════════════════════════════════════

/** Verifica se há issues críticas na lista */
export function hasCriticalIssues(issues: DeclarationValidationIssue[]): boolean {
    return issues.some(i => i.severity === 'critical');
}

/** Filtra issues que foram resolvidas após repair */
export function computeCorrections(
    beforeIssues: DeclarationValidationIssue[],
    afterIssues: DeclarationValidationIssue[],
): string[] {
    const afterCodes = new Set(afterIssues.map(i => i.code));
    return beforeIssues
        .filter(i => !afterCodes.has(i.code))
        .map(i => `${i.code}: ${i.message} → CORRIGIDO`);
}

/** Resumo humanizado para logs */
export function summarizeReport(report: DeclarationQualityReport): string {
    return `[Declaration] ${report.grade} (${report.score}/100) | ` +
           `family=${report.family} | ` +
           `attempts=${report.attempts} | ` +
           `issues=${report.issues.length} | ` +
           `corrected=${report.corrected} | ` +
           `factual=${report.factualConsistency} | ` +
           `contamination=${report.contaminationDetected}`;
}
