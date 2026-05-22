import { GoogleGenAI } from '@google/genai';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { fallbackToOpenAiV2 } from '../openai.service';
import { buildCodeVariants, normalizeCode, buildFuzzyCodeNeighbors } from '../../engineering/codeNormalizer';
import {
    buildCandidateScore,
    chooseBestCandidate,
    parseDataBaseMonth,
    type EngineeringConfig,
} from '../../engineering/priceEnricher';

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const DB_SELECT = { id: true, name: true, uf: true, type: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true, tenantId: true };

// ═══════════════════════════════════════════════════════════
// LAYER 1: ANTI-HALLUCINATION PROMPT
// ═══════════════════════════════════════════════════════════

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
      "coefficientExpression": "string opcional (expressão multi-fator do coeficiente, ex: '1*220', '2*3.5')",
      "price": number,
      "source": "string (nome da base/fonte da coluna FONTE, ex: SINAPI, SEINFRA, ORSE, SICRO)"
    }
  ]
}

REGRAS CRÍTICAS — LEIA TODAS:
1. "coefficient" e "price" DEVEM ser números (use ponto para decimais). "price" é o PREÇO UNITÁRIO, NÃO o preço total.
2. Se o preço não for legível, coloque 0.
3. Deduza o tipo pelo nome: "Servente/Pedreiro/Carpinteiro" → MAO_DE_OBRA, "Cimento/Areia/Tijolo" → MATERIAL, "Caminhão/Betoneira" → EQUIPAMENTO.
4. Se o código começa com "C" seguido de dígitos (ex: C4291, C1256), o type DEVE ser "AUXILIAR".

REGRAS ANTI-ALUCINAÇÃO — IMPORTANTÍSSIMAS:
5. Extraia APENAS E SOMENTE os itens que estão VISUALMENTE PRESENTES na tabela da imagem. NÃO invente, NÃO adicione, NÃO complemente com itens que não estão na imagem.
6. Se a tabela tem 10 linhas de insumos, o array "items" DEVE ter EXATAMENTE 10 elementos.
7. Copie o campo "code" EXATAMENTE como está escrito na imagem (ex: I6519, C4291, 00035272). NÃO modifique, NÃO invente códigos.
8. Se houver coluna "FONTE" ou "BASE", copie o valor EXATO de cada linha (ex: SEINFRA, SINAPI). Cada linha pode ter uma fonte diferente — leia cada uma individualmente.
9. Se NÃO conseguir ler um valor com certeza, use "" (string vazia) ao invés de inventar.
10. Retorne APENAS o JSON, sem formatação Markdown.

REGRAS PARA COMPOSIÇÕES COMPLEXAS (Iluminação Pública, Manutenção, Garantia):
11. Algumas composições possuem COLUNAS HETEROGÊNEAS por subseção. Exemplos:
    - Mão de Obra: "Qtd Funcionários" × "Qtd Meses" × "Valor Unitário"
    - Veículos: "Qtd Veículos" × "Horas/Mês" × "Valor Hora"
    - Materiais: "Quantidade (UN)" × "Custo Unitário"
    Nestes casos:
    - "coefficient" DEVE ser o PRODUTO FINAL de todos os fatores numéricos (ex: 1 funcionário × 1 mês = coefficient: 1, ou 1 veículo × 220 horas = coefficient: 220).
    - "coefficientExpression" DEVE ser a expressão dos fatores separados por * (ex: "1*1", "1*220").
    - "price" continua sendo o PREÇO UNITÁRIO de um único elemento (valor horista, valor hora, custo unitário).
12. Se a composição tiver subseções nomeadas (ex: "1.1.a — MÃO DE OBRA", "1.1.b — MATERIAIS"), extraia TODOS os itens de TODAS as subseções.
13. Para composições padrão SINAPI/SEINFRA com uma única coluna de coeficiente, NÃO use coefficientExpression — deixe o campo ausente.

REGRA PARA CÓDIGO+BASE NA MESMA CÉLULA:
14. Em muitos editais, a coluna CÓDIGO contém código e base juntos, separados por barra. Exemplos:
    - "2510/SINAPI" → code: "2510", source: "SINAPI"
    - "02622/ORSE" → code: "02622", source: "ORSE"
    - "16278/SEINFRA" → code: "16278", source: "SEINFRA"
    - "20111/SINAPI" → code: "20111", source: "SINAPI"
    Quando detectar este padrão, SEPARE o código da base: coloque apenas o número em "code" e a base em "source". NÃO coloque o nome da base no campo code.`;

// ═══════════════════════════════════════════════════════════
// LAYER 2: POST-EXTRACTION VALIDATION (ANTI-HALLUCINATION)
// ═══════════════════════════════════════════════════════════

/**
 * Validate and filter extracted items to remove AI hallucinations.
 * Returns only items that pass validation checks.
 */
function validateExtractedItems(items: any[]): { valid: any[]; rejected: any[] } {
    const valid: any[] = [];
    const rejected: any[] = [];
    const seen = new Set<string>();

    for (const item of items) {
        const code = String(item.code || '').trim();
        const desc = String(item.description || '').trim();

        // Rule 1: Must have a description
        if (!desc || desc.length < 3) {
            rejected.push({ ...item, _rejectReason: 'description too short or missing' });
            continue;
        }

        // Rule 2: Filter obviously hallucinated codes (garbage patterns)
        if (code && /^[A-Z]{3,}0{3,}$/i.test(code)) {
            // Patterns like TRAO0000, ABCD0000 are clearly hallucinated
            rejected.push({ ...item, _rejectReason: `hallucinated code pattern: ${code}` });
            continue;
        }

        // Rule 3: Deduplication by code+description
        const dedupKey = `${code}|${desc.substring(0, 30)}`.toLowerCase();
        if (seen.has(dedupKey)) {
            rejected.push({ ...item, _rejectReason: 'duplicate' });
            continue;
        }
        seen.add(dedupKey);

        // Rule 4: Reject items with descriptions that are too generic/short for matching
        if (desc.length < 5 && !code) {
            rejected.push({ ...item, _rejectReason: 'description too generic and no code' });
            continue;
        }

        valid.push(item);
    }

    if (rejected.length > 0) {
        logger.warn(`[AI Validation] Rejected ${rejected.length} items: ${rejected.map(r => `"${r.code || 'no-code'}" (${r._rejectReason})`).join(', ')}`);
    }

    return { valid, rejected };
}

/**
 * Post-extraction normalizer: splits combined "CODE/BASE" patterns.
 * E.g., code="2510/SINAPI" → code="2510", source="SINAPI"
 * Also handles "091C6064P/ORSE", "I6519/SEINFRA", etc.
 */
function normalizeExtractedCodes(items: any[]): any[] {
    const KNOWN_BASES = ['SINAPI', 'SEINFRA', 'ORSE', 'SICRO', 'SICRO3', 'CAERN', 'SBC', 'SICOR'];
    const basePattern = new RegExp(`^(.+?)\\/(${KNOWN_BASES.join('|')})$`, 'i');

    return items.map(item => {
        const code = String(item.code || '').trim();
        const match = code.match(basePattern);
        if (match) {
            const extractedCode = match[1].trim();
            const extractedBase = match[2].toUpperCase();
            logger.info(`[AI Normalize] Split combined code: "${code}" → code="${extractedCode}", source="${extractedBase}"`);
            return {
                ...item,
                code: extractedCode,
                source: extractedBase,
                _originalCode: code, // Keep original for divergence tracking
            };
        }
        return item;
    });
}

/**
 * Calculates string similarity using Sorensen-Dice coefficient with bigrams (Dice coefficient).
 * Used to prevent incorrect matching of codes with completely different descriptions.
 */
function getStringSimilarity(str1: string, str2: string): number {
    const s1 = String(str1 || '').trim().toLowerCase();
    const s2 = String(str2 || '').trim().toLowerCase();
    if (s1 === s2) return 1.0;
    if (s1.length < 2 || s2.length < 2) return 0.0;

    const bigrams1: string[] = [];
    for (let i = 0; i < s1.length - 1; i++) {
        bigrams1.push(s1.substring(i, i + 2));
    }
    const bigrams2: string[] = [];
    for (let i = 0; i < s2.length - 1; i++) {
        bigrams2.push(s2.substring(i, i + 2));
    }

    const map2 = new Map<string, number>();
    for (const b of bigrams2) {
        map2.set(b, (map2.get(b) || 0) + 1);
    }

    let intersection = 0;
    for (const b of bigrams1) {
        const count = map2.get(b) || 0;
        if (count > 0) {
            intersection++;
            map2.set(b, count - 1);
        }
    }

    return (2.0 * intersection) / (bigrams1.length + bigrams2.length);
}

/**
 * Normalize an official code for matching (strip spaces, case-insensitive prep).
 */
function normalizeOfficialCode(code: string, source?: string): string {
    return normalizeCode(code, source);
}

/**
 * Detect if a code looks like a composition based on prefix patterns.
 */
function looksLikeComposition(code: string): boolean {
    const c = code.trim().toUpperCase();
    if (/^C\d{3,6}$/.test(c)) return true;
    if (/^COMP/i.test(c)) return true;
    return false;
}

// ═══════════════════════════════════════════════════════════
// LAYER 3: BATCH MATCHING ENGINE (Reuses priceEnricher patterns)
// ═══════════════════════════════════════════════════════════

/**
 * Extract composition from image/PDF and match items against official databases.
 * 
 * 3-Layer Architecture:
 *   L1: Anti-hallucination prompt → prevents AI from inventing items
 *   L2: Post-extraction validation → filters remaining hallucinations
 *   L3: Batch matching via priceEnricher patterns → precise DB matching
 */
export async function extractCompositionFromImage(
    fileBuffer: Buffer,
    mimeType: string,
    expectedCode?: string,
    engineeringConfig?: any,
    tenantId?: string
) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');

    const genAI = new GoogleGenAI({ apiKey });
    const { callGeminiWithRetry } = require('../gemini.service');

    // ─────────────────────────────────────────────────
    // STEP 1: AI EXTRACTION with anti-hallucination prompt
    // ─────────────────────────────────────────────────
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
                    temperature: 0.0
                }
            },
            3
        );
        text = response.text || '';
    } catch (geminiErr: any) {
        logger.warn(`[AI Extract Composition] Gemini failed: ${geminiErr.message}. Trying fallback...`);
        const fallback = await fallbackToOpenAiV2({
            systemPrompt,
            userPrompt: `Extraia a composição.${expectedCode ? ` Foque no item ${expectedCode}.` : ''} Retorne APENAS JSON válido.`,
            temperature: 0.0,
            maxTokens: 8192,
            stageName: 'Composition Extraction',
        });
        text = fallback.text;
    }

    if (!text) throw new Error('Resposta vazia da IA');
    
    // Log raw response for debugging
    logger.info(`[AI Extract Composition] Raw response (${text.length} chars): ${text.substring(0, 500)}...`);

    let extracted: any;
    try {
        extracted = JSON.parse(text);
    } catch (e) {
        throw new Error('Falha ao parsear o JSON retornado pela IA');
    }

    logger.info(`[AI Extract Composition] AI extracted: ${(extracted.items || []).length} items, code="${extracted.code}", desc="${(extracted.description || '').substring(0, 50)}"`);

    // ─────────────────────────────────────────────────
    // STEP 2: POST-EXTRACTION VALIDATION
    // ─────────────────────────────────────────────────
    const { valid: validItems, rejected } = validateExtractedItems(extracted.items || []);
    logger.info(`[AI Extract Composition] Validation: ${validItems.length} valid, ${rejected.length} rejected`);

    // ─────────────────────────────────────────────────
    // STEP 2.5: NORMALIZE COMBINED CODE/BASE PATTERNS
    // ─────────────────────────────────────────────────
    const normalizedItems = normalizeExtractedCodes(validItems);
    logger.info(`[AI Extract Composition] Post-normalization: ${normalizedItems.length} items`);

    // ─────────────────────────────────────────────────
    // STEP 3: BATCH MATCHING (priceEnricher pattern)
    // ─────────────────────────────────────────────────
    const config: EngineeringConfig = engineeringConfig || {};
    const targetDate = parseDataBaseMonth(config.dataBase);

    // Collect all code variants for batch lookup
    const allCodeVariants: string[] = [];
    const configuredBases = (config.basesConsideradas || []).map((b: string) => b.toUpperCase());
    
    for (const item of normalizedItems) {
        if (item.code) {
            const itemSource = String(item.source || '').toUpperCase().trim();
            // Always pass source for proper cross-variants
            allCodeVariants.push(...buildCodeVariants(item.code, itemSource));
            // Also add source-specific variants for all configured bases
            for (const src of configuredBases) {
                allCodeVariants.push(...buildCodeVariants(item.code, src));
            }
            // Cross-base: try ALL known bases to handle AI source errors
            // (e.g., ORSE item tagged as SEINFRA → need ORSE variants in DB query)
            const knownBases = ['SINAPI', 'SEINFRA', 'ORSE', 'SICRO', 'CAERN', 'SBC', 'SICOR'];
            for (const base of knownBases) {
                if (base !== itemSource && !configuredBases.includes(base)) {
                    allCodeVariants.push(...buildCodeVariants(item.code, base));
                }
            }
            // Add fuzzy neighbors for Strategy 1.5
            allCodeVariants.push(...buildFuzzyCodeNeighbors(item.code, itemSource));
        }
    }
    const uniqueCodes = [...new Set(allCodeVariants)];
    logger.info(`[AI Match Batch] Searching ${uniqueCodes.length} code variants across both tables`);

    // Batch fetch from BOTH tables
    const dbWhere: any = { OR: [{ type: 'OFICIAL' }] };
    if (tenantId) dbWhere.OR.push({ tenantId });

    const [dbItems, dbComps] = await Promise.all([
        uniqueCodes.length > 0 ? prisma.engineeringItem.findMany({
            where: { code: { in: uniqueCodes, mode: 'insensitive' }, database: dbWhere },
            include: { database: { select: DB_SELECT } },
        }) : Promise.resolve([]),
        uniqueCodes.length > 0 ? prisma.engineeringComposition.findMany({
            where: { code: { in: uniqueCodes, mode: 'insensitive' }, database: dbWhere },
            include: { database: { select: DB_SELECT } },
        }) : Promise.resolve([]),
    ]);

    logger.info(`[AI Match Batch] DB results: ${dbItems.length} items, ${dbComps.length} compositions`);

    // Build code→candidates map
    const byCode = new Map<string, any[]>();
    for (const dbItem of dbItems) {
        const candidate = { ...dbItem, matchType: 'INSUMO', matchedPrice: Number(dbItem.price) || 0 };
        for (const keyVariant of buildCodeVariants(dbItem.code, dbItem.database?.name)) {
            const key = keyVariant.toLowerCase();
            byCode.set(key, [...(byCode.get(key) || []), candidate]);
        }
    }
    for (const dbComp of dbComps) {
        const candidate = { ...dbComp, matchType: 'COMPOSICAO', matchedPrice: Number(dbComp.totalPrice) || 0 };
        for (const keyVariant of buildCodeVariants(dbComp.code, dbComp.database?.name)) {
            const key = keyVariant.toLowerCase();
            byCode.set(key, [...(byCode.get(key) || []), candidate]);
        }
    }

    // ─────────────────────────────────────────────────
    // STEP 4: MATCH EACH ITEM using scoring engine
    // ─────────────────────────────────────────────────
    const itemsWithMatches = [];
    let matchedCount = 0;
    let unmatchedCount = 0;

    for (const item of normalizedItems) {
        let itemType = String(item.type || 'MATERIAL').toUpperCase();
        item.type = itemType;
        
        const extractedSource = String(item.source || '').toUpperCase().trim();
        let bestCandidate: any = null;
        let matchedDb: any = null;
        let foundInTable: 'item' | 'composition' | null = null;
        let matchMethod: 'DIRECT' | 'CROSS_BASE' | 'FUZZY_CODE' | 'DESCRIPTION' = 'DIRECT';

        // Strategy 1: Code match with scoring
        if (item.code) {
            const codeLower = normalizeOfficialCode(item.code, item.source).toLowerCase();
            const candidates = byCode.get(codeLower) || [];
            
            // Also try raw code variants with source
            if (candidates.length === 0) {
                const variants = buildCodeVariants(item.code, extractedSource);
                for (const v of variants) {
                    const c = byCode.get(v.toLowerCase());
                    if (c) candidates.push(...c);
                }
            }

            // Strategy 1.1: Cross-Base Code Lookup
            // When AI extracts wrong source (e.g., ORSE item tagged as SEINFRA),
            // try ALL known bases to generate the right code variants
            if (candidates.length === 0) {
                const knownBases = ['SINAPI', 'SEINFRA', 'ORSE', 'SICRO', 'CAERN', 'SBC', 'SICOR'];
                for (const base of knownBases) {
                    if (base === extractedSource) continue; // Already tried
                    const crossVariants = buildCodeVariants(item.code, base);
                    for (const v of crossVariants) {
                        const c = byCode.get(v.toLowerCase());
                        if (c) candidates.push(...c);
                    }
                    // Also try normalizing with this base
                    const crossNorm = normalizeOfficialCode(item.code, base).toLowerCase();
                    if (crossNorm !== codeLower) {
                        const c = byCode.get(crossNorm);
                        if (c) candidates.push(...c);
                    }
                }
                if (candidates.length > 0) {
                    logger.info(`[AI Match] 🔄 Cross-base lookup found ${candidates.length} candidates for "${item.code}" (extracted source: ${extractedSource})`);
                }
            }

            if (candidates.length > 0) {
                // Use priceEnricher's scoring system
                const virtualItem = {
                    code: item.code,
                    description: item.description,
                    type: looksLikeComposition(item.code) ? 'COMPOSICAO' : 'INSUMO',
                    sourceName: extractedSource || configuredBases[0] || '',
                    unitCost: item.price || 0,
                };

                const best = chooseBestCandidate(candidates, virtualItem, config, targetDate);
                if (best) {
                    const similarity = getStringSimilarity(item.description, best.candidate.description);
                    if (similarity >= 0.25) {
                        bestCandidate = best.candidate;
                        matchedDb = bestCandidate.database;
                        foundInTable = bestCandidate.matchType === 'COMPOSICAO' ? 'composition' : 'item';
                        // Detect cross-base: matched DB differs from extracted source
                        if (extractedSource && matchedDb?.name?.toUpperCase() !== extractedSource) {
                            matchMethod = 'CROSS_BASE';
                        }
                        logger.info(`[AI Match] ✅ CODE "${item.code}" → ${matchedDb?.name} (${foundInTable}) score=${best.score} sim=${similarity.toFixed(2)} method=${matchMethod} ${best.warnings.length > 0 ? 'warns=' + best.warnings.join(';') : ''}`);
                    } else {
                        logger.warn(`[AI Match] ❌ CODE Match Discarded for "${item.code}" due to low description similarity (${similarity.toFixed(2)} < 0.25). Extracted: "${item.description}", DB: "${best.candidate.description}"`);
                    }
                }
            }
        }

        // Strategy 1.5: Fuzzy Code Neighbors + Description Confirmation
        // When AI/OCR gets a digit wrong (e.g., 100862 vs 100861), try neighboring codes
        if (!bestCandidate && item.code && item.description) {
            const fuzzyNeighbors = buildFuzzyCodeNeighbors(item.code, extractedSource);
            const fuzzyPool: any[] = [];
            for (const neighbor of fuzzyNeighbors) {
                const c = byCode.get(neighbor.toLowerCase());
                if (c) fuzzyPool.push(...c);
            }
            if (fuzzyPool.length > 0) {
                // Score all fuzzy candidates and pick the one with best description match
                // Tiebreaker: prefer candidate whose database matches the AI-extracted source
                let bestFuzzy: { candidate: any; sim: number; sourceMatch: boolean } | null = null;
                for (const candidate of fuzzyPool) {
                    const sim = getStringSimilarity(item.description, candidate.description);
                    if (sim < 0.60) continue;
                    const sourceMatch = !!(extractedSource && candidate.database?.name?.toUpperCase() === extractedSource);
                    if (!bestFuzzy 
                        || sim > bestFuzzy.sim 
                        || (sim === bestFuzzy.sim && sourceMatch && !bestFuzzy.sourceMatch)) {
                        bestFuzzy = { candidate, sim, sourceMatch };
                    }
                }
                if (bestFuzzy) {
                    bestCandidate = bestFuzzy.candidate;
                    matchedDb = bestCandidate.database;
                    foundInTable = bestCandidate.matchType === 'COMPOSICAO' ? 'composition' : 'item';
                    matchMethod = 'FUZZY_CODE';
                    logger.info(`[AI Match] ✅ FUZZY CODE "${item.code}" → corrected to "${bestCandidate.code}" in ${matchedDb?.name} (${foundInTable}) sim=${bestFuzzy.sim.toFixed(2)} method=FUZZY_CODE`);
                }
            }
        }

        // Strategy 2: Description similarity fallback (pg_trgm)
        if (!bestCandidate && item.description && item.description.length >= 10) {
            try {
                const descQuery = item.description.substring(0, 80);
                
                // Build SQL filters using Prisma.sql for safety
                const { Prisma } = require('@prisma/client');
                const accessSql = tenantId
                    ? Prisma.sql`AND (d.type = 'OFICIAL' OR d."tenantId" = ${tenantId})`
                    : Prisma.sql`AND d.type = 'OFICIAL'`;
                const itemBases = [item.source, ...configuredBases].filter(Boolean);
                const uniqueItemBases = [...new Set(itemBases.map((b: string) => b.toUpperCase()))];
                const sourceSql = Prisma.empty; // Don't filter by base — allow cross-base description matching

                const [compRows, itemRows] = await Promise.all([
                    prisma.$queryRaw<any[]>`
                        SELECT c.id, c.code, c.description, c.unit, c."totalPrice" as "matchedPrice",
                               'COMPOSICAO' as "matchType", similarity(c.description, ${descQuery}) as sim
                        FROM "EngineeringComposition" c
                        INNER JOIN "EngineeringDatabase" d ON d.id = c."databaseId"
                        WHERE c.description % ${descQuery}
                          AND similarity(c.description, ${descQuery}) > 0.35
                          ${accessSql}${sourceSql}
                        ORDER BY sim DESC LIMIT 3
                    `.catch(() => [] as any[]),
                    prisma.$queryRaw<any[]>`
                        SELECT i.id, i.code, i.description, i.unit, i.price as "matchedPrice",
                               'INSUMO' as "matchType", similarity(i.description, ${descQuery}) as sim
                        FROM "EngineeringItem" i
                        INNER JOIN "EngineeringDatabase" d ON d.id = i."databaseId"
                        WHERE i.description % ${descQuery}
                          AND similarity(i.description, ${descQuery}) > 0.35
                          ${accessSql}${sourceSql}
                        ORDER BY sim DESC LIMIT 3
                    `.catch(() => [] as any[]),
                ]);

                const allSim = [...compRows, ...itemRows].sort((a, b) => Number(b.sim) - Number(a.sim));
                
                if (allSim.length > 0) {
                    const topMatch = allSim[0];
                    const simScore = Number(topMatch.sim) || 0;
                    
                    // Fetch full record with database
                    let fullRecord: any = null;
                    if (topMatch.matchType === 'COMPOSICAO') {
                        fullRecord = await prisma.engineeringComposition.findUnique({
                            where: { id: topMatch.id },
                            include: { database: { select: DB_SELECT } },
                        });
                    } else {
                        fullRecord = await prisma.engineeringItem.findUnique({
                            where: { id: topMatch.id },
                            include: { database: { select: DB_SELECT } },
                        });
                    }

                    if (fullRecord && simScore >= 0.55) {
                        bestCandidate = {
                            ...fullRecord,
                            matchType: topMatch.matchType,
                            matchedPrice: Number(topMatch.matchedPrice) || 0,
                        };
                        matchedDb = fullRecord.database;
                        foundInTable = topMatch.matchType === 'COMPOSICAO' ? 'composition' : 'item';
                        // Log with code correction info
                        const codeInfo = item.code ? ` (AI code "${item.code}" → DB code "${fullRecord.code}")` : '';
                        logger.info(`[AI Match] ✅ DESC "${item.description.substring(0, 40)}" → ${matchedDb?.name} code=${fullRecord.code} sim=${(simScore * 100).toFixed(0)}%${codeInfo}`);
                    } else if (allSim.length > 0) {
                        logger.info(`[AI Match] ⚠️ DESC "${item.description.substring(0, 40)}" → best sim=${(simScore * 100).toFixed(0)}% (below 55% threshold)`);
                    }
                }
                if (bestCandidate) {
                    matchMethod = 'DESCRIPTION';
                }
            } catch (e: any) {
                // pg_trgm not available or query failed — skip silently
                if (!e.message?.includes('similarity')) {
                    logger.warn(`[AI Match] Semantic fallback failed: ${e.message}`);
                }
            }
        }

        // Track stats
        if (bestCandidate) {
            matchedCount++;
        } else {
            unmatchedCount++;
            logger.warn(`[AI Match] ❌ NO MATCH for "${item.code || 'no-code'}" "${item.description?.substring(0, 50)}"`);
        }

        // ─────────────────────────────────────────────
        // STEP 5: BUILD COMPOSITIONEDITOR FORMAT
        // ─────────────────────────────────────────────
        // Correct type based on where we found the match
        let resolvedType = itemType;
        if (foundInTable === 'composition') {
            resolvedType = 'AUXILIAR';
        } else if (foundInTable === 'item' && bestCandidate?.type) {
            resolvedType = bestCandidate.type;
        }

        const unitPrice = item.price || bestCandidate?.matchedPrice || (bestCandidate as any)?.price || (bestCandidate as any)?.totalPrice || 0;
        const subtotal = unitPrice * (item.coefficient || 1);
        const isComposition = foundInTable === 'composition' || (!bestCandidate && looksLikeComposition(item.code || ''));

        // Build divergence alert when match method is not DIRECT
        let matchDivergence: any = null;
        if (bestCandidate && matchMethod !== 'DIRECT') {
            const matchedCode = bestCandidate.code || '';
            const matchedSource = matchedDb?.name || '';
            const originalCode = item.code || '';
            const originalSource = extractedSource || '';

            const codeDiverges = matchedCode.replace(/\//g, '').toUpperCase() !== originalCode.replace(/^I|S$/g, '').replace(/^0+/, '').toUpperCase();
            const sourceDiverges = originalSource && matchedSource.toUpperCase() !== originalSource;

            if (codeDiverges || sourceDiverges) {
                const parts: string[] = [];
                if (sourceDiverges) parts.push(`tabela ${matchedSource} (edital: ${originalSource})`);
                if (codeDiverges) parts.push(`código ${matchedCode} (edital: ${originalCode})`);
                matchDivergence = {
                    type: matchMethod,
                    originalCode,
                    originalSource,
                    matchedCode,
                    matchedSource,
                    message: `Item encontrado pela descrição em ${parts.join(' e ')}. Verifique se deseja manter ou editar para ficar conforme o edital.`,
                };
                logger.info(`[AI Match] ⚠️ DIVERGENCE for "${originalCode}": ${matchDivergence.message}`);
            }
        }

        const enrichedItem: any = {
            id: `temp-${Date.now()}-${Math.random()}`,
            coefficient: item.coefficient || 1,
            // GAP 1: Preserve multi-factor expression from AI extraction
            coefficientExpression: item.coefficientExpression || undefined,
            price: subtotal,
            _ai_confidence: bestCandidate ? 'high' : 'low',
            // FIX BASE-CLASS: Auto-reclassify unmatched items as PRÓPRIO
            // When no match is found in any official base, the item is by definition próprio
            _matchedDatabase: bestCandidate ? (matchedDb?.name || null) : 'PRÓPRIO',
            _aiExtractedSource: extractedSource || null, // Preserve what the AI read from the image
            _noBaseMatch: !bestCandidate, // Flag for frontend "⚠ Não encontrado nas bases"
            _matchDivergence: matchDivergence, // Alert when code/base diverges from edital
        };

        if (isComposition) {
            enrichedItem.auxiliaryComposition = {
                id: bestCandidate ? bestCandidate.id : `new-aux-${Date.now()}-${Math.random()}`,
                code: bestCandidate ? bestCandidate.code : (item.code || 'PROPRIO'),
                description: bestCandidate ? bestCandidate.description : item.description,
                unit: bestCandidate ? bestCandidate.unit : item.unit,
                totalPrice: unitPrice,
                isNew: !bestCandidate,
            };
        } else {
            enrichedItem.item = {
                id: bestCandidate ? bestCandidate.id : `new-${Date.now()}-${Math.random()}`,
                code: bestCandidate ? bestCandidate.code : (item.code || 'PROPRIO'),
                description: bestCandidate ? bestCandidate.description : item.description,
                unit: bestCandidate ? bestCandidate.unit : item.unit,
                type: resolvedType,
                price: unitPrice,
                isNew: !bestCandidate,
            };
        }

        itemsWithMatches.push(enrichedItem);
    }

    logger.info(`[AI Extract Composition] Match summary: ${matchedCount}/${normalizedItems.length} matched, ${unmatchedCount} unmatched, ${rejected.length} rejected by validation`);

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

    // Determine primary database
    const dbCounts: Record<string, number> = {};
    for (const ci of itemsWithMatches) {
        if (ci._matchedDatabase) {
            dbCounts[ci._matchedDatabase] = (dbCounts[ci._matchedDatabase] || 0) + 1;
        }
    }
    let primaryDb: any = null;
    if (Object.keys(dbCounts).length > 0) {
        const sorted = Object.entries(dbCounts).sort((a, b) => b[1] - a[1]);
        primaryDb = await prisma.engineeringDatabase.findFirst({
            where: { name: sorted[0][0] },
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
        _ai_stats: {
            matched: matchedCount,
            unmatched: unmatchedCount,
            rejected: rejected.length,
            total: (extracted.items || []).length,
        },
    };
}
