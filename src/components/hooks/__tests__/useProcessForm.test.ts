import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useProcessForm } from '../useProcessForm';
import { createBidding, createCompany, mockFetchSuccess, mockFetchError, resetMocks } from '../../../test/helpers';

import type { BiddingProcess, CompanyProfile } from '../../../../types';

// Mock uuid
vi.mock('uuid', () => ({
    v4: () => `uuid-${Date.now()}`
}));

// Mock lucide-react (useProcessForm.tsx uses JSX icons)
vi.mock('lucide-react', () => {
    const icon = () => null;
    return {
        Save: icon, UploadCloud: icon, ScanSearch: icon, ArrowRight: icon,
        CheckCircle: icon, AlertTriangle: icon, DollarSign: icon, Monitor: icon,
        Gavel: icon, FileText: icon,
    };
});

// Mock useSSE (background jobs)
vi.mock('../useSSE', () => ({
    submitBackgroundJob: vi.fn().mockRejectedValue(new Error('no background in test')),
    fetchJobResult: vi.fn(),
    useSSE: vi.fn(),
}));

// Track toast calls via shared mock
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

describe('useProcessForm', () => {
    let companies: CompanyProfile[];
    const onClose = vi.fn();
    const onSave = vi.fn();
    const onNavigateToModule = vi.fn();

    beforeEach(() => {
        resetMocks();
        onClose.mockClear();
        onSave.mockClear();
        onNavigateToModule.mockClear();
        Object.values(toastMock).forEach(fn => fn.mockClear());
        companies = [
            createCompany({ id: 'comp-1', razaoSocial: 'TechCorp' }),
            createCompany({ id: 'comp-2', razaoSocial: 'BuildCo' }),
        ];
    });

    const renderForm = (initialData: BiddingProcess | null = null) =>
        renderHook(() => useProcessForm({ initialData, companies, onClose, onSave, onNavigateToModule }));

    // ═══════════════════════════════════
    // INITIAL STATE
    // ═══════════════════════════════════
    describe('Estado Inicial', () => {
        it('deve inicializar formulário vazio para novo processo', () => {
            const { result } = renderForm();
            expect(result.current.formData.title).toBe('');
            expect(result.current.isEditMode).toBe(false);
        });

        it('deve popular formulário com dados do processo existente', () => {
            const bidding = createBidding({ id: 'b1', title: 'Pregão 001', modality: 'Pregão' });
            const { result } = renderForm(bidding);

            expect(result.current.formData.title).toBe('Pregão 001');
            expect(result.current.formData.modality).toBe('Pregão');
            expect(result.current.isEditMode).toBe(true);
        });

        it('deve parsear observations do JSON', () => {
            const obs = [{ id: '1', text: 'Nota 1', timestamp: '2026-01-01' }];
            const bidding = createBidding({ id: 'b1', observations: JSON.stringify(obs) });
            const { result } = renderForm(bidding);

            expect(result.current.observations).toHaveLength(1);
            expect(result.current.observations[0].text).toBe('Nota 1');
        });

        it('deve lidar com observations inválido', () => {
            const bidding = createBidding({ id: 'b1', observations: 'invalid' });
            const { result } = renderForm(bidding);
            expect(result.current.observations).toEqual([]);
        });

        it('deve formatar sessionDate para input datetime-local', () => {
            const bidding = createBidding({ id: 'b1', sessionDate: '2026-04-01T10:00:00.000Z' });
            const { result } = renderForm(bidding);
            expect(result.current.formData.sessionDate).toContain('2026');
        });
    });

    // ═══════════════════════════════════
    // FORM HANDLING
    // ═══════════════════════════════════
    describe('Manipulação do Formulário', () => {
        it('handleChange deve atualizar campo texto', () => {
            const { result } = renderForm();
            act(() => {
                result.current.handleChange({
                    target: { name: 'title', value: 'Novo Título' }
                } as any);
            });
            expect(result.current.formData.title).toBe('Novo Título');
        });

        it('handleChange deve parsear estimatedValue como número', () => {
            const { result } = renderForm();
            act(() => {
                result.current.handleChange({
                    target: { name: 'estimatedValue', value: '100000.50' }
                } as any);
            });
            expect(result.current.formData.estimatedValue).toBe(100000.50);
        });

        it('handleChange deve lidar com vírgula decimal', () => {
            const { result } = renderForm();
            act(() => {
                result.current.handleChange({
                    target: { name: 'estimatedValue', value: '100000,50' }
                } as any);
            });
            expect(result.current.formData.estimatedValue).toBe(100000.50);
        });

        it('handleChange deve tratar valor vazio como zero', () => {
            const { result } = renderForm();
            act(() => {
                result.current.handleChange({
                    target: { name: 'estimatedValue', value: '' }
                } as any);
            });
            expect(result.current.formData.estimatedValue).toBe(0);
        });

        it('handleChange deve tratar NaN como zero', () => {
            const { result } = renderForm();
            act(() => {
                result.current.handleChange({
                    target: { name: 'estimatedValue', value: 'abc' }
                } as any);
            });
            expect(result.current.formData.estimatedValue).toBe(0);
        });
    });

    // ═══════════════════════════════════
    // OBSERVATIONS
    // ═══════════════════════════════════
    describe('Observações', () => {
        it('handleAddObservation deve adicionar observação', () => {
            const { result } = renderForm();
            act(() => result.current.setNewObservation('Nova nota'));
            act(() => result.current.handleAddObservation());

            expect(result.current.observations).toHaveLength(1);
            expect(result.current.observations[0].text).toBe('Nova nota');
            expect(result.current.newObservation).toBe('');
        });

        it('handleAddObservation deve ignorar texto vazio', () => {
            const { result } = renderForm();
            act(() => result.current.setNewObservation('   '));
            act(() => result.current.handleAddObservation());
            expect(result.current.observations).toHaveLength(0);
        });

        it('handleAddObservation deve serializar para formData.observations', () => {
            const { result } = renderForm();
            act(() => result.current.setNewObservation('Nota 1'));
            act(() => result.current.handleAddObservation());

            const parsed = JSON.parse(result.current.formData.observations || '[]');
            expect(parsed).toHaveLength(1);
        });
    });

    // ═══════════════════════════════════
    // SUBMIT
    // ═══════════════════════════════════
    describe('Submit', () => {
        it('deve validar campos obrigatórios', () => {
            const { result } = renderForm();
            const e = { preventDefault: vi.fn() };
            act(() => result.current.handleSubmit(e as any));

            expect(toastMock.warning).toHaveBeenCalledWith(
                expect.stringContaining('obrigatórios')
            );
            expect(onSave).not.toHaveBeenCalled();
        });

        it('deve chamar onSave com dados válidos', () => {
            const { result } = renderForm();

            act(() => {
                result.current.setFormData((prev: any) => ({
                    ...prev,
                    title: 'Pregão 001',
                    portal: 'ComprasNet',
                    modality: 'Pregão',
                    sessionDate: '2026-04-01T10:00',
                }));
            });

            const e = { preventDefault: vi.fn() };
            act(() => result.current.handleSubmit(e as any));

            expect(onSave).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Pregão 001',
                    portal: 'ComprasNet',
                }),
                null // aiAnalysisData starts as null when no AI extraction was run
            );
        });

        it('deve converter sessionDate para ISO string', () => {
            const { result } = renderForm();

            act(() => {
                result.current.setFormData((prev: any) => ({
                    ...prev,
                    title: 'Test',
                    portal: 'ComprasNet',
                    modality: 'Pregão',
                    sessionDate: '2026-04-01T10:00',
                }));
            });

            const e = { preventDefault: vi.fn() };
            act(() => result.current.handleSubmit(e as any));

            const savedData = onSave.mock.calls[0][0];
            expect(savedData.sessionDate).toContain('2026');
        });
    });

    // ═══════════════════════════════════
    // COMPANY DOCS
    // ═══════════════════════════════════
    describe('Documentos da Empresa', () => {
        it('deve carregar docs quando companyProfileId é definido', async () => {
            mockFetchSuccess([
                { docType: 'CND Federal', status: 'Válido', expirationDate: '2027-01-01' },
                { docType: 'FGTS', status: 'Vencido', expirationDate: '2025-01-01' },
            ]);

            const { result } = renderForm();
            act(() => {
                result.current.setFormData((prev: any) => ({ ...prev, companyProfileId: 'comp-1' }));
            });

            await waitFor(() => {
                expect(result.current.companyDocs.length).toBeGreaterThan(0);
            });
        });

        it('deve limpar docs quando companyProfileId é removido', () => {
            const { result } = renderForm();
            act(() => {
                result.current.setFormData((prev: any) => ({ ...prev, companyProfileId: '' }));
            });
            expect(result.current.companyDocs).toEqual([]);
        });
    });

    // ═══════════════════════════════════
    // NEXT STEP
    // ═══════════════════════════════════
    describe('Next Step Recommendation', () => {
        it('deve recomendar "Salvar" para novo processo', () => {
            const { result } = renderForm();
            expect(result.current.nextStep.label).toBe('Salvar');
        });

        it('deve recomendar "Anexar Edital" para Captado sem PDF', () => {
            const bidding = createBidding({ id: 'b1', status: 'Captado', link: '' });
            const { result } = renderForm(bidding);
            expect(result.current.nextStep.label).toBe('Anexar Edital');
        });

        it('deve recomendar "Analisar com LicitIA" para Captado com PDF sem análise', () => {
            const bidding = createBidding({ id: 'b1', status: 'Captado', link: '/uploads/edital.pdf', aiAnalysis: null });
            const { result } = renderForm(bidding);
            expect(result.current.nextStep.label).toBe('Analisar com LicitIA');
        });
    });

    // ═══════════════════════════════════
    // AI EXTRACT
    // ═══════════════════════════════════
    describe('AI Extract', () => {
        it('deve alertar quando sem PDF anexado', async () => {
            const { result } = renderForm();
            await act(async () => result.current.handleAiExtract());
            expect(toastMock.warning).toHaveBeenCalledWith(
                expect.stringContaining('PDF')
            );
        });

        it('deve chamar API de análise com arquivo PDF', async () => {
            // submitBackgroundJob fails → falls back to sync fetch
            mockFetchSuccess({
                process: { title: 'Extraído', modality: 'Pregão' },
                analysis: { fullSummary: 'Summary', requiredDocuments: [], irregularitiesFlags: [] }
            });

            const { result } = renderForm();
            act(() => {
                result.current.setFormData((prev: any) => ({ ...prev, link: '/uploads/edital.pdf' }));
            });
            await act(async () => result.current.handleAiExtract());

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/analyze-edital/v2'),
                expect.objectContaining({ method: 'POST' })
            );
        });

        it('deve tratar erro da API de análise', async () => {
            mockFetchError('Falha na análise');

            const { result } = renderForm();
            act(() => {
                result.current.setFormData((prev: any) => ({ ...prev, link: '/uploads/edital.pdf' }));
            });
            await act(async () => result.current.handleAiExtract());

            expect(toastMock.error).toHaveBeenCalled();
            expect(result.current.isCheckingAi).toBe(false);
        });
    });
});
