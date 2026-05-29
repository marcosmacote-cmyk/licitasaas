/**
 * saveValidator.test.ts — Testes do validador anti-corrupção de dados
 */
import { describe, it, expect } from 'vitest';
import { validateSavePayload, hasCorruptedNumbers } from './saveValidator';
import type { EngItem } from './types';

const makeItem = (overrides: Partial<EngItem> = {}): EngItem => ({
    id: 'test-1',
    itemNumber: '1.1',
    code: 'C0001',
    sourceName: 'SINAPI',
    description: 'Item teste',
    unit: 'UN',
    quantity: 10,
    unitCost: 100,
    unitPrice: 125,
    totalPrice: 1250,
    type: 'COMPOSICAO',
    ...overrides,
});

describe('validateSavePayload', () => {
    it('payload válido → valid: true, sem erros', () => {
        const result = validateSavePayload([makeItem()], 1);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('payload vazio com prevItemCount > 0 → valid: false', () => {
        const result = validateSavePayload([], 5);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('Payload vazio');
        expect(result.errors[0]).toContain('5 itens');
    });

    it('payload vazio com prevItemCount = 0 → valid: true (nova proposta)', () => {
        const result = validateSavePayload([], 0);
        expect(result.valid).toBe(true);
    });

    it('item com NaN em totalPrice → sanitizado + warning', () => {
        const item = makeItem({ totalPrice: NaN });
        const result = validateSavePayload([item], 1);
        expect(result.valid).toBe(true);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.sanitized[0].totalPrice).toBe(0);
    });

    it('item com Infinity em unitCost → sanitizado + warning', () => {
        const item = makeItem({ unitCost: Infinity });
        const result = validateSavePayload([item], 1);
        expect(result.valid).toBe(true);
        expect(result.sanitized[0].unitCost).toBe(0);
    });

    it('item com -Infinity em unitPrice → sanitizado + warning', () => {
        const item = makeItem({ unitPrice: -Infinity });
        const result = validateSavePayload([item], 1);
        expect(result.sanitized[0].unitPrice).toBe(0);
    });

    it('item com totalPrice negativo → warning gerado', () => {
        const item = makeItem({ totalPrice: -500 });
        const result = validateSavePayload([item], 1);
        expect(result.valid).toBe(true);
        expect(result.warnings.some(w => w.includes('negativo'))).toBe(true);
    });

    it('BDI > 100% → warning gerado', () => {
        const result = validateSavePayload(
            [makeItem()], 1, undefined,
            { mode: 'TCU', bdiGlobal: 150, tcu: {} as any }
        );
        expect(result.warnings.some(w => w.includes('150%'))).toBe(true);
    });

    it('BDI negativo → warning gerado', () => {
        const result = validateSavePayload(
            [makeItem()], 1, undefined,
            { mode: 'TCU', bdiGlobal: -5, tcu: {} as any }
        );
        expect(result.warnings.some(w => w.includes('negativo'))).toBe(true);
    });

    it('ETAPA items são preservados sem sanitização', () => {
        const etapa = makeItem({ type: 'ETAPA', unitCost: NaN });
        const result = validateSavePayload([etapa], 1);
        // ETAPA should be passed through without modification
        expect(result.sanitized[0].unitCost).toBeNaN(); // preserved as-is
    });

    it('múltiplos items com NaN → todos sanitizados', () => {
        const items = [
            makeItem({ id: '1', totalPrice: NaN }),
            makeItem({ id: '2', unitPrice: Infinity }),
            makeItem({ id: '3', unitCost: 100, totalPrice: 500 }), // ok
        ];
        const result = validateSavePayload(items, 3);
        expect(result.valid).toBe(true);
        expect(result.sanitized[0].totalPrice).toBe(0);
        expect(result.sanitized[1].unitPrice).toBe(0);
        expect(result.sanitized[2].totalPrice).toBe(500);
    });

    it('discount com NaN → sanitizado', () => {
        const item = makeItem({ discount: NaN });
        const result = validateSavePayload([item], 1);
        expect(result.sanitized[0].discount).toBe(0);
    });
});

describe('hasCorruptedNumbers', () => {
    it('items limpos → false', () => {
        expect(hasCorruptedNumbers([makeItem()])).toBe(false);
    });

    it('item com NaN → true', () => {
        expect(hasCorruptedNumbers([makeItem({ totalPrice: NaN })])).toBe(true);
    });

    it('item com Infinity → true', () => {
        expect(hasCorruptedNumbers([makeItem({ unitCost: Infinity })])).toBe(true);
    });

    it('ETAPA com NaN → false (groupers ignorados)', () => {
        expect(hasCorruptedNumbers([makeItem({ type: 'ETAPA', totalPrice: NaN })])).toBe(false);
    });
});
