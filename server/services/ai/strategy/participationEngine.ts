/**
 * ══════════════════════════════════════════════════════════════════
 *  Company × Edital Matching Engine + Strategic Score + Action Plan
 * ══════════════════════════════════════════════════════════════════
 *
 *  Cruza a análise do edital com o perfil da empresa e gera:
 *  - matching por dimensão
 *  - score estratégico de participação
 *  - recomendação executiva
 *  - plano de ação
 */

import { getProfile, getCompanyDocuments, CompanyLicitationProfile, DocumentRecord } from '../company/companyProfileService';

// ── Matching Schema ──

export interface CompanyEditalMatchResult {
    companyId: string;
    processId: string;
    matchedAt: string;
    documentaryFit: {
        matched: string[];
        missing: string[];
        expired: string[];
        uncertain: string[];
        score: number;
    };
    technicalFit: {
        matched: string[];
        missing: string[];
        partial: string[];
        highRiskGaps: string[];
        hasSufficientProfessionals: boolean;
        score: number;
    };
    economicFinancialFit: {
        matched: string[];
        missing: string[];
        warnings: string[];
        score: number;
    };
    proposalFit: {
        readyItems: string[];
        missingInputs: string[];
        risks: string[];
        score: number;
    };
    strategicNotes: string[];
}

export interface ParticipationAssessment {
    companyId: string;
    processId: string;
    overallScore: number;
    dimensions: {
        documentaryReadiness: number;
        technicalReadiness: number;
        economicFinancialReadiness: number;
        proposalReadiness: number;
        legalRisk: number;
        operationalEffort: number;
    };
    recommendation: 'participar' | 'participar_com_ressalvas' | 'nao_participar' | 'revisao_humana_obrigatoria';
    rationale: string[];
    confidenceLevel: 'low' | 'medium' | 'high';
}

export interface ParticipationActionPlan {
    companyId: string;
    processId: string;
    executiveRecommendation: string;
    criticalPendingItems: Array<{
        item: string;
        area: string;
        urgency: 'low' | 'medium' | 'high' | 'critical';
    }>;
    actionChecklist: Array<{
        action: string;
        ownerArea: string;
        deadlineHint?: string;
    }>;
    petitionOrClarificationSuggestions: string[];
    proposalPreparationWarnings: string[];
}

// ── Matching Engine ──

export function matchCompanyToEdital(companyId: string, schemaV2: any, processId: string): CompanyEditalMatchResult {
    const profile = getProfile(companyId);
    const docs = getCompanyDocuments(companyId);

    const result: CompanyEditalMatchResult = {
        companyId,
        processId,
        matchedAt: new Date().toISOString(),
        documentaryFit: matchDocuments(profile, docs, schemaV2),
        technicalFit: matchTechnical(profile, schemaV2),
        economicFinancialFit: matchEconomicFinancial(profile, docs, schemaV2),
        proposalFit: matchProposal(profile, docs, schemaV2),
        strategicNotes: generateStrategicNotes(profile, schemaV2)
    };

    console.log(`[Matching] ${companyId} × ${processId}: Doc=${result.documentaryFit.score}% Tech=${result.technicalFit.score}% EF=${result.economicFinancialFit.score}% Prop=${result.proposalFit.score}%`);

    return result;
}

// ── Score Engine ──

export function calculateParticipationScore(matchResult: CompanyEditalMatchResult, schemaV2: any): ParticipationAssessment {
    const dims = {
        documentaryReadiness: matchResult.documentaryFit.score,
        technicalReadiness: matchResult.technicalFit.score,
        economicFinancialReadiness: matchResult.economicFinancialFit.score,
        proposalReadiness: matchResult.proposalFit.score,
        legalRisk: calculateLegalRisk(schemaV2),
        operationalEffort: calculateOperationalEffort(matchResult)
    };

    // Ponderação: doc 25%, técnica 30%, EF 15%, proposta 10%, risco jurídico 10%, esforço 10%
    const overallScore = Math.round(
        dims.documentaryReadiness * 0.25 +
        dims.technicalReadiness * 0.30 +
        dims.economicFinancialReadiness * 0.15 +
        dims.proposalReadiness * 0.10 +
        (100 - dims.legalRisk) * 0.10 +
        (100 - dims.operationalEffort) * 0.10
    );

    const rationale: string[] = [];
    let recommendation: ParticipationAssessment['recommendation'];

    // Decision logic
    if (matchResult.technicalFit.highRiskGaps.length > 0) {
        rationale.push(`⚠️ Lacunas técnicas de alto risco: ${matchResult.technicalFit.highRiskGaps.join(', ')}`);
    }
    if (matchResult.documentaryFit.missing.length > 3) {
        rationale.push(`📋 ${matchResult.documentaryFit.missing.length} documentos faltantes`);
    }
    if (matchResult.economicFinancialFit.missing.length > 0) {
        rationale.push(`💰 Pendências econômico-financeiras: ${matchResult.economicFinancialFit.missing.join(', ')}`);
    }
    if (dims.legalRisk > 60) {
        rationale.push(`⚖️ Risco jurídico elevado (${dims.legalRisk}%)`);
    }

    // Determine recommendation
    if (overallScore >= 80 && matchResult.technicalFit.highRiskGaps.length === 0) {
        recommendation = 'participar';
        rationale.push('✅ Empresa com boa aderência geral ao edital');
    } else if (overallScore >= 60) {
        recommendation = 'participar_com_ressalvas';
        rationale.push('⚠️ Empresa apta, mas com lacunas que demandam ação');
    } else if (overallScore >= 40 || matchResult.technicalFit.highRiskGaps.length > 2) {
        recommendation = 'revisao_humana_obrigatoria';
        rationale.push('🔍 Score insuficiente para decisão automatizada — revisão humana necessária');
    } else {
        recommendation = 'nao_participar';
        rationale.push('❌ Aderência insuficiente — risco alto de inabilitação ou desclassificação');
    }

    const assessment: ParticipationAssessment = {
        companyId: matchResult.companyId,
        processId: matchResult.processId,
        overallScore,
        dimensions: dims,
        recommendation,
        rationale,
        confidenceLevel: overallScore > 70 ? 'high' : overallScore > 45 ? 'medium' : 'low'
    };

    console.log(`[Score] ${matchResult.companyId}: ${overallScore}% → ${recommendation}`);
    return assessment;
}

// ── Action Plan ──

export function generateActionPlan(matchResult: CompanyEditalMatchResult, assessment: ParticipationAssessment, schemaV2: any): ParticipationActionPlan {
    const criticalPendingItems: ParticipationActionPlan['criticalPendingItems'] = [];
    const actionChecklist: ParticipationActionPlan['actionChecklist'] = [];
    const petitionSuggestions: string[] = [];
    const proposalWarnings: string[] = [];

    // Documentary gaps
    for (const doc of matchResult.documentaryFit.missing) {
        criticalPendingItems.push({
            item: `Documentar: ${doc}`,
            area: classifyDocArea(doc),
            urgency: 'high'
        });
        actionChecklist.push({ action: `Providenciar ${doc}`, ownerArea: classifyDocArea(doc) });
    }

    for (const doc of matchResult.documentaryFit.expired) {
        criticalPendingItems.push({
            item: `Renovar: ${doc}`,
            area: classifyDocArea(doc),
            urgency: 'critical'
        });
        actionChecklist.push({ action: `Renovar ${doc} (vencido)`, ownerArea: classifyDocArea(doc), deadlineHint: 'Antes da sessão' });
    }

    // Technical gaps
    for (const gap of matchResult.technicalFit.missing) {
        criticalPendingItems.push({
            item: `Acervo técnico: ${gap}`,
            area: 'engenharia',
            urgency: 'high'
        });
        actionChecklist.push({ action: `Verificar acervo técnico para: ${gap}`, ownerArea: 'engenharia' });
    }

    for (const gap of matchResult.technicalFit.highRiskGaps) {
        criticalPendingItems.push({
            item: `CRÍTICO — ${gap}`,
            area: 'engenharia',
            urgency: 'critical'
        });
    }

    // EF gaps
    for (const gap of matchResult.economicFinancialFit.missing) {
        criticalPendingItems.push({
            item: `Pendência contábil: ${gap}`,
            area: 'contabilidade',
            urgency: 'high'
        });
        actionChecklist.push({ action: `Resolver pendência: ${gap}`, ownerArea: 'contabilidade' });
    }

    // Proposal gaps
    for (const inp of matchResult.proposalFit.missingInputs) {
        actionChecklist.push({ action: `Preparar para proposta: ${inp}`, ownerArea: 'comercial' });
    }
    for (const risk of matchResult.proposalFit.risks) {
        proposalWarnings.push(risk);
    }

    // Legal risks → petition suggestions
    const rr = schemaV2?.legal_risk_review || {};
    if (rr.possible_restrictive_clauses?.length > 0) {
        petitionSuggestions.push(...rr.possible_restrictive_clauses.map((c: string) => `Considerar impugnação: ${c}`));
    }
    if (rr.ambiguities?.length > 0) {
        petitionSuggestions.push(...rr.ambiguities.map((a: string) => `Solicitar esclarecimento: ${a}`));
    }

    // Executive recommendation
    let execRec: string;
    switch (assessment.recommendation) {
        case 'participar':
            execRec = `✅ RECOMENDAÇÃO: PARTICIPAR — Score ${assessment.overallScore}%. A empresa possui boa aderência ao edital. ${criticalPendingItems.length > 0 ? `Há ${criticalPendingItems.length} itens pendentes que devem ser tratados.` : 'Nenhuma pendência crítica identificada.'}`;
            break;
        case 'participar_com_ressalvas':
            execRec = `⚠️ RECOMENDAÇÃO: PARTICIPAR COM RESSALVAS — Score ${assessment.overallScore}%. A empresa pode participar, mas ${criticalPendingItems.filter(i => i.urgency === 'critical').length} itens críticos devem ser resolvidos antes da sessão.`;
            break;
        case 'revisao_humana_obrigatoria':
            execRec = `🔍 RECOMENDAÇÃO: REVISÃO OBRIGATÓRIA — Score ${assessment.overallScore}%. Há lacunas significativas que exigem avaliação humana antes da decisão de participação.`;
            break;
        default:
            execRec = `❌ RECOMENDAÇÃO: NÃO PARTICIPAR — Score ${assessment.overallScore}%. A empresa apresenta risco alto de inabilitação/desclassificação neste certame.`;
    }

    const plan: ParticipationActionPlan = {
        companyId: matchResult.companyId,
        processId: matchResult.processId,
        executiveRecommendation: execRec,
        criticalPendingItems: criticalPendingItems.sort((a, b) => urgencyWeight(b.urgency) - urgencyWeight(a.urgency)),
        actionChecklist,
        petitionOrClarificationSuggestions: petitionSuggestions,
        proposalPreparationWarnings: proposalWarnings
    };

    console.log(`[ActionPlan] ${matchResult.companyId}: ${criticalPendingItems.length} pendências | ${actionChecklist.length} ações | ${assessment.recommendation}`);
    return plan;
}

// ── Helpers ──

function matchDocuments(profile: CompanyLicitationProfile | undefined, docs: DocumentRecord[], schemaV2: any): CompanyEditalMatchResult['documentaryFit'] {
    const matched: string[] = [];
    const missing: string[] = [];
    const expired: string[] = [];
    const uncertain: string[] = [];

    const reqs = schemaV2?.requirements || {};
    const reqCategories = [
        reqs.habilitacao_juridica,
        reqs.regularidade_fiscal_trabalhista,
        reqs.documentos_complementares
    ].flat().filter(Boolean);

    for (const req of reqCategories) {
        const reqTitle = (req.title || req.description || '').toLowerCase();
        const matchingDoc = docs.find(d =>
            d.name.toLowerCase().includes(reqTitle.substring(0, 20)) ||
            reqTitle.includes(d.name.toLowerCase().substring(0, 20))
        );

        if (matchingDoc) {
            if (matchingDoc.status === 'valid') matched.push(req.title || req.description);
            else if (matchingDoc.status === 'expired') expired.push(req.title || req.description);
            else uncertain.push(req.title || req.description);
        } else {
            missing.push(req.title || req.description);
        }
    }

    const total = matched.length + missing.length + expired.length + uncertain.length;
    const score = total > 0 ? Math.round((matched.length / total) * 100) : 0;

    return { matched, missing, expired, uncertain, score };
}

function matchTechnical(profile: CompanyLicitationProfile | undefined, schemaV2: any): CompanyEditalMatchResult['technicalFit'] {
    const matched: string[] = [];
    const missing: string[] = [];
    const partial: string[] = [];
    const highRiskGaps: string[] = [];

    const ta = schemaV2?.technical_analysis || {};
    const reqs = schemaV2?.requirements || {};

    // Check technical requirements
    const techReqs = [
        ...(reqs.qualificacao_tecnica_operacional || []),
        ...(reqs.qualificacao_tecnica_profissional || [])
    ];

    const attests = profile?.technicalAssets?.attests || [];
    const arts = profile?.technicalAssets?.artCatRrt || [];
    const capabilities = profile?.technicalAssets?.recurringCapabilities || [];

    for (const req of techReqs) {
        const reqDesc = (req.title || req.description || '').toLowerCase();
        const hasAttest = attests.some(a => a.toLowerCase().includes(reqDesc.substring(0, 15)));
        const hasCap = capabilities.some(c => c.toLowerCase().includes(reqDesc.substring(0, 15)));

        if (hasAttest || hasCap) {
            matched.push(req.title || req.description);
        } else {
            missing.push(req.title || req.description);
            if (req.mandatory) highRiskGaps.push(req.title || req.description);
        }
    }

    // RT check
    if (ta.exige_responsavel_tecnico && profile) {
        const hasActiveRT = profile.responsibleProfessionals.some(p => p.active);
        if (!hasActiveRT) highRiskGaps.push('Responsável técnico ativo não encontrado');
    }

    // CAT check
    if (ta.exige_cat && arts.length === 0) {
        highRiskGaps.push('CAT/ART exigida, nenhuma registrada na empresa');
    }

    const hasSufficientProfessionals = (profile?.responsibleProfessionals?.filter(p => p.active).length || 0) >= 1;
    const total = matched.length + missing.length + partial.length;
    const score = total > 0 ? Math.round((matched.length / total) * 100) : (techReqs.length === 0 ? 100 : 0);

    return { matched, missing, partial, highRiskGaps, hasSufficientProfessionals, score };
}

function matchEconomicFinancial(profile: CompanyLicitationProfile | undefined, docs: DocumentRecord[], schemaV2: any): CompanyEditalMatchResult['economicFinancialFit'] {
    const matched: string[] = [];
    const missing: string[] = [];
    const warnings: string[] = [];

    const ef = schemaV2?.economic_financial_analysis || {};
    const efReqs = schemaV2?.requirements?.qualificacao_economico_financeira || [];

    if (ef.indices_exigidos?.length > 0 && !profile?.readinessFlags.hasUpdatedBalance) {
        missing.push('Balanço atualizado (índices exigidos)');
        warnings.push('Edital exige índices econômicos, mas empresa sem balanço atualizado');
    } else if (ef.indices_exigidos?.length > 0) {
        matched.push('Balanço atualizado');
    }

    if (ef.patrimonio_liquido_minimo || ef.capital_social_minimo) {
        if (profile?.readinessFlags.hasUpdatedBalance) matched.push('PL/Capital Social documentável');
        else missing.push('Documentação de PL/Capital Social');
    }

    const efDocs = docs.filter(d => d.category === 'economico_financeira');
    for (const req of efReqs) {
        const reqTitle = (req.title || req.description || '').toLowerCase();
        const hasDoc = efDocs.some(d => d.name.toLowerCase().includes(reqTitle.substring(0, 15)));
        if (hasDoc) matched.push(req.title || req.description);
        else missing.push(req.title || req.description);
    }

    const total = matched.length + missing.length;
    const score = total > 0 ? Math.round((matched.length / total) * 100) : 100;

    return { matched, missing, warnings, score };
}

function matchProposal(profile: CompanyLicitationProfile | undefined, docs: DocumentRecord[], schemaV2: any): CompanyEditalMatchResult['proposalFit'] {
    const readyItems: string[] = [];
    const missingInputs: string[] = [];
    const risks: string[] = [];

    const pa = schemaV2?.proposal_analysis || {};

    if (pa.exige_planilha_orcamentaria) {
        if (profile?.readinessFlags.hasProposalTemplates) readyItems.push('Template de planilha');
        else missingInputs.push('Planilha orçamentária');
    }
    if (pa.exige_carta_proposta) {
        if (profile?.readinessFlags.hasProposalTemplates) readyItems.push('Template de carta');
        else missingInputs.push('Carta proposta');
    }
    if (pa.exige_catalogo_ficha_tecnica_manual) {
        const hasCat = docs.some(d => d.name.toLowerCase().includes('catálogo') || d.name.toLowerCase().includes('ficha técnica'));
        if (hasCat) readyItems.push('Catálogo/Ficha técnica');
        else missingInputs.push('Catálogo ou ficha técnica');
    }
    if (pa.exige_amostra) {
        missingInputs.push('Amostra (verificar viabilidade)');
        risks.push('Exigência de amostra — operacionalmente sensível');
    }
    if (pa.criterios_desclassificacao_proposta?.length > 0) {
        risks.push(...pa.criterios_desclassificacao_proposta.map((c: string) => `Risco de desclassificação: ${c}`));
    }

    const total = readyItems.length + missingInputs.length;
    const score = total > 0 ? Math.round((readyItems.length / total) * 100) : 100;

    return { readyItems, missingInputs, risks, score };
}

function generateStrategicNotes(profile: CompanyLicitationProfile | undefined, schemaV2: any): string[] {
    const notes: string[] = [];
    if (!profile) {
        notes.push('⚠️ Perfil da empresa não cadastrado — análise limitada');
        return notes;
    }

    const tipoObj = schemaV2?.process_identification?.tipo_objeto;
    if (tipoObj && profile.historicalPerformance) {
        const best = profile.historicalPerformance.bestSegments || [];
        const worst = profile.historicalPerformance.worstSegments || [];
        if (best.some(s => tipoObj.includes(s))) notes.push(`✅ Segmento ${tipoObj} é historicamente forte para esta empresa`);
        if (worst.some(s => tipoObj.includes(s))) notes.push(`⚠️ Segmento ${tipoObj} é historicamente fraco para esta empresa`);
    }

    if (profile.knownWeaknesses.length > 0) {
        notes.push(`Fragilidades conhecidas: ${profile.knownWeaknesses.join(', ')}`);
    }

    return notes;
}

function calculateLegalRisk(schemaV2: any): number {
    const rr = schemaV2?.legal_risk_review || {};
    let risk = 0;
    if ((rr.critical_points?.length || 0) > 0) risk += 20;
    if ((rr.possible_restrictive_clauses?.length || 0) > 0) risk += 15;
    if ((rr.inconsistencies?.length || 0) > 0) risk += 10;
    if ((rr.ambiguities?.length || 0) > 2) risk += 10;
    return Math.min(risk, 100);
}

function calculateOperationalEffort(match: CompanyEditalMatchResult): number {
    const totalMissing = match.documentaryFit.missing.length + match.technicalFit.missing.length +
        match.economicFinancialFit.missing.length + match.proposalFit.missingInputs.length;
    return Math.min(totalMissing * 8, 100); // 8 pontos por item faltante, max 100
}

function classifyDocArea(docName: string): string {
    const lower = (docName || '').toLowerCase();
    if (lower.includes('contrato social') || lower.includes('juridic') || lower.includes('procuração')) return 'jurídico';
    if (lower.includes('certidão') || lower.includes('fiscal') || lower.includes('cndt') || lower.includes('fgts')) return 'fiscal';
    if (lower.includes('balanço') || lower.includes('patrimônio') || lower.includes('capital')) return 'contabilidade';
    if (lower.includes('atestado') || lower.includes('cat') || lower.includes('art') || lower.includes('técnic')) return 'engenharia';
    if (lower.includes('proposta') || lower.includes('planilha') || lower.includes('catálogo')) return 'comercial';
    return 'licitações';
}

function urgencyWeight(urgency: string): number {
    return { critical: 4, high: 3, medium: 2, low: 1 }[urgency] || 0;
}
