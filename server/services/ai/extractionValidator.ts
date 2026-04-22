/**
 * ══════════════════════════════════════════════════════════════════
 *  ExtractionValidator — V5.0 Post-Extraction Structural Validation
 * ══════════════════════════════════════════════════════════════════
 *
 *  Deterministic, server-side validation that detects extraction gaps
 *  BEFORE SchemaEnforcer runs. Unlike SchemaEnforcer (which silently
 *  injects defaults), this module:
 *    1. Identifies what's ACTUALLY missing
 *    2. Reports gaps with severity levels
 *    3. Determines if surgical re-extraction is worth attempting
 *
 *  Pure, sync, <5ms. No AI, no I/O.
 */

import { logger } from '../../lib/logger';

// ── Types ──

export interface GapReport {
    category: string;
    missing: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface ValidationResult {
    isValid: boolean;
    gaps: GapReport[];
    /** Only true when gaps are severe enough to justify an AI call */
    requiresReExtraction: boolean;
    /** Categories that should be re-extracted (if requiresReExtraction=true) */
    reExtractionTargets: string[];
}

// ── Mandatory CND keywords for RFT validation ──

const MANDATORY_RFT_CHECKS = [
    { keyword: 'cnpj', label: 'CNPJ' },
    { keyword: 'federal', altKeywords: ['rfb', 'pgfn', 'dívida ativa', 'tributos federais'], label: 'CND Federal (RFB/PGFN)' },
    { keyword: 'estadual', altKeywords: ['fazenda estadual', 'sefaz'], label: 'CND Estadual' },
    { keyword: 'municipal', altKeywords: ['fazenda municipal', 'iss'], label: 'CND Municipal' },
    { keyword: 'fgts', altKeywords: ['crf', 'fundo de garantia'], label: 'FGTS/CRF' },
    { keyword: 'trabalhist', altKeywords: ['cndt', 'débitos trabalhistas'], label: 'CNDT' },
];

// ── Core validation ──

export function validateExtraction(
    extractionJson: any,
    objectType: string
): ValidationResult {
    const gaps: GapReport[] = [];
    const reExtractionTargets: string[] = [];

    const requirements = extractionJson?.requirements || {};

    // ── 1. RFT Completeness ──
    const rftItems = Array.isArray(requirements.regularidade_fiscal_trabalhista)
        ? requirements.regularidade_fiscal_trabalhista : [];
    const rftText = rftItems.map((r: any) => `${r.title || ''} ${r.description || ''}`.toLowerCase()).join(' ');

    let rftMissing = 0;
    for (const check of MANDATORY_RFT_CHECKS) {
        const found = rftText.includes(check.keyword) ||
            (check.altKeywords || []).some(alt => rftText.includes(alt));
        if (!found) {
            gaps.push({ category: 'RFT', missing: check.label, severity: 'high' });
            rftMissing++;
        }
    }
    if (rftMissing >= 3) {
        reExtractionTargets.push('regularidade_fiscal_trabalhista');
    }

    // ── 2. QEF Completeness ──
    const qefItems = Array.isArray(requirements.qualificacao_economico_financeira)
        ? requirements.qualificacao_economico_financeira : [];
    const qefText = qefItems.map((r: any) => `${r.title || ''} ${r.description || ''}`.toLowerCase()).join(' ');

    const hasBalanco = /balan[çc]o|demonstra[çc][õo]es cont[áa]beis|dre/i.test(qefText);
    const hasIndices = /[ií]ndice|liquidez|solv[eê]ncia|\\b(LG|SG|LC|EG)\\b/i.test(qefText);
    const hasFalencia = /fal[eê]ncia|recupera[çc][ãa]o judicial/i.test(qefText);

    if (!hasBalanco && ['obra_engenharia', 'servico_comum_engenharia', 'servico_comum'].includes(objectType)) {
        gaps.push({ category: 'QEF', missing: 'Balanço Patrimonial/DRE', severity: 'critical' });
    }
    if (!hasIndices && ['obra_engenharia', 'servico_comum_engenharia', 'servico_comum'].includes(objectType)) {
        gaps.push({ category: 'QEF', missing: 'Índices Contábeis (LG/SG/LC)', severity: 'critical' });
    }
    if (!hasFalencia) {
        gaps.push({ category: 'QEF', missing: 'Certidão de Falência', severity: 'high' });
    }
    if (qefItems.length === 0 && objectType !== 'fornecimento') {
        reExtractionTargets.push('qualificacao_economico_financeira');
    }

    // ── 3. Indices cross-check ──
    const indices = extractionJson?.economic_financial_analysis?.indices_exigidos || [];
    if (qefItems.length > 0 && hasIndices && indices.length === 0) {
        gaps.push({ category: 'QEF→indices', missing: 'indices_exigidos vazio apesar de QEF mencionar índices', severity: 'high' });
    }

    // ── 4. QTO/QTP for engineering objects ──
    const qtoItems = Array.isArray(requirements.qualificacao_tecnica_operacional)
        ? requirements.qualificacao_tecnica_operacional : [];
    const qtpItems = Array.isArray(requirements.qualificacao_tecnica_profissional)
        ? requirements.qualificacao_tecnica_profissional : [];

    if (['obra_engenharia', 'servico_comum_engenharia'].includes(objectType)) {
        if (qtoItems.length === 0) {
            gaps.push({ category: 'QTO', missing: 'Categoria inteira vazia (engenharia)', severity: 'critical' });
            reExtractionTargets.push('qualificacao_tecnica_operacional');
        }
        if (qtpItems.length === 0) {
            gaps.push({ category: 'QTP', missing: 'Categoria inteira vazia (engenharia)', severity: 'critical' });
            reExtractionTargets.push('qualificacao_tecnica_profissional');
        }
    }

    // ── 5. PC check ──
    const pcItems = Array.isArray(requirements.proposta_comercial)
        ? requirements.proposta_comercial : [];
    if (pcItems.length === 0) {
        gaps.push({ category: 'PC', missing: 'Proposta Comercial vazia', severity: 'high' });
    }

    // ── 6. Source_ref monotonicity ──
    const allReqs = Object.values(requirements).flat() as any[];
    const allRefs = allReqs.map((r: any) => r.source_ref).filter((s: any) => s && s !== 'referência não localizada');
    const uniqueRefs = new Set(allRefs);
    if (uniqueRefs.size <= 2 && allRefs.length >= 10) {
        gaps.push({ category: 'TRACEABILITY', missing: `${allRefs.length} exigências apontam para apenas ${uniqueRefs.size} ref(s)`, severity: 'medium' });
    }

    // ── 7. Evidence registry ──
    const evidenceCount = (extractionJson?.evidence_registry || []).length;
    if (evidenceCount === 0 && allReqs.length > 0) {
        gaps.push({ category: 'EVIDENCE', missing: 'evidence_registry vazio', severity: 'medium' });
    }

    // ── Decision: is re-extraction worth it? ──
    // Only if we have critical gaps AND specific targets to focus on
    const criticalCount = gaps.filter(g => g.severity === 'critical').length;
    const requiresReExtraction = reExtractionTargets.length > 0 && criticalCount >= 1;

    if (gaps.length > 0) {
        logger.info(`[ExtractionValidator] 📋 ${gaps.length} gap(s) detectado(s) (${criticalCount} critical, ${gaps.filter(g => g.severity === 'high').length} high)`);
        for (const gap of gaps.slice(0, 8)) {
            logger.info(`[ExtractionValidator]   → [${gap.severity.toUpperCase()}] ${gap.category}: ${gap.missing}`);
        }
        if (requiresReExtraction) {
            logger.info(`[ExtractionValidator] 🔬 Re-extração cirúrgica recomendada para: ${reExtractionTargets.join(', ')}`);
        }
    } else {
        logger.info(`[ExtractionValidator] ✅ Extração completa — nenhum gap detectado`);
    }

    return {
        isValid: gaps.length === 0,
        gaps,
        requiresReExtraction,
        reExtractionTargets: [...new Set(reExtractionTargets)],
    };
}

// ── Surgical Re-Extraction Prompts (category-specific) ──

const SURGICAL_PROMPTS: Record<string, string> = {
    'qualificacao_economico_financeira': `Você receberá documentos de uma licitação. Extraia APENAS a QUALIFICAÇÃO ECONÔMICO-FINANCEIRA.

PROCURE estas palavras no documento:
- "balanço patrimonial", "demonstrações contábeis", "DRE"
- "índice de liquidez", "LG", "LC", "SG", "EG", "endividamento"
- "patrimônio líquido mínimo", "capital social mínimo"
- "certidão de falência", "recuperação judicial"

Para CADA índice contábil encontrado, extraia:
- Nome (LG, LC, SG, EG)
- Operador (>= ou <=)
- Valor mínimo exigido
- Referência do edital (item X.Y)

Retorne JSON:
{
  "qualificacao_economico_financeira": [
    {"requirement_id":"QEF-01","title":"...","description":"...","source_ref":"Edital, item X.Y","entry_type":"exigencia_principal","risk_if_missing":"inabilitacao"}
  ],
  "indices_exigidos": [
    {"indice":"LG","operador":">=","valor_referencia":"1.0","source_ref":"Edital, item X.Y"}
  ],
  "patrimonio_liquido_minimo": "",
  "capital_social_minimo": "",
  "evidence_registry": [{"evidence_id":"EV-QEF-01","excerpt":"trecho literal 30-80 chars","section":"..."}]
}`,

    'regularidade_fiscal_trabalhista': `Você receberá documentos de uma licitação. Extraia APENAS a REGULARIDADE FISCAL E TRABALHISTA.

PROCURE estas seções: "Regularidade Fiscal", "Documentos de Habilitação", "Habilitação Fiscal".

Extraia CADA certidão como item separado. Ordem esperada:
1. CNPJ
2. Inscrição Estadual (IE)
3. Inscrição Municipal (IM)
4. CND Federal (RFB/PGFN) — tributos federais e dívida ativa
5. CND Estadual (Fazenda Estadual)
6. CND Municipal (Fazenda Municipal / ISS)
7. CRF/FGTS
8. CNDT (Débitos Trabalhistas)
9. INSS/Seguridade (se separado do item 7)

NUNCA agrupe FGTS e INSS em um único item.

Retorne JSON:
{
  "regularidade_fiscal_trabalhista": [
    {"requirement_id":"RFT-01","title":"...","description":"...","source_ref":"Edital, item X.Y","entry_type":"exigencia_principal","risk_if_missing":"inabilitacao"}
  ],
  "evidence_registry": [{"evidence_id":"EV-RFT-01","excerpt":"trecho literal","section":"..."}]
}`,

    'qualificacao_tecnica_operacional': `Você receberá documentos de uma licitação. Extraia APENAS a QUALIFICAÇÃO TÉCNICA OPERACIONAL (da EMPRESA, não do profissional).

PROCURE: "Qualificação Técnica", "Capacidade Técnica", "Atestados", "Parcelas de Maior Relevância".

Extraia:
- Registro PJ no CREA/CAU (se houver)
- Visita técnica (se exigida)
- CADA parcela de maior relevância como item SEPARADO com QUANTITATIVO MÍNIMO e UNIDADE

Para CADA atestado, a description DEVE conter:
- Serviço/parcela EXATA (transcrição literal)
- Quantidade mínima (ex: "3.500,00 m²")
- Unidade de medida

Retorne JSON:
{
  "qualificacao_tecnica_operacional": [
    {"requirement_id":"QTO-01","title":"...","description":"...com quantitativo mínimo...","source_ref":"Edital, item X.Y","entry_type":"exigencia_principal","risk_if_missing":"inabilitacao"}
  ],
  "evidence_registry": [...]
}`,

    'qualificacao_tecnica_profissional': `Você receberá documentos de uma licitação. Extraia APENAS a QUALIFICAÇÃO TÉCNICA PROFISSIONAL (do PROFISSIONAL/RT, não da empresa).

PROCURE: "Responsável Técnico", "CAT", "Certidão de Acervo Técnico", "ART", "RRT", "vínculo profissional".

Extraia:
- CADA CAT/parcela profissional como item SEPARADO
- Vínculo do RT com a empresa
- Registro individual no CREA/CAU

Para CADA CAT, a description DEVE conter o QUANTITATIVO MÍNIMO e UNIDADE.

Retorne JSON:
{
  "qualificacao_tecnica_profissional": [
    {"requirement_id":"QTP-01","title":"...","description":"...","source_ref":"Edital, item X.Y","entry_type":"exigencia_principal","risk_if_missing":"inabilitacao"}
  ],
  "evidence_registry": [...]
}`
};

/**
 * Get the surgical prompt for a specific category gap.
 * Returns null if no surgical prompt is available for the category.
 */
export function getSurgicalPrompt(category: string): string | null {
    return SURGICAL_PROMPTS[category] || null;
}
