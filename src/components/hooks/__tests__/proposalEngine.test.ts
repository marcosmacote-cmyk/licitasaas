/**
 * ══════════════════════════════════════════════════════════
 *  Proposal Pricing Engine — Tests
 *  Cobertura para funções de cálculo financeiro de propostas.
 *  BUGs aqui = prejuízo financeiro direto.
 * ══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
    calculateItem,
    calculateTotals,
    calculateAdjustedItem,
    calculateAdjustedTotals,
} from '../../proposals/engine';

// ── calculateItem ─────────────────────────────────────

describe('calculateItem', () => {
    it('should calculate basic item without BDI or discount', () => {
        const result = calculateItem({ quantity: 10, unitCost: 100 }, 0);
        expect(result.unitPrice).toBe(100);
        expect(result.totalPrice).toBe(1000);
    });

    it('should apply BDI correctly', () => {
        const result = calculateItem({ quantity: 1, unitCost: 100 }, 25);
        // 100 * (1 + 25/100) = 125
        expect(result.unitPrice).toBe(125);
        expect(result.totalPrice).toBe(125);
    });

    it('should apply linear discount correctly', () => {
        const result = calculateItem({ quantity: 1, unitCost: 100 }, 0, 10);
        // 100 * 1 * (1 - 10/100) = 90
        expect(result.unitPrice).toBe(90);
        expect(result.totalPrice).toBe(90);
    });

    it('should apply BDI + discount together', () => {
        const result = calculateItem({ quantity: 1, unitCost: 100 }, 20, 10);
        // 100 * 1.20 * 0.90 = 108
        expect(result.unitPrice).toBe(108);
        expect(result.totalPrice).toBe(108);
    });

    it('should apply item-level discount cumulatively', () => {
        const result = calculateItem(
            { quantity: 1, unitCost: 100, discountPercentage: 5 },
            0, 10
        );
        // 100 * 1 * 0.90 * 0.95 = 85.50
        expect(result.unitPrice).toBe(85.50);
        expect(result.totalPrice).toBe(85.50);
    });

    it('should apply multiplier correctly', () => {
        const result = calculateItem({ quantity: 2, unitCost: 50, multiplier: 3 }, 0);
        // unitPrice = 50, totalPrice = 2 * 3 * 50 = 300
        expect(result.unitPrice).toBe(50);
        expect(result.totalPrice).toBe(300);
    });

    it('should use ROUND mode by default', () => {
        const result = calculateItem({ quantity: 1, unitCost: 100 }, 33.33);
        // 100 * 1.3333 = 133.33 (rounded)
        expect(result.unitPrice).toBe(133.33);
    });

    it('should use TRUNCATE mode when specified', () => {
        const result = calculateItem({ quantity: 1, unitCost: 100 }, 33.339, 0, 'TRUNCATE');
        // 100 * 1.33339 = 133.339 → truncate to 133.33
        expect(result.unitPrice).toBe(133.33);
    });

    it('should handle zero quantity', () => {
        const result = calculateItem({ quantity: 0, unitCost: 100 }, 10);
        expect(result.unitPrice).toBe(110);
        expect(result.totalPrice).toBe(0);
    });

    it('should handle zero unit cost', () => {
        const result = calculateItem({ quantity: 10, unitCost: 0 }, 10);
        expect(result.unitPrice).toBe(0);
        expect(result.totalPrice).toBe(0);
    });

    it('should handle empty item (all defaults)', () => {
        const result = calculateItem({}, 0);
        expect(result.unitPrice).toBe(0);
        expect(result.totalPrice).toBe(0);
    });

    it('should maintain precision for large values', () => {
        const result = calculateItem({ quantity: 1000, unitCost: 99999.99 }, 25.55);
        expect(result.unitPrice).toBeGreaterThan(0);
        expect(result.totalPrice).toBeGreaterThan(0);
        // Verify 2-decimal precision
        const decimals = (result.totalPrice.toString().split('.')[1] || '').length;
        expect(decimals).toBeLessThanOrEqual(2);
    });
});

// ── calculateTotals ───────────────────────────────────

describe('calculateTotals', () => {
    it('should sum totalPrice of all items', () => {
        const items = [
            { totalPrice: 100, quantity: 1, unitCost: 100, multiplier: 1 },
            { totalPrice: 200, quantity: 2, unitCost: 100, multiplier: 1 },
            { totalPrice: 300, quantity: 3, unitCost: 100, multiplier: 1 },
        ] as any[];
        const result = calculateTotals(items);
        expect(result.total).toBe(600);
    });

    it('should calculate subtotal from raw costs', () => {
        const items = [
            { totalPrice: 125, quantity: 1, unitCost: 100, multiplier: 1 },
        ] as any[];
        const result = calculateTotals(items);
        expect(result.subtotal).toBe(100); // raw cost without BDI
        expect(result.total).toBe(125);    // with BDI applied
    });

    it('should handle multiplier in subtotal', () => {
        const items = [
            { totalPrice: 600, quantity: 2, unitCost: 100, multiplier: 3 },
        ] as any[];
        const result = calculateTotals(items);
        expect(result.subtotal).toBe(600); // 2 * 3 * 100
    });

    it('should handle empty array', () => {
        const result = calculateTotals([]);
        expect(result.total).toBe(0);
        expect(result.subtotal).toBe(0);
    });
});

// ── calculateAdjustedItem ─────────────────────────────

describe('calculateAdjustedItem', () => {
    it('should use adjustedUnitCost when available', () => {
        const result = calculateAdjustedItem(
            { quantity: 1, unitCost: 100, adjustedUnitCost: 80 },
            0
        );
        expect(result.adjustedUnitPrice).toBe(80);
    });

    it('should fallback to unitCost when adjustedUnitCost is null', () => {
        const result = calculateAdjustedItem(
            { quantity: 1, unitCost: 100, adjustedUnitCost: null } as any,
            0
        );
        expect(result.adjustedUnitPrice).toBe(100);
    });

    it('should apply adjustedBdi and adjustedDiscount', () => {
        const result = calculateAdjustedItem(
            { quantity: 1, unitCost: 100 },
            30, 15
        );
        // 100 * 1.30 * 0.85 = 110.50
        expect(result.adjustedUnitPrice).toBe(110.5);
    });

    it('should apply item-level adjusted discount', () => {
        const result = calculateAdjustedItem(
            { quantity: 1, unitCost: 100, adjustedItemDiscount: 10 },
            0, 0
        );
        // 100 * 1 * 1 * 0.90 = 90
        expect(result.adjustedUnitPrice).toBe(90);
    });

    it('should support TRUNCATE mode', () => {
        const result = calculateAdjustedItem(
            { quantity: 3, unitCost: 100 },
            33.339, 0, 'TRUNCATE'
        );
        expect(result.adjustedUnitPrice).toBe(133.33);
        // 3 * 1 * 133.33 = 399.99
        expect(result.adjustedTotalPrice).toBe(399.99);
    });
});

// ── calculateAdjustedTotals ──────────────────────────

describe('calculateAdjustedTotals', () => {
    it('should sum adjusted totals', () => {
        const items = [
            { adjustedTotalPrice: 200, quantity: 1, unitCost: 100, multiplier: 1 },
            { adjustedTotalPrice: 300, quantity: 1, unitCost: 150, multiplier: 1 },
        ] as any[];
        const result = calculateAdjustedTotals(items);
        expect(result.total).toBe(500);
    });

    it('should calculate adjusted subtotal using adjustedUnitCost when available', () => {
        const items = [
            {
                adjustedTotalPrice: 100,
                quantity: 1, unitCost: 200,
                adjustedUnitCost: 80, multiplier: 1
            },
        ] as any[];
        const result = calculateAdjustedTotals(items);
        expect(result.subtotal).toBe(80); // uses adjustedUnitCost
    });

    it('should fallback to unitCost for subtotal when adjustedUnitCost is missing', () => {
        const items = [
            { adjustedTotalPrice: 100, quantity: 1, unitCost: 100, multiplier: 1 },
        ] as any[];
        const result = calculateAdjustedTotals(items);
        expect(result.subtotal).toBe(100);
    });
});
