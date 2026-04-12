/**
 * ═══════════════════════════════════════════════════════════
 * TESTES — Schema Enforcer (schemaEnforcer.ts)
 * Sprint 1 | Item 1.2.2
 * 
 * Valida: deduplicação, normalização de IDs, defaults inteligentes,
 * limpeza de phantoms, normalização de modalidade/critério/datas,
 * cross-category dedup e PC anti-pollution.
 * ═══════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { enforceSchema } from '../../../../server/services/ai/schemaEnforcer';
import { createEmptyAnalysisSchema } from '../../../../server/services/ai/analysis-schema-v1';
import type { AnalysisSchemaV1 } from '../../../../server/services/ai/analysis-schema-v1';

function makeSchema(overrides: Partial<AnalysisSchemaV1> = {}): AnalysisSchemaV1 {
    return { ...createEmptyAnalysisSchema(), ...overrides };
}

// ── Defaults Inteligentes ────────────────────────────────────

describe('Schema Enforcer — Defaults Inteligentes', () => {
    it('preenche requirement_id vazio com prefixo correto', () => {
        const schema = makeSchema({
            requirements: {
                ...createEmptyAnalysisSchema().requirements,
                habilitacao_juridica: [
                    { requirement_id: '', title: 'Contrato social', description: 'Cópia do contrato social', mandatory: true, applies_to: 'licitante', risk_if_missing: '', evidence_refs: [] } as any,
                ],
            },
        });
        const result = enforceSchema(schema);
        expect(result.schema.requirements.habilitacao_juridica[0].requirement_id).toBe('HJ-01');
        expect(result.corrections).toBeGreaterThan(0);
    });

    it('deduplica IDs repetidos', () => {
        const schema = makeSchema({
            requirements: {
                ...createEmptyAnalysisSchema().requirements,
                regularidade_fiscal_trabalhista: [
                    { requirement_id: 'RFT-01', title: 'CNPJ', description: 'Comprovante de inscrição no CNPJ', mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: [] } as any,
                    { requirement_id: 'RFT-01', title: 'FGTS', description: 'Certidão de regularidade do FGTS', mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: [] } as any,
                ],
            },
        });
        const result = enforceSchema(schema);
        const ids = result.schema.requirements.regularidade_fiscal_trabalhista.map(r => r.requirement_id);
        expect(new Set(ids).size).toBe(ids.length); // All unique
    });

    it('preenche entry_type vazio com exigencia_principal', () => {
        const schema = makeSchema({
            requirements: {
                ...createEmptyAnalysisSchema().requirements,
                habilitacao_juridica: [
                    { requirement_id: 'HJ-01', title: 'Contrato social', description: 'Cópia', mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: [], entry_type: '' } as any,
                ],
            },
        });
        const result = enforceSchema(schema);
        expect((result.schema.requirements.habilitacao_juridica[0] as any).entry_type).toBe('exigencia_principal');
    });

    it('preenche risk_if_missing com default da categoria', () => {
        const schema = makeSchema({
            requirements: {
                ...createEmptyAnalysisSchema().requirements,
                proposta_comercial: [
                    { requirement_id: 'PC-01', title: 'Planilha', description: 'Planilha de preços', mandatory: true, applies_to: 'licitante', risk_if_missing: '', evidence_refs: [] } as any,
                ],
            },
        });
        const result = enforceSchema(schema);
        expect(result.schema.requirements.proposta_comercial[0].risk_if_missing).toBe('desclassificacao');
    });

    it('cross-fill title ↔ description quando um está vazio', () => {
        const schema = makeSchema({
            requirements: {
                ...createEmptyAnalysisSchema().requirements,
                habilitacao_juridica: [
                    { requirement_id: 'HJ-01', title: '', description: 'Comprovante de inscrição no CNPJ da empresa', mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: [] } as any,
                ],
            },
        });
        const result = enforceSchema(schema);
        expect(result.schema.requirements.habilitacao_juridica[0].title).toBeTruthy();
    });
});

// ── Limpeza de Phantoms ──────────────────────────────────────

describe('Schema Enforcer — Cleanup Phantoms', () => {
    it('remove itens sem título E sem descrição', () => {
        const schema = makeSchema({
            requirements: {
                ...createEmptyAnalysisSchema().requirements,
                habilitacao_juridica: [
                    { requirement_id: 'HJ-01', title: 'CNPJ', description: 'Comprovante', mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: [] } as any,
                    { requirement_id: 'HJ-02', title: '', description: '', mandatory: true, applies_to: 'licitante', risk_if_missing: '', evidence_refs: [] } as any,
                    { requirement_id: 'HJ-03', title: '  ', description: '  ', mandatory: true, applies_to: 'licitante', risk_if_missing: '', evidence_refs: [] } as any,
                ],
            },
        });
        const result = enforceSchema(schema);
        expect(result.schema.requirements.habilitacao_juridica.length).toBe(1);
    });
});

// ── Deduplicação ──────────────────────────────────────────────

describe('Schema Enforcer — Deduplicação', () => {
    it('remove exigências duplicadas (mesma descrição normalizada)', () => {
        const schema = makeSchema({
            requirements: {
                ...createEmptyAnalysisSchema().requirements,
                qualificacao_tecnica_operacional: [
                    { requirement_id: 'QTO-01', title: 'Atestado técnico', description: 'Comprovação de experiência em serviços de manutenção', mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: [] } as any,
                    { requirement_id: 'QTO-02', title: 'Atestado técnico', description: 'Comprovação de experiência em serviços de manutenção', mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: [] } as any,
                    { requirement_id: 'QTO-03', title: 'Atestado diferente', description: 'Comprovação de fornecimento de materiais', mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: [] } as any,
                ],
            },
        });
        const result = enforceSchema(schema);
        expect(result.schema.requirements.qualificacao_tecnica_operacional.length).toBe(2);
    });
});

// ── Normalização de Modalidade ──────────────────────────────

describe('Schema Enforcer — Normalização de Campos', () => {
    it('normaliza modalidade (lowercase → capitalizado)', () => {
        const schema = makeSchema();
        schema.process_identification.modalidade = 'pregao eletronico';
        const result = enforceSchema(schema);
        expect(result.schema.process_identification.modalidade).toBe('Pregão Eletrônico');
    });

    it('normaliza critério de julgamento', () => {
        const schema = makeSchema();
        schema.process_identification.criterio_julgamento = 'menor preco';
        const result = enforceSchema(schema);
        expect(result.schema.process_identification.criterio_julgamento).toBe('Menor Preço');
    });

    it('normaliza datas ISO para DD/MM/AAAA às HH:MM', () => {
        const schema = makeSchema();
        schema.timeline.data_sessao = '2026-03-15T09:00:00Z';
        const result = enforceSchema(schema);
        expect(result.schema.timeline.data_sessao).toBe('15/03/2026 às 09:00');
    });

    it('normaliza datas sem "às" para formato com "às"', () => {
        const schema = makeSchema();
        schema.timeline.data_sessao = '15/03/2026 09:00';
        const result = enforceSchema(schema);
        expect(result.schema.timeline.data_sessao).toBe('15/03/2026 às 09:00');
    });

    it('tipo_objeto inválido → "outro"', () => {
        const schema = makeSchema();
        (schema.process_identification as any).tipo_objeto = 'xyz_invalido';
        const result = enforceSchema(schema);
        expect(result.schema.process_identification.tipo_objeto).toBe('outro');
    });

    it('deriva objeto_resumido de objeto_completo quando vazio', () => {
        const schema = makeSchema();
        schema.process_identification.objeto_resumido = '';
        schema.process_identification.objeto_completo = 'Contratação de empresa especializada em manutenção predial para os prédios da sede administrativa';
        const result = enforceSchema(schema);
        expect(result.schema.process_identification.objeto_resumido).toBeTruthy();
        expect(result.schema.process_identification.objeto_resumido.length).toBeLessThanOrEqual(151); // 150 + '…'
    });
});

// ── PC Safety Net ──────────────────────────────────────────

describe('Schema Enforcer — PC Safety Net', () => {
    it('injeta Planilha + BDI quando PC está vazia mas outras categorias têm itens', () => {
        const schema = makeSchema({
            requirements: {
                ...createEmptyAnalysisSchema().requirements,
                habilitacao_juridica: [
                    { requirement_id: 'HJ-01', title: 'CNPJ', description: 'Comprovante', mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: [] } as any,
                ],
                proposta_comercial: [],
            },
        });
        const result = enforceSchema(schema);
        expect(result.schema.requirements.proposta_comercial.length).toBe(2);
        expect(result.schema.requirements.proposta_comercial[0].title).toContain('Planilha');
    });
});

// ── Resultado Geral ──────────────────────────────────────────

describe('Schema Enforcer — Resultado', () => {
    it('retorna corrections count e details', () => {
        const schema = makeSchema();
        schema.process_identification.modalidade = 'pregao';
        const result = enforceSchema(schema);
        expect(result.corrections).toBeGreaterThanOrEqual(0);
        expect(result.details).toBeInstanceOf(Array);
    });

    it('não crasheia com schema vazio', () => {
        const schema = createEmptyAnalysisSchema();
        const result = enforceSchema(schema);
        expect(result.schema).toBeDefined();
        expect(result.corrections).toBeGreaterThanOrEqual(0);
    });
});
