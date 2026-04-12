/**
 * ══════════════════════════════════════════════════════════════════
 *  Module Quality Evaluator — Avaliação de Qualidade por Módulo
 * ══════════════════════════════════════════════════════════════════
 */

import { ModuleName } from './moduleContextContracts';
import { logger } from '../../../lib/logger';

export interface ModuleQualityIssue {
    code: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    dimension: string;
    message: string;
}

export interface ModuleQualityReport {
    moduleName: ModuleName;
    executionId: string;
    overallScore: number;
    dimensions: Record<string, number>;
    issues: ModuleQualityIssue[];
    summary: string;
}

// ── Checagens por módulo ──

type ModuleCheck = {
    code: string;
    dimension: string;
    weight: number;
    check: (output: any) => boolean;
    failMessage: string;
    severity: ModuleQualityIssue['severity'];
};

const MODULE_CHECKS: Record<ModuleName, ModuleCheck[]> = {

    chat: [
        { code: 'CH01', dimension: 'aderência', weight: 5, check: (o) => o?.answer?.length > 50, failMessage: 'Resposta muito curta (<50 chars)', severity: 'high' },
        { code: 'CH02', dimension: 'evidência', weight: 4, check: (o) => (o?.editalBasis?.length || 0) > 0, failMessage: 'Resposta sem fundamento no edital', severity: 'high' },
        { code: 'CH03', dimension: 'utilidade', weight: 3, check: (o) => !o?.answer?.includes('não possuo informação') || o?.answer?.length > 100, failMessage: 'Resposta apenas diz que não tem informação', severity: 'medium' },
        { code: 'CH04', dimension: 'cautela', weight: 3, check: (o) => o?.confidence !== undefined, failMessage: 'Sem indicação de confiança', severity: 'low' },
        { code: 'CH05', dimension: 'risco', weight: 3, check: (o) => Array.isArray(o?.riskAlerts), failMessage: 'Sem campo de alertas de risco', severity: 'low' },
    ],

    petition: [
        { code: 'PT01', dimension: 'tese', weight: 5, check: (o) => o?.thesis?.length > 30, failMessage: 'Tese ausente ou muito curta', severity: 'critical' },
        { code: 'PT02', dimension: 'fatos', weight: 4, check: (o) => (o?.relevantFacts?.length || 0) >= 2, failMessage: 'Menos de 2 fatos relevantes', severity: 'high' },
        { code: 'PT03', dimension: 'fundamento_legal', weight: 5, check: (o) => (o?.legalGrounds?.length || 0) >= 1, failMessage: 'Sem fundamento jurídico', severity: 'critical' },
        { code: 'PT04', dimension: 'pedido', weight: 4, check: (o) => (o?.requestedMeasures?.length || 0) >= 1, failMessage: 'Sem medida solicitada', severity: 'high' },
        { code: 'PT05', dimension: 'contenção', weight: 3, check: (o) => Array.isArray(o?.limitations), failMessage: 'Sem sinalização de limitações', severity: 'medium' },
    ],

    oracle: [
        { code: 'OR01', dimension: 'match', weight: 5, check: (o) => ['full', 'partial', 'none'].includes(o?.adherenceLevel), failMessage: 'Nível de aderência inválido', severity: 'critical' },
        { code: 'OR02', dimension: 'lacunas', weight: 4, check: (o) => Array.isArray(o?.gaps), failMessage: 'Sem campo de lacunas', severity: 'high' },
        { code: 'OR03', dimension: 'falso_positivo', weight: 5, check: (o) => !(o?.adherenceLevel === 'full' && (o?.gaps?.length || 0) > 0), failMessage: 'Aderência TOTAL com lacunas = falso positivo', severity: 'critical' },
        { code: 'OR04', dimension: 'distinção', weight: 4, check: (o) => o?.isOperational !== undefined || o?.isProfessional !== undefined, failMessage: 'Sem distinção operacional/profissional', severity: 'high' },
        { code: 'OR05', dimension: 'recomendação', weight: 3, check: (o) => o?.recommendation?.length > 10, failMessage: 'Recomendação ausente ou muito curta', severity: 'medium' },
    ],

    dossier: [
        { code: 'DS01', dimension: 'completude', weight: 5, check: (o) => (o?.requiredDocuments?.length || 0) >= 5, failMessage: 'Menos de 5 documentos listados', severity: 'high' },
        { code: 'DS02', dimension: 'priorização', weight: 4, check: (o) => (o?.criticalItems?.length || 0) >= 1, failMessage: 'Sem items críticos identificados', severity: 'medium' },
        { code: 'DS03', dimension: 'áreas', weight: 3, check: (o) => Object.keys(o?.responsibleAreas || {}).length >= 2, failMessage: 'Menos de 2 áreas responsáveis', severity: 'low' },
        { code: 'DS04', dimension: 'ações', weight: 4, check: (o) => (o?.priorityActions?.length || 0) >= 1, failMessage: 'Sem ações prioritárias', severity: 'medium' },
        { code: 'DS05', dimension: 'duplicidade', weight: 3, check: (o) => {
            const names = (o?.requiredDocuments || []).map((d: any) => d.name?.toLowerCase());
            return new Set(names).size >= names.length * 0.9;
        }, failMessage: '>10% de documentos duplicados', severity: 'medium' },
    ],

    declaration: [
        { code: 'DC01', dimension: 'formalidade', weight: 5, check: (o) => o?.generatedText?.includes('DECLARA') || o?.generatedText?.includes('declara'), failMessage: 'Texto não contém termo formal DECLARA', severity: 'high' },
        { code: 'DC02', dimension: 'campos', weight: 4, check: (o) => (o?.requiredInputs?.length || 0) >= 1, failMessage: 'Sem campos a preencher identificados', severity: 'medium' },
        { code: 'DC03', dimension: 'invenção', weight: 5, check: (o) => (o?.warnings?.length || 0) < 3, failMessage: '3+ avisos = possível invenção', severity: 'high' },
        { code: 'DC04', dimension: 'completude', weight: 3, check: (o) => o?.generatedText?.length > 100, failMessage: 'Texto muito curto (<100 chars)', severity: 'medium' },
        { code: 'DC05', dimension: 'confiança', weight: 3, check: (o) => o?.confidence !== undefined, failMessage: 'Sem indicação de confiança', severity: 'low' },
    ],

    proposal: [
        { code: 'PP01', dimension: 'completude', weight: 5, check: (o) => (o?.proposalRequirements?.length || 0) >= 3, failMessage: 'Menos de 3 requisitos de proposta', severity: 'high' },
        { code: 'PP02', dimension: 'risco', weight: 5, check: (o) => Array.isArray(o?.disqualificationRisks), failMessage: 'Sem riscos de desclassificação', severity: 'high' },
        { code: 'PP03', dimension: 'anexos', weight: 4, check: (o) => Array.isArray(o?.technicalAttachmentsNeeded), failMessage: 'Sem anexos técnicos listados', severity: 'medium' },
        { code: 'PP04', dimension: 'checklist', weight: 3, check: (o) => (o?.priorityChecklist?.length || 0) >= 1, failMessage: 'Sem checklist prioritário', severity: 'medium' },
        { code: 'PP05', dimension: 'comercial', weight: 3, check: (o) => Array.isArray(o?.commercialRisks), failMessage: 'Sem riscos comerciais', severity: 'low' },
    ]
};

// ── Executor ──

export function evaluateModuleQuality(
    moduleName: ModuleName,
    output: any,
    executionId?: string
): ModuleQualityReport {
    const checks = MODULE_CHECKS[moduleName] || [];
    const issues: ModuleQualityIssue[] = [];
    const dimensionScores: Record<string, { total: number; passed: number }> = {};

    for (const c of checks) {
        if (!dimensionScores[c.dimension]) {
            dimensionScores[c.dimension] = { total: 0, passed: 0 };
        }
        dimensionScores[c.dimension].total += c.weight;

        try {
            if (c.check(output)) {
                dimensionScores[c.dimension].passed += c.weight;
            } else {
                issues.push({
                    code: c.code,
                    severity: c.severity,
                    dimension: c.dimension,
                    message: c.failMessage
                });
            }
        } catch {
            issues.push({
                code: c.code,
                severity: 'low',
                dimension: c.dimension,
                message: `Checagem ${c.code} falhou internamente`
            });
        }
    }

    const dimensions: Record<string, number> = {};
    let totalWeight = 0;
    let totalPassed = 0;

    for (const [dim, scores] of Object.entries(dimensionScores)) {
        dimensions[dim] = scores.total > 0 ? Math.round((scores.passed / scores.total) * 100) : 0;
        totalWeight += scores.total;
        totalPassed += scores.passed;
    }

    const overallScore = totalWeight > 0 ? Math.round((totalPassed / totalWeight) * 100) : 0;
    const summary = `[${moduleName}] Quality: ${overallScore}% | ${Object.entries(dimensions).map(([k, v]) => `${k}: ${v}%`).join(' | ')} | ${issues.length} issues`;

    logger.info(`[ModuleQuality] ${summary}`);

    return {
        moduleName,
        executionId: executionId || 'unknown',
        overallScore,
        dimensions,
        issues,
        summary
    };
}
