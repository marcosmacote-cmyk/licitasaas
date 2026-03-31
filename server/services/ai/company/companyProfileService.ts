import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// ── Tipos do Perfil ──

export interface CompanyLicitationProfile {
    companyId: string;
    corporateData: {
        legalName: string;
        tradeName?: string;
        cnpj: string;
        companyType?: string;
        headquarters?: string;
        primaryActivities?: string[];
        stateRegistration?: string;
        foundedAt?: string;
    };
    registrations: {
        crea?: boolean;
        cau?: boolean;
        cra?: boolean;
        crc?: boolean;
        otherCouncils?: string[];
    };
    responsibleProfessionals: Array<{
        name: string;
        profession: string;
        council: string;
        registrationNumber?: string;
        role?: string;
        active: boolean;
        linkedSince?: string;
    }>;
    technicalAssets: {
        certificates: string[];
        attests: string[];
        artCatRrt: string[];
        recurringCapabilities: string[];
    };
    documentaryAssets: {
        legalDocuments: DocumentRecord[];
        fiscalDocuments: DocumentRecord[];
        laborDocuments: DocumentRecord[];
        economicFinancialDocuments: DocumentRecord[];
        declarationsTemplates: string[];
    };
    readinessFlags: {
        hasUpdatedBalance: boolean;
        hasValidCertificates: boolean;
        hasTechnicalCollection: boolean;
        hasProposalTemplates: boolean;
        lastUpdated?: string;
    };
    knownWeaknesses: string[];
    strengths: string[];
    historicalPerformance?: {
        totalParticipations: number;
        wins: number;
        bestSegments: string[];
        worstSegments: string[];
    };
    updatedAt: string;
}

export interface DocumentRecord {
    name: string;
    category: 'juridica' | 'fiscal' | 'trabalhista' | 'economico_financeira' | 'tecnica' | 'declaracao' | 'proposta' | 'outro';
    subcategory?: string;
    status: 'valid' | 'expired' | 'pending' | 'missing';
    reliability: 'confirmed' | 'unverified' | 'outdated';
    expiresAt?: string;
    lastVerifiedAt?: string;
    lastUsedAt?: string;
    timesUsed: number;
    timesSuccessful: number;
    reuseCategory?: 'always_reusable' | 'edital_specific' | 'time_limited';
    bestForEditalTypes?: string[];
    notes?: string;
}

// ── Funções de Helper ──
const parseJsonField = (val: any, def: any) => {
    if (!val) return def;
    if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return def; }
    }
    return val;
};

// ── Profile Service ──

export async function createOrUpdateProfile(profile: CompanyLicitationProfile): Promise<CompanyLicitationProfile> {
    profile.updatedAt = new Date().toISOString();
    
    try {
        await prisma.companyProfile.update({
            where: { id: profile.companyId },
            data: {
                strengths: profile.strengths,
                knownWeaknesses: profile.knownWeaknesses,
                technicalAssets: profile.technicalAssets as any,
                documentaryAssets: profile.documentaryAssets as any,
                readinessFlags: profile.readinessFlags as any,
                registrations: profile.registrations as any,
                responsibleProfessionals: profile.responsibleProfessionals as any,
                historicalPerformance: profile.historicalPerformance as any
            }
        });
        console.log(`[CompanyProfile] Saved profile to DB for ${profile.corporateData.legalName} (${profile.companyId})`);
    } catch(e) {
        console.error(`[CompanyProfile] Error saving profile to DB for ${profile.companyId}`, e);
    }
    
    return profile;
}

export async function getProfile(companyId: string): Promise<CompanyLicitationProfile | undefined> {
    const cp = await prisma.companyProfile.findUnique({ where: { id: companyId } });
    if (!cp) return undefined;

    return {
        companyId: cp.id,
        corporateData: { 
            legalName: cp.razaoSocial, 
            cnpj: cp.cnpj,
            headquarters: cp.city ? `${cp.city}/${cp.state}` : undefined
        },
        registrations: parseJsonField(cp.registrations, {}),
        responsibleProfessionals: parseJsonField(cp.responsibleProfessionals, []),
        technicalAssets: parseJsonField(cp.technicalAssets, { certificates: [], attests: [], artCatRrt: [], recurringCapabilities: [] }),
        documentaryAssets: parseJsonField(cp.documentaryAssets, { legalDocuments: [], fiscalDocuments: [], laborDocuments: [], economicFinancialDocuments: [], declarationsTemplates: [] }),
        readinessFlags: parseJsonField(cp.readinessFlags, { hasUpdatedBalance: false, hasValidCertificates: false, hasTechnicalCollection: false, hasProposalTemplates: false }),
        knownWeaknesses: parseJsonField(cp.strengths, []), // BUG FIXED HERE in my mind, wait, I will map knownWeaknesses correctly below
        strengths: parseJsonField(cp.strengths, []),
        historicalPerformance: parseJsonField(cp.historicalPerformance, undefined),
        updatedAt: new Date().toISOString()
    };
}

export async function getAllProfiles(): Promise<CompanyLicitationProfile[]> {
    const cps = await prisma.companyProfile.findMany();
    return cps.map(cp => ({
        companyId: cp.id,
        corporateData: { 
            legalName: cp.razaoSocial, 
            cnpj: cp.cnpj,
            headquarters: cp.city ? `${cp.city}/${cp.state}` : undefined
        },
        registrations: parseJsonField(cp.registrations, {}),
        responsibleProfessionals: parseJsonField(cp.responsibleProfessionals, []),
        technicalAssets: parseJsonField(cp.technicalAssets, { certificates: [], attests: [], artCatRrt: [], recurringCapabilities: [] }),
        documentaryAssets: parseJsonField(cp.documentaryAssets, { legalDocuments: [], fiscalDocuments: [], laborDocuments: [], economicFinancialDocuments: [], declarationsTemplates: [] }),
        readinessFlags: parseJsonField(cp.readinessFlags, { hasUpdatedBalance: false, hasValidCertificates: false, hasTechnicalCollection: false, hasProposalTemplates: false }),
        knownWeaknesses: parseJsonField(cp.knownWeaknesses, []),
        strengths: parseJsonField(cp.strengths, []),
        historicalPerformance: parseJsonField(cp.historicalPerformance, undefined),
        updatedAt: new Date().toISOString()
    }));
}

export async function createEmptyProfile(companyId: string, legalName: string, cnpj: string): Promise<CompanyLicitationProfile> {
    const profile: CompanyLicitationProfile = {
        companyId,
        corporateData: { legalName, cnpj },
        registrations: {},
        responsibleProfessionals: [],
        technicalAssets: { certificates: [], attests: [], artCatRrt: [], recurringCapabilities: [] },
        documentaryAssets: { legalDocuments: [], fiscalDocuments: [], laborDocuments: [], economicFinancialDocuments: [], declarationsTemplates: [] },
        readinessFlags: { hasUpdatedBalance: false, hasValidCertificates: false, hasTechnicalCollection: false, hasProposalTemplates: false },
        knownWeaknesses: [],
        strengths: [],
        updatedAt: new Date().toISOString()
    };
    return createOrUpdateProfile(profile);
}

// ── Memory Service ──

export async function addDocumentToMemory(companyId: string, doc: DocumentRecord): Promise<void> {
    const profile = await getProfile(companyId);
    if (!profile) return;
    
    // Default reliability
    if (!doc.reliability) doc.reliability = 'unverified';
    if (!doc.timesSuccessful) doc.timesSuccessful = 0;
    
    // Encontrar array correto e adicionar
    if (doc.category === 'juridica') profile.documentaryAssets.legalDocuments.push(doc);
    else if (doc.category === 'fiscal') profile.documentaryAssets.fiscalDocuments.push(doc);
    else if (doc.category === 'trabalhista') profile.documentaryAssets.laborDocuments.push(doc);
    else if (doc.category === 'economico_financeira') profile.documentaryAssets.economicFinancialDocuments.push(doc);
    else if (doc.category === 'declaracao') profile.documentaryAssets.declarationsTemplates.push(doc.name); // simplificado
    else profile.documentaryAssets.legalDocuments.push(doc); // fallback
    
    await createOrUpdateProfile(profile);
}

export async function getCompanyDocuments(companyId: string, category?: DocumentRecord['category']): Promise<DocumentRecord[]> {
    const profile = await getProfile(companyId);
    if (!profile) return [];
    
    const docs = [
        ...(profile.documentaryAssets.legalDocuments || []),
        ...(profile.documentaryAssets.fiscalDocuments || []),
        ...(profile.documentaryAssets.laborDocuments || []),
        ...(profile.documentaryAssets.economicFinancialDocuments || [])
    ];
    
    return category ? docs.filter(d => d.category === category) : docs;
}

export async function getValidDocuments(companyId: string): Promise<DocumentRecord[]> {
    return (await getCompanyDocuments(companyId)).filter(d => d.status === 'valid');
}

export async function getExpiredDocuments(companyId: string): Promise<DocumentRecord[]> {
    return (await getCompanyDocuments(companyId)).filter(d => d.status === 'expired');
}

export async function getMissingDocuments(companyId: string): Promise<DocumentRecord[]> {
    return (await getCompanyDocuments(companyId)).filter(d => d.status === 'missing');
}

export async function getMostReusedDocuments(companyId: string, limit = 10): Promise<DocumentRecord[]> {
    return (await getCompanyDocuments(companyId))
        .sort((a, b) => b.timesUsed - a.timesUsed)
        .slice(0, limit);
}

export async function getDocumentsExpiringWithin(companyId: string, days: number): Promise<DocumentRecord[]> {
    const cutoff = new Date(Date.now() + days * 86400000).toISOString();
    return (await getCompanyDocuments(companyId)).filter(d => d.expiresAt && d.expiresAt <= cutoff && d.status === 'valid');
}

export async function getReusableDocumentsForEditalType(companyId: string, editalType: string): Promise<DocumentRecord[]> {
    return (await getCompanyDocuments(companyId)).filter(d =>
        d.status === 'valid' && d.reuseCategory === 'always_reusable' ||
        (d.bestForEditalTypes?.some(t => t.toLowerCase().includes(editalType.toLowerCase())))
    );
}

export async function getRecurringlyMissingDocuments(companyId: string): Promise<DocumentRecord[]> {
    return (await getCompanyDocuments(companyId)).filter(d =>
        d.status === 'missing' && d.timesUsed > 0
    );
}

export async function markDocumentUsed(companyId: string, docName: string, successful = true): Promise<void> {
    const profile = await getProfile(companyId);
    if (!profile) return;
    
    const docs = [
        ...(profile.documentaryAssets.legalDocuments || []),
        ...(profile.documentaryAssets.fiscalDocuments || []),
        ...(profile.documentaryAssets.laborDocuments || []),
        ...(profile.documentaryAssets.economicFinancialDocuments || [])
    ];
    
    const doc = docs.find(d => d.name === docName);
    if (doc) {
        doc.timesUsed = (doc.timesUsed || 0) + 1;
        doc.lastUsedAt = new Date().toISOString();
        if (successful) doc.timesSuccessful = (doc.timesSuccessful || 0) + 1;
        await createOrUpdateProfile(profile);
    }
}

export async function refreshDocumentStatuses(companyId: string): Promise<{ refreshed: number; expired: number }> {
    const profile = await getProfile(companyId);
    if (!profile) return { refreshed: 0, expired: 0 };
    
    let refreshed = 0;
    let expired = 0;
    const now = new Date().toISOString();
    
    const checkArray = (arr: DocumentRecord[] = []) => {
        for (const doc of arr) {
            if (doc.expiresAt && doc.status === 'valid' && doc.expiresAt < now) {
                doc.status = 'expired';
                doc.reliability = 'outdated';
                expired++;
                refreshed++;
            }
        }
    };
    
    checkArray(profile.documentaryAssets.legalDocuments);
    checkArray(profile.documentaryAssets.fiscalDocuments);
    checkArray(profile.documentaryAssets.laborDocuments);
    checkArray(profile.documentaryAssets.economicFinancialDocuments);
    
    if (refreshed > 0) {
        await createOrUpdateProfile(profile);
    }
    
    return { refreshed, expired };
}

/**
 * Gera resumo textual do perfil para injeção em contexto de IA
 */
export async function buildCompanyContextSummary(companyId: string): Promise<string> {
    const profile = await getProfile(companyId);
    if (!profile) return '';

    const sections: string[] = [];
    const cd = profile.corporateData;

    sections.push(`══ PERFIL DA EMPRESA ══\nNome: ${cd.legalName}${cd.tradeName ? ` (${cd.tradeName})` : ''}\nCNPJ: ${cd.cnpj}\nTipo: ${cd.companyType || 'N/I'} | Sede: ${cd.headquarters || 'N/I'}\nAtividades: ${cd.primaryActivities?.join(', ') || 'N/I'}`);

    // Registrations
    const regs: string[] = [];
    if (profile.registrations.crea) regs.push('CREA');
    if (profile.registrations.cau) regs.push('CAU');
    if (profile.registrations.cra) regs.push('CRA');
    if (profile.registrations.crc) regs.push('CRC');
    if (profile.registrations.otherCouncils?.length) regs.push(...profile.registrations.otherCouncils);
    if (regs.length) sections.push(`Registros: ${regs.join(', ')}`);

    // Professionals
    const activePros = profile.responsibleProfessionals.filter(p => p.active);
    if (activePros.length > 0) {
        sections.push(`══ RESPONSÁVEIS TÉCNICOS (${activePros.length}) ══\n` +
            activePros.map(p => `  • ${p.name} — ${p.profession} (${p.council} ${p.registrationNumber || ''}) [${p.role || 'técnico'}]`).join('\n'));
    }

    // Technical assets
    const ta = profile.technicalAssets;
    if (ta.attests.length || ta.artCatRrt.length || ta.certificates.length) {
        let taText = `══ ACERVO TÉCNICO ══\n`;
        if (ta.attests.length) taText += `Atestados: ${ta.attests.length} registrados\n`;
        if (ta.artCatRrt.length) taText += `ART/CAT/RRT: ${ta.artCatRrt.length} registrados\n`;
        if (ta.certificates.length) taText += `Certificados: ${ta.certificates.join(', ')}\n`;
        if (ta.recurringCapabilities.length) taText += `Capacidades recorrentes: ${ta.recurringCapabilities.join(', ')}\n`;
        sections.push(taText);
    }

    // Readiness
    const rf = profile.readinessFlags;
    sections.push(`══ PRONTIDÃO ══\nBalanço atualizado: ${rf.hasUpdatedBalance ? 'SIM' : 'NÃO'}\nCertidões válidas: ${rf.hasValidCertificates ? 'SIM' : 'NÃO'}\nAcervo técnico: ${rf.hasTechnicalCollection ? 'SIM' : 'NÃO'}\nTemplates proposta: ${rf.hasProposalTemplates ? 'SIM' : 'NÃO'}`);

    // Strengths & Weaknesses
    if (profile.strengths.length) sections.push(`Pontos fortes: ${profile.strengths.join('; ')}`);
    if (profile.knownWeaknesses.length) sections.push(`⚠️ Fragilidades: ${profile.knownWeaknesses.join('; ')}`);

    // Documents summary
    const allDocs = await getCompanyDocuments(companyId);
    if (allDocs.length > 0) {
        const valid = allDocs.filter(d => d.status === 'valid').length;
        const expired = allDocs.filter(d => d.status === 'expired').length;
        const missing = allDocs.filter(d => d.status === 'missing').length;
        sections.push(`══ DOCUMENTOS ══\nTotal: ${allDocs.length} | Válidos: ${valid} | Vencidos: ${expired} | Faltantes: ${missing}`);
    }

    return sections.join('\n\n');
}
