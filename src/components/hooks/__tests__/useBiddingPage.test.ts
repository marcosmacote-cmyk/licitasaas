import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBiddingPage } from '../useBiddingPage';
import { createBidding, createCompany, mockFetchSuccess, mockFetchError, mockFetchNetworkError, resetMocks, mockToast } from '../../../test/helpers';

vi.mock('../ui', () => ({
    useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
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
            createBidding({ id: 'b2', title: 'Pregão 002', status: 'Em Análise de Edital', companyProfileId: 'comp-2', modality: 'Concorrência', portal: 'BLL', risk: 'Alto' }),
            createBidding({ id: 'b3', title: 'Concurso 001', status: 'Participando', companyProfileId: 'comp-1', modality: 'Pregão', portal: 'ComprasNet', risk: 'Médio' }),
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

        it('deve calcular statusCounters corretamente', () => {
            const { result } = renderUseBiddingPage();
            expect(result.current.statusCounters.captado).toBe(1);
            expect(result.current.statusCounters.analise).toBe(1);
            expect(result.current.statusCounters.participando).toBe(1);
            expect(result.current.statusCounters.vencido).toBe(0);
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
                result.current.setFilters(prev => ({ ...prev, searchText: 'pregão 001' }));
            });
            expect(result.current.filteredItems).toHaveLength(1);
            expect(result.current.filteredItems[0].id).toBe('b1');
        });

        it('deve filtrar por nome da empresa', () => {
            const { result } = renderUseBiddingPage();
            act(() => {
                result.current.setFilters(prev => ({ ...prev, searchText: 'buildco' }));
            });
            expect(result.current.filteredItems).toHaveLength(1);
            expect(result.current.filteredItems[0].id).toBe('b2');
        });

        it('deve filtrar por status', () => {
            const { result } = renderUseBiddingPage();
            act(() => {
                result.current.setFilters(prev => ({ ...prev, statuses: ['Captado'] }));
            });
            expect(result.current.filteredItems).toHaveLength(1);
            expect(result.current.hasActiveFilters).toBe(true);
        });

        it('deve filtrar por múltiplos critérios simultaneamente', () => {
            const { result } = renderUseBiddingPage();
            act(() => {
                result.current.setFilters(prev => ({
                    ...prev,
                    portals: ['ComprasNet'],
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
                result.current.setFilters(prev => ({ ...prev, searchText: 'inexistente' }));
            });
            expect(result.current.filteredItems).toHaveLength(0);
        });

        it('deve calcular filterOptions dinamicamente', () => {
            const { result } = renderUseBiddingPage();
            expect(result.current.filterOptions.modalities).toContain('Pregão');
            expect(result.current.filterOptions.modalities).toContain('Concorrência');
            expect(result.current.filterOptions.portals).toContain('ComprasNet');
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

        it('handleSaveProcess (edit) deve chamar fetch PUT', async () => {
            mockFetchSuccess({});

            const { result } = renderUseBiddingPage();
            act(() => result.current.handleEdit(items[0]));
            act(() => result.current.handleSaveProcess({ title: 'Título Atualizado' }));

            await waitFor(() => {
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringContaining('/api/biddings/b1'),
                    expect.objectContaining({ method: 'PUT' })
                );
            });
        });

        it('handleStatusChange deve atualizar status via API', async () => {
            mockFetchSuccess({});

            const { result } = renderUseBiddingPage();
            act(() => result.current.handleStatusChange('b1', 'Em Análise de Edital'));

            await waitFor(() => {
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringContaining('/api/biddings/b1'),
                    expect.objectContaining({ method: 'PUT' })
                );
            });
        });

        it('handleDeleteProcess deve preparar confirmação', () => {
            const { result } = renderUseBiddingPage();
            act(() => result.current.handleDeleteProcess('b1'));
            expect(result.current.confirmDeleteId).toBe('b1');
        });

        it('confirmDelete deve chamar DELETE na API', async () => {
            mockFetchSuccess({});

            const { result } = renderUseBiddingPage();
            act(() => result.current.handleDeleteProcess('b1'));
            await act(async () => result.current.confirmDelete());

            await waitFor(() => {
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringContaining('/api/biddings/b1'),
                    expect.objectContaining({ method: 'DELETE' })
                );
            });
        });

        it('confirmDelete com erro deve exibir toast.error', async () => {
            mockFetchError('Deletion failed');

            const { result } = renderUseBiddingPage();
            act(() => result.current.handleDeleteProcess('b1'));
            await act(async () => result.current.confirmDelete());

            await waitFor(() => {
                expect(mockToast.error).toHaveBeenCalled();
            });
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
