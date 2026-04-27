/**
 * ══════════════════════════════════════════════════════════
 *  SchemaEnforcer — Tests
 *  Sprint 8.1 — Critical test coverage for post-processing
 * ══════════════════════════════════════════════════════════
 *
 *  Tests the server-side enforcer that FIXes AI output schema
 *  before persisting to DB. Covers:
 *  - Empty field defaults (requirement_id, risk, phase)
 *  - Phantom item removal
 *  - Near-duplicate deduplication
 *  - Generic wrapper promotion
 *  - QTO→QTP migration
 *  - PC anti-pollution
 *  - Date normalization
 *  - Modalidade normalization
 */
import { describe, it, expect, vi } from 'vitest';
import { createEmptyAnalysisSchema } from './analysis-schema-v1';

vi.mock('../../lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import { enforceSchema, type EnforcerResult } from './schemaEnforcer';

// Helper: create schema with overrides (deep merge)
function makeSchema(overrides: any = {}) {
    const base = createEmptyAnalysisSchema();
    return deepMerge(base, overrides);
}
function deepMerge(target: any, source: any): any {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(target[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

// ── Basic Engine Behavior ──

describe('enforceSchema — Engine', () => {
    it('should return clean result for empty schema', () => {
        const schema = createEmptyAnalysisSchema();
        const result = enforceSchema(schema);
        expect(result).toBeDefined();
        expect(typeof result.corrections).toBe('number');
        expect(Array.isArray(result.details)).toBe(true);
        expect(result.schema).toBeDefined();
    });

    it('should not crash on malformed schema', () => {
        const broken = createEmptyAnalysisSchema();
        (broken as any).requirements = null;
        expect(() => enforceSchema(broken)).not.toThrow();
    });

    it('should handle schema with no requirements gracefully', () => {
        const schema = makeSchema({ requirements: {} });
        const result = enforceSchema(schema);
        expect(result.corrections).toBeGreaterThanOrEqual(0);
    });
});

// ── Requirement Defaults ──

describe('enforceSchema — Requirement Defaults', () => {
    it('should fill empty requirement_id', () => {
        const schema = makeSchema({
            requirements: {
                habilitacao_juridica: [{
                    requirement_id: '',
                    title: 'CNPJ ativo',
                    description: 'Apresentar CNPJ',
                    mandatory: true,
                    applies_to: 'licitante',
                    risk_if_missing: '',
                    evidence_refs: []
                }]
            }
        });
        const result = enforceSchema(schema);
        const items = result.schema.requirements.habilitacao_juridica;
        expect(items[0].requirement_id).toBe('HJ-01');
    });

    it('should fill empty risk_if_missing with category default', () => {
        const schema = makeSchema({
            requirements: {
                proposta_comercial: [{
                    requirement_id: 'PC-01',
                    title: 'Planilha de preços',
                    description: 'Planilha conforme modelo',
                    mandatory: true,
                    applies_to: 'licitante',
                    risk_if_missing: '',
                    evidence_refs: []
                }]
            }
        });
        const result = enforceSchema(schema);
        expect(result.schema.requirements.proposta_comercial[0].risk_if_missing).toBe('desclassificacao');
    });

    it('should cross-fill title from description', () => {
        const schema = makeSchema({
            requirements: {
                habilitacao_juridica: [{
                    requirement_id: 'HJ-01',
                    title: '',
                    description: 'Comprovante de inscrição no CNPJ com situação ativa',
                    mandatory: true,
                    applies_to: 'licitante',
                    risk_if_missing: 'inabilitacao',
                    evidence_refs: []
                }]
            }
        });
        const result = enforceSchema(schema);
        const item = result.schema.requirements.habilitacao_juridica[0];
        expect(item.title).toBeTruthy();
        expect(item.title.length).toBeLessThanOrEqual(81); // 80 + possible ellipsis
    });
});

// ── Phantom Item Removal ──

describe('enforceSchema — Phantom Items', () => {
    it('should remove items with no title AND no description', () => {
        const schema = makeSchema({
            requirements: {
                habilitacao_juridica: [
                    {
                        requirement_id: 'HJ-01',
                        title: 'CNPJ',
                        description: 'Apresentar CNPJ',
                        mandatory: true,
                        applies_to: 'licitante',
                        risk_if_missing: 'inabilitacao',
                        evidence_refs: [],
                    },
                    {
                        requirement_id: 'HJ-02',
                        title: '',
                        description: '',
                        mandatory: true,
                        applies_to: '',
                        risk_if_missing: '',
                        evidence_refs: [],
                    },
                ]
            }
        });
        const result = enforceSchema(schema);
        expect(result.schema.requirements.habilitacao_juridica).toHaveLength(1);
        expect(result.schema.requirements.habilitacao_juridica[0].requirement_id).toBe('HJ-01');
    });
});

// ── Deduplication ──

describe('enforceSchema — Deduplication', () => {
    it('should remove near-duplicate requirements', () => {
        const schema = makeSchema({
            requirements: {
                qualificacao_tecnica_operacional: [
                    {
                        requirement_id: 'QTO-01',
                        title: 'Certidão de registro no CREA',
                        description: 'A empresa deve apresentar certidão de registro ou inscrição no CREA',
                        mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: []
                    },
                    {
                        requirement_id: 'QTO-02',
                        title: 'Certidão de registro no CREA',
                        description: 'A empresa deve apresentar certidão de registro ou inscrição no CREA vigente',
                        mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: []
                    },
                    {
                        requirement_id: 'QTO-03',
                        title: 'Atestado de capacidade técnica',
                        description: 'Apresentar atestado de capacidade técnica operacional',
                        mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: []
                    }
                ]
            }
        });
        const result = enforceSchema(schema);
        const items = result.schema.requirements.qualificacao_tecnica_operacional;
        // Should have removed the duplicate CREA item
        expect(items.length).toBeLessThan(3);
        expect(items.length).toBeGreaterThanOrEqual(2);
    });
});

// ── QTO → QTP Migration ──

describe('enforceSchema — QTO→QTP Migration', () => {
    it('should migrate CAT profissional items from QTO to QTP', () => {
        const schema = makeSchema({
            requirements: {
                qualificacao_tecnica_operacional: [
                    {
                        requirement_id: 'QTO-01',
                        title: 'Registro no CREA',
                        description: 'Registro da empresa no CREA',
                        mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: []
                    },
                    {
                        requirement_id: 'QTO-02',
                        title: 'CAT do profissional',
                        description: 'Certidão de acervo técnico do profissional responsável',
                        mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: []
                    },
                    {
                        requirement_id: 'QTO-03',
                        title: 'Atestado operacional',
                        description: 'Atestado de capacidade técnica operacional da empresa',
                        mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: []
                    }
                ],
                qualificacao_tecnica_profissional: []
            }
        });
        const result = enforceSchema(schema);
        const qto = result.schema.requirements.qualificacao_tecnica_operacional;
        const qtp = result.schema.requirements.qualificacao_tecnica_profissional;
        // QTO-02 should have migrated to QTP
        expect(qtp.length).toBeGreaterThanOrEqual(1);
        expect(qto.length).toBeLessThanOrEqual(2);
    });
});

// ── Process Identification Normalization ──

describe('enforceSchema — Normalization', () => {
    it('should normalize modalidade', () => {
        const schema = makeSchema({
            process_identification: {
                modalidade: 'pregao eletronico',
            }
        });
        const result = enforceSchema(schema);
        expect(result.schema.process_identification.modalidade).toBe('Pregão Eletrônico');
    });

    it('should normalize criterio_julgamento', () => {
        const schema = makeSchema({
            process_identification: {
                criterio_julgamento: 'menor preco',
            }
        });
        const result = enforceSchema(schema);
        expect(result.schema.process_identification.criterio_julgamento).toBe('Menor Preço');
    });

    it('should normalize ISO date to DD/MM/AAAA format', () => {
        const schema = makeSchema({
            timeline: {
                data_sessao: '2026-03-15T09:00:00Z',
            }
        });
        const result = enforceSchema(schema);
        expect(result.schema.timeline.data_sessao).toBe('15/03/2026 às 09:00');
    });

    it('should recalculate relative deadlines using business days', () => {
        const schema = makeSchema({
            timeline: {
                data_sessao: '21/05/2026 às 14:00',
                prazo_impugnacao: 'Até 3 dias úteis antes da sessão (16/05/2026)',
                prazo_esclarecimento: 'Até 3 dias úteis antes da sessão (16/05/2026)',
            }
        });
        const result = enforceSchema(schema);
        expect(result.schema.timeline.prazo_impugnacao).toBe('Até 3 dias úteis antes da sessão (18/05/2026)');
        expect(result.schema.timeline.prazo_esclarecimento).toBe('Até 3 dias úteis antes da sessão (18/05/2026)');
    });
});

describe('enforceSchema — Applicability Cleanup', () => {
    it('marks entity-specific legal habilitation documents as applicable-only', () => {
        const schema = makeSchema({
            requirements: {
                habilitacao_juridica: [
                    {
                        requirement_id: 'HJ-01',
                        title: 'Pessoa física: cédula de identidade (RG)',
                        description: 'Cédula de identidade ou documento equivalente',
                        obligation_type: 'obrigatoria_universal',
                        risk_if_missing: 'inabilitacao',
                        evidence_refs: [],
                    },
                    {
                        requirement_id: 'HJ-02',
                        title: 'Documentos acompanhados de alterações ou consolidação',
                        description: 'Documentos acompanhados de alterações ou consolidação',
                        obligation_type: 'obrigatoria_universal',
                        risk_if_missing: 'inabilitacao',
                        evidence_refs: [],
                    },
                ],
            },
        });
        const result = enforceSchema(schema);
        expect((result.schema.requirements.habilitacao_juridica[0] as any).obligation_type).toBe('se_aplicavel');
        expect((result.schema.requirements.habilitacao_juridica[1] as any).obligation_type).toBe('obrigatoria_universal');
    });

    it('deduplicates repeated municipal registration RFT requirements', () => {
        const schema = makeSchema({
            requirements: {
                regularidade_fiscal_trabalhista: [
                    { requirement_id: 'RFT-01', title: 'CNPJ', description: 'Prova de inscrição no CNPJ', evidence_refs: [] },
                    { requirement_id: 'RFT-02', title: 'Inscrição Municipal', description: 'Prova de inscrição no cadastro de contribuintes municipal', evidence_refs: [] },
                    { requirement_id: 'RFT-03', title: 'Inscrição municipal no cadastro de contribuintes', description: 'Prova de inscrição municipal pertinente ao ramo', evidence_refs: [] },
                ],
            },
        });
        const result = enforceSchema(schema);
        const municipalRegistrations = result.schema.requirements.regularidade_fiscal_trabalhista.filter((req: any) => {
            const text = `${req.title || ''} ${req.description || ''}`.toLowerCase();
            return text.includes('inscrição municipal') || text.includes('cadastro de contribuintes municipal');
        });
        expect(municipalRegistrations).toHaveLength(1);
    });
});

// ── Operational Outputs Defaults ──

describe('enforceSchema — Operational Outputs', () => {
    it('should ensure arrays exist in operational_outputs', () => {
        const schema = makeSchema({
            operational_outputs: {
                documents_to_prepare: null,
                internal_checklist: null,
                questions_for_consultor_chat: null,
            }
        });
        const result = enforceSchema(schema);
        expect(Array.isArray(result.schema.operational_outputs.documents_to_prepare)).toBe(true);
        expect(Array.isArray(result.schema.operational_outputs.internal_checklist)).toBe(true);
        expect(Array.isArray(result.schema.operational_outputs.questions_for_consultor_chat)).toBe(true);
    });
});

// ── PC Anti-Pollution ──

describe('enforceSchema — PC Anti-Pollution', () => {
    it('should remove generic PC clauses when many items present', () => {
        const genericItems = [
            { requirement_id: 'PC-01', title: 'Proposta sem emendas ou rasuras', description: 'Proposta sem rasura', mandatory: true, applies_to: 'licitante', risk_if_missing: 'desclassificacao', evidence_refs: [] },
            { requirement_id: 'PC-02', title: 'Proposta redigida em português', description: 'Redigida em português', mandatory: true, applies_to: 'licitante', risk_if_missing: 'desclassificacao', evidence_refs: [] },
            { requirement_id: 'PC-03', title: 'Prazo de validade da proposta', description: 'Validade da proposta 60 dias', mandatory: true, applies_to: 'licitante', risk_if_missing: 'desclassificacao', evidence_refs: [] },
            { requirement_id: 'PC-04', title: 'Sem custos financeiros', description: 'Sem custos financeiros adicionais', mandatory: true, applies_to: 'licitante', risk_if_missing: 'desclassificacao', evidence_refs: [] },
            { requirement_id: 'PC-05', title: 'Planilha de preços detalhada', description: 'Planilha com quantitativos e preços', mandatory: true, applies_to: 'licitante', risk_if_missing: 'desclassificacao', evidence_refs: [] },
        ];
        const schema = makeSchema({
            requirements: { proposta_comercial: genericItems }
        });
        const result = enforceSchema(schema);
        const pc = result.schema.requirements.proposta_comercial;
        // Should have removed generic items, keeping only specific ones
        expect(pc.length).toBeLessThan(5);
    });
});
