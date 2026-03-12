/**
 * ══════════════════════════════════════════════════════════════════
 *  Human Review Policy — Política de Revisão Humana Assistida
 * ══════════════════════════════════════════════════════════════════
 *
 *  Identifica quando o módulo deve recomendar revisão humana
 *  antes do uso final da saída gerada.
 */

import { ModuleName } from './moduleContextContracts';

export interface HumanReviewDecision {
    reviewStatus: 'not_needed' | 'recommended' | 'required';
    reasons: string[];
    criticalFields?: string[];
    moduleName: ModuleName;
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
}

// ── Regras por módulo ──

const REVIEW_RULES: Record<ModuleName, ReviewRule[]> = {

    chat: [
        { code: 'CHR01', level: 'recommended', reason: 'Confiança baixa na resposta',
          check: (ctx) => ctx.moduleOutput?.confidence === 'low' },
        { code: 'CHR02', level: 'recommended', reason: 'Evidência insuficiente para a resposta',
          check: (ctx) => (ctx.moduleOutput?.editalBasis?.length || 0) === 0 },
        { code: 'CHR03', level: 'required', reason: 'Pergunta sobre tese jurídica sensível (impugnação/recurso)',
          check: (ctx) => {
              const q = (ctx.userInput || '').toLowerCase();
              return q.includes('impugn') || q.includes('recurso') || q.includes('ilegal') || q.includes('nulidade');
          }},
        { code: 'CHR04', level: 'recommended', reason: 'Conflito entre documentos do edital detectado',
          check: (ctx) => (ctx.schemaV2?.legal_risk_review?.inconsistencies?.length || 0) > 0 },
    ],

    petition: [
        { code: 'PTR01', level: 'required', reason: 'Tese com sustentação documental fraca',
          check: (ctx) => (ctx.moduleOutput?.limitations?.length || 0) >= 2,
          criticalFields: ['thesis', 'legalGrounds'] },
        { code: 'PTR02', level: 'required', reason: 'Possível cláusula restritiva complexa',
          check: (ctx) => (ctx.schemaV2?.legal_risk_review?.possible_restrictive_clauses?.length || 0) >= 2 },
        { code: 'PTR03', level: 'recommended', reason: 'Múltiplos documentos conflitantes no edital',
          check: (ctx) => (ctx.schemaV2?.legal_risk_review?.inconsistencies?.length || 0) >= 2 },
        { code: 'PTR04', level: 'required', reason: 'Pedido com alta sensibilidade jurídica',
          check: (ctx) => {
              const measures = (ctx.moduleOutput?.requestedMeasures || []).join(' ').toLowerCase();
              return measures.includes('nulidade') || measures.includes('suspensão') || measures.includes('anulação');
          }},
        { code: 'PTR05', level: 'recommended', reason: 'Score de qualidade do módulo abaixo de 60%',
          check: (ctx) => (ctx.qualityScore || 100) < 60 },
    ],

    oracle: [
        { code: 'ORR01', level: 'required', reason: 'Aderência parcial em item crítico de habilitação',
          check: (ctx) => ctx.moduleOutput?.adherenceLevel === 'partial' && ctx.moduleOutput?.riskLevel === 'high',
          criticalFields: ['gaps', 'adherenceLevel'] },
        { code: 'ORR02', level: 'recommended', reason: 'Ausência de quantitativo claro para comparação',
          check: (ctx) => (ctx.moduleOutput?.gaps || []).some((g: string) => g.toLowerCase().includes('quantitativo')) },
        { code: 'ORR03', level: 'required', reason: 'Dúvida entre exigência operacional e profissional',
          check: (ctx) => ctx.moduleOutput?.isOperational === true && ctx.moduleOutput?.isProfessional === true },
        { code: 'ORR04', level: 'recommended', reason: 'Falta de vínculo técnico do profissional',
          check: (ctx) => (ctx.moduleOutput?.gaps || []).some((g: string) => g.toLowerCase().includes('vínculo')) },
    ],

    dossier: [
        { code: 'DSR01', level: 'required', reason: 'Documento crítico de habilitação não identificado',
          check: (ctx) => (ctx.moduleOutput?.missingDocuments?.length || 0) >= 3,
          criticalFields: ['missingDocuments'] },
        { code: 'DSR02', level: 'recommended', reason: 'Checklist incompleto com alto risco de inabilitação',
          check: (ctx) => (ctx.moduleOutput?.criticalItems?.length || 0) >= 5 },
    ],

    declaration: [
        { code: 'DCR01', level: 'required', reason: 'Campos essenciais ausentes na declaração',
          check: (ctx) => (ctx.moduleOutput?.requiredInputs?.length || 0) >= 3,
          criticalFields: ['requiredInputs'] },
        { code: 'DCR02', level: 'recommended', reason: 'Declaração sensível sem confirmação factual suficiente',
          check: (ctx) => (ctx.moduleOutput?.warnings?.length || 0) >= 2 },
        { code: 'DCR03', level: 'recommended', reason: 'Confiança baixa na geração',
          check: (ctx) => ctx.moduleOutput?.confidence === 'low' },
    ],

    proposal: [
        { code: 'PPR01', level: 'required', reason: 'Risco alto de desclassificação da proposta',
          check: (ctx) => (ctx.moduleOutput?.disqualificationRisks?.length || 0) >= 2,
          criticalFields: ['disqualificationRisks'] },
        { code: 'PPR02', level: 'recommended', reason: 'Dados técnicos ausentes para montagem da proposta',
          check: (ctx) => (ctx.moduleOutput?.technicalAttachmentsNeeded?.length || 0) >= 4 },
        { code: 'PPR03', level: 'required', reason: 'Conflito entre TR, planilha e corpo do edital',
          check: (ctx) => (ctx.schemaV2?.legal_risk_review?.inconsistencies?.length || 0) >= 1 },
    ]
};

// ── Executor ──

export function evaluateHumanReview(
    moduleName: ModuleName,
    moduleOutput: any,
    schemaV2: any,
    qualityScore?: number,
    userInput?: string
): HumanReviewDecision {
    const rules = REVIEW_RULES[moduleName] || [];
    const ctx: ReviewContext = { moduleOutput, schemaV2, qualityScore, userInput };

    const triggeredReasons: string[] = [];
    const criticalFields: string[] = [];
    let maxLevel: 'not_needed' | 'recommended' | 'required' = 'not_needed';

    for (const rule of rules) {
        try {
            if (rule.check(ctx)) {
                triggeredReasons.push(`[${rule.code}] ${rule.reason}`);
                if (rule.criticalFields) criticalFields.push(...rule.criticalFields);

                if (rule.level === 'required') {
                    maxLevel = 'required';
                } else if (rule.level === 'recommended' && maxLevel !== 'required') {
                    maxLevel = 'recommended';
                }
            }
        } catch {
            // Rule check failed — skip silently
        }
    }

    if (triggeredReasons.length > 0) {
        console.log(`[HumanReview] ${moduleName}: ${maxLevel} — ${triggeredReasons.join('; ')}`);
    }

    return {
        reviewStatus: maxLevel,
        reasons: triggeredReasons,
        criticalFields: [...new Set(criticalFields)],
        moduleName
    };
}
