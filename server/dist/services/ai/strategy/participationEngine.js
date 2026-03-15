"use strict";
/**
 * ══════════════════════════════════════════════════════════════════
 *  Company × Edital Matching Engine + Strategic Score + Action Plan
 * ══════════════════════════════════════════════════════════════════
 *
 *  v2 — Refino de calibração:
 *  - Pesos revisados com dominância técnica/documental
 *  - Hard-blocks: lacunas que forçam revisão independentemente do score
 *  - Thresholds endurecidos para módulos críticos
 *  - Rationale auditável campo a campo
 *  - Coerência: lacunas críticas nunca geram "participar"
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchCompanyToEdital = matchCompanyToEdital;
exports.calculateParticipationScore = calculateParticipationScore;
exports.generateActionPlan = generateActionPlan;
const companyProfileService_1 = require("../company/companyProfileService");
// ── Pesos Auditáveis ──
const DIMENSION_WEIGHTS = {
    documentaryReadiness: 0.25,
    technicalReadiness: 0.30,
    economicFinancialReadiness: 0.15,
    proposalReadiness: 0.10,
    legalRiskInverse: 0.10, // (100 - risco)
    operationalEffortInverse: 0.10 // (100 - esforço)
};
const DECISION_THRESHOLDS = {
    participar: { minScore: 80, maxHighRiskGaps: 0, maxExpired: 1, maxCriticalEFMissing: 0 },
    ressalvas: { minScore: 60, maxHighRiskGaps: 1, maxExpired: 3 },
    revisao: { minScore: 40 },
    naoParticipar: { below: 40 }
};
// ── Matching Engine ──
function matchCompanyToEdital(companyId, schemaV2, processId) {
    const profile = (0, companyProfileService_1.getProfile)(companyId);
    const docs = (0, companyProfileService_1.getCompanyDocuments)(companyId);
    const documentaryFit = matchDocuments(profile, docs, schemaV2);
    const technicalFit = matchTechnical(profile, schemaV2);
    const economicFinancialFit = matchEconomicFinancial(profile, docs, schemaV2);
    const proposalFit = matchProposal(profile, docs, schemaV2);
    const strategicNotes = generateStrategicNotes(profile, schemaV2);
    // Hard blocks — condições que forçam "revisão humana" independente do score
    const hardBlocks = [];
    if (technicalFit.highRiskGaps.length >= 2)
        hardBlocks.push(`${technicalFit.highRiskGaps.length} lacunas técnicas críticas`);
    if (!technicalFit.hasSufficientProfessionals && schemaV2?.technical_analysis?.exige_responsavel_tecnico)
        hardBlocks.push('RT ativo obrigatório não encontrado');
    if (documentaryFit.expired.length >= 3)
        hardBlocks.push(`${documentaryFit.expired.length} documentos vencidos`);
    if (economicFinancialFit.missing.length >= 2)
        hardBlocks.push(`${economicFinancialFit.missing.length} pendências econômico-financeiras`);
    if (documentaryFit.missing.length >= 5)
        hardBlocks.push(`${documentaryFit.missing.length} documentos faltantes — risco alto de inabilitação`);
    const result = {
        companyId, processId,
        matchedAt: new Date().toISOString(),
        documentaryFit, technicalFit, economicFinancialFit, proposalFit,
        strategicNotes, hardBlocks
    };
    console.log(`[Matching] ${companyId} × ${processId}: Doc=${documentaryFit.score}% Tech=${technicalFit.score}% EF=${economicFinancialFit.score}% Prop=${proposalFit.score}% HardBlocks=${hardBlocks.length}`);
    return result;
}
// ── Score Engine (v2 — com hard-blocks e auditoria) ──
function calculateParticipationScore(matchResult, schemaV2) {
    const dims = {
        documentaryReadiness: matchResult.documentaryFit.score,
        technicalReadiness: matchResult.technicalFit.score,
        economicFinancialReadiness: matchResult.economicFinancialFit.score,
        proposalReadiness: matchResult.proposalFit.score,
        legalRisk: calculateLegalRisk(schemaV2),
        operationalEffort: calculateOperationalEffort(matchResult)
    };
    const overallScore = Math.round(dims.documentaryReadiness * DIMENSION_WEIGHTS.documentaryReadiness +
        dims.technicalReadiness * DIMENSION_WEIGHTS.technicalReadiness +
        dims.economicFinancialReadiness * DIMENSION_WEIGHTS.economicFinancialReadiness +
        dims.proposalReadiness * DIMENSION_WEIGHTS.proposalReadiness +
        (100 - dims.legalRisk) * DIMENSION_WEIGHTS.legalRiskInverse +
        (100 - dims.operationalEffort) * DIMENSION_WEIGHTS.operationalEffortInverse);
    const rationale = [];
    let recommendation;
    let decisionPath;
    // Rationale detalhado por dimensão
    rationale.push(`📊 Score geral: ${overallScore}% (Doc ${dims.documentaryReadiness}% | Tec ${dims.technicalReadiness}% | EF ${dims.economicFinancialReadiness}% | Prop ${dims.proposalReadiness}% | Risco ${dims.legalRisk}% | Esforço ${dims.operationalEffort}%)`);
    if (matchResult.technicalFit.highRiskGaps.length > 0) {
        rationale.push(`⚠️ LACUNAS TÉCNICAS CRÍTICAS: ${matchResult.technicalFit.highRiskGaps.join('; ')}`);
    }
    if (matchResult.documentaryFit.missing.length > 0) {
        rationale.push(`📋 ${matchResult.documentaryFit.missing.length} documentos faltantes: ${matchResult.documentaryFit.missing.slice(0, 5).join(', ')}${matchResult.documentaryFit.missing.length > 5 ? '...' : ''}`);
    }
    if (matchResult.documentaryFit.expired.length > 0) {
        rationale.push(`⏰ ${matchResult.documentaryFit.expired.length} documentos vencidos: ${matchResult.documentaryFit.expired.join(', ')}`);
    }
    if (matchResult.economicFinancialFit.missing.length > 0) {
        rationale.push(`💰 Pendências EF: ${matchResult.economicFinancialFit.missing.join(', ')}`);
    }
    if (matchResult.economicFinancialFit.warnings.length > 0) {
        rationale.push(`⚠️ Alertas EF: ${matchResult.economicFinancialFit.warnings.join(', ')}`);
    }
    if (dims.legalRisk > 40) {
        rationale.push(`⚖️ Risco jurídico elevado (${dims.legalRisk}%)`);
    }
    if (matchResult.proposalFit.risks.length > 0) {
        rationale.push(`📦 Riscos proposta: ${matchResult.proposalFit.risks.slice(0, 3).join('; ')}`);
    }
    // ── DECISÃO com hard-blocks ──
    // 1. Hard-blocks forçam revisão humana INDEPENDENTE do score
    if (matchResult.hardBlocks.length > 0) {
        if (overallScore < DECISION_THRESHOLDS.naoParticipar.below && matchResult.hardBlocks.length >= 2) {
            recommendation = 'nao_participar';
            decisionPath = 'HARD_BLOCK + SCORE_MUITO_BAIXO';
            rationale.push(`❌ ${matchResult.hardBlocks.length} bloqueios críticos + score ${overallScore}% — risco inaceitável`);
        }
        else {
            recommendation = 'revisao_humana_obrigatoria';
            decisionPath = 'HARD_BLOCK';
            rationale.push(`🔍 ${matchResult.hardBlocks.length} bloqueio(s) crítico(s): ${matchResult.hardBlocks.join('; ')}`);
        }
    }
    // 2. Score >= 80 + sem lacunas críticas = participar
    else if (overallScore >= DECISION_THRESHOLDS.participar.minScore &&
        matchResult.technicalFit.highRiskGaps.length <= DECISION_THRESHOLDS.participar.maxHighRiskGaps &&
        matchResult.documentaryFit.expired.length <= DECISION_THRESHOLDS.participar.maxExpired &&
        matchResult.economicFinancialFit.missing.length <= DECISION_THRESHOLDS.participar.maxCriticalEFMissing) {
        recommendation = 'participar';
        decisionPath = 'SCORE_ALTO_SEM_LACUNAS';
        rationale.push('✅ Empresa com boa aderência geral — sem lacunas críticas');
    }
    // 3. Score >= 60 com lacunas controláveis = com ressalvas
    else if (overallScore >= DECISION_THRESHOLDS.ressalvas.minScore &&
        matchResult.technicalFit.highRiskGaps.length <= DECISION_THRESHOLDS.ressalvas.maxHighRiskGaps) {
        recommendation = 'participar_com_ressalvas';
        decisionPath = 'SCORE_MEDIO_COM_LACUNAS_CONTROLAVEIS';
        rationale.push('⚠️ Empresa apta, mas com lacunas que demandam ação antes da sessão');
    }
    // 4. Score >= 40 = revisão humana
    else if (overallScore >= DECISION_THRESHOLDS.revisao.minScore) {
        recommendation = 'revisao_humana_obrigatoria';
        decisionPath = 'SCORE_INSUFICIENTE_PARA_DECISAO_AUTO';
        rationale.push('🔍 Score insuficiente para decisão automatizada — revisar com equipe');
    }
    // 5. Score < 40 = não participar
    else {
        recommendation = 'nao_participar';
        decisionPath = 'SCORE_ABAIXO_MINIMO';
        rationale.push('❌ Aderência insuficiente — risco alto de inabilitação/desclassificação');
    }
    // Strategic notes
    for (const note of matchResult.strategicNotes) {
        rationale.push(note);
    }
    const assessment = {
        companyId: matchResult.companyId,
        processId: matchResult.processId,
        overallScore,
        dimensions: dims,
        recommendation,
        rationale,
        confidenceLevel: overallScore > 75 ? 'high' : overallScore > 50 ? 'medium' : 'low',
        auditTrail: {
            weights: { ...DIMENSION_WEIGHTS },
            thresholds: { participar: 80, ressalvas: 60, revisao: 40, naoParticipar: 40 },
            hardBlocksTriggered: matchResult.hardBlocks,
            decisionPath
        }
    };
    console.log(`[Score] ${matchResult.companyId}: ${overallScore}% → ${recommendation} (path: ${decisionPath})`);
    return assessment;
}
// ── Action Plan (v2 — com impact, priority, risk summary) ──
function generateActionPlan(matchResult, assessment, schemaV2) {
    const criticalPendingItems = [];
    const actionChecklist = [];
    const petitionSuggestions = [];
    const proposalWarnings = [];
    const disqualificationRisks = [];
    let priority = 1;
    // Documentary gaps
    for (const doc of matchResult.documentaryFit.expired) {
        criticalPendingItems.push({
            item: `Renovar: ${doc}`,
            area: classifyDocArea(doc),
            urgency: 'critical',
            impact: 'Documento vencido = inabilitação automática'
        });
        actionChecklist.push({ action: `Renovar ${doc} (VENCIDO)`, ownerArea: classifyDocArea(doc), deadlineHint: 'Antes da sessão', priority: priority++ });
        disqualificationRisks.push(`Documento vencido: ${doc}`);
    }
    for (const doc of matchResult.documentaryFit.missing) {
        criticalPendingItems.push({
            item: `Providenciar: ${doc}`,
            area: classifyDocArea(doc),
            urgency: 'high',
            impact: 'Ausência pode causar inabilitação'
        });
        actionChecklist.push({ action: `Providenciar ${doc}`, ownerArea: classifyDocArea(doc), priority: priority++ });
    }
    // Technical gaps
    for (const gap of matchResult.technicalFit.highRiskGaps) {
        criticalPendingItems.push({
            item: `CRÍTICO — ${gap}`,
            area: 'engenharia',
            urgency: 'critical',
            impact: 'Lacuna técnica obrigatória — inabilitação provável'
        });
        disqualificationRisks.push(`Lacuna técnica: ${gap}`);
        actionChecklist.push({ action: `RESOLVER: ${gap}`, ownerArea: 'engenharia', deadlineHint: 'Antes da sessão', priority: priority++ });
    }
    for (const gap of matchResult.technicalFit.missing) {
        if (!matchResult.technicalFit.highRiskGaps.includes(gap)) {
            criticalPendingItems.push({
                item: `Acervo técnico: ${gap}`,
                area: 'engenharia',
                urgency: 'high',
                impact: 'Pode causar inabilitação técnica'
            });
            actionChecklist.push({ action: `Verificar acervo para: ${gap}`, ownerArea: 'engenharia', priority: priority++ });
        }
    }
    // EF gaps
    for (const gap of matchResult.economicFinancialFit.missing) {
        criticalPendingItems.push({
            item: `Pendência contábil: ${gap}`,
            area: 'contabilidade',
            urgency: 'high',
            impact: 'Pode causar inabilitação econômico-financeira'
        });
        actionChecklist.push({ action: `Resolver: ${gap}`, ownerArea: 'contabilidade', priority: priority++ });
    }
    for (const w of matchResult.economicFinancialFit.warnings) {
        proposalWarnings.push(`⚠️ ${w}`);
    }
    // Proposal gaps
    for (const inp of matchResult.proposalFit.missingInputs) {
        actionChecklist.push({ action: `Preparar: ${inp}`, ownerArea: 'comercial', priority: priority++ });
    }
    for (const risk of matchResult.proposalFit.risks) {
        proposalWarnings.push(risk);
        if (risk.toLowerCase().includes('desclassifica'))
            disqualificationRisks.push(risk);
    }
    // Legal risks → petition suggestions
    const rr = schemaV2?.legal_risk_review || {};
    if (rr.possible_restrictive_clauses?.length > 0) {
        petitionSuggestions.push(...rr.possible_restrictive_clauses.map((c) => `Considerar impugnação: ${c}`));
    }
    if (rr.ambiguities?.length > 0) {
        petitionSuggestions.push(...rr.ambiguities.map((a) => `Solicitar esclarecimento: ${a}`));
    }
    // Risk summary
    const criticalCount = criticalPendingItems.filter(i => i.urgency === 'critical').length;
    const highCount = criticalPendingItems.filter(i => i.urgency === 'high').length;
    const riskSummary = `${criticalCount} itens CRÍTICOS | ${highCount} itens ALTOS | ${disqualificationRisks.length} riscos de desclassificação/inabilitação`;
    // Executive recommendation
    let execRec;
    switch (assessment.recommendation) {
        case 'participar':
            execRec = `✅ RECOMENDAÇÃO: PARTICIPAR — Score ${assessment.overallScore}%. A empresa possui boa aderência ao edital. ${criticalPendingItems.length > 0 ? `Atenção: ${criticalPendingItems.length} ações pendentes.` : 'Nenhuma pendência crítica.'}`;
            break;
        case 'participar_com_ressalvas':
            execRec = `⚠️ RECOMENDAÇÃO: PARTICIPAR COM RESSALVAS — Score ${assessment.overallScore}%. Há ${criticalCount} itens críticos e ${highCount} itens de alta prioridade a resolver ANTES da sessão. O plano de ação abaixo detalha cada pendência.`;
            break;
        case 'revisao_humana_obrigatoria':
            execRec = `🔍 RECOMENDAÇÃO: REVISÃO OBRIGATÓRIA — Score ${assessment.overallScore}%. ${matchResult.hardBlocks.length > 0 ? `BLOQUEIOS: ${matchResult.hardBlocks.join('; ')}. ` : ''}Há lacunas significativas que impedem decisão automatizada.`;
            break;
        default:
            execRec = `❌ RECOMENDAÇÃO: NÃO PARTICIPAR — Score ${assessment.overallScore}%. A empresa apresenta ${disqualificationRisks.length} riscos de inabilitação/desclassificação. Esforço de adequação desproporcional ao prazo disponível.`;
    }
    const plan = {
        companyId: matchResult.companyId,
        processId: matchResult.processId,
        executiveRecommendation: execRec,
        riskSummary,
        criticalPendingItems: criticalPendingItems.sort((a, b) => urgencyWeight(b.urgency) - urgencyWeight(a.urgency)),
        actionChecklist: actionChecklist.sort((a, b) => a.priority - b.priority),
        petitionOrClarificationSuggestions: petitionSuggestions,
        proposalPreparationWarnings: proposalWarnings,
        disqualificationRisks
    };
    console.log(`[ActionPlan] ${matchResult.companyId}: ${criticalPendingItems.length} pendências | ${disqualificationRisks.length} riscos desclass. | ${assessment.recommendation}`);
    return plan;
}
// ── Helpers ──
function matchDocuments(profile, docs, schemaV2) {
    const matched = [];
    const missing = [];
    const expired = [];
    const uncertain = [];
    const reqs = schemaV2?.requirements || {};
    const reqCategories = [
        reqs.habilitacao_juridica,
        reqs.regularidade_fiscal_trabalhista,
        reqs.documentos_complementares
    ].flat().filter(Boolean);
    for (const req of reqCategories) {
        const reqTitle = (req.title || req.description || '').toLowerCase();
        const matchingDoc = docs.find(d => d.name.toLowerCase().includes(reqTitle.substring(0, 20)) ||
            reqTitle.includes(d.name.toLowerCase().substring(0, 20)));
        if (matchingDoc) {
            if (matchingDoc.status === 'valid')
                matched.push(req.title || req.description);
            else if (matchingDoc.status === 'expired')
                expired.push(req.title || req.description);
            else
                uncertain.push(req.title || req.description);
        }
        else {
            missing.push(req.title || req.description);
        }
    }
    const total = matched.length + missing.length + expired.length + uncertain.length;
    // Expired conta como negativo, uncertain conta parcial
    const effectiveScore = total > 0 ? Math.round(((matched.length + uncertain.length * 0.5) / total) * 100) : 0;
    return { matched, missing, expired, uncertain, score: effectiveScore };
}
function matchTechnical(profile, schemaV2) {
    const matched = [];
    const missing = [];
    const partial = [];
    const highRiskGaps = [];
    const ta = schemaV2?.technical_analysis || {};
    const reqs = schemaV2?.requirements || {};
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
        const hasArt = arts.some(a => a.toLowerCase().includes(reqDesc.substring(0, 15)));
        if (hasAttest && (hasArt || !ta.exige_cat)) {
            matched.push(req.title || req.description);
        }
        else if (hasAttest || hasCap) {
            partial.push(req.title || req.description);
        }
        else {
            missing.push(req.title || req.description);
            if (req.mandatory !== false)
                highRiskGaps.push(req.title || req.description);
        }
    }
    // RT check
    if (ta.exige_responsavel_tecnico && profile) {
        const hasActiveRT = profile.responsibleProfessionals.some(p => p.active);
        if (!hasActiveRT)
            highRiskGaps.push('Responsável técnico ativo não encontrado');
    }
    // CAT + conselho check
    if (ta.exige_cat && arts.length === 0) {
        highRiskGaps.push('CAT/ART exigida — nenhuma registrada na empresa');
    }
    const hasSufficientProfessionals = (profile?.responsibleProfessionals?.filter(p => p.active).length || 0) >= 1;
    const total = matched.length + missing.length + partial.length;
    // Partial conta como 0.5
    const effectiveScore = total > 0 ? Math.round(((matched.length + partial.length * 0.5) / total) * 100) : (techReqs.length === 0 ? 100 : 0);
    return { matched, missing, partial, highRiskGaps, hasSufficientProfessionals, score: effectiveScore };
}
function matchEconomicFinancial(profile, docs, schemaV2) {
    const matched = [];
    const missing = [];
    const warnings = [];
    const ef = schemaV2?.economic_financial_analysis || {};
    const efReqs = schemaV2?.requirements?.qualificacao_economico_financeira || [];
    if (ef.indices_exigidos?.length > 0) {
        if (!profile?.readinessFlags.hasUpdatedBalance) {
            missing.push('Balanço atualizado (índices exigidos)');
            warnings.push('Edital exige índices econômicos, mas empresa sem balanço atualizado — INABILITAÇÃO PROVÁVEL');
        }
        else {
            matched.push('Balanço atualizado');
        }
    }
    if (ef.patrimonio_liquido_minimo || ef.capital_social_minimo) {
        if (profile?.readinessFlags.hasUpdatedBalance)
            matched.push('PL/Capital Social documentável');
        else {
            missing.push('Documentação de PL/Capital Social');
            warnings.push('PL/Capital Social exigido mas sem balanço para comprovação');
        }
    }
    // Certidão de falência/recuperação
    if (ef.exige_certidao_negativa_falencia) {
        const hasCert = docs.some(d => d.name.toLowerCase().includes('falência') || d.name.toLowerCase().includes('recuperação'));
        if (hasCert)
            matched.push('Certidão negativa falência/recuperação');
        else
            missing.push('Certidão negativa falência/recuperação');
    }
    const efDocs = docs.filter(d => d.category === 'economico_financeira');
    for (const req of efReqs) {
        const reqTitle = (req.title || req.description || '').toLowerCase();
        const hasDoc = efDocs.some(d => d.name.toLowerCase().includes(reqTitle.substring(0, 15)));
        if (hasDoc)
            matched.push(req.title || req.description);
        else
            missing.push(req.title || req.description);
    }
    const total = matched.length + missing.length;
    const score = total > 0 ? Math.round((matched.length / total) * 100) : 100;
    return { matched, missing, warnings, score };
}
function matchProposal(profile, docs, schemaV2) {
    const readyItems = [];
    const missingInputs = [];
    const risks = [];
    const pa = schemaV2?.proposal_analysis || {};
    // Requisitos obrigatórios
    if (pa.exige_planilha_orcamentaria) {
        if (profile?.readinessFlags.hasProposalTemplates)
            readyItems.push('Template de planilha');
        else
            missingInputs.push('Planilha orçamentária (OBRIGATÓRIO)');
    }
    if (pa.exige_carta_proposta) {
        if (profile?.readinessFlags.hasProposalTemplates)
            readyItems.push('Template de carta');
        else
            missingInputs.push('Carta proposta (OBRIGATÓRIO)');
    }
    if (pa.exige_composicao_bdi) {
        missingInputs.push('Composição do BDI (verificar modelo do edital)');
    }
    if (pa.exige_cronograma) {
        missingInputs.push('Cronograma físico-financeiro');
    }
    // Anexos técnicos
    if (pa.exige_catalogo_ficha_tecnica_manual) {
        const hasCat = docs.some(d => d.name.toLowerCase().includes('catálogo') || d.name.toLowerCase().includes('ficha técnica') || d.name.toLowerCase().includes('manual'));
        if (hasCat)
            readyItems.push('Catálogo/Ficha técnica');
        else {
            missingInputs.push('Catálogo, ficha técnica ou manual (OBRIGATÓRIO)');
            risks.push('Risco de desclassificação: ausência de catálogo/ficha técnica obrigatória');
        }
    }
    if (pa.exige_marca_modelo_fabricante) {
        missingInputs.push('Definição de marca/modelo/fabricante');
    }
    if (pa.exige_amostra) {
        missingInputs.push('Amostra (verificar viabilidade operacional e prazo)');
        risks.push('Exigência de amostra — operacionalmente sensível, verificar prazo e logística');
    }
    if (pa.exige_declaracao_fabricante) {
        missingInputs.push('Declaração do fabricante/distribuidor');
    }
    // Riscos de desclassificação
    if (pa.criterios_desclassificacao_proposta?.length > 0) {
        risks.push(...pa.criterios_desclassificacao_proposta.map((c) => `⚠️ Risco de desclassificação: ${c}`));
    }
    if (pa.criterios_exequibilidade?.length > 0) {
        risks.push(...pa.criterios_exequibilidade.map((c) => `📐 Exequibilidade: ${c}`));
    }
    const total = readyItems.length + missingInputs.length;
    const score = total > 0 ? Math.round((readyItems.length / total) * 100) : 100;
    return { readyItems, missingInputs, risks, score };
}
function generateStrategicNotes(profile, schemaV2) {
    const notes = [];
    if (!profile) {
        notes.push('⚠️ Perfil da empresa não cadastrado — análise limitada a dados genéricos');
        return notes;
    }
    const tipoObj = schemaV2?.process_identification?.tipo_objeto;
    if (tipoObj && profile.historicalPerformance) {
        const best = profile.historicalPerformance.bestSegments || [];
        const worst = profile.historicalPerformance.worstSegments || [];
        if (best.some(s => tipoObj.toLowerCase().includes(s.toLowerCase())))
            notes.push(`✅ Segmento ${tipoObj} é historicamente FORTE para esta empresa (${profile.historicalPerformance.wins}/${profile.historicalPerformance.totalParticipations} vitórias no segmento)`);
        if (worst.some(s => tipoObj.toLowerCase().includes(s.toLowerCase())))
            notes.push(`⚠️ Segmento ${tipoObj} é historicamente FRACO para esta empresa — considerar custo-benefício`);
    }
    if (profile.knownWeaknesses.length > 0) {
        notes.push(`🔴 Fragilidades recorrentes: ${profile.knownWeaknesses.join('; ')}`);
    }
    if (profile.strengths.length > 0) {
        notes.push(`✅ Pontos fortes: ${profile.strengths.join('; ')}`);
    }
    // Porte
    const porte = profile.corporateData.companyType;
    const pc = schemaV2?.participation_conditions || {};
    if (porte && (porte === 'MEI' || porte === 'ME' || porte === 'EPP') && pc.tratamento_me_epp) {
        notes.push(`📌 Empresa ${porte} — tratamento diferenciado: ${pc.tratamento_me_epp}`);
    }
    return notes;
}
function calculateLegalRisk(schemaV2) {
    const rr = schemaV2?.legal_risk_review || {};
    let risk = 0;
    const critCount = rr.critical_points?.length || 0;
    const restrictCount = rr.possible_restrictive_clauses?.length || 0;
    const inconsistCount = rr.inconsistencies?.length || 0;
    const ambigCount = rr.ambiguities?.length || 0;
    risk += Math.min(critCount * 12, 36);
    risk += Math.min(restrictCount * 10, 30);
    risk += Math.min(inconsistCount * 8, 16);
    risk += Math.min(ambigCount * 4, 12);
    return Math.min(risk, 100);
}
function calculateOperationalEffort(match) {
    const missingDocs = match.documentaryFit.missing.length;
    const expiredDocs = match.documentaryFit.expired.length;
    const missingTech = match.technicalFit.missing.length;
    const missingEF = match.economicFinancialFit.missing.length;
    const missingProp = match.proposalFit.missingInputs.length;
    // Pesos diferenciados por impacto
    const effort = (expiredDocs * 12) + (missingDocs * 8) + (missingTech * 10) + (missingEF * 10) + (missingProp * 5);
    return Math.min(effort, 100);
}
function classifyDocArea(docName) {
    const lower = (docName || '').toLowerCase();
    if (lower.includes('contrato social') || lower.includes('juridic') || lower.includes('procuração') || lower.includes('estatuto'))
        return 'jurídico';
    if (lower.includes('certidão') || lower.includes('fiscal') || lower.includes('cndt') || lower.includes('fgts') || lower.includes('inss') || lower.includes('tribut'))
        return 'fiscal';
    if (lower.includes('balanço') || lower.includes('patrimônio') || lower.includes('capital') || lower.includes('índice') || lower.includes('falência'))
        return 'contabilidade';
    if (lower.includes('atestado') || lower.includes('cat') || lower.includes('art') || lower.includes('técnic') || lower.includes('crea') || lower.includes('rrt'))
        return 'engenharia';
    if (lower.includes('proposta') || lower.includes('planilha') || lower.includes('catálogo') || lower.includes('ficha') || lower.includes('bdi') || lower.includes('cronograma'))
        return 'comercial';
    if (lower.includes('declaração') || lower.includes('trabalhist'))
        return 'rh_compliance';
    return 'licitações';
}
function urgencyWeight(urgency) {
    return { critical: 4, high: 3, medium: 2, low: 1 }[urgency] || 0;
}
