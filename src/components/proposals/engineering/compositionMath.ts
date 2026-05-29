/**
 * compositionMath.ts — Shared price calculation utilities for composition editor.
 *
 * G5-PREP: Extracted from CompositionEditor.tsx to reduce monolith size
 * and enable reuse in useDrillDown.ts and future sub-components.
 */
import { applyPrecision } from './precisionEngine';

export const SNAPSHOT_SUBTOTAL_KEY = '_snapshotSubtotalAuthoritative';

export const asNumber = (value: any) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const isPropriaComposition = (raw: any): boolean => {
    const dbName = String(raw?.database?.name || '').toUpperCase();
    const dbType = String(raw?.database?.type || '').toUpperCase();
    return dbType === 'PROPRIA' || dbName === 'PROPRIA' || dbName.startsWith('PROPRIA_') || dbName === 'PRÓPRIO';
};

/**
 * Get the effective coefficient of a composition item line.
 */
export const getLineCoefficient = (ci: any): number => asNumber(ci?.coefficient);

/**
 * Get the unit price of a composition item line (supports both items and auxiliary compositions).
 */
export const getLineUnitPrice = (ci: any): number => {
    const itemData = ci?.item || ci?.auxiliaryComposition;
    return asNumber(itemData?.price ?? itemData?.totalPrice);
};

/**
 * Calculate the subtotal for a composition item line (coefficient × unit price).
 * Falls back to stored ci.price when computed value is zero but stored is positive.
 */
export const getLineSubtotal = (ci: any, precision?: any): number => {
    const itemData = ci?.item || ci?.auxiliaryComposition;
    if (itemData?.isObservation) return 0;
    if (ci?.[SNAPSHOT_SUBTOTAL_KEY]) {
        return applyPrecision(asNumber(ci?.price), { precision });
    }
    const computed = getLineCoefficient(ci) * getLineUnitPrice(ci);
    if (computed > 0 || getLineUnitPrice(ci) > 0) {
        return applyPrecision(computed, { precision });
    }
    return asNumber(ci?.price);
};

/**
 * Normalize composition math: recalculate all subtotals and totals from raw data.
 * Handles PROPRIA fallback for unit prices and observation items.
 */
export const normalizeCompositionMath = (raw: any, precision?: any): any => {
    if (!raw) return raw;
    const groups = { ...(raw.groups || {}) };
    let total = 0;

    const isPropria = isPropriaComposition(raw);

    for (const groupKey of Object.keys(groups)) {
        groups[groupKey] = (groups[groupKey] || []).map((ci: any) => {
            if (ci.item && (ci.item.type === 'OBSERVACAO' || ci.item.code?.startsWith('OBS'))) {
                ci.item = { ...ci.item, isObservation: true };
            }

            if (isPropria && ci.coefficient > 0) {
                const savedSubtotal = applyPrecision(asNumber(ci.price), { precision });
                const dbUnitPrice = savedSubtotal / ci.coefficient;
                if (ci.item) {
                    ci.item = { ...ci.item, price: dbUnitPrice };
                } else if (ci.auxiliaryComposition) {
                    ci.auxiliaryComposition = { ...ci.auxiliaryComposition, totalPrice: dbUnitPrice };
                }

                total += savedSubtotal;
                return { ...ci, price: savedSubtotal, [SNAPSHOT_SUBTOTAL_KEY]: true };
            }
            const subtotal = getLineSubtotal(ci, precision);
            total += subtotal;
            return { ...ci, price: subtotal };
        });
    }

    return {
        ...raw,
        groups,
        items: Object.values(groups).flat(),
        totalDirect: applyPrecision(total, { precision }),
        totalPrice: applyPrecision(total, { precision }),
    };
};

/**
 * Sum all items across all groups in a composition.
 */
export const sumCompositionGroups = (groups: Record<string, any[]> | undefined, precision?: any): number => {
    let total = 0;
    for (const groupItems of Object.values(groups || {})) {
        for (const ci of groupItems || []) total += getLineSubtotal(ci, precision);
    }
    return applyPrecision(total, { precision });
};
