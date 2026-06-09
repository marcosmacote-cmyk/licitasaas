/**
 * proposalEditorHelpers.ts — Pure utility functions extracted from EngineeringProposalEditor.
 *
 * G9-PREP: Reduces the 3880-line monolith by extracting ~375 lines of helpers.
 * Covers: renumbering, base filtering, price audit badge, type metadata.
 */
import { CheckCircle2, AlertTriangle, FolderOpen, GitBranch, Layers, Package } from 'lucide-react';
import { applyPrecision } from './precisionEngine';
import type { EngItem, EngItemType, EngineeringConfig, PriceAudit } from './types';
import { isGrouper, getDepth } from './types';

// ── Renumeração hierárquica automática ──
export function renumberItems(items: EngItem[]): EngItem[] {
    let etapaIdx = 0;
    let subetapaIdx = 0;
    let itemIdx = 0;
    let currentEtapa = 0;
    let currentSubetapa = 0;

    return items.map(it => {
        if (it.type === 'ETAPA') {
            etapaIdx++;
            subetapaIdx = 0;
            itemIdx = 0;
            currentEtapa = etapaIdx;
            currentSubetapa = 0;
            return { ...it, itemNumber: `${etapaIdx}.0` };
        }
        if (it.type === 'SUBETAPA') {
            subetapaIdx++;
            itemIdx = 0;
            currentSubetapa = subetapaIdx;
            return { ...it, itemNumber: `${currentEtapa || 1}.${subetapaIdx}` };
        }
        // COMPOSICAO / INSUMO
        itemIdx++;
        if (currentSubetapa > 0) {
            return { ...it, itemNumber: `${currentEtapa || 1}.${currentSubetapa}.${itemIdx}` };
        }
        if (currentEtapa > 0) {
            return { ...it, itemNumber: `${currentEtapa}.${itemIdx}` };
        }
        return { ...it, itemNumber: String(itemIdx) };
    });
}

export const TYPE_META: Record<EngItemType, { label: string; color: string; bg: string; icon: typeof FolderOpen }> = {
    ETAPA:      { label: 'Etapa',       color: '#1e40af', bg: 'rgba(30,64,175,0.08)',  icon: FolderOpen },
    SUBETAPA:   { label: 'Subetapa',    color: '#6d28d9', bg: 'rgba(109,40,217,0.06)', icon: GitBranch },
    COMPOSICAO: { label: 'Composição',  color: '#0e7490', bg: 'rgba(14,116,144,0.06)', icon: Layers },
    INSUMO:     { label: 'Insumo',      color: '#b45309', bg: 'rgba(180,83,9,0.06)',   icon: Package },
};

export const BRAZILIAN_UFS = [
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
    'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
];

/** Computes the subtotal for a grouper (ETAPA/SUBETAPA) by summing
 * totalPrice of all child items until the next grouper of same/higher depth. */
export function computeGrouperSubtotal(items: EngItem[], grouperIndex: number): number {
    const grouper = items[grouperIndex];
    const grouperDepth = getDepth(grouper.itemNumber);
    let total = 0;
    for (let i = grouperIndex + 1; i < items.length; i++) {
        const it = items[i];
        if (isGrouper(it.type) && getDepth(it.itemNumber) <= grouperDepth) break; // Next grouper of same/higher level
        if (!isGrouper(it.type)) total += it.totalPrice || 0;
    }
    return total;
}



export const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const token = () => localStorage.getItem('token') || '';
export const hdrs = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });
export const hasPositiveNumber = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;

export function parseLocaleNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    const raw = String(value ?? '').trim();
    if (!raw) return fallback;
    const normalized = raw.includes(',')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function hasEditalPriceSnapshot(item: EngItem): boolean {
    return item.priceOrigin === 'EDITAL'
        && !isGrouper(item.type)
        && (hasPositiveNumber(item.officialUnitPrice) || hasPositiveNumber(item.officialTotalPrice));
}

/**
 * Bases that use version-based identification instead of monthly data-base cadence.
 * SEINFRA uses 028 (Onerada) / 028.1 (Desonerada) — no monthly reference.
 * This affects: dropdown labels, Step 1 date config, and base filtering.
 */
export const VERSION_BASED_BASES = ['SEINFRA', 'SICRO', 'SBC'];

export function isVersionBasedBase(name: string): boolean {
    return VERSION_BASED_BASES.some(vb => name.toUpperCase().includes(vb));
}

export function cleanBasesConsideradas(bases: any[]): string[] {
    if (!Array.isArray(bases)) return ['SINAPI'];
    const validMap: Record<string, string> = {
        'SINAPI': 'SINAPI',
        'SEINFRA': 'SEINFRA',
        'SICOR': 'SICOR',
        'SICOR-MG': 'SICOR',
        'SICOR MG': 'SICOR',
        'DER-MG': 'SICOR',
        'DER MG': 'SICOR',
        'ORSE': 'ORSE',
        'SICRO': 'SICRO',
        'SINCRO': 'SICRO',
        'SICRO NOVO': 'SICRO',
        'SICRO-NOVO': 'SICRO',
        'DNIT': 'SICRO',
        'SBC': 'SBC',
        'PROPRIA': 'PROPRIA',
        'PRÓPRIA': 'PROPRIA'
    };
    const cleaned = bases.map(b => {
        const key = String(b || '').trim().toUpperCase();
        return validMap[key] || key;
    });
    const allowed = ['SINAPI', 'SEINFRA', 'SICOR', 'ORSE', 'SICRO', 'SBC', 'PROPRIA'];
    const unique = Array.from(new Set(cleaned))
        .filter(b => allowed.includes(b));
    return unique.length > 0 ? unique : ['SINAPI'];
}

/**
 * STRICT base filter — enforces Step 1 config as absolute rule.
 * Bases are shown ONLY if they match ALL criteria:
 *   1. Name matches basesConsideradas (SINAPI, SEINFRA, ORSE, PROPRIA)
 *   2. UF matches ufReferencia (or base has no UF, like PROPRIA)
 *   3. Data-base (month/year) matches the configured date for that base
 *
 * Returns { filtered, warnings } where warnings lists configured bases
 * that were not found in the system.
 */
export function filterConfigBases(allBases: any[], config: any): any[] {
    return filterConfigBasesWithWarnings(allBases, config).filtered;
}

export interface BaseFilterResult {
    filtered: any[];
    warnings: string[];
}

export function filterConfigBasesWithWarnings(allBases: any[], config: any): BaseFilterResult {
    if (!allBases || allBases.length === 0) return { filtered: [], warnings: ['Nenhuma base cadastrada no sistema.'] };

    const allowed: string[] = config?.basesConsideradas || [];
    const uf: string = (config?.ufReferencia || '').toUpperCase();
    const perBaseDates: Record<string, string> = config?.dataBases || {};

    // Regime de encargos: ONERADO → payrollExemption=false, DESONERADO → payrollExemption=true
    const regime: string = (config?.regimeOneracao || 'ONERADO').toUpperCase();
    const targetPayrollExemption = regime === 'DESONERADO';

    // If no bases configured, show nothing (strict mode)
    if (allowed.length === 0) {
        return { filtered: allBases, warnings: [] };
    }

    const result: any[] = [];
    const warnings: string[] = [];

    for (const baseName of allowed) {
        const upperName = baseName.toUpperCase();

        // PROPRIA is special — always include tenant's own base
        if (upperName === 'PROPRIA' || upperName === 'PRÓPRIA') {
            const propria = allBases.filter(b =>
                b.name.toUpperCase().includes('PROPRIA') || b.name.toUpperCase().includes('PRÓPRIA')
            );
            if (propria.length > 0) {
                result.push(...propria);
            } else {
                warnings.push(`Base "${baseName}" não encontrada no sistema.`);
            }
            continue;
        }

        // Version-based bases (SEINFRA, SICRO, SBC) use version identifiers, not monthly dates.
        // NEVER apply date filtering to these bases, even if dataBases has stale AI-extracted entries.
        const isVersionBased = VERSION_BASED_BASES.some(vb => upperName.includes(vb));
        const hasExplicitDate = !isVersionBased && !!perBaseDates[baseName];
        const targetDate = hasExplicitDate ? (perBaseDates[baseName] || '') : '';
        let targetMonth = 0;
        let targetYear = 0;
        if (targetDate) {
            const [y, m] = targetDate.split('-').map(Number);
            if (y && m) { targetYear = y; targetMonth = m; }
        }

        const hasSameNameWithMatchingUf = allBases.some(b =>
            b.name.toUpperCase().includes(upperName) && b.uf && b.uf.toUpperCase() === uf
        );

        // Step 1: Try strict match (name + UF + date + regime)
        let candidates = allBases.filter(b => {
            if (!b.name.toUpperCase().includes(upperName)) return false;
            if (hasSameNameWithMatchingUf && b.uf && b.uf.toUpperCase() !== uf) return false;
            if (hasExplicitDate && targetYear && targetMonth) {
                if (b.referenceYear !== targetYear || b.referenceMonth !== targetMonth) return false;
            }
            if (typeof b.payrollExemption === 'boolean') {
                if (b.payrollExemption !== targetPayrollExemption) return false;
            }
            return true;
        });

        // Step 2: If strict match found no results, relax regime filter.
        // Many regional bases (ORSE, CAERN, SBC) only have one import (onerado OR desonerado),
        // not both versions. Showing the available version is better than showing nothing.
        if (candidates.length === 0) {
            candidates = allBases.filter(b => {
                if (!b.name.toUpperCase().includes(upperName)) return false;
                if (hasSameNameWithMatchingUf && b.uf && b.uf.toUpperCase() !== uf) return false;
                if (hasExplicitDate && targetYear && targetMonth) {
                    if (b.referenceYear !== targetYear || b.referenceMonth !== targetMonth) return false;
                }
                // Skip regime filter in this relaxed pass
                return true;
            });
        }

        // Step 3: If still no results AND we were filtering by explicit date, try without date too.
        // This catches cases where the configured date hasn't been imported yet.
        if (candidates.length === 0 && hasExplicitDate) {
            candidates = allBases.filter(b => {
                if (!b.name.toUpperCase().includes(upperName)) return false;
                if (hasSameNameWithMatchingUf && b.uf && b.uf.toUpperCase() !== uf) return false;
                return true;
            });
            if (candidates.length > 0) {
                const datePart = targetYear && targetMonth ? ` ${String(targetMonth).padStart(2, '0')}/${targetYear}` : '';
                const ufPart = uf ? ` ${uf}` : '';
                warnings.push(`Base "${baseName}${ufPart}${datePart}" não encontrada. Exibindo versão mais recente disponível.`);
            }
        }

        if (candidates.length > 0) {
            candidates.sort((a: any, b: any) => {
                // Prefer matching regime
                const aRegime = typeof a.payrollExemption === 'boolean' && a.payrollExemption === targetPayrollExemption ? 1 : 0;
                const bRegime = typeof b.payrollExemption === 'boolean' && b.payrollExemption === targetPayrollExemption ? 1 : 0;
                if (bRegime !== aRegime) return bRegime - aRegime;
                // Then prefer bases with data
                const aHasData = ((a.itemCount || 0) + (a.compositionCount || 0)) > 0 ? 1 : 0;
                const bHasData = ((b.itemCount || 0) + (b.compositionCount || 0)) > 0 ? 1 : 0;
                if (bHasData !== aHasData) return bHasData - aHasData;
                return (b.referenceYear || 0) - (a.referenceYear || 0) || (b.referenceMonth || 0) - (a.referenceMonth || 0);
            });
            // If no explicit date, only include the most recent version to avoid duplicates
            if (!hasExplicitDate && candidates.length > 1) {
                result.push(candidates[0]);
            } else {
                result.push(...candidates);
            }
        } else {
            // Generate specific warning
            const datePart = hasExplicitDate && targetYear && targetMonth ? ` ${String(targetMonth).padStart(2, '0')}/${targetYear}` : '';
            const ufPart = uf ? ` ${uf}` : '';
            warnings.push(`Base "${baseName}${ufPart}${datePart}" não encontrada. Verifique se a base foi importada.`);
        }
    }

    return { filtered: result, warnings };
}


/**
 * Auto-select the best matching base from the filtered list.
 */
export function autoSelectBestBase(allBases: any[], config: any, setSelectedBaseId: (id: string) => void) {
    const filtered = filterConfigBases(allBases, config);
    if (filtered.length > 0) {
        setSelectedBaseId(filtered[0].id);
    } else if (allBases.length > 0) {
        setSelectedBaseId(allBases[0].id);
    }

}

export function preserveEditalPricing(item: EngItem, config: EngineeringConfig): EngItem {
    if (!hasEditalPriceSnapshot(item)) return item;

    const unitPrice = hasPositiveNumber(item.officialUnitPrice)
        ? Number(item.officialUnitPrice)
        : Number(item.unitPrice) || 0;
    const totalPrice = hasPositiveNumber(item.officialTotalPrice)
        ? Number(item.officialTotalPrice)
        : applyPrecision((Number(item.quantity) || 0) * unitPrice, config);

    return { ...item, unitPrice, totalPrice };
}

export const AUDIT_META = {
    OK: { label: 'OK', color: 'var(--color-success)', bg: 'rgba(16,185,129,0.08)' },
    DIVERGENT: { label: 'Base difere', color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
    BASE_INCOMPATIVEL: { label: 'Base incompat.', color: '#d97706', bg: 'rgba(217,119,6,0.10)' },
    BASE_INDISPONIVEL: { label: 'Data base N/D', color: '#9333ea', bg: 'rgba(147,51,234,0.08)' },
    SEM_MATCH: { label: 'Sem match', color: '#64748b', bg: 'rgba(100,116,139,0.10)' },
} as const;

export function refreshPriceAudit(item: EngItem): PriceAudit | undefined {
    const audit = item.priceAudit;
    if (!audit || typeof audit.matchedUnitCost !== 'number' || audit.matchedUnitCost <= 0) return audit;

    const extractedUnitCost = Number(item.unitCost) || 0;
    const matchedUnitCost = audit.matchedUnitCost;
    const warnings = audit.warnings || [];
    const hasRegimeMismatch = warnings.some(w => String(w).toLowerCase().includes('regime'));
    const hasDateMismatch = warnings.some(w => String(w).toLowerCase().includes('data-base'));
    const hasSimilarityMatch = warnings.some(w => String(w).toLowerCase().includes('similaridade'));
    const deltaValue = hasRegimeMismatch ? null : extractedUnitCost - matchedUnitCost;
    const deltaPercent = deltaValue !== null && matchedUnitCost > 0 ? (deltaValue / matchedUnitCost) * 100 : null;
    const hasRelevantDelta = !hasRegimeMismatch && deltaValue !== null && Math.abs(deltaValue) > 0.01;
    const isCodeExact = audit.matchMethod === 'code_exact';

    // Status logic:
    // 1. Regime mismatch → always BASE_INCOMPATIVEL (can't compare prices across regimes)
    // 2. Similarity match → always BASE_INCOMPATIVEL (needs manual review)
    // 3. Code exact + prices differ → DIVERGENT
    // 4. Code exact + prices match → OK (even with date/fonte warnings — prices confirmed)
    // 5. Code exact + date mismatch + no price comparison → BASE_INCOMPATIVEL
    let status: PriceAudit['status'];
    if (hasDateMismatch && isCodeExact) {
        // Code matched but from WRONG data-base → comparison is unreliable
        status = 'BASE_INDISPONIVEL';
    } else if (hasRegimeMismatch || hasSimilarityMatch) {
        status = 'BASE_INCOMPATIVEL';
    } else if (hasRelevantDelta) {
        status = 'DIVERGENT';
    } else if (isCodeExact && deltaPercent !== null && Math.abs(deltaPercent) < 5) {
        // Code matched exactly and prices are within 5% — this is a confirmed match
        status = 'OK';
    } else if (hasDateMismatch && !isCodeExact) {
        status = 'BASE_INDISPONIVEL';
    } else {
        status = 'OK';
    }

    return {
        ...audit,
        extractedUnitCost,
        deltaValue,
        deltaPercent,
        status,
    };
}

export function renderPriceAudit(item: EngItem, onApplyBase?: () => void) {
    const audit = refreshPriceAudit(item);
    if (!audit) return <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.68rem' }}>-</span>;
    const meta = AUDIT_META[audit.status] || AUDIT_META.SEM_MATCH;
    const delta = typeof audit.deltaPercent === 'number' ? ` (${audit.deltaPercent > 0 ? '+' : ''}${audit.deltaPercent.toFixed(2)}%)` : '';
    const hasBasePrice = typeof audit.matchedUnitCost === 'number' && audit.matchedUnitCost > 0;
    const hasRegimeMismatch = (audit.warnings || []).some(w => String(w).toLowerCase().includes('regime'));
    const title = [
        'Auditoria: comparação do custo sem BDI contra base oficial.',
        audit.matchedSourceName ? `Base: ${audit.matchedSourceName} ${audit.matchedReference || ''}` : '',
        typeof audit.matchedUnitCost === 'number' ? `Preço base: ${fmt(audit.matchedUnitCost)}` : '',
        typeof audit.extractedUnitCost === 'number' ? `Custo extraído do edital: ${fmt(audit.extractedUnitCost)}` : '',
        ...(audit.warnings || []),
    ].filter(Boolean).join('\n');

    const isDataBaseUnavailable = audit.status === 'BASE_INDISPONIVEL';
    return (
        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 4, background: meta.bg, color: meta.color, fontSize: '0.64rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
                {audit.status === 'OK' ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                {meta.label}{isDataBaseUnavailable ? '' : delta}
            </span>
            {hasBasePrice && audit.status !== 'OK' && !hasRegimeMismatch && !isDataBaseUnavailable && (
                <button
                    type="button"
                    onClick={onApplyBase}
                    title={`Aplicar preço da base: ${fmt(audit.matchedUnitCost || 0)}`}
                    style={{ border: 'none', background: 'transparent', color: meta.color, cursor: 'pointer', fontSize: '0.6rem', fontWeight: 800, padding: 0, lineHeight: 1 }}
                >
                    usar base {fmt(audit.matchedUnitCost || 0)}
                </button>
            )}
            {isDataBaseUnavailable && (
                <span style={{ fontSize: '0.58rem', color: meta.color, fontWeight: 600, fontStyle: 'italic' }}>
                    {audit.matchedReference || 'outra data'}
                </span>
            )}
        </div>
    );
}
