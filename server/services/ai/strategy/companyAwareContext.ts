/**
 * ══════════════════════════════════════════════════════════════════
 *  Company-Aware Module Context — Contexto Híbrido Edital + Empresa
 * ══════════════════════════════════════════════════════════════════
 *
 *  Expande buildModuleContext para incluir contexto empresarial
 *  quando um companyId é fornecido.
 */

import { buildModuleContext, ModuleName } from '../modules/moduleContextContracts';
import { buildCompanyContextSummary, getProfile, getCompanyDocuments } from '../company/companyProfileService';
import { matchCompanyToEdital, CompanyEditalMatchResult } from './participationEngine';

/**
 * Monta contexto híbrido: edital + empresa
 */
export function buildHybridContext(
    schemaV2: any,
    moduleName: ModuleName,
    companyId?: string,
    processId?: string
): { context: string; matchResult?: CompanyEditalMatchResult } {
    // 1. Contexto base do edital
    let context = buildModuleContext(schemaV2, moduleName);

    // Se não tem empresa, retorna só edital
    if (!companyId) return { context };

    const profile = getProfile(companyId);
    if (!profile) return { context };

    // 2. Contexto empresarial geral
    const companySummary = buildCompanyContextSummary(companyId);

    // 3. Matching específico por módulo
    const matchResult = processId
        ? matchCompanyToEdital(companyId, schemaV2, processId)
        : undefined;

    // 4. Construir bloco de contexto empresarial por módulo
    const companyBlock = buildModuleCompanyBlock(moduleName, companySummary, matchResult);

    if (companyBlock) {
        context += '\n\n' + companyBlock;
    }

    return { context, matchResult };
}

function buildModuleCompanyBlock(
    moduleName: ModuleName,
    companySummary: string,
    matchResult?: CompanyEditalMatchResult
): string {
    const sections: string[] = [];

    switch (moduleName) {
        case 'chat':
            sections.push('══ CONTEXTO DA EMPRESA ══');
            sections.push(companySummary);
            if (matchResult) {
                sections.push(`\n══ ADERÊNCIA EMPRESA × EDITAL ══`);
                sections.push(`Documental: ${matchResult.documentaryFit.score}% | Técnica: ${matchResult.technicalFit.score}% | EF: ${matchResult.economicFinancialFit.score}%`);
                if (matchResult.documentaryFit.missing.length > 0) {
                    sections.push(`Docs faltantes: ${matchResult.documentaryFit.missing.join(', ')}`);
                }
                if (matchResult.technicalFit.highRiskGaps.length > 0) {
                    sections.push(`⚠️ Lacunas técnicas críticas: ${matchResult.technicalFit.highRiskGaps.join(', ')}`);
                }
                if (matchResult.strategicNotes.length > 0) {
                    sections.push(matchResult.strategicNotes.join('\n'));
                }
            }
            break;

        case 'petition':
            // Petition precisa saber se a tese é relevante para a empresa
            if (matchResult) {
                sections.push('══ SITUAÇÃO DA EMPRESA ══');
                if (matchResult.technicalFit.highRiskGaps.length > 0) {
                    sections.push(`Lacunas técnicas da empresa: ${matchResult.technicalFit.highRiskGaps.join(', ')}`);
                    sections.push('NOTA: Considerar se a petição aborda exigência que a empresa NÃO atende.');
                }
                if (matchResult.strategicNotes.length > 0) {
                    sections.push(matchResult.strategicNotes.join('\n'));
                }
            }
            break;

        case 'oracle':
            // Oracle precisa dos atestados reais da empresa
            sections.push('══ ACERVO DA EMPRESA ══');
            sections.push(companySummary);
            if (matchResult) {
                sections.push(`\nTécnica matched: ${matchResult.technicalFit.matched.join(', ') || 'Nenhum'}`);
                sections.push(`Técnica missing: ${matchResult.technicalFit.missing.join(', ') || 'Nenhum'}`);
            }
            break;

        case 'dossier':
            // Dossier precisa dos documentos reais vs exigidos
            sections.push('══ DOCUMENTAÇÃO DA EMPRESA ══');
            if (matchResult) {
                sections.push(`\n✅ Documentos presentes: ${matchResult.documentaryFit.matched.join(', ') || 'Nenhum'}`);
                sections.push(`❌ Documentos faltantes: ${matchResult.documentaryFit.missing.join(', ') || 'Nenhum'}`);
                sections.push(`⏰ Documentos vencidos: ${matchResult.documentaryFit.expired.join(', ') || 'Nenhum'}`);
            } else {
                sections.push(companySummary);
            }
            break;

        case 'declaration':
            // Declaration precisa de dados cadastrais
            sections.push('══ DADOS DA EMPRESA ══');
            const profile2 = matchResult ? undefined : undefined; // minimal — use companySummary
            sections.push(companySummary.split('\n\n')[0] || companySummary); // Only identification block
            break;

        case 'proposal':
            // Proposal precisa de insumos existentes
            sections.push('══ INSUMOS DA EMPRESA ══');
            if (matchResult) {
                sections.push(`\n✅ Itens prontos: ${matchResult.proposalFit.readyItems.join(', ') || 'Nenhum'}`);
                sections.push(`❌ Itens faltantes: ${matchResult.proposalFit.missingInputs.join(', ') || 'Nenhum'}`);
                sections.push(`⚠️ Riscos: ${matchResult.proposalFit.risks.join(', ') || 'Nenhum'}`);
            } else {
                sections.push(companySummary);
            }
            break;
    }

    return sections.join('\n');
}
