import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { prisma } from '../../db';

const bdiSchema = z.object({
    found: z.boolean().describe("Se a tabela detalhada de BDI foi encontrada no edital."),
    globalBdi: z.number().optional().describe("O valor do BDI Global (em percentual)."),
    tcu: z.object({
        adminCentral: z.number().default(4.00),
        seguros: z.number().default(0.80),
        garantias: z.number().default(0.80),
        riscos: z.number().default(0.97),
        despFinanceiras: z.number().default(0.59),
        lucro: z.number().default(6.16),
        tributos: z.number().default(5.65),
    }).optional().describe("Os parâmetros detalhados do BDI. Só preencha se encontrar os valores específicos."),
});

export async function extractBdiFromBidding(biddingId: string): Promise<z.infer<typeof bdiSchema> | null> {
    const bidding = await prisma.biddingProcess.findUnique({
        where: { id: biddingId },
        include: { aiAnalysis: true }
    });

    if (!bidding || !bidding.aiAnalysis?.fullEditalText) {
        throw new Error('Texto do edital não disponível para extração de BDI.');
    }

    const text = bidding.aiAnalysis.fullEditalText;
    const chunk = text.substring(0, 150000); // Send up to 150k chars of the text

    const { object } = await generateObject({
        model: google('gemini-2.5-pro'),
        schema: bdiSchema,
        prompt: `Você é um engenheiro orçamentista analisando um edital de licitação pública.
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
Retorne apenas os números (sem o símbolo de %).`
    });

    return object;
}
