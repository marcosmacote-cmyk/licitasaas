/**
 * compositionSaveService.ts — Extracted helpers for composition save logic
 *
 * G2-FIX: These functions were extracted from the monolithic PUT /compositions/:id
 * route (engineering.ts L1355-2200) to improve testability and readability.
 *
 * The main transaction still lives in the route for now (Phase 3C will complete
 * the extraction), but all item-resolution and FK-validation logic is here.
 */

import { classifyInsumoType } from './insumoClassifier';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface SaveWarning {
    type: 'SKIPPED_ITEM' | 'SKIPPED_AUX' | 'FK_MISSING' | 'COEF_CORRECTED';
    description: string;
    itemCode?: string;
}

export interface FlatItem {
    item?: any;
    itemId?: string;
    auxiliaryComposition?: any;
    auxiliaryCompositionId?: string;
    coefficient: number;
    price: number;
    groupKey?: string | null;
    coefficientExpression?: string | null;
    code?: string;
    _matchedDatabase?: string;
    _baseManuallySet?: boolean;
    _noBaseMatch?: boolean;
}

export interface ItemResolutionContext {
    officialItems: any[];
    officialComps: any[];
    localPropriaItems: Map<string, any>;
    localPropriaAuxs: Map<string, any>;
    nonTempItemsMap: Map<string, any>;
    nonTempAuxsMap: Map<string, any>;
    txBasePropriaId: string;
    targetDatabase: any | null;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Detect temporary/synthetic IDs that don't exist in DB.
 */
export function isTempId(valId: string | null | undefined): boolean {
    return !valId || valId.startsWith('new-') || valId.startsWith('temp-') || valId.startsWith('new-casca-') || valId.startsWith('new-aux-') || valId.startsWith('synthetic-') || valId.startsWith('etapa-');
}

/**
 * Flatten composition groups into a flat list of items with groupKeys.
 */
export function flattenCompositionGroups(composition: any): { flatItems: FlatItem[]; hasGroups: boolean } {
    const flatItems: FlatItem[] = [];
    const hasGroups = composition.groups && typeof composition.groups === 'object' && Object.keys(composition.groups).length > 0;

    if (hasGroups) {
        for (const [groupKey, group] of Object.entries(composition.groups)) {
            if (Array.isArray(group)) {
                for (const item of group) {
                    flatItems.push({
                        ...item,
                        groupKey: groupKey
                    });
                }
            }
        }
    }

    return { flatItems, hasGroups };
}

/**
 * Build metadata object from composition input.
 */
export function buildCompositionMetadata(composition: any): Record<string, any> {
    return {
        groupNotes: composition.groupNotes || null,
        customGroupLabels: composition.customGroupLabels || null,
        groupOrder: composition.groupOrder || null,
        referenceDivisor: composition.referenceDivisor || null,
        _officialRef: composition._officialRef || null,
        observation: composition.observation || null,
        rateio: composition.rateio || null,
    };
}

/**
 * Sanity check/correction of coefficients.
 * Detects and corrects 100x/1000x scaling anomalies common in legacy data.
 */
export function correctCoefficientScaling(
    item: FlatItem,
    warnings: SaveWarning[]
): { coefficient: number; corrected: boolean } {
    let coef = Number(item.coefficient) || 0;
    const price = Number(item.price) || 0;
    let corrected = false;

    if (coef >= 10 && price > 0) {
        const isAux = !!item.auxiliaryCompositionId || !!item.auxiliaryComposition;
        const unitPrice = isAux ? (item.auxiliaryComposition?.totalPrice || 0) : (item.item?.price || 0);
        if (unitPrice > 0) {
            const expectedLinePrice = coef * unitPrice;
            const priceRatio = expectedLinePrice / price;
            if (priceRatio >= 99 && priceRatio <= 1001) {
                const possibleFactors = [100, 1000];
                for (const factor of possibleFactors) {
                    if (Math.abs(priceRatio - factor) < 2) {
                        const code = item.item?.code || item.code || '?';
                        warnings.push({
                            type: 'COEF_CORRECTED',
                            description: `Coeficiente de "${code}" corrigido de ${coef} para ${coef / factor} (anomalia ${factor}x)`,
                            itemCode: code
                        });
                        coef = coef / factor;
                        corrected = true;
                        break;
                    }
                }
            }
        }
    }

    return { coefficient: coef, corrected };
}

/**
 * Validate that an item's FK references exist in the resolution context.
 * Returns null if valid, or a SaveWarning if invalid (item should be skipped).
 */
export function validateFkReferences(
    item: FlatItem,
    isAux: boolean,
    itemId: string | null | undefined,
    auxId: string | null | undefined,
    context: ItemResolutionContext
): SaveWarning | null {
    if (!isAux && itemId) {
        const itemExists = context.nonTempItemsMap.has(itemId) ||
            [...context.localPropriaItems.values()].some((i: any) => i.id === itemId) ||
            context.officialItems.some((i: any) => i.id === itemId);
        if (!itemExists) {
            return {
                type: 'FK_MISSING',
                description: `Insumo "${item.item?.code || item.item?.description || itemId}" não encontrado no banco`,
                itemCode: item.item?.code
            };
        }
    }
    if (isAux && auxId) {
        const auxExists = context.nonTempAuxsMap.has(auxId) ||
            [...context.localPropriaAuxs.values()].some((a: any) => a.id === auxId) ||
            context.officialComps.some((a: any) => a.id === auxId);
        if (!auxExists) {
            return {
                type: 'FK_MISSING',
                description: `Composição auxiliar "${item.auxiliaryComposition?.code || auxId}" não encontrada no banco`,
                itemCode: item.auxiliaryComposition?.code
            };
        }
    }
    return null;
}

/**
 * Generate a unique item code for AI-extracted proprietary inputs.
 */
export function generateItemCode(item: FlatItem): string {
    let itemCode = item.item?.code || `AI-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    if (itemCode === 'LIVRE') {
        itemCode = `LIVRE-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    }
    if (itemCode === 'OBS' || item.item?.type === 'OBSERVACAO') {
        itemCode = `OBS-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    }
    return itemCode;
}

/**
 * Classify an item's type using the insumo classifier.
 */
export function resolveItemType(description: string, unit: string, existingType?: string): string {
    return classifyInsumoType(description, unit, existingType).type;
}
