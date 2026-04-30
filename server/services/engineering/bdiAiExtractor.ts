import { GoogleGenAI, Type } from '@google/genai';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function extractBdiFromBidding(biddingId: string): Promise<any | null> {
    let text = '';

    // Tier 1: DocumentChunks (best quality — full edital text)
    const chunks = await prisma.documentChunk.findMany({
        where: { biddingProcessId: biddingId },
        orderBy: { id: 'asc' }
    });

    if (chunks && chunks.length > 0) {
        text = chunks.map(c => c.content).join('\n\n');
    }

    // Tier 2: AiAnalysis fields (fallback when RAG indexing hasn't run)
    if (!text || text.length < 200) {
        const bidding = await prisma.biddingProcess.findUnique({
            where: { id: biddingId },
            include: { aiAnalysis: true }
        });

        if (bidding?.aiAnalysis) {
            const parts: string[] = [];
            const a = bidding.aiAnalysis;
            if (a.fullSummary) parts.push(a.fullSummary);
            if (a.biddingItems) parts.push(a.biddingItems);
            if (a.pricingConsiderations) parts.push(a.pricingConsiderations);
            if (a.requiredDocuments) parts.push(a.requiredDocuments);
            // schemaV2 may contain structured pricing data
            const schemaV2 = a.schemaV2 as any;
            if (schemaV2?.proposal_analysis) {
                parts.push('DADOS ESTRUTURADOS:\n' + JSON.stringify(schemaV2.proposal_analysis, null, 2));
            }
            text = parts.join('\n\n---\n\n');
        }
    }

    // Tier 3: No text available at all
    if (!text || text.length < 100) {
        throw new Error('Texto do edital não disponível. Analise o edital primeiro para extrair o BDI.');
    }

    const chunk = text.substring(0, 150000); // Send up to 150k chars of the text

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: `Você é um engenheiro orçamentista analisando um edital de licitação pública.
Seu objetivo é encontrar a composição da taxa de BDI (Benefícios e Despesas Indiretas) exigida pelo edital.
Procure por tabelas de BDI, LDI, ou referências ao Acórdão TCU 2622/2013.

TEXTO DO EDITAL:
${chunk}

Extraia os percentuais (%) para cada um dos seguintes itens (se disponíveis):
- Administração Central
- Seguros
- Garantias
- Riscos
- Despesas Financeiras
- Lucro / Remuneração
- Tributos (PIS, COFINS, ISS, CPRB)

Se não houver tabela detalhada, mas houver o BDI Global, informe apenas o global.
Retorne apenas os números (sem o símbolo de %).`,
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    found: { type: Type.BOOLEAN, description: 'Se a tabela detalhada de BDI foi encontrada no edital.' },
                    globalBdi: { type: Type.NUMBER, description: 'O valor do BDI Global (em percentual).', nullable: true },
                    tcu: {
                        type: Type.OBJECT,
                        nullable: true,
                        description: 'Os parâmetros detalhados do BDI. Só preencha se encontrar os valores específicos.',
                        properties: {
                            adminCentral: { type: Type.NUMBER },
                            seguros: { type: Type.NUMBER },
                            garantias: { type: Type.NUMBER },
                            riscos: { type: Type.NUMBER },
                            despFinanceiras: { type: Type.NUMBER },
                            lucro: { type: Type.NUMBER },
                            tributos: { type: Type.NUMBER },
                        }
                    }
                },
                required: ['found']
            }
        }
    });

    if (!response.text) return null;
    try {
        return JSON.parse(response.text);
    } catch {
        return null;
    }
}
