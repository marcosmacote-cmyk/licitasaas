/**
 * ══════════════════════════════════════════════════════════════
 *  Price Enricher — Módulo compartilhado de enriquecimento
 *  de preços contra bases oficiais (SINAPI, SEINFRA, ORSE, SICRO, SICOR)
 * ══════════════════════════════════════════════════════════════
 *
 *  FIX-01: Unifica a lógica completa de enriquecimento que antes
 *  existia em duas versões divergentes:
 *    1. engineering.ts:1543 (completa — scoring multidimensional)
 *    2. engineeringExtractionHandler.ts:548 (simplificada — sem regime/data-base)
 *
 *  Agora ambos usam esta função centralizada.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

// ── Types ──
export type EngineeringPriceAuditStatus = 'OK' | 'DIVERGENT' | 'SEM_MATCH' | 'BASE_INCOMPATIVEL';

export interface EngineeringPriceAudit {
    status: EngineeringPriceAuditStatus;
    extractedUnitCost: number;
    matchedUnitCost: number | null;
    matchedDatabaseId?: string | null;
    matchedCode?: string | null;
    matchedSourceName?: string | null;
    matchedUf?: string | null;
    matchedReference?: string;
    matchedPayrollExemption?: boolean;
    matchMethod?: 'code_exact' | 'description_similarity' | 'none';
    confidence?: number;
    confidenceLevel?: 'HIGH' | 'MEDIUM' | 'LOW';
    confidenceFactors?: {
        sourceMatch: boolean;
        dateMatch: boolean;
        regimeMatch: boolean;
        priceDeviation: number | null;   // % deviation
        matchType: string;               // code_exact | description_similarity
    };
    analyticalDatabaseId?: string | null;  // Cache: DB where analytical items were found
    deltaValue: number | null;
    deltaPercent: number | null;
    warnings: string[];
}

export interface EngineeringConfig {
    dataBase?: string;       // "2026-04" — data-base do orçamento
    regimeOneracao?: string; // "ONERADO" | "DESONERADO"
    basesConsideradas?: string[]; // ["SINAPI", "SEINFRA", "SICOR"]
    [key: string]: any;
}

export interface PriceEnrichmentOptions {
    tenantId?: string | null;
    includeOwnTenantDatabase?: boolean;
    allowSemanticFallback?: boolean;
}

// ── Utility Functions ──

export function parseDataBaseMonth(dataBase?: string): { year: number; month: number } | null {
    const match = String(dataBase || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]) };
}

export function formatReference(db: any): string {
    if (db?.referenceYear && db?.referenceMonth) {
        return `${String(db.referenceMonth).padStart(2, '0')}/${db.referenceYear}`;
    }
    return db?.version || 'N/I';
}

function normalizeOfficialCode(code: string): string {
    const value = String(code || '').trim().toUpperCase();
    const orse = value.match(/^0*(\d+)\/ORSE$/);
    return orse ? `${orse[1]}/ORSE` : value;
}

function normalizeSourceName(sourceName: string): string {
    const source = String(sourceName || '').trim().toUpperCase();
    if (source === 'SICOR-MG' || source === 'SICOR MG' || source === 'DER-MG' || source === 'DER MG') return 'SICOR';
    return source;
}

function buildCodeVariants(code: string): string[] {
    const normalized = normalizeOfficialCode(code);
    const variants = new Set([String(code || '').trim(), normalized]);
    const orse = normalized.match(/^(\d+)\/ORSE$/);
    if (orse) variants.add(`${orse[1].padStart(5, '0')}/ORSE`);
    return [...variants].filter(Boolean);
}

export function buildCandidateScore(
    candidate: any,
    sourceName: string,
    config: EngineeringConfig | undefined,
    targetDate: { year: number; month: number } | null
): { score: number; warnings: string[] } {
    const db = candidate.database || {};
    const desiredSources = Array.isArray(config?.basesConsideradas)
        ? config.basesConsideradas.map((b: string) => normalizeSourceName(b))
        : [];
    const desiredDesonerado = config?.regimeOneracao
        ? String(config.regimeOneracao).toUpperCase() === 'DESONERADO'
        : null;

    let score = 0;
    const warnings: string[] = [];
    const dbName = String(db.name || '').toUpperCase();
    const itemSource = normalizeSourceName(sourceName);

    // Source match scoring
    if (itemSource && itemSource !== 'PROPRIA' && dbName === itemSource) score += 40;
    else if (desiredSources.includes(dbName)) score += 20;
    else if ((itemSource && itemSource !== 'PROPRIA') || desiredSources.length > 0) warnings.push('fonte fora das bases configuradas');

    // Date match scoring
    if (targetDate) {
        const exactDate = db.referenceYear === targetDate.year && db.referenceMonth === targetDate.month;
        const versionDate = String(db.version || '').includes(`${String(targetDate.month).padStart(2, '0')}/${targetDate.year}`)
            || String(db.version || '').includes(`${targetDate.year}-${String(targetDate.month).padStart(2, '0')}`);
        if (exactDate || versionDate) score += 30;
        else warnings.push(`data-base incompatível (${formatReference(db)})`);
    } else if (!db.referenceYear && !db.referenceMonth && !db.version) {
        warnings.push('data-base não informada na base');
    }

    // Regime match scoring. ORSE/SICRO do not expose dual onerado/desonerado
    // catalogs in the same way SINAPI/SEINFRA do, so they must not produce
    // false base-incompatible alerts only because the project has a payroll regime.
    const supportsPayrollRegime = ['SINAPI', 'SEINFRA', 'SICOR'].includes(dbName);
    if (desiredDesonerado !== null && supportsPayrollRegime) {
        if (Boolean(db.payrollExemption) === desiredDesonerado) score += 20;
        else warnings.push(`regime ${db.payrollExemption ? 'desonerado' : 'onerado'} incompatível`);
    }

    return { score, warnings };
}

/**
 * Calculate a detailed confidence score for a price match.
 * Returns a 0-100 score with detailed factors explaining the confidence level.
 */
export function calculateMatchConfidence(
    best: { score: number; warnings: string[]; matchMethod?: string; confidence?: number },
    extractedUnitCost: number,
    matchedUnitCost: number,
): { confidence: number; confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW'; factors: EngineeringPriceAudit['confidenceFactors'] } {
    let confidence = 0;
    const factors: EngineeringPriceAudit['confidenceFactors'] = {
        sourceMatch: false,
        dateMatch: false,
        regimeMatch: false,
        priceDeviation: null,
        matchType: best.matchMethod || 'none',
    };

    // Factor 1: Match method (40 points max)
    if (best.matchMethod === 'code_exact') {
        confidence += 40;
    } else if (best.matchMethod === 'description_similarity') {
        confidence += Math.min(30, Math.round((best.confidence || 0) * 0.3));
    }

    // Factor 2: Source/date/regime score from buildCandidateScore (30 points max)
    // best.score ranges 0-90 (40 source + 30 date + 20 regime)
    const sourceScore = Math.min(30, Math.round(best.score * 0.33));
    confidence += sourceScore;
    factors.sourceMatch = best.score >= 40; // At least source matched
    factors.dateMatch = best.score >= 70;   // Source + date matched
    factors.regimeMatch = best.score >= 80; // Source + date + regime matched

    // Factor 3: Price deviation (30 points max)
    if (extractedUnitCost > 0 && matchedUnitCost > 0) {
        const deviation = Math.abs((extractedUnitCost - matchedUnitCost) / matchedUnitCost) * 100;
        factors.priceDeviation = Math.round(deviation * 100) / 100;
        if (deviation <= 5) confidence += 30;        // Excellent match
        else if (deviation <= 15) confidence += 20;  // Good match
        else if (deviation <= 30) confidence += 10;  // Moderate deviation
        else confidence += 0;                        // Large deviation
    } else {
        confidence += 15; // Can't compare prices, neutral
    }

    // Factor 4: Warning penalty (-5 per non-regime warning)
    const nonRegimeWarnings = best.warnings.filter(w => !w.includes('regime') && !w.includes('similaridade')).length;
    confidence -= nonRegimeWarnings * 5;

    // Clamp
    confidence = Math.max(0, Math.min(100, confidence));

    const confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' =
        confidence >= 75 ? 'HIGH' :
        confidence >= 50 ? 'MEDIUM' : 'LOW';

    return { confidence, confidenceLevel, factors };
}

export function chooseBestCandidate(
    candidates: any[],
    item: any,
    config: EngineeringConfig | undefined,
    targetDate: { year: number; month: number } | null
): { candidate: any; score: number; warnings: string[]; matchMethod?: EngineeringPriceAudit['matchMethod']; confidence?: number } | null {
    if (candidates.length === 0) return null;
    const desiredDesonerado = config?.regimeOneracao
        ? String(config.regimeOneracao).toUpperCase() === 'DESONERADO'
        : null;
    const sameRegime = desiredDesonerado === null
        ? candidates
        : candidates.filter(candidate => Boolean(candidate.database?.payrollExemption) === desiredDesonerado);
    const pool = sameRegime.length > 0 ? sameRegime : candidates;
    const desiredType = String(item.type || '').toUpperCase();
    return pool
        .map(candidate => {
            const scored = buildCandidateScore(candidate, item.sourceName, config, targetDate);
            const matchType = String(candidate.matchType || '').toUpperCase();
            const typeBonus = desiredType === 'COMPOSICAO' && matchType === 'COMPOSICAO'
                ? 5
                : desiredType === 'INSUMO' && matchType === 'INSUMO'
                    ? 5
                    : 0;
            return { candidate, score: scored.score + typeBonus, warnings: scored.warnings };
        })
        .sort((a, b) => b.score - a.score)[0];
}

// ── Main Enrichment Function ──

function buildDatabaseWhere(options?: PriceEnrichmentOptions) {
    const or: any[] = [{ type: 'OFICIAL' }];
    if (options?.tenantId && options.includeOwnTenantDatabase !== false) {
        or.push({ tenantId: options.tenantId });
    }
    return { OR: or };
}

function semanticAccessSql(options?: PriceEnrichmentOptions) {
    if (options?.tenantId && options.includeOwnTenantDatabase !== false) {
        return Prisma.sql`AND (d.type = 'OFICIAL' OR d."tenantId" = ${options.tenantId})`;
    }
    return Prisma.sql`AND d.type = 'OFICIAL'`;
}

function semanticSourceSql(engineeringConfig?: EngineeringConfig) {
    const desiredSources = Array.isArray(engineeringConfig?.basesConsideradas)
        ? engineeringConfig.basesConsideradas.map((b: string) => normalizeSourceName(b)).filter(Boolean)
        : [];
    if (desiredSources.length === 0) return Prisma.empty;
    return Prisma.sql`AND UPPER(d.name) IN (${Prisma.join(desiredSources)})`;
}

async function semanticFallbackMatch(
    item: any,
    engineeringConfig: EngineeringConfig | undefined,
    targetDate: { year: number; month: number } | null,
    options?: PriceEnrichmentOptions
) {
    if (!item.description || item.description.length < 5) return null;
    
    try {
        const accessFilter = semanticAccessSql(options);
        const sourceFilter = semanticSourceSql(engineeringConfig);
        const compRows: any[] = await prisma.$queryRaw`
            SELECT c.id, c.code, c.description, c.unit, c."totalPrice" as "matchedPrice", 'COMPOSICAO' as "matchType", similarity(c.description, ${item.description}) as sim
            FROM "EngineeringComposition" c
            INNER JOIN "EngineeringDatabase" d ON d.id = c."databaseId"
            WHERE c.description % ${item.description}
              AND similarity(c.description, ${item.description}) > 0.78
              ${accessFilter}
              ${sourceFilter}
            ORDER BY sim DESC LIMIT 5
        `;
        
        const itemRows: any[] = await prisma.$queryRaw`
            SELECT i.id, i.code, i.description, i.unit, i.price as "matchedPrice", 'INSUMO' as "matchType", similarity(i.description, ${item.description}) as sim
            FROM "EngineeringItem" i
            INNER JOIN "EngineeringDatabase" d ON d.id = i."databaseId"
            WHERE i.description % ${item.description}
              AND similarity(i.description, ${item.description}) > 0.78
              ${accessFilter}
              ${sourceFilter}
            ORDER BY sim DESC LIMIT 5
        `;

        if (compRows.length === 0 && itemRows.length === 0) return null;

        const allSimCandidates = [...compRows, ...itemRows].sort((a, b) => b.sim - a.sim);
        
        const compIds = compRows.map(c => c.id);
        const itemIds = itemRows.map(i => i.id);

        const [dbComps, dbItems] = await Promise.all([
            compIds.length > 0 ? prisma.engineeringComposition.findMany({
                where: { id: { in: compIds } },
                include: { database: { select: { id: true, tenantId: true, type: true, name: true, uf: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } } }
            }) : Promise.resolve([]),
            itemIds.length > 0 ? prisma.engineeringItem.findMany({
                where: { id: { in: itemIds } },
                include: { database: { select: { id: true, tenantId: true, type: true, name: true, uf: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } } }
            }) : Promise.resolve([])
        ]);

        const fullCandidates = [];
        for (const sim of allSimCandidates) {
            let full;
            if (sim.matchType === 'COMPOSICAO') full = dbComps.find(c => c.id === sim.id);
            if (sim.matchType === 'INSUMO') full = dbItems.find(i => i.id === sim.id);
            if (full) {
                fullCandidates.push({
                    ...full,
                    matchType: sim.matchType,
                    matchedPrice: Number(sim.matchedPrice) || 0,
                    similarityScore: sim.sim
                });
            }
        }

        const best = chooseBestCandidate(fullCandidates, item, engineeringConfig, targetDate);
        if (best) {
            const confidence = Math.round((Number(best.candidate.similarityScore) || 0) * 100);
            best.warnings.push(`Match sugerido por similaridade de descrição (${confidence}%) — exige revisão manual`);
            best.matchMethod = 'description_similarity';
            best.confidence = confidence;
            return confidence >= 78 ? best : null;
        }
    } catch (e: any) {
        console.error('Semantic match fallback failed:', e.message);
    }
    return null;
}

export async function enrichWithOfficialPrices(
    items: any[],
    engineeringConfig?: EngineeringConfig,
    options: PriceEnrichmentOptions = {}
): Promise<{ matched: number; total: number }> {
    const itemsWithCode = items.filter(it => it.type !== 'ETAPA' && it.type !== 'SUBETAPA' && it.code && it.code !== 'N/A');
    const itemsWithoutCode = items.filter(it => it.type !== 'ETAPA' && it.type !== 'SUBETAPA' && (!it.code || it.code === 'N/A'));
    
    if (itemsWithCode.length === 0 && itemsWithoutCode.length === 0) return { matched: 0, total: 0 };

    const codes = [...new Set(itemsWithCode.flatMap(it => buildCodeVariants(it.code)))];

    const [dbItems, dbComps] = await Promise.all([
        prisma.engineeringItem.findMany({
            where: { code: { in: codes, mode: 'insensitive' }, database: buildDatabaseWhere(options) },
            include: { database: { select: { id: true, tenantId: true, type: true, name: true, uf: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } } },
        }),
        prisma.engineeringComposition.findMany({
            where: { code: { in: codes, mode: 'insensitive' }, database: buildDatabaseWhere(options) },
            include: { database: { select: { id: true, tenantId: true, type: true, name: true, uf: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } } },
        }),
    ]);

    const byCode = new Map<string, any[]>();
    for (const dbItem of dbItems) {
        const candidate = { ...dbItem, matchType: 'INSUMO', matchedPrice: Number(dbItem.price) || 0 };
        for (const keyVariant of buildCodeVariants(dbItem.code)) {
            const key = keyVariant.toLowerCase();
            byCode.set(key, [...(byCode.get(key) || []), candidate]);
        }
    }
    for (const dbComp of dbComps) {
        const candidate = { ...dbComp, matchType: 'COMPOSICAO', matchedPrice: Number(dbComp.totalPrice) || 0 };
        for (const keyVariant of buildCodeVariants(dbComp.code)) {
            const key = keyVariant.toLowerCase();
            byCode.set(key, [...(byCode.get(key) || []), candidate]);
        }
    }

    const targetDate = parseDataBaseMonth(engineeringConfig?.dataBase);
    let matched = 0;
    const unmatchedItems: any[] = [...itemsWithoutCode];

    for (const item of itemsWithCode) {
        const codeLower = normalizeOfficialCode(item.code).toLowerCase();
        const extractedUnitCost = Number(item.unitCost) || 0;
        const candidates = byCode.get(codeLower) || [];
        const best = chooseBestCandidate(candidates, item, engineeringConfig, targetDate);

        if (!best) {
            unmatchedItems.push(item);
            continue;
        }

        best.matchMethod = 'code_exact';
        const matchedPrice = Number(best.candidate.matchedPrice) || 0;
        const confidenceResult = calculateMatchConfidence(best, extractedUnitCost, matchedPrice);
        best.confidence = confidenceResult.confidence;
        (best as any)._confidenceLevel = confidenceResult.confidenceLevel;
        (best as any)._confidenceFactors = confidenceResult.factors;
        applyBestCandidate(item, best, extractedUnitCost);
        matched++;
    }

    if (options.allowSemanticFallback === false) {
        for (const item of unmatchedItems) {
            const extractedUnitCost = Number(item.unitCost) || 0;
            item.priceAudit = {
                status: 'SEM_MATCH' as EngineeringPriceAuditStatus,
                extractedUnitCost,
                matchedUnitCost: null,
                matchMethod: 'none',
                confidence: 0,
                deltaValue: null,
                deltaPercent: null,
                warnings: ['código não encontrado nas bases permitidas'],
            };
        }
        return { matched, total: itemsWithCode.length + itemsWithoutCode.length };
    }

    for (const item of unmatchedItems) {
        const extractedUnitCost = Number(item.unitCost) || 0;
        const best = await semanticFallbackMatch(item, engineeringConfig, targetDate, options);

        if (!best) {
            item.priceAudit = {
                status: 'SEM_MATCH' as EngineeringPriceAuditStatus,
                extractedUnitCost,
                matchedUnitCost: null,
                matchMethod: 'none',
                confidence: 0,
                deltaValue: null,
                deltaPercent: null,
                warnings: ['código não encontrado e sem similaridade textual confiável nas bases permitidas'],
            };
            continue;
        }

        applyBestCandidate(item, best, extractedUnitCost);
        matched++;
    }

    return { matched, total: itemsWithCode.length + itemsWithoutCode.length };
}

function applyBestCandidate(item: any, best: any, extractedUnitCost: number) {
    const matchedCandidate = best.candidate;
    const matchedUnitCost = Number(matchedCandidate.matchedPrice) || 0;
    const matchMethod = best.matchMethod || 'code_exact';
    const regimeMismatch = best.warnings.some((warning: string) => warning.includes('regime'));
    const deltaValue = !regimeMismatch && extractedUnitCost > 0 && matchedUnitCost > 0 ? extractedUnitCost - matchedUnitCost : null;
    const deltaPercent = deltaValue !== null && matchedUnitCost > 0 ? (deltaValue / matchedUnitCost) * 100 : null;
    const hasRelevantDelta = !regimeMismatch && Math.abs(deltaValue || 0) > 0.01;
    const status: EngineeringPriceAuditStatus = matchMethod === 'description_similarity'
        ? 'BASE_INCOMPATIVEL'
        : regimeMismatch
        ? 'BASE_INCOMPATIVEL'
        : hasRelevantDelta
        ? 'DIVERGENT'
        : best.warnings.length > 0 && !best.warnings.some((w: string) => w.includes('similaridade'))
            ? 'BASE_INCOMPATIVEL'
            : 'OK';

    // Mantém o preço extraído do edital. Só completa metadados seguros.
    if (matchMethod === 'code_exact') {
        if (!item.unit || item.unit === 'UN') item.unit = matchedCandidate.unit || item.unit;
        if ((!item.sourceName || item.sourceName === 'PROPRIA') && matchedCandidate.database?.name) item.sourceName = matchedCandidate.database.name;
        if (matchedCandidate.matchType === 'COMPOSICAO') item.type = 'COMPOSICAO';
    }

    item.priceAudit = {
        status,
        extractedUnitCost,
        matchedUnitCost,
        matchedDatabaseId: matchedCandidate.database?.id || null,
        matchedCode: matchedCandidate.code || null,
        matchedSourceName: matchedCandidate.database?.name || null,
        matchedUf: matchedCandidate.database?.uf || null,
        matchedReference: formatReference(matchedCandidate.database),
        matchedPayrollExemption: Boolean(matchedCandidate.database?.payrollExemption),
        matchMethod,
        confidence: typeof best.confidence === 'number' ? best.confidence : (status === 'OK' ? 98 : 82),
        confidenceLevel: best._confidenceLevel || (status === 'OK' ? 'HIGH' : 'MEDIUM'),
        confidenceFactors: best._confidenceFactors || undefined,
        analyticalDatabaseId: null,  // Will be populated by composition lookup if needed
        deltaValue,
        deltaPercent,
        warnings: best.warnings,
    };
}
