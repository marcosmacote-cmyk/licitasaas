import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINEERING_CONFIG, type EngItem } from './types';
import { recalculateEngineeringItems } from './calculationEngine';

const baseConfig = {
    ...DEFAULT_ENGINEERING_CONFIG,
    precision: { tipo: 'ROUND', casasDecimais: 2 },
    bdiDiferenciado: true,
    bdiFornecimento: 10,
} as const;

function makeItem(overrides: Partial<EngItem>): EngItem {
    return {
        id: 'item-1',
        itemNumber: '1',
        code: '123',
        sourceName: 'SINAPI',
        description: 'Servico',
        unit: 'UN',
        quantity: 1,
        unitCost: 100,
        unitPrice: 0,
        totalPrice: 0,
        type: 'COMPOSICAO',
        ...overrides,
    };
}

describe('calculationEngine', () => {
    it('recalculates with effective BDI, differentiated BDI and per-item discount', () => {
        const items = [
            makeItem({ id: 'obra', quantity: 2, unitCost: 100, discount: 10, bdiCategoria: 'OBRA' }),
            makeItem({ id: 'fornecimento', quantity: 1, unitCost: 100, discount: 5, bdiCategoria: 'FORNECIMENTO' }),
        ];

        const result = recalculateEngineeringItems(items, 20, baseConfig);

        expect(result[0].unitPrice).toBe(108);
        expect(result[0].totalPrice).toBe(216);
        expect(result[1].unitPrice).toBe(104.5);
        expect(result[1].totalPrice).toBe(104.5);
    });

    it('does not recalculate groupers', () => {
        const etapa = makeItem({ id: 'etapa', type: 'ETAPA', unitPrice: 77, totalPrice: 88 });

        expect(recalculateEngineeringItems([etapa], 20, baseConfig)[0]).toBe(etapa);
    });
});
