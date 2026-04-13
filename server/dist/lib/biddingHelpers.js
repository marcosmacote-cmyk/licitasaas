"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLATFORM_DOMAINS = exports.MONITORABLE_DOMAINS = void 0;
exports.hasMonitorableDomain = hasMonitorableDomain;
exports.detectPlatformFromLink = detectPlatformFromLink;
exports.normalizeModality = normalizeModality;
exports.normalizePortal = normalizePortal;
exports.sanitizeBiddingData = sanitizeBiddingData;
/**
 * ══════════════════════════════════════════════════════════
 *  Bidding Helpers — Shared utilities for bidding routes
 *  Extracted from server/index.ts (Sprint 8.1)
 * ══════════════════════════════════════════════════════════
 */
const logger_1 = require("./logger");
// ── Monitorable Domains ──
exports.MONITORABLE_DOMAINS = [
    'cnetmobile', 'licitamaisbrasil', 'bllcompras', 'bll.org',
    'bnccompras', 'portaldecompraspublicas', 'licitanet.com.br', 'bbmnet', 'm2atecnologia',
    'precodereferencia',
    // ⚠️ NÃO incluir 'comprasnet' aqui! O domínio www.comprasnet.gov.br é o portal antigo de LOGIN
    // (ex: https://www.comprasnet.gov.br/seguro/loginPortal.asp) — NÃO é monitorável.
    // O único domínio ComprasNet monitorável é 'cnetmobile' (cnetmobile.estaleiro.serpro.gov.br).
    // Incluir 'comprasnet' causa falso-positivo que impede o AutoEnrich de buscar o link correto.
];
// Map platform canonical names → domains they use (for credential matching)
exports.PLATFORM_DOMAINS = {
    'Compras.gov.br': ['cnetmobile', 'comprasnet', 'compras.gov.br', 'gov.br/compras', 'pncp.gov.br'],
    'M2A': ['m2atecnologia', 'precodereferencia'],
    'BLL': ['bllcompras', 'bll.org'],
    'BBMNET': ['bbmnet'],
    'BNC': ['bnccompras'],
    'Licita Mais Brasil': ['licitamaisbrasil'],
    'Portal de Compras Públicas': ['portaldecompraspublicas'],
    'Licitanet': ['licitanet.com.br'],
};
/**
 * Detecta se um link contém domínio de plataforma monitorável.
 */
function hasMonitorableDomain(link) {
    const l = link.toLowerCase();
    return exports.MONITORABLE_DOMAINS.some(d => l.includes(d));
}
/**
 * Detecta a plataforma canônica a partir de um link.
 */
function detectPlatformFromLink(link) {
    const l = link.toLowerCase();
    for (const [platform, domains] of Object.entries(exports.PLATFORM_DOMAINS)) {
        if (domains.some(d => l.includes(d)))
            return platform;
    }
    return null;
}
/**
 * Normaliza o campo "modalidade" para um valor canônico conforme Lei 14.133/2021.
 *
 * MODALIDADES LICITATÓRIAS (Art. 28):
 *   - Pregão (eletrônico ou presencial — mesma modalidade)
 *   - Concorrência (eletrônica, internacional — mesma modalidade)
 *   - Diálogo Competitivo
 *   - Concurso
 *   - Leilão
 *
 * CONTRATAÇÃO DIRETA (Art. 72-75):
 *   - Dispensa de Licitação
 *   - Inexigibilidade
 *
 * PROCEDIMENTOS AUXILIARES (Art. 78):
 *   - Pré-Qualificação, Credenciamento, etc.
 */
function normalizeModality(raw) {
    if (!raw || !raw.trim())
        return '';
    // Strip accents, lowercase, remove Nº/numbers/SRP suffixes
    const s = raw.trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s*n[°ºo]?\s*[\d/.]+.*/i, '')
        .replace(/\s*-?\s*srp$/i, '')
        .replace(/\s*-?\s*sispp$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    // ── 5 Modalidades Licitatórias (Lei 14.133, Art. 28) ──
    if (s.includes('pregao'))
        return 'Pregão';
    if (s.includes('concorrencia'))
        return 'Concorrência';
    if (s.includes('dialogo competitivo'))
        return 'Diálogo Competitivo';
    if (s.includes('concurso'))
        return 'Concurso';
    if (s.includes('leilao'))
        return 'Leilão';
    // ── Contratação Direta (Art. 72-75) ──
    if (s.includes('dispensa'))
        return 'Dispensa';
    if (s.includes('inexigibilidade'))
        return 'Inexigibilidade';
    // ── Procedimentos Auxiliares (Art. 78) ──
    if (s.includes('pre-qualificacao') || s.includes('pre qualificacao'))
        return 'Procedimento Auxiliar';
    if (s.includes('credenciamento'))
        return 'Procedimento Auxiliar';
    if (s.includes('manifestacao de interesse'))
        return 'Procedimento Auxiliar';
    // ── Termos genéricos → inferir ──
    if (s.includes('licitacao eletronica') || s.includes('licitacao'))
        return 'Pregão';
    if (s.includes('chamada publica'))
        return 'Chamada Pública';
    if (s.includes('tomada de precos'))
        return 'Concorrência';
    if (s.includes('convite'))
        return 'Concorrência';
    if (s === 'rdc' || s.includes('regime diferenciado'))
        return 'Concorrência';
    // Fallback: Title Case limpo
    return raw.trim()
        .replace(/\s*[Nn][°ºo]?\s*[\d/.]+.*/i, '')
        .replace(/\s*-?\s*SRP$/i, '')
        .split(' ')
        .map(w => {
        const lower = w.toLowerCase();
        if (['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'para', 'em'].includes(lower))
            return lower;
        return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
        .join(' ').trim();
}
/**
 * Normaliza o campo "portal" para o nome canônico da PLATAFORMA.
 * PNCP é repositório, NÃO plataforma. ComprasNet/Compras.gov.br/PNCP → "Compras.gov.br"
 */
function normalizePortal(portal, link) {
    if (!portal && !link)
        return 'Não Informado';
    const p = (portal || '').toLowerCase().trim();
    const l = (link || '').toLowerCase();
    // ═══════════════════════════════════════════════════════════
    // Prioridade 0: Texto do portal contém URL/nome ESPECÍFICO de plataforma
    // ═══════════════════════════════════════════════════════════
    if (p.includes('m2a') || p.includes('m2atecnologia'))
        return 'M2A';
    if (p.includes('bbmnet'))
        return 'BBMNET';
    if (p.includes('bll'))
        return 'BLL';
    if (p.includes('bnc') && !p.includes('banco'))
        return 'BNC';
    if (p.includes('licita mais') || p.includes('licitamaisbrasil'))
        return 'Licita Mais Brasil';
    if (p.includes('portal de compras') || p.includes('portaldecompras'))
        return 'Portal de Compras Públicas';
    if (p.includes('licitanet'))
        return 'Licitanet';
    if (p.includes('bolsa de licita'))
        return 'Bolsa de Licitações';
    // Prioridade 1: Inferir pelo link (mais confiável para portais de disputa)
    if (l) {
        if (l.includes('m2atecnologia') || l.includes('precodereferencia'))
            return 'M2A';
        if (l.includes('bbmnet') || l.includes('novabbmnet'))
            return 'BBMNET';
        if (l.includes('bllcompras') || l.includes('bll.org'))
            return 'BLL';
        if (l.includes('bnccompras'))
            return 'BNC';
        if (l.includes('licitamaisbrasil'))
            return 'Licita Mais Brasil';
        if (l.includes('portaldecompraspublicas'))
            return 'Portal de Compras Públicas';
        if (l.includes('licitanet.com.br'))
            return 'Licitanet';
        if (l.includes('bolsadelicitacoes') || l.includes('bfrr.com'))
            return 'Bolsa de Licitações';
        if (l.includes('cnetmobile') || l.includes('comprasnet') || l.includes('compras.gov.br') || l.includes('gov.br/compras') || l.includes('pncp.gov.br'))
            return 'Compras.gov.br';
    }
    // Prioridade 2: Texto do portal → Compras.gov.br (genérico, avaliado por último)
    if (p.includes('compras.gov') || p.includes('comprasnet') || p.includes('comprasgov') || p.includes('www.gov.br/compras') || p.includes('cnetmobile') || p.includes('pncp'))
        return 'Compras.gov.br';
    // Prioridade 3: URL crua → tentar extrair plataforma
    if (portal) {
        // Remove embedded URLs: "Nome (https://...)" or "Nome: https://..."
        const cleaned = portal
            .replace(/\s*\(?\s*https?:\/\/[^\s)]+\s*\)?\s*/gi, '')
            .replace(/\s*:\s*https?:\/\/[^\s]+/gi, '')
            .trim();
        if (cleaned && cleaned.length > 2)
            return cleaned;
        // Se é URL pura, extrair domínio
        const urlMatch = portal.match(/https?:\/\/(?:www\.)?([^/\s]+)/i);
        if (urlMatch) {
            const domain = urlMatch[1];
            if (domain.includes('comprasquixelo') || domain.includes('licitacesmilagres') || domain.includes('licitamoraisjoice'))
                return 'Portal Municipal';
            return domain;
        }
    }
    return portal || 'Não Informado';
}
// ── Sanitize BiddingProcess fields — only allow valid Prisma scalar fields ──
const BIDDING_ALLOWED_FIELDS = new Set([
    'title', 'summary', 'portal', 'modality', 'status', 'substage',
    'risk', 'estimatedValue', 'sessionDate', 'link', 'pncpLink',
    'uasg', 'modalityCode', 'processNumber', 'processYear',
    'isMonitored', 'observations', 'reminderDate', 'reminderStatus',
    'reminderType', 'reminderDays',
]);
function sanitizeBiddingData(raw) {
    const clean = {};
    for (const key of Object.keys(raw)) {
        if (BIDDING_ALLOWED_FIELDS.has(key)) {
            clean[key] = raw[key];
        }
    }
    // Ensure sessionDate is a valid ISO string
    if (clean.sessionDate && typeof clean.sessionDate === 'string') {
        const parsed = new Date(clean.sessionDate);
        if (isNaN(parsed.getTime())) {
            logger_1.logger.warn(`[Sanitize] Invalid sessionDate "${clean.sessionDate}", using current date`);
            clean.sessionDate = new Date().toISOString();
        }
        else {
            clean.sessionDate = parsed.toISOString();
        }
    }
    // Ensure reminderDate is valid or null
    if (clean.reminderDate !== undefined) {
        if (clean.reminderDate === null || clean.reminderDate === '' || clean.reminderDate === 'null') {
            clean.reminderDate = null;
        }
        else if (typeof clean.reminderDate === 'string') {
            const parsed = new Date(clean.reminderDate);
            if (isNaN(parsed.getTime())) {
                logger_1.logger.warn(`[Sanitize] Invalid reminderDate "${clean.reminderDate}", setting null`);
                clean.reminderDate = null;
            }
            else {
                clean.reminderDate = parsed.toISOString();
            }
        }
    }
    return clean;
}
