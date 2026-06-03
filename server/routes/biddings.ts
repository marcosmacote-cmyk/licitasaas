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
import { planGuard } from '../middlewares/planGuard';
import { checkTenantLimits } from '../lib/planLimits';

const router = express.Router();

// ── GET /biddings — List all biddings for tenant ──
// NOTE: Previously used `include: { aiAnalysis: true }` which returned 7+ MB
// of JSON (schemaV2 contains huge structured extraction data per process).
// Now we exclude schemaV2 to reduce payload from ~7MB to ~500KB.
router.get('/', authenticateToken, async (req: any, res) => {
    try {
        const biddings = await prisma.biddingProcess.findMany({
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
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch biddings' });
    }
});

// ── GET /biddings/:id — Get a single bidding with full AI Analysis ──
router.get('/:id', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const bidding = await prisma.biddingProcess.findUnique({
            where: { id, tenantId: req.user.tenantId },
            include: { aiAnalysis: true }
        });
        
        if (!bidding) {
            return res.status(404).json({ error: 'Processo não encontrado.' });
        }
        res.json(bidding);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch bidding' });
    }
});

// ── POST /biddings — Create new bidding ──
router.post('/', authenticateToken, planGuard, async (req: any, res) => {
    try {
        let { companyProfileId, ...rawData } = req.body;
        const tenantId = req.user.tenantId;

        // Verify plan limits
        const limitCheck = await checkTenantLimits(tenantId, 'biddings');
        if (!limitCheck.allowed) {
            return res.status(403).json({ error: limitCheck.message });
        }

        let biddingData = sanitizeBiddingData(rawData);

        if (companyProfileId === '') {
            companyProfileId = null;
        }

        // ── Step 0: Normalize portal & modality ──
        biddingData.portal = normalizePortal(biddingData.portal || '', biddingData.link);
        if (biddingData.modality) biddingData.modality = normalizeModality(biddingData.modality);

        // ── Step 2 (preliminary): Auto-enable monitoring for all supported platforms ──
        const portalLower = (biddingData.portal || '').toLowerCase();
        const isComprasGovPortal = portalLower.includes('compras.gov') || portalLower.includes('comprasnet');
        if (hasMonitorableDomain(biddingData.link || '') || isComprasGovPortal) {
            biddingData.isMonitored = true;
        }

        // ── Step 3 (preliminary): Auto-backfill pncpLink from link ──
        if (!biddingData.pncpLink && biddingData.link) {
            const allLinks = biddingData.link.split(',').map((s: string) => s.trim());
            const pncpUrl = allLinks.find((s: string) => s.includes('pncp.gov.br/app/editais'));
            if (pncpUrl) biddingData.pncpLink = pncpUrl;
        }

        const bidding = await prisma.biddingProcess.create({
            data: { ...biddingData, tenantId, companyProfileId } as any
        });
        res.json(bidding);

        // ── Step 1: Auto-enrich — fetch platform link from PNCP API asynchronously in background ──
        const enrichedLink = biddingData.link || '';
        const hasPlatformLink = hasMonitorableDomain(enrichedLink);

        const isGenericPlatformLink = hasPlatformLink && (() => {
            const l = enrichedLink.toLowerCase();
            if (l.includes('bllcompras') && !l.includes('param1=') && !l.includes('processview')) return true;
            if (l.includes('m2atecnologia') && !l.includes('/certame/') && !l.includes('precodereferencia')) return true;
            return false;
        })();

        if ((!hasPlatformLink || isGenericPlatformLink) && enrichedLink.includes('pncp.gov.br') && enrichedLink.includes('editais')) {
            setImmediate(async () => {
                try {
                    const pncpMatch = enrichedLink.match(/editais\/(\d+)\/(\d+)\/(\d+)/);
                    if (pncpMatch) {
                        const [, cnpj, ano, seq] = pncpMatch;
                        const enrichUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
                        logger.info(`[AutoEnrich] [Background] 🔍 Buscando linkSistemaOrigem para ${bidding.id}: ${enrichUrl}`);
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 10000);
                        try {
                            const apiRes = await fetch(enrichUrl, { signal: controller.signal });
                            clearTimeout(timeout);
                            if (apiRes.ok) {
                                const apiData = await apiRes.json();
                                const platformUrl = (apiData.linkSistemaOrigem || '').trim();
                                logger.info(`[AutoEnrich] [Background] 📋 linkSistemaOrigem para ${bidding.id} = ${platformUrl ? platformUrl.substring(0, 80) : 'VAZIO'}`);
                                if (platformUrl) {
                                    let finalLink = enrichedLink;
                                    let finalPortal = biddingData.portal || '';
                                    let finalIsMonitored = bidding.isMonitored;

                                    if (hasMonitorableDomain(platformUrl)) {
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
                                            finalLink = filteredParts.join(', ');
                                        } else if (!existingParts.some((part: string) => part === platformUrl)) {
                                            finalLink = `${enrichedLink}, ${platformUrl}`;
                                        }
                                        finalPortal = normalizePortal(biddingData.portal || '', finalLink);
                                        const finalPortalLower = finalPortal.toLowerCase();
                                        const isFinalComprasGov = finalPortalLower.includes('compras.gov') || finalPortalLower.includes('comprasnet');
                                        if (hasMonitorableDomain(finalLink) || isFinalComprasGov) {
                                            finalIsMonitored = true;
                                        }
                                    } else {
                                        const existingParts = enrichedLink.split(',').map((s: string) => s.trim());
                                        if (!existingParts.some((part: string) => part === platformUrl)) {
                                            finalLink = `${enrichedLink}, ${platformUrl}`;
                                        }
                                    }

                                    let finalPncpLink = bidding.pncpLink;
                                    if (!finalPncpLink) {
                                        const allLinks = finalLink.split(',').map((s: string) => s.trim());
                                        const pncpUrl = allLinks.find((s: string) => s.includes('pncp.gov.br/app/editais'));
                                        if (pncpUrl) finalPncpLink = pncpUrl;
                                    }

                                    await prisma.biddingProcess.update({
                                        where: { id: bidding.id },
                                        data: {
                                            link: finalLink,
                                            portal: finalPortal,
                                            isMonitored: finalIsMonitored,
                                            pncpLink: finalPncpLink
                                        }
                                    });
                                    logger.info(`[AutoEnrich] [Background] ✅ Processo ${bidding.id} enriquecido com sucesso.`);
                                }
                            } else {
                                logger.info(`[AutoEnrich] [Background] ⚠️ API retornou status ${apiRes.status} para ${cnpj}/${ano}/${seq}`);
                            }
                        } catch (fetchErr: any) {
                            clearTimeout(timeout);
                            logger.warn(`[AutoEnrich] [Background] ⏱️ Fetch falhou (timeout ou rede): ${fetchErr.message}`);
                        }
                    }
                } catch (e: any) {
                    logger.warn(`[AutoEnrich] [Background] Falha geral no enriquecimento do processo ${bidding.id}: ${e.message}`);
                }
            });
        }
        res.json(bidding);
    } catch (error) {
        logger.error("Create bidding error:", error);
        handleApiError(res, error, 'create-bidding');
    }
});

// ── PUT /biddings/:id/oracle-evidence — Persist oracle evidence ──
router.put('/:id/oracle-evidence', authenticateToken, planGuard, async (req: any, res) => {
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
router.put('/:id', authenticateToken, planGuard, async (req: any, res) => {
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

        // ── Step 2 (preliminary): Auto-enable monitoring for all supported platforms ──
        const putPortalLower = (biddingData.portal || '').toLowerCase();
        const isPutComprasGovPortal = putPortalLower.includes('compras.gov') || putPortalLower.includes('comprasnet');
        if (biddingData.isMonitored === undefined) {
            const shouldAutoMonitor = hasMonitorableDomain(biddingData.link || '') || isPutComprasGovPortal;
            if (shouldAutoMonitor) {
                biddingData.isMonitored = true;
            }
        }

        // ── Step 3 (preliminary): Auto-backfill pncpLink from link ──
        if (!biddingData.pncpLink && biddingData.link) {
            const allLinks = biddingData.link.split(',').map((s: string) => s.trim());
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

        // ── Step 1: Auto-enrich — fetch platform link from PNCP API asynchronously in background ──
        const enrichedLink = biddingData.link || '';
        const hasPlatformLink = hasMonitorableDomain(enrichedLink);

        const isGenericPlatformLink = hasPlatformLink && (() => {
            const l = enrichedLink.toLowerCase();
            if (l.includes('bllcompras') && !l.includes('param1=') && !l.includes('processview')) return true;
            if (l.includes('m2atecnologia') && !l.includes('/certame/') && !l.includes('precodereferencia')) return true;
            return false;
        })();

        if ((!hasPlatformLink || isGenericPlatformLink) && enrichedLink.includes('pncp.gov.br') && enrichedLink.includes('editais')) {
            setImmediate(async () => {
                try {
                    const pncpMatch = enrichedLink.match(/editais\/(\d+)\/(\d+)\/(\d+)/);
                    if (pncpMatch) {
                        const [, cnpj, ano, seq] = pncpMatch;
                        const enrichUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
                        logger.info(`[AutoEnrich] [Background Update] 🔍 Buscando linkSistemaOrigem para ${bidding.id}: ${enrichUrl}`);
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 10000);
                        try {
                            const apiRes = await fetch(enrichUrl, { signal: controller.signal });
                            clearTimeout(timeout);
                            if (apiRes.ok) {
                                const apiData = await apiRes.json();
                                const platformUrl = (apiData.linkSistemaOrigem || '').trim();
                                logger.info(`[AutoEnrich] [Background Update] 📋 linkSistemaOrigem para ${bidding.id} = ${platformUrl ? platformUrl.substring(0, 80) : 'VAZIO'}`);
                                if (platformUrl) {
                                    let finalLink = enrichedLink;
                                    let finalPortal = biddingData.portal || bidding.portal || '';
                                    let finalIsMonitored = bidding.isMonitored;

                                    if (hasMonitorableDomain(platformUrl)) {
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
                                            finalLink = filteredParts.join(', ');
                                        } else if (!existingParts.some((part: string) => part === platformUrl)) {
                                            finalLink = `${enrichedLink}, ${platformUrl}`;
                                        }
                                        finalPortal = normalizePortal(finalPortal, finalLink);
                                        const finalPortalLower = finalPortal.toLowerCase();
                                        const isFinalComprasGov = finalPortalLower.includes('compras.gov') || finalPortalLower.includes('comprasnet');
                                        if (hasMonitorableDomain(finalLink) || isFinalComprasGov) {
                                            finalIsMonitored = true;
                                        }
                                    } else {
                                        const existingParts = enrichedLink.split(',').map((s: string) => s.trim());
                                        if (!existingParts.some((part: string) => part === platformUrl)) {
                                            finalLink = `${enrichedLink}, ${platformUrl}`;
                                        }
                                    }

                                    let finalPncpLink = bidding.pncpLink;
                                    if (!finalPncpLink) {
                                        const allLinks = finalLink.split(',').map((s: string) => s.trim());
                                        const pncpUrl = allLinks.find((s: string) => s.includes('pncp.gov.br/app/editais'));
                                        if (pncpUrl) finalPncpLink = pncpUrl;
                                    }

                                    await prisma.biddingProcess.update({
                                        where: { id: bidding.id },
                                        data: {
                                            link: finalLink,
                                            portal: finalPortal,
                                            isMonitored: finalIsMonitored,
                                            pncpLink: finalPncpLink
                                        }
                                    });
                                    logger.info(`[AutoEnrich] [Background Update] ✅ Processo ${bidding.id} enriquecido com sucesso.`);
                                }
                            }
                        } catch (fetchErr: any) {
                            clearTimeout(timeout);
                            logger.warn(`[AutoEnrich] [Background Update] ⏱️ Fetch falhou: ${fetchErr.message}`);
                        }
                    }
                } catch (e: any) {
                    logger.warn(`[AutoEnrich] [Background Update] Falha geral no enriquecimento do processo ${bidding.id}: ${e.message}`);
                }
            });
        }
        res.json(bidding);
    } catch (error) {
        logger.error("Update bidding error:", error);
        handleApiError(res, error, 'update-bidding');
    }
});

// ── DELETE /biddings/:id — Delete bidding ──
router.delete('/:id', authenticateToken, planGuard, async (req: any, res) => {
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
