/**
 * useUndoRedo.ts — Hook de Undo/Redo genérico para arrays
 * 
 * FIX F1.2: Implementa histórico de ações com Ctrl+Z / Ctrl+Shift+Z
 * 
 * Design decisions:
 * - Uses snapshot-based history (not command pattern) for simplicity
 * - Limits history to maxHistory snapshots to prevent memory bloat with 900+ item arrays
 * - Debounced snapshot capture (300ms) to batch rapid edits into single undo steps
 * - Keyboard shortcuts are registered globally via useEffect
 */
import { useState, useCallback, useRef, useEffect } from 'react';

interface UndoRedoState<T> {
    past: T[];
    present: T;
    future: T[];
}

interface UndoRedoResult<T> {
    /** Current state value */
    state: T;
    /** Update state and push current to undo stack */
    setState: (next: T | ((prev: T) => T)) => void;
    /** Replace state WITHOUT pushing to undo stack (for initial load, AI extraction) */
    setStateNoHistory: (next: T) => void;
    /** Undo last change */
    undo: () => void;
    /** Redo last undone change */
    redo: () => void;
    /** Whether undo is available */
    canUndo: boolean;
    /** Whether redo is available */
    canRedo: boolean;
    /** Number of undo steps available */
    undoCount: number;
    /** Number of redo steps available */
    redoCount: number;
}

export function useUndoRedo<T>(
    initialState: T,
    maxHistory = 50,
): UndoRedoResult<T> {
    const [history, setHistory] = useState<UndoRedoState<T>>({
        past: [],
        present: initialState,
        future: [],
    });

    // Debounce timer ref — batches rapid changes into single undo steps
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingRef = useRef<T | null>(null);

    // Update state with undo tracking (debounced to batch rapid edits)
    const setState = useCallback((next: T | ((prev: T) => T)) => {
        setHistory(prev => {
            const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev.present) : next;

            // Clear debounce timer if active
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
                debounceRef.current = null;
            }

            // If there's a pending state (from a recent rapid edit), use the original pre-pending state
            // This ensures that rapid edits (e.g., typing in a field) create a SINGLE undo step
            if (pendingRef.current !== null) {
                // We already have a pending snapshot — just update present, keep same past
                pendingRef.current = resolved;
                
                // Set a timer to "commit" this batch
                debounceRef.current = setTimeout(() => {
                    pendingRef.current = null;
                }, 300);

                return { ...prev, present: resolved, future: [] };
            }

            // No pending — this is a fresh edit. Push current present to past.
            const newPast = [...prev.past, prev.present];
            
            // Trim history to maxHistory
            while (newPast.length > maxHistory) {
                newPast.shift();
            }

            // Mark as pending for debounce batching
            pendingRef.current = resolved;
            debounceRef.current = setTimeout(() => {
                pendingRef.current = null;
            }, 300);

            return {
                past: newPast,
                present: resolved,
                future: [], // Clear redo stack on new edit
            };
        });
    }, [maxHistory]);

    // Set state WITHOUT pushing to undo stack (for non-user actions)
    const setStateNoHistory = useCallback((next: T) => {
        // Clear any pending debounce
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }
        pendingRef.current = null;
        
        setHistory(prev => ({
            ...prev,
            present: next,
            // Keep past and future intact — this is a "silent" update
        }));
    }, []);

    const undo = useCallback(() => {
        // Flush any pending debounce first
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }
        pendingRef.current = null;

        setHistory(prev => {
            if (prev.past.length === 0) return prev;
            const newPast = [...prev.past];
            const previous = newPast.pop()!;
            return {
                past: newPast,
                present: previous,
                future: [prev.present, ...prev.future],
            };
        });
    }, []);

    const redo = useCallback(() => {
        // Flush any pending debounce first
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }
        pendingRef.current = null;

        setHistory(prev => {
            if (prev.future.length === 0) return prev;
            const newFuture = [...prev.future];
            const next = newFuture.shift()!;
            return {
                past: [...prev.past, prev.present],
                present: next,
                future: newFuture,
            };
        });
    }, []);

    // Register keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y)
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const isMac = navigator.platform.toUpperCase().includes('MAC');
            const ctrlKey = isMac ? e.metaKey : e.ctrlKey;

            if (ctrlKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
            } else if (ctrlKey && e.key === 'z' && e.shiftKey) {
                e.preventDefault();
                redo();
            } else if (ctrlKey && e.key === 'y') {
                e.preventDefault();
                redo();
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [undo, redo]);

    // Cleanup debounce on unmount
    useEffect(() => {
        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, []);

    return {
        state: history.present,
        setState,
        setStateNoHistory,
        undo,
        redo,
        canUndo: history.past.length > 0,
        canRedo: history.future.length > 0,
        undoCount: history.past.length,
        redoCount: history.future.length,
    };
}
