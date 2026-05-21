import { GoogleGenAI } from '@google/genai';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { fallbackToOpenAiV2 } from '../openai.service';
import { buildCodeVariants } from '../../engineering/codeNormalizer';

const systemPrompt = `Você é um engenheiro orçamentista expert em leitura de composições de custos (CPUs).
Seu trabalho é ler a imagem/pdf fornecida, identificar a tabela de insumos e extrair os dados ESTRITAMENTE neste schema JSON:
{
  "code": "string opcional (se houver código da composição)",
  "description": "string (descrição do serviço principal)",
  "unit": "string (unidade de medida, ex: UN, M2, M3, H)",
  "items": [
    {
      "type": "MATERIAL" | "MAO_DE_OBRA" | "EQUIPAMENTO" | "SERVICO" | "AUXILIAR",
      "code": "string (código do insumo, OBRIGATÓRIO se visível)",
      "description": "string (descrição do insumo)",
      "unit": "string",
      "coefficient": number,
      "price": number,
      "source": "string opcional (nome da base/fonte se houver coluna FONTE, ex: SINAPI, SEINFRA, ORSE, SICRO)"
    }
  ]
}

REGRAS:
1. "coefficient" e "price" DEVEM ser números (use ponto para decimais, ex: 1.5 e não 1,5). Certifique-se de que "price" é o Preço Unitário e NÃO o Preço Total.
2. Se o preço não for legível, coloque 0.
3. Se não houver tipo claro, tente deduzir pelo nome (ex: "Servente" -> MAO_DE_OBRA, "Cimento" -> MATERIAL, "Caminhão" -> EQUIPAMENTO, "Concreto Usinado" -> AUXILIAR).
4. IMPORTANTE: Se houver coluna "FONTE" ou "BASE" na tabela, extraia o valor (ex: SINAPI, SEINFRA) para o campo "source" de cada item.
5. O campo "code" é CRUCIAL — extraia EXATAMENTE como escrito na imagem (ex: I6519, C4291, 00035272, 102223). Não modifique, não adicione prefixos.
6. Retorne APENAS o JSON, sem formatação Markdown.`;

/**
 * Extract composition from image/PDF and match items against official databases.
 * 
 * Flow:
 * 1. AI extracts structured data from the image (items + codes + source)
 * 2. For each item, try to match by code against official bases
 * 3. Code matching uses buildCodeVariants for robust normalization
 * 4. Database is filtered by engineeringConfig bases when available
 * 5. Returns enriched composition with database references
 */
export async function extractCompositionFromImage(
    fileBuffer: Buffer,
    mimeType: string,
    expectedCode?: string,
    engineeringConfig?: any
) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');

    const genAI = new GoogleGenAI({ apiKey });
    
    const { callGeminiWithRetry } = require('../gemini.service');

    // FIX-05: Try Gemini first, fallback to DeepSeek/OpenAI on failure
    let text: string;
    try {
        const response = await callGeminiWithRetry(
            genAI.models,
            {
                model: 'gemini-2.5-flash',
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
            },
            3 // retries
        );
        text = response.text || '';
    } catch (geminiErr: any) {
        logger.warn(`[AI Extract Composition] Gemini falhou: ${geminiErr.message}. Tentando fallback...`);
        const fallback = await fallbackToOpenAiV2({
            systemPrompt,
            userPrompt: `Extraia a composição.${expectedCode ? ` Foque no item ${expectedCode}.` : ''} Retorne APENAS JSON válido.`,
            temperature: 0.1,
            maxTokens: 8192,
            stageName: 'Composition Extraction',
        });
        text = fallback.text;
    }

    if (!text) throw new Error('Resposta vazia da IA');
    logger.info(`[AI Extract Composition] Raw response length: ${text.length}`);

    let extracted: any;
    try {
        extracted = JSON.parse(text);
    } catch (e) {
        throw new Error('Falha ao parsear o JSON retornado pela IA');
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Resolve configured databases for matching priority
    // ═══════════════════════════════════════════════════════════
    const configuredBases = engineeringConfig?.bases || [];
    const configuredBaseNames = configuredBases.map((b: string) => b.toUpperCase());
    
    // Load configured database IDs for priority matching
    let priorityDbIds: string[] = [];
    if (configuredBaseNames.length > 0) {
        const priorityDbs = await prisma.engineeringDatabase.findMany({
            where: { name: { in: configuredBaseNames } },
            select: { id: true, name: true },
        });
        priorityDbIds = priorityDbs.map(d => d.id);
        logger.info(`[AI Extract Composition] Priority databases: ${priorityDbs.map(d => d.name).join(', ')} (${priorityDbIds.length} IDs)`);
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 3: Match each extracted item against official databases
    // ═══════════════════════════════════════════════════════════
    const itemsWithMatches = [];
    let matchedCount = 0;
    let unmatchedCount = 0;
    
    for (const item of extracted.items || []) {
        // FIX-07: Normalize type from LLM (may return 'auxiliar', 'Auxiliar', etc.)
        const itemType = String(item.type || 'MATERIAL').toUpperCase();
        item.type = itemType;

        // Detect source from AI extraction or from config
        const extractedSource = String(item.source || '').toUpperCase().trim();
        
        let match: any = null;
        let matchedDb: any = null;

        // ── Strategy 1: Code match with variant normalization ──
        if (item.code) {
            const codeVariants = buildCodeVariants(item.code, extractedSource || undefined);
            logger.info(`[AI Match] Item "${item.code}" (${itemType}) → variants: [${codeVariants.join(', ')}] source="${extractedSource}"`);

            if (itemType === 'AUXILIAR') {
                // Match as composition
                const where: any = { code: { in: codeVariants } };
                
                // Prioritize: 1. extracted source, 2. configured bases, 3. any
                if (extractedSource) {
                    where.database = { name: extractedSource };
                } else if (priorityDbIds.length > 0) {
                    where.databaseId = { in: priorityDbIds };
                }
                
                match = await prisma.engineeringComposition.findFirst({
                    where,
                    include: { database: { select: { id: true, name: true, uf: true, type: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } } },
                    orderBy: [{ database: { referenceYear: 'desc' } }, { database: { referenceMonth: 'desc' } }],
                });
                
                // Fallback: try without database filter if no match found
                if (!match) {
                    match = await prisma.engineeringComposition.findFirst({
                        where: { code: { in: codeVariants } },
                        include: { database: { select: { id: true, name: true, uf: true, type: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } } },
                        orderBy: [{ database: { referenceYear: 'desc' } }, { database: { referenceMonth: 'desc' } }],
                    });
                }
            } else {
                // Match as item (insumo)
                const where: any = { code: { in: codeVariants } };
                
                if (extractedSource) {
                    where.database = { name: extractedSource };
                } else if (priorityDbIds.length > 0) {
                    where.databaseId = { in: priorityDbIds };
                }
                
                match = await prisma.engineeringItem.findFirst({
                    where,
                    include: { database: { select: { id: true, name: true, uf: true, type: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } } },
                    orderBy: [{ database: { referenceYear: 'desc' } }, { database: { referenceMonth: 'desc' } }],
                });

                // Fallback: try without database filter
                if (!match) {
                    match = await prisma.engineeringItem.findFirst({
                        where: { code: { in: codeVariants } },
                        include: { database: { select: { id: true, name: true, uf: true, type: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } } },
                        orderBy: [{ database: { referenceYear: 'desc' } }, { database: { referenceMonth: 'desc' } }],
                    });
                }
            }

            if (match) {
                matchedDb = match.database;
                logger.info(`[AI Match] ✅ MATCHED "${item.code}" → db=${matchedDb?.name} id=${match.id}`);
            }
        }
        
        // ── Strategy 2: Description fallback (only if no code match) ──
        if (!match && item.description) {
            const query = item.description.substring(0, 40).trim();
            const descWhere: any = { description: { contains: query, mode: 'insensitive' } };
            
            // Only search in configured bases for description match (stricter)
            if (priorityDbIds.length > 0) {
                descWhere.databaseId = { in: priorityDbIds };
            }
            
            if (itemType === 'AUXILIAR') {
                match = await prisma.engineeringComposition.findFirst({
                    where: descWhere,
                    include: { database: { select: { id: true, name: true, uf: true, type: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } } },
                });
            } else {
                match = await prisma.engineeringItem.findFirst({
                    where: descWhere,
                    include: { database: { select: { id: true, name: true, uf: true, type: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } } },
                });
            }

            if (match) {
                matchedDb = match.database;
                logger.info(`[AI Match] ✅ DESC MATCH "${query}" → db=${matchedDb?.name} code=${match.code}`);
            }
        }

        if (!match) {
            unmatchedCount++;
            logger.warn(`[AI Match] ❌ NO MATCH for "${item.code || 'no-code'}" "${item.description?.substring(0, 40)}"`);
        } else {
            matchedCount++;
        }

        // Convert to CompositionEditor schema
        const unitPrice = item.price || (match as any)?.price || (match as any)?.totalPrice || 0;
        const subtotal = unitPrice * (item.coefficient || 1);

        const enrichedItem = {
            id: `temp-${Date.now()}-${Math.random()}`,
            coefficient: item.coefficient || 1,
            price: subtotal, // In the schema, ci.price is the subtotal
            item: itemType !== 'AUXILIAR' ? {
                id: match ? match.id : `new-${Date.now()}-${Math.random()}`,
                code: match ? match.code : (item.code || 'NOVO'),
                description: match ? match.description : item.description,
                unit: match ? match.unit : item.unit,
                type: item.type,
                price: unitPrice,
                isNew: !match
            } : undefined,
            auxiliaryComposition: itemType === 'AUXILIAR' ? {
                id: match ? match.id : `new-aux-${Date.now()}-${Math.random()}`,
                code: match ? match.code : (item.code || 'NOVO'),
                description: match ? match.description : item.description,
                unit: match ? match.unit : item.unit,
                totalPrice: unitPrice,
                isNew: !match
            } : undefined,
            _ai_confidence: match ? 'high' : 'low',
            _matchedDatabase: matchedDb?.name || null,
        };

        itemsWithMatches.push(enrichedItem);
    }

    logger.info(`[AI Extract Composition] Match summary: ${matchedCount} matched, ${unmatchedCount} unmatched out of ${(extracted.items || []).length} items`);

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

    // ═══════════════════════════════════════════════════════════
    // Determine the primary database for this composition
    // (the most commonly matched database across all items)
    // ═══════════════════════════════════════════════════════════
    const dbCounts: Record<string, { count: number; db: any }> = {};
    for (const ci of itemsWithMatches) {
        if (ci._matchedDatabase) {
            if (!dbCounts[ci._matchedDatabase]) dbCounts[ci._matchedDatabase] = { count: 0, db: null };
            dbCounts[ci._matchedDatabase].count++;
        }
    }
    // Find the most frequent database among matched items
    let primaryDb: any = null;
    if (Object.keys(dbCounts).length > 0) {
        const sorted = Object.entries(dbCounts).sort((a, b) => b[1].count - a[1].count);
        const primaryDbName = sorted[0][0];
        // Fetch the full database record
        primaryDb = await prisma.engineeringDatabase.findFirst({
            where: { name: primaryDbName },
            select: { id: true, name: true, uf: true, type: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true },
            orderBy: [{ referenceYear: 'desc' }, { referenceMonth: 'desc' }],
        });
    }

    return {
        id: `temp-comp-${Date.now()}`,
        code: extracted.code || expectedCode || 'NOVO',
        description: extracted.description || 'Composição Extraída via IA',
        unit: extracted.unit || 'UN',
        totalPrice: itemsWithMatches.reduce((s, ci) => s + (ci.price || 0), 0),
        items: itemsWithMatches,
        groups,
        // Include database so frontend can display the base name
        database: primaryDb || null,
        _ai_stats: { matched: matchedCount, unmatched: unmatchedCount, total: (extracted.items || []).length },
    };
}
