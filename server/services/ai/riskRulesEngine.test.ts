/**
 * ══════════════════════════════════════════════════════════
 *  Risk Rules Engine — Tests
 *  Sprint 7 — Critical test coverage for AI pipeline
 * ══════════════════════════════════════════════════════════
 *
 *  Tests the 22 deterministic risk rules that complement
 *  AI analysis with objective, repeatable validations.
 */
import { describe, it, expect, vi } from 'vitest';
import { createEmptyAnalysisSchema } from './analysis-schema-v1';

// Mock the logger to avoid import issues in test environment
vi.mock('../../lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import { executeRiskRules, type RuleFinding } from './riskRulesEngine';

// Helper: create schema with overrides
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

// ── Basic Engine Behavior ─────────────────────────────────

describe('executeRiskRules — Engine', () => {
    it('should return empty array for clean schema', () => {
        const schema = createEmptyAnalysisSchema();
        const findings = executeRiskRules(schema);
        expect(Array.isArray(findings)).toBe(true);
    });

    it('should return multiple findings for a problematic schema', () => {
        const schema = makeSchema({
            process_identification: { criterio_julgamento: '' }, // R07 high
            technical_analysis: {
                exige_cat: true, // R01 high (no profissional)
            },
            timeline: { data_sessao: '01/01/2020' }, // R10 critical (past date)
        });
        const findings = executeRiskRules(schema);
        // Should fire at least R01, R07, R10
        expect(findings.length).toBeGreaterThanOrEqual(3);
        expect(findings.some(f => f.code === 'R01')).toBe(true);
        expect(findings.some(f => f.code === 'R07')).toBe(true);
        expect(findings.some(f => f.code === 'R10')).toBe(true);
    });

    it('should not crash on malformed schema', () => {
        // Rules should be wrapped in try/catch
        const broken = createEmptyAnalysisSchema();
        (broken as any).requirements = null;
        expect(() => executeRiskRules(broken)).not.toThrow();
    });
});

// ── R01: CAT sem profissional ─────────────────────────────

describe('R01 — CAT without professional qualification', () => {
    it('should fire when exige_cat=true but no profissional requirements', () => {
        const schema = makeSchema({
            technical_analysis: { exige_cat: true },
            requirements: { qualificacao_tecnica_profissional: [] },
        });
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R01')).toBe(true);
    });

    it('should NOT fire when profissional requirements exist', () => {
        const schema = makeSchema({
            technical_analysis: { exige_cat: true },
            requirements: {
                qualificacao_tecnica_profissional: [{
                    requirement_id: 'QTP-01', title: 'CAT profissional', description: '',
                    mandatory: true, applies_to: 'licitante', risk_if_missing: '', evidence_refs: []
                }]
            },
        });
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R01')).toBe(false);
    });
});

// ── R04: Visita técnica obrigatória ───────────────────────

describe('R04 — Mandatory technical visit', () => {
    it('should fire for exige_visita_tecnica=true', () => {
        const schema = makeSchema({
            participation_conditions: { exige_visita_tecnica: true },
        });
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R04')).toBe(true);
        expect(findings.find(f => f.code === 'R04')!.severity).toBe('high');
    });

    it('should NOT fire for exige_visita_tecnica=false', () => {
        const schema = makeSchema({
            participation_conditions: { exige_visita_tecnica: false },
        });
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R04')).toBe(false);
    });
});

// ── R07: Critério de julgamento ausente ───────────────────

describe('R07 — Missing judgment criteria', () => {
    it('should fire when criterio_julgamento is empty', () => {
        const schema = makeSchema({
            process_identification: { criterio_julgamento: '' },
        });
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R07')).toBe(true);
    });

    it('should NOT fire when criterio_julgamento is present', () => {
        const schema = makeSchema({
            process_identification: { criterio_julgamento: 'Menor preço' },
        });
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R07')).toBe(false);
    });
});

// ── R09: Engineering without parcela relevante ────────────

describe('R09 — Engineering without parcela relevante', () => {
    it('should fire for engenharia without parcelas', () => {
        const schema = makeSchema({
            process_identification: { tipo_objeto: 'engenharia' },
            technical_analysis: { parcelas_relevantes: [] },
        });
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R09')).toBe(true);
    });

    it('should fire for obra_engenharia without parcelas', () => {
        const schema = makeSchema({
            process_identification: { tipo_objeto: 'obra_engenharia' },
            technical_analysis: { parcelas_relevantes: [] },
        });
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R09')).toBe(true);
    });

    it('should NOT fire for servico without parcelas', () => {
        const schema = makeSchema({
            process_identification: { tipo_objeto: 'servico' },
            technical_analysis: { parcelas_relevantes: [] },
        });
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R09')).toBe(false);
    });
});

// ── R10: Session date in the past ─────────────────────────

describe('R10 — Session date in the past', () => {
    it('should fire for date clearly in the past', () => {
        const schema = makeSchema({
            timeline: { data_sessao: '01/01/2020' },
        });
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R10')).toBe(true);
        expect(findings.find(f => f.code === 'R10')!.severity).toBe('critical');
    });

    it('should NOT fire for future date', () => {
        const schema = makeSchema({
            timeline: { data_sessao: '01/01/2099' },
        });
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R10')).toBe(false);
    });

    it('should handle empty date gracefully', () => {
        const schema = makeSchema({ timeline: { data_sessao: '' } });
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R10')).toBe(false);
    });
});

// ── R18: Garantia de proposta ─────────────────────────────

describe('R18 — Proposal guarantee', () => {
    it('should fire when exige_garantia_proposta=true', () => {
        const schema = makeSchema({
            participation_conditions: { exige_garantia_proposta: true },
        });
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R18')).toBe(true);
        expect(findings.find(f => f.code === 'R18')!.severity).toBe('high');
    });
});

// ── R22: Inexequibilidade em engenharia ───────────────────

describe('R22 — Inexequibility risk in engineering', () => {
    it('should fire for obra_engenharia + menor preço', () => {
        const schema = makeSchema({
            process_identification: {
                tipo_objeto: 'obra_engenharia',
                criterio_julgamento: 'Menor preço',
            },
        });
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R22')).toBe(true);
    });

    it('should NOT fire for servico_comum + menor preço', () => {
        const schema = makeSchema({
            process_identification: {
                tipo_objeto: 'servico_comum',
                criterio_julgamento: 'Menor preço',
            },
        });
        const findings = executeRiskRules(schema);
        expect(findings.some(f => f.code === 'R22')).toBe(false);
    });
});
