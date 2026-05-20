import { GoogleGenAI } from '@google/genai';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { ENGINEERING_PROPOSAL_SYSTEM_PROMPT } from '../modules/prompts/engineeringPromptV1';
import { parseAndNormalizeEngineeringExtraction } from '../../engineering/resultNormalizer';
import { enrichWithOfficialPrices } from '../../engineering/priceEnricher';
import { fallbackToOpenAiV2 } from '../openai.service';

export async function extractItemsFromImage(
    fileBuffer: Buffer,
    mimeType: string,
    engineeringConfig: any,
    tenantId: string
) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');

    const genAI = new GoogleGenAI({ apiKey });
    const { callGeminiWithRetry } = require('../gemini.service');

    const userPrompt = `Extraia todos os itens da planilha orçamentária que estão visíveis na imagem fornecida. 
Certifique-se de extrair as etapas, subetapas e composições com seus respectivos números de item (i), códigos (c), descrições (d), unidades (u), quantidades (q), custos unitários s/ BDI (uc), preços unitários c/ BDI (up) e preços totais (tp) de forma precisa. 
Lembre-se de retornar APENAS o JSON válido no formato de chaves curtas especificado no prompt do sistema:
{
  "engineeringItems": [
    { "i": "1", "t": "ETAPA", "s": "", "c": "", "d": "SERVIÇOS PRELIMINARES", "u": "", "q": 0, "uc": 0, "up": 0, "tp": 10000.00 },
    ...
  ]
}`;

    let text: string;
    try {
        const response = await callGeminiWithRetry(
            genAI.models,
            {
                model: 'gemini-2.5-flash',
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { inlineData: { data: fileBuffer.toString('base64'), mimeType } },
                            { text: userPrompt }
                        ]
                    }
                ],
                config: {
                    systemInstruction: ENGINEERING_PROPOSAL_SYSTEM_PROMPT,
                    responseMimeType: 'application/json',
                    temperature: 0.1
                }
            },
            3 // retries
        );
        text = response.text || '';
    } catch (geminiErr: any) {
        logger.warn(`[AI Extract Budget Items Image] Gemini falhou: ${geminiErr.message}. Tentando fallback...`);
        const fallback = await fallbackToOpenAiV2({
            systemPrompt: ENGINEERING_PROPOSAL_SYSTEM_PROMPT,
            userPrompt: userPrompt,
            temperature: 0.1,
            maxTokens: 16384,
            stageName: 'Budget Items Image Extraction',
        });
        text = fallback.text;
    }

    if (!text) throw new Error('Resposta vazia da IA');
    logger.info(`[AI Extract Budget Items Image] Raw response length: ${text.length}`);

    const normalized = parseAndNormalizeEngineeringExtraction(text);
    const items = normalized.engineeringItems || [];

    // Auto-lookup for prices against registered databases
    if (items.length > 0) {
        await enrichWithOfficialPrices(items, engineeringConfig, { tenantId });
    }

    return {
        items,
        count: items.length
    };
}
