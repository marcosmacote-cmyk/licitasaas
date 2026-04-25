import { GoogleGenAI } from '@google/genai';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const systemPrompt = `Você é um engenheiro orçamentista expert em leitura de composições de custos (CPUs).
Seu trabalho é ler a imagem/pdf fornecida, identificar a tabela de insumos e extrair os dados ESTRITAMENTE neste schema JSON:
{
  "code": "string opcional (se houver código da composição)",
  "description": "string (descrição do serviço principal)",
  "unit": "string (unidade de medida, ex: UN, M2, M3, H)",
  "items": [
    {
      "type": "MATERIAL" | "MAO_DE_OBRA" | "EQUIPAMENTO" | "SERVICO" | "AUXILIAR",
      "code": "string opcional (código do insumo)",
      "description": "string (descrição do insumo)",
      "unit": "string",
      "coefficient": number,
      "price": number
    }
  ]
}

REGRAS:
1. "coefficient" e "price" DEVEM ser números (use ponto para decimais, ex: 1.5 e não 1,5).
2. Se o preço não for legível, coloque 0.
3. Se não houver tipo claro, tente deduzir pelo nome (ex: "Servente" -> MAO_DE_OBRA, "Cimento" -> MATERIAL, "Caminhão" -> EQUIPAMENTO, "Concreto Usinado" -> AUXILIAR).
4. Retorne APENAS o JSON, sem formatação Markdown.`;

export async function extractCompositionFromImage(fileBuffer: Buffer, mimeType: string, expectedCode?: string) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');

    const genAI = new GoogleGenAI({ apiKey });
    
    // Using gemini-1.5-pro for better table extraction
    const response = await genAI.models.generateContent({
        model: 'gemini-1.5-pro',
        contents: [
            { role: 'user', parts: [
                { inlineData: { data: fileBuffer.toString('base64'), mimeType } },
                { text: `Extraia a composição da imagem.` + (expectedCode ? ` Se possível, foque no item com código ou descrição similar a ${expectedCode}.` : '') }
            ]}
        ],
        config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
            temperature: 0.1
        }
    });

    const text = response.text();
    if (!text) throw new Error('Resposta vazia da IA');

    let extracted: any;
    try {
        extracted = JSON.parse(text);
    } catch (e) {
        throw new Error('Falha ao parsear o JSON retornado pela IA');
    }

    // Now Semantic Match against active DB
    const itemsWithMatches = [];
    
    for (const item of extracted.items || []) {
        let match = null;
        
        // 1. Try exact code match if available
        if (item.code) {
            match = await prisma.engineeringItem.findFirst({
                where: { code: item.code }
            });
            if (!match && item.type === 'AUXILIAR') {
                match = await prisma.engineeringComposition.findFirst({
                    where: { code: item.code }
                });
            }
        }
        
        // 2. Try simple FTS or ILIKE on description
        if (!match && item.description) {
            const query = item.description.substring(0, 30); // Use first 30 chars for looser match
            if (item.type === 'AUXILIAR') {
                match = await prisma.engineeringComposition.findFirst({
                    where: { description: { contains: query, mode: 'insensitive' } }
                });
            } else {
                match = await prisma.engineeringItem.findFirst({
                    where: { description: { contains: query, mode: 'insensitive' } }
                });
            }
        }

        // Convert the schema to what CompositionEditor expects (which is the DB schema shape)
        const enrichedItem = {
            id: `temp-${Date.now()}-${Math.random()}`,
            coefficient: item.coefficient || 1,
            price: item.price || 0,
            item: item.type !== 'AUXILIAR' ? {
                id: match ? match.id : `new-${Date.now()}`,
                code: match ? match.code : (item.code || 'NOVO'),
                description: match ? match.description : item.description,
                unit: match ? match.unit : item.unit,
                type: item.type,
                price: item.price || (match as any)?.price || 0,
                isNew: !match
            } : undefined,
            auxiliaryComposition: item.type === 'AUXILIAR' ? {
                id: match ? match.id : `new-aux-${Date.now()}`,
                code: match ? match.code : (item.code || 'NOVO'),
                description: match ? match.description : item.description,
                unit: match ? match.unit : item.unit,
                totalPrice: item.price || (match as any)?.totalPrice || 0,
                isNew: !match
            } : undefined,
            _ai_confidence: match ? 'high' : 'low'
        };

        itemsWithMatches.push(enrichedItem);
    }

    // Group items for CompositionEditor
    const groups: Record<string, any[]> = { MATERIAL: [], MAO_DE_OBRA: [], EQUIPAMENTO: [], SERVICO: [], AUXILIAR: [] };
    for (const ci of itemsWithMatches) {
        if (ci.auxiliaryComposition) {
            groups.AUXILIAR.push(ci);
        } else if (ci.item) {
            const type = ci.item.type || 'MATERIAL';
            if (!groups[type]) groups[type] = [];
            groups[type].push(ci);
        }
    }

    return {
        id: `temp-comp-${Date.now()}`,
        code: extracted.code || expectedCode || 'NOVO',
        description: extracted.description || 'Composição Extraída via IA',
        unit: extracted.unit || 'UN',
        totalPrice: itemsWithMatches.reduce((s, ci) => s + (ci.price || 0) * (ci.coefficient || 1), 0),
        items: itemsWithMatches,
        groups
    };
}
