/**
 * ══════════════════════════════════════════════════════════════
 *  Price Enricher — Módulo compartilhado de enriquecimento
 *  de preços contra bases oficiais (SINAPI, SEINFRA, ORSE, SICRO)
 * ══════════════════════════════════════════════════════════════
 *
 *  FIX-01: Unifica a lógica completa de enriquecimento que antes
 *  existia em duas versões divergentes:
 *    1. engineering.ts:1543 (completa — scoring multidimensional)
 *    2. engineeringExtractionHandler.ts:548 (simplificada — sem regime/data-base)
 *
 *  Agora ambos usam esta função centralizada.
 */

import { prisma } from '../../lib/prisma';

// ── Types ──
export type EngineeringPriceAuditStatus = 'OK' | 'DIVERGENT' | 'SEM_MATCH' | 'BASE_INCOMPATIVEL';

export interface EngineeringPriceAudit {
    status: EngineeringPriceAuditStatus;
    extractedUnitCost: number;
    matchedUnitCost: number | null;
    matchedDatabaseId?: string | null;
    matchedSourceName?: string | null;
    matchedUf?: string | null;
    matchedReference?: string;
    matchedPayrollExemption?: boolean;
    deltaValue: number | null;
    deltaPercent: number | null;
    warnings: string[];
}

export interface EngineeringConfig {
    dataBase?: string;       // "2026-04" — data-base do orçamento
    regimeOneracao?: string; // "ONERADO" | "DESONERADO"
    basesConsideradas?: string[]; // ["SINAPI", "SEINFRA"]
    [key: string]: any;
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
        ? config.basesConsideradas.map((b: string) => String(b).toUpperCase())
        : [];
    const desiredDesonerado = config?.regimeOneracao
        ? String(config.regimeOneracao).toUpperCase() === 'DESONERADO'
        : null;

    let score = 0;
    const warnings: string[] = [];
    const dbName = String(db.name || '').toUpperCase();
    const itemSource = String(sourceName || '').toUpperCase();

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
    const supportsPayrollRegime = ['SINAPI', 'SEINFRA'].includes(dbName);
    if (desiredDesonerado !== null && supportsPayrollRegime) {
        if (Boolean(db.payrollExemption) === desiredDesonerado) score += 20;
        else warnings.push(`regime ${db.payrollExemption ? 'desonerado' : 'onerado'} incompatível`);
    }

    return { score, warnings };
}

export function chooseBestCandidate(
    candidates: any[],
    item: any,
    config: EngineeringConfig | undefined,
    targetDate: { year: number; month: number } | null
): { candidate: any; score: number; warnings: string[] } | null {
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

/**
 * Compara itens extraídos contra bases oficiais cadastradas sem sobrescrever
 * o preço do edital. O resultado fica em item.priceAudit.
 *
 * Suporta:
 * - Múltiplos candidatos por código (mesmo código em bases diferentes)
 * - Scoring multidimensional (fonte, data-base, regime)
 * - Regime onerado/desonerado via engineeringConfig
 * - Data-base de referência via engineeringConfig
 * - Batch query (2 queries total, não N+1)
 */
export async function enrichWithOfficialPrices(items: any[], engineeringConfig?: EngineeringConfig): Promise<{ matched: number; total: number }> {
    const enrichable = items.filter(it =>
        it.type !== 'ETAPA' && it.type !== 'SUBETAPA' && it.code && it.code !== 'N/A'
    );
    if (enrichable.length === 0) return { matched: 0, total: 0 };

    const codes = [...new Set(enrichable.flatMap(it => buildCodeVariants(it.code)))];

    // Batch fetch all matching items (2 queries total instead of 2N)
    const [dbItems, dbComps] = await Promise.all([
        prisma.engineeringItem.findMany({
            where: { code: { in: codes, mode: 'insensitive' } },
            include: { database: { select: { id: true, name: true, uf: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } } },
        }),
        prisma.engineeringComposition.findMany({
            where: { code: { in: codes, mode: 'insensitive' } },
            include: { database: { select: { id: true, name: true, uf: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } } },
        }),
    ]);

    // Build arrays per code (same code may exist in multiple DBs)
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

    for (const item of enrichable) {
        const codeLower = normalizeOfficialCode(item.code).toLowerCase();
        const extractedUnitCost = Number(item.unitCost) || 0;
        const candidates = byCode.get(codeLower) || [];
        const best = chooseBestCandidate(candidates, item, engineeringConfig, targetDate);

        if (!best) {
            item.priceAudit = {
                status: 'SEM_MATCH' as EngineeringPriceAuditStatus,
                extractedUnitCost,
                matchedUnitCost: null,
                deltaValue: null,
                deltaPercent: null,
                warnings: ['código não encontrado nas bases oficiais cadastradas'],
            };
            continue;
        }

        const matchedCandidate = best.candidate;
        const matchedUnitCost = Number(matchedCandidate.matchedPrice) || 0;
        const regimeMismatch = best.warnings.some((warning: string) => warning.includes('regime'));
        const deltaValue = !regimeMismatch && extractedUnitCost > 0 && matchedUnitCost > 0 ? extractedUnitCost - matchedUnitCost : null;
        const deltaPercent = deltaValue !== null && matchedUnitCost > 0 ? (deltaValue / matchedUnitCost) * 100 : null;
        const hasRelevantDelta = !regimeMismatch && Math.abs(deltaValue || 0) > 0.01;
        const status: EngineeringPriceAuditStatus = regimeMismatch
            ? 'BASE_INCOMPATIVEL'
            : hasRelevantDelta
            ? 'DIVERGENT'
            : best.warnings.length > 0
                ? 'BASE_INCOMPATIVEL'
                : 'OK';

        // Mantém o preço extraído do edital. Só completa metadados seguros.
        if (!item.unit || item.unit === 'UN') item.unit = matchedCandidate.unit || item.unit;
        if ((!item.sourceName || item.sourceName === 'PROPRIA') && matchedCandidate.database?.name) item.sourceName = matchedCandidate.database.name;
        if (matchedCandidate.matchType === 'COMPOSICAO') item.type = 'COMPOSICAO';

        item.priceAudit = {
            status,
            extractedUnitCost,
            matchedUnitCost,
            matchedDatabaseId: matchedCandidate.database?.id || null,
            matchedSourceName: matchedCandidate.database?.name || null,
            matchedUf: matchedCandidate.database?.uf || null,
            matchedReference: formatReference(matchedCandidate.database),
            matchedPayrollExemption: Boolean(matchedCandidate.database?.payrollExemption),
            deltaValue,
            deltaPercent,
            warnings: best.warnings,
        };
        matched++;
    }

    return { matched, total: enrichable.length };
}
