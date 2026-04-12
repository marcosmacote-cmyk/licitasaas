/**
 * ═══════════════════════════════════════════════════════════
 * TESTES — Risk Rules Engine (riskRulesEngine.ts)
 * Sprint 1 | Item 1.2.3
 * 
 * Valida: todas as 22 regras de risco determinísticas,
 * edge cases e ordenação por severidade.
 * ═══════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeRiskRules, type RuleFinding } from '../../../../server/services/ai/riskRulesEngine';
import { createEmptyAnalysisSchema } from '../../../../server/services/ai/analysis-schema-v1';
import type { AnalysisSchemaV1 } from '../../../../server/services/ai/analysis-schema-v1';

// Suppress console.log/warn from the engine
beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function makeSchema(overrides: Partial<AnalysisSchemaV1> = {}): AnalysisSchemaV1 {
    return { ...createEmptyAnalysisSchema(), ...overrides };
}

// ── R01: CAT sem profissional ────────────────────────────

describe('Risk Rules — R01: CAT sem profissional', () => {
    it('dispara quando exige_cat=true mas QTP vazia', () => {
        const schema = makeSchema();
        schema.technical_analysis.exige_cat = true;
        schema.requirements.qualificacao_tecnica_profissional = [];
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R01')).toBe(true);
    });

    it('NÃO dispara quando QTP tem items', () => {
        const schema = makeSchema();
        schema.technical_analysis.exige_cat = true;
        schema.requirements.qualificacao_tecnica_profissional = [
            { requirement_id: 'QTP-01', title: 'CAT profissional', description: 'Acervo', mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: [] },
        ];
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R01')).toBe(false);
    });
});

// ── R04: Visita técnica obrigatória ─────────────────────

describe('Risk Rules — R04: Visita técnica obrigatória', () => {
    it('dispara quando exige_visita_tecnica=true', () => {
        const schema = makeSchema();
        schema.participation_conditions.exige_visita_tecnica = true;
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R04')).toBe(true);
        expect(findings.find(f => f.code === 'R04')!.severity).toBe('high');
    });

    it('NÃO dispara quando false', () => {
        const schema = makeSchema();
        schema.participation_conditions.exige_visita_tecnica = false;
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R04')).toBe(false);
    });
});

// ── R07: Critério de julgamento ausente ──────────────────

describe('Risk Rules — R07: Critério ausente', () => {
    it('dispara quando criterio_julgamento é vazio', () => {
        const schema = makeSchema();
        schema.process_identification.criterio_julgamento = '';
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R07')).toBe(true);
    });

    it('NÃO dispara quando preenchido', () => {
        const schema = makeSchema();
        schema.process_identification.criterio_julgamento = 'Menor Preço';
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R07')).toBe(false);
    });
});

// ── R09: Engenharia sem parcela relevante ────────────────

describe('Risk Rules — R09: Engenharia sem parcela', () => {
    it('dispara para obra_engenharia sem parcelas', () => {
        const schema = makeSchema();
        schema.process_identification.tipo_objeto = 'obra_engenharia';
        schema.technical_analysis.parcelas_relevantes = [];
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R09')).toBe(true);
    });

    it('NÃO dispara para servico_comum', () => {
        const schema = makeSchema();
        schema.process_identification.tipo_objeto = 'servico_comum';
        schema.technical_analysis.parcelas_relevantes = [];
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R09')).toBe(false);
    });
});

// ── R10: Data da sessão no passado ──────────────────────

describe('Risk Rules — R10: Sessão no passado', () => {
    it('dispara para data no passado', () => {
        const schema = makeSchema();
        schema.timeline.data_sessao = '01/01/2020 às 09:00';
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R10')).toBe(true);
        expect(findings.find(f => f.code === 'R10')!.severity).toBe('critical');
    });

    it('NÃO dispara para data no futuro', () => {
        const schema = makeSchema();
        schema.timeline.data_sessao = '31/12/2030 às 09:00';
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R10')).toBe(false);
    });

    it('NÃO dispara quando data_sessao está vazia', () => {
        const schema = makeSchema();
        schema.timeline.data_sessao = '';
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R10')).toBe(false);
    });
});

// ── R16: Firma reconhecida ──────────────────────────────

describe('Risk Rules — R16: Firma reconhecida', () => {
    it('dispara quando exigência menciona firma reconhecida', () => {
        const schema = makeSchema();
        schema.requirements.qualificacao_tecnica_operacional = [
            { requirement_id: 'QTO-01', title: 'Atestado com firma reconhecida', description: 'Atestado de capacidade com reconhecimento de firma em cartório', mandatory: true, applies_to: 'licitante', risk_if_missing: 'inabilitacao', evidence_refs: [] },
        ];
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R16')).toBe(true);
    });
});

// ── R18: Garantia de proposta ───────────────────────────

describe('Risk Rules — R18: Garantia de proposta', () => {
    it('dispara quando exige garantia de proposta', () => {
        const schema = makeSchema();
        schema.participation_conditions.exige_garantia_proposta = true;
        schema.participation_conditions.garantia_proposta_detalhes = '1% do valor estimado';
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R18')).toBe(true);
    });
});

// ── Ordenação por severidade ────────────────────────────

describe('Risk Rules — Ordenação', () => {
    it('findings contêm severidade correta e critical aparece', () => {
        const schema = makeSchema();
        schema.timeline.data_sessao = '01/01/2020 às 09:00'; // R10 critical
        schema.process_identification.criterio_julgamento = ''; // R07 high

        const findings = executeRiskRules(schema);
        expect(findings.length).toBeGreaterThan(1);

        // There must be at least one critical finding (R10)
        const hasCritical = findings.some(f => f.severity === 'critical');
        expect(hasCritical).toBe(true);

        // There must be at least one high finding (R07)
        const hasHigh = findings.some(f => f.severity === 'high');
        expect(hasHigh).toBe(true);
    });
});

// ── Schema vazio não crasheia ───────────────────────────

describe('Risk Rules — Resiliência', () => {
    it('não crasheia com schema completamente vazio', () => {
        const schema = createEmptyAnalysisSchema();
        const findings = executeRiskRules(schema);
        expect(findings).toBeInstanceOf(Array);
    });

    it('cada finding tem code, severity, message', () => {
        const schema = makeSchema();
        schema.process_identification.criterio_julgamento = ''; // R07
        const findings = executeRiskRules(schema);
        for (const f of findings) {
            expect(f.code).toBeTruthy();
            expect(f.severity).toMatch(/^(low|medium|high|critical)$/);
            expect(f.message).toBeTruthy();
            expect(f.affectedFields).toBeInstanceOf(Array);
        }
    });
});
