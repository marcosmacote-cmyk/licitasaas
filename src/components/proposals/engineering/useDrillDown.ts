/**
 * useDrillDown — Hook dedicado para navegação drill-down de composições auxiliares.
 *
 * G7-FIX: Extraído do CompositionEditor monolítico para isolar toda a lógica
 * de stack, snapshot, cascade de preço e restauração de estado.
 *
 * API pública:
 *   push(code, description, currentState) — entra na composição auxiliar
 *   pop()                                 — volta 1 nível
 *   popToRoot()                           — volta ao nível raiz
 *   navigateTo(index)                     — navega para nível específico
 *   depth                                 — profundidade atual do drill (0 = root)
 *   activeCode                            — código da composição ativa
 *   stack                                 — array de breadcrumb
 *   isInDrill                             — sugar for depth > 0
 *   checkCircularDependency(code)         — detecta ciclo
 *   updateParentSnapshots(childData)      — cascade bottom-up
 */
import { useState, useCallback, useRef } from 'react';
import { applyPrecision, type PrecisionConfig } from './precisionEngine';
import { getLineCoefficient, sumCompositionGroups } from './compositionMath';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

/** State snapshot of a parent level, to be restored when the user navigates back. */
export interface DrillLevelSnapshot {
    data: any;                         // Full composition data at that level
    groupNotes: Record<string, string>;
    customGroupLabels: Record<string, string>;
    groupOrder: string[];
    refDivisorLabel: string;
    refDivisorValue: string;
    hasChanges: boolean;
    observation: string;
}

/** One level in the drill stack */
export interface DrillLevel {
    code: string;
    description: string;
    snapshot: DrillLevelSnapshot;
}

/** State object the component must provide for snapshotting */
export interface DrillCurrentState {
    data: any;
    groupNotes: Record<string, string>;
    customGroupLabels: Record<string, string>;
    groupOrder: string[];
    refDivisorLabel: string;
    refDivisorValue: string;
    hasChanges: boolean;
    observation: string;
}

/** Callback to restore state from a snapshot */
export type DrillRestoreCallback = (snapshot: DrillLevelSnapshot) => void;

// G5-PREP: Helpers moved to compositionMath.ts

// ═══════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════

export function useDrillDown(rootCode: string | undefined, precision?: PrecisionConfig) {
    const [stack, setStack] = useState<DrillLevel[]>([]);
    // Use ref to prevent stale closure issues in cascade effect
    const stackRef = useRef<DrillLevel[]>([]);
    stackRef.current = stack;

    const depth = stack.length;
    const isInDrill = depth > 0;
    const activeCode = isInDrill ? stack[depth - 1].code : rootCode;
    const currentLevel = isInDrill ? stack[depth - 1] : null;

    /**
     * Push: Enter a child composition. Saves current state as a snapshot.
     */
    const push = useCallback((
        code: string,
        description: string,
        currentState: DrillCurrentState
    ) => {
        const level: DrillLevel = {
            code,
            description,
            snapshot: {
                data: currentState.data,
                groupNotes: { ...currentState.groupNotes },
                customGroupLabels: { ...currentState.customGroupLabels },
                groupOrder: [...currentState.groupOrder],
                refDivisorLabel: currentState.refDivisorLabel,
                refDivisorValue: currentState.refDivisorValue,
                hasChanges: currentState.hasChanges,
                observation: currentState.observation,
            },
        };
        setStack(prev => [...prev, level]);
    }, []);

    /**
     * Pop: Go back one level. Returns the snapshot to restore, or null if already at root.
     */
    const pop = useCallback((): DrillLevelSnapshot | null => {
        const current = stackRef.current;
        if (current.length === 0) return null;
        const lastLevel = current[current.length - 1];
        setStack(prev => prev.slice(0, -1));
        return lastLevel.snapshot;
    }, []);

    /**
     * PopToRoot: Go back to root level. Returns the root snapshot to restore.
     */
    const popToRoot = useCallback((): DrillLevelSnapshot | null => {
        const current = stackRef.current;
        if (current.length === 0) return null;
        const rootLevel = current[0];
        setStack([]);
        return rootLevel.snapshot;
    }, []);

    /**
     * NavigateTo: Jump to a specific level in the breadcrumb.
     * Returns the snapshot of level[index+1] (the next level contains the snapshot of this level's state).
     */
    const navigateTo = useCallback((index: number): DrillLevelSnapshot | null => {
        const current = stackRef.current;
        if (index < 0 || index >= current.length - 1) return null;
        const nextEntry = current[index + 1];
        setStack(prev => prev.slice(0, index + 1));
        return nextEntry?.snapshot || null;
    }, []);

    /**
     * Reset: Clear the drill stack entirely. Used when navigating to a new composition.
     */
    const reset = useCallback(() => {
        setStack([]);
    }, []);

    /**
     * Detect circular dependency — a code that already exists in the stack or matches root.
     */
    const checkCircularDependency = useCallback((targetCode: string): boolean => {
        const target = targetCode.trim().toUpperCase();
        if (rootCode && target === rootCode.trim().toUpperCase()) return true;
        return stackRef.current.some(level =>
            level.code.trim().toUpperCase() === target
        );
    }, [rootCode]);

    /**
     * Cascade bottom-up: When child composition data changes, update all parent snapshots
     * with the new price. Returns true if any parent was updated.
     */
    const updateParentSnapshots = useCallback((childData: any): boolean => {
        if (!childData || childData.totalPrice === undefined) return false;

        const current = stackRef.current;
        if (current.length === 0) return false;

        let currentData = childData;
        let foundAny = false;

        // Phase 1: Check if any level needs update
        for (let i = current.length - 1; i >= 0; i--) {
            const level = current[i];
            const parentSnapshot = level.snapshot.data;
            if (!parentSnapshot?.groups) continue;

            const childCodeUpper = currentData.code?.trim().toUpperCase();
            let levelFound = false;

            for (const groupKey of Object.keys(parentSnapshot.groups)) {
                const groupItems = parentSnapshot.groups[groupKey] || [];
                for (const ci of groupItems) {
                    if (ci.auxiliaryComposition?.code?.trim().toUpperCase() === childCodeUpper) {
                        const expectedSubtotal = applyPrecision(currentData.totalPrice * getLineCoefficient(ci), { precision });
                        const priceChanged = ci.price !== expectedSubtotal || ci.auxiliaryComposition.totalPrice !== currentData.totalPrice;
                        const descChanged = currentData.description && ci.auxiliaryComposition.description !== currentData.description;
                        const unitChanged = currentData.unit && ci.auxiliaryComposition.unit !== currentData.unit;
                        if (priceChanged || descChanged || unitChanged) {
                            levelFound = true;
                            foundAny = true;
                            break;
                        }
                    }
                }
                if (levelFound) break;
            }

            currentData = {
                code: level.code,
                description: level.description,
                unit: level.snapshot.data?.unit || '',
                totalPrice: levelFound ? currentData.totalPrice : (level.snapshot.data?.totalPrice || 0),
            };
        }

        if (!foundAny) return false;

        // Phase 2: Apply updates
        setStack(prev => {
            if (prev.length === 0) return prev;
            const copy = [...prev];
            let currentData = childData;

            for (let i = copy.length - 1; i >= 0; i--) {
                const level = copy[i];
                const parentSnapshot = level.snapshot.data;
                if (!parentSnapshot?.groups) continue;

                let updatedSnapshot = { ...parentSnapshot, groups: { ...parentSnapshot.groups } };
                let levelFound = false;
                const childCodeUpper = currentData.code?.trim().toUpperCase();

                for (const groupKey of Object.keys(updatedSnapshot.groups)) {
                    const groupItems = updatedSnapshot.groups[groupKey] || [];
                    const updatedItems = groupItems.map((ci: any) => {
                        if (ci.auxiliaryComposition?.code?.trim().toUpperCase() === childCodeUpper) {
                            const expectedSubtotal = applyPrecision(currentData.totalPrice * getLineCoefficient(ci), { precision });
                            const priceChanged = ci.price !== expectedSubtotal || ci.auxiliaryComposition.totalPrice !== currentData.totalPrice;
                            const descChanged = currentData.description && ci.auxiliaryComposition.description !== currentData.description;
                            const unitChanged = currentData.unit && ci.auxiliaryComposition.unit !== currentData.unit;
                            const codeChanged = currentData.code && ci.auxiliaryComposition.code !== currentData.code;

                            if (descChanged || priceChanged || unitChanged || codeChanged) {
                                levelFound = true;
                                return {
                                    ...ci,
                                    price: expectedSubtotal,
                                    auxiliaryComposition: {
                                        ...ci.auxiliaryComposition,
                                        code: currentData.code || ci.auxiliaryComposition.code,
                                        description: currentData.description || ci.auxiliaryComposition.description,
                                        unit: currentData.unit || ci.auxiliaryComposition.unit,
                                        totalPrice: currentData.totalPrice,
                                    },
                                };
                            }
                        }
                        return ci;
                    });
                    updatedSnapshot.groups[groupKey] = updatedItems;
                }

                if (levelFound) {
                    updatedSnapshot.totalPrice = sumCompositionGroups(updatedSnapshot.groups, precision);
                    updatedSnapshot.totalDirect = updatedSnapshot.totalPrice;

                    copy[i] = {
                        ...level,
                        snapshot: {
                            ...level.snapshot,
                            data: updatedSnapshot,
                            hasChanges: true,
                        },
                    };
                }

                currentData = {
                    code: level.code,
                    description: level.description,
                    unit: updatedSnapshot.unit || level.snapshot.data?.unit || '',
                    totalPrice: updatedSnapshot.totalPrice,
                };
            }

            return copy;
        });

        return true;
    }, [precision]);

    /**
     * Update the description of the current (deepest) level in the stack.
     * Used when the user renames a composition while in drill-down.
     */
    const updateCurrentDescription = useCallback((description: string) => {
        setStack(prev => {
            if (prev.length === 0) return prev;
            const next = [...prev];
            next[next.length - 1] = { ...next[next.length - 1], description };
            return next;
        });
    }, []);

    return {
        // State
        stack,
        depth,
        isInDrill,
        activeCode,
        currentLevel,

        // Navigation
        push,
        pop,
        popToRoot,
        navigateTo,
        reset,

        // Validation
        checkCircularDependency,

        // Cascade
        updateParentSnapshots,
        updateCurrentDescription,
    };
}
