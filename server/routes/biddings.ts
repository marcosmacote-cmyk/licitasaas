/**
 * ══════════════════════════════════════════════════════════
 *  Bidding Routes — CRUD + AutoEnrich + AutoMonitor
 *  Extracted from server/index.ts (Sprint 8.1)
 * ══════════════════════════════════════════════════════════
 */
import express from 'express';
import prisma from '../lib/prisma';
import { authenticateToken } from '../middlewares/auth';
import { logger } from '../lib/logger';
import { handleApiError } from '../middlewares/errorHandler';
import {
    sanitizeBiddingData,
    normalizePortal,
    normalizeModality,
    hasMonitorableDomain,
} from '../lib/biddingHelpers';

const router = express.Router();

// ── GET /biddings — List all biddings for tenant ──
router.get('/', authenticateToken, async (req: any, res) => {
    try {
        const biddings = await prisma.biddingProcess.findMany({
            where: { tenantId: req.user.tenantId },
            include: { aiAnalysis: true }
        });
        res.json(biddings);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch biddings' });
    }
});

// ── POST /biddings — Create new bidding ──
router.post('/', authenticateToken, async (req: any, res) => {
    try {
        let { companyProfileId, ...rawData } = req.body;
        const tenantId = req.user.tenantId;
        let biddingData = sanitizeBiddingData(rawData);

        if (companyProfileId === '') {
            companyProfileId = null;
        }

        // ── Step 0: Normalize portal & modality ──
        biddingData.portal = normalizePortal(biddingData.portal || '', biddingData.link);
        if (biddingData.modality) biddingData.modality = normalizeModality(biddingData.modality);

        // ── Step 1: Auto-enrich — fetch platform link from PNCP API if missing ──
        let enrichedLink = biddingData.link || '';
        const hasPlatformLink = hasMonitorableDomain(enrichedLink);

        // Check if the platform link is "functional" (has the params needed for chat monitoring).
        const isGenericPlatformLink = hasPlatformLink && (() => {
            const l = enrichedLink.toLowerCase();
            if (l.includes('bllcompras') && !l.includes('param1=') && !l.includes('processview')) return true;
            if (l.includes('m2atecnologia') && !l.includes('/certame/') && !l.includes('precodereferencia')) return true;
            return false;
        })();

        if ((!hasPlatformLink || isGenericPlatformLink) && enrichedLink.includes('pncp.gov.br') && enrichedLink.includes('editais')) {
            try {
                const pncpMatch = enrichedLink.match(/editais\/(\d+)\/(\d+)\/(\d+)/);
                if (pncpMatch) {
                    const [, cnpj, ano, seq] = pncpMatch;
                    const enrichUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
                    logger.info(`[AutoEnrich] 🔍 Buscando linkSistemaOrigem: ${enrichUrl}`);
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 10000);
                    try {
                        const apiRes = await fetch(enrichUrl, { signal: controller.signal });
                        clearTimeout(timeout);
                        if (apiRes.ok) {
                            const apiData = await apiRes.json();
                            const platformUrl = (apiData.linkSistemaOrigem || '').trim();
                            logger.info(`[AutoEnrich] 📋 linkSistemaOrigem=${platformUrl ? platformUrl.substring(0, 80) : 'VAZIO'}`);
                            if (platformUrl && hasMonitorableDomain(platformUrl)) {
                                const existingParts = enrichedLink.split(',').map((s: string) => s.trim());
                                
                                if (isGenericPlatformLink) {
                                    const platformDomain = (() => {
                                        try { return new URL(platformUrl).hostname.replace('www.', ''); } catch { return ''; }
                                    })();
                                    const filteredParts = existingParts.filter((part: string) => {
                                        try {
                                            const partDomain = new URL(part).hostname.replace('www.', '');
                                            return partDomain !== platformDomain;
                                        } catch { return true; }
                                    });
                                    filteredParts.push(platformUrl);
                                    enrichedLink = filteredParts.join(', ');
                                    biddingData.link = enrichedLink;
                                    logger.info(`[AutoEnrich] 🔄 Link genérico SUBSTITUÍDO pelo funcional: ${platformUrl.substring(0, 60)}`);
                                } else if (!existingParts.some((part: string) => part === platformUrl)) {
                                    enrichedLink = `${enrichedLink}, ${platformUrl}`;
                                    biddingData.link = enrichedLink;
                                    logger.info(`[AutoEnrich] ✅ Link monitorável adicionado: ${platformUrl.substring(0, 60)}`);
                                }
                                biddingData.portal = normalizePortal(biddingData.portal, enrichedLink);
                            } else if (platformUrl) {
                                const existingParts = enrichedLink.split(',').map((s: string) => s.trim());
                                if (!existingParts.some((part: string) => part === platformUrl)) {
                                    enrichedLink = `${enrichedLink}, ${platformUrl}`;
                                    biddingData.link = enrichedLink;
                                }
                                logger.info(`[AutoEnrich] ⚠️ linkSistemaOrigem is not monitorable: ${platformUrl.substring(0, 60)} — portal: ${biddingData.portal}`);
                            } else {
                                logger.info(`[AutoEnrich] ⚠️ linkSistemaOrigem VAZIO para ${cnpj}/${ano}/${seq}`);
                            }
                        } else {
                            logger.info(`[AutoEnrich] ⚠️ API retornou status ${apiRes.status} para ${cnpj}/${ano}/${seq}`);
                        }
                    } catch (fetchErr: any) {
                        clearTimeout(timeout);
                        logger.warn(`[AutoEnrich] ⏱️ Fetch falhou (timeout ou rede): ${fetchErr.message}`);
                    }
                }
            } catch (e) {
                logger.warn('[AutoEnrich] Failed to fetch platform link:', e);
            }
        } else if (!hasPlatformLink) {
            logger.info(`[AutoEnrich] ⏭ Skipped: link="${enrichedLink?.substring(0, 60)}" hasPlatform=${hasPlatformLink} pncp=${enrichedLink.includes('pncp.gov.br')} editais=${enrichedLink.includes('editais')}`);
        }

        // ── Step 2: Auto-enable monitoring for all supported platforms ──
        const portalLower = (biddingData.portal || '').toLowerCase();
        const isComprasGovPortal = portalLower.includes('compras.gov') || portalLower.includes('comprasnet');
        if (hasMonitorableDomain(enrichedLink) || isComprasGovPortal) {
            biddingData.isMonitored = true;
            if (isComprasGovPortal && !hasMonitorableDomain(enrichedLink)) {
                logger.info(`[AutoMonitor] Auto-enabled monitoring for Compras.gov.br process (needs cnetmobile link for worker). Portal: ${biddingData.portal}`);
            } else {
                logger.info(`[AutoMonitor] Auto-enabled monitoring for new process (portal: ${biddingData.portal})`);
            }
        }

        // ── Step 3: Auto-backfill pncpLink from link ──
        if (!biddingData.pncpLink) {
            const allLinks = (biddingData.link || '').split(',').map((s: string) => s.trim());
            const pncpUrl = allLinks.find((s: string) => s.includes('pncp.gov.br/app/editais'));
            if (pncpUrl) biddingData.pncpLink = pncpUrl;
        }

        const bidding = await prisma.biddingProcess.create({
            data: { ...biddingData, tenantId, companyProfileId } as any
        });
        res.json(bidding);
    } catch (error) {
        logger.error("Create bidding error:", error);
        handleApiError(res, error, 'create-bidding');
    }
});

// ── PUT /biddings/:id/oracle-evidence — Persist oracle evidence ──
router.put('/:id/oracle-evidence', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const { oracleEvidence } = req.body;
        const tenantId = req.user.tenantId;

        const bidding = await prisma.biddingProcess.findFirst({
            where: { id, tenantId },
            include: { aiAnalysis: true }
        });

        if (!bidding) {
            return res.status(404).json({ error: 'Processo não encontrado.' });
        }

        if (bidding.aiAnalysis) {
            const existingSchema = (bidding.aiAnalysis.schemaV2 as any) || {};
            await prisma.aiAnalysis.update({
                where: { id: bidding.aiAnalysis.id },
                data: {
                    schemaV2: {
                        ...existingSchema,
                        oracle_evidence: oracleEvidence
                    }
                }
            });
            logger.info(`[Oracle] Evidências persistidas para bidding ${id} (${Object.keys(oracleEvidence || {}).length} exigências)`);
        }

        res.json({ success: true });
    } catch (error: any) {
        logger.error('[Oracle Evidence]', error);
        res.status(500).json({ error: 'Falha ao persistir evidências.' });
    }
});

// ── PUT /biddings/:id — Update bidding ──
router.put('/:id', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;

        const { companyProfileId, ...rawData } = req.body;
        const biddingData = sanitizeBiddingData(rawData);

        // ── Step 0: Normalize portal & modality ──
        if (biddingData.portal !== undefined) {
            biddingData.portal = normalizePortal(biddingData.portal || '', biddingData.link);
        }
        if (biddingData.modality !== undefined && biddingData.modality) {
            biddingData.modality = normalizeModality(biddingData.modality);
        }

        // ── Step 1: Auto-enrich — fetch platform link from PNCP API if missing ──
        let enrichedLink = biddingData.link || '';
        const hasPlatformLink = hasMonitorableDomain(enrichedLink);

        const isGenericPlatformLink = hasPlatformLink && (() => {
            const l = enrichedLink.toLowerCase();
            if (l.includes('bllcompras') && !l.includes('param1=') && !l.includes('processview')) return true;
            if (l.includes('m2atecnologia') && !l.includes('/certame/') && !l.includes('precodereferencia')) return true;
            return false;
        })();

        if ((!hasPlatformLink || isGenericPlatformLink) && enrichedLink.includes('pncp.gov.br') && enrichedLink.includes('editais')) {
            try {
                const pncpMatch = enrichedLink.match(/editais\/(\d+)\/(\d+)\/(\d+)/);
                if (pncpMatch) {
                    const [, cnpj, ano, seq] = pncpMatch;
                    const enrichUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
                    logger.info(`[AutoEnrich] 🔍 Update: Buscando linkSistemaOrigem: ${enrichUrl}`);
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 10000);
                    try {
                        const apiRes = await fetch(enrichUrl, { signal: controller.signal });
                        clearTimeout(timeout);
                        if (apiRes.ok) {
                            const apiData = await apiRes.json();
                            const platformUrl = (apiData.linkSistemaOrigem || '').trim();
                            logger.info(`[AutoEnrich] 📋 Update: linkSistemaOrigem=${platformUrl ? platformUrl.substring(0, 80) : 'VAZIO'}`);
                            if (platformUrl && hasMonitorableDomain(platformUrl)) {
                                const existingParts = enrichedLink.split(',').map((s: string) => s.trim());
                                
                                if (isGenericPlatformLink) {
                                    const platformDomain = (() => {
                                        try { return new URL(platformUrl).hostname.replace('www.', ''); } catch { return ''; }
                                    })();
                                    const filteredParts = existingParts.filter((part: string) => {
                                        try {
                                            const partDomain = new URL(part).hostname.replace('www.', '');
                                            return partDomain !== platformDomain;
                                        } catch { return true; }
                                    });
                                    filteredParts.push(platformUrl);
                                    enrichedLink = filteredParts.join(', ');
                                    biddingData.link = enrichedLink;
                                    logger.info(`[AutoEnrich] 🔄 Update: Link genérico SUBSTITUÍDO pelo funcional: ${platformUrl.substring(0, 60)}`);
                                } else if (!existingParts.some((part: string) => part === platformUrl)) {
                                    enrichedLink = `${enrichedLink}, ${platformUrl}`;
                                    biddingData.link = enrichedLink;
                                    logger.info(`[AutoEnrich] ✅ Update: link monitorável adicionado para "${id}": ${platformUrl.substring(0, 60)}`);
                                }
                                if (biddingData.portal !== undefined) {
                                    biddingData.portal = normalizePortal(biddingData.portal, enrichedLink);
                                }
                            } else if (platformUrl) {
                                const existingParts = enrichedLink.split(',').map((s: string) => s.trim());
                                if (!existingParts.some((part: string) => part === platformUrl)) {
                                    enrichedLink = `${enrichedLink}, ${platformUrl}`;
                                    biddingData.link = enrichedLink;
                                }
                                logger.info(`[AutoEnrich] ⚠️ linkSistemaOrigem is not monitorable for "${id}": ${platformUrl.substring(0, 60)} — portal: ${biddingData.portal || 'N/A'}`);
                            }
                        }
                    } catch (fetchErr: any) {
                        clearTimeout(timeout);
                        logger.warn(`[AutoEnrich] ⏱️ Update fetch falhou: ${fetchErr.message}`);
                    }
                }
            } catch (e) {
                logger.warn('[AutoEnrich] Failed to fetch platform link:', e);
            }
        }

        // ── Step 2: Auto-enable monitoring for all supported platforms ──
        const putPortalLower = (biddingData.portal || '').toLowerCase();
        const isPutComprasGovPortal = putPortalLower.includes('compras.gov') || putPortalLower.includes('comprasnet');
        if (biddingData.isMonitored === undefined) {
            const shouldAutoMonitor = hasMonitorableDomain(enrichedLink) || isPutComprasGovPortal;
            if (shouldAutoMonitor) {
                const current = await prisma.biddingProcess.findUnique({ where: { id }, select: { isMonitored: true } });
                if (current && !current.isMonitored) {
                    biddingData.isMonitored = true;
                    logger.info(`[AutoMonitor] Auto-enabled monitoring for "${id}" (portal: ${biddingData.portal || 'N/A'})`);
                }
            }
        }

        // ── Step 3: Auto-backfill pncpLink from link ──
        if (!biddingData.pncpLink) {
            const allLinks = (biddingData.link || '').split(',').map((s: string) => s.trim());
            const pncpUrl = allLinks.find((s: string) => s.includes('pncp.gov.br/app/editais'));
            if (pncpUrl) biddingData.pncpLink = pncpUrl;
        }

        const bidding = await prisma.biddingProcess.update({
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
    } catch (error) {
        logger.error("Update bidding error:", error);
        handleApiError(res, error, 'update-bidding');
    }
});

// ── DELETE /biddings/:id — Delete bidding ──
router.delete('/:id', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const bidding = await prisma.biddingProcess.findUnique({ where: { id } });

        if (bidding && bidding.tenantId === req.user.tenantId) {
            await prisma.biddingProcess.delete({ where: { id } });
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Bidding not found or unauthorized' });
        }
    } catch (error) {
        logger.error("Delete bidding error:", error);
        res.status(500).json({ error: 'Failed to delete bidding' });
    }
});

export default router;
