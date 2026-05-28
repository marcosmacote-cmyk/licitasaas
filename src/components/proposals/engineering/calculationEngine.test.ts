/**
 * calculationEngine.test.ts — Testes do motor centralizado de cálculo
 *
 * Verifica:
 *  - recalcAllItems aplica BDI global
 *  - recalcAllItems aplica BDI diferenciado (FORNECIMENTO)
 *  - recalcAllItems aplica desconto individual após BDI
 *  - recalcAllItems ignora agrupadores (ETAPA/SUBETAPA)
 *  - recalcAllItems chama refreshAudit quando fornecido
 *  - resolveItemBdi retorna BDI correto por categoria
 *  - ensureClientIds atribui clientId a itens sem, preserva os existentes
 *  - recalculateEngineeringItems (alias) funciona igual
 *  - buildInsumosItemsHash gera hash consistente
 */
import { describe, it, expect, vi } from 'vitest';
import { recalcAllItems, recalculateEngineeringItems, resolveItemBdi, ensureClientIds, buildInsumosItemsHash } from './calculationEngine';
import { DEFAULT_ENGINEERING_CONFIG, type EngItem, type EngineeringConfig } from './types';

const baseConfig: EngineeringConfig = {
    objeto: 'Teste',
    basesConsideradas: ['SINAPI'],
    dataBase: '2026-01',
    regimeOneracao: 'ONERADO',
    encargosSociais: { horista: 0, mensalista: 0 },
    precision: { tipo: 'ROUND', casasDecimais: 2 },
    bdiDiferenciado: false,
    bdiFornecimento: 14.02,
};

const makeItem = (overrides: Partial<EngItem> = {}): EngItem => ({
    id: 'test-1',
    itemNumber: '1.1',
    code: 'C0001',
    sourceName: 'SINAPI',
    description: 'Item teste',
    unit: 'UN',
    quantity: 10,
    unitCost: 100,
    unitPrice: 0,
    totalPrice: 0,
    type: 'COMPOSICAO',
    ...overrides,
});

describe('resolveItemBdi', () => {
    it('retorna BDI global quando diferenciado desabilitado', () => {
        const item = makeItem({ bdiCategoria: 'FORNECIMENTO' });
        expect(resolveItemBdi(item, 25, baseConfig)).toBe(25);
    });

    it('retorna bdiFornecimento para FORNECIMENTO quando diferenciado habilitado', () => {
        const config = { ...baseConfig, bdiDiferenciado: true, bdiFornecimento: 14.02 };
        const item = makeItem({ bdiCategoria: 'FORNECIMENTO' });
        expect(resolveItemBdi(item, 25, config)).toBe(14.02);
    });

    it('retorna BDI global para OBRA mesmo com diferenciado habilitado', () => {
        const config = { ...baseConfig, bdiDiferenciado: true };
        const item = makeItem({ bdiCategoria: 'OBRA' });
        expect(resolveItemBdi(item, 25, config)).toBe(25);
    });
});

describe('recalcAllItems', () => {
    it('aplica BDI global a todos os itens billable', () => {
        const items = [makeItem()];
        const result = recalcAllItems(items, 25, baseConfig);
        // unitPrice = 100 * (1 + 25/100) = 125
        expect(result[0].unitPrice).toBe(125);
        // totalPrice = 10 * 125 = 1250
        expect(result[0].totalPrice).toBe(1250);
    });

    it('ignora ETAPAs e SUBETAPAs', () => {
        const etapa = makeItem({ type: 'ETAPA', unitCost: 0 });
        const result = recalcAllItems([etapa], 25, baseConfig);
        expect(result[0]).toEqual(etapa);
    });

    it('aplica desconto individual após BDI (FIX F1)', () => {
        const item = makeItem({ discount: 10 }); // 10% de desconto
        const result = recalcAllItems([item], 25, baseConfig);
        // unitPrice = 100 * 1.25 = 125, com 10% desc = 112.50
        expect(result[0].unitPrice).toBe(112.5);
        expect(result[0].totalPrice).toBe(1125);
    });

    it('aplica BDI diferenciado para FORNECIMENTO', () => {
        const config = { ...baseConfig, bdiDiferenciado: true, bdiFornecimento: 14.02 };
        const item = makeItem({ bdiCategoria: 'FORNECIMENTO' });
        const result = recalcAllItems([item], 25, config);
        // unitPrice = 100 * (1 + 14.02/100) = 114.02
        expect(result[0].unitPrice).toBe(114.02);
    });

    it('chama refreshAudit quando fornecido', () => {
        const refreshAudit = vi.fn((it: EngItem) => ({ ...it, priceAudit: { status: 'OK' as const } }));
        const items = [makeItem()];
        const result = recalcAllItems(items, 25, baseConfig, { refreshAudit });
        expect(refreshAudit).toHaveBeenCalledOnce();
        expect(result[0].priceAudit?.status).toBe('OK');
    });

    it('desconto zero não altera preço', () => {
        const item = makeItem({ discount: 0 });
        const result = recalcAllItems([item], 25, baseConfig);
        expect(result[0].unitPrice).toBe(125);
    });
});

describe('recalculateEngineeringItems (alias)', () => {
    it('funciona identico a recalcAllItems com BDI diferenciado e desconto', () => {
        const config = { ...baseConfig, bdiDiferenciado: true, bdiFornecimento: 10 };
        const items = [
            makeItem({ id: 'obra', quantity: 2, unitCost: 100, discount: 10, bdiCategoria: 'OBRA' }),
            makeItem({ id: 'fornecimento', quantity: 1, unitCost: 100, discount: 5, bdiCategoria: 'FORNECIMENTO' }),
        ];
        const result = recalculateEngineeringItems(items, 20, config);
        // OBRA: 100 * 1.20 = 120, desc 10% = 108, total = 108 * 2 = 216
        expect(result[0].unitPrice).toBe(108);
        expect(result[0].totalPrice).toBe(216);
        // FORNECIMENTO: 100 * 1.10 = 110, desc 5% = 104.5, total = 104.5 * 1 = 104.5
        expect(result[1].unitPrice).toBe(104.5);
        expect(result[1].totalPrice).toBe(104.5);
    });

    it('não recalcula agrupadores', () => {
        const etapa = makeItem({ id: 'etapa', type: 'ETAPA', unitPrice: 77, totalPrice: 88 });
        expect(recalculateEngineeringItems([etapa], 20, baseConfig)[0]).toBe(etapa);
    });
});

describe('buildInsumosItemsHash', () => {
    it('gera hash consistente para mesmos itens', () => {
        const items = [makeItem(), makeItem({ id: 'test-2', code: 'C0002' })];
        const hash1 = buildInsumosItemsHash(items);
        const hash2 = buildInsumosItemsHash(items);
        expect(hash1).toBe(hash2);
    });

    it('hash muda quando item muda', () => {
        const items1 = [makeItem()];
        const items2 = [makeItem({ quantity: 20 })];
        expect(buildInsumosItemsHash(items1)).not.toBe(buildInsumosItemsHash(items2));
    });

    it('ignora ETAPAs', () => {
        const items = [makeItem({ type: 'ETAPA' })];
        expect(buildInsumosItemsHash(items)).toBe('');
    });
});

describe('ensureClientIds', () => {
    it('atribui clientId a itens sem', () => {
        const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
        const result = ensureClientIds(items);
        expect(result[0].clientId).toBeDefined();
        expect(result[1].clientId).toBeDefined();
        expect(result[0].clientId).not.toBe(result[1].clientId);
    });

    it('preserva clientId existente', () => {
        const items = [makeItem({ clientId: 'existing-id' })];
        const result = ensureClientIds(items);
        expect(result[0].clientId).toBe('existing-id');
    });

    it('retorna mesma referência se nada mudou', () => {
        const items = [makeItem({ clientId: 'id1' }), makeItem({ clientId: 'id2' })];
        const result = ensureClientIds(items);
        expect(result).toBe(items); // Same reference = no unnecessary re-render
    });

    it('mix: preserva existentes, gera para novos', () => {
        const items = [
            makeItem({ id: 'a', clientId: 'keep-this' }),
            makeItem({ id: 'b' }), // sem clientId
        ];
        const result = ensureClientIds(items);
        expect(result[0].clientId).toBe('keep-this');
        expect(result[1].clientId).toBeDefined();
        expect(result[1].clientId).not.toBe('keep-this');
    });
});
