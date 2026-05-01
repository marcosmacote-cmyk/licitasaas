import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    engineeringItemFindMany: vi.fn(),
    engineeringCompositionFindMany: vi.fn(),
    queryRaw: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
    prisma: {
        engineeringItem: { findMany: mocks.engineeringItemFindMany },
        engineeringComposition: { findMany: mocks.engineeringCompositionFindMany },
        $queryRaw: mocks.queryRaw,
    },
}));

import { enrichWithOfficialPrices } from './priceEnricher';

describe('enrichWithOfficialPrices', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.engineeringItemFindMany.mockResolvedValue([]);
        mocks.engineeringCompositionFindMany.mockResolvedValue([]);
        mocks.queryRaw.mockResolvedValue([]);
    });

    it('confirms exact official-code matches and records method/confidence', async () => {
        mocks.engineeringCompositionFindMany.mockResolvedValueOnce([
            {
                id: 'comp-1',
                code: 'C0054',
                description: 'ALVENARIA TIJOLO CERAMICO',
                unit: 'M2',
                totalPrice: 47.5,
                database: {
                    id: 'db-seinfra',
                    type: 'OFICIAL',
                    tenantId: null,
                    name: 'SEINFRA',
                    uf: 'CE',
                    version: '028.1',
                    referenceMonth: null,
                    referenceYear: null,
                    payrollExemption: false,
                },
            },
        ]);

        const items = [{
            item: '1.1',
            type: 'COMPOSICAO',
            sourceName: 'SEINFRA',
            code: 'C0054',
            description: 'ALVENARIA TIJOLO CERAMICO',
            unit: 'M2',
            quantity: 10,
            unitCost: 47.5,
        }];

        const result = await enrichWithOfficialPrices(items, { basesConsideradas: ['SEINFRA'] }, { tenantId: 'tenant-a' });

        expect(result).toEqual({ matched: 1, total: 1 });
        expect(items[0].priceAudit).toMatchObject({
            status: 'OK',
            matchedCode: 'C0054',
            matchedDatabaseId: 'db-seinfra',
            matchMethod: 'code_exact',
            confidence: 98,
        });
    });

    it('scopes database lookups to official databases plus the current tenant only', async () => {
        await enrichWithOfficialPrices([
            {
                type: 'COMPOSICAO',
                sourceName: 'SEINFRA',
                code: 'C0054',
                description: 'ALVENARIA',
                quantity: 1,
                unitCost: 1,
            },
        ], undefined, { tenantId: 'tenant-a' });

        expect(mocks.engineeringCompositionFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                database: {
                    OR: [
                        { type: 'OFICIAL' },
                        { tenantId: 'tenant-a' },
                    ],
                },
            }),
        }));
    });

    it('keeps description matches as review-only suggestions, not confirmed OK matches', async () => {
        mocks.queryRaw
            .mockResolvedValueOnce([
                {
                    id: 'comp-1',
                    code: 'C0102',
                    description: 'CHAPISCO COM ARGAMASSA',
                    unit: 'M2',
                    matchedPrice: 4.5,
                    matchType: 'COMPOSICAO',
                    sim: 0.88,
                },
            ])
            .mockResolvedValueOnce([]);

        mocks.engineeringCompositionFindMany
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    id: 'comp-1',
                    code: 'C0102',
                    description: 'CHAPISCO COM ARGAMASSA',
                    unit: 'M2',
                    totalPrice: 4.5,
                    database: {
                        id: 'db-seinfra',
                        type: 'OFICIAL',
                        tenantId: null,
                        name: 'SEINFRA',
                        uf: 'CE',
                        version: '028.1',
                        referenceMonth: null,
                        referenceYear: null,
                        payrollExemption: false,
                    },
                },
            ]);

        const items = [{
            item: '1.1',
            type: 'COMPOSICAO',
            sourceName: 'PROPRIA',
            code: 'N/A',
            description: 'CHAPISCO COM ARGAMASSA',
            unit: 'M2',
            quantity: 10,
            unitCost: 4.5,
        }];

        const result = await enrichWithOfficialPrices(items, { basesConsideradas: ['SEINFRA'] }, { tenantId: 'tenant-a' });

        expect(result.matched).toBe(1);
        expect(items[0]).toMatchObject({ sourceName: 'PROPRIA', code: 'N/A' });
        expect(items[0].priceAudit).toMatchObject({
            status: 'BASE_INCOMPATIVEL',
            matchedCode: 'C0102',
            matchMethod: 'description_similarity',
            confidence: 88,
        });
        expect(items[0].priceAudit.warnings.join(' ')).toContain('exige revisão manual');
    });
});
