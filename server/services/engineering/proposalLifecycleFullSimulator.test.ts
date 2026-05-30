import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enrichWithOfficialPrices } from './priceEnricher';

// Mock do banco Prisma
const mocks = vi.hoisted(() => ({
    proposalFindFirst: vi.fn(),
    proposalFindUnique: vi.fn(),
    proposalUpdate: vi.fn(),
    proposalItemFindMany: vi.fn(),
    proposalItemUpdate: vi.fn(),
    proposalItemUpdateMany: vi.fn(),
    compFindFirst: vi.fn(),
    compFindUnique: vi.fn(),
    compFindMany: vi.fn(),
    compCreate: vi.fn(),
    compItemFindMany: vi.fn(),
    compItemCreate: vi.fn(),
    compItemUpdateMany: vi.fn(),
    itemFindFirst: vi.fn(),
    itemFindMany: vi.fn(),
    itemCreate: vi.fn(),
    itemUpdate: vi.fn(),
    databaseFindFirst: vi.fn(),
    databaseFindMany: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
    prisma: {
        priceProposal: {
            findFirst: (...args: any[]) => mocks.proposalFindFirst(...args),
            findUnique: (...args: any[]) => mocks.proposalFindUnique(...args),
            update: (...args: any[]) => mocks.proposalUpdate(...args),
        },
        engineeringProposalItem: {
            findMany: (...args: any[]) => mocks.proposalItemFindMany(...args),
            update: (...args: any[]) => mocks.proposalItemUpdate(...args),
            updateMany: (...args: any[]) => mocks.proposalItemUpdateMany(...args),
        },
        engineeringComposition: {
            findFirst: (...args: any[]) => mocks.compFindFirst(...args),
            findUnique: (...args: any[]) => mocks.compFindUnique(...args),
            findMany: (...args: any[]) => mocks.compFindMany(...args),
            create: (...args: any[]) => mocks.compCreate(...args),
        },
        engineeringCompositionItem: {
            findMany: (...args: any[]) => mocks.compItemFindMany(...args),
            create: (...args: any[]) => mocks.compItemCreate(...args),
            updateMany: (...args: any[]) => mocks.compItemUpdateMany(...args),
        },
        engineeringItem: {
            findFirst: (...args: any[]) => mocks.itemFindFirst(...args),
            findMany: (...args: any[]) => mocks.itemFindMany(...args),
            create: (...args: any[]) => mocks.itemCreate(...args),
            update: (...args: any[]) => mocks.itemUpdate(...args),
        },
        engineeringDatabase: {
            findFirst: (...args: any[]) => mocks.databaseFindFirst(...args),
            findMany: (...args: any[]) => mocks.databaseFindMany(...args),
        },
        $transaction: async (cb: any) => cb(vi.stubGlobal('prisma', {})),
    },
}));

// Funções utilitárias de arredondamento e BDI idênticas ao backend
const applyPrecision = (value: number, config: any) => {
    const dec = config?.casasDecimais ?? 2;
    if (config?.tipo === 'TRUNCATE') {
        const factor = Math.pow(10, dec);
        return Math.floor(value * factor + 1e-9) / factor;
    }
    return Math.round(value * Math.pow(10, dec)) / Math.pow(10, dec);
};

const applyBdi = (cost: number, bdi: number, config: any) => {
    return applyPrecision(cost * (1 + bdi / 100), config);
};

describe('Proposal Lifecycle Full Simulator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.proposalFindFirst.mockResolvedValue(null);
        mocks.proposalFindUnique.mockResolvedValue(null);
        mocks.proposalUpdate.mockResolvedValue({});
        mocks.proposalItemFindMany.mockResolvedValue([]);
        mocks.proposalItemUpdate.mockResolvedValue({});
        mocks.proposalItemUpdateMany.mockResolvedValue({});
        mocks.compFindFirst.mockResolvedValue(null);
        mocks.compFindUnique.mockResolvedValue(null);
        mocks.compFindMany.mockResolvedValue([]);
        mocks.compCreate.mockResolvedValue({});
        mocks.compItemFindMany.mockResolvedValue([]);
        mocks.compItemCreate.mockResolvedValue({});
        mocks.compItemUpdateMany.mockResolvedValue({});
        mocks.itemFindFirst.mockResolvedValue(null);
        mocks.itemFindMany.mockResolvedValue([]);
        mocks.itemCreate.mockResolvedValue({});
        mocks.itemUpdate.mockResolvedValue({});
        mocks.databaseFindFirst.mockResolvedValue(null);
        mocks.databaseFindMany.mockResolvedValue([]);
    });

    it('Phase 1: Config Step, AI Extraction, and official database matching', async () => {
        // Passo 1: Configuração da Proposta (UFs, Bases, BDI e Precisão)
        const engineeringConfig = {
            UF: 'SP',
            basesConsideradas: ['SINAPI'],
            dataBase: '2026-04',
            regimeOneracao: 'DESONERADO',
            bdiDiferenciado: true,
            bdiFornecimento: 15.00,
            precision: { tipo: 'ROUND', casasDecimais: 2 }
        };

        const bdiConfig = {
            bdiGlobal: 25.00
        };

        // Passo 2: Simulação de extração pela IA de 2 itens de orçamento
        const extractedItems = [
            {
                code: '88316', // Código SINAPI oficial
                sourceName: 'SINAPI',
                description: 'SERVENTE COM ENCARGOS COMPLEMENTARES',
                unit: 'H',
                quantity: 120,
                unitCost: 0, // Custo zero vindo da extração
                type: 'COMPOSICAO',
                bdiCategoria: 'OBRA'
            },
            {
                code: '95389', // Código de fornecimento de equipamentos/materiais
                sourceName: 'SINAPI',
                description: 'CURSO DE CAPACITAÇÃO PARA OPERADOR',
                unit: 'UN',
                quantity: 2,
                unitCost: 0,
                type: 'COMPOSICAO',
                bdiCategoria: 'FORNECIMENTO'
            }
        ];

        // Mock das composições SINAPI no banco de dados oficial
        mocks.compFindMany.mockResolvedValueOnce([
            {
                id: 'sinapi-88316',
                code: '88316',
                description: 'SERVENTE COM ENCARGOS COMPLEMENTARES',
                unit: 'H',
                totalPrice: 18.50,
                database: {
                    id: 'db-sinapi-sp',
                    type: 'OFICIAL',
                    name: 'SINAPI',
                    uf: 'SP',
                    version: '026',
                    payrollExemption: true
                }
            },
            {
                id: 'sinapi-95389',
                code: '95389',
                description: 'CURSO DE CAPACITAÇÃO PARA OPERADOR',
                unit: 'UN',
                totalPrice: 350.00,
                database: {
                    id: 'db-sinapi-sp',
                    type: 'OFICIAL',
                    name: 'SINAPI',
                    uf: 'SP',
                    version: '026',
                    payrollExemption: true
                }
            }
        ]);

        // Executar enriquecimento de preços oficiais
        const enrichmentResult = await enrichWithOfficialPrices(
            extractedItems,
            {
                objeto: 'Auditoria de Teste',
                basesConsideradas: engineeringConfig.basesConsideradas,
                ufReferencia: engineeringConfig.UF,
                dataBase: engineeringConfig.dataBase,
                regimeOneracao: engineeringConfig.regimeOneracao
            },
            { tenantId: 'tenant-123' }
        );

        // Verificações
        expect(enrichmentResult.matched).toBe(2);
        expect(extractedItems[0].unitCost).toBe(18.50);
        expect(extractedItems[0].priceOrigin).toBe('BASE');
        expect(extractedItems[0].priceAudit?.status).toBe('OK');
        
        expect(extractedItems[1].unitCost).toBe(350.00);
        expect(extractedItems[1].priceOrigin).toBe('BASE');
    });

    it('Phase 2: Own composition creation (PROPRIA) with coefficient correction and linking', async () => {
        const precisionConfig = { tipo: 'ROUND', casasDecimais: 2 };

        // Simulação da criação de composição própria (Ex: Alvenaria Personalizada)
        const customCompCode = 'PROP-ALV-01';
        
        // Insumos que compõem a composição própria
        const compositionInsumos = [
            {
                coefficient: 100, // Coeficiente exagerado que simula o bug de escala de 100x
                item: { code: 'INS-001', description: 'Tijolo Cerâmico', price: 0.45, type: 'MATERIAL', unit: 'UN' }
            },
            {
                coefficient: 0.5,
                item: { code: 'INS-002', description: 'Servente de Pedreiro', price: 18.50, type: 'MAO_DE_OBRA', unit: 'H' }
            }
        ];

        // 1. Correção de escala de coeficientes (igual ao logic do compositionSaveService.ts)
        const correctedItems = compositionInsumos.map(ci => {
            let coefficient = ci.coefficient;
            let corrected = false;
            // Se o coeficiente for 100 e o preço unitário for baixo, pode ser anomalia de 100x
            if (ci.item.type === 'MATERIAL' && ci.coefficient === 100 && ci.item.price < 5) {
                coefficient = ci.coefficient / 100; // Reduz de 100 para 1
                corrected = true;
            }
            return {
                ...ci,
                coefficient,
                corrected
            };
        });

        expect(correctedItems[0].corrected).toBe(true);
        expect(correctedItems[0].coefficient).toBe(1); // Escala corrigida de 100x para 1x

        // 2. Cálculo do Custo Unitário da Composição Própria
        const compUnitCost = correctedItems.reduce((sum, ci) => {
            const itemCost = ci.coefficient * ci.item.price;
            return sum + applyPrecision(itemCost, precisionConfig);
        }, 0);

        // Tijolo: 1 * 0.45 = 0.45
        // Servente: 0.5 * 18.50 = 9.25
        // Total = 9.70
        expect(compUnitCost).toBe(9.70);

        // 3. Vinculação ao item da Proposta com aplicação de BDI
        const bdiGlobal = 25.00;
        const proposalItem = {
            id: 'proposal-item-3',
            code: customCompCode,
            quantity: 500,
            unitCost: compUnitCost,
            bdiCategoria: 'OBRA',
            type: 'COMPOSICAO'
        };

        const itemUnitPrice = applyBdi(proposalItem.unitCost, bdiGlobal, precisionConfig);
        const itemTotalPrice = applyPrecision(proposalItem.quantity * itemUnitPrice, precisionConfig);

        // 9.70 * 1.25 = 12.125 -> Arredondado = 12.13
        expect(itemUnitPrice).toBe(12.13);
        // 500 * 12.13 = 6065.00
        expect(itemTotalPrice).toBe(6065.00);
    });

    it('Phase 3: Manual overrides on composition sub-items and sync cascading', async () => {
        const precisionConfig = { tipo: 'ROUND', casasDecimais: 2 };
        const bdiGlobal = 25.00;

        // Composição e item atuais
        let compUnitCost = 9.70; // Preço original
        const proposalItem = {
            id: 'proposal-item-3',
            code: 'PROP-ALV-01',
            quantity: 500,
            unitCost: compUnitCost,
            unitPrice: 12.13,
            totalPrice: 6065.00
        };

        // Simula o usuário alterando manualmente o preço do Servente (INS-002) de 18.50 para 22.00
        const newServentePrice = 22.00;

        const updatedCompositionInsumos = [
            { coefficient: 1, item: { code: 'INS-001', price: 0.45 } },
            { coefficient: 0.5, item: { code: 'INS-002', price: newServentePrice } }
        ];

        // Recalcula o custo da composição
        const newCompUnitCost = updatedCompositionInsumos.reduce((sum, ci) => {
            return sum + applyPrecision(ci.coefficient * ci.item.price, precisionConfig);
        }, 0);

        // Tijolo: 1 * 0.45 = 0.45
        // Servente: 0.5 * 22.00 = 11.00
        // Total = 11.45
        expect(newCompUnitCost).toBe(11.45);

        // Atualiza o item do orçamento (cascata de sync)
        const updatedItemUnitPrice = applyBdi(newCompUnitCost, bdiGlobal, precisionConfig);
        const updatedItemTotalPrice = applyPrecision(proposalItem.quantity * updatedItemUnitPrice, precisionConfig);

        // 11.45 * 1.25 = 14.3125 -> Arredondado = 14.31
        expect(updatedItemUnitPrice).toBe(14.31);
        expect(updatedItemTotalPrice).toBe(7155.00);
    });

    it('Phase 4: Global Target Price Adjustments (TCU safety-check and linear discount)', async () => {
        const precisionConfig = { tipo: 'ROUND', casasDecimais: 2 };
        const bdiGlobal = 25.00;

        // Lista de itens no orçamento atual
        const items = [
            {
                id: 'item-1',
                code: '88316',
                description: 'SERVENTE COM ENCARGOS COMPLEMENTARES',
                quantity: 100,
                unitCost: 18.50,
                type: 'COMPOSICAO',
                bdiCategoria: 'OBRA',
                insumos: [
                    { code: 'INS-SERV', description: 'Servente Horista', price: 18.50, type: 'MAO_DE_OBRA' }
                ]
            },
            {
                id: 'item-2',
                code: 'COMP-MAT',
                description: 'COMPOSICAO DE MATERIAIS DIVERSOS',
                quantity: 50,
                unitCost: 80.00,
                type: 'COMPOSICAO',
                bdiCategoria: 'OBRA',
                insumos: [
                    { code: 'INS-MAT1', description: 'Material A', price: 40.00, type: 'MATERIAL' },
                    { code: 'INS-MAT2', description: 'Material B', price: 40.00, type: 'MATERIAL' }
                ]
            }
        ];

        // 1. Calcula preço total de venda atual
        const calculateTotalProposalPrice = (itemsList: any[]) => {
            return itemsList.reduce((sum, item) => {
                const itemUnitPrice = applyBdi(item.unitCost, bdiGlobal, precisionConfig);
                const itemTotalPrice = applyPrecision(item.quantity * itemUnitPrice, precisionConfig);
                return sum + itemTotalPrice;
            }, 0);
        };

        // Item 1: 18.50 * 1.25 = 23.13 * 100 = 2313.00
        // Item 2: 80.00 * 1.25 = 100.00 * 50 = 5000.00
        // Total Geral = 7313.00
        const currentTotalPrice = calculateTotalProposalPrice(items);
        expect(currentTotalPrice).toBe(7313.00);

        // 2. Calcula custo total de mão de obra (Mão de obra obrigatória + encargos complementares)
        // Deve ser protegido contra reajustes/descontos (Jurisprudência do TCU)
        const calculateLaborCosts = (itemsList: any[]) => {
            let laborCost = 0;
            for (const item of itemsList) {
                for (const ins of item.insumos) {
                    if (ins.type === 'MAO_DE_OBRA' || ins.type === 'Encargos Complementares') {
                        // Aplica o BDI sobre o custo da mão de obra
                        const priceWithBdi = applyBdi(ins.price, bdiGlobal, precisionConfig);
                        laborCost += item.quantity * priceWithBdi;
                    }
                }
            }
            return laborCost;
        };

        const totalLaborPrice = calculateLaborCosts(items);
        expect(totalLaborPrice).toBe(2313.00); // 100h * (18.50 * 1.25) = 2313.00

        // 3. Simula ajuste para um valor alvo (Target Value) de R$ 6.000,00
        const targetValue = 6000.00;

        // VALIDAÇÃO DE INEXEQUÍVEL (TCU Acórdão 1097/2019-Plenário)
        // Se tentarmos reduzir para um valor menor que a mão de obra, deve estourar erro
        const invalidTarget = 2000.00;
        expect(invalidTarget).toBeLessThan(totalLaborPrice);
        const checkExequibilidade = (target: number, laborTotal: number) => {
            if (target < laborTotal) {
                throw new Error(`Inexequibilidade: O valor alvo R$ ${target} é menor que o custo de mão de obra obrigatória R$ ${laborTotal}.`);
            }
        };

        expect(() => checkExequibilidade(invalidTarget, totalLaborPrice)).toThrowError(/Inexequibilidade/);

        // 4. Executa a distribuição do desconto apenas nos insumos de material/não-labor
        // Preço não-labor atual = 5000.00. Desconto requerido = 7313.00 - 6000.00 = 1313.00.
        // Fator de desconto para o grupo não-labor = (5000.00 - 1313.00) / 5000.00 = 3687.00 / 5000.00 = 0.7374 (26.26% de desconto)
        const totalDiscountRequired = currentTotalPrice - targetValue; // 1313.00
        const currentNonLaborPrice = currentTotalPrice - totalLaborPrice; // 5000.00
        
        const discountFactor = (currentNonLaborPrice - totalDiscountRequired) / currentNonLaborPrice; // 0.7374

        // Aplica o fator de desconto sobre os insumos do Item 2 (Material)
        const adjustedItems = items.map(item => {
            const hasLabor = item.insumos.some((ins: any) => ins.type === 'MAO_DE_OBRA');
            if (hasLabor) {
                // Mantém intacto
                return item;
            } else {
                // Aplica o desconto proporcional
                const newInsumos = item.insumos.map((ins: any) => {
                    const newPrice = applyPrecision(ins.price * discountFactor, precisionConfig);
                    return { ...ins, price: newPrice };
                });
                const newUnitCost = newInsumos.reduce((sum, ins) => sum + ins.price, 0);
                return {
                    ...item,
                    insumos: newInsumos,
                    unitCost: newUnitCost,
                    priceOrigin: 'PROPRIA' // O item agora vira próprio por ter preço customizado
                };
            }
        });

        // Novo custo do Item 2:
        // Cada Material: 40.00 * 0.7374 = 29.496 -> Arredondado = 29.50
        // Custo total da composição: 29.50 + 29.50 = 59.00
        expect(adjustedItems[1].unitCost).toBe(59.00);
        expect(adjustedItems[1].priceOrigin).toBe('PROPRIA');

        // 5. Calcula o preço final da proposta ajustada
        const finalTotalPrice = calculateTotalProposalPrice(adjustedItems);

        // Item 1 (Labor): 2313.00
        // Item 2 (Materiais): 59.00 * 1.25 = 73.75 * 50 = 3687.50
        // Total Geral Ajustado = 2313.00 + 3687.50 = 6000.50
        expect(finalTotalPrice).toBe(6000.50);
        // O valor final está a apenas 50 centavos (diferença de arredondamento aceitável) do valor alvo de R$ 6000,00!
        expect(Math.abs(finalTotalPrice - targetValue)).toBeLessThan(1.00);
    });
});
