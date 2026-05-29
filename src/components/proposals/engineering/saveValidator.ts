/**
 * saveValidator.ts — Validação anti-corrupção de dados antes de salvar.
 *
 * Roda antes de QUALQUER save (manual ou auto) para garantir integridade.
 * Detecta NaN, Infinity, payloads vazios e valores fora da faixa.
 *
 * REGRA: Nenhum save deve persistir dados corrompidos no banco.
 */
import type { EngItem, EngineeringConfig } from './types';
import { isGrouper } from './types';
import type { BdiConfig } from './bdiEngine';

// ═══════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════

export interface ValidationResult {
    valid: boolean;
    errors: string[];      // Bloqueiam o save
    warnings: string[];    // Não bloqueiam, mas logam
    sanitized: EngItem[];  // Items com NaN/Infinity corrigidos para 0
}

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════

/** Returns true if value is NaN, Infinity, -Infinity, or undefined */
function isBadNumber(v: unknown): boolean {
    if (v === undefined || v === null) return false;
    if (typeof v !== 'number') return false;
    return !Number.isFinite(v);
}

/** Sanitize a number: NaN/Infinity → 0 */
function sanitizeNum(v: number): number {
    return Number.isFinite(v) ? v : 0;
}

// ═══════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════

/**
 * Valida o payload antes de salvar.
 *
 * @param items         — Itens a serem persistidos
 * @param prevItemCount — Número de itens na última carga (para detectar perda acidental)
 * @param config        — Configuração de engenharia atual
 * @param bdiConfig     — Configuração de BDI atual
 * @returns ValidationResult com erros, warnings e items sanitizados
 */
export function validateSavePayload(
    items: EngItem[],
    prevItemCount: number,
    config?: EngineeringConfig,
    bdiConfig?: BdiConfig,
): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let hasBadNumbers = false;

    // ─── R1: Guard contra payload vazio ────────────────────
    if (items.length === 0 && prevItemCount > 0) {
        errors.push(
            `Payload vazio detectado (havia ${prevItemCount} itens antes). Save bloqueado para evitar perda de dados.`
        );
        return { valid: false, errors, warnings, sanitized: items };
    }

    // ─── R2: Sanitizar NaN/Infinity por item ──────────────
    const sanitized = items.map(it => {
        if (isGrouper(it.type)) return it;

        const fixes: string[] = [];
        const clean = { ...it };

        if (isBadNumber(it.unitCost)) {
            fixes.push('unitCost');
            clean.unitCost = 0;
        }
        if (isBadNumber(it.unitPrice)) {
            fixes.push('unitPrice');
            clean.unitPrice = 0;
        }
        if (isBadNumber(it.totalPrice)) {
            fixes.push('totalPrice');
            clean.totalPrice = 0;
        }
        if (isBadNumber(it.quantity)) {
            fixes.push('quantity');
            clean.quantity = 0;
        }
        if (it.discount !== undefined && isBadNumber(it.discount)) {
            fixes.push('discount');
            clean.discount = 0;
        }

        if (fixes.length > 0) {
            hasBadNumbers = true;
            warnings.push(
                `Item "${it.itemNumber} — ${it.description?.slice(0, 40)}": campos ${fixes.join(', ')} continham NaN/Infinity → corrigidos para 0.`
            );
        }

        return clean;
    });

    if (hasBadNumbers) {
        warnings.unshift(
            `⚠ Valores numéricos inválidos (NaN/Infinity) foram detectados e sanitizados para 0 antes do save.`
        );
    }

    // ─── R3: Detectar totalPrice negativo ─────────────────
    const negativePrices = sanitized.filter(it => !isGrouper(it.type) && it.totalPrice < 0);
    if (negativePrices.length > 0) {
        warnings.push(
            `${negativePrices.length} item(ns) com totalPrice negativo detectado(s): ${negativePrices.map(it => it.itemNumber).join(', ')}`
        );
    }

    // ─── R4: Validar BDI dentro da faixa ──────────────────
    if (bdiConfig) {
        const bdi = bdiConfig.bdiGlobal;
        if (bdi < 0) {
            warnings.push(`BDI global negativo (${bdi}%). Verifique a configuração.`);
        }
        if (bdi > 100) {
            warnings.push(`BDI global muito alto (${bdi}%). Faixa TCU típica: 17-28%. Verifique.`);
        }
    }

    // ─── R5: Validar precision config ─────────────────────
    if (config?.precision) {
        const casas = config.precision.casasDecimais;
        if (casas < 0 || casas > 10 || !Number.isInteger(casas)) {
            warnings.push(`Casas decimais inválidas (${casas}). Deve ser inteiro entre 0 e 10.`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        sanitized,
    };
}

/**
 * Quick check: does the payload have any NaN/Infinity in numeric fields?
 * Lightweight version for pre-checks without full sanitization.
 */
export function hasCorruptedNumbers(items: EngItem[]): boolean {
    return items.some(it => {
        if (isGrouper(it.type)) return false;
        return isBadNumber(it.unitCost) ||
               isBadNumber(it.unitPrice) ||
               isBadNumber(it.totalPrice) ||
               isBadNumber(it.quantity);
    });
}
