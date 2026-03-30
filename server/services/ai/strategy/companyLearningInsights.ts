/**
 * ══════════════════════════════════════════════════════════════════
 *  Company Learning Insights — Aprendizado Institucional
 * ══════════════════════════════════════════════════════════════════
 *
 *  Gera insights por empresa com base no histórico de participação,
 *  feedback e matching.
 */

import { getProfile, CompanyLicitationProfile } from '../company/companyProfileService';

export interface CompanyInsight {
    insightId: string;
    companyId: string;
    category: 'strength' | 'weakness' | 'opportunity' | 'pattern' | 'trend';
    description: string;
    frequency: number;
    evidence: string[];
    suggestedAction?: string;
    createdAt: string;
}

export interface CompanyLearningReport {
    companyId: string;
    companyName: string;
    generatedAt: string;
    insights: CompanyInsight[];
    summary: {
        totalInsights: number;
        strengths: number;
        weaknesses: number;
        opportunities: number;
    };
    readinessProfile: {
        documentaryReadiness: 'strong' | 'moderate' | 'weak';
        technicalReadiness: 'strong' | 'moderate' | 'weak';
        economicFinancialReadiness: 'strong' | 'moderate' | 'weak';
        overallReadiness: 'strong' | 'moderate' | 'weak';
    };
}

// ── Storage ──
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function recordMatchHistory(companyId: string, processId: string, scores: { doc: number; tech: number; ef: number; prop: number; overall: number }, recommendation: string): Promise<void> {
    try {
        const company = await prisma.companyProfile.findUnique({ where: { id: companyId } });
        if (!company || !company.tenantId) return;

        const tenantId = company.tenantId;
        const configRecord = await prisma.globalConfig.findUnique({ where: { tenantId } });
        const config = configRecord ? JSON.parse(configRecord.config || '{}') : {};
        
        if (!config.aiHistoryStore) config.aiHistoryStore = {};
        if (!config.aiHistoryStore[companyId]) config.aiHistoryStore[companyId] = [];
        
        config.aiHistoryStore[companyId].push({
            processId,
            scores,
            recommendation,
            timestamp: new Date().toISOString()
        });

        // Limita a 50 historicos por empresa para não explodir o payload
        if (config.aiHistoryStore[companyId].length > 50) {
            config.aiHistoryStore[companyId].shift();
        }

        await prisma.globalConfig.upsert({
            where: { tenantId },
            update: { config: JSON.stringify(config) },
            create: { tenantId, config: JSON.stringify(config) }
        });
    } catch (e) {
        console.error('[LearningInsights] Failed to save history', e);
    }
}

export async function generateCompanyInsights(companyId: string): Promise<CompanyLearningReport> {
    const profile = getProfile(companyId);
    let history: Array<{ processId: string; scores: any; recommendation: string }> = [];
    
    try {
        const company = await prisma.companyProfile.findUnique({ where: { id: companyId } });
        if (company && company.tenantId) {
            const configRecord = await prisma.globalConfig.findUnique({ where: { tenantId: company.tenantId } });
            if (configRecord && configRecord.config) {
                const config = JSON.parse(configRecord.config);
                history = config.aiHistoryStore?.[companyId] || [];
            }
        }
    } catch (e) {
        console.error('[LearningInsights] Failed to load history', e);
    }

    const insights: CompanyInsight[] = [];

    // 1. Profile-based insights
    if (profile) {
        // Strengths
        if (profile.strengths.length > 0) {
            insights.push({
                insightId: `ci-${companyId}-str`,
                companyId,
                category: 'strength',
                description: `Pontos fortes declarados: ${profile.strengths.join(', ')}`,
                frequency: 1,
                evidence: profile.strengths,
                createdAt: new Date().toISOString()
            });
        }

        // Weaknesses
        if (profile.knownWeaknesses.length > 0) {
            insights.push({
                insightId: `ci-${companyId}-weak`,
                companyId,
                category: 'weakness',
                description: `Fragilidades conhecidas: ${profile.knownWeaknesses.join(', ')}`,
                frequency: 1,
                evidence: profile.knownWeaknesses,
                suggestedAction: 'Priorizar resolução das fragilidades antes de próximas participações',
                createdAt: new Date().toISOString()
            });
        }

        // RT gap
        const activeRTs = profile.responsibleProfessionals.filter(p => p.active);
        if (activeRTs.length === 0) {
            insights.push({
                insightId: `ci-${companyId}-rt`,
                companyId,
                category: 'weakness',
                description: 'Nenhum Responsável Técnico ativo vinculado',
                frequency: 1,
                evidence: [],
                suggestedAction: 'Vincular profissional com registro ativo no conselho competente',
                createdAt: new Date().toISOString()
            });
        }

        // Document readiness
        if (!profile.readinessFlags.hasUpdatedBalance) {
            insights.push({
                insightId: `ci-${companyId}-bal`,
                companyId,
                category: 'weakness',
                description: 'Balanço patrimonial não atualizado',
                frequency: 1,
                evidence: [],
                suggestedAction: 'Atualizar balanço para atender exigências econômico-financeiras',
                createdAt: new Date().toISOString()
            });
        }

        if (!profile.readinessFlags.hasValidCertificates) {
            insights.push({
                insightId: `ci-${companyId}-cert`,
                companyId,
                category: 'weakness',
                description: 'Certidões não estão todas válidas',
                frequency: 1,
                evidence: [],
                suggestedAction: 'Renovar certidões vencidas (FGTS, INSS, CNDT, tributos)',
                createdAt: new Date().toISOString()
            });
        }
    }

    // 2. History-based insights
    if (history.length >= 3) {
        const avgOverall = Math.round(history.reduce((s, h) => s + h.scores.overall, 0) / history.length);
        const avgDoc = Math.round(history.reduce((s, h) => s + h.scores.doc, 0) / history.length);
        const avgTech = Math.round(history.reduce((s, h) => s + h.scores.tech, 0) / history.length);

        insights.push({
            insightId: `ci-${companyId}-trend-overall`,
            companyId,
            category: 'trend',
            description: `Score médio de participação: ${avgOverall}% em ${history.length} editais analisados`,
            frequency: history.length,
            evidence: history.map(h => `${h.processId}: ${h.scores.overall}%`),
            createdAt: new Date().toISOString()
        });

        if (avgTech < 50) {
            insights.push({
                insightId: `ci-${companyId}-trend-tech`,
                companyId,
                category: 'pattern',
                description: `Aderência técnica média baixa (${avgTech}%) — indica acervo insuficiente para os editais analisados`,
                frequency: history.length,
                evidence: history.map(h => `${h.processId}: tech=${h.scores.tech}%`),
                suggestedAction: 'Ampliar acervo técnico com novos atestados e certificados',
                createdAt: new Date().toISOString()
            });
        }

        if (avgDoc < 60) {
            insights.push({
                insightId: `ci-${companyId}-trend-doc`,
                companyId,
                category: 'pattern',
                description: `Aderência documental média baixa (${avgDoc}%) — documentação frequentemente incompleta`,
                frequency: history.length,
                evidence: history.map(h => `${h.processId}: doc=${h.scores.doc}%`),
                suggestedAction: 'Manter documentação base atualizada preventivamente',
                createdAt: new Date().toISOString()
            });
        }

        // Win pattern
        const participar = history.filter(h => h.recommendation === 'participar').length;
        if (participar > history.length * 0.7) {
            insights.push({
                insightId: `ci-${companyId}-opp`,
                companyId,
                category: 'opportunity',
                description: `Empresa com alta aptidão: ${Math.round((participar / history.length) * 100)}% dos editais com recomendação positiva`,
                frequency: participar,
                evidence: [],
                createdAt: new Date().toISOString()
            });
        }
    }

    // 3. Build readiness profile
    const readinessProfile = buildReadinessProfile(profile, history);

    // Sort by category importance
    const catOrder: Record<string, number> = { weakness: 0, pattern: 1, trend: 2, opportunity: 3, strength: 4 };
    insights.sort((a, b) => (catOrder[a.category] ?? 5) - (catOrder[b.category] ?? 5));

    const report: CompanyLearningReport = {
        companyId,
        companyName: profile?.corporateData.legalName || 'N/A',
        generatedAt: new Date().toISOString(),
        insights,
        summary: {
            totalInsights: insights.length,
            strengths: insights.filter(i => i.category === 'strength').length,
            weaknesses: insights.filter(i => i.category === 'weakness').length,
            opportunities: insights.filter(i => i.category === 'opportunity').length
        },
        readinessProfile
    };

    console.log(`[CompanyInsights] ${companyId}: ${insights.length} insights (${report.summary.weaknesses} weaknesses, ${report.summary.strengths} strengths)`);
    return report;
}

function buildReadinessProfile(
    profile?: CompanyLicitationProfile,
    history?: Array<{ scores: { doc: number; tech: number; ef: number } }>
): CompanyLearningReport['readinessProfile'] {
    if (!profile) return { documentaryReadiness: 'weak', technicalReadiness: 'weak', economicFinancialReadiness: 'weak', overallReadiness: 'weak' };

    const classify = (score: number): 'strong' | 'moderate' | 'weak' => {
        if (score >= 75) return 'strong';
        if (score >= 45) return 'moderate';
        return 'weak';
    };

    let docScore = (profile.readinessFlags.hasValidCertificates ? 50 : 0) + (profile.documentaryAssets.declarationsTemplates.length > 0 ? 25 : 0) + 25;
    let techScore = (profile.readinessFlags.hasTechnicalCollection ? 50 : 0) + (profile.responsibleProfessionals.filter(p => p.active).length > 0 ? 30 : 0) + (profile.technicalAssets.attests.length > 0 ? 20 : 0);
    let efScore = (profile.readinessFlags.hasUpdatedBalance ? 70 : 0) + 30;

    // Adjust with history if available
    if (history && history.length >= 2) {
        const avgDoc = history.reduce((s, h) => s + h.scores.doc, 0) / history.length;
        const avgTech = history.reduce((s, h) => s + h.scores.tech, 0) / history.length;
        const avgEF = history.reduce((s, h) => s + h.scores.ef, 0) / history.length;
        docScore = Math.round((docScore + avgDoc) / 2);
        techScore = Math.round((techScore + avgTech) / 2);
        efScore = Math.round((efScore + avgEF) / 2);
    }

    const overallScore = Math.round((docScore + techScore + efScore) / 3);

    return {
        documentaryReadiness: classify(docScore),
        technicalReadiness: classify(techScore),
        economicFinancialReadiness: classify(efScore),
        overallReadiness: classify(overallScore)
    };
}
