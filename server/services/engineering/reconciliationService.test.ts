import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    proposalFindUnique: vi.fn(),
    itemFindMany: vi.fn(),
    itemFindUnique: vi.fn(),
    compositionFindMany: vi.fn(),
    itemUpdate: vi.fn(),
    compositionUpdate: vi.fn(),
    proposalUpdate: vi.fn(),
    transaction: vi.fn(),
    enrichWithOfficialPrices: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
    prisma: {
        priceProposal: { findUnique: mocks.proposalFindUnique, update: mocks.proposalUpdate },
        engineeringProposalItem: { findMany: mocks.itemFindMany, findUnique: mocks.itemFindUnique, update: mocks.itemUpdate },
        engineeringComposition: { findMany: mocks.compositionFindMany, update: mocks.compositionUpdate },
        $transaction: mocks.transaction,
    },
}));

vi.mock('./priceEnricher', () => ({
    enrichWithOfficialPrices: mocks.enrichWithOfficialPrices,
}));

import { getReconciliationReport, reconcileProposal } from './reconciliationService';

describe('reconciliationService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.proposalFindUnique.mockResolvedValue({
            id: 'proposal-1',
            bdiConfig: { bdiGlobal: 25 },
            engineeringConfig: {
                precision: { tipo: 'ROUND', casasDecimais: 2 },
                bdiDiferenciado: false,
            },
            bdiPercentage: 25,
        });
        mocks.itemFindMany.mockResolvedValue([]);
        mocks.compositionFindMany.mockResolvedValue([]);
        mocks.enrichWithOfficialPrices.mockResolvedValue({ matched: 0, total: 0 });
    });

    describe('getReconciliationReport', () => {
        it('reports 100% score when no alerts are present', async () => {
            const report = await getReconciliationReport('proposal-1', 'tenant-1');
            expect(report.summary.reconciliationScore).toBe(100);
            expect(report.alerts).toHaveLength(0);
        });

        it('detects EMPTY_PROPRIA_WITH_PRICE when custom composition has no items but budget cost is positive', async () => {
            mocks.itemFindMany.mockResolvedValueOnce([
                {
                    id: 'item-1',
                    itemNumber: '1.1',
                    code: 'COMP-001',
                    sourceName: 'PROPRIA',
                    type: 'COMPOSICAO',
                    description: 'Composicao Vazia Teste',
                    quantity: 10,
                    unitCost: 150.00,
                    unitPrice: 187.50, // 150 * 1.25
                    totalPrice: 1875.00,
                    discount: 0,
                }
            ]);
            mocks.compositionFindMany.mockResolvedValueOnce([
                {
                    id: 'comp-1',
                    code: 'COMP-001',
                    totalPrice: 150.00,
                    items: [], // empty items
                }
            ]);

            const report = await getReconciliationReport('proposal-1', 'tenant-1');
            const alert = report.alerts.find(a => a.type === 'EMPTY_PROPRIA_WITH_PRICE');
            expect(alert).toBeDefined();
            expect(alert?.severity).toBe('CRITICAL');
            expect(alert?.itemId).toBe('item-1');
            expect(report.summary.reconciliationScore).toBeLessThan(100);
        });

        it('detects BUDGET_COMPOSITION_MISMATCH when item unit cost does not match custom composition sum', async () => {
            mocks.itemFindMany.mockResolvedValueOnce([
                {
                    id: 'item-1',
                    itemNumber: '1.1',
                    code: 'COMP-001',
                    sourceName: 'PROPRIA',
                    type: 'COMPOSICAO',
                    description: 'Composicao Teste',
                    quantity: 1,
                    unitCost: 200.00, // Drift: budget unitCost is 200, sum is 150
                    unitPrice: 250.00,
                    totalPrice: 250.00,
                    discount: 0,
                }
            ]);
            mocks.compositionFindMany.mockResolvedValueOnce([
                {
                    id: 'comp-1',
                    code: 'COMP-001',
                    totalPrice: 150.00,
                    items: [
                        { id: 'ci-1', price: 100.00, coefficient: 1 },
                        { id: 'ci-2', price: 50.00, coefficient: 1 },
                    ], // sum = 150
                }
            ]);

            const report = await getReconciliationReport('proposal-1', 'tenant-1');
            const alert = report.alerts.find(a => a.type === 'BUDGET_COMPOSITION_MISMATCH');
            expect(alert).toBeDefined();
            expect(alert?.expectedValue).toBe(150);
            expect(alert?.actualValue).toBe(200);
        });

        it('detects BUDGET_MATH_INCONSISTENCY when item unitPrice/totalPrice math is incorrect', async () => {
            mocks.itemFindMany.mockResolvedValueOnce([
                {
                    id: 'item-1',
                    itemNumber: '1.1',
                    code: '74209/1',
                    sourceName: 'SINAPI',
                    type: 'COMPOSICAO',
                    description: 'Alvenaria',
                    quantity: 2,
                    unitCost: 100.00,
                    unitPrice: 120.00, // should be 125 (100 * 1.25 BDI)
                    totalPrice: 240.00, // should be 250
                    discount: 0,
                }
            ]);

            const report = await getReconciliationReport('proposal-1', 'tenant-1');
            const alert = report.alerts.find(a => a.type === 'BUDGET_MATH_INCONSISTENCY');
            expect(alert).toBeDefined();
            expect(alert?.severity).toBe('INFO');
        });
    });

    describe('reconcileProposal', () => {
        it('resolves empty compositions and items to zero', async () => {
            // Mock transaction execution
            mocks.transaction.mockImplementationOnce(async (cb) => {
                return cb(prismaMock);
            });

            mocks.itemFindMany.mockResolvedValueOnce([
                {
                    id: 'item-1',
                    itemNumber: '1.1',
                    code: 'COMP-001',
                    sourceName: 'PROPRIA',
                    type: 'COMPOSICAO',
                    description: 'Composicao Vazia Teste',
                    quantity: 10,
                    unitCost: 150.00,
                    unitPrice: 187.50,
                    totalPrice: 1875.00,
                    discount: 0,
                }
            ]);
            mocks.compositionFindMany.mockResolvedValueOnce([
                {
                    id: 'comp-1',
                    code: 'COMP-001',
                    totalPrice: 150.00,
                    items: [],
                }
            ]);

            mocks.itemFindUnique.mockResolvedValue({
                id: 'item-1',
                code: 'COMP-001',
                sourceName: 'PROPRIA',
                type: 'COMPOSICAO',
                quantity: 10,
                unitCost: 150.00,
                discount: 0,
            });

            // Mock implementation of prisma inside transaction
            const prismaMock = {
                engineeringProposalItem: {
                    findUnique: mocks.itemFindUnique,
                    update: mocks.itemUpdate,
                    findMany: vi.fn().mockResolvedValue([]),
                },
                priceProposal: {
                    update: mocks.proposalUpdate,
                }
            };

            const result = await reconcileProposal('proposal-1', 'tenant-1', 'ZERO_COMPOSITION_AND_ITEM', 'empty-propria-item-1');
            expect(result.success).toBe(true);
            expect(mocks.itemUpdate).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'item-1' },
                data: expect.objectContaining({
                    unitCost: 0,
                    totalPrice: 0,
                })
            }));
        });
    });
});
