/**
 * useAutoSave.ts — Hook dedicado para auto-save granular por Step.
 *
 * Substitui a lógica inline de auto-save do EngineeringProposalWizard.
 * Funcionalidades:
 *  - Timer de debounce configurável (default 15s)
 *  - Ref com payload atualizado (evita closures stale)
 *  - Validação de integridade via saveValidator
 *  - Guard contra save durante IA ou save concorrente
 *  - Feedback visual: isAutoSaving, lastSavedAt
 *  - Guard contra payload vazio (prevItemCount)
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { validateSavePayload } from './saveValidator';
import type { EngItem, EngineeringConfig } from './types';
import type { BdiConfig } from './bdiEngine';

// ═══════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════

export interface AutoSavePayload {
    items: EngItem[];
    bdiConfig: BdiConfig;
    effectiveBdi: number;
    engineeringConfig: EngineeringConfig;
    cronogramaData: any;
}

export interface UseAutoSaveOptions {
    proposalId: string;
    debounceMs?: number;
    isBlocked: boolean;          // isAnyAIRunning || isSaving
    hasUnsavedChanges: boolean;
    getPayload: () => AutoSavePayload;
    recalcAll: (items: EngItem[], bdi: number, config: EngineeringConfig) => EngItem[];
    ensureClientIds: (items: EngItem[]) => EngItem[];
    onSaveSuccess: () => void;   // setHasUnsavedChanges(false)
    onSaveError?: (error: string) => void;
}

export interface AutoSaveState {
    isAutoSaving: boolean;
    lastSavedAt: string | null;
}

// ═══════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════

const DEFAULT_DEBOUNCE_MS = 15000;
const token = () => localStorage.getItem('token') || '';
const hdrs = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });

// ═══════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════

export function useAutoSave(options: UseAutoSaveOptions): AutoSaveState {
    const {
        proposalId,
        debounceMs = DEFAULT_DEBOUNCE_MS,
        isBlocked,
        hasUnsavedChanges,
        getPayload,
        recalcAll,
        ensureClientIds,
        onSaveSuccess,
        onSaveError,
    } = options;

    const [isAutoSaving, setIsAutoSaving] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevItemCountRef = useRef(0);

    // Track previous item count for empty payload detection
    const getPayloadRef = useRef(getPayload);
    getPayloadRef.current = getPayload;

    // Update prevItemCount when items change
    useEffect(() => {
        const payload = getPayloadRef.current();
        if (payload.items.length > 0) {
            prevItemCountRef.current = payload.items.length;
        }
    });

    // ─── Core auto-save logic ─────────────────────────────
    const executeAutoSave = useCallback(async () => {
        setIsAutoSaving(true);
        try {
            const snap = getPayloadRef.current();

            // Validate before saving
            const validation = validateSavePayload(
                snap.items,
                prevItemCountRef.current,
                snap.engineeringConfig,
                snap.bdiConfig,
            );

            if (!validation.valid) {
                console.warn('[Auto-Save] Blocked:', validation.errors);
                onSaveError?.(validation.errors.join('; '));
                return;
            }

            if (validation.warnings.length > 0) {
                console.warn('[Auto-Save] Warnings:', validation.warnings);
            }

            const bdiConfigToSave = { ...snap.bdiConfig, bdiGlobal: snap.effectiveBdi };
            const itemsToSave = ensureClientIds(
                recalcAll(validation.sanitized, snap.effectiveBdi, snap.engineeringConfig)
            );

            const res = await fetch(`/api/engineering/proposals/${proposalId}/items`, {
                method: 'POST',
                headers: hdrs(),
                body: JSON.stringify({
                    items: itemsToSave,
                    bdiConfig: bdiConfigToSave,
                    engineeringConfig: snap.engineeringConfig,
                    cronogramaData: snap.cronogramaData,
                }),
            });

            if (res.ok) {
                onSaveSuccess();
                setLastSavedAt(
                    new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                );
                prevItemCountRef.current = itemsToSave.length;
            } else {
                const errData = await res.json().catch(() => ({}));
                console.error('[Auto-Save] Server error:', errData);
                onSaveError?.(`Erro no servidor: ${errData.error || res.status}`);
            }
        } catch (e) {
            console.error('[Auto-Save] Network error:', e);
            onSaveError?.('Erro de rede no auto-save');
        } finally {
            setIsAutoSaving(false);
        }
    }, [proposalId, recalcAll, ensureClientIds, onSaveSuccess, onSaveError]);

    // ─── Debounce timer ───────────────────────────────────
    useEffect(() => {
        // Clear any pending timer
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }

        // Only schedule if there are unsaved changes and not blocked
        if (hasUnsavedChanges && !isBlocked && !isAutoSaving) {
            const payload = getPayloadRef.current();
            if (payload.items.length > 0) {
                timerRef.current = setTimeout(executeAutoSave, debounceMs);
            }
        }

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasUnsavedChanges, isBlocked, isAutoSaving, debounceMs, executeAutoSave]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
        };
    }, []);

    return { isAutoSaving, lastSavedAt };
}
