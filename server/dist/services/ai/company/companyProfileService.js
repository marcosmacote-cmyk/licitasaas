"use strict";
/**
 * ══════════════════════════════════════════════════════════════════
 *  Company Profile Schema & Service
 * ══════════════════════════════════════════════════════════════════
 *
 *  Perfil licitatório estruturado por empresa + memória institucional.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrUpdateProfile = createOrUpdateProfile;
exports.getProfile = getProfile;
exports.getAllProfiles = getAllProfiles;
exports.createEmptyProfile = createEmptyProfile;
exports.addDocumentToMemory = addDocumentToMemory;
exports.getCompanyDocuments = getCompanyDocuments;
exports.getValidDocuments = getValidDocuments;
exports.getExpiredDocuments = getExpiredDocuments;
exports.getMissingDocuments = getMissingDocuments;
exports.getMostReusedDocuments = getMostReusedDocuments;
exports.getDocumentsExpiringWithin = getDocumentsExpiringWithin;
exports.getReusableDocumentsForEditalType = getReusableDocumentsForEditalType;
exports.getRecurringlyMissingDocuments = getRecurringlyMissingDocuments;
exports.markDocumentUsed = markDocumentUsed;
exports.refreshDocumentStatuses = refreshDocumentStatuses;
exports.buildCompanyContextSummary = buildCompanyContextSummary;
// ── Store (será migrado para DB) ──
const profileStore = new Map();
const memoryStore = new Map();
// ── Profile Service ──
function createOrUpdateProfile(profile) {
    profile.updatedAt = new Date().toISOString();
    profileStore.set(profile.companyId, profile);
    console.log(`[CompanyProfile] Saved profile for ${profile.corporateData.legalName} (${profile.companyId})`);
    return profile;
}
function getProfile(companyId) {
    return profileStore.get(companyId);
}
function getAllProfiles() {
    return Array.from(profileStore.values());
}
function createEmptyProfile(companyId, legalName, cnpj) {
    const profile = {
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
function addDocumentToMemory(companyId, doc) {
    if (!memoryStore.has(companyId))
        memoryStore.set(companyId, []);
    // Default reliability
    if (!doc.reliability)
        doc.reliability = 'unverified';
    if (!doc.timesSuccessful)
        doc.timesSuccessful = 0;
    memoryStore.get(companyId).push(doc);
}
function getCompanyDocuments(companyId, category) {
    const docs = memoryStore.get(companyId) || [];
    return category ? docs.filter(d => d.category === category) : docs;
}
function getValidDocuments(companyId) {
    return getCompanyDocuments(companyId).filter(d => d.status === 'valid');
}
function getExpiredDocuments(companyId) {
    return getCompanyDocuments(companyId).filter(d => d.status === 'expired');
}
function getMissingDocuments(companyId) {
    return getCompanyDocuments(companyId).filter(d => d.status === 'missing');
}
function getMostReusedDocuments(companyId, limit = 10) {
    return getCompanyDocuments(companyId)
        .sort((a, b) => b.timesUsed - a.timesUsed)
        .slice(0, limit);
}
function getDocumentsExpiringWithin(companyId, days) {
    const cutoff = new Date(Date.now() + days * 86400000).toISOString();
    return getCompanyDocuments(companyId).filter(d => d.expiresAt && d.expiresAt <= cutoff && d.status === 'valid');
}
function getReusableDocumentsForEditalType(companyId, editalType) {
    return getCompanyDocuments(companyId).filter(d => d.status === 'valid' && d.reuseCategory === 'always_reusable' ||
        (d.bestForEditalTypes?.some(t => t.toLowerCase().includes(editalType.toLowerCase()))));
}
function getRecurringlyMissingDocuments(companyId) {
    return getCompanyDocuments(companyId).filter(d => d.status === 'missing' && d.timesUsed > 0);
}
function markDocumentUsed(companyId, docName, successful = true) {
    const docs = memoryStore.get(companyId) || [];
    const doc = docs.find(d => d.name === docName);
    if (doc) {
        doc.timesUsed++;
        doc.lastUsedAt = new Date().toISOString();
        if (successful)
            doc.timesSuccessful++;
    }
}
function refreshDocumentStatuses(companyId) {
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
function buildCompanyContextSummary(companyId) {
    const profile = getProfile(companyId);
    if (!profile)
        return '';
    const sections = [];
    const cd = profile.corporateData;
    sections.push(`══ PERFIL DA EMPRESA ══
Nome: ${cd.legalName}${cd.tradeName ? ` (${cd.tradeName})` : ''}
CNPJ: ${cd.cnpj}
Tipo: ${cd.companyType || 'N/I'} | Sede: ${cd.headquarters || 'N/I'}
Atividades: ${cd.primaryActivities?.join(', ') || 'N/I'}`);
    // Registrations
    const regs = [];
    if (profile.registrations.crea)
        regs.push('CREA');
    if (profile.registrations.cau)
        regs.push('CAU');
    if (profile.registrations.cra)
        regs.push('CRA');
    if (profile.registrations.crc)
        regs.push('CRC');
    if (profile.registrations.otherCouncils?.length)
        regs.push(...profile.registrations.otherCouncils);
    if (regs.length)
        sections.push(`Registros: ${regs.join(', ')}`);
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
        if (ta.attests.length)
            taText += `Atestados: ${ta.attests.length} registrados\n`;
        if (ta.artCatRrt.length)
            taText += `ART/CAT/RRT: ${ta.artCatRrt.length} registrados\n`;
        if (ta.certificates.length)
            taText += `Certificados: ${ta.certificates.join(', ')}\n`;
        if (ta.recurringCapabilities.length)
            taText += `Capacidades recorrentes: ${ta.recurringCapabilities.join(', ')}\n`;
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
    if (profile.strengths.length)
        sections.push(`Pontos fortes: ${profile.strengths.join('; ')}`);
    if (profile.knownWeaknesses.length)
        sections.push(`⚠️ Fragilidades: ${profile.knownWeaknesses.join('; ')}`);
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
