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
import { normalizeCode, buildCodeVariants, buildFuzzyCodeNeighbors } from './codeNormalizer';

// ── Types ──
export type EngineeringPriceAuditStatus = 'OK' | 'DIVERGENT' | 'SEM_MATCH' | 'BASE_INCOMPATIVEL' | 'BASE_INDISPONIVEL';

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
    dataBases?: Record<string, string>; // "SINAPI" -> "2026-04"
    ufReferencia?: string;   // UF da obra/base de referência, ex: "PA"
    regimeOneracao?: string; // "ONERADO" | "DESONERADO"
    basesConsideradas?: string[]; // ["SINAPI", "SEINFRA", "SICOR"]
    [key: string]: any;
}

export interface PriceEnrichmentOptions {
    tenantId?: string | null;
    includeOwnTenantDatabase?: boolean;
    allowSemanticFallback?: boolean;
    proposalId?: string;
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

function normalizeSourceName(sourceName: string): string {
    const source = String(sourceName || '').trim().toUpperCase();
    if (source === 'SICOR-MG' || source === 'SICOR MG' || source === 'DER-MG' || source === 'DER MG') return 'SICOR';
    return source;
}

/**
 * Dice coefficient bigram similarity for description comparison.
 * Used for fuzzy code neighbor validation.
 */
function getDescriptionSimilarity(str1: string, str2: string): number {
    const s1 = String(str1 || '').trim().toLowerCase();
    const s2 = String(str2 || '').trim().toLowerCase();
    if (s1 === s2) return 1.0;
    if (s1.length < 2 || s2.length < 2) return 0.0;
    const bigrams1: string[] = [];
    for (let i = 0; i < s1.length - 1; i++) bigrams1.push(s1.substring(i, i + 2));
    const bigrams2: string[] = [];
    for (let i = 0; i < s2.length - 1; i++) bigrams2.push(s2.substring(i, i + 2));
    const map2 = new Map<string, number>();
    for (const b of bigrams2) map2.set(b, (map2.get(b) || 0) + 1);
    let intersection = 0;
    for (const b of bigrams1) {
        const count = map2.get(b) || 0;
        if (count > 0) { intersection++; map2.set(b, count - 1); }
    }
    return (2.0 * intersection) / (bigrams1.length + bigrams2.length);
}

function normalizeUf(value?: string | null): string {
    const uf = String(value || '').trim().toUpperCase();
    const match = uf.match(/[A-Z]{2}/);
    return match ? match[0] : '';
}

function getTargetDateForSource(config: EngineeringConfig | undefined, sourceName: string, fallback: { year: number; month: number } | null) {
    const normalizedSource = normalizeSourceName(sourceName);
    const sourceSpecific = config?.dataBases?.[normalizedSource]
        || config?.dataBases?.[sourceName]
        || config?.dataBases?.[String(sourceName || '').toUpperCase()];
    return parseDataBaseMonth(sourceSpecific || config?.dataBase) || fallback;
}

export function buildCandidateScore(
    candidate: any,
    sourceName: string,
    config: EngineeringConfig | undefined,
    targetDate: { year: number; month: number } | null
): { score: number; warnings: string[] } {
    const db = candidate.database || {};
    const dbName = String(db.name || '').toUpperCase();
    const effectiveTargetDate = getTargetDateForSource(config, dbName, targetDate);
    const desiredUf = normalizeUf(config?.ufReferencia || config?.uf || config?.estado);
    const candidateUf = normalizeUf(db.uf);
    const desiredSources = Array.isArray(config?.basesConsideradas)
        ? config.basesConsideradas.map((b: string) => normalizeSourceName(b))
        : [];
    const desiredDesonerado = config?.regimeOneracao
        ? String(config.regimeOneracao).toUpperCase() === 'DESONERADO'
        : null;

    let score = 0;
    const warnings: string[] = [];
    const itemSource = normalizeSourceName(sourceName);
    const itemIsPropria = itemSource === 'PROPRIA' || itemSource.startsWith('PROPRIA_');
    const dbIsPropria = dbName === 'PROPRIA' || dbName.startsWith('PROPRIA_');

    // Source match scoring
    if (itemIsPropria && dbIsPropria) {
        score += 40;
    } else if (itemSource && !itemIsPropria && dbName === itemSource) {
        score += 40;
    } else if (desiredSources.includes(dbName)) {
        score += 20;
    } else if ((itemSource && !itemIsPropria) || desiredSources.length > 0) {
        warnings.push('fonte fora das bases configuradas');
    }

    // UF match scoring. SINAPI/SICRO/SBC/SEINFRA are state-sensitive; without
    // this, equal code/date/regime candidates can randomly fall back to another UF.
    if (desiredUf && candidateUf) {
        if (candidateUf === desiredUf) score += 35;
        else warnings.push(`UF incompatível (${candidateUf}, esperado ${desiredUf})`);
    }

    // Date match scoring
    // FIX DATE-02: SEINFRA uses version-based numbering (028, 028.1) instead of
    // monthly cadence like SINAPI. When a base has no referenceMonth/Year but has
    // a version, give partial date credit and don't produce 'data-base incompatível'.
    if (effectiveTargetDate) {
        const hasRefDate = db.referenceYear && db.referenceMonth;
        const exactDate = hasRefDate && db.referenceYear === effectiveTargetDate.year && db.referenceMonth === effectiveTargetDate.month;
        const versionDate = String(db.version || '').includes(`${String(effectiveTargetDate.month).padStart(2, '0')}/${effectiveTargetDate.year}`)
            || String(db.version || '').includes(`${effectiveTargetDate.year}-${String(effectiveTargetDate.month).padStart(2, '0')}`);
        const isVersionBased = !hasRefDate && db.version && /^\d{3}/.test(String(db.version));
        if (exactDate || versionDate) score += 30;
        else if (isVersionBased) {
            // Bases like SEINFRA 028 don't have monthly dates — give partial credit
            score += 15;
        } else if (hasRefDate) {
            // Has ref date but it doesn't match — genuine mismatch
            warnings.push(`data-base incompatível (${formatReference(db)})`);
        } else {
            warnings.push(`data-base incompatível (${formatReference(db)})`);
        }
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
            const scored = buildCandidateScore(candidate, item.sourceName || item.source || '', config, targetDate);
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

function buildDatabaseWhere(config?: EngineeringConfig, options?: PriceEnrichmentOptions) {
    const or: any[] = [];
    const desiredOfficialBases = Array.isArray(config?.basesConsideradas)
        ? config.basesConsideradas.filter((b: string) => b && b.toUpperCase() !== 'PROPRIA')
        : [];
    
    if (desiredOfficialBases.length > 0) {
        or.push({
            type: 'OFICIAL',
            name: { in: desiredOfficialBases }
        });
    } else {
        or.push({ type: 'OFICIAL' });
    }

    if (options?.tenantId && options.includeOwnTenantDatabase !== false) {
        if (options.proposalId) {
            or.push({
                tenantId: options.tenantId,
                name: { in: ['PROPRIA', `PROPRIA_${options.proposalId}`] }
            });
        } else {
            or.push({ tenantId: options.tenantId });
        }
    }
    return { OR: or };
}

function semanticAccessSql(options?: PriceEnrichmentOptions) {
    if (options?.tenantId && options.includeOwnTenantDatabase !== false) {
        if (options.proposalId) {
            const allowedNames = ['PROPRIA', `PROPRIA_${options.proposalId}`];
            return Prisma.sql`AND (d.type = 'OFICIAL' OR (d."tenantId" = ${options.tenantId} AND d.name IN (${Prisma.join(allowedNames)})))`;
        }
        return Prisma.sql`AND (d.type = 'OFICIAL' OR d."tenantId" = ${options.tenantId})`;
    }
    return Prisma.sql`AND d.type = 'OFICIAL'`;
}

function semanticSourceSql(engineeringConfig?: EngineeringConfig, itemSourceName?: string) {
    const bases = Array.isArray(engineeringConfig?.basesConsideradas)
        ? [...engineeringConfig.basesConsideradas]
        : [];
    if (itemSourceName) {
        bases.push(itemSourceName);
    }
    const desiredSources = [...new Set(bases.map((b: string) => normalizeSourceName(b)).filter(Boolean))];
    if (desiredSources.length === 0) return Prisma.empty;
    return Prisma.sql`AND UPPER(d.name) IN (${Prisma.join(desiredSources)})`;
}

// FIX TRGM-01: Cache pg_trgm availability to avoid dozens of prisma:error per extraction.
// The similarity() function requires CREATE EXTENSION pg_trgm. If it's not available,
// the semantic fallback silently returns null instead of generating error noise.
let _pgTrgmAvailable: boolean | null = null;

async function isPgTrgmAvailable(): Promise<boolean> {
    if (_pgTrgmAvailable !== null) return _pgTrgmAvailable;
    try {
        await prisma.$queryRaw`SELECT similarity('test', 'test')`;
        _pgTrgmAvailable = true;
        console.log('[PriceEnricher] ✅ pg_trgm extension available — semantic fallback enabled');
    } catch {
        _pgTrgmAvailable = false;
        console.warn('[PriceEnricher] ⚠️ pg_trgm extension NOT available — semantic fallback disabled. Run: CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    }
    return _pgTrgmAvailable;
}

async function semanticFallbackMatch(
    item: any,
    engineeringConfig: EngineeringConfig | undefined,
    targetDate: { year: number; month: number } | null,
    options?: PriceEnrichmentOptions
) {
    if (!item.description || item.description.length < 5) return null;
    
    // FIX TRGM-01: Skip silently if pg_trgm is not installed
    if (!(await isPgTrgmAvailable())) return null;
    
    try {
        const accessFilter = semanticAccessSql(options);
        const sourceFilter = semanticSourceSql(engineeringConfig, item.sourceName || item.source);
        const compRows: any[] = await prisma.$queryRaw`
            SELECT c.id, c.code, c.description, c.unit, c."totalPrice" as "matchedPrice", 'COMPOSICAO' as "matchType", similarity(c.description, ${item.description}) as sim
            FROM "EngineeringComposition" c
            INNER JOIN "EngineeringDatabase" d ON d.id = c."databaseId"
            WHERE c.description % ${item.description}
              AND similarity(c.description, ${item.description}) > 0.55
              ${accessFilter}
              ${sourceFilter}
            ORDER BY sim DESC LIMIT 5
        `;
        
        const itemRows: any[] = await prisma.$queryRaw`
            SELECT i.id, i.code, i.description, i.unit, i.price as "matchedPrice", 'INSUMO' as "matchType", similarity(i.description, ${item.description}) as sim
            FROM "EngineeringItem" i
            INNER JOIN "EngineeringDatabase" d ON d.id = i."databaseId"
            WHERE i.description % ${item.description}
              AND similarity(i.description, ${item.description}) > 0.55
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
            return confidence >= 60 ? best : null;
        }
    } catch (e: any) {
        // If the error is about pg_trgm, cache it so we don't retry
        if (e.message?.includes('similarity') || e.code === '42883') {
            _pgTrgmAvailable = false;
            console.warn('[PriceEnricher] ⚠️ pg_trgm not available, disabling semantic fallback');
        } else {
            console.error('Semantic match fallback failed:', e.message);
        }
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

    const codes = [...new Set(itemsWithCode.flatMap(it => buildCodeVariants(it.code, it.sourceName || it.source)))];

    // DIAG-01: Log enrichment parameters for debugging match failures
    const sampleCodes = codes.slice(0, 8).join(', ');
    console.log(`[PriceEnricher] 🔍 Enrichment started: ${itemsWithCode.length} items with code, ${itemsWithoutCode.length} without code`);
    console.log(`[PriceEnricher] 🔍 Config: dataBase=${engineeringConfig?.dataBase || 'N/A'}, uf=${engineeringConfig?.ufReferencia || engineeringConfig?.uf || engineeringConfig?.estado || 'N/A'}, regime=${engineeringConfig?.regimeOneracao || 'N/A'}, bases=${(engineeringConfig?.basesConsideradas || []).join(',') || 'N/A'}`);
    console.log(`[PriceEnricher] 🔍 Searching ${codes.length} code variants: [${sampleCodes}${codes.length > 8 ? '...' : ''}]`);

    const [dbItems, dbComps] = await Promise.all([
        prisma.engineeringItem.findMany({
            where: { code: { in: codes, mode: 'insensitive' }, database: buildDatabaseWhere(engineeringConfig, options) },
            include: { database: { select: { id: true, tenantId: true, type: true, name: true, uf: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } } },
        }),
        prisma.engineeringComposition.findMany({
            where: { code: { in: codes, mode: 'insensitive' }, database: buildDatabaseWhere(engineeringConfig, options) },
            include: { database: { select: { id: true, tenantId: true, type: true, name: true, uf: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } } },
        }),
    ]);

    // DIAG-02: Log what was found in the database
    console.log(`[PriceEnricher] 📊 DB results: ${dbItems.length} items, ${dbComps.length} compositions found`);
    if (dbItems.length + dbComps.length === 0) {
        console.log(`[PriceEnricher] ⚠️ ZERO matches in DB! Possible causes: base not imported, wrong code format, or database filter too strict`);
        // List all OFICIAL databases for diagnostic
        try {
            const allDbs = await prisma.engineeringDatabase.findMany({ where: buildDatabaseWhere(engineeringConfig, options), select: { name: true, uf: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } });
            const dbNames = [...new Set(allDbs.map(d => `${d.name}/${d.uf || '?'}/${d.version || '?'}/${d.referenceYear || '?'}-${d.referenceMonth || '?'}/desoneracao:${d.payrollExemption}`))];
            console.log(`[PriceEnricher] 📚 Available databases (${allDbs.length}): ${dbNames.slice(0, 10).join(' | ')}`);
        } catch {}
    } else {
        const dbSources = [...new Set([...dbItems, ...dbComps].map(d => `${d.database.name}/${d.database.uf}/${d.database.referenceYear}-${d.database.referenceMonth}`))];
        console.log(`[PriceEnricher] 📚 Sources found: ${dbSources.join(', ')}`);
    }

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

    const targetDate = parseDataBaseMonth(engineeringConfig?.dataBase);
    let matched = 0;
    const unmatchedItems: any[] = [...itemsWithoutCode];

    for (const item of itemsWithCode) {
        const codeLower = normalizeCode(item.code, item.sourceName || item.source).toLowerCase();
        const extractedUnitCost = Number(item.unitCost) || 0;
        let candidates = byCode.get(codeLower) || [];
        if (candidates.length === 0) {
            const variants = buildCodeVariants(item.code, item.sourceName || item.source);
            for (const v of variants) {
                const c = byCode.get(v.toLowerCase());
                if (c) candidates.push(...c);
            }
        }
        let best = chooseBestCandidate(candidates, item, engineeringConfig, targetDate);

        // Strategy 1.5: Fuzzy Code Neighbors + Description Confirmation
        // When AI/OCR gets a digit wrong (e.g., 100862 vs 100861), try neighboring codes
        if (!best && item.code && item.description) {
            const fuzzyNeighbors = buildFuzzyCodeNeighbors(item.code, item.sourceName || item.source);
            const fuzzyPool: any[] = [];
            for (const neighbor of fuzzyNeighbors) {
                const c = byCode.get(neighbor.toLowerCase());
                if (c) fuzzyPool.push(...c);
            }
            if (fuzzyPool.length > 0) {
                let bestFuzzy: { candidate: any; sim: number } | null = null;
                for (const candidate of fuzzyPool) {
                    const sim = getDescriptionSimilarity(item.description, candidate.description);
                    if (sim >= 0.60 && (!bestFuzzy || sim > bestFuzzy.sim)) {
                        bestFuzzy = { candidate, sim };
                    }
                }
                if (bestFuzzy) {
                    const scored = buildCandidateScore(bestFuzzy.candidate, item.sourceName || item.source || '', engineeringConfig, targetDate);
                    best = { candidate: bestFuzzy.candidate, score: scored.score, warnings: scored.warnings };
                    console.log(`[PriceEnricher] ✅ FUZZY CODE "${item.code}" → corrected to "${bestFuzzy.candidate.code}" sim=${bestFuzzy.sim.toFixed(2)}`);
                }
            }
        }

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

    const chunkArray = <T>(arr: T[], size: number): T[][] => {
        const chunks: T[][] = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    };

    const chunks = chunkArray(unmatchedItems, 5);
    for (const chunk of chunks) {
        await Promise.all(chunk.map(async (item) => {
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
            } else {
                applyBestCandidate(item, best, extractedUnitCost);
                matched++;
            }
        }));
    }

    return { matched, total: itemsWithCode.length + unmatchedItems.length };
}

function applyBestCandidate(item: any, best: any, extractedUnitCost: number) {
    const matchedCandidate = best.candidate;
    const matchedUnitCost = Number(matchedCandidate.matchedPrice) || 0;
    const matchMethod = best.matchMethod || 'code_exact';
    const regimeMismatch = best.warnings.some((warning: string) => warning.includes('regime'));
    const deltaValue = !regimeMismatch && extractedUnitCost > 0 && matchedUnitCost > 0 ? extractedUnitCost - matchedUnitCost : null;
    const deltaPercent = deltaValue !== null && matchedUnitCost > 0 ? (deltaValue / matchedUnitCost) * 100 : null;
    const hasRelevantDelta = !regimeMismatch && Math.abs(deltaValue || 0) > 0.01;
    const dateMismatch = best.warnings.some((warning: string) => warning.includes('data-base'));
    let status: EngineeringPriceAuditStatus;
    if (dateMismatch && matchMethod === 'code_exact') {
        // Matched code but from WRONG data-base → can't compare reliably
        status = 'BASE_INDISPONIVEL';
    } else if (matchMethod === 'description_similarity') {
        status = 'BASE_INCOMPATIVEL';
    } else if (regimeMismatch) {
        status = 'BASE_INCOMPATIVEL';
    } else if (matchMethod === 'code_exact' && deltaPercent !== null && Math.abs(deltaPercent) < 5) {
        status = 'OK';
    } else if (hasRelevantDelta) {
        status = 'DIVERGENT';
    } else if (best.warnings.length > 0 && !best.warnings.some((w: string) => w.includes('similaridade'))) {
        status = 'BASE_INCOMPATIVEL';
    } else {
        status = 'OK';
    }

    // Mantém o preço extraído do edital. Só completa metadados seguros.
    if (matchMethod === 'code_exact') {
        if (!item.unit || item.unit === 'UN') item.unit = matchedCandidate.unit || item.unit;
        if ((!item.sourceName || item.sourceName.startsWith('PROPRIA')) && matchedCandidate.database?.name) item.sourceName = matchedCandidate.database.name;
        if (matchedCandidate.matchType === 'COMPOSICAO') item.type = 'COMPOSICAO';
    }

    // Auto-popula o custo unitário se estiver zerado e o match encontrou um valor válido
    if ((Number(item.unitCost) || 0) === 0 && matchedUnitCost > 0) {
        item.unitCost = matchedUnitCost;
        item.priceOrigin = 'BASE';
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
