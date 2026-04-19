import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
    useDossierExporter,
    DOCUMENT_GROUP_META, getGroupMeta,
    // Pure matching functions are not exported but we test them via the hook
} from '../useDossierExporter';
import { createBidding, createAnalysis, createCompany, mockFetchSuccess, mockFetchError, resetMocks } from '../../../test/helpers';
import type { CompanyDocument } from '../../../../types';

// Mock JSZip
vi.mock('jszip', () => ({
    default: vi.fn().mockImplementation(() => ({
        file: vi.fn(),
        generateAsync: vi.fn().mockResolvedValue(new Blob()),
    })),
}));

// Mock file-saver
vi.mock('file-saver', () => ({
    saveAs: vi.fn(),
}));

// Mock jsPDF + autoTable
vi.mock('jspdf', () => ({
    jsPDF: vi.fn().mockReturnValue({
        internal: { pageSize: { getWidth: () => 297, getHeight: () => 210 } },
        addImage: vi.fn(), setFontSize: vi.fn(), setTextColor: vi.fn(),
        setFont: vi.fn(), text: vi.fn(), splitTextToSize: vi.fn().mockReturnValue([]),
        setDrawColor: vi.fn(), setFillColor: vi.fn(), setLineWidth: vi.fn(),
        line: vi.fn(), rect: vi.fn(), roundedRect: vi.fn(),
        addPage: vi.fn(), save: vi.fn(), getNumberOfPages: vi.fn().mockReturnValue(1),
        setPage: vi.fn(),
    }),
}));
vi.mock('jspdf-autotable', () => ({ default: vi.fn() }));

// Mock governance
vi.mock('../../../governance', () => ({
    resolveStage: vi.fn((status: string) => status),
    isModuleAllowed: vi.fn(() => true),
}));

// Track toast calls
const toastMock = {
    success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(),
};
vi.mock('../../ui', () => ({
    useToast: () => toastMock,
    ToastProvider: ({ children }: any) => children,
}));

describe('useDossierExporter', () => {
    const docs: CompanyDocument[] = [
        { id: 'doc-1', docType: 'Contrato Social', fileName: 'contrato.pdf', fileUrl: '/uploads/contrato.pdf', status: 'Válido', docGroup: 'Habilitação Jurídica', expirationDate: '2027-12-31' } as any,
        { id: 'doc-2', docType: 'CND Federal', fileName: 'cnd_federal.pdf', fileUrl: '/uploads/cnd.pdf', status: 'Válido', docGroup: 'Regularidade Fiscal, Social e Trabalhista', expirationDate: '2027-06-30' } as any,
        { id: 'doc-3', docType: 'FGTS', fileName: 'fgts.pdf', fileUrl: '/uploads/fgts.pdf', status: 'Vencido', docGroup: 'Regularidade Fiscal, Social e Trabalhista', expirationDate: '2025-01-01' } as any,
    ];

    const analysis = createAnalysis({
        requiredDocuments: JSON.stringify({
            "Habilitação Jurídica": [{ item: "1", description: "Contrato Social atualizado" }],
            "Regularidade Fiscal, Social e Trabalhista": [
                { item: "2", description: "Certidão Negativa de Débitos Federais" },
                { item: "3", description: "Certificado de Regularidade do FGTS" },
            ],
        })
    });

    const biddings = [
        createBidding({ id: 'bid-1', title: 'Pregão 001', status: 'Preparando Documentação', aiAnalysis: analysis, companyProfileId: 'comp-1' }),
        createBidding({ id: 'bid-2', status: 'Captado', aiAnalysis: null, summary: '' }),
    ];
    const companies = [
        createCompany({ id: 'comp-1', razaoSocial: 'TechCorp', documents: docs }),
        createCompany({ id: 'comp-2', razaoSocial: 'BuildCo', documents: [] }),
    ];

    beforeEach(() => {
        resetMocks();
        Object.values(toastMock).forEach(fn => fn.mockClear());
    });

    const renderDossier = (overrides = {}) =>
        renderHook(() => useDossierExporter({ biddings, companies, ...overrides }));

    // ═══════════════════════════════════
    // PURE FUNCTIONS
    // ═══════════════════════════════════
    describe('Utilitários Puros', () => {
        it('DOCUMENT_GROUP_META deve conter todas as categorias', () => {
            expect(Object.keys(DOCUMENT_GROUP_META)).toContain('Habilitação Jurídica');
            expect(Object.keys(DOCUMENT_GROUP_META)).toContain('Regularidade Fiscal, Social e Trabalhista');
            expect(Object.keys(DOCUMENT_GROUP_META)).toContain('Qualificação Técnica');
            expect(Object.keys(DOCUMENT_GROUP_META)).toContain('Declarações');
        });

        it('getGroupMeta deve retornar metadata correta', () => {
            const meta = getGroupMeta('Habilitação Jurídica');
            expect(meta.icon).toBe('Shield');
            expect(meta.priority).toBe(1);
        });

        it('getGroupMeta deve retornar "Outros" para grupo desconhecido', () => {
            const meta = getGroupMeta('Desconhecido');
            expect(meta.icon).toBe('HelpCircle');
            expect(meta.priority).toBe(99);
        });
    });

    // ═══════════════════════════════════
    // INITIAL STATE
    // ═══════════════════════════════════
    describe('Estado Inicial', () => {
        it('deve inicializar sem seleção', () => {
            const { result } = renderDossier();
            expect(result.current.selectedBiddingId).toBe('');
            expect(result.current.selectedCompanyId).toBe('');
            expect(result.current.isExporting).toBe(false);
        });

        it('deve inicializar com filtro "active"', () => {
            const { result } = renderDossier();
            expect(result.current.dateFilter).toBe('active');
        });

        it('deve filtrar biddings com análise', () => {
            const { result } = renderDossier();
            expect(result.current.biddingsWithAnalysis).toHaveLength(1);
            expect(result.current.biddingsWithAnalysis[0].id).toBe('bid-1');
        });

        it('deve aceitar initialBiddingId', () => {
            const { result } = renderDossier({ initialBiddingId: 'bid-1' });
            expect(result.current.selectedBiddingId).toBe('bid-1');
        });
    });

    // ═══════════════════════════════════
    // SELECTION & AUTO-INFERENCE
    // ═══════════════════════════════════
    describe('Seleção', () => {
        it('deve auto-inferir empresa ao selecionar licitação', async () => {
            const { result } = renderDossier();
            act(() => result.current.setSelectedBiddingId('bid-1'));
            await waitFor(() => {
                expect(result.current.selectedCompanyId).toBe('comp-1');
            });
        });

        it('deve parsear requiredList da análise', async () => {
            const { result } = renderDossier({ initialBiddingId: 'bid-1' });
            expect(result.current.requiredList).toHaveLength(3);
            expect(result.current.requiredList[0].description).toContain('Contrato Social');
        });
    });

    // ═══════════════════════════════════
    // DOCUMENT FILTERING
    // ═══════════════════════════════════
    describe('Filtro de Documentos', () => {
        it('dateFilter "active" deve excluir documentos vencidos', async () => {
            const { result } = renderDossier({ initialBiddingId: 'bid-1' });
            await waitFor(() => expect(result.current.selectedCompanyId).toBe('comp-1'));

            // doc-3 (FGTS) expired in 2025 — should be filtered
            expect(result.current.companyDocs.length).toBeLessThan(3);
        });

        it('dateFilter "all" deve incluir todos', async () => {
            const { result } = renderDossier({ initialBiddingId: 'bid-1' });
            await waitFor(() => expect(result.current.selectedCompanyId).toBe('comp-1'));

            act(() => result.current.setDateFilter('all'));
            expect(result.current.companyDocs).toHaveLength(3);
        });

        it('dateFilter "expired" deve incluir apenas vencidos', async () => {
            const { result } = renderDossier({ initialBiddingId: 'bid-1' });
            await waitFor(() => expect(result.current.selectedCompanyId).toBe('comp-1'));

            act(() => result.current.setDateFilter('expired'));
            expect(result.current.companyDocs).toHaveLength(1);
            expect(result.current.companyDocs[0].docType).toBe('FGTS');
        });
    });

    // ═══════════════════════════════════
    // MANUAL MATCHING
    // ═══════════════════════════════════
    describe('Matching Manual', () => {
        it('toggleMatch deve vincular documento a exigência', () => {
            const { result } = renderDossier();
            act(() => result.current.toggleMatch('Contrato Social atualizado', 'doc-1'));
            expect(result.current.manualMatches['Contrato Social atualizado']).toContain('doc-1');
        });

        it('toggleMatch deve desvincular documento já vinculado', () => {
            const { result } = renderDossier();
            act(() => result.current.toggleMatch('Contrato Social atualizado', 'doc-1'));
            act(() => result.current.toggleMatch('Contrato Social atualizado', 'doc-1'));
            expect(result.current.manualMatches['Contrato Social atualizado']).not.toContain('doc-1');
        });

        it('toggleMatch com IGNORAR deve ignorar exigência', () => {
            const { result } = renderDossier();
            act(() => result.current.toggleMatch('Contrato Social atualizado', 'IGNORAR'));
            expect(result.current.manualMatches['Contrato Social atualizado']).toContain('IGNORAR');
        });

        it('toggleMatch IGNORAR deve desligar ao clicar novamente', () => {
            const { result } = renderDossier();
            act(() => result.current.toggleMatch('Contrato Social atualizado', 'IGNORAR'));
            act(() => result.current.toggleMatch('Contrato Social atualizado', 'IGNORAR'));
            expect(result.current.manualMatches['Contrato Social atualizado']).toEqual([]);
        });
    });

    // ═══════════════════════════════════
    // READINESS SCORE
    // ═══════════════════════════════════
    describe('Score de Prontidão', () => {
        it('deve inicializar com score 0', () => {
            const { result } = renderDossier();
            expect(result.current.readinessScore).toBe(0);
        });

        it('deve calcular score baseado em matches', () => {
            const { result } = renderDossier({ initialBiddingId: 'bid-1' });
            // 3 requirements, link 1 → 33%
            act(() => result.current.toggleMatch('Contrato Social atualizado', 'doc-1'));
            expect(result.current.readinessScore).toBeCloseTo(33.3, 0);
            expect(result.current.satisfiedCount).toBe(1);
            expect(result.current.pendingCount).toBe(2);
        });

        it('deve excluir IGNORAR do total', () => {
            const { result } = renderDossier({ initialBiddingId: 'bid-1' });
            act(() => result.current.toggleMatch('Contrato Social atualizado', 'doc-1'));
            act(() => result.current.toggleMatch('Certificado de Regularidade do FGTS', 'IGNORAR'));
            // 3 requirements, 1 ignored → effective total = 2, 1 satisfied → 50%
            expect(result.current.readinessScore).toBe(50);
            expect(result.current.ignoredCount).toBe(1);
        });
    });

    // ═══════════════════════════════════
    // EXPORT
    // ═══════════════════════════════════
    describe('Exportação', () => {
        it('handleExportZip deve alertar quando sem documentos vinculados', async () => {
            const { result } = renderDossier();
            await act(async () => result.current.handleExportZip());
            expect(toastMock.warning).toHaveBeenCalledWith(
                expect.stringContaining('Não há documentos')
            );
        });
    });
});
