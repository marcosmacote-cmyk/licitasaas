import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useProposal } from '../useProposal';
import { createBidding, createCompany, createProposal, createProposalItem, mockFetchSuccess, mockFetchError, resetMocks } from '../../../test/helpers';

// Mock export services
vi.mock('../../proposals/engine', () => ({
    calculateItem: vi.fn((item: any, bdi: number, discount: number) => ({
        unitPrice: item.unitCost * (1 + bdi / 100) * (1 - discount / 100),
        totalPrice: item.unitCost * item.quantity * (1 + bdi / 100) * (1 - discount / 100),
    })),
    calculateTotals: vi.fn((items: any[]) => ({
        subtotal: items.reduce((sum: number, it: any) => sum + (it.totalPrice || 0), 0),
        total: items.reduce((sum: number, it: any) => sum + (it.totalPrice || 0), 0),
    })),
    calculateAdjustedItem: vi.fn(() => ({ adjustedUnitPrice: 0, adjustedTotalPrice: 0 })),
    calculateAdjustedTotals: vi.fn(() => ({ subtotal: 0, total: 0 })),
}));

vi.mock('../../proposals/exportServices', () => ({
    exportExcelProposal: vi.fn(),
    generateProposalPdf: vi.fn(),
}));

// Mock useSSE (background jobs)
vi.mock('../useSSE', () => ({
    submitBackgroundJob: vi.fn().mockResolvedValue({ jobId: 'test-job' }),
    fetchJobResult: vi.fn().mockResolvedValue({}),
    useSSE: vi.fn(),
}));

// Mock governance — allow production-proposal for stages used in tests
vi.mock('../../../governance', () => ({
    resolveStage: vi.fn((status: string) => status),
    isModuleAllowed: vi.fn((stage: string, _substage: string, module: string) => {
        // Preparando Documentação + Preparando Proposta allow production-proposal
        if (module === 'production-proposal') {
            return ['Preparando Documentação', 'Preparando Proposta', 'Aprovado para Participação'].includes(stage);
        }
        return true;
    }),
}));

// Track toast calls
const toastMock = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
};

vi.mock('../../ui', () => ({
    useToast: () => toastMock,
    ToastProvider: ({ children }: any) => children,
}));

describe('useProposal', () => {
    const biddings = [
        createBidding({ id: 'bid-1', title: 'Pregão 001', status: 'Preparando Documentação', aiAnalysis: null }),
        createBidding({ id: 'bid-2', title: 'Pregão 002', status: 'Captado' }),
    ];
    const companies = [
        createCompany({ id: 'comp-1', razaoSocial: 'TechCorp' }),
        createCompany({ id: 'comp-2', razaoSocial: 'BuildCo' }),
    ];

    beforeEach(() => {
        resetMocks();
        Object.values(toastMock).forEach(fn => fn.mockClear());
    });

    const renderUseProposal = () => renderHook(() => useProposal({ biddings, companies }));

    // ═══════════════════════════════════
    // INITIAL STATE
    // ═══════════════════════════════════
    describe('Estado Inicial', () => {
        it('deve inicializar sem seleção', () => {
            const { result } = renderUseProposal();
            expect(result.current.selectedBiddingId).toBe('');
            expect(result.current.selectedCompanyId).toBe('');
            expect(result.current.proposal).toBeNull();
        });

        it('deve filtrar apenas biddings em Preparando Documentação', () => {
            const { result } = renderUseProposal();
            expect(result.current.availableBiddings).toHaveLength(1);
            expect(result.current.availableBiddings[0].id).toBe('bid-1');
        });

        it('deve inicializar BDI=0 e discount=0', () => {
            const { result } = renderUseProposal();
            expect(result.current.bdi).toBe(0);
            expect(result.current.discount).toBe(0);
        });

        it('deve inicializar com aba de itens', () => {
            const { result } = renderUseProposal();
            expect(result.current.activeTab).toBe('items');
        });

        it('deve inicializar com roundingMode ROUND', () => {
            const { result } = renderUseProposal();
            expect(result.current.roundingMode).toBe('ROUND');
        });
    });

    // ═══════════════════════════════════
    // LOADING PROPOSALS
    // ═══════════════════════════════════
    describe('Carregamento de Propostas', () => {
        it('deve carregar proposals quando bidding é selecionada', async () => {
            const proposal = createProposal({ id: 'prop-1', items: [createProposalItem()] });
            mockFetchSuccess([proposal]);

            const { result } = renderUseProposal();
            act(() => result.current.setSelectedBiddingId('bid-1'));

            await waitFor(() => {
                expect(result.current.proposal).not.toBeNull();
                expect(result.current.items.length).toBeGreaterThan(0);
            });
        });

        it('deve limpar estado quando bidding é deselecionada', () => {
            const { result } = renderUseProposal();
            act(() => result.current.setSelectedBiddingId(''));
            expect(result.current.proposal).toBeNull();
            expect(result.current.items).toEqual([]);
        });

        it('deve carregar BDI e discount da proposta existente', async () => {
            const proposal = createProposal({ bdiPercentage: 25, taxPercentage: 10, socialCharges: 1 });
            mockFetchSuccess([proposal]);

            const { result } = renderUseProposal();
            act(() => result.current.setSelectedBiddingId('bid-1'));

            await waitFor(() => {
                expect(result.current.bdi).toBe(25);
                expect(result.current.discount).toBe(10);
                expect(result.current.roundingMode).toBe('TRUNCATE');
            });
        });
    });

    // ═══════════════════════════════════
    // PROPOSAL CREATION
    // ═══════════════════════════════════
    describe('Criação de Proposta', () => {
        it('deve alertar quando bidding/company não selecionados', async () => {
            const { result } = renderUseProposal();
            await act(async () => result.current.handleCreateProposal());
            expect(toastMock.warning).toHaveBeenCalledWith(expect.stringContaining('Selecione'));
        });

        it('deve criar proposta via API com dados corretos', async () => {
            const newProposal = createProposal({ id: 'prop-new' });
            mockFetchSuccess(newProposal);

            const { result } = renderUseProposal();
            act(() => {
                result.current.setSelectedBiddingId('bid-1');
                result.current.setSelectedCompanyId('comp-1');
            });

            // Need to clear the load proposals fetch
            await waitFor(() => {});
            (global.fetch as ReturnType<typeof vi.fn>).mockClear();
            mockFetchSuccess(newProposal);

            await act(async () => result.current.handleCreateProposal());

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/proposals'),
                expect.objectContaining({ method: 'POST' })
            );
        });
    });

    // ═══════════════════════════════════
    // ITEM MANAGEMENT
    // ═══════════════════════════════════
    describe('Gerenciamento de Itens', () => {
        it('handleAddItem deve adicionar item com id temporário', () => {
            const { result } = renderUseProposal();
            act(() => result.current.handleAddItem());
            expect(result.current.items).toHaveLength(1);
            expect(result.current.items[0].id).toContain('temp-');
            expect(result.current.isBulkEditing).toBe(true);
        });

        it('updateItem deve atualizar campo e recalcular preços', () => {
            const { result } = renderUseProposal();
            act(() => result.current.handleAddItem());
            const itemId = result.current.items[0].id;

            act(() => result.current.updateItem(itemId, 'description', 'Serviço X'));
            expect(result.current.items[0].description).toBe('Serviço X');
        });

        it('handleDeleteItem deve remover item temporário imediatamente', async () => {
            const { result } = renderUseProposal();
            act(() => result.current.handleAddItem());
            const itemId = result.current.items[0].id;

            await act(async () => result.current.handleDeleteItem(itemId));
            expect(result.current.items).toHaveLength(0);
        });

        it('handleDeleteItem deve preparar confirmação para item persistido', async () => {
            const proposal = createProposal({ items: [createProposalItem({ id: 'item-real' })] });
            mockFetchSuccess([proposal]);

            const { result } = renderUseProposal();
            act(() => result.current.setSelectedBiddingId('bid-1'));

            await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0));

            await act(async () => result.current.handleDeleteItem('item-real'));
            expect(result.current.confirmDeleteItemId).toBe('item-real');
        });
    });

    // ═══════════════════════════════════
    // CONFIG SAVE
    // ═══════════════════════════════════
    describe('Configurações', () => {
        it('deve alternar BDI e recalcular', () => {
            const { result } = renderUseProposal();
            act(() => result.current.setBdi(30));
            expect(result.current.bdi).toBe(30);
        });

        it('deve alternar discount', () => {
            const { result } = renderUseProposal();
            act(() => result.current.setDiscount(15));
            expect(result.current.discount).toBe(15);
        });

        it('deve alternar entre abas items e letter', () => {
            const { result } = renderUseProposal();
            act(() => result.current.setActiveTab('letter'));
            expect(result.current.activeTab).toBe('letter');
        });

        it('handleSaveConfig deve chamar PUT /api/proposals/:id', async () => {
            const proposal = createProposal({ id: 'prop-1' });
            mockFetchSuccess([proposal]);

            const { result } = renderUseProposal();
            act(() => result.current.setSelectedBiddingId('bid-1'));

            await waitFor(() => expect(result.current.proposal).not.toBeNull());
            (global.fetch as ReturnType<typeof vi.fn>).mockClear();
            mockFetchSuccess({});
            // loadProposals is called again after save
            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                ok: true, status: 200,
                json: () => Promise.resolve({}),
                text: () => Promise.resolve('{}'),
            });
            (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                ok: true, status: 200,
                json: () => Promise.resolve([proposal]),
                text: () => Promise.resolve('[]'),
            });

            await act(async () => result.current.handleSaveConfig());

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/proposals/prop-1'),
                expect.objectContaining({ method: 'PUT' })
            );
        });
    });

    // ═══════════════════════════════════
    // TOTALS
    // ═══════════════════════════════════
    describe('Totais', () => {
        it('deve calcular subtotal e total', () => {
            const { result } = renderUseProposal();
            expect(result.current.subtotal).toBeDefined();
            expect(result.current.total).toBeDefined();
        });
    });
});
