/**
 * ══════════════════════════════════════════════════════════════════
 *  Declaration Repair — Auto-correção via 2ª chamada IA
 * ══════════════════════════════════════════════════════════════════
 *
 *  Quando o validador detecta issues CRITICAL, este módulo tenta
 *  corrigir o texto automaticamente usando uma segunda chamada à IA
 *  com um prompt de repair cirúrgico.
 *
 *  Design de baixo acoplamento:
 *    - Recebe a função de chamada à IA como parâmetro (AiCallFn)
 *    - NÃO importa callGeminiWithRetry / genAI diretamente
 *    - A rota é responsável por injetar a implementação concreta
 *    - Isso permite trocar o provider (Gemini → OpenAI) sem alterar este módulo
 */

import type { AuthoritativeFacts, DeclarationValidationIssue } from './declarationTypes';
import { parseAndSanitize, type ParsedDeclaration } from './declarationParser';
import { logger } from '../../../lib/logger';

// ═══════════════════════════════════════════════════════════════
// TIPO DA FUNÇÃO DE CHAMADA À IA (injeção de dependência)
// ═══════════════════════════════════════════════════════════════

/**
 * Contrato genérico para qualquer provider de IA.
 * A rota injeta a implementação concreta (Gemini, OpenAI, etc.).
 *
 * @param prompt  Prompt de repair completo
 * @returns       Texto bruto da resposta da IA
 */
export type AiCallFn = (prompt: string) => Promise<string>;

// ═══════════════════════════════════════════════════════════════
// REPAIR PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════

function buildRepairPrompt(
    text: string,
    issues: DeclarationValidationIssue[],
    facts: AuthoritativeFacts,
): string {
    const issueList = issues
        .map(i => `- [${i.severity.toUpperCase()}] ${i.code}: ${i.message}`)
        .join('\n');

    return `Você recebeu uma declaração licitatória que contém ERROS detectados automaticamente.

ERROS DETECTADOS:
${issueList}

FATOS CORRETOS (use EXCLUSIVAMENTE estes):
- Empresa: ${facts.empresaRazaoSocial}
- CNPJ: ${facts.empresaCnpj}
- Órgão: ${facts.orgaoLicitante}
- Edital nº: ${facts.editalNumero || 'N/A'}
- Processo nº: ${facts.processoNumero || 'N/A'}
- Modalidade: ${facts.modalidade || 'N/A'}
${facts.representanteNome ? `- Representante: ${facts.representanteNome}` : ''}
${facts.representanteCpf ? `- CPF: ${facts.representanteCpf}` : ''}
${facts.tecnicoNome ? `- Resp. Técnico: ${facts.tecnicoNome}` : ''}
${facts.tecnicoCpf ? `- CPF Técnico: ${facts.tecnicoCpf}` : ''}
${facts.tecnicoRegistro ? `- Registro: ${facts.tecnicoRegistro}` : ''}

TEXTO ORIGINAL:
${text}

INSTRUÇÕES DE CORREÇÃO:
1. Corrija APENAS os erros listados acima.
2. NÃO altere o conteúdo jurídico, argumentação ou estrutura.
3. Substitua quaisquer referências incorretas pelos FATOS CORRETOS.
4. Resolva placeholders [NOME], [CNPJ] etc. com os dados fornecidos acima.
5. Se o texto cita um órgão errado, substitua por "${facts.orgaoLicitante}".

INSTRUÇÕES ESPECÍFICAS POR TIPO DE ERRO:
${issues.some(i => i.code === 'TITLE_TRUNCATED') ? '- TÍTULO TRUNCADO: O título termina em preposição ou está incompleto. Reformule para formar unidade semântica completa.' : ''}
${issues.some(i => i.code === 'SEMANTIC_NARROW') ? '- NÚCLEO ESTREITO: O núcleo declaratório cobre poucos conceitos. Amplie para incluir todos os aspectos pertinentes (vínculo empregatício, funcional, contratual, cargo/função pública, etc.).' : ''}
${issues.some(i => i.code === 'GENERIC_LANGUAGE') ? '- LINGUAGEM GENÉRICA: Remova frases ornamentais que não agregam valor jurídico. Substitua por conteúdo declaratório efetivo.' : ''}
${issues.some(i => i.code === 'WEAK_CLOSURE') ? '- FECHO FRACO: Inclua fecho formal ("Por ser expressão da verdade, firma a presente declaração para todos os fins de direito") e ciência das sanções (art. 155 Lei 14.133/2021).' : ''}

6. Retorne JSON puro: { "title": "...", "text": "..." }
7. NÃO use markdown, negritos, ou blocos de código.`;
}

// ═══════════════════════════════════════════════════════════════
// REPAIR RESULT
// ═══════════════════════════════════════════════════════════════

export interface RepairResult {
    /** true se o repair foi executado (independente de sucesso) */
    attempted: boolean;
    /** true se o repair melhorou o texto (menos issues ou zero critical) */
    improved: boolean;
    /** Texto reparado (ou original se repair falhou) */
    text: string;
    /** Título reparado */
    title: string;
    /** Issues após re-validação do texto reparado */
    issuesAfterRepair: DeclarationValidationIssue[];
    /** Lista de correções aplicadas (issues resolvidas) */
    corrections: string[];
}

// ═══════════════════════════════════════════════════════════════
// FUNÇÃO PRINCIPAL
// ═══════════════════════════════════════════════════════════════

/**
 * Tenta reparar automaticamente erros factuais no texto gerado.
 *
 * Fluxo:
 *   1. Monta prompt de repair com os erros e fatos corretos
 *   2. Chama a IA via AiCallFn injetada
 *   3. Parsea a resposta
 *   4. Re-valida o texto reparado
 *   5. Compara: se melhorou, usa reparado; senão, mantém original
 *
 * @param originalText    Texto gerado pela IA na primeira chamada
 * @param originalTitle   Título gerado pela IA
 * @param issues          Issues detectadas pelo validador
 * @param facts           Fatos autoritativos
 * @param validateFn      Função de validação (injetada para evitar import circular)
 * @param aiCallFn        Função de chamada à IA (injetada para baixo acoplamento)
 */
export async function repairDeclaration(
    originalText: string,
    originalTitle: string,
    issues: DeclarationValidationIssue[],
    facts: AuthoritativeFacts,
    validateFn: (text: string, facts: AuthoritativeFacts) => DeclarationValidationIssue[],
    aiCallFn: AiCallFn,
): Promise<RepairResult> {
    const noRepair: RepairResult = {
        attempted: false,
        improved: false,
        text: originalText,
        title: originalTitle,
        issuesAfterRepair: issues,
        corrections: [],
    };

    // Só repara se há issues critical
    const criticalIssues = issues.filter(i => i.severity === 'critical');
    if (criticalIssues.length === 0) {
        return noRepair;
    }

    logger.info(`[DeclarationRepair] ${criticalIssues.length} critical issues. Attempting repair...`);

    try {
        // Step 1: Chamar IA com prompt de repair
        const prompt = buildRepairPrompt(originalText, issues, facts);
        const rawResponse = await aiCallFn(prompt);

        // Step 2: Parsear resposta
        const repaired = parseAndSanitize(rawResponse);
        if (!repaired || !repaired.text) {
            logger.info('[DeclarationRepair] Repair returned empty response. Keeping original.');
            return { ...noRepair, attempted: true };
        }

        // Step 3: Re-validar texto reparado
        const reIssues = validateFn(repaired.text, facts);
        const reCritical = reIssues.filter(i => i.severity === 'critical').length;
        const originalCritical = criticalIssues.length;

        // Step 4: Avaliar se melhorou
        const improved = reCritical === 0 || reIssues.length < issues.length;

        if (improved) {
            // Computar correções (issues que sumiram)
            const afterCodes = new Set(reIssues.map(i => i.code));
            const corrections = issues
                .filter(i => !afterCodes.has(i.code))
                .map(i => `${i.code}: ${i.message} → CORRIGIDO`);

            logger.info(`[DeclarationRepair] Success: ${corrections.length} issues fixed, ${reIssues.length} remaining (${reCritical} critical)`);

            return {
                attempted: true,
                improved: true,
                text: repaired.text,
                title: repaired.title || originalTitle,
                issuesAfterRepair: reIssues,
                corrections,
            };
        } else {
            logger.info(`[DeclarationRepair] Repair did not improve. Original: ${originalCritical} critical → Repaired: ${reCritical} critical. Keeping original.`);
            return { ...noRepair, attempted: true };
        }

    } catch (err: any) {
        logger.error('[DeclarationRepair] Repair call failed:', err?.message || err);
        return { ...noRepair, attempted: true };
    }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY: Wrapper para callGeminiWithRetry
// ═══════════════════════════════════════════════════════════════

/**
 * Cria uma AiCallFn a partir do callGeminiWithRetry existente.
 * Usado pela rota para injetar a implementação concreta.
 *
 * @param models     genAI.models (do GoogleGenAI)
 * @param callFn     callGeminiWithRetry importado de gemini.service.ts
 * @param modelName  Modelo a usar (default: gemini-2.5-flash)
 */
export function createGeminiRepairFn(
    models: any,
    callFn: (model: any, options: any, maxRetries?: number, trackingOptions?: any) => Promise<any>,
    modelName = 'gemini-2.5-flash',
    trackingOptions?: any
): AiCallFn {
    return async (prompt: string): Promise<string> => {
        const result = await callFn(models, {
            model: modelName,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { temperature: 0.1, maxOutputTokens: 4096 },
        }, 3, trackingOptions);
        return (result.text || '').trim();
    };
}
