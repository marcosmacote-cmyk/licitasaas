import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompositionFlattener } from './compositionFlattener';

// Mock the Prisma DB
const mocks = vi.hoisted(() => ({
    proposalFindFirst: vi.fn(),
    proposalItemFindMany: vi.fn(),
    compFindFirst: vi.fn(),
    compFindUnique: vi.fn(),
    compFindMany: vi.fn(),
    databaseFindFirst: vi.fn(),
    databaseFindMany: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
    prisma: {
        priceProposal: {
            findFirst: (...args: any[]) => mocks.proposalFindFirst(...args),
        },
        engineeringProposalItem: {
            findMany: (...args: any[]) => mocks.proposalItemFindMany(...args),
        },
        engineeringComposition: {
            findFirst: (...args: any[]) => mocks.compFindFirst(...args),
            findUnique: (...args: any[]) => mocks.compFindUnique(...args),
            findMany: (...args: any[]) => mocks.compFindMany(...args),
        },
        engineeringDatabase: {
            findFirst: (...args: any[]) => mocks.databaseFindFirst(...args),
            findMany: (...args: any[]) => mocks.databaseFindMany(...args),
        },
    },
    default: {
        priceProposal: {
            findFirst: (...args: any[]) => mocks.proposalFindFirst(...args),
        },
        engineeringProposalItem: {
            findMany: (...args: any[]) => mocks.proposalItemFindMany(...args),
        },
        engineeringComposition: {
            findFirst: (...args: any[]) => mocks.compFindFirst(...args),
            findUnique: (...args: any[]) => mocks.compFindUnique(...args),
            findMany: (...args: any[]) => mocks.compFindMany(...args),
        },
        engineeringDatabase: {
            findFirst: (...args: any[]) => mocks.databaseFindFirst(...args),
            findMany: (...args: any[]) => mocks.databaseFindMany(...args),
        },
    }
}));

describe('CompositionFlattener - Synthetic/Empty Compositions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.proposalFindFirst.mockResolvedValue(null);
        mocks.proposalItemFindMany.mockResolvedValue([]);
        mocks.compFindFirst.mockResolvedValue(null);
        mocks.compFindUnique.mockResolvedValue(null);
        mocks.compFindMany.mockResolvedValue([]);
        mocks.databaseFindFirst.mockResolvedValue(null);
        mocks.databaseFindMany.mockResolvedValue([]);
    });

    it('should treat resolved compositions with 0 items as direct insumos', async () => {
        // Mock a proposal item that points to code 1900
        mocks.proposalItemFindMany.mockResolvedValueOnce([
            {
                id: 'p-item-1',
                code: '1900/ORSE',
                sourceName: 'ORSE',
                description: 'LUVA DE PRESSAO, EM PVC, DE 32 MM, PARA ELETRODUTO FLEXIVEL',
                unit: 'UN',
                quantity: 10,
                unitCost: 1.30,
                unitPrice: 1.65,
                totalPrice: 16.50,
                type: 'COMPOSICAO',
            }
        ]);

        // Mock composition 1900 in database with 0 items (synthetic)
        mocks.compFindMany.mockResolvedValueOnce([
            {
                id: 'comp-1900',
                code: '1900/ORSE',
                description: 'LUVA DE PRESSAO, EM PVC, DE 32 MM, PARA ELETRODUTO FLEXIVEL',
                unit: 'UN',
                totalPrice: 1.30,
                metadata: '{}',
                database: {
                    id: 'db-orse',
                    name: 'ORSE',
                },
                items: [] // No detailed items (synthetic/casca composition)
            }
        ]);

        mocks.compFindUnique.mockResolvedValueOnce({
            id: 'comp-1900',
            code: '1900/ORSE',
            description: 'LUVA DE PRESSAO, EM PVC, DE 32 MM, PARA ELETRODUTO FLEXIVEL',
            unit: 'UN',
            totalPrice: 1.30,
            metadata: '{}',
            database: {
                id: 'db-orse',
                name: 'ORSE',
            },
            items: []
        });

        const flattener = new CompositionFlattener(0.269, 0.8464);
        const report = await flattener.flattenProposal('proposal-1');

        expect(report.principalCompositions).toHaveLength(1);
        const comp = report.principalCompositions[0];

        // Must be marked as direct insumo in metadata
        expect(comp.metadata?._isDirectInsumo).toBe(true);

        // Since it is a material (UN / Luva de Pressão), MO should be 0
        expect(comp.totalMoComLs).toBe(0);
        expect(comp.totalMoSemLs).toBe(0);
        expect(comp.totalLs).toBe(0);
        expect(comp.totalMaterial).toBe(1.30);
    });

    it('should classify synthetic labor compositions as MAO_DE_OBRA and extract LS correctly', async () => {
        mocks.proposalItemFindMany.mockResolvedValueOnce([
            {
                id: 'p-item-2',
                code: '88316',
                sourceName: 'SINAPI',
                description: 'SERVENTE COM ENCARGOS COMPLEMENTARES',
                unit: 'H',
                quantity: 5,
                unitCost: 20.00,
                unitPrice: 25.00,
                totalPrice: 125.00,
                type: 'COMPOSICAO',
            }
        ]);

        mocks.compFindMany.mockResolvedValueOnce([
            {
                id: 'comp-88316',
                code: '88316',
                description: 'SERVENTE COM ENCARGOS COMPLEMENTARES',
                unit: 'H',
                totalPrice: 20.00,
                metadata: '{}',
                database: {
                    id: 'db-sinapi',
                    name: 'SINAPI',
                },
                items: []
            }
        ]);

        mocks.compFindUnique.mockResolvedValueOnce({
            id: 'comp-88316',
            code: '88316',
            description: 'SERVENTE COM ENCARGOS COMPLEMENTARES',
            unit: 'H',
            totalPrice: 20.00,
            metadata: '{}',
            database: {
                id: 'db-sinapi',
                name: 'SINAPI',
            },
            items: []
        });

        const flattener = new CompositionFlattener(0.25, 0.8464);
        const report = await flattener.flattenProposal('proposal-2');

        expect(report.principalCompositions).toHaveLength(1);
        const comp = report.principalCompositions[0];

        expect(comp.metadata?._isDirectInsumo).toBe(true);
        expect(comp.totalMoComLs).toBe(20.00);
        
        // totalMoSemLs = 20 / (1 + 0.8464) = 20 / 1.8464 = 10.83188
        expect(comp.totalMoSemLs).toBeCloseTo(10.83188, 4);
        expect(comp.totalLs).toBeCloseTo(20.00 - 10.83188, 4);
        expect(comp.totalMaterial).toBe(0);
    });
});
