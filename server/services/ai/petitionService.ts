import { GoogleGenAI } from '@google/genai';
import prisma from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { callGeminiWithRetry, GEMINI_PROFILES } from './gemini.service';
import { buildModuleContext } from './modules/moduleContextContracts';
import { PETITION_SYSTEM_PROMPT, PETITION_USER_INSTRUCTION } from './modules/prompts/petitionPromptV2';

export interface GeneratePetitionParams {
    biddingProcessId: string;
    companyId: string;
    templateType: string;
    userContext: string;
    attachments?: { name: string; data: string; mimeType: string }[];
    tenantId: string;
}

/**
 * Service to generate administrative petitions using Gemini Pro and Prompt V2.1.
 */
export async function generatePetitionService(params: GeneratePetitionParams): Promise<{ text: string }> {
    const { biddingProcessId, companyId, templateType, userContext, attachments, tenantId } = params;

    logger.info(`[PetitionService] Initiating petition generation (type=${templateType}) for process=${biddingProcessId} and tenant=${tenantId}`);

    const bidding = await prisma.biddingProcess.findUnique({
        where: { id: biddingProcessId, tenantId },
        include: { aiAnalysis: true }
    });

    const company = await prisma.companyProfile.findUnique({
        where: { id: companyId, tenantId }
    });

    if (!bidding || !company) {
        throw new Error('Processo licitatório ou Empresa não encontrados.');
    }

    if (!userContext && (!attachments || attachments.length === 0)) {
        throw new Error('Por favor, descreva os fatos ou anexe documentos de base.');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured in the environment');
    }

    const ai = new GoogleGenAI({ apiKey });
    const aiAnalysis = bidding.aiAnalysis;

    let biddingAnalysisText = 'Nenhuma análise detalhada disponível.';
    if (aiAnalysis) {
        if (aiAnalysis.schemaV2) {
            biddingAnalysisText = `
${buildModuleContext(aiAnalysis.schemaV2, 'petition')}

Resumo Executivo: ${aiAnalysis.fullSummary || 'N/A'}
`.trim();
            logger.info(`[PetitionService] Loaded structured context via buildModuleContext('petition')`);
        } else {
            biddingAnalysisText = `
Resumo do Edital (Card): ${bidding.summary || 'Não disponível'}
Parecer Técnico-Jurídico Profundo: ${aiAnalysis.fullSummary || 'Não disponível'}
Documentos Exigidos: ${typeof aiAnalysis.requiredDocuments === 'string' ? aiAnalysis.requiredDocuments : JSON.stringify(aiAnalysis.requiredDocuments)}
Itens e Lotes: ${aiAnalysis.biddingItems || 'Não disponível'}
Exigências de Qualificação Técnica (LITERAL): ${aiAnalysis.qualificationRequirements || 'Não disponível'}
Prazos e Datas Críticas: ${typeof aiAnalysis.deadlines === 'string' ? aiAnalysis.deadlines : JSON.stringify(aiAnalysis.deadlines)}
Considerações de Preço: ${aiAnalysis.pricingConsiderations || 'Não disponível'}
Alertas e Irregularidades: ${typeof aiAnalysis.irregularitiesFlags === 'string' ? aiAnalysis.irregularitiesFlags : JSON.stringify(aiAnalysis.irregularitiesFlags)}
Penalidades: ${aiAnalysis.penalties || 'Não disponível'}
`.trim();
            logger.info(`[PetitionService] Loaded legacy V1 context fields`);
        }
    }

    const currentDateStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const repName = company.contactName || '[Nome do Representante]';
    const repCpf = company.contactCpf || '[CPF]';
    const cleanCity = (company.city || '[Cidade]').split('/')[0].trim();
    const companyState = (company.state || '[UF]').toUpperCase().trim();
    const fullBiddingObject = bidding.summary || bidding.title;

    // Enriquecer a instrução de sistema V2.1 com regras de identificação do objeto e bloco de assinaturas
    const formattedSystemPrompt = `${PETITION_SYSTEM_PROMPT}

═══ ESTRUTURA E ASSINATURA OBRIGATÓRIA (REQUISITOS DO SISTEMA) ═══

1. OBJETO DO PROCESSO: Logo após a qualificação da Recorrente, inclua obrigatoriamente uma linha isolada e em negrito exatamente assim:
"**OBJETO: {fullBiddingObject}**"

2. ASSINATURA E LOCAL: A peça deve finalizar obrigatoriamente com o bloco abaixo. 
Você DEVE envolver este bloco final pelas tags [INICIO_ASSINATURA] e [FIM_ASSINATURA]. Não coloque linhas em branco adicionais entre o nome do representante e a razão social da empresa.

[INICIO_ASSINATURA]
Local ({companyCity}/{companyState}), data ({currentDate})

______________________________________
**{legalRepresentativeName}**
CPF nº: {legalRepresentativeCpf}
Representante Legal
**{companyName}**
CNPJ: {companyCnpj}
[FIM_ASSINATURA]

3. PROIBIÇÃO ABSOLUTA: É terminantemente proibido inserir qualquer citação de Advogado, OAB ou assinaturas jurídicas. A peça administrativa deve ser assinada apenas pelo representante da empresa conforme estrutura acima.`
        .replace(/{currentDate}/g, currentDateStr)
        .replace(/{legalRepresentativeName}/g, repName)
        .replace(/{legalRepresentativeCpf}/g, repCpf)
        .replace(/{companyCity}/g, cleanCity)
        .replace(/{companyState}/g, companyState)
        .replace(/{companyName}/g, company.razaoSocial)
        .replace(/{companyCnpj}/g, company.cnpj)
        .replace(/{fullBiddingObject}/g, fullBiddingObject);

    // Enriquecer a instrução do usuário V2.1 com as informações factuais do processo e o contexto do usuário
    const formattedUserInstruction = `${PETITION_USER_INSTRUCTION}

DADOS DA LICITAÇÃO:
- Objeto (Título Real): ${fullBiddingObject}
- Órgão / Portal: ${bidding.portal} / ${bidding.portal}
- Modalidade: ${bidding.modality}

DADOS DA EMPRESA RECORRENTE:
- Razão Social: ${company.razaoSocial}
- CNPJ: ${company.cnpj}
- Qualificação Completa: ${company.qualification || 'Não informada'}
- Sede: ${cleanCity}/${companyState}
- Representante Legal: ${repName} (CPF: ${repCpf})

CONTEXTO DA ANÁLISE DO EDITAL (DADOS DO SISTEMA):
${biddingAnalysisText}

FATOS E ARGUMENTOS (FORNECIDO PELO USUÁRIO):
${userContext || 'Nenhum contexto factual adicional fornecido pelo usuário.'}

Use todas as informações factuais acima para fundamentar a peça técnica solicitado de forma extremamente precisa.`
        .replace('{petitionType}', templateType.toUpperCase())
        .replace('{targetPoints}', userContext || 'Fatos gerais identificados na análise do edital');

    const parts: any[] = [{ text: formattedUserInstruction }];

    if (attachments && Array.isArray(attachments)) {
        attachments.forEach((att) => {
            if (att.data && att.mimeType) {
                parts.push({
                    inlineData: {
                        data: att.data,
                        mimeType: att.mimeType
                    }
                });
            }
        });
    }

    const result = await callGeminiWithRetry(ai.models, {
        model: GEMINI_PROFILES.HIGH_INTELLIGENCE,
        contents: [
            {
                role: 'user',
                parts: parts
            }
        ],
        config: {
            systemInstruction: formattedSystemPrompt,
            temperature: 0.2,
            maxOutputTokens: 8192
        }
    }, 3, { tenantId, operation: 'petition' });

    return { text: result.text };
}
