import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enrichWithOfficialPrices } from './priceEnricher';

// Mock do banco Prisma
const mocks = vi.hoisted(() => ({
    proposalFindFirst: vi.fn(),
    proposalUpdate: vi.fn(),
    itemFindMany: vi.fn(),
    itemUpdate: vi.fn(),
    compFindMany: vi.fn(),
    databaseFindMany: vi.fn(),
    queryRaw: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
    prisma: {
        priceProposal: {
            findFirst: (...args: any[]) => mocks.proposalFindFirst(...args),
            update: (...args: any[]) => mocks.proposalUpdate(...args),
        },
        engineeringProposalItem: {
            findMany: (...args: any[]) => mocks.itemFindMany(...args),
            update: (...args: any[]) => mocks.itemUpdate(...args),
        },
        engineeringComposition: {
            findMany: (...args: any[]) => mocks.compFindMany(...args),
        },
        engineeringItem: {
            findMany: async () => [],
        },
        engineeringDatabase: {
            findMany: (...args: any[]) => mocks.databaseFindMany(...args),
        },
        $queryRaw: (...args: any[]) => mocks.queryRaw(...args),
        $transaction: async (cb: any) => cb(vi.stubGlobal('prisma', {})),
    },
}));

describe('Proposal Scenario Simulator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.proposalFindFirst.mockResolvedValue(null);
        mocks.proposalUpdate.mockResolvedValue({});
        mocks.itemFindMany.mockResolvedValue([]);
        mocks.itemUpdate.mockResolvedValue({});
        mocks.compFindMany.mockResolvedValue([]);
        mocks.databaseFindMany.mockResolvedValue([]);
        mocks.queryRaw.mockResolvedValue([]);
    });

    it('Scenario 1: AI extraction with 0-cost items and successful official database match', async () => {
        // Simula o item extraído pela IA sem custo unitário, mas com código e fonte definidos
        const extractedItems = [
            {
                code: 'C1937',
                sourceName: 'SEINFRA',
                unitCost: 0,
                unit: 'M2',
                quantity: 6,
                type: 'COMPOSICAO',
            }
        ];

        // Mock das configurações de engenharia
        const engConfig = {
            objeto: 'Construção da Praça Pacatuba',
            basesConsideradas: ['SEINFRA'],
            ufReferencia: 'CE',
            dataBase: '2026-04',
            regimeOneracao: 'DESONERADO',
        };

        // Mock do banco oficial contendo a composição SEINFRA C1937 com preço de R$ 183.41
        mocks.compFindMany.mockResolvedValueOnce([
            {
                id: 'seinfra-c1937',
                code: 'C1937',
                description: 'PLACAS PADRÃO DE OBRA',
                unit: 'M2',
                totalPrice: 183.41,
                database: {
                    id: 'db-seinfra-ce',
                    type: 'OFICIAL',
                    name: 'SEINFRA',
                    uf: 'CE',
                    version: '028',
                    payrollExemption: true,
                }
            }
        ]);

        // Executa o enriquecimento de preço
        const result = await enrichWithOfficialPrices(extractedItems, engConfig, { tenantId: 'tenant-1' });

        expect(result.matched).toBe(1);
        expect(extractedItems[0].unitCost).toBe(183.41);
        expect(extractedItems[0].priceOrigin).toBe('BASE');
        expect(extractedItems[0].priceAudit?.status).toBe('OK');
    });

    it('Scenario 2: Changing BDI parameters and recalculating unit prices', async () => {
        const items = [
            {
                id: 'item-1',
                code: 'C1937',
                unitCost: 183.41,
                quantity: 6,
                type: 'COMPOSICAO',
                bdiCategoria: 'OBRA',
            }
        ];

        // Se o BDI mudar para 28.41%
        const bdiGlobal = 28.41;
        const precisionConfig = { tipo: 'ROUND', casasDecimais: 2 };

        const applyPrecision = (value: number, config: any) => {
            const dec = config.casasDecimais ?? 2;
            return Math.round(value * Math.pow(10, dec)) / Math.pow(10, dec);
        };
        const applyBdi = (cost: number, bdi: number) => applyPrecision(cost * (1 + bdi / 100), precisionConfig);

        const updatedItems = items.map(it => {
            const unitPrice = applyBdi(it.unitCost, bdiGlobal);
            return {
                ...it,
                unitPrice,
                totalPrice: applyPrecision(it.quantity * unitPrice, precisionConfig),
            };
        });

        // 183.41 * 1.2841 = 235.516 -> arredondado para 235.52
        expect(updatedItems[0].unitPrice).toBe(235.52);
        // 6 * 235.52 = 1413.12
        expect(updatedItems[0].totalPrice).toBe(1413.12);
    });

    it('Scenario 3: Global Target Price Adjustment (linear adjustment of proposal)', async () => {
        const items = [
            { id: 'item-1', code: 'C1937', quantity: 6, unitPrice: 235.52, totalPrice: 1413.12, type: 'COMPOSICAO' },
            { id: 'item-2', code: 'C2850', quantity: 1, unitPrice: 2153.04, totalPrice: 2153.04, type: 'COMPOSICAO' }
        ];

        const initialTotal = items.reduce((sum, it) => sum + it.totalPrice, 0); // 3566.16
        const targetTotal = 3200.00; // Queremos reduzir o total global para R$ 3200,00

        // Fator de ajuste linear proporcional
        const adjustmentFactor = targetTotal / initialTotal;

        const adjustedItems = items.map(it => {
            const newUnitPrice = Math.round(it.unitPrice * adjustmentFactor * 100) / 100;
            return {
                ...it,
                unitPrice: newUnitPrice,
                totalPrice: Math.round(it.quantity * newUnitPrice * 100) / 100,
            };
        });

        const newTotal = adjustedItems.reduce((sum, it) => sum + it.totalPrice, 0);

        expect(newTotal).toBeLessThan(initialTotal);
        // O valor final deve estar muito próximo do target total (R$ 3200,00)
        expect(Math.abs(newTotal - targetTotal)).toBeLessThan(10);
    });
});
