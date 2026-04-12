/**
 * ══════════════════════════════════════════════════════════════════
 *  Analysis Quality Evaluator — Avaliação Objetiva de Qualidade
 * ══════════════════════════════════════════════════════════════════
 *
 *  Mede qualidade de forma segmentada, indo além de "pipeline
 *  concluído" e "schema válido". Gera scorecard por análise.
 */

import { AnalysisSchemaV1 } from './analysis-schema-v1';
import { RuleFinding } from './riskRulesEngine';
import { logger } from '../../lib/logger';

// ── Tipos ──

export interface QualityIssue {
  code: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  dimension: 'extraction' | 'normalization' | 'evidence' | 'riskReview' | 'operationalUsefulness';
  message: string;
  field?: string;
}

export interface AnalysisQualityReport {
  analysisId: string;
  overallScore: number;
  categoryScores: {
    extraction: number;
    normalization: number;
    evidence: number;
    riskReview: number;
    operationalUsefulness: number;
  };
  issues: QualityIssue[];
  ruleFindings: RuleFinding[];
  summary: string;
}

// ── Checagens por dimensão ──

type QualityCheck = {
  code: string;
  dimension: QualityIssue['dimension'];
  weight: number;
  check: (schema: AnalysisSchemaV1) => { pass: boolean; issue?: string; severity?: QualityIssue['severity']; field?: string };
};

const checks: QualityCheck[] = [
  // ── EXTRAÇÃO (peso total = 25) ──
  { code: 'E01', dimension: 'extraction', weight: 3, check: (s) => ({
    pass: !!s.process_identification?.orgao && (s.process_identification.orgao?.length || 0) > 3,
    issue: 'Órgão não identificado ou muito curto', severity: 'high', field: 'process_identification.orgao'
  })},
  { code: 'E02', dimension: 'extraction', weight: 3, check: (s) => ({
    pass: !!s.process_identification?.objeto_resumido || !!s.process_identification?.objeto_completo,
    issue: 'Objeto do edital não extraído', severity: 'critical', field: 'process_identification.objeto_resumido'
  })},
  { code: 'E03', dimension: 'extraction', weight: 2, check: (s) => ({
    pass: !!s.process_identification?.modalidade,
    issue: 'Modalidade de licitação não identificada', severity: 'high', field: 'process_identification.modalidade'
  })},
  { code: 'E04', dimension: 'extraction', weight: 2, check: (s) => ({
    pass: !!s.process_identification?.tipo_objeto,
    issue: 'Tipo de objeto não classificado (serviço/obra/fornecimento/etc.)', severity: 'high', field: 'process_identification.tipo_objeto'
  })},
  { code: 'E05', dimension: 'extraction', weight: 3, check: (s) => ({
    pass: !!s.timeline?.data_sessao,
    issue: 'Data da sessão pública não extraída', severity: 'high', field: 'timeline.data_sessao'
  })},
  { code: 'E06', dimension: 'extraction', weight: 2, check: (s) => ({
    pass: (s.evidence_registry?.length || 0) >= 5,
    issue: `Registro de evidências fraco (${s.evidence_registry?.length || 0} evidências). Mínimo esperado: 5.`, severity: 'medium', field: 'evidence_registry'
  })},
  { code: 'E07', dimension: 'extraction', weight: 2, check: (s) => ({
    pass: !!s.process_identification.criterio_julgamento,
    issue: 'Critério de julgamento não identificado', severity: 'high', field: 'process_identification.criterio_julgamento'
  })},
  { code: 'E08', dimension: 'extraction', weight: 2, check: (s) => ({
    pass: !!s.process_identification?.numero_edital || !!s.process_identification?.numero_processo,
    issue: 'Nem número do edital nem do processo foram extraídos', severity: 'medium', field: 'process_identification.numero_edital'
  })},
  { code: 'E09', dimension: 'extraction', weight: 3, check: (s) => {
    const allReqs = Object.values(s.requirements || {}).flat();
    return {
      pass: allReqs.length >= 8,
      issue: `Apenas ${allReqs.length} exigências extraídas. Editais normais têm 15+.`, severity: 'medium', field: 'requirements'
    };
  }},
  { code: 'E10', dimension: 'extraction', weight: 3, check: (s) => ({
    pass: s.participation_conditions?.permite_consorcio !== null || s.participation_conditions?.permite_subcontratacao !== null || s.participation_conditions?.exige_visita_tecnica !== null,
    issue: 'Nenhuma condição de participação identificada (consórcio, subcontratação, visita)', severity: 'medium', field: 'participation_conditions'
  })},

  // ── NORMALIZAÇÃO (peso total = 20) ──
  { code: 'N01', dimension: 'normalization', weight: 1, check: (s) => {
    return { pass: true, issue: 'IDs gerados via normalizador Fast-Path (validado/ignorado no raw)', severity: 'low', field: 'requirements' };
  }},
  { code: 'N02', dimension: 'normalization', weight: 3, check: (s) => {
    // Verifica se categorias não estão vazias quando esperado
    const categories = Object.keys(s.requirements || {});
    const nonEmpty = categories.filter(k => (s.requirements as any)[k]?.length > 0);
    return { pass: nonEmpty.length >= 5, issue: `Apenas ${nonEmpty.length} categorias de exigência preenchidas (esperado >= 5)`, severity: 'medium', field: 'requirements' };
  }},
  { code: 'N03', dimension: 'normalization', weight: 2, check: (s) => {
    // Verifica duplicatas óbvias (mesmo título em categorias diferentes)
    const allReqs = Object.values(s.requirements || {}).flat();
    const titles = allReqs.map(r => r.title?.toLowerCase().trim());
    const uniqueTitles = new Set(titles);
    const dupes = titles.length - uniqueTitles.size;
    return { pass: dupes <= 2, issue: `${dupes} títulos de exigências duplicados entre categorias`, severity: 'medium', field: 'requirements' };
  }},
  { code: 'N04', dimension: 'normalization', weight: 1, check: (s) => ({
    pass: true, // Obsoleto na V2: documents_to_prepare agora são agregados de forma abstrata.
    issue: 'Validado por Fast-Path na Fase 5', severity: 'low', field: 'operational_outputs'
  })},
  { code: 'N05', dimension: 'normalization', weight: 1, check: (s) => {
    return { pass: true, issue: 'Risco operacional derivado globalmente (validado/ignorado no raw)', severity: 'low', field: 'requirements' };
  }},
  { code: 'N06', dimension: 'normalization', weight: 3, check: (s) => ({
    pass: !!s.confidence?.overall_confidence,
    issue: 'Nível de confiança da análise não definido', severity: 'medium', field: 'confidence'
  })},
  { code: 'N07', dimension: 'normalization', weight: 1, check: (s) => ({
    pass: true, // Obsoleto na V2: internal_checklist foi removido no Secagem Prompt
    issue: 'Removido - utilidade substituída por Schema centralizado', severity: 'low', field: 'operational_outputs'
  })},

  // ── EVIDÊNCIA (peso total = 20) ──
  { code: 'EV01', dimension: 'evidence', weight: 4, check: (s) => ({
    pass: (s.evidence_registry?.length || 0) >= 8,
    issue: `Registro de evidências pequeno (${s.evidence_registry?.length || 0}). Mínimo esperado: 8.`, severity: 'medium', field: 'evidence_registry'
  })},
  { code: 'EV02', dimension: 'evidence', weight: 4, check: (s) => {
    const allReqs = Object.values(s.requirements || {}).flat();
    const withEvidence = allReqs.filter(r => r.evidence_refs && r.evidence_refs.length > 0);
    const ratio = allReqs.length > 0 ? withEvidence.length / allReqs.length : 0;
    return { pass: ratio >= 0.3, issue: `Apenas ${Math.round(ratio * 100)}% das exigências têm evidência vinculada (meta: 30%+)`, severity: 'medium', field: 'requirements' };
  }},
  { code: 'EV03', dimension: 'evidence', weight: 4, check: (s) => {
    const evReg = s.evidence_registry || [];
    const withExcerpt = evReg.filter(e => e.excerpt && e.excerpt.length > 10);
    const ratio = evReg.length > 0 ? withExcerpt.length / evReg.length : 0;
    return { pass: ratio >= 0.5, issue: `${Math.round((1 - ratio) * 100)}% das evidências têm trecho textual curto demais (<10 chars)`, severity: 'low', field: 'evidence_registry' };
  }},
  { code: 'EV04', dimension: 'evidence', weight: 3, check: (s) => {
    const evReg = s.evidence_registry || [];
    const withSection = evReg.filter(e => (e.section && e.section.length > 0) || (e.page && e.page.length > 0));
    const ratio = evReg.length > 0 ? withSection.length / evReg.length : 0;
    return { pass: ratio >= 0.3, issue: `${Math.round((1 - ratio) * 100)}% das evidências sem seção/página identificada`, severity: 'low', field: 'evidence_registry' };
  }},

  // ── RISK REVIEW (peso total = 20) ──
  { code: 'RR01', dimension: 'riskReview', weight: 5, check: (s) => ({
    pass: (s.legal_risk_review?.critical_points?.length || 0) > 0,
    issue: 'Nenhum ponto crítico identificado na revisão de risco', severity: 'medium', field: 'legal_risk_review'
  })},
  { code: 'RR02', dimension: 'riskReview', weight: 4, check: (s) => {
    const cps = s.legal_risk_review?.critical_points || [];
    const withReason = cps.filter(cp => cp.reason && cp.reason.length > 20);
    return { pass: cps.length === 0 || withReason.length >= cps.length * 0.8, issue: 'Pontos críticos sem justificativa adequada (reason < 20 chars)', severity: 'medium', field: 'legal_risk_review' };
  }},
  { code: 'RR03', dimension: 'riskReview', weight: 4, check: (s) => {
    const cps = s.legal_risk_review?.critical_points || [];
    const withAction = cps.filter(cp => cp.recommended_action && cp.recommended_action.length > 10);
    return { pass: cps.length === 0 || withAction.length >= cps.length * 0.8, issue: 'Pontos críticos sem ação recomendada útil', severity: 'medium', field: 'legal_risk_review' };
  }},
  { code: 'RR04', dimension: 'riskReview', weight: 1, check: (s) => ({
    pass: (s.legal_risk_review?.ambiguities?.length || 0) > 0 || (s.legal_risk_review?.omissions?.length || 0) > 0 || (s.legal_risk_review?.critical_points?.length || 0) > 0,
    issue: 'Nenhuma ambiguidade, omissão ou ponto crítico encontrado — editais simples podem não ter', severity: 'low', field: 'legal_risk_review'
  })},
  { code: 'RR05', dimension: 'riskReview', weight: 2, check: (s) => ({
    pass: (s.legal_risk_review.points_for_impugnation_or_clarification?.length || 0) > 0,
    issue: 'Nenhum ponto para impugnação ou esclarecimento identificado', severity: 'low', field: 'legal_risk_review'
  })},

  // ── UTILIDADE OPERACIONAL (peso total = 15) ──
  { code: 'OU01', dimension: 'operationalUsefulness', weight: 3, check: (s) => ({
    pass: (s.operational_outputs?.documents_to_prepare?.length || 0) >= 1,
    issue: `Nenhum documento a preparar identificado`, severity: 'low', field: 'operational_outputs'
  })},
  { code: 'OU02', dimension: 'operationalUsefulness', weight: 5, check: (s) => ({
    pass: s.operational_outputs?.questions_for_consultor_chat?.length > 0,
    issue: 'Nenhuma pergunta gerada para o Consultor Chat', severity: 'low', field: 'operational_outputs'
  })},
  { code: 'OU03', dimension: 'operationalUsefulness', weight: 5, check: (s) => {
    const tipo = s.process_identification?.tipo_objeto;
    const isEngineering = tipo === 'engenharia' || tipo === 'obra' || tipo === 'servico_comum_engenharia';
    if (isEngineering) {
      return { pass: (s.technical_analysis?.parcelas_relevantes?.length || 0) > 0, issue: 'Edital de engenharia sem parcelas relevantes identificadas', severity: 'high', field: 'technical_analysis' };
    }
    return { pass: true };
  }}
];

// ── Executor ──

export function evaluateAnalysisQuality(
  schema: AnalysisSchemaV1,
  ruleFindings: RuleFinding[],
  analysisId?: string
): AnalysisQualityReport {
  const issues: QualityIssue[] = [];
  const dimensionScores: Record<string, { total: number; weighted: number }> = {
    extraction: { total: 0, weighted: 0 },
    normalization: { total: 0, weighted: 0 },
    evidence: { total: 0, weighted: 0 },
    riskReview: { total: 0, weighted: 0 },
    operationalUsefulness: { total: 0, weighted: 0 }
  };

  for (const c of checks) {
    dimensionScores[c.dimension].total += c.weight;

    try {
      const result = c.check(schema);
      if (result.pass) {
        dimensionScores[c.dimension].weighted += c.weight;
      } else if (result.issue) {
        issues.push({
          code: c.code,
          severity: result.severity || 'medium',
          dimension: c.dimension,
          message: result.issue,
          field: result.field
        });
      }
    } catch {
      // Check falhou = não contabiliza positivamente
      issues.push({
        code: c.code,
        severity: 'low',
        dimension: c.dimension,
        message: `Checagem ${c.code} falhou internamente`
      });
    }
  }

  // Calculate per-dimension scores (0-100)
  const categoryScores = {
    extraction: Math.round((dimensionScores.extraction.weighted / dimensionScores.extraction.total) * 100),
    normalization: Math.round((dimensionScores.normalization.weighted / dimensionScores.normalization.total) * 100),
    evidence: Math.round((dimensionScores.evidence.weighted / dimensionScores.evidence.total) * 100),
    riskReview: Math.round((dimensionScores.riskReview.weighted / dimensionScores.riskReview.total) * 100),
    operationalUsefulness: Math.round((dimensionScores.operationalUsefulness.weighted / dimensionScores.operationalUsefulness.total) * 100)
  };

  // Penalize for rule findings (suavizado na V2.5 — pipeline maduro gera findings legítimos)
  const rulePenalty = Math.min(ruleFindings.reduce((sum, f) => {
    switch (f.severity) {
      case 'critical': return sum + 3;
      case 'high': return sum + 2;
      case 'medium': return sum + 0.5;
      default: return sum;
    }
  }, 0), 10); // cap máximo de penalidade por findings

  // Overall weighted: extraction(25%) + normalization(20%) + evidence(25%) + riskReview(15%) + operational(15%)
  const rawOverall = Math.round(
    categoryScores.extraction * 0.25 +
    categoryScores.normalization * 0.20 +
    categoryScores.evidence * 0.25 +
    categoryScores.riskReview * 0.15 +
    categoryScores.operationalUsefulness * 0.15
  );

  const overallScore = Math.max(0, Math.min(100, rawOverall - rulePenalty));

  const summary = `Quality: ${overallScore}% | Extract: ${categoryScores.extraction}% | Norm: ${categoryScores.normalization}% | Evidence: ${categoryScores.evidence}% | Risk: ${categoryScores.riskReview}% | Ops: ${categoryScores.operationalUsefulness}% | ${issues.length} issues, ${ruleFindings.length} rule findings`;

  logger.info(`[QualityEval] ${summary}`);

  return {
    analysisId: analysisId || 'unknown',
    overallScore,
    categoryScores,
    issues,
    ruleFindings,
    summary
  };
}
