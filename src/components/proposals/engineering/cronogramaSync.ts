/**
 * cronogramaSync.ts — Sincronização unificada planilha → cronograma.
 *
 * FIX SYNC-01: Esta lógica estava duplicada no EngineeringProposalWizard (L240-314)
 * e no CronogramaPanel (L50-116). Agora é uma função pura reutilizável.
 *
 * Responsabilidades:
 *  - Atualiza valorTotal de etapas existentes quando itens da planilha mudam
 *  - Remove etapas automáticas que não existem mais na planilha
 *  - Adiciona novas etapas da planilha que não estão no cronograma
 *  - Preserva percentuais editados pelo usuário
 *  - Preserva etapas manuais (criadas via botão "Adicionar Etapa")
 */
import type { CronogramaEtapa } from './cronogramaEngine';

// ═══════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════

interface ItemLike {
    itemNumber: string;
    description: string;
    totalPrice: number;
    type?: string;
}

interface SyncResult {
    etapas: CronogramaEtapa[];
    changed: boolean;
}

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════

/**
 * Determines if an etapa ID represents an automatic stage (from the spreadsheet)
 * vs a manual/custom stage (created by the user with Date.now() as ID).
 */
function isAutomaticEtapaId(id: string): boolean {
    const num = Number(id);
    return !isNaN(num) && num < 1000000;
}

/**
 * Checks if an item type is a grouper (ETAPA or SUBETAPA).
 * Duplicates the check from types.ts to avoid circular dependency risks,
 * but accepts string type to be flexible with runtime data.
 */
function isGrouper(type?: string): boolean {
    return type === 'ETAPA' || type === 'SUBETAPA';
}

// ═══════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════

/**
 * Builds a map of etapa totals from spreadsheet items.
 *
 * Walks the items array sequentially, tracking the current ETAPA prefix.
 * Each ETAPA resets the current group; subsequent non-grouper items
 * accumulate their totalPrice into that group.
 *
 * @returns Map<etapaId, { name, total }>
 */
export function buildEtapaTotals(
    items: ItemLike[],
): Map<string, { name: string; total: number }> {
    const etapaTotals = new Map<string, { name: string; total: number }>();
    let currentEtapa = '';

    for (const it of items) {
        if (it.type === 'ETAPA') {
            currentEtapa = it.itemNumber.split('.')[0] || it.itemNumber;
            etapaTotals.set(currentEtapa, { name: it.description, total: 0 });
        } else if (!isGrouper(it.type) && currentEtapa) {
            const entry = etapaTotals.get(currentEtapa);
            if (entry) entry.total += it.totalPrice || 0;
        }
    }

    return etapaTotals;
}

/**
 * Synchronizes cronograma etapas with the current spreadsheet items.
 *
 * Strategy:
 * 1. Filter out automatic stages that no longer exist in the spreadsheet
 * 2. Update names and values of existing automatic stages
 * 3. Add new stages from the spreadsheet that aren't in the cronograma
 * 4. Preserve all manual/custom stages untouched
 * 5. Preserve user-edited percentuais on all stages
 *
 * @param items     — Current spreadsheet items
 * @param prevEtapas — Current cronograma etapas (with user percentuais)
 * @returns { etapas, changed } — New etapas array and whether anything changed
 */
export function syncCronogramaFromItems(
    items: ItemLike[],
    prevEtapas: CronogramaEtapa[],
): SyncResult {
    const etapaTotals = buildEtapaTotals(items);

    if (etapaTotals.size === 0) {
        return { etapas: prevEtapas, changed: false };
    }

    let changed = false;

    // Step 1: Filter out automatic stages that no longer exist
    const filtered = prevEtapas.filter(e => {
        if (isAutomaticEtapaId(e.id)) {
            const exists = etapaTotals.has(e.id);
            if (!exists) changed = true;
            return exists;
        }
        return true; // Keep manual/custom stages
    });

    // Step 2: Update existing stages (name + valorTotal)
    const updated = filtered.map(e => {
        const match = etapaTotals.get(e.id);
        if (match) {
            const hasNameChange = match.name && match.name !== e.nome;
            const hasValueChange = match.total !== e.valorTotal;
            if (hasNameChange || hasValueChange) {
                changed = true;
                return { ...e, valorTotal: match.total, nome: match.name || e.nome };
            }
        }
        return e;
    });

    // Step 3: Add new stages from spreadsheet
    const existingIds = new Set(prevEtapas.map(e => e.id));
    for (const [id, data] of etapaTotals) {
        if (!existingIds.has(id)) {
            changed = true;
            updated.push({
                id,
                nome: data.name,
                valorTotal: data.total,
                percentuais: Array(12).fill(0),
            });
        }
    }

    return { etapas: updated, changed };
}
