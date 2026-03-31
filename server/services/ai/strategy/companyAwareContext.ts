/**
 * ══════════════════════════════════════════════════════════════════
 *  Company-Aware Module Context — Contexto Híbrido Edital + Empresa
 * ══════════════════════════════════════════════════════════════════
 *
 *  v2 — Refinos:
 *  - Token budget por módulo para evitar excesso
 *  - Recorte cirúrgico por módulo (só o que é decisivo)
 *  - Sem ruído: companySummary completo só para Chat
 *  - Oracle: acervo real com quantitativos
 *  - Proposal: insumos + riscos de desclassificação
 *  - Petition: relevância da tese frente à empresa
 */

import { buildModuleContext, ModuleName } from '../modules/moduleContextContracts';
import { buildCompanyContextSummary, getProfile, getCompanyDocuments } from '../company/companyProfileService';
import { matchCompanyToEdital, CompanyEditalMatchResult } from './participationEngine';

// Token budgets aproximados para bloco empresarial por módulo
const COMPANY_TOKEN_BUDGET: Record<ModuleName, number> = {
    chat: 1200,
    petition: 600,
    oracle: 800,
    dossier: 800,
    declaration: 400,
    proposal: 900
};

/**
 * Monta contexto híbrido: edital + empresa (recorte cirúrgico por módulo)
 */
export async function buildHybridContext(
    schemaV2: any,
    moduleName: ModuleName,
    companyId?: string,
    processId?: string
): Promise<{ context: string; matchResult?: CompanyEditalMatchResult }> {
    let context = buildModuleContext(schemaV2, moduleName);

    if (!companyId) return { context };
    const profile = await getProfile(companyId);
    if (!profile) return { context };

    const companySummary = await buildCompanyContextSummary(companyId);
    const matchResult = processId ? await matchCompanyToEdital(companyId, schemaV2, processId) : undefined;
    const companyBlock = await buildModuleCompanyBlock(moduleName, profile, companySummary, matchResult);

    if (companyBlock) {
        context += '\n\n' + truncateToTokenBudget(companyBlock, COMPANY_TOKEN_BUDGET[moduleName]);
    }

    return { context, matchResult };
}

async function buildModuleCompanyBlock(
    moduleName: ModuleName,
    profile: any,
    companySummary: string,
    matchResult?: CompanyEditalMatchResult
): Promise<string> {
    const s: string[] = [];

    switch (moduleName) {
        case 'chat':
            // Chat recebe contexto empresarial completo — é o módulo consultivo
            s.push('══ CONTEXTO DA EMPRESA ══');
            s.push(companySummary);
            if (matchResult) {
                s.push('\n══ ADERÊNCIA EMPRESA × EDITAL ══');
                s.push(`Documental: ${matchResult.documentaryFit.score}% (${matchResult.documentaryFit.matched.length} ok, ${matchResult.documentaryFit.missing.length} falta, ${matchResult.documentaryFit.expired.length} vencidos)`);
                s.push(`Técnica: ${matchResult.technicalFit.score}% (${matchResult.technicalFit.matched.length} ok, ${matchResult.technicalFit.missing.length} falta)`);
                s.push(`EF: ${matchResult.economicFinancialFit.score}% | Proposta: ${matchResult.proposalFit.score}%`);
                if (matchResult.hardBlocks.length > 0) s.push(`🔴 BLOQUEIOS: ${matchResult.hardBlocks.join('; ')}`);
                if (matchResult.technicalFit.highRiskGaps.length > 0) s.push(`⚠️ Lacunas técnicas críticas: ${matchResult.technicalFit.highRiskGaps.join('; ')}`);
                if (matchResult.documentaryFit.missing.length > 0) s.push(`Docs faltantes: ${matchResult.documentaryFit.missing.slice(0, 8).join(', ')}`);
                if (matchResult.strategicNotes.length > 0) s.push(matchResult.strategicNotes.join('\n'));
            }
            s.push('\nINSTRUÇÃO: Ao responder perguntas, considere a situação real da empresa. Responda se a empresa possui, falta, ou precisa providenciar. Seja específico.');
            break;

        case 'petition':
            // Petition: só o que é relevante para avaliar se a tese faz sentido
            s.push('══ SITUAÇÃO DA EMPRESA (para avaliação de relevância da tese) ══');
            if (matchResult?.technicalFit.highRiskGaps.length) {
                s.push(`Lacunas técnicas da empresa: ${matchResult.technicalFit.highRiskGaps.join('; ')}`);
            }
            if (matchResult?.documentaryFit.missing.length) {
                s.push(`Docs faltantes: ${matchResult.documentaryFit.missing.slice(0, 5).join(', ')}`);
            }
            // Fragilidades conhecidas
            if (profile.knownWeaknesses?.length > 0) {
                s.push(`Fragilidades conhecidas: ${profile.knownWeaknesses.join('; ')}`);
            }
            s.push('\nINSTRUÇÃO: Se a petição aborda exigência que a empresa NÃO atende, sinalize nas OBSERVAÇÕES que a tese, embora tecnicamente válida, pode ser estrategicamente contraproducente.');
            break;

        case 'oracle':
            // Oracle: acervo REAL da empresa com detalhes técnicos — NÃO o perfil completo
            s.push('══ ACERVO TÉCNICO REAL DA EMPRESA ══');
            const ta = profile.technicalAssets || {};
            if (ta.attests?.length > 0) s.push(`Atestados registrados (${ta.attests.length}): ${ta.attests.join('; ')}`);
            if (ta.artCatRrt?.length > 0) s.push(`ART/CAT/RRT (${ta.artCatRrt.length}): ${ta.artCatRrt.join('; ')}`);
            if (ta.certificates?.length > 0) s.push(`Certificados: ${ta.certificates.join('; ')}`);
            if (ta.recurringCapabilities?.length > 0) s.push(`Capacidades recorrentes: ${ta.recurringCapabilities.join('; ')}`);

            // RTs
            const activeRTs = (profile.responsibleProfessionals || []).filter((p: any) => p.active);
            if (activeRTs.length > 0) {
                s.push(`\nResponsáveis Técnicos Ativos (${activeRTs.length}):`);
                for (const rt of activeRTs) {
                    s.push(`  • ${rt.name} — ${rt.profession} (${rt.council} ${rt.registrationNumber || ''}) [${rt.role || 'técnico'}]`);
                }
            }

            // Conselhos
            const regs: string[] = [];
            if (profile.registrations?.crea) regs.push('CREA');
            if (profile.registrations?.cau) regs.push('CAU');
            if (regs.length) s.push(`Conselhos: ${regs.join(', ')}`);

            if (matchResult) {
                s.push('\n══ MATCHING TÉCNICO (pré-calculado) ══');
                s.push(`Matched: ${matchResult.technicalFit.matched.join('; ') || 'Nenhum'}`);
                s.push(`Parcial: ${matchResult.technicalFit.partial.join('; ') || 'Nenhum'}`);
                s.push(`Faltante: ${matchResult.technicalFit.missing.join('; ') || 'Nenhum'}`);
                if (matchResult.technicalFit.highRiskGaps.length > 0) s.push(`⚠️ Lacunas críticas: ${matchResult.technicalFit.highRiskGaps.join('; ')}`);
            }
            s.push('\nINSTRUÇÃO: Compare exigências com o acervo REAL acima. Não assuma capacidades não listadas. Seja rigoroso na aderência material.');
            break;

        case 'dossier':
            // Dossier: documentos existentes vs exigidos — sem dados irrelevantes
            s.push('══ DOCUMENTAÇÃO REAL DA EMPRESA ══');
            if (matchResult) {
                if (matchResult.documentaryFit.matched.length > 0) s.push(`✅ Presentes (${matchResult.documentaryFit.matched.length}): ${matchResult.documentaryFit.matched.join(', ')}`);
                if (matchResult.documentaryFit.expired.length > 0) s.push(`⏰ VENCIDOS (${matchResult.documentaryFit.expired.length}): ${matchResult.documentaryFit.expired.join(', ')}`);
                if (matchResult.documentaryFit.missing.length > 0) s.push(`❌ FALTANTES (${matchResult.documentaryFit.missing.length}): ${matchResult.documentaryFit.missing.join(', ')}`);
                if (matchResult.documentaryFit.uncertain.length > 0) s.push(`❓ Incertos (${matchResult.documentaryFit.uncertain.length}): ${matchResult.documentaryFit.uncertain.join(', ')}`);
            } else {
                // Sem match: resumo documental básico
                const docs = await getCompanyDocuments(profile.companyId);
                if (docs.length > 0) {
                    const valid = docs.filter((d: any) => d.status === 'valid').length;
                    const expired = docs.filter((d: any) => d.status === 'expired').length;
                    s.push(`Total: ${docs.length} | Válidos: ${valid} | Vencidos: ${expired}`);
                }
            }
            s.push('\nINSTRUÇÃO: Organize o dossiê priorizando documentos VENCIDOS (renovar) e FALTANTES (providenciar). Marque como crítico o que pode causar inabilitação.');
            break;

        case 'declaration':
            // Declaration: apenas dados cadastrais para preenchimento — mínimo possível
            s.push('══ DADOS CADASTRAIS ══');
            const cd = profile.corporateData || {};
            s.push(`Razão Social: ${cd.legalName || 'N/A'}`);
            s.push(`CNPJ: ${cd.cnpj || 'N/A'}`);
            if (cd.tradeName) s.push(`Nome Fantasia: ${cd.tradeName}`);
            if (cd.companyType) s.push(`Porte: ${cd.companyType}`);
            if (cd.headquarters) s.push(`Sede: ${cd.headquarters}`);
            break;

        case 'proposal':
            // Proposal: insumos existentes, riscos de desclassificação e prontidão
            s.push('══ PRONTIDÃO PARA PROPOSTA ══');
            s.push(`Templates prontos: ${profile.readinessFlags?.hasProposalTemplates ? 'SIM' : 'NÃO'}`);
            s.push(`Balanço atualizado: ${profile.readinessFlags?.hasUpdatedBalance ? 'SIM' : 'NÃO'}`);

            if (matchResult) {
                if (matchResult.proposalFit.readyItems.length > 0) s.push(`\n✅ Itens prontos: ${matchResult.proposalFit.readyItems.join(', ')}`);
                if (matchResult.proposalFit.missingInputs.length > 0) s.push(`❌ Itens faltantes: ${matchResult.proposalFit.missingInputs.join(', ')}`);
                if (matchResult.proposalFit.risks.length > 0) {
                    s.push(`\n⚠️ RISCOS DE DESCLASSIFICAÇÃO:`);
                    for (const r of matchResult.proposalFit.risks) s.push(`  • ${r}`);
                }
                if (matchResult.economicFinancialFit.warnings.length > 0) {
                    s.push(`\n💰 ALERTAS EF: ${matchResult.economicFinancialFit.warnings.join('; ')}`);
                }
            }
            s.push('\nINSTRUÇÃO: Organize os insumos priorizando itens eliminatórios. Destaque riscos de desclassificação e critérios de exequibilidade.');
            break;
    }

    return s.join('\n');
}

function truncateToTokenBudget(text: string, maxTokens: number): string {
    // Aproximação: 1 token ≈ 4 chars em português
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return text;
    return text.substring(0, maxChars) + '\n[... contexto truncado por limite de tokens ...]';
}
