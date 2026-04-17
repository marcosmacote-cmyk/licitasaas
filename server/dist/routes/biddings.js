"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * ══════════════════════════════════════════════════════════
 *  Bidding Routes — CRUD + AutoEnrich + AutoMonitor
 *  Extracted from server/index.ts (Sprint 8.1)
 * ══════════════════════════════════════════════════════════
 */
const express_1 = __importDefault(require("express"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middlewares/auth");
const logger_1 = require("../lib/logger");
const errorHandler_1 = require("../middlewares/errorHandler");
const biddingHelpers_1 = require("../lib/biddingHelpers");
const router = express_1.default.Router();
// ── GET /biddings — List all biddings for tenant ──
// NOTE: Previously used `include: { aiAnalysis: true }` which returned 7+ MB
// of JSON (schemaV2 contains huge structured extraction data per process).
// Now we exclude schemaV2 to reduce payload from ~7MB to ~500KB.
router.get('/', auth_1.authenticateToken, async (req, res) => {
    try {
        const biddings = await prisma_1.default.biddingProcess.findMany({
            where: { tenantId: req.user.tenantId },
            include: {
                aiAnalysis: {
                    select: {
                        id: true,
                        biddingProcessId: true,
                        fullSummary: true,
                        overallConfidence: true,
                        requiresHumanAudit: true,
                        analyzedAt: true,
                        modelUsed: true,
                        sourceFileNames: true,
                        // EXCLUDED heavy text fields (loaded on-demand when user opens detail):
                        // requiredDocuments, biddingItems, pricingConsiderations,
                        // irregularitiesFlags, deadlines, penalties,
                        // qualificationRequirements, chatHistory, schemaV2
                    }
                }
            }
        });
        res.json(biddings);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch biddings' });
    }
});
// ── POST /biddings — Create new bidding ──
router.post('/', auth_1.authenticateToken, async (req, res) => {
    try {
        let { companyProfileId, ...rawData } = req.body;
        const tenantId = req.user.tenantId;
        let biddingData = (0, biddingHelpers_1.sanitizeBiddingData)(rawData);
        if (companyProfileId === '') {
            companyProfileId = null;
        }
        // ── Step 0: Normalize portal & modality ──
        biddingData.portal = (0, biddingHelpers_1.normalizePortal)(biddingData.portal || '', biddingData.link);
        if (biddingData.modality)
            biddingData.modality = (0, biddingHelpers_1.normalizeModality)(biddingData.modality);
        // ── Step 1: Auto-enrich — fetch platform link from PNCP API if missing ──
        let enrichedLink = biddingData.link || '';
        const hasPlatformLink = (0, biddingHelpers_1.hasMonitorableDomain)(enrichedLink);
        // Check if the platform link is "functional" (has the params needed for chat monitoring).
        const isGenericPlatformLink = hasPlatformLink && (() => {
            const l = enrichedLink.toLowerCase();
            if (l.includes('bllcompras') && !l.includes('param1=') && !l.includes('processview'))
                return true;
            if (l.includes('m2atecnologia') && !l.includes('/certame/') && !l.includes('precodereferencia'))
                return true;
            return false;
        })();
        if ((!hasPlatformLink || isGenericPlatformLink) && enrichedLink.includes('pncp.gov.br') && enrichedLink.includes('editais')) {
            try {
                const pncpMatch = enrichedLink.match(/editais\/(\d+)\/(\d+)\/(\d+)/);
                if (pncpMatch) {
                    const [, cnpj, ano, seq] = pncpMatch;
                    const enrichUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
                    logger_1.logger.info(`[AutoEnrich] 🔍 Buscando linkSistemaOrigem: ${enrichUrl}`);
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 10000);
                    try {
                        const apiRes = await fetch(enrichUrl, { signal: controller.signal });
                        clearTimeout(timeout);
                        if (apiRes.ok) {
                            const apiData = await apiRes.json();
                            const platformUrl = (apiData.linkSistemaOrigem || '').trim();
                            logger_1.logger.info(`[AutoEnrich] 📋 linkSistemaOrigem=${platformUrl ? platformUrl.substring(0, 80) : 'VAZIO'}`);
                            if (platformUrl && (0, biddingHelpers_1.hasMonitorableDomain)(platformUrl)) {
                                const existingParts = enrichedLink.split(',').map((s) => s.trim());
                                if (isGenericPlatformLink) {
                                    const platformDomain = (() => {
                                        try {
                                            return new URL(platformUrl).hostname.replace('www.', '');
                                        }
                                        catch {
                                            return '';
                                        }
                                    })();
                                    const filteredParts = existingParts.filter((part) => {
                                        try {
                                            const partDomain = new URL(part).hostname.replace('www.', '');
                                            return partDomain !== platformDomain;
                                        }
                                        catch {
                                            return true;
                                        }
                                    });
                                    filteredParts.push(platformUrl);
                                    enrichedLink = filteredParts.join(', ');
                                    biddingData.link = enrichedLink;
                                    logger_1.logger.info(`[AutoEnrich] 🔄 Link genérico SUBSTITUÍDO pelo funcional: ${platformUrl.substring(0, 60)}`);
                                }
                                else if (!existingParts.some((part) => part === platformUrl)) {
                                    enrichedLink = `${enrichedLink}, ${platformUrl}`;
                                    biddingData.link = enrichedLink;
                                    logger_1.logger.info(`[AutoEnrich] ✅ Link monitorável adicionado: ${platformUrl.substring(0, 60)}`);
                                }
                                biddingData.portal = (0, biddingHelpers_1.normalizePortal)(biddingData.portal, enrichedLink);
                            }
                            else if (platformUrl) {
                                const existingParts = enrichedLink.split(',').map((s) => s.trim());
                                if (!existingParts.some((part) => part === platformUrl)) {
                                    enrichedLink = `${enrichedLink}, ${platformUrl}`;
                                    biddingData.link = enrichedLink;
                                }
                                logger_1.logger.info(`[AutoEnrich] ⚠️ linkSistemaOrigem is not monitorable: ${platformUrl.substring(0, 60)} — portal: ${biddingData.portal}`);
                            }
                            else {
                                logger_1.logger.info(`[AutoEnrich] ⚠️ linkSistemaOrigem VAZIO para ${cnpj}/${ano}/${seq}`);
                            }
                        }
                        else {
                            logger_1.logger.info(`[AutoEnrich] ⚠️ API retornou status ${apiRes.status} para ${cnpj}/${ano}/${seq}`);
                        }
                    }
                    catch (fetchErr) {
                        clearTimeout(timeout);
                        logger_1.logger.warn(`[AutoEnrich] ⏱️ Fetch falhou (timeout ou rede): ${fetchErr.message}`);
                    }
                }
            }
            catch (e) {
                logger_1.logger.warn('[AutoEnrich] Failed to fetch platform link:', e);
            }
        }
        else if (!hasPlatformLink) {
            logger_1.logger.info(`[AutoEnrich] ⏭ Skipped: link="${enrichedLink?.substring(0, 60)}" hasPlatform=${hasPlatformLink} pncp=${enrichedLink.includes('pncp.gov.br')} editais=${enrichedLink.includes('editais')}`);
        }
        // ── Step 2: Auto-enable monitoring for all supported platforms ──
        const portalLower = (biddingData.portal || '').toLowerCase();
        const isComprasGovPortal = portalLower.includes('compras.gov') || portalLower.includes('comprasnet');
        if ((0, biddingHelpers_1.hasMonitorableDomain)(enrichedLink) || isComprasGovPortal) {
            biddingData.isMonitored = true;
            if (isComprasGovPortal && !(0, biddingHelpers_1.hasMonitorableDomain)(enrichedLink)) {
                logger_1.logger.info(`[AutoMonitor] Auto-enabled monitoring for Compras.gov.br process (needs cnetmobile link for worker). Portal: ${biddingData.portal}`);
            }
            else {
                logger_1.logger.info(`[AutoMonitor] Auto-enabled monitoring for new process (portal: ${biddingData.portal})`);
            }
        }
        // ── Step 3: Auto-backfill pncpLink from link ──
        if (!biddingData.pncpLink) {
            const allLinks = (biddingData.link || '').split(',').map((s) => s.trim());
            const pncpUrl = allLinks.find((s) => s.includes('pncp.gov.br/app/editais'));
            if (pncpUrl)
                biddingData.pncpLink = pncpUrl;
        }
        const bidding = await prisma_1.default.biddingProcess.create({
            data: { ...biddingData, tenantId, companyProfileId }
        });
        res.json(bidding);
    }
    catch (error) {
        logger_1.logger.error("Create bidding error:", error);
        (0, errorHandler_1.handleApiError)(res, error, 'create-bidding');
    }
});
// ── PUT /biddings/:id/oracle-evidence — Persist oracle evidence ──
router.put('/:id/oracle-evidence', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { oracleEvidence } = req.body;
        const tenantId = req.user.tenantId;
        const bidding = await prisma_1.default.biddingProcess.findFirst({
            where: { id, tenantId },
            include: { aiAnalysis: true }
        });
        if (!bidding) {
            return res.status(404).json({ error: 'Processo não encontrado.' });
        }
        if (bidding.aiAnalysis) {
            const existingSchema = bidding.aiAnalysis.schemaV2 || {};
            await prisma_1.default.aiAnalysis.update({
                where: { id: bidding.aiAnalysis.id },
                data: {
                    schemaV2: {
                        ...existingSchema,
                        oracle_evidence: oracleEvidence
                    }
                }
            });
            logger_1.logger.info(`[Oracle] Evidências persistidas para bidding ${id} (${Object.keys(oracleEvidence || {}).length} exigências)`);
        }
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error('[Oracle Evidence]', error);
        res.status(500).json({ error: 'Falha ao persistir evidências.' });
    }
});
// ── PUT /biddings/:id — Update bidding ──
router.put('/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;
        const { companyProfileId, ...rawData } = req.body;
        const biddingData = (0, biddingHelpers_1.sanitizeBiddingData)(rawData);
        // ── Step 0: Normalize portal & modality ──
        if (biddingData.portal !== undefined) {
            biddingData.portal = (0, biddingHelpers_1.normalizePortal)(biddingData.portal || '', biddingData.link);
        }
        if (biddingData.modality !== undefined && biddingData.modality) {
            biddingData.modality = (0, biddingHelpers_1.normalizeModality)(biddingData.modality);
        }
        // ── Step 1: Auto-enrich — fetch platform link from PNCP API if missing ──
        let enrichedLink = biddingData.link || '';
        const hasPlatformLink = (0, biddingHelpers_1.hasMonitorableDomain)(enrichedLink);
        const isGenericPlatformLink = hasPlatformLink && (() => {
            const l = enrichedLink.toLowerCase();
            if (l.includes('bllcompras') && !l.includes('param1=') && !l.includes('processview'))
                return true;
            if (l.includes('m2atecnologia') && !l.includes('/certame/') && !l.includes('precodereferencia'))
                return true;
            return false;
        })();
        if ((!hasPlatformLink || isGenericPlatformLink) && enrichedLink.includes('pncp.gov.br') && enrichedLink.includes('editais')) {
            try {
                const pncpMatch = enrichedLink.match(/editais\/(\d+)\/(\d+)\/(\d+)/);
                if (pncpMatch) {
                    const [, cnpj, ano, seq] = pncpMatch;
                    const enrichUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
                    logger_1.logger.info(`[AutoEnrich] 🔍 Update: Buscando linkSistemaOrigem: ${enrichUrl}`);
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 10000);
                    try {
                        const apiRes = await fetch(enrichUrl, { signal: controller.signal });
                        clearTimeout(timeout);
                        if (apiRes.ok) {
                            const apiData = await apiRes.json();
                            const platformUrl = (apiData.linkSistemaOrigem || '').trim();
                            logger_1.logger.info(`[AutoEnrich] 📋 Update: linkSistemaOrigem=${platformUrl ? platformUrl.substring(0, 80) : 'VAZIO'}`);
                            if (platformUrl && (0, biddingHelpers_1.hasMonitorableDomain)(platformUrl)) {
                                const existingParts = enrichedLink.split(',').map((s) => s.trim());
                                if (isGenericPlatformLink) {
                                    const platformDomain = (() => {
                                        try {
                                            return new URL(platformUrl).hostname.replace('www.', '');
                                        }
                                        catch {
                                            return '';
                                        }
                                    })();
                                    const filteredParts = existingParts.filter((part) => {
                                        try {
                                            const partDomain = new URL(part).hostname.replace('www.', '');
                                            return partDomain !== platformDomain;
                                        }
                                        catch {
                                            return true;
                                        }
                                    });
                                    filteredParts.push(platformUrl);
                                    enrichedLink = filteredParts.join(', ');
                                    biddingData.link = enrichedLink;
                                    logger_1.logger.info(`[AutoEnrich] 🔄 Update: Link genérico SUBSTITUÍDO pelo funcional: ${platformUrl.substring(0, 60)}`);
                                }
                                else if (!existingParts.some((part) => part === platformUrl)) {
                                    enrichedLink = `${enrichedLink}, ${platformUrl}`;
                                    biddingData.link = enrichedLink;
                                    logger_1.logger.info(`[AutoEnrich] ✅ Update: link monitorável adicionado para "${id}": ${platformUrl.substring(0, 60)}`);
                                }
                                if (biddingData.portal !== undefined) {
                                    biddingData.portal = (0, biddingHelpers_1.normalizePortal)(biddingData.portal, enrichedLink);
                                }
                            }
                            else if (platformUrl) {
                                const existingParts = enrichedLink.split(',').map((s) => s.trim());
                                if (!existingParts.some((part) => part === platformUrl)) {
                                    enrichedLink = `${enrichedLink}, ${platformUrl}`;
                                    biddingData.link = enrichedLink;
                                }
                                logger_1.logger.info(`[AutoEnrich] ⚠️ linkSistemaOrigem is not monitorable for "${id}": ${platformUrl.substring(0, 60)} — portal: ${biddingData.portal || 'N/A'}`);
                            }
                        }
                    }
                    catch (fetchErr) {
                        clearTimeout(timeout);
                        logger_1.logger.warn(`[AutoEnrich] ⏱️ Update fetch falhou: ${fetchErr.message}`);
                    }
                }
            }
            catch (e) {
                logger_1.logger.warn('[AutoEnrich] Failed to fetch platform link:', e);
            }
        }
        // ── Step 2: Auto-enable monitoring for all supported platforms ──
        const putPortalLower = (biddingData.portal || '').toLowerCase();
        const isPutComprasGovPortal = putPortalLower.includes('compras.gov') || putPortalLower.includes('comprasnet');
        if (biddingData.isMonitored === undefined) {
            const shouldAutoMonitor = (0, biddingHelpers_1.hasMonitorableDomain)(enrichedLink) || isPutComprasGovPortal;
            if (shouldAutoMonitor) {
                const current = await prisma_1.default.biddingProcess.findUnique({ where: { id }, select: { isMonitored: true } });
                if (current && !current.isMonitored) {
                    biddingData.isMonitored = true;
                    logger_1.logger.info(`[AutoMonitor] Auto-enabled monitoring for "${id}" (portal: ${biddingData.portal || 'N/A'})`);
                }
            }
        }
        // ── Step 3: Auto-backfill pncpLink from link ──
        if (!biddingData.pncpLink) {
            const allLinks = (biddingData.link || '').split(',').map((s) => s.trim());
            const pncpUrl = allLinks.find((s) => s.includes('pncp.gov.br/app/editais'));
            if (pncpUrl)
                biddingData.pncpLink = pncpUrl;
        }
        const bidding = await prisma_1.default.biddingProcess.update({
            where: {
                id,
                tenantId // Ensure user can only update their own tenant's data
            },
            data: {
                ...biddingData,
                companyProfileId: companyProfileId === '' ? null : companyProfileId
            }
        });
        res.json(bidding);
    }
    catch (error) {
        logger_1.logger.error("Update bidding error:", error);
        (0, errorHandler_1.handleApiError)(res, error, 'update-bidding');
    }
});
// ── DELETE /biddings/:id — Delete bidding ──
router.delete('/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const bidding = await prisma_1.default.biddingProcess.findUnique({ where: { id } });
        if (bidding && bidding.tenantId === req.user.tenantId) {
            await prisma_1.default.biddingProcess.delete({ where: { id } });
            res.json({ success: true });
        }
        else {
            res.status(404).json({ error: 'Bidding not found or unauthorized' });
        }
    }
    catch (error) {
        logger_1.logger.error("Delete bidding error:", error);
        res.status(500).json({ error: 'Failed to delete bidding' });
    }
});
exports.default = router;
