/**
 * ══════════════════════════════════════════════════════════════════
 *  Company Profile Schema & Service
 * ══════════════════════════════════════════════════════════════════
 *
 *  Perfil licitatório estruturado por empresa + memória institucional.
 */

// ── Tipos do Perfil ──

export interface CompanyLicitationProfile {
    companyId: string;
    corporateData: {
        legalName: string;
        tradeName?: string;
        cnpj: string;
        companyType?: string; // MEI, ME, EPP, Médio, Grande
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
        role?: string; // RT, preposto, etc.
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

// ── Store (será migrado para DB) ──

const profileStore: Map<string, CompanyLicitationProfile> = new Map();
const memoryStore: Map<string, DocumentRecord[]> = new Map();

// ── Profile Service ──

export function createOrUpdateProfile(profile: CompanyLicitationProfile): CompanyLicitationProfile {
    profile.updatedAt = new Date().toISOString();
    profileStore.set(profile.companyId, profile);
    console.log(`[CompanyProfile] Saved profile for ${profile.corporateData.legalName} (${profile.companyId})`);
    return profile;
}

export function getProfile(companyId: string): CompanyLicitationProfile | undefined {
    return profileStore.get(companyId);
}

export function getAllProfiles(): CompanyLicitationProfile[] {
    return Array.from(profileStore.values());
}

export function createEmptyProfile(companyId: string, legalName: string, cnpj: string): CompanyLicitationProfile {
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

export function addDocumentToMemory(companyId: string, doc: DocumentRecord): void {
    if (!memoryStore.has(companyId)) memoryStore.set(companyId, []);
    // Default reliability
    if (!doc.reliability) doc.reliability = 'unverified';
    if (!doc.timesSuccessful) doc.timesSuccessful = 0;
    memoryStore.get(companyId)!.push(doc);
}

export function getCompanyDocuments(companyId: string, category?: DocumentRecord['category']): DocumentRecord[] {
    const docs = memoryStore.get(companyId) || [];
    return category ? docs.filter(d => d.category === category) : docs;
}

export function getValidDocuments(companyId: string): DocumentRecord[] {
    return getCompanyDocuments(companyId).filter(d => d.status === 'valid');
}

export function getExpiredDocuments(companyId: string): DocumentRecord[] {
    return getCompanyDocuments(companyId).filter(d => d.status === 'expired');
}

export function getMissingDocuments(companyId: string): DocumentRecord[] {
    return getCompanyDocuments(companyId).filter(d => d.status === 'missing');
}

export function getMostReusedDocuments(companyId: string, limit = 10): DocumentRecord[] {
    return getCompanyDocuments(companyId)
        .sort((a, b) => b.timesUsed - a.timesUsed)
        .slice(0, limit);
}

export function getDocumentsExpiringWithin(companyId: string, days: number): DocumentRecord[] {
    const cutoff = new Date(Date.now() + days * 86400000).toISOString();
    return getCompanyDocuments(companyId).filter(d => d.expiresAt && d.expiresAt <= cutoff && d.status === 'valid');
}

export function getReusableDocumentsForEditalType(companyId: string, editalType: string): DocumentRecord[] {
    return getCompanyDocuments(companyId).filter(d =>
        d.status === 'valid' && d.reuseCategory === 'always_reusable' ||
        (d.bestForEditalTypes?.some(t => t.toLowerCase().includes(editalType.toLowerCase())))
    );
}

export function getRecurringlyMissingDocuments(companyId: string): DocumentRecord[] {
    return getCompanyDocuments(companyId).filter(d =>
        d.status === 'missing' && d.timesUsed > 0
    );
}

export function markDocumentUsed(companyId: string, docName: string, successful = true): void {
    const docs = memoryStore.get(companyId) || [];
    const doc = docs.find(d => d.name === docName);
    if (doc) {
        doc.timesUsed++;
        doc.lastUsedAt = new Date().toISOString();
        if (successful) doc.timesSuccessful++;
    }
}

export function refreshDocumentStatuses(companyId: string): { refreshed: number; expired: number } {
    const docs = memoryStore.get(companyId) || [];
    const now = new Date().toISOString();
    let refreshed = 0;
    let expired = 0;
    for (const doc of docs) {
        if (doc.expiresAt && doc.status === 'valid' && doc.expiresAt < now) {
            doc.status = 'expired';
            doc.reliability = 'outdated';
            expired++;
            refreshed++;
        }
    }
    return { refreshed, expired };
}

/**
 * Gera resumo textual do perfil para injeção em contexto de IA
 */
export function buildCompanyContextSummary(companyId: string): string {
    const profile = getProfile(companyId);
    if (!profile) return '';

    const sections: string[] = [];
    const cd = profile.corporateData;

    sections.push(`══ PERFIL DA EMPRESA ══
Nome: ${cd.legalName}${cd.tradeName ? ` (${cd.tradeName})` : ''}
CNPJ: ${cd.cnpj}
Tipo: ${cd.companyType || 'N/I'} | Sede: ${cd.headquarters || 'N/I'}
Atividades: ${cd.primaryActivities?.join(', ') || 'N/I'}`);

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
    sections.push(`══ PRONTIDÃO ══
Balanço atualizado: ${rf.hasUpdatedBalance ? 'SIM' : 'NÃO'}
Certidões válidas: ${rf.hasValidCertificates ? 'SIM' : 'NÃO'}
Acervo técnico: ${rf.hasTechnicalCollection ? 'SIM' : 'NÃO'}
Templates proposta: ${rf.hasProposalTemplates ? 'SIM' : 'NÃO'}`);

    // Strengths & Weaknesses
    if (profile.strengths.length) sections.push(`Pontos fortes: ${profile.strengths.join('; ')}`);
    if (profile.knownWeaknesses.length) sections.push(`⚠️ Fragilidades: ${profile.knownWeaknesses.join('; ')}`);

    // Documents summary
    const allDocs = getCompanyDocuments(companyId);
    if (allDocs.length > 0) {
        const valid = allDocs.filter(d => d.status === 'valid').length;
        const expired = allDocs.filter(d => d.status === 'expired').length;
        const missing = allDocs.filter(d => d.status === 'missing').length;
        sections.push(`══ DOCUMENTOS ══\nTotal: ${allDocs.length} | Válidos: ${valid} | Vencidos: ${expired} | Faltantes: ${missing}`);
    }

    return sections.join('\n\n');
}
