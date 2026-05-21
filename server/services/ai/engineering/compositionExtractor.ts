import { GoogleGenAI } from '@google/genai';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { fallbackToOpenAiV2 } from '../openai.service';
import { buildCodeVariants } from '../../engineering/codeNormalizer';

const DB_SELECT = { id: true, name: true, uf: true, type: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true };
const DB_ORDER: any[] = [{ database: { referenceYear: 'desc' } }, { database: { referenceMonth: 'desc' } }];

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
3. Se não houver tipo claro, tente deduzir pelo nome (ex: "Servente" -> MAO_DE_OBRA, "Cimento" -> MATERIAL, "Caminhão" -> EQUIPAMENTO).
4. IMPORTANTE: Se houver coluna "FONTE" ou "BASE" na tabela, extraia o valor EXATO (ex: SINAPI, SEINFRA) para o campo "source" de cada item. LEIA CADA LINHA INDIVIDUALMENTE — fontes podem diferir entre linhas.
5. O campo "code" é CRUCIAL — extraia EXATAMENTE como escrito na imagem (ex: I6519, C4291, 00035272, 102223). Não modifique, não adicione prefixos.
6. Se o código começa com "C" seguido de dígitos (ex: C4291, C1256), o type DEVE ser "AUXILIAR" (composição auxiliar).
7. Retorne APENAS o JSON, sem formatação Markdown.`;

/**
 * Search for a code in engineeringItem table with cascading filters.
 * Returns { match, db } or { match: null, db: null }
 */
async function findInItems(codeVariants: string[], extractedSource: string, priorityDbIds: string[]) {
    const include = { database: { select: DB_SELECT } };
    
    // 1. Try with extracted source
    if (extractedSource) {
        const m = await prisma.engineeringItem.findFirst({
            where: { code: { in: codeVariants }, database: { name: extractedSource } },
            include, orderBy: DB_ORDER,
        });
        if (m) return { match: m, db: m.database, table: 'item' as const };
    }
    
    // 2. Try with configured bases
    if (priorityDbIds.length > 0) {
        const m = await prisma.engineeringItem.findFirst({
            where: { code: { in: codeVariants }, databaseId: { in: priorityDbIds } },
            include, orderBy: DB_ORDER,
        });
        if (m) return { match: m, db: m.database, table: 'item' as const };
    }
    
    // 3. Try any database
    const m = await prisma.engineeringItem.findFirst({
        where: { code: { in: codeVariants } },
        include, orderBy: DB_ORDER,
    });
    if (m) return { match: m, db: m.database, table: 'item' as const };
    
    return { match: null, db: null, table: null };
}

/**
 * Search for a code in engineeringComposition table with cascading filters.
 */
async function findInCompositions(codeVariants: string[], extractedSource: string, priorityDbIds: string[]) {
    const include = { database: { select: DB_SELECT } };
    
    // 1. Try with extracted source
    if (extractedSource) {
        const m = await prisma.engineeringComposition.findFirst({
            where: { code: { in: codeVariants }, database: { name: extractedSource } },
            include, orderBy: DB_ORDER,
        });
        if (m) return { match: m, db: m.database, table: 'composition' as const };
    }
    
    // 2. Try with configured bases
    if (priorityDbIds.length > 0) {
        const m = await prisma.engineeringComposition.findFirst({
            where: { code: { in: codeVariants }, databaseId: { in: priorityDbIds } },
            include, orderBy: DB_ORDER,
        });
        if (m) return { match: m, db: m.database, table: 'composition' as const };
    }
    
    // 3. Try any database
    const m = await prisma.engineeringComposition.findFirst({
        where: { code: { in: codeVariants } },
        include, orderBy: DB_ORDER,
    });
    if (m) return { match: m, db: m.database, table: 'composition' as const };
    
    return { match: null, db: null, table: null };
}

/**
 * Detect if a code looks like a composition code based on prefix patterns.
 * SEINFRA: C + digits = composition, I + digits = item
 * SINAPI: pure 5-6 digit numbers can be either
 */
function looksLikeComposition(code: string): boolean {
    const c = code.trim().toUpperCase();
    // SEINFRA composition pattern: C followed by digits
    if (/^C\d{3,6}$/.test(c)) return true;
    // COMP prefix
    if (/^COMP/i.test(c)) return true;
    return false;
}

/**
 * Extract composition from image/PDF and match items against official databases.
 * 
 * CRITICAL FIX: Always searches BOTH tables (engineeringItem AND engineeringComposition)
 * regardless of the AI-assigned type. The AI often misclassifies AUXILIAR items as SERVICO,
 * causing code matches to fail when looking in the wrong table.
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
            3
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
    const configuredBases = engineeringConfig?.basesConsideradas || [];
    const configuredBaseNames = configuredBases.map((b: string) => b.toUpperCase());
    
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
    // STEP 3: Match each item — ALWAYS search BOTH tables
    // ═══════════════════════════════════════════════════════════
    const itemsWithMatches = [];
    let matchedCount = 0;
    let unmatchedCount = 0;
    
    for (const item of extracted.items || []) {
        let itemType = String(item.type || 'MATERIAL').toUpperCase();
        item.type = itemType;

        const extractedSource = String(item.source || '').toUpperCase().trim();
        
        let match: any = null;
        let matchedDb: any = null;
        let foundInTable: 'item' | 'composition' | null = null;

        if (item.code) {
            // Build variants for EACH possible source (extracted + all configured)
            const sourcesToTry = [extractedSource, ...configuredBaseNames].filter(Boolean);
            const allVariants = new Set<string>();
            
            // Always add base variants (no source)
            for (const v of buildCodeVariants(item.code)) allVariants.add(v);
            // Add source-specific variants
            for (const src of sourcesToTry) {
                for (const v of buildCodeVariants(item.code, src)) allVariants.add(v);
            }
            const codeVariants = [...allVariants];
            
            logger.info(`[AI Match] Item "${item.code}" (${itemType}) → variants: [${codeVariants.join(', ')}] source="${extractedSource}"`);

            // ── Determine search order based on code prefix ──
            const prefersComposition = looksLikeComposition(item.code) || itemType === 'AUXILIAR';
            
            if (prefersComposition) {
                // Search compositions FIRST, then items
                const compResult = await findInCompositions(codeVariants, extractedSource, priorityDbIds);
                if (compResult.match) {
                    match = compResult.match;
                    matchedDb = compResult.db;
                    foundInTable = 'composition';
                } else {
                    // Cross-table fallback: try items
                    const itemResult = await findInItems(codeVariants, extractedSource, priorityDbIds);
                    if (itemResult.match) {
                        match = itemResult.match;
                        matchedDb = itemResult.db;
                        foundInTable = 'item';
                    }
                }
            } else {
                // Search items FIRST, then compositions
                const itemResult = await findInItems(codeVariants, extractedSource, priorityDbIds);
                if (itemResult.match) {
                    match = itemResult.match;
                    matchedDb = itemResult.db;
                    foundInTable = 'item';
                } else {
                    // Cross-table fallback: try compositions
                    const compResult = await findInCompositions(codeVariants, extractedSource, priorityDbIds);
                    if (compResult.match) {
                        match = compResult.match;
                        matchedDb = compResult.db;
                        foundInTable = 'composition';
                    }
                }
            }

            if (match) {
                logger.info(`[AI Match] ✅ MATCHED "${item.code}" → db=${matchedDb?.name} table=${foundInTable} id=${match.id}`);
            }
        }
        
        // ── Strategy 2: Description fallback — search BOTH tables ──
        if (!match && item.description) {
            const query = item.description.substring(0, 40).trim();
            const baseWhere: any = { description: { contains: query, mode: 'insensitive' } };
            
            if (priorityDbIds.length > 0) {
                baseWhere.databaseId = { in: priorityDbIds };
            }
            
            // Try items first
            const itemMatch = await prisma.engineeringItem.findFirst({
                where: baseWhere,
                include: { database: { select: DB_SELECT } },
            });
            
            if (itemMatch) {
                match = itemMatch;
                matchedDb = itemMatch.database;
                foundInTable = 'item';
            } else {
                // Try compositions
                const compMatch = await prisma.engineeringComposition.findFirst({
                    where: baseWhere,
                    include: { database: { select: DB_SELECT } },
                });
                if (compMatch) {
                    match = compMatch;
                    matchedDb = compMatch.database;
                    foundInTable = 'composition';
                }
            }

            if (match) {
                logger.info(`[AI Match] ✅ DESC MATCH "${query}" → db=${matchedDb?.name} table=${foundInTable} code=${match.code}`);
            }
        }

        if (!match) {
            unmatchedCount++;
            logger.warn(`[AI Match] ❌ NO MATCH for "${item.code || 'no-code'}" "${item.description?.substring(0, 40)}"`);
        } else {
            matchedCount++;
        }

        // ═══════════════════════════════════════════════════════
        // CRITICAL: Correct the type based on WHERE we found the match
        // If found in compositions table → must be AUXILIAR
        // If found in items table → use the item's actual type
        // ═══════════════════════════════════════════════════════
        let resolvedType = itemType;
        if (foundInTable === 'composition') {
            resolvedType = 'AUXILIAR';
        } else if (foundInTable === 'item' && match?.type) {
            resolvedType = match.type;
        }

        const unitPrice = item.price || (match as any)?.price || (match as any)?.totalPrice || 0;
        const subtotal = unitPrice * (item.coefficient || 1);

        const isComposition = foundInTable === 'composition' || (!match && looksLikeComposition(item.code || ''));

        const enrichedItem: any = {
            id: `temp-${Date.now()}-${Math.random()}`,
            coefficient: item.coefficient || 1,
            price: subtotal,
            _ai_confidence: match ? 'high' : 'low',
            _matchedDatabase: matchedDb?.name || null,
        };

        if (isComposition) {
            enrichedItem.auxiliaryComposition = {
                id: match ? match.id : `new-aux-${Date.now()}-${Math.random()}`,
                code: match ? match.code : (item.code || 'NOVO'),
                description: match ? match.description : item.description,
                unit: match ? match.unit : item.unit,
                totalPrice: unitPrice,
                isNew: !match,
            };
        } else {
            enrichedItem.item = {
                id: match ? match.id : `new-${Date.now()}-${Math.random()}`,
                code: match ? match.code : (item.code || 'NOVO'),
                description: match ? match.description : item.description,
                unit: match ? match.unit : item.unit,
                type: resolvedType,
                price: unitPrice,
                isNew: !match,
            };
        }

        itemsWithMatches.push(enrichedItem);
    }

    logger.info(`[AI Extract Composition] Match summary: ${matchedCount} matched, ${unmatchedCount} unmatched out of ${(extracted.items || []).length} items`);

    // Group items
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

    // Determine primary database (most frequent among matched items)
    const dbCounts: Record<string, number> = {};
    for (const ci of itemsWithMatches) {
        if (ci._matchedDatabase) {
            dbCounts[ci._matchedDatabase] = (dbCounts[ci._matchedDatabase] || 0) + 1;
        }
    }
    let primaryDb: any = null;
    if (Object.keys(dbCounts).length > 0) {
        const sorted = Object.entries(dbCounts).sort((a, b) => b[1] - a[1]);
        const primaryDbName = sorted[0][0];
        primaryDb = await prisma.engineeringDatabase.findFirst({
            where: { name: primaryDbName },
            select: DB_SELECT,
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
        database: primaryDb || null,
        _ai_stats: { matched: matchedCount, unmatched: unmatchedCount, total: (extracted.items || []).length },
    };
}
