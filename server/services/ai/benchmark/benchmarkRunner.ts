/**
 * ══════════════════════════════════════════════════════════════════
 *  Benchmark Runner — Avaliação Objetiva do Pipeline V2
 * ══════════════════════════════════════════════════════════════════
 *
 *  Compara output real do pipeline com gabaritos esperados.
 *  Uso: import e chamada programática, ou via endpoint de debug.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const benchmarkManifest = require('./benchmarkManifest.json');
import { AnalysisSchemaV1 } from '../analysis-schema-v1';

export interface BenchmarkResult {
  caseId: string;
  caseName: string;
  tipoObjeto: string;
  scores: {
    tipoObjetoCorrect: boolean;
    categoriesFoundPct: number;
    keyRequirementsFoundPct: number;
    criticalPointsFoundPct: number;
    minRequirementsMet: boolean;
    minEvidenceMet: boolean;
  };
  totalScore: number;
  details: string[];
}

export interface BenchmarkSummary {
  totalCases: number;
  averageScore: number;
  tipoObjetoAccuracy: number;
  categoryAccuracy: number;
  requirementAccuracy: number;
  criticalPointAccuracy: number;
  results: BenchmarkResult[];
}

/**
 * Avaliar um output do pipeline contra um caso do benchmark
 */
export function evaluateAgainstBenchmark(
  caseId: string,
  analysisOutput: AnalysisSchemaV1
): BenchmarkResult | null {
  const benchCase = (benchmarkManifest as any).cases.find((c: any) => c.id === caseId);
  if (!benchCase) {
    console.warn(`[Benchmark] Case ${caseId} not found in manifest`);
    return null;
  }

  const expected = benchCase.expected;
  const details: string[] = [];

  // 1. Tipo de Objeto correto?
  const detectedType = analysisOutput.process_identification?.tipo_objeto || '';
  const tipoCorrect = detectedType === expected.tipo_objeto_expected ||
    (detectedType.includes('engenharia') && expected.tipo_objeto_expected.includes('engenharia'));
  if (!tipoCorrect) {
    details.push(`tipo_objeto: esperado "${expected.tipo_objeto_expected}", obtido "${detectedType}"`);
  }

  // 2. Categorias encontradas
  const foundCategories = new Set(
    Object.entries(analysisOutput.requirements || {})
      .filter(([_, v]) => Array.isArray(v) && v.length > 0)
      .map(([k]) => k)
  );
  const expectedCategories: string[] = expected.categories_to_find || [];
  const categoriesFound = expectedCategories.filter(c => foundCategories.has(c));
  const categoriesFoundPct = expectedCategories.length > 0
    ? Math.round((categoriesFound.length / expectedCategories.length) * 100)
    : 100;
  if (categoriesFoundPct < 100) {
    const missing = expectedCategories.filter(c => !foundCategories.has(c));
    details.push(`Categorias faltando: ${missing.join(', ')}`);
  }

  // 3. Exigências-chave encontradas
  const allReqs = Object.values(analysisOutput.requirements || {}).flat();
  const allReqTexts = allReqs.map(r => `${r.title || ''} ${r.description || ''}`.toLowerCase());
  const expectedKeyReqs: string[] = expected.key_requirements || [];
  const keyReqsFound = expectedKeyReqs.filter(expected =>
    allReqTexts.some(t => t.includes(expected.toLowerCase().substring(0, 15)))
  );
  const keyReqsPct = expectedKeyReqs.length > 0
    ? Math.round((keyReqsFound.length / expectedKeyReqs.length) * 100)
    : 100;
  if (keyReqsPct < 100) {
    const missing = expectedKeyReqs.filter(e =>
      !allReqTexts.some(t => t.includes(e.toLowerCase().substring(0, 15)))
    );
    details.push(`Exigências-chave não encontradas: ${missing.join('; ')}`);
  }

  // 4. Pontos críticos detectados
  const criticalPoints = analysisOutput.legal_risk_review?.critical_points || [];
  const ambiguities = analysisOutput.legal_risk_review?.ambiguities || [];
  const inconsistencies = analysisOutput.legal_risk_review?.inconsistencies || [];
  const allCriticalText = [
    ...criticalPoints.map(cp => `${cp.title || ''} ${cp.description || ''}`),
    ...ambiguities,
    ...inconsistencies
  ].map(s => s.toLowerCase());

  const expectedCritical: string[] = expected.critical_points || [];
  const criticalFound = expectedCritical.filter(expected =>
    allCriticalText.some(t => t.includes(expected.toLowerCase().replace(/_/g, ' ').substring(0, 10)))
  );
  const criticalPct = expectedCritical.length > 0
    ? Math.round((criticalFound.length / expectedCritical.length) * 100)
    : 100;

  // 5. Mínimo de exigências
  const minReqs = expected.min_requirements || 0;
  const minReqsMet = allReqs.length >= minReqs;
  if (!minReqsMet) {
    details.push(`Exigências: ${allReqs.length}/${minReqs} mínimo`);
  }

  // 6. Mínimo de evidências
  const evidenceCount = analysisOutput.evidence_registry?.length || 0;
  const minEvidence = expected.min_evidence_refs || 0;
  const minEvidenceMet = evidenceCount >= minEvidence;
  if (!minEvidenceMet) {
    details.push(`Evidências: ${evidenceCount}/${minEvidence} mínimo`);
  }

  // Calcular score total (ponderado conforme manifest)
  const scoring = (benchmarkManifest as any).scoring;
  const totalScore = Math.round(
    (tipoCorrect ? (scoring.tipoObjetoCorrect || scoring.tipo_objeto_correct || 10) : 0) +
    (categoriesFoundPct / 100 * (scoring.categoriesFoundPct || scoring.categories_found_pct || 25)) +
    (keyReqsPct / 100 * (scoring.keyRequirementsFoundPct || scoring.key_requirements_found_pct || 30)) +
    (criticalPct / 100 * (scoring.criticalPointsFoundPct || scoring.critical_points_found_pct || 20)) +
    (minReqsMet ? (scoring.minRequirementsMet || scoring.min_requirements_met || 10) : 0) +
    (minEvidenceMet ? (scoring.minEvidenceMet || scoring.min_evidence_met || 5) : 0)
  );

  return {
    caseId: benchCase.id,
    caseName: benchCase.name,
    tipoObjeto: benchCase.tipo_objeto,
    scores: {
      tipoObjetoCorrect: tipoCorrect,
      categoriesFoundPct,
      keyRequirementsFoundPct: keyReqsPct,
      criticalPointsFoundPct: criticalPct,
      minRequirementsMet: minReqsMet,
      minEvidenceMet: minEvidenceMet
    },
    totalScore,
    details
  };
}

/**
 * Gerar sumário de todos os resultados de benchmark
 */
export function generateBenchmarkSummary(results: BenchmarkResult[]): BenchmarkSummary {
  const totalCases = results.length;
  const averageScore = totalCases > 0
    ? Math.round(results.reduce((sum, r) => sum + r.totalScore, 0) / totalCases)
    : 0;

  const tipoObjetoAccuracy = totalCases > 0
    ? Math.round(results.filter(r => r.scores.tipoObjetoCorrect).length / totalCases * 100)
    : 0;

  const categoryAccuracy = totalCases > 0
    ? Math.round(results.reduce((sum, r) => sum + r.scores.categoriesFoundPct, 0) / totalCases)
    : 0;

  const requirementAccuracy = totalCases > 0
    ? Math.round(results.reduce((sum, r) => sum + r.scores.keyRequirementsFoundPct, 0) / totalCases)
    : 0;

  const criticalPointAccuracy = totalCases > 0
    ? Math.round(results.reduce((sum, r) => sum + r.scores.criticalPointsFoundPct, 0) / totalCases)
    : 0;

  console.log(`\n[Benchmark] ══════════════ SUMÁRIO ══════════════`);
  console.log(`[Benchmark] Cases: ${totalCases} | Score Médio: ${averageScore}%`);
  console.log(`[Benchmark] Tipo Objeto: ${tipoObjetoAccuracy}% | Categorias: ${categoryAccuracy}% | Exigências: ${requirementAccuracy}% | Críticos: ${criticalPointAccuracy}%`);
  for (const r of results) {
    console.log(`[Benchmark]   ${r.caseId}: ${r.totalScore}% — ${r.caseName}${r.details.length > 0 ? ' ⚠️' : ' ✅'}`);
  }
  console.log(`[Benchmark] ═══════════════════════════════════\n`);

  return { totalCases, averageScore, tipoObjetoAccuracy, categoryAccuracy, requirementAccuracy, criticalPointAccuracy, results };
}
