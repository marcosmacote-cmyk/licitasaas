/**
 * ═══════════════════════════════════════════════════════════
 * TESTES — Benchmark Runner (benchmarkRunner.ts)
 * Sprint 1 | Item 1.2.6
 * 
 * Valida: avaliação de gold standard cases, scoring ponderado,
 * edge cases, e anti-regressão do pipeline de benchmark.
 * ═══════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateAgainstBenchmark, generateBenchmarkSummary, type BenchmarkResult } from '../../../../server/services/ai/benchmark/benchmarkRunner';
import { createEmptyAnalysisSchema } from '../../../../server/services/ai/analysis-schema-v1';
import type { AnalysisSchemaV1 } from '../../../../server/services/ai/analysis-schema-v1';

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function makeSchemaForCase(overrides: Partial<{
    tipo_objeto: string;
    categories: Record<string, any[]>;
    criticalPoints: any[];
    evidenceCount: number;
}> = {}): AnalysisSchemaV1 {
    const schema = createEmptyAnalysisSchema();
    
    if (overrides.tipo_objeto) {
        (schema.process_identification as any).tipo_objeto = overrides.tipo_objeto;
    }
    
    if (overrides.categories) {
        for (const [key, value] of Object.entries(overrides.categories)) {
            (schema.requirements as any)[key] = value;
        }
    }
    
    if (overrides.criticalPoints) {
        schema.legal_risk_review.critical_points = overrides.criticalPoints;
    }
    
    if (overrides.evidenceCount) {
        schema.evidence_registry = Array.from({ length: overrides.evidenceCount }, (_, i) => ({
            evidence_id: `EV-${i + 1}`,
            document_type: 'edital' as const,
            document_name: 'Edital',
            page: `${i + 1}`,
            section: `Seção ${i + 1}`,
            excerpt: `Trecho de evidência ${i + 1}`,
            normalized_topic: `Tópico ${i + 1}`,
        }));
    }
    
    return schema;
}

function makeRequirement(title: string, description: string = '') {
    return {
        requirement_id: `REQ-${Math.random().toString(36).slice(2, 6)}`,
        title,
        description,
        mandatory: true,
        applies_to: 'licitante' as const,
        risk_if_missing: 'inabilitacao',
        evidence_refs: ['EV-01'],
    };
}

// ── Avaliação contra caso existente ──────────────────────

describe('Benchmark Runner — Avaliação', () => {
    it('retorna null para caso inexistente', () => {
        const schema = createEmptyAnalysisSchema();
        const result = evaluateAgainstBenchmark('caso-fantasma-xyz', schema);
        expect(result).toBeNull();
    });

    it('avalia case-001 (fornecimento simples) com tipo correto', () => {
        const schema = makeSchemaForCase({
            tipo_objeto: 'fornecimento',
            categories: {
                habilitacao_juridica: [makeRequirement('Contrato Social')],
                regularidade_fiscal_trabalhista: [
                    makeRequirement('Certidão Conjunta Federal'),
                    makeRequirement('CRF FGTS'),
                    makeRequirement('CNDT'),
                ],
                proposta_comercial: [
                    makeRequirement('Catálogo ou ficha técnica dos produtos'),
                    makeRequirement('Proposta de preços'),
                ],
                qualificacao_economico_financeira: [
                    makeRequirement('Balanço'),
                    makeRequirement('Certidão falência'),
                ],
                documentos_complementares: [
                    makeRequirement('Declaração ME/EPP'),
                ],
            },
            evidenceCount: 10,
        });
        
        const result = evaluateAgainstBenchmark('case-001', schema);
        expect(result).not.toBeNull();
        expect(result!.caseId).toBe('case-001');
        expect(result!.scores.tipoObjetoCorrect).toBe(true);
        expect(result!.scores.categoriesFoundPct).toBe(100);
        expect(result!.totalScore).toBeGreaterThanOrEqual(90);
    });

    it('penaliza tipo_objeto incorreto', () => {
        const schema = makeSchemaForCase({
            tipo_objeto: 'servico_comum',
            categories: {
                habilitacao_juridica: [makeRequirement('Contrato Social')],
                regularidade_fiscal_trabalhista: [makeRequirement('CNPJ')],
                proposta_comercial: [makeRequirement('Proposta')],
            },
            evidenceCount: 10,
        });
        
        const result = evaluateAgainstBenchmark('case-001', schema);
        expect(result).not.toBeNull();
        expect(result!.scores.tipoObjetoCorrect).toBe(false);
    });

    it('penaliza categorias faltando', () => {
        const schema = makeSchemaForCase({
            tipo_objeto: 'fornecimento',
            categories: {
                habilitacao_juridica: [makeRequirement('Contrato Social')],
                // Missing: regularidade_fiscal_trabalhista, proposta_comercial
            },
            evidenceCount: 10,
        });
        
        const result = evaluateAgainstBenchmark('case-001', schema);
        expect(result).not.toBeNull();
        expect(result!.scores.categoriesFoundPct).toBeLessThan(100);
        expect(result!.details.some(d => d.includes('Categorias faltando'))).toBe(true);
    });

    it('penaliza evidências insuficientes', () => {
        const schema = makeSchemaForCase({
            tipo_objeto: 'fornecimento',
            categories: {
                habilitacao_juridica: [makeRequirement('Contrato')],
                regularidade_fiscal_trabalhista: [makeRequirement('CNPJ')],
                proposta_comercial: [makeRequirement('Proposta')],
            },
            evidenceCount: 1, // Case-001 requires min 5
        });
        
        const result = evaluateAgainstBenchmark('case-001', schema);
        expect(result).not.toBeNull();
        expect(result!.scores.minEvidenceMet).toBe(false);
        expect(result!.details.some(d => d.includes('Evidências:'))).toBe(true);
    });
});

// ── BenchmarkResult score ────────────────────────────────

describe('Benchmark Runner — Scoring', () => {
    it('score perfeito = 100 para caso com tudo correto', () => {
        const schema = makeSchemaForCase({
            tipo_objeto: 'fornecimento',
            categories: {
                habilitacao_juridica: Array.from({ length: 3 }, (_, i) => makeRequirement(`HJ-${i}`)),
                regularidade_fiscal_trabalhista: Array.from({ length: 3 }, (_, i) => makeRequirement(`RFT-${i}`)),
                proposta_comercial: [
                    makeRequirement('Catálogo ou ficha técnica dos produtos'),
                    makeRequirement('Proposta de preços'),
                    makeRequirement('Certidão Conjunta Federal'),
                    makeRequirement('CRF FGTS'),
                    makeRequirement('CNDT'),
                ],
            },
            evidenceCount: 10,
        });
        
        const result = evaluateAgainstBenchmark('case-001', schema);
        expect(result).not.toBeNull();
        expect(result!.totalScore).toBe(100);
    });

    it('score > 0 mesmo com dados parciais', () => {
        const schema = createEmptyAnalysisSchema();
        (schema.process_identification as any).tipo_objeto = 'fornecimento';
        const result = evaluateAgainstBenchmark('case-001', schema);
        expect(result).not.toBeNull();
        expect(result!.totalScore).toBeGreaterThan(0);
    });
});

// ── Geração de Sumário ──────────────────────────────────

describe('Benchmark Runner — Sumário', () => {
    it('gera sumário com média correta', () => {
        const results: BenchmarkResult[] = [
            {
                caseId: 'case-001', caseName: 'Test 1', tipoObjeto: 'fornecimento',
                scores: { tipoObjetoCorrect: true, categoriesFoundPct: 100, keyRequirementsFoundPct: 100, criticalPointsFoundPct: 100, minRequirementsMet: true, minEvidenceMet: true },
                totalScore: 100, details: [],
            },
            {
                caseId: 'case-002', caseName: 'Test 2', tipoObjeto: 'fornecimento',
                scores: { tipoObjetoCorrect: true, categoriesFoundPct: 50, keyRequirementsFoundPct: 50, criticalPointsFoundPct: 50, minRequirementsMet: false, minEvidenceMet: false },
                totalScore: 50, details: ['Some issue'],
            },
        ];

        const summary = generateBenchmarkSummary(results);
        expect(summary.totalCases).toBe(2);
        expect(summary.averageScore).toBe(75);
        expect(summary.tipoObjetoAccuracy).toBe(100);
        expect(summary.categoryAccuracy).toBe(75);
    });

    it('retorna zeros para array vazio', () => {
        const summary = generateBenchmarkSummary([]);
        expect(summary.totalCases).toBe(0);
        expect(summary.averageScore).toBe(0);
    });
});

// ── Case real-001 (schema padrão) ───────────────────────

describe('Benchmark Runner — Casos Reais', () => {
    it('real-001 com schema vazio não crasheia', () => {
        const schema = createEmptyAnalysisSchema();
        const result = evaluateAgainstBenchmark('real-001', schema);
        expect(result).not.toBeNull();
        expect(result!.caseId).toBe('real-001');
        expect(result!.totalScore).toBeGreaterThanOrEqual(0);
    });

    it('real-002 (obra_engenharia) valida tipo objeto', () => {
        const schema = makeSchemaForCase({ tipo_objeto: 'obra_engenharia' });
        const result = evaluateAgainstBenchmark('real-002', schema);
        expect(result).not.toBeNull();
        expect(result!.scores.tipoObjetoCorrect).toBe(true);
    });

    it('caso real com categorias completas atinge score alto', () => {
        const schema = makeSchemaForCase({
            tipo_objeto: 'servico_comum',
            categories: {
                proposta_comercial: Array.from({ length: 5 }, (_, i) => makeRequirement(`PC-${i}`)),
                habilitacao_juridica: Array.from({ length: 3 }, (_, i) => makeRequirement(`HJ-${i}`)),
                documentos_complementares: Array.from({ length: 3 }, (_, i) => makeRequirement(`DC-${i}`)),
                regularidade_fiscal_trabalhista: Array.from({ length: 5 }, (_, i) => makeRequirement(`RFT-${i}`)),
                qualificacao_tecnica_operacional: Array.from({ length: 4 }, (_, i) => makeRequirement(`QTO-${i}`)),
                qualificacao_economico_financeira: Array.from({ length: 4 }, (_, i) => makeRequirement(`QEF-${i}`)),
            },
            evidenceCount: 80,
        });
        
        const result = evaluateAgainstBenchmark('real-001', schema);
        expect(result).not.toBeNull();
        expect(result!.scores.categoriesFoundPct).toBe(100);
        expect(result!.totalScore).toBeGreaterThanOrEqual(80);
    });
});
