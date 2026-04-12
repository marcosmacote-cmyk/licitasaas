/**
 * ══════════════════════════════════════════════════════════════════
 *  Human Review Policy — Política de Revisão Humana v2.1
 * ══════════════════════════════════════════════════════════════════
 *
 *  Refino: calibração recommended vs required, regras para módulos
 *  críticos (Oracle, Proposal, Petition, Participation), thresholds
 *  ajustados, casos limítrofes tratados.
 */

import { ModuleName } from './moduleContextContracts';
import { logger } from '../../../lib/logger';

export interface HumanReviewDecision {
    reviewStatus: 'not_needed' | 'recommended' | 'required';
    reasons: string[];
    criticalFields?: string[];
    moduleName: ModuleName;
    riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
}

type ReviewRule = {
    code: string;
    level: 'recommended' | 'required';
    check: (context: ReviewContext) => boolean;
    reason: string;
    criticalFields?: string[];
};

interface ReviewContext {
    moduleOutput: any;
    schemaV2: any;
    qualityScore?: number;
    userInput?: string;
    participationScore?: number;
    hardBlocks?: string[];
}

// ── Regras por módulo (calibradas v2.1) ──

const REVIEW_RULES: Record<ModuleName, ReviewRule[]> = {

    chat: [
        { code: 'CHR01', level: 'recommended', reason: 'Confiança baixa na resposta',
          check: (ctx) => ctx.moduleOutput?.confidence === 'low' },
        { code: 'CHR02', level: 'recommended', reason: 'Nenhuma evidência do edital citada na resposta',
          check: (ctx) => (ctx.moduleOutput?.editalBasis?.length || 0) === 0 },
        { code: 'CHR03', level: 'required', reason: 'Pergunta sobre tese jurídica sensível',
          check: (ctx) => {
              const q = (ctx.userInput || '').toLowerCase();
              return q.includes('impugn') || q.includes('recurso') || q.includes('ilegal') || q.includes('nulidade') || q.includes('anular');
          }},
        { code: 'CHR04', level: 'recommended', reason: 'Inconsistências entre documentos do edital',
          check: (ctx) => (ctx.schemaV2?.legal_risk_review?.inconsistencies?.length || 0) > 0 },
        { code: 'CHR05', level: 'recommended', reason: 'Resposta é recomendação (não fato) com alto risco',
          check: (ctx) => ctx.moduleOutput?.sourceType === 'recommendation' && ctx.moduleOutput?.riskAlerts?.length > 0 },
    ],

    petition: [
        { code: 'PTR01', level: 'required', reason: 'Tese classificada como FRACA pelo módulo',
          check: (ctx) => ctx.moduleOutput?.thesisStrength === 'weak',
          criticalFields: ['thesis', 'legalGrounds', 'limitations'] },
        { code: 'PTR02', level: 'required', reason: 'Tese com 2+ limitações identificadas',
          check: (ctx) => (ctx.moduleOutput?.limitations?.length || 0) >= 2,
          criticalFields: ['thesis', 'limitations'] },
        { code: 'PTR03', level: 'required', reason: 'Cláusula restritiva complexa (2+ cláusulas)',
          check: (ctx) => (ctx.schemaV2?.legal_risk_review?.possible_restrictive_clauses?.length || 0) >= 2 },
        { code: 'PTR04', level: 'recommended', reason: 'Documentos conflitantes no edital (2+ inconsistências)',
          check: (ctx) => (ctx.schemaV2?.legal_risk_review?.inconsistencies?.length || 0) >= 2 },
        { code: 'PTR05', level: 'required', reason: 'Pedido de nulidade/suspensão/anulação — alta sensibilidade',
          check: (ctx) => {
              const measures = (ctx.moduleOutput?.requestedMeasures || []).join(' ').toLowerCase();
              return measures.includes('nulidade') || measures.includes('suspensão') || measures.includes('anulação');
          }},
        { code: 'PTR06', level: 'required', reason: 'Risco alto de overreach argumentativo',
          check: (ctx) => ctx.moduleOutput?.riskOfOverreach === 'high' },
        { code: 'PTR07', level: 'recommended', reason: 'Score de qualidade abaixo de 60%',
          check: (ctx) => (ctx.qualityScore || 100) < 60 },
    ],

    oracle: [
        { code: 'ORR01', level: 'required', reason: 'Aderência PARCIAL em item CRÍTICO de habilitação',
          check: (ctx) => ctx.moduleOutput?.adherenceLevel === 'partial' && (ctx.moduleOutput?.riskLevel === 'high' || ctx.moduleOutput?.riskLevel === 'critical'),
          criticalFields: ['gaps', 'adherenceLevel', 'rationale'] },
        { code: 'ORR02', level: 'required', reason: 'Possível falso positivo detectado pelo módulo',
          check: (ctx) => ctx.moduleOutput?.falsePositiveFlag === true,
          criticalFields: ['falsePositiveReason', 'adherenceLevel'] },
        { code: 'ORR03', level: 'recommended', reason: 'Lacuna quantitativa identificada',
          check: (ctx) => ctx.moduleOutput?.quantitativeComparison?.deficit && ctx.moduleOutput?.quantitativeComparison?.deficit !== '0' },
        { code: 'ORR04', level: 'required', reason: 'Confusão operacional vs profissional',
          check: (ctx) => ctx.moduleOutput?.isOperational === true && ctx.moduleOutput?.isProfessional === true },
        { code: 'ORR05', level: 'recommended', reason: 'Vínculo técnico do profissional não confirmado',
          check: (ctx) => (ctx.moduleOutput?.gaps || []).some((g: any) => {
              const text = typeof g === 'string' ? g : g.gap || '';
              return text.toLowerCase().includes('vínculo');
          })},
        { code: 'ORR06', level: 'required', reason: 'Risco classificado como CRÍTICO pelo módulo',
          check: (ctx) => ctx.moduleOutput?.riskLevel === 'critical',
          criticalFields: ['gaps', 'riskJustification'] },
    ],

    dossier: [
        { code: 'DSR01', level: 'required', reason: 'Risco de inabilitação: 3+ documentos críticos faltantes',
          check: (ctx) => (ctx.moduleOutput?.missingDocuments?.length || 0) >= 3,
          criticalFields: ['missingDocuments', 'disqualificationRisks'] },
        { code: 'DSR02', level: 'required', reason: 'Documentos vencidos que causam inabilitação',
          check: (ctx) => (ctx.moduleOutput?.expiredDocuments?.length || 0) >= 1,
          criticalFields: ['expiredDocuments'] },
        { code: 'DSR03', level: 'recommended', reason: 'Checklist com 5+ itens de alta criticidade',
          check: (ctx) => (ctx.moduleOutput?.criticalItems?.length || 0) >= 5 },
        { code: 'DSR04', level: 'recommended', reason: 'Riscos de desclassificação identificados no dossiê',
          check: (ctx) => (ctx.moduleOutput?.disqualificationRisks?.length || 0) > 0 },
    ],

    declaration: [
        { code: 'DCR01', level: 'required', reason: 'Campos essenciais ausentes (3+)',
          check: (ctx) => (ctx.moduleOutput?.requiredInputs?.length || 0) >= 3,
          criticalFields: ['requiredInputs'] },
        { code: 'DCR02', level: 'recommended', reason: 'Declaração sensível sem confirmação factual',
          check: (ctx) => (ctx.moduleOutput?.warnings?.length || 0) >= 2 },
        { code: 'DCR03', level: 'recommended', reason: 'Confiança baixa na geração',
          check: (ctx) => ctx.moduleOutput?.confidence === 'low' },
    ],

    proposal: [
        { code: 'PPR01', level: 'required', reason: 'Riscos de desclassificação da proposta (2+)',
          check: (ctx) => {
              const risks = ctx.moduleOutput?.disqualificationRisks || [];
              return (Array.isArray(risks) ? risks.length : 0) >= 2;
          },
          criticalFields: ['disqualificationRisks'] },
        { code: 'PPR02', level: 'required', reason: 'Critérios de exequibilidade identificados — alto risco comercial',
          check: (ctx) => (ctx.moduleOutput?.feasibilityCriteria?.length || 0) >= 1,
          criticalFields: ['feasibilityCriteria'] },
        { code: 'PPR03', level: 'recommended', reason: '4+ anexos técnicos necessários — complexidade alta',
          check: (ctx) => (ctx.moduleOutput?.technicalAttachmentsNeeded?.length || 0) >= 4 },
        { code: 'PPR04', level: 'required', reason: 'Conflitos detectados entre edital, TR e planilha',
          check: (ctx) => (ctx.moduleOutput?.editalConflicts?.length || 0) >= 1,
          criticalFields: ['editalConflicts'] },
        { code: 'PPR05', level: 'recommended', reason: 'Score de qualidade do módulo abaixo de 60%',
          check: (ctx) => (ctx.qualityScore || 100) < 60 },
    ]
};

// ── Executor ──

export function evaluateHumanReview(
    moduleName: ModuleName,
    moduleOutput: any,
    schemaV2: any,
    qualityScore?: number,
    userInput?: string,
    participationScore?: number,
    hardBlocks?: string[]
): HumanReviewDecision {
    const rules = REVIEW_RULES[moduleName] || [];
    const ctx: ReviewContext = { moduleOutput, schemaV2, qualityScore, userInput, participationScore, hardBlocks };

    const triggeredReasons: string[] = [];
    const criticalFields: string[] = [];
    let maxLevel: 'not_needed' | 'recommended' | 'required' = 'not_needed';
    let requiredCount = 0;
    let recommendedCount = 0;

    for (const rule of rules) {
        try {
            if (rule.check(ctx)) {
                triggeredReasons.push(`[${rule.code}] ${rule.reason}`);
                if (rule.criticalFields) criticalFields.push(...rule.criticalFields);

                if (rule.level === 'required') {
                    maxLevel = 'required';
                    requiredCount++;
                } else if (rule.level === 'recommended') {
                    recommendedCount++;
                    if (maxLevel !== 'required') maxLevel = 'recommended';
                }
            }
        } catch {
            // Rule check failed — skip silently
        }
    }

    // Escalonamento: 3+ recommended vira required (acúmulo de riscos)
    if (recommendedCount >= 3 && maxLevel === 'recommended') {
        maxLevel = 'required';
        triggeredReasons.push('[ESCALATION] 3+ alertas acumulados → revisão obrigatória');
    }

    // Risk level
    let riskLevel: HumanReviewDecision['riskLevel'] = 'none';
    if (requiredCount >= 2) riskLevel = 'critical';
    else if (requiredCount === 1) riskLevel = 'high';
    else if (recommendedCount >= 2) riskLevel = 'medium';
    else if (recommendedCount === 1) riskLevel = 'low';

    if (triggeredReasons.length > 0) {
        logger.info(`[HumanReview] ${moduleName}: ${maxLevel} (risk: ${riskLevel}) — ${triggeredReasons.join('; ')}`);
    }

    return {
        reviewStatus: maxLevel,
        reasons: triggeredReasons,
        criticalFields: [...new Set(criticalFields)],
        moduleName,
        riskLevel
    };
}
