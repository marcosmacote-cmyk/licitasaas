import { describe, expect, it } from 'vitest';
import { getLineSubtotal, getLineUnitPrice, normalizeCompositionMath, SNAPSHOT_SUBTOTAL_KEY } from './compositionMath';

const precision = { tipo: 'ROUND' as const, casasDecimais: 2 };

describe('compositionMath snapshot handling', () => {
    it('preserves saved PROPRIA line subtotals instead of recalculating from joined item prices', () => {
        const normalized = normalizeCompositionMath({
            database: { name: 'PROPRIA_proposal-1', type: 'PROPRIA' },
            groups: {
                MAO_DE_OBRA: [
                    {
                        id: 'line-1',
                        coefficient: 5,
                        price: 109.3,
                        item: {
                            id: 'official-item-1',
                            code: '2436',
                            type: 'MAO_DE_OBRA',
                            price: 999.99,
                        },
                    },
                ],
            },
        }, precision);

        const line = normalized.groups.MAO_DE_OBRA[0];

        expect(line.price).toBe(109.3);
        expect(line[SNAPSHOT_SUBTOTAL_KEY]).toBe(true);
        expect(getLineSubtotal(line, precision)).toBe(109.3);
        expect(getLineUnitPrice(line)).toBeCloseTo(21.86, 6);
        expect(normalized.totalDirect).toBe(109.3);
        expect(normalized.totalPrice).toBe(109.3);
    });

    it('keeps official compositions recalculated from current unit prices', () => {
        const normalized = normalizeCompositionMath({
            database: { name: 'SEINFRA', type: 'OFICIAL' },
            groups: {
                EQUIPAMENTO: [
                    {
                        id: 'line-1',
                        coefficient: 1.5,
                        price: 100,
                        item: {
                            id: 'official-item-1',
                            code: 'I0747',
                            type: 'EQUIPAMENTO',
                            price: 278.76,
                        },
                    },
                ],
            },
        }, precision);

        const line = normalized.groups.EQUIPAMENTO[0];

        expect(line.price).toBe(418.14);
        expect(line[SNAPSHOT_SUBTOTAL_KEY]).toBeUndefined();
        expect(normalized.totalDirect).toBe(418.14);
        expect(normalized.totalPrice).toBe(418.14);
    });

    it('preserves saved PROPRIA auxiliary composition subtotals', () => {
        const normalized = normalizeCompositionMath({
            database: { name: 'PROPRIA_proposal-1', type: 'PROPRIA' },
            groups: {
                AUXILIAR: [
                    {
                        id: 'line-aux',
                        coefficient: 15.9,
                        price: 95.56,
                        auxiliaryComposition: {
                            id: 'aux-1',
                            code: 'C-AUX',
                            totalPrice: 722.51,
                        },
                    },
                ],
            },
        }, precision);

        const line = normalized.groups.AUXILIAR[0];

        expect(line.price).toBe(95.56);
        expect(line[SNAPSHOT_SUBTOTAL_KEY]).toBe(true);
        expect(getLineSubtotal(line, precision)).toBe(95.56);
        expect(getLineUnitPrice(line)).toBeCloseTo(95.56 / 15.9, 6);
        expect(normalized.totalPrice).toBe(95.56);
    });
});
