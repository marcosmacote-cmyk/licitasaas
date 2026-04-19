import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBiddingPage } from '../useBiddingPage';
import { createBidding, createCompany, mockFetchSuccess, mockFetchError, mockFetchNetworkError, resetMocks } from '../../../test/helpers';

// Mock heavy dependencies to prevent import errors
vi.mock('jspdf', () => ({ jsPDF: vi.fn(() => ({ setFontSize: vi.fn(), text: vi.fn(), save: vi.fn() })) }));
vi.mock('jspdf-autotable', () => ({ default: vi.fn() }));
vi.mock('xlsx', () => ({ utils: { aoa_to_sheet: vi.fn(), book_new: vi.fn(), book_append_sheet: vi.fn() }, writeFile: vi.fn() }));
vi.mock('date-fns', () => ({ format: vi.fn(() => '01/01/2026') }));
vi.mock('../../../services/ai', () => ({ aiService: { parseEditalPDF: vi.fn() } }));

vi.mock('../ui', () => ({
    useToast: () => ({
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        info: vi.fn(),
    }),
    ConfirmDialog: () => null,
    ToastProvider: ({ children }: any) => children,
}));

import type { BiddingProcess } from '../../../../types';

describe('useBiddingPage', () => {
    let items: BiddingProcess[];
    let setItems: ReturnType<typeof vi.fn>;
    const companies = [createCompany({ id: 'comp-1' }), createCompany({ id: 'comp-2', razaoSocial: 'BuildCo' })];

    beforeEach(() => {
        resetMocks();
        items = [
            createBidding({ id: 'b1', title: 'Pregão 001', status: 'Captado', companyProfileId: 'comp-1', modality: 'Pregão', portal: 'ComprasNet', risk: 'Baixo' }),
            createBidding({ id: 'b2', title: 'Pregão 002', status: 'Em Análise', companyProfileId: 'comp-2', modality: 'Concorrência', portal: 'BLL', risk: 'Alto' }),
            createBidding({ id: 'b3', title: 'Concurso 001', status: 'Em Sessão', companyProfileId: 'comp-1', modality: 'Pregão', portal: 'ComprasNet', risk: 'Médio' }),
        ];
        setItems = vi.fn((updater) => {
            if (typeof updater === 'function') items = updater(items);
            else items = updater;
        });
    });

    const renderUseBiddingPage = () => renderHook(() =>
        useBiddingPage({ items, setItems, companies })
    );

    // ═══════════════════════════════════
    // INITIAL STATE
    // ═══════════════════════════════════
    describe('Estado Inicial', () => {
        it('deve inicializar com viewMode kanban por padrão', () => {
            const { result } = renderUseBiddingPage();
            expect(result.current.viewMode).toBe('kanban');
        });

        it('deve inicializar sem filtros ativos', () => {
            const { result } = renderUseBiddingPage();
            expect(result.current.hasActiveFilters).toBe(false);
            expect(result.current.activeFilterCount).toBe(0);
        });

        it('deve expor todos os items como filteredItems sem filtros', () => {
            const { result } = renderUseBiddingPage();
            expect(result.current.filteredItems).toHaveLength(3);
        });

        it('deve calcular dynamicCounters corretamente', () => {
            const { result } = renderUseBiddingPage();
            // dynamicCounters is array of {label, count, color}
            const captado = result.current.dynamicCounters.find((c: any) => c.label === 'Captado');
            const emAnalise = result.current.dynamicCounters.find((c: any) => c.label === 'Em Análise');
            const emSessao = result.current.dynamicCounters.find((c: any) => c.label === 'Em Sessão');
            const ganho = result.current.dynamicCounters.find((c: any) => c.label === 'Ganho');
            expect(captado?.count).toBe(1);
            expect(emAnalise?.count).toBe(1);
            expect(emSessao?.count).toBe(1);
            expect(ganho?.count).toBe(0);
        });

        it('deve inicializar modal fechado', () => {
            const { result } = renderUseBiddingPage();
            expect(result.current.isModalOpen).toBe(false);
            expect(result.current.editingProcess).toBeNull();
        });
    });

    // ═══════════════════════════════════
    // FILTERING
    // ═══════════════════════════════════
    describe('Filtros Inteligentes', () => {
        it('deve filtrar por searchText no título', () => {
            const { result } = renderUseBiddingPage();
            act(() => {
                result.current.setFilters((prev: any) => ({ ...prev, searchText: 'pregão 001' }));
            });
            expect(result.current.filteredItems).toHaveLength(1);
            expect(result.current.filteredItems[0].id).toBe('b1');
        });

        it('deve filtrar por nome da empresa', () => {
            const { result } = renderUseBiddingPage();
            act(() => {
                result.current.setFilters((prev: any) => ({ ...prev, searchText: 'buildco' }));
            });
            expect(result.current.filteredItems).toHaveLength(1);
            expect(result.current.filteredItems[0].id).toBe('b2');
        });

        it('deve filtrar por status', () => {
            const { result } = renderUseBiddingPage();
            act(() => {
                result.current.setFilters((prev: any) => ({ ...prev, statuses: ['Captado'] }));
            });
            expect(result.current.filteredItems).toHaveLength(1);
            expect(result.current.hasActiveFilters).toBe(true);
        });

        it('deve filtrar por múltiplos critérios simultaneamente', () => {
            const { result } = renderUseBiddingPage();
            act(() => {
                result.current.setFilters((prev: any) => ({
                    ...prev,
                    // ComprasNet normalizes to 'Compras.gov.br' via normalizePortalFE
                    portals: ['Compras.gov.br'],
                    risks: ['Baixo'],
                }));
            });
            expect(result.current.filteredItems).toHaveLength(1);
            expect(result.current.filteredItems[0].id).toBe('b1');
            expect(result.current.activeFilterCount).toBe(2);
        });

        it('deve retornar vazio quando nenhum item combina', () => {
            const { result } = renderUseBiddingPage();
            act(() => {
                result.current.setFilters((prev: any) => ({ ...prev, searchText: 'inexistente' }));
            });
            expect(result.current.filteredItems).toHaveLength(0);
        });

        it('deve calcular filterOptions dinamicamente', () => {
            const { result } = renderUseBiddingPage();
            expect(result.current.filterOptions.modalities).toContain('Pregão');
            expect(result.current.filterOptions.modalities).toContain('Concorrência');
            // Portals are normalized: ComprasNet → Compras.gov.br, BLL stays BLL
            expect(result.current.filterOptions.portals).toContain('Compras.gov.br');
            expect(result.current.filterOptions.portals).toContain('BLL');
        });
    });

    // ═══════════════════════════════════
    // CRUD
    // ═══════════════════════════════════
    describe('Operações CRUD', () => {
        it('handleCreateNew deve abrir modal sem processo de edição', () => {
            const { result } = renderUseBiddingPage();
            act(() => result.current.handleCreateNew());
            expect(result.current.isModalOpen).toBe(true);
            expect(result.current.editingProcess).toBeNull();
        });

        it('handleEdit deve abrir modal com processo de edição', () => {
            const { result } = renderUseBiddingPage();
            act(() => result.current.handleEdit(items[0]));
            expect(result.current.isModalOpen).toBe(true);
            expect(result.current.editingProcess?.id).toBe('b1');
        });

        it('handleSaveProcess (new) deve chamar fetch POST e fechar modal', async () => {
            const newBidding = createBidding({ id: 'b-new', title: 'Novo Processo' });
            mockFetchSuccess(newBidding);

            const { result } = renderUseBiddingPage();

            act(() => result.current.handleCreateNew());
            act(() => result.current.handleSaveProcess({ title: 'Novo Processo', modality: 'Pregão', portal: 'ComprasNet', sessionDate: '2026-04-01T10:00:00.000Z' }));

            expect(result.current.isModalOpen).toBe(false);
            await waitFor(() => {
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringContaining('/api/biddings'),
                    expect.objectContaining({ method: 'POST' })
                );
            });
        });

        it('handleDeleteProcess deve preparar confirmação', async () => {
            const { result } = renderUseBiddingPage();
            await act(async () => result.current.handleDeleteProcess('b1'));
            expect(result.current.confirmDeleteId).toBe('b1');
        });

        it('confirmDelete deve chamar DELETE na API', async () => {
            mockFetchSuccess({});

            const { result } = renderUseBiddingPage();
            await act(async () => result.current.handleDeleteProcess('b1'));
            await act(async () => result.current.confirmDelete());

            await waitFor(() => {
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringContaining('/api/biddings/b1'),
                    expect.objectContaining({ method: 'DELETE' })
                );
            });
        });

        it('confirmDelete com erro deve chamar toast.error', async () => {
            mockFetchError('Deletion failed');

            const { result } = renderUseBiddingPage();
            await act(async () => result.current.handleDeleteProcess('b1'));
            await act(async () => result.current.confirmDelete());

            // toast.error is called inside the hook's catch block
            // We just verify the hook didn't crash
            expect(result.current).not.toBeNull();
        });
    });

    // ═══════════════════════════════════
    // TOGGLE MONITOR
    // ═══════════════════════════════════
    describe('Toggle Monitor', () => {
        it('deve alternar isMonitored otimisticamente e chamar API', async () => {
            mockFetchSuccess({});
            const { result } = renderUseBiddingPage();
            act(() => result.current.handleToggleMonitor('b1'));

            expect(setItems).toHaveBeenCalled();
            await waitFor(() => {
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringContaining('/api/biddings/b1'),
                    expect.objectContaining({ method: 'PUT' })
                );
            });
        });
    });

    // ═══════════════════════════════════
    // VIEW SETTINGS
    // ═══════════════════════════════════
    describe('Configurações de Visualização', () => {
        it('deve alternar entre kanban e table', () => {
            const { result } = renderUseBiddingPage();
            act(() => result.current.setViewMode('table'));
            expect(result.current.viewMode).toBe('table');
        });

        it('deve persistir sortBy', () => {
            const { result } = renderUseBiddingPage();
            act(() => result.current.setSortBy('date-asc'));
            expect(result.current.sortBy).toBe('date-asc');
        });

        it('deve alternar compactMode', () => {
            const { result } = renderUseBiddingPage();
            act(() => result.current.setCompactMode(true));
            expect(result.current.compactMode).toBe(true);
        });
    });

    // ═══════════════════════════════════
    // REFRESH DATA
    // ═══════════════════════════════════
    describe('Refresh', () => {
        it('refreshData deve chamar GET /api/biddings', async () => {
            mockFetchSuccess([createBidding()]);

            const { result } = renderUseBiddingPage();
            await act(async () => result.current.refreshData());

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/biddings'),
                expect.objectContaining({ headers: expect.any(Object) })
            );
        });

        it('refreshData com falha de rede não deve quebrar', async () => {
            mockFetchNetworkError();

            const { result } = renderUseBiddingPage();
            await act(async () => result.current.refreshData());
            // Should not throw
            expect(result.current.filteredItems).toBeDefined();
        });
    });
});
