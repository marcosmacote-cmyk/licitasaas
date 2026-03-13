import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTechnicalOracle } from '../useTechnicalOracle';
import { createBidding, createAnalysis, resetMocks, mockToast } from '../../../test/helpers';
import type { BiddingProcess, TechnicalCertificate } from '../../../../types';

// Mock axios
vi.mock('axios', () => ({
    default: {
        get: vi.fn().mockResolvedValue({ data: [] }),
        post: vi.fn().mockResolvedValue({ data: {} }),
        delete: vi.fn().mockResolvedValue({ data: {} }),
    }
}));

import axios from 'axios';

describe('useTechnicalOracle', () => {
    const biddings: BiddingProcess[] = [
        createBidding({ id: 'bid-1', status: 'Preparando Documentação', aiAnalysis: createAnalysis() }),
        createBidding({ id: 'bid-2', status: 'Captado' }),
    ];
    const onRefresh = vi.fn();

    const mockCerts: Partial<TechnicalCertificate>[] = [
        { id: 'cert-1', title: 'Atestado de TI', issuer: 'Prefeitura SP', object: 'Serviços de TI', category: 'TI', company: { razaoSocial: 'TechCorp' } as any },
        { id: 'cert-2', title: 'Atestado de Eng', issuer: 'Estado RJ', object: 'Obras', category: 'Engenharia', company: { razaoSocial: 'BuildCo' } as any },
        { id: 'cert-3', title: 'CAT Elétrica', issuer: 'CREA', object: 'Instalação Elétrica', category: 'TI', company: { razaoSocial: 'TechCorp' } as any },
    ];

    beforeEach(() => {
        resetMocks();
        onRefresh.mockClear();
        (axios.get as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({ data: mockCerts });
        (axios.post as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({ data: {} });
        (axios.delete as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({ data: {} });
    });

    const renderOracle = () => renderHook(() => useTechnicalOracle({ biddings, onRefresh }));

    // ═══════════════════════════════════
    // INITIAL STATE
    // ═══════════════════════════════════
    describe('Estado Inicial', () => {
        it('deve carregar certificados no mount', async () => {
            const { result } = renderOracle();
            await waitFor(() => {
                expect(result.current.certificates.length).toBeGreaterThan(0);
            });
        });

        it('deve inicializar sem análise', () => {
            const { result } = renderOracle();
            expect(result.current.analysisResult).toBeNull();
            expect(result.current.isAnalyzing).toBe(false);
        });

        it('deve filtrar biddings com análise', () => {
            const { result } = renderOracle();
            expect(result.current.biddingsWithAnalysis).toHaveLength(1);
            expect(result.current.biddingsWithAnalysis[0].id).toBe('bid-1');
        });
    });

    // ═══════════════════════════════════
    // FILTERING
    // ═══════════════════════════════════
    describe('Filtragem', () => {
        it('deve filtrar por searchTerm no título', async () => {
            const { result } = renderOracle();
            await waitFor(() => expect(result.current.certificates).toHaveLength(3));

            act(() => result.current.setSearchTerm('TI'));
            expect(result.current.filteredCertificates.length).toBeGreaterThanOrEqual(1);
        });

        it('deve filtrar por nome da empresa', async () => {
            const { result } = renderOracle();
            await waitFor(() => expect(result.current.certificates).toHaveLength(3));

            act(() => result.current.setSearchTerm('buildco'));
            expect(result.current.filteredCertificates).toHaveLength(1);
        });

        it('deve retornar todos sem searchTerm', async () => {
            const { result } = renderOracle();
            await waitFor(() => expect(result.current.certificates).toHaveLength(3));

            expect(result.current.filteredCertificates).toHaveLength(3);
        });
    });

    // ═══════════════════════════════════
    // GROUPING
    // ═══════════════════════════════════
    describe('Agrupamento', () => {
        it('deve agrupar certificados por empresa', async () => {
            const { result } = renderOracle();
            await waitFor(() => expect(result.current.certificates).toHaveLength(3));

            const groups = result.current.groupedCertificates;
            expect(Object.keys(groups)).toContain('TechCorp');
            expect(Object.keys(groups)).toContain('BuildCo');
            expect(groups['TechCorp']).toHaveLength(2);
        });

        it('deve expandir/colapsar empresas', async () => {
            const { result } = renderOracle();
            await waitFor(() => expect(result.current.certificates).toHaveLength(3));

            act(() => result.current.toggleCompanyExpansion('TechCorp'));
            expect(result.current.expandedCompanies.has('TechCorp')).toBe(true);

            act(() => result.current.toggleCompanyExpansion('TechCorp'));
            expect(result.current.expandedCompanies.has('TechCorp')).toBe(false);
        });
    });

    // ═══════════════════════════════════
    // SELECTION
    // ═══════════════════════════════════
    describe('Seleção', () => {
        it('deve selecionar/deselecionar certificados', () => {
            const { result } = renderOracle();
            const event = { stopPropagation: vi.fn() } as any;

            act(() => result.current.toggleCertSelection('cert-1', event));
            expect(result.current.selectedCertIds.has('cert-1')).toBe(true);

            act(() => result.current.toggleCertSelection('cert-1', event));
            expect(result.current.selectedCertIds.has('cert-1')).toBe(false);
        });
    });

    // ═══════════════════════════════════
    // DELETE
    // ═══════════════════════════════════
    describe('Exclusão', () => {
        it('handleDeleteCert deve preparar confirmação', () => {
            const { result } = renderOracle();
            act(() => result.current.handleDeleteCert('cert-1'));
            expect(result.current.confirmDeleteId).toBe('cert-1');
        });

        it('executeDeleteCert deve chamar API DELETE', async () => {
            const { result } = renderOracle();
            act(() => result.current.handleDeleteCert('cert-1'));
            await act(async () => result.current.executeDeleteCert());
            expect(axios.delete).toHaveBeenCalledWith(
                expect.stringContaining('/api/technical-certificates/cert-1'),
                expect.any(Object)
            );
        });
    });

    // ═══════════════════════════════════
    // ANALYSIS
    // ═══════════════════════════════════
    describe('Análise de Compatibilidade', () => {
        it('não deve analisar sem bidding ou certificados selecionados', async () => {
            const { result } = renderOracle();
            await act(async () => result.current.handleAnalyzeCompatibility());
            expect(axios.post).not.toHaveBeenCalledWith(
                expect.stringContaining('/compare'),
                expect.anything(),
                expect.anything()
            );
        });

        it('deve chamar API compare com IDs corretos', async () => {
            (axios.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                data: { overallStatus: 'Apto', analysis: [] }
            });

            const { result } = renderOracle();
            const event = { stopPropagation: vi.fn() } as any;

            act(() => {
                result.current.setSelectedBiddingId('bid-1');
                result.current.toggleCertSelection('cert-1', event);
                result.current.toggleCertSelection('cert-2', event);
            });

            await act(async () => result.current.handleAnalyzeCompatibility());

            expect(axios.post).toHaveBeenCalledWith(
                expect.stringContaining('/api/technical-certificates/compare'),
                expect.objectContaining({
                    biddingProcessId: 'bid-1',
                    technicalCertificateIds: expect.arrayContaining(['cert-1', 'cert-2']),
                }),
                expect.any(Object)
            );
        });
    });

    // ═══════════════════════════════════
    // NEW SEARCH
    // ═══════════════════════════════════
    describe('Nova Pesquisa', () => {
        it('handleNewSearch deve limpar tudo', async () => {
            const { result } = renderOracle();
            const event = { stopPropagation: vi.fn() } as any;

            act(() => {
                result.current.setSelectedBiddingId('bid-1');
                result.current.toggleCertSelection('cert-1', event);
            });

            act(() => result.current.handleNewSearch());

            expect(result.current.analysisResult).toBeNull();
            expect(result.current.selectedCertIds.size).toBe(0);
            expect(result.current.selectedBiddingId).toBeNull();
        });
    });

    // ═══════════════════════════════════
    // ADD TO DOSSIER
    // ═══════════════════════════════════
    describe('Adicionar ao Dossiê', () => {
        it('deve salvar evidências no localStorage', async () => {
            const event = { stopPropagation: vi.fn() } as any;

            const { result } = renderOracle();
            act(() => {
                result.current.setSelectedBiddingId('bid-1');
                result.current.toggleCertSelection('cert-1', event);
            });

            // Set analysis result directly to avoid API call
            (axios.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                data: {
                    overallStatus: 'Apto',
                    analysis: [{ requirement: 'Req 1', status: 'Atende', matchingCertificate: 'cert-1', foundExperience: 'exp', foundQuantity: 1, justification: 'ok' }]
                }
            });

            await act(async () => result.current.handleAnalyzeCompatibility());

            act(() => result.current.handleAddToDossier());
            expect(mockToast.success).toHaveBeenCalledWith(expect.stringContaining('Dossiê'));
        });
    });
});
