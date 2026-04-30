import { GoogleGenAI, Type } from '@google/genai';
import { prisma } from '../../db';

export async function extractBdiFromBidding(biddingId: string): Promise<any | null> {
    const bidding = await prisma.biddingProcess.findUnique({
        where: { id: biddingId },
        include: { aiAnalysis: true }
    });

    if (!bidding || !bidding.aiAnalysis?.fullEditalText) {
        throw new Error('Texto do edital não disponível para extração de BDI.');
    }

    const text = bidding.aiAnalysis.fullEditalText;
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
