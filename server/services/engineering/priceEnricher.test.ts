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

vi.mock('@prisma/client', () => ({
    Prisma: {
        sql: (strings: TemplateStringsArray, ...values: any[]) => ({ strings, values }),
        join: (values: any[]) => values,
        empty: { strings: [], values: [] },
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
        });
        // New multidimensional confidence: code_exact(40) + source(~13) + price_match(30) = ~83
        expect(items[0].priceAudit.confidence).toBeGreaterThanOrEqual(70);
        expect(items[0].priceAudit.confidenceLevel).toBeDefined();
        expect(items[0].priceAudit.confidenceFactors).toBeDefined();
        expect(items[0].priceAudit.confidenceFactors.sourceMatch).toBe(true);
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

    it('prefers the configured UF when the same SINAPI code exists in multiple states', async () => {
        mocks.engineeringCompositionFindMany.mockResolvedValueOnce([
            {
                id: 'comp-ce',
                code: '103689',
                description: 'FORNECIMENTO E INSTALACAO DE PLACA DE OBRA',
                unit: 'M2',
                totalPrice: 64.65,
                database: {
                    id: 'db-ce',
                    type: 'OFICIAL',
                    tenantId: null,
                    name: 'SINAPI',
                    uf: 'CE',
                    version: '10/2025',
                    referenceMonth: 10,
                    referenceYear: 2025,
                    payrollExemption: true,
                },
            },
            {
                id: 'comp-pa',
                code: '103689',
                description: 'FORNECIMENTO E INSTALACAO DE PLACA DE OBRA',
                unit: 'M2',
                totalPrice: 470.47,
                database: {
                    id: 'db-pa',
                    type: 'OFICIAL',
                    tenantId: null,
                    name: 'SINAPI',
                    uf: 'PA',
                    version: '10/2025',
                    referenceMonth: 10,
                    referenceYear: 2025,
                    payrollExemption: true,
                },
            },
        ]);

        const items = [{
            item: '1.1',
            type: 'COMPOSICAO',
            sourceName: 'SINAPI',
            code: '103689',
            description: 'FORNECIMENTO E INSTALACAO DE PLACA DE OBRA',
            unit: 'M2',
            quantity: 6,
            unitCost: 470.47,
        }];

        await enrichWithOfficialPrices(items, {
            basesConsideradas: ['SINAPI'],
            dataBases: { SINAPI: '2025-10' },
            regimeOneracao: 'DESONERADO',
            ufReferencia: 'PA',
        }, { tenantId: 'tenant-a' });

        expect(items[0].priceAudit).toMatchObject({
            status: 'OK',
            matchedDatabaseId: 'db-pa',
            matchedUnitCost: 470.47,
            matchedUf: 'PA',
        });
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

// ── Pure unit tests for calculateMatchConfidence (no DB needed) ──
import { calculateMatchConfidence } from './priceEnricher';

describe('calculateMatchConfidence', () => {
    it('returns HIGH confidence for code_exact + source match + exact price', () => {
        const result = calculateMatchConfidence(
            { score: 90, warnings: [], matchMethod: 'code_exact' },
            100, 100 // exact price match
        );
        expect(result.confidence).toBeGreaterThanOrEqual(85);
        expect(result.confidenceLevel).toBe('HIGH');
        expect(result.factors.sourceMatch).toBe(true);
        expect(result.factors.priceDeviation).toBe(0);
    });

    it('returns LOW confidence for code_exact but large price deviation + warnings', () => {
        const result = calculateMatchConfidence(
            { score: 40, warnings: ['data-base incompatível'], matchMethod: 'code_exact' },
            100, 200 // 100% deviation
        );
        expect(result.confidence).toBeLessThan(75);
        expect(result.confidenceLevel).toBe('LOW');
    });

    it('returns LOW confidence for description_similarity with warnings', () => {
        const result = calculateMatchConfidence(
            { score: 20, warnings: ['fonte fora das bases', 'data-base incompatível'], matchMethod: 'description_similarity', confidence: 80 },
            50, 100 // 100% deviation
        );
        expect(result.confidence).toBeLessThan(50);
        expect(result.confidenceLevel).toBe('LOW');
    });

    it('gives 30 bonus points for price deviation <= 5%', () => {
        const exact = calculateMatchConfidence(
            { score: 40, warnings: [], matchMethod: 'code_exact' },
            100, 103 // 3% deviation
        );
        const large = calculateMatchConfidence(
            { score: 40, warnings: [], matchMethod: 'code_exact' },
            100, 200 // 100% deviation
        );
        expect(exact.confidence - large.confidence).toBeGreaterThanOrEqual(25);
    });

    it('factors include detailed breakdown', () => {
        const result = calculateMatchConfidence(
            { score: 70, warnings: [], matchMethod: 'code_exact' },
            48.26, 47.50 // 1.6% deviation
        );
        expect(result.factors).toMatchObject({
            sourceMatch: true,
            dateMatch: true,
            matchType: 'code_exact',
        });
        expect(result.factors.priceDeviation).toBeCloseTo(1.6, 0);
    });
});
