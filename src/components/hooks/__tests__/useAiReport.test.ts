import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAiReport } from '../useAiReport';
import { createAnalysis, createBidding, mockFetchSuccess, resetMocks } from '../../../test/helpers';
import type { AiAnalysis, BiddingProcess } from '../../../../types';

describe('useAiReport', () => {
    let analysis: AiAnalysis;
    let process: BiddingProcess;

    beforeEach(() => {
        resetMocks();
        analysis = createAnalysis({
            requiredDocuments: JSON.stringify({
                'Habilitação Jurídica': [
                    { item: '1', description: 'Contrato Social atualizado' },
                    { item: '2', description: 'Procuração do representante legal' },
                ],
                'Regularidade Fiscal, Social e Trabalhista': [
                    { item: '3', description: 'CND Federal' },
                    { item: '4', description: 'CND FGTS' },
                    { item: '5', description: 'CNDT Trabalhista' },
                ],
                'Qualificação Técnica': [
                    { item: '6', description: 'Atestado de capacidade técnica' },
                ],
            }),
            irregularitiesFlags: JSON.stringify(['Prazo curto para impugnação', 'Exigência desproporcional']),
            deadlines: JSON.stringify(['Impugnação: 01/04/2026', 'Proposta: 05/04/2026']),
        });
        process = createBidding({ id: 'bid-1', companyProfileId: 'comp-1' });
    });

    const renderUseAiReport = () => renderHook(() => useAiReport({ analysis, process }));

    // ═══════════════════════════════════
    // PARSING
    // ═══════════════════════════════════
    describe('Parsing de Dados', () => {
        it('deve parsear irregularitiesFlags como array', () => {
            const { result } = renderUseAiReport();
            expect(result.current.flagList).toHaveLength(2);
            expect(result.current.flagList).toContain('Prazo curto para impugnação');
        });

        it('deve parsear deadlines como array', () => {
            const { result } = renderUseAiReport();
            expect(result.current.deadlineList).toHaveLength(2);
            expect(result.current.deadlineList[0]).toContain('Impugnação');
        });

        it('deve lidar com irregularitiesFlags como string', () => {
            analysis.irregularitiesFlags = 'Prazo curto';
            const { result } = renderUseAiReport();
            expect(result.current.flagList).toEqual(['Prazo curto']);
        });

        it('deve lidar com irregularitiesFlags null', () => {
            analysis.irregularitiesFlags = null as any;
            const { result } = renderUseAiReport();
            expect(result.current.flagList).toEqual([]);
        });

        it('deve lidar com array direto (não JSON)', () => {
            analysis.irregularitiesFlags = ['Flag 1', 'Flag 2'] as any;
            const { result } = renderUseAiReport();
            expect(result.current.flagList).toHaveLength(2);
        });
    });

    // ═══════════════════════════════════
    // CATEGORIZED DOCUMENTS
    // ═══════════════════════════════════
    describe('Categorização de Documentos', () => {
        it('deve categorizar documentos corretamente', () => {
            // Mock company docs fetch
            mockFetchSuccess([]);
            const { result } = renderUseAiReport();

            expect(result.current.categorizedDocs['Habilitação Jurídica']).toHaveLength(2);
            expect(result.current.categorizedDocs['Regularidade Fiscal, Social e Trabalhista']).toHaveLength(3);
            expect(result.current.categorizedDocs['Qualificação Técnica']).toHaveLength(1);
        });

        it('deve calcular allDocsList aggregado', () => {
            mockFetchSuccess([]);
            const { result } = renderUseAiReport();
            expect(result.current.allDocsList.length).toBe(6);
        });

        it('deve lidar com requiredDocuments como array flat', () => {
            analysis.requiredDocuments = JSON.stringify(['Contrato Social', 'CND Federal']);
            mockFetchSuccess([]);
            const { result } = renderUseAiReport();
            expect(result.current.categorizedDocs['Documentos Exigidos']).toHaveLength(2);
        });

        it('deve lidar com requiredDocuments inválido graciosamente', () => {
            analysis.requiredDocuments = 'invalid json {{';
            mockFetchSuccess([]);
            const { result } = renderUseAiReport();
            expect(result.current.categorizedDocs['Processamento']).toHaveLength(1);
        });
    });

    // ═══════════════════════════════════
    // READINESS SCORE
    // ═══════════════════════════════════
    describe('Readiness Score', () => {
        it('deve retornar 0 quando não há docs da empresa', () => {
            mockFetchSuccess([]);
            const { result } = renderUseAiReport();
            expect(result.current.readinessScore).toBe(0);
        });

        it('deve carregar docs da empresa via fetch', async () => {
            mockFetchSuccess([
                { id: 'd1', companyProfileId: 'comp-1', docType: 'Contrato Social', status: 'Válido' },
                { id: 'd2', companyProfileId: 'comp-1', docType: 'CND FGTS', status: 'Válido' },
            ]);
            const { result } = renderUseAiReport();

            await waitFor(() => {
                expect(result.current.companyDocs.length).toBeGreaterThan(0);
            });
        });

        it('deve calcular readiness corretamente com matching', async () => {
            mockFetchSuccess([
                { id: 'd1', companyProfileId: 'comp-1', docType: 'Contrato Social', status: 'Válido' },
                { id: 'd2', companyProfileId: 'comp-1', docType: 'CND FGTS', status: 'Válido' },
                { id: 'd3', companyProfileId: 'comp-1', docType: 'CNDT Trabalhista', status: 'Válido' },
            ]);
            const { result } = renderUseAiReport();

            await waitFor(() => {
                expect(result.current.companyDocs.length).toBe(3);
            });
            // At least some match
            expect(result.current.readinessScore).toBeGreaterThan(0);
        });
    });

    // ═══════════════════════════════════
    // RENDER TEXT VALUE
    // ═══════════════════════════════════
    describe('renderTextValue', () => {
        it('deve retornar string direta', () => {
            mockFetchSuccess([]);
            const { result } = renderUseAiReport();
            expect(result.current.renderTextValue('Test')).toBe('Test');
        });

        it('deve retornar vazio para null', () => {
            mockFetchSuccess([]);
            const { result } = renderUseAiReport();
            expect(result.current.renderTextValue(null)).toBe('');
        });

        it('deve stringify objetos', () => {
            mockFetchSuccess([]);
            const { result } = renderUseAiReport();
            const result2 = result.current.renderTextValue({ key: 'value' });
            expect(result2).toContain('key');
        });
    });
});
