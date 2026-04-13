// Type-safe extracted route module
/**
 * Declaration generation routes (v5 pipeline)
 * Extracted from server/index.ts
 */
import express from 'express';
import { authenticateToken, requireAdmin, requireSuperAdmin } from '../middlewares/auth';
import { aiLimiter } from '../lib/security';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { handleApiError } from '../middlewares/errorHandler';

const router = express.Router();

import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { callGeminiWithRetry } from '../services/ai/gemini.service';
import { robustJsonParse } from '../services/ai/parser.service';
import { fallbackToOpenAi } from '../services/ai/openai.service';
import { buildModuleContext, ModuleName } from '../services/ai/modules/moduleContextContracts';
import { uploadDir } from '../services/files.service';
import { DECLARATION_SYSTEM_PROMPT } from '../services/ai/modules/prompts/declarationPromptV2';
import {
    DeclarationStyle, DeclarationFamily, AuthoritativeFacts,
    DECLARATION_SEMANTIC_MAP, FAMILY_LENGTH_CONSTRAINTS, ANTI_GENERIC_PHRASES,
} from '../services/ai/declaration/declarationTypes';
import { parseAndSanitize as parseDeclaration } from '../services/ai/declaration/declarationParser';
import {
    validateDeclaration, validateAndFixTitle, hasCriticalIssues,
    calculateQualityReport, summarizeReport,
} from '../services/ai/declaration/declarationValidator';
import { createGeminiRepairFn, repairDeclaration } from '../services/ai/declaration/declarationRepair';

// Create Gemini AI instance for this module
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// ═══════════════════════════════════════════════
// ROTA PRINCIPAL — 12 STEPS
// ═══════════════════════════════════════════════

router.post('/generate-declaration', authenticateToken, async (req: any, res) => {
    try {
        // ── Step 1: Receber request ──
        const { biddingProcessId, companyId, declarationType, issuerType, customPrompt, style: requestedStyle } = req.body;
        const style: DeclarationStyle = (['objetiva', 'formal', 'robusta'].includes(requestedStyle) ? requestedStyle : 'objetiva') as DeclarationStyle;
        logger.info(`[Declaration v5] Step 1: "${declarationType}" (${issuerType || 'company'}) style=${style} BID:${biddingProcessId}`);

        if (!biddingProcessId || !companyId || !declarationType) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // ── Step 2: Buscar dados ──
        const bidding = await prisma.biddingProcess.findUnique({
            where: { id: biddingProcessId, tenantId: req.user.tenantId },
            include: { aiAnalysis: true }
        });

        const company = await prisma.companyProfile.findUnique({
            where: { id: companyId, tenantId: req.user.tenantId }
        });

        if (!bidding || !company) {
            return res.status(404).json({ error: 'Bidding or Company not found' });
        }

        // ── Step 3: Montar authoritativeFacts ──
        const schema = bidding.aiAnalysis?.schemaV2;
        const pi = (schema as any)?.process_identification || {};
        const orgaoFromSchema = pi.orgao || '';
        const editalFromSchema = pi.numero_edital || '';
        const processFromSchema = pi.numero_processo || '';
        const objetoFromSchema = pi.objeto_completo || pi.objeto_resumido || pi.objeto || '';

        const biddingTitle = (bidding.title || '').trim();
        const biddingMod = (bidding.modality || '').trim();

        // Cross-check órgão
        let orgaoFromTitle = '';
        const titleParts = biddingTitle.split(/\s+-\s+/);
        if (titleParts.length >= 2) {
            orgaoFromTitle = titleParts.slice(1).join(' - ').trim();
        }
        const schemaMatchesTitle = orgaoFromSchema && biddingTitle.toLowerCase().includes(orgaoFromSchema.toLowerCase().substring(0, 15));
        const orgaoName = schemaMatchesTitle ? orgaoFromSchema : (orgaoFromTitle || orgaoFromSchema || 'Não identificado');
        const editalNum = editalFromSchema || '';
        const processNum = processFromSchema || '';
        const hasDivergence = !!(orgaoFromSchema && !schemaMatchesTitle);

        // Extrair dados estruturados da empresa
        const qual = company.qualification || '';
        const representanteName = extractFromQualification(qual, 'name') || company.contactName || '';
        const representanteCpf = extractFromQualification(qual, 'cpf') || company.contactCpf || '';
        const representanteCargo = extractFromQualification(qual, 'cargo');
        const companyAddress = company.address || extractFromQualification(qual, 'address') || '';

        // ── Step 4: Classificar família (precisa ser ANTES do facts) ──
        const family = classifyFamily(declarationType);
        logger.info(`[Declaration v5] Step 4: Family → ${family}`);

        const facts: AuthoritativeFacts = {
            orgaoLicitante: orgaoName,
            modalidade: biddingMod,
            editalNumero: editalNum,
            processoNumero: processNum,
            objeto: objetoFromSchema,
            biddingTitle,
            declarationType,
            declarationFamily: family,
            issuerType: (issuerType || 'company') as 'company' | 'technical',
            empresaRazaoSocial: company.razaoSocial,
            empresaCnpj: company.cnpj,
            empresaEndereco: companyAddress,
            qualificacaoCompleta: qual.trim() || undefined,
            representanteNome: representanteName,
            representanteCpf: representanteCpf,
            representanteCargo: representanteCargo,
            orgaoFromSchema,
            editalFromSchema,
            processFromSchema,
            hasDivergence,
        };

        logger.info(`[Declaration v5] Step 3: Facts → org="${orgaoName}" div=${hasDivergence} rep="${representanteName}"`);
        // ── Step 5: Contexto específico ──
        const familyContext = extractFamilyContext(family, schema);

        // ── Issuer Block ──
        const isTechnical = issuerType === 'technical';
        let issuerBlock = '';

        if (isTechnical) {
            const techQual = company.technicalQualification || '';
            issuerBlock = `EMITENTE: PROFISSIONAL TÉCNICO (Responsável Técnico)

DADOS DO PROFISSIONAL TÉCNICO:
${techQual || 'Dados cadastrados na qualificação técnica da empresa.'}

DADOS DA EMPRESA VINCULADA:
${company.razaoSocial} | CNPJ: ${company.cnpj}
${company.qualification || ''}

INSTRUÇÃO ESPECIAL (RT): A declaração DEVE ser redigida na PRIMEIRA PESSOA do profissional técnico.
Exemplo: "Eu, [Nome], [Nacionalidade], [Estado Civil], [Engenheiro Civil], inscrito no CREA sob nº [Nº], CPF nº [CPF], Responsável Técnico pela empresa [Razão Social], DECLARO..."`;
        } else {
            issuerBlock = `EMITENTE: A EMPRESA (por seu representante legal)

DADOS DA EMPRESA:
${company.razaoSocial} | CNPJ: ${company.cnpj}
${company.qualification || ''}

DADOS DO RESPONSÁVEL TÉCNICO VINCULADO:
${company.technicalQualification || 'Nenhum profissional técnico cadastrado.'}`;
        }

        // ── Step 6: Montar prompt v3 ──
        const editalContext = bidding.aiAnalysis?.schemaV2
            ? buildModuleContext(bidding.aiAnalysis.schemaV2, 'declaration')
            : (bidding.aiAnalysis?.fullSummary || bidding.summary || '').substring(0, 3500);

        // Extrair cláusula exata do edital (declaration_routes)
        const oo = (schema as any)?.operational_outputs;
        let editalClause: string | undefined;
        if (oo?.declaration_routes?.length > 0) {
            const matchEntry = oo.declaration_routes.find((d: any) => {
                const name = typeof d === 'string' ? d : (d.name || d.title || '');
                return name.toLowerCase().includes(declarationType.toLowerCase().substring(0, 15))
                    || declarationType.toLowerCase().includes(name.toLowerCase().substring(0, 15));
            });
            if (matchEntry) {
                editalClause = typeof matchEntry === 'string' ? matchEntry : (matchEntry.name || matchEntry.title || undefined);
            }
        }

        const prompt = buildDeclarationPrompt(facts, family, familyContext, editalContext, issuerBlock, customPrompt, isTechnical, style, editalClause);

        if (!genAI) {
            return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });
        }

        // ── Step 7: Chamar IA ──
        logger.info(`[Declaration v5] Step 7: Calling Gemini (attempt 1)...`);
        const result = await callGeminiWithRetry(genAI.models, {
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
                temperature: 0.3,
                maxOutputTokens: 4096,
                systemInstruction: DECLARATION_SYSTEM_PROMPT
            }
        }, 3, { tenantId: req.user.tenantId, operation: 'generate_declaration', metadata: { docType: 'declaration' } });

        // ── Step 8: Parser + Sanitize (modular) ──
        const rawResponse = (result.text || '').trim();
        const parsed = parseDeclaration(rawResponse);
        if (!parsed || !parsed.text) {
            return res.status(500).json({ error: 'Falha ao interpretar resposta da IA. Tente novamente.' });
        }

        let finalText = parsed.text;
        let finalTitle = parsed.title || declarationType.substring(0, 50);

        // ── Step 8.5: Title validation & auto-fix (v8) ──
        const titleResult = validateAndFixTitle(finalTitle, declarationType);
        if (titleResult.fixed) {
            logger.info(`[Declaration v8] Title fixed: "${finalTitle}" → "${titleResult.title}"`);
            finalTitle = titleResult.title;
        }

        // ── Step 9: Validação pós-geração ──
        logger.info(`[Declaration v8] Step 9: Validating...`);
        let issues = validateDeclaration(finalText, facts);

        // Adicionar issue de título se houver
        if (titleResult.issue) issues.push(titleResult.issue);

        let corrections: string[] = [];
        if (titleResult.correction) corrections.push(titleResult.correction);

        let attempts = 1;

        // ── Step 10: Repair automático via IA (se critical) ──
        if (hasCriticalIssues(issues)) {
            logger.info(`[Declaration v5] Step 10: ${issues.filter(i => i.severity === 'critical').length} critical issues. Repair via IA...`);
            attempts = 2;

            const aiCallFn = createGeminiRepairFn(genAI.models, callGeminiWithRetry, 'gemini-2.5-flash', { tenantId: req.user.tenantId, operation: 'repair_declaration', metadata: { docType: 'declaration' } });
            const repair = await repairDeclaration(
                finalText, finalTitle, issues, facts,
                validateDeclaration, aiCallFn,
            );

            if (repair.improved) {
                finalText = repair.text;
                finalTitle = repair.title;
                issues = repair.issuesAfterRepair;
                corrections = repair.corrections;
            }
        }

        // ── Step 11/12: Quality Report + Resposta ──
        const qualityReport = calculateQualityReport(issues, corrections, family, attempts);
        logger.info(`[Declaration v5] ${summarizeReport(qualityReport)}`);

        if (qualityReport.grade === 'D' && qualityReport.contaminationDetected) {
            return res.json({
                text: finalText,
                title: finalTitle,
                quality: qualityReport,
                warning: 'Qualidade insuficiente. A declaração contém erros factuais que não puderam ser corrigidos automaticamente. Revise manualmente.',
            });
        }

        res.json({
            text: finalText,
            title: finalTitle,
            quality: qualityReport,
        });

    } catch (error: any) {
        logger.error("[Declaration v5] Fatal error:", error);
        handleApiError(res, error, 'generate-declaration');
    }
});
// ── Internal: Reset + Scan (for admin/worker use without JWT) ──

// ═══════════════════════════════════════════
// Declaration Helper Functions (extracted from index.ts)
// ═══════════════════════════════════════════
// MÓDULO DECLARAÇÕES IA v5 — Gerador Juridicamente Confiável
// Fluxo-alvo: 12 etapas com validação + repair IA + re-validação
// Tipos: AuthoritativeFacts, DeclarationFamily → importados de services/ai/declaration
// ═══════════════════════════════════════════════════════════════
// ── Step 4: Classificação por Família ──

function classifyFamily(declarationType: string): DeclarationFamily {
    const lower = declarationType.toLowerCase();

    // TECHNICAL_PERSONAL — pessoal técnico, equipe, RT
    if (lower.includes('técnic') || lower.includes('equipe') ||
        lower.includes('pessoal') || lower.includes('engenhei') ||
        lower.includes('crea') || lower.includes('cau') ||
        lower.includes('responsável técnico') || lower.includes('indicação'))
        return 'TECHNICAL_PERSONAL';

    // CORPORATE_STATUS — enquadramento, ME/EPP, regularidade fiscal, econômica
    if (lower.includes('me/epp') || lower.includes('microempresa') ||
        lower.includes('pequeno porte') || lower.includes('enquadramento') ||
        lower.includes('econômic') || lower.includes('financei') ||
        lower.includes('patrimônio') || lower.includes('balanço') ||
        lower.includes('fiscal') || lower.includes('tribut') ||
        lower.includes('fgts') || lower.includes('inss') ||
        lower.includes('fazenda') || lower.includes('débito') ||
        lower.includes('falência') || lower.includes('recuperação judicial'))
        return 'CORPORATE_STATUS';

    // OPERATIONAL_COMMITMENT — compromissos operacionais
    if (lower.includes('visita') || lower.includes('disponibilidade') ||
        lower.includes('equipamento') || lower.includes('prazo') ||
        lower.includes('elaboração independente') || lower.includes('conhecimento') ||
        lower.includes('atestado') || lower.includes('vistoria'))
        return 'OPERATIONAL_COMMITMENT';

    // SIMPLE_COMPLIANCE — conformidade legal simples
    if (lower.includes('menor') || lower.includes('trabalho infantil') ||
        lower.includes('art. 7') || lower.includes('xxxiii') ||
        lower.includes('fato impeditivo') || lower.includes('idoneidade') ||
        lower.includes('nepotismo') || lower.includes('impedimento') ||
        lower.includes('vedação') || lower.includes('proibição') ||
        lower.includes('inexistência'))
        return 'SIMPLE_COMPLIANCE';

    return 'CUSTOM_GENERIC';
}

// ── Step 5: Contexto Específico do Edital ──

function extractFamilyContext(family: DeclarationFamily, schema: any): string {
    if (!schema) return '';
    const sections: string[] = [];
    const qi = schema?.qualification_requirements || schema?.requirements;
    const oo = schema?.operational_outputs;
    const pi = schema?.process_identification;
    const pc = schema?.participation_conditions;

    switch (family) {
        case 'SIMPLE_COMPLIANCE':
            if (pc) sections.push(`CONDIÇÕES DE PARTICIPAÇÃO:\n${JSON.stringify(pc, null, 1)}`);
            if (pi?.objeto) sections.push(`OBJETO: ${pi.objeto_completo || pi.objeto_resumido || pi.objeto}`);
            break;

        case 'OPERATIONAL_COMMITMENT':
            if (pi?.objeto) sections.push(`OBJETO: ${pi.objeto_completo || pi.objeto_resumido || pi.objeto}`);
            if (pc?.exige_visita_tecnica) sections.push(`VISITA TÉCNICA: ${pc.visita_tecnica_detalhes || 'Exigida'}`);
            if (pc?.exige_garantia_proposta) sections.push(`GARANTIA PROPOSTA: ${pc.garantia_proposta_detalhes || 'Exigida'}`);
            if (pc?.exige_garantia_contratual) sections.push(`GARANTIA CONTRATUAL: ${pc.garantia_contratual_detalhes || 'Exigida'}`);
            if (oo?.declaration_routes?.length > 0) {
                sections.push('DECLARAÇÕES PREVISTAS:\n' + oo.declaration_routes.map(
                    (d: any) => `  • ${typeof d === 'string' ? d : d.name || d.title || JSON.stringify(d)}`
                ).join('\n'));
            }
            break;

        case 'TECHNICAL_PERSONAL':
            if (qi?.qualificacao_tecnica_profissional) sections.push(`QUALIFICAÇÃO TÉCNICA PROFISSIONAL:\n${JSON.stringify(qi.qualificacao_tecnica_profissional, null, 1)}`);
            if (qi?.qualificacao_tecnica_operacional) sections.push(`QUALIFICAÇÃO TÉCNICA OPERACIONAL:\n${JSON.stringify(qi.qualificacao_tecnica_operacional, null, 1)}`);
            if (qi?.qualificacao_tecnica) sections.push(`QUALIFICAÇÃO TÉCNICA:\n${JSON.stringify(qi.qualificacao_tecnica, null, 1)}`);
            if (oo?.technical_requirements) sections.push(`REQUISITOS TÉCNICOS:\n${JSON.stringify(oo.technical_requirements, null, 1)}`);
            break;

        case 'CORPORATE_STATUS':
            if (qi?.habilitacao_juridica) sections.push(`HABILITAÇÃO JURÍDICA:\n${JSON.stringify(qi.habilitacao_juridica, null, 1)}`);
            if (qi?.regularidade_fiscal_trabalhista) sections.push(`REGULARIDADE FISCAL:\n${JSON.stringify(qi.regularidade_fiscal_trabalhista, null, 1)}`);
            if (qi?.regularidade_fiscal) sections.push(`REGULARIDADE FISCAL:\n${JSON.stringify(qi.regularidade_fiscal, null, 1)}`);
            if (qi?.qualificacao_economico_financeira) sections.push(`QUALIFICAÇÃO ECONÔMICO-FINANCEIRA:\n${JSON.stringify(qi.qualificacao_economico_financeira, null, 1)}`);
            if (qi?.qualificacao_economica) sections.push(`QUALIFICAÇÃO ECONÔMICA:\n${JSON.stringify(qi.qualificacao_economica, null, 1)}`);
            if (pc?.tratamento_me_epp) sections.push(`TRATAMENTO ME/EPP: ${pc.tratamento_me_epp}`);
            break;

        default: // CUSTOM_GENERIC
            if (oo?.declaration_routes?.length > 0) {
                sections.push('DECLARAÇÕES PREVISTAS NO EDITAL:\n' + oo.declaration_routes.map(
                    (d: any) => `  • ${typeof d === 'string' ? d : d.name || d.title || JSON.stringify(d)}`
                ).join('\n'));
            }
    }

    return sections.length > 0 ? sections.join('\n\n') : '';
}

// ── Step 6: Prompt Builder ──

function buildDeclarationPrompt(
    facts: AuthoritativeFacts,
    family: DeclarationFamily,
    familyContext: string,
    editalContext: string,
    issuerBlock: string,
    customPrompt: string | undefined,
    isTechnical: boolean,
    style: DeclarationStyle = 'objetiva',
    editalClause?: string,
): string {
    // Buscar mapa semântico que corresponde ao tipo da declaração
    const declLower = facts.declarationType.toLowerCase();
    const semanticMatch = DECLARATION_SEMANTIC_MAP.find(m =>
        m.keywords.some(kw => declLower.includes(kw.toLowerCase()))
    );

    return `Você é um Advogado Sênior especializado em Direito Administrativo e Contratações Públicas (Lei 14.133/2021).
Sua tarefa é redigir a declaração abaixo com RIGOR JURÍDICO MÁXIMO e ABSOLUTA FIDELIDADE FACTUAL.

TIPO: "${facts.declarationType}"
FAMÍLIA: ${family}

${issuerBlock}

╔══════════════════════════════════════════════════════════════╗
║  FATOS AUTORITATIVOS — IMUTÁVEIS (PREVALÊNCIA ABSOLUTA)     ║
╠══════════════════════════════════════════════════════════════╣
║  Empresa: ${facts.empresaRazaoSocial}
║  CNPJ: ${facts.empresaCnpj}
║  QUALIFICAÇÃO COMPLETA (transcrever LITERALMENTE como abertura da declaração):
║  ${facts.qualificacaoCompleta || `${facts.empresaRazaoSocial}, inscrita no CNPJ sob o nº ${facts.empresaCnpj}${facts.empresaEndereco ? `, com sede ${facts.empresaEndereco}` : ''}${facts.representanteNome ? `, neste ato representada por seu ${facts.representanteCargo || 'Representante Legal'} ${facts.representanteNome}${facts.representanteCpf ? `, CPF ${facts.representanteCpf}` : ''}` : ''}`}
║  Órgão: ${facts.orgaoLicitante}
║  Modalidade: ${facts.modalidade}
║  Edital nº: ${facts.editalNumero || 'Não identificado'}
║  Processo nº: ${facts.processoNumero || 'Não identificado'}
║  Objeto: ${facts.objeto || 'Conforme edital'}
║  Título: ${facts.biddingTitle}
╚══════════════════════════════════════════════════════════════╝

REGRA ABSOLUTA: Os dados acima são a ÚNICA fonte válida para identificação. QUALQUER dado divergente no resumo abaixo DEVE SER IGNORADO.
${facts.hasDivergence ? `\n⚠️ CONTAMINAÇÃO DETECTADA: O resumo contém referências a "${facts.orgaoFromSchema}" de OUTRO certame. USE EXCLUSIVAMENTE "${facts.orgaoLicitante}".` : ''}
${familyContext ? `\nCONTEXTO ESPECÍFICO (${family}):\n${familyContext}\n` : ''}
RESUMO AUXILIAR (APENAS para conteúdo jurídico — NÃO para identificação):
${editalContext}

INSTRUÇÕES RÍGIDAS:

1. FIDELIDADE: Se o edital impuser texto específico para "${facts.declarationType}", transcreva-o integralmente.

2. EXTENSÃO (${(() => { const c = FAMILY_LENGTH_CONSTRAINTS[family]; return `${c.minParagraphs} a ${c.maxParagraphs} parágrafos — ${c.styleHint}`; })()}):
   Estrutura recomendada:
   a) QUALIFICAÇÃO COMPLETA (REGRA INVIOLÁVEL): Transcreva LITERALMENTE o texto da QUALIFICAÇÃO COMPLETA dos Fatos Autoritativos acima como parágrafo de abertura. NÃO resuma. NÃO omita campos. Inclua TODOS os dados pessoais do representante (nacionalidade, estado civil, profissão, nascimento, CPF, RG, endereço comercial).
   b) REFERÊNCIA: "${facts.orgaoLicitante}", Edital nº "${facts.editalNumero}", Processo nº "${facts.processoNumero}"
   c) DECLARAÇÃO PRINCIPAL: fundamento legal pertinente
   d) CIÊNCIA DAS SANÇÕES + FECHO FORMAL
   Para ${family === 'SIMPLE_COMPLIANCE' ? 'esta família, os blocos a) e b) PODEM ser fundidos em 1 parágrafo. NÃO desdobre artificialmente.' : 'famílias complexas, use parágrafos separados.'}${ family === 'SIMPLE_COMPLIANCE' ? '\n   REGRA ANTI-PROLIXIDADE: NÃO descreva o objeto, NÃO recontar histórico, NÃO multiplique compromissos além do necessário.' : ''}

3. NOMES: Transcreva EXATAMENTE como nos FATOS AUTORITATIVOS. NUNCA abrevie, NUNCA invente dados.

4. SEM PLACEHOLDERS: NÃO use [NOME], [CNPJ] etc. Use os dados reais fornecidos acima. Colchetes APENAS para dados opcionais ausentes.
${facts.representanteNome ? '' : '\n   EXCEÇÃO: O nome do representante não foi fornecido. Use colchetes: [Nome do Representante Legal]'}

5. EQUIPE TÉCNICA: ${family === 'TECHNICAL_PERSONAL' ? 'Cite NOMINALMENTE os dados do RT fornecidos acima.' : 'N/A para este tipo.'}

${customPrompt ? `6. INSTRUÇÃO DO USUÁRIO: ${customPrompt}\n` : ''}
${(() => {
    const styleDirectives: Record<DeclarationStyle, string> = {
        objetiva: '7. ESTILO: OBJETIVA — Vá direto ao ponto. Sem contextualização do objeto. Sem histórico do processo. Mínimo de parágrafos possível dentro do range da família.',
        formal: '7. ESTILO: FORMAL — Linguagem jurídica completa com todos os blocos. Use extensão moderada.',
        robusta: '7. ESTILO: ROBUSTA — Texto detalhado com referências extensas, compromissos explícitos e fundamentação legal ampla.',
    };
    return styleDirectives[style] || styleDirectives.objetiva;
})()}

${editalClause ? `8. CLÁUSULA DO EDITAL (PRIORIDADE MÁXIMA):
   Nome exato da exigência: "${editalClause}"
   USE este nome LITERALMENTE como título ("title") se for um nome de declaração válido.
   O núcleo declaratório DEVE aderir ao teor exato desta cláusula.\n` : ''}
${semanticMatch ? `9. ORIENTAÇÃO DE TÍTULO: ${semanticMatch.titleGuidance}

10. COBERTURA SEMÂNTICA EXIGIDA (o núcleo declaratório DEVE cobrir TODOS estes conceitos):
    ${semanticMatch.coreConceptsMustCover}\n` : ''}
11. ANTI-GENERICISMO: EVITE frases ornamentais como: ${ANTI_GENERIC_PHRASES.slice(0, 3).map(p => `"${p}"`).join(', ')}. Prefira linguagem seca e assertiva.

12. FORMATO JSON PURO:
   { "title": "DECLARAÇÃO DE ...", "text": "A empresa ..." }
   - SEM blocos markdown. SEM negritos. SEM ${'```'}.
   - O "text" começa com qualificação: "${isTechnical ? 'Eu, [Nome], [profissão], inscrito no CREA/CAU..., DECLARO...' : `A empresa ${facts.empresaRazaoSocial}, inscrita no CNPJ sob nº ${facts.empresaCnpj}...DECLARA...`}"
   - NÃO inclua Local, Data, Assinatura — o sistema adiciona.

13. CITAÇÃO EXPLÍCITA: Use "${facts.orgaoLicitante}" e "${facts.editalNumero || facts.processoNumero}". NUNCA use genéricos.`;
}

// ── Step 8-12: Agora modularizados em services/ai/declaration/ ──

// ── Helpers (qualification parsing — será movido para declarationFacts.ts) ──

function extractFromQualification(qualification: string, field: 'address' | 'name' | 'cpf' | 'cargo'): string {
    if (!qualification) return '';
    switch (field) {
        case 'address': {
            const match = qualification.match(/sediada\s+(?:na|no|em)\s+(.+?)(?:,\s*neste\s+ato|,\s*inscrita|$)/i);
            return match?.[1]?.trim() || '';
        }
        case 'name': {
            const match = qualification.match(/representada\s+por\s+(?:seu\s+)?(?:Sócio\s+Administrador|representante\s+legal\s+)?(?:,\s*)?(?:a\s+Sra\.\s+|o\s+Sr\.\s+)?([^,.(0-9]{3,60})(?=\s*,\s*|,\s*brasileir|,\s*solteir|$)/i);
            return match?.[1]?.trim() || '';
        }
        case 'cpf': {
            const match = qualification.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/);
            return match?.[0] || '';
        }
        case 'cargo': {
            const match = qualification.match(/(Sócio[\s-]?Administrador|Representante\s+Legal|Diretor|Gerente|Procurador|Sócio|Administrador)/i);
            return match?.[1]?.trim() || 'Representante Legal';
        }
    }
}

export default router;
