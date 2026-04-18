/**
 * ══════════════════════════════════════════════════════════
 *  PNCP Routes — Saved Searches, Scanner, Favorites
 *  Extracted from server/index.ts (Sprint 8.1)
 * ══════════════════════════════════════════════════════════
 *
 *  NOTE: The /pncp/search and /pncp/analyze routes remain
 *  in index.ts due to their complexity and external deps.
 */
import express from 'express';
import prisma from '../lib/prisma';
import { authenticateToken } from '../middlewares/auth';
import { logger } from '../lib/logger';
import { handleApiError } from '../middlewares/errorHandler';
import axios from 'axios';
import https from 'https';

const router = express.Router();

// ══════════════════════════════════════════
// ── Saved Searches CRUD ──
// ══════════════════════════════════════════

router.get('/searches', authenticateToken, async (req: any, res) => {
    try {
        const searches = await prisma.pncpSavedSearch.findMany({
            where: { tenantId: req.user.tenantId },
            include: { company: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(searches);
    } catch (error) {
        logger.error("Fetch saved searches error:", error);
        res.status(500).json({ error: 'Failed to fetch saved searches' });
    }
});

router.post('/searches', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const search = await prisma.pncpSavedSearch.create({
            data: { ...req.body, tenantId }
        });
        res.json(search);
    } catch (error) {
        logger.error("Create saved search error:", error);
        res.status(500).json({ error: 'Failed to create saved search' });
    }
});

router.delete('/searches/:id', authenticateToken, async (req: any, res) => {
    try {
        const id = req.params.id;
        const tenantId = req.user.tenantId;
        await prisma.pncpSavedSearch.deleteMany({
            where: { id, tenantId }
        });
        res.json({ success: true });
    } catch (error) {
        logger.error("Delete saved search error:", error);
        res.status(500).json({ error: 'Failed to delete saved search' });
    }
});

// ── Update a single saved search ──
router.put('/searches/:id', authenticateToken, async (req: any, res) => {
    try {
        const id = req.params.id;
        const tenantId = req.user.tenantId;
        const { name, keywords, status, states, listName, companyProfileId } = req.body;
        const data: any = {};
        if (name !== undefined) data.name = name;
        if (keywords !== undefined) data.keywords = keywords;
        if (status !== undefined) data.status = status;
        if (states !== undefined) data.states = states;
        if (listName !== undefined) data.listName = listName;
        if (companyProfileId !== undefined) data.companyProfileId = companyProfileId || null;
        await prisma.pncpSavedSearch.updateMany({
            where: { id, tenantId },
            data
        });
        res.json({ success: true });
    } catch (error) {
        logger.error("Update saved search error:", error);
        res.status(500).json({ error: 'Failed to update saved search' });
    }
});

// ── Rename a saved search list (bulk update listName) ──
router.put('/searches/list/rename', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { oldName, newName } = req.body;
        if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName required' });
        await prisma.pncpSavedSearch.updateMany({
            where: { tenantId, listName: oldName },
            data: { listName: newName.trim() }
        });
        res.json({ success: true });
    } catch (error) {
        logger.error("Rename search list error:", error);
        res.status(500).json({ error: 'Failed to rename list' });
    }
});

// ── Delete a saved search list (migrate items to default) ──
router.delete('/searches/list/:name', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const listName = decodeURIComponent(req.params.name);
        if (listName === 'Pesquisas Gerais') return res.status(400).json({ error: 'Cannot delete default list' });
        // Move all searches from this list to the default list
        await prisma.pncpSavedSearch.updateMany({
            where: { tenantId, listName },
            data: { listName: 'Pesquisas Gerais' }
        });
        res.json({ success: true });
    } catch (error) {
        logger.error("Delete search list error:", error);
        res.status(500).json({ error: 'Failed to delete list' });
    }
});

// ══════════════════════════════════════════
// ── Opportunity Scanner ──
// ══════════════════════════════════════════

router.get('/scanner/status', authenticateToken, async (req: any, res) => {
    try {
        const globalConfig = await prisma.globalConfig.findUnique({
            where: { tenantId: req.user.tenantId }
        });
        if (!globalConfig) return res.json({ enabled: true });
        
        try {
            const conf = JSON.parse(globalConfig.config || '{}');
            res.json({ 
                enabled: conf.opportunityScannerEnabled !== false,
                lastScanAt: conf.lastScanAt || null,
                lastScanTotalNew: conf.lastScanTotalNew || 0,
                lastScanResults: conf.lastScanResults || [],
                nextScanAt: conf.nextScanAt || null,
            });
        } catch {
            res.json({ enabled: true });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to get scanner status' });
    }
});

router.post('/scanner/toggle', authenticateToken, async (req: any, res) => {
    try {
        const { enabled } = req.body;
        const tenantId = req.user.tenantId;

        const globalConfig = await prisma.globalConfig.upsert({
            where: { tenantId },
            update: {},
            create: { tenantId, config: '{}' }
        });

        let conf = {};
        try { conf = JSON.parse(globalConfig.config || '{}'); } catch {}
        
        (conf as any).opportunityScannerEnabled = enabled;

        await prisma.globalConfig.update({
            where: { tenantId },
            data: { config: JSON.stringify(conf) }
        });

        res.json({ success: true, enabled });
    } catch (error) {
        res.status(500).json({ error: 'Failed to toggle scanner status' });
    }
});

// ── Manual trigger for Opportunity Scanner ──
router.post('/scan-opportunities', authenticateToken, async (req: any, res) => {
    try {
        const { runOpportunityScan } = await import('../services/monitoring/opportunity-scanner.service');
        logger.info(`[OpportunityScanner] Manual scan triggered by tenant ${req.user.tenantId}`);
        // Run async — don't block the response
        runOpportunityScan(req.user.tenantId).catch(err => logger.error('[OpportunityScanner] Manual scan error:', err));
        res.json({ success: true, message: 'Varredura de oportunidades iniciada. Você receberá notificações se houver novos editais.' });
    } catch (error) {
        logger.error("Manual scan trigger error:", error);
        res.status(500).json({ error: 'Failed to trigger scan' });
    }
});

// ── List scanner-found opportunities ──
router.get('/scanner/opportunities', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const searchId = req.query.searchId as string | undefined;
        const page = parseInt(req.query.page as string) || 1;
        const pageSize = 50;

        const where: any = { tenantId };
        if (searchId) where.searchId = searchId;

        const [items, total] = await Promise.all([
            prisma.opportunityScannerLog.findMany({
                where,
                select: {
                    id: true,
                    pncpId: true,
                    searchId: true,
                    searchName: true,
                    titulo: true,
                    objeto: true,
                    orgaoNome: true,
                    uf: true,
                    municipio: true,
                    valorEstimado: true,
                    dataEncerramentoProposta: true,
                    modalidadeNome: true,
                    linkSistema: true,
                    isViewed: true,
                    createdAt: true,
                },
                orderBy: [
                    { dataEncerramentoProposta: { sort: 'asc', nulls: 'last' } },
                    { createdAt: 'desc' }
                ],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            prisma.opportunityScannerLog.count({ where })
        ]);

        res.json({ items, total, page, pageSize });
    } catch (error) {
        logger.error("Scanner opportunities error:", error);
        res.status(500).json({ error: 'Failed to list scanner opportunities' });
    }
});

// ── Mark opportunities as viewed ──
router.patch('/scanner/opportunities/mark-viewed', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { ids } = req.body;
        
        if (ids === 'all') {
            await prisma.opportunityScannerLog.updateMany({
                where: { tenantId, isViewed: false },
                data: { isViewed: true }
            });
        } else if (Array.isArray(ids) && ids.length > 0) {
            await prisma.opportunityScannerLog.updateMany({
                where: { tenantId, id: { in: ids } },
                data: { isViewed: true }
            });
        }

        res.json({ success: true });
    } catch (error) {
        logger.error("Mark viewed error:", error);
        res.status(500).json({ error: 'Failed to mark as viewed' });
    }
});

// ── Get unread count (for sidebar badge) ──
router.get('/scanner/opportunities/unread-count', authenticateToken, async (req: any, res) => {
    try {
        const count = await prisma.opportunityScannerLog.count({
            where: { tenantId: req.user.tenantId, isViewed: false }
        });
        res.json({ count });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get unread count' });
    }
});

// ── Reset scanner dedup history ──
router.post('/scanner/reset', authenticateToken, async (req: any, res) => {
    try {
        const deleted = await prisma.opportunityScannerLog.deleteMany({
            where: { tenantId: req.user.tenantId }
        });
        logger.info(`[OpportunityScanner] 🔄 Histórico de dedup resetado para tenant ${req.user.tenantId} (${deleted.count} registros removidos)`);
        res.json({ success: true, deleted: deleted.count, message: `Histórico limpo. ${deleted.count} registros removidos. Próxima varredura reenviará notificações.` });
    } catch (error) {
        logger.error("Scanner reset error:", error);
        res.status(500).json({ error: 'Failed to reset scanner history' });
    }
});

// ══════════════════════════════════════════
// ── Favorites CRUD ──
// ══════════════════════════════════════════

router.get('/favorites', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const lists = await prisma.pncpFavoriteList.findMany({
            where: { tenantId },
            include: { items: true },
            orderBy: { createdAt: 'asc' }
        });
        res.json({ lists });
    } catch (error) {
        logger.error("Fetch favorites error:", error);
        res.status(500).json({ error: 'Failed to fetch favorites' });
    }
});

router.post('/favorites/lists', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { name } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
        const list = await prisma.pncpFavoriteList.upsert({
            where: { tenantId_name: { tenantId, name: name.trim() } },
            update: {},
            create: { tenantId, name: name.trim() }
        });
        res.json(list);
    } catch (error) {
        logger.error("Create fav list error:", error);
        res.status(500).json({ error: 'Failed to create list' });
    }
});

router.put('/favorites/lists/:id', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { name } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
        await prisma.pncpFavoriteList.updateMany({
            where: { id: req.params.id, tenantId },
            data: { name: name.trim() }
        });
        res.json({ success: true });
    } catch (error) {
        logger.error("Rename fav list error:", error);
        res.status(500).json({ error: 'Failed to rename list' });
    }
});

router.delete('/favorites/lists/:id', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const listId = req.params.id;
        const defaultList = await prisma.pncpFavoriteList.upsert({
            where: { tenantId_name: { tenantId, name: 'Favoritos Gerais' } },
            update: {},
            create: { tenantId, name: 'Favoritos Gerais' }
        });
        if (listId === defaultList.id) return res.status(400).json({ error: 'Cannot delete default list' });
        const itemsToMove = await prisma.pncpFavoriteItem.findMany({ where: { listId, tenantId } });
        for (const item of itemsToMove) {
            try {
                await prisma.pncpFavoriteItem.update({ where: { id: item.id }, data: { listId: defaultList.id } });
            } catch { /* duplicate — delete instead */ await prisma.pncpFavoriteItem.delete({ where: { id: item.id } }).catch(() => {}); }
        }
        await prisma.pncpFavoriteList.deleteMany({ where: { id: listId, tenantId } });
        res.json({ success: true });
    } catch (error) {
        logger.error("Delete fav list error:", error);
        res.status(500).json({ error: 'Failed to delete list' });
    }
});

router.post('/favorites/items', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { listId, pncpId, data } = req.body;
        if (!listId || !pncpId) return res.status(400).json({ error: 'listId and pncpId required' });
        const item = await prisma.pncpFavoriteItem.upsert({
            where: { tenantId_listId_pncpId: { tenantId, listId, pncpId } },
            update: { data },
            create: { tenantId, listId, pncpId, data }
        });
        res.json(item);
    } catch (error) {
        logger.error("Add fav item error:", error);
        res.status(500).json({ error: 'Failed to add favorite' });
    }
});

router.delete('/favorites/items/:id', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        await prisma.pncpFavoriteItem.deleteMany({ where: { id: req.params.id, tenantId } });
        res.json({ success: true });
    } catch (error) {
        logger.error("Remove fav item error:", error);
        res.status(500).json({ error: 'Failed to remove favorite' });
    }
});

router.delete('/favorites/items/by-pncp/:pncpId', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const pncpId = decodeURIComponent(req.params.pncpId);
        await prisma.pncpFavoriteItem.deleteMany({ where: { tenantId, pncpId } });
        res.json({ success: true });
    } catch (error) {
        logger.error("Remove fav by pncpId error:", error);
        res.status(500).json({ error: 'Failed to remove favorite' });
    }
});

// ── Bulk import favorites (migration from localStorage) ──
router.post('/favorites/import', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { lists, items } = req.body;
        let imported = 0;

        const listMap = new Map<string, string>();
        for (const l of (lists || [])) {
            const list = await prisma.pncpFavoriteList.upsert({
                where: { tenantId_name: { tenantId, name: l.name } },
                update: {},
                create: { tenantId, name: l.name }
            });
            listMap.set(l.name, list.id);
        }

        for (const item of (items || [])) {
            const listId = listMap.get(item.listName) || listMap.get('Favoritos Gerais');
            if (!listId || !item.pncpId) continue;
            try {
                await prisma.pncpFavoriteItem.upsert({
                    where: { tenantId_listId_pncpId: { tenantId, listId, pncpId: item.pncpId } },
                    update: { data: item.data },
                    create: { tenantId, listId, pncpId: item.pncpId, data: item.data }
                });
                imported++;
            } catch { /* skip duplicates */ }
        }

        res.json({ success: true, imported, listsCreated: listMap.size });
    } catch (error) {
        logger.error("Import favorites error:", error);
        res.status(500).json({ error: 'Failed to import favorites' });
    }
});

// ══════════════════════════════════════════
// ── PNCP Items API (Pre-filter capability) ──
// ══════════════════════════════════════════

// In-memory cache for PNCP items (avoids repeated slow Gov.br calls)
const pncpItemsCache = new Map<string, { data: any, timestamp: number }>();
const PNCP_ITEMS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Shared keepAlive agent — reuses TCP connections, eliminates TLS handshake overhead
const pncpKeepAliveAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 10 });

/**
 * Fetch items for a single process from Gov.br with retry + backoff.
 * Returns the parsed result or throws on complete failure.
 */
export async function fetchPncpItems(cleanCnpj: string, cleanAno: string, cleanSeq: string): Promise<{ items: any[], message?: string }> {
    const cacheKey = `${cleanCnpj}-${cleanAno}-${cleanSeq}`;
    const cached = pncpItemsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < PNCP_ITEMS_CACHE_TTL) {
        return cached.data;
    }

    const itemsUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${cleanCnpj}/compras/${cleanAno}/${cleanSeq}/itens?pagina=1&tamanhoPagina=100`;
    
    // Retry with escalating timeout: 5s first, 10s second attempt
    const timeouts = [5000, 10000];
    let lastError: any = null;
    
    for (let attempt = 0; attempt < timeouts.length; attempt++) {
        try {
            const resp = await axios.get(itemsUrl, {
                httpsAgent: pncpKeepAliveAgent,
                timeout: timeouts[attempt],
            } as any);

            const responseData: any = resp.data;
            const rawItems: any[] = Array.isArray(responseData) ? responseData : (responseData?.data || responseData?.items || []);
            const items = rawItems.map((it: any) => ({
                itemNumber: it.numeroItem || it.numero || '-',
                description: it.descricao || it.materialOuServicoNome || it.materialServico?.nome || 'Sem descrição',
                quantity: it.quantidade || 1,
                unit: it.unidadeMedida || it.unidade || '',
                unitValue: it.valorUnitarioEstimado || it.valorUnitarioHomologado || 0,
                totalValue: it.valorTotal || ((it.quantidade || 0) * (it.valorUnitarioEstimado || 0)) || 0,
                status: it.situacaoCompraItemNome || it.situacaoItemNome || 'Ativo'
            }));

            const result = { items };
            pncpItemsCache.set(cacheKey, { data: result, timestamp: Date.now() });
            return result;
        } catch (err: any) {
            lastError = err;
            if (err?.response?.status === 404) {
                const emptyResult = { items: [], message: 'Itens não cadastrados no portal PNCP para este processo' };
                pncpItemsCache.set(cacheKey, { data: emptyResult, timestamp: Date.now() });
                return emptyResult;
            }
            // On timeout/network error: retry with longer timeout
            if (attempt < timeouts.length - 1) {
                logger.warn(`[PNCP Items] Attempt ${attempt + 1} failed (${err?.message}), retrying with ${timeouts[attempt + 1]}ms timeout...`);
                await new Promise(r => setTimeout(r, 800)); // 800ms backoff
            }
        }
    }
    
    throw lastError;
}

router.get('/items', authenticateToken, async (req: any, res) => {
    try {
        const { cnpj, ano, seq } = req.query;
        if (!cnpj || !ano || !seq) return res.status(400).json({ error: 'cnpj, ano, and seq required' });
        
        const cleanCnpj = String(cnpj).replace(/\D/g, '');
        const cleanAno = String(ano).replace(/\D/g, '');
        const cleanSeq = String(seq).replace(/\D/g, '');
        
        if (cleanCnpj.length < 11 || !cleanAno || !cleanSeq) {
            logger.warn(`[PNCP Items] Invalid params: cnpj=${cnpj}, ano=${ano}, seq=${seq}`);
            return res.json({ items: [], message: 'Dados insuficientes para consultar itens (CNPJ/ano/sequencial incompletos)' });
        }
        
        const startTime = Date.now();
        const result = await fetchPncpItems(cleanCnpj, cleanAno, cleanSeq);
        const elapsed = Date.now() - startTime;
        
        if (elapsed > 100) { // Only log non-cached calls
            logger.info(`[PNCP Items] ✅ ${result.items.length} items for ${cleanCnpj}-${cleanAno}-${cleanSeq} in ${elapsed}ms`);
        }
        
        res.json(result);
    } catch (error: any) {
        if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
            return res.status(504).json({ error: 'A API do Gov.br não respondeu a tempo. Tente novamente em alguns segundos.' });
        }
        logger.error(`PNCP items error for ${req.query.cnpj}/${req.query.ano}/${req.query.seq}:`, error?.message || error);
        res.status(500).json({ error: 'Erro ao buscar itens no PNCP. Verifique se o processo possui itens cadastrados.' });
    }
});

// Global concurrency limit for background prefetching
let activePrefetches = 0;
const MAX_CONCURRENT_PREFETCHES = 15;

/**
 * Batch prefetch endpoint — pre-warms cache for multiple items in parallel.
 * Called by the frontend immediately after search results load.
 * Returns nothing meaningful; the goal is to warm the cache.
 */
router.post('/items/prefetch', authenticateToken, async (req: any, res) => {
    try {
        const { processes } = req.body; // Array of { cnpj, ano, seq }
        if (!Array.isArray(processes) || processes.length === 0) {
            return res.json({ prefetched: 0 });
        }

        if (activePrefetches >= MAX_CONCURRENT_PREFETCHES) {
            return res.json({ prefetched: 0, status: 'busy_ignored' });
        }

        // Limit to 10 concurrent prefetches to avoid overwhelming Gov.br
        const toFetch = processes.slice(0, 10).filter((p: any) => {
            if (!p.cnpj || !p.ano || !p.seq) return false;
            const key = `${String(p.cnpj).replace(/\D/g, '')}-${String(p.ano).replace(/\D/g, '')}-${String(p.seq).replace(/\D/g, '')}`;
            const cached = pncpItemsCache.get(key);
            return !cached || (Date.now() - cached.timestamp) > PNCP_ITEMS_CACHE_TTL;
        });

        if (toFetch.length === 0) {
            return res.json({ prefetched: 0, cached: true });
        }

        // Fire-and-forget: don't await — respond immediately
        res.json({ prefetched: toFetch.length, status: 'warming' });

        // Run isolated background task
        (async () => {
            activePrefetches += toFetch.length;
            try {
                // Warm cache in background with 500ms stagger between calls
                for (const proc of toFetch) {
                    const cleanCnpj = String(proc.cnpj).replace(/\D/g, '');
                    const cleanAno = String(proc.ano).replace(/\D/g, '');
                    const cleanSeq = String(proc.seq).replace(/\D/g, '');
                    
                    try {
                        // @ts-ignore
                        const internalModule = await import('./pncp');
                        if (internalModule.fetchPncpItems) {
                            await internalModule.fetchPncpItems(cleanCnpj, cleanAno, cleanSeq);
                        } else {
                            await fetchPncpItems(cleanCnpj, cleanAno, cleanSeq);
                        }
                    } catch (err: any) {
                        logger.warn(`[PNCP Prefetch] Failed for ${cleanCnpj}-${cleanAno}-${cleanSeq}: ${err?.message}`);
                    }
                    
                    await new Promise(r => setTimeout(r, 800)); // 800ms stagger (calmer)
                }
            } finally {
                activePrefetches = Math.max(0, activePrefetches - toFetch.length);
            }
        })();
    } catch (error: any) {
        logger.error('[PNCP Prefetch] Error:', error?.message);
        if (!res.headersSent) res.json({ prefetched: 0, error: error?.message });
    }
});

// ══════════════════════════════════════════
// ── PNCP Search (v3 — Full-Text Search) ──
// ══════════════════════════════════════════

router.post('/search', authenticateToken, async (req: any, res) => {
    const reqStart = Date.now();
    logger.info(`[SEARCH] >>> REQUEST from user=${req.user?.id?.slice(0, 8)} | uf=${req.body?.uf} | status=${req.body?.status} | keywords=${req.body?.keywords || 'none'} | page=${req.body?.pagina || 1}`);

    try {
        const { PncpSearchV3 } = await import('../services/pncp/pncp-search-v3.service');
        const result = await PncpSearchV3.search(req.body);

        const elapsed = Date.now() - reqStart;
        logger.info(`[SEARCH] <<< RESPONSE ${result.total} items (page ${result.page}/${result.totalPages}) in ${elapsed}ms | uf=${req.body?.uf}`);

        res.json({
            items: result.items,
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            totalPages: result.totalPages,
            elapsed: result.elapsed,
            source: result.source,
            meta: { source: result.source, elapsedMs: result.elapsed, localCount: result.total, errors: [] },
        });
    } catch (error: any) {
        const elapsed = Date.now() - reqStart;
        logger.error(`[SEARCH] !!! ERROR in ${elapsed}ms: ${error?.message || error}`);
        handleApiError(res, error, 'pncp-search');
    }
});

// Search endpoint used by frontend — Hybrid: Gov.br API primary, V3 local fallback
router.post('/search-hybrid', authenticateToken, async (req: any, res) => {
    const start = Date.now();
    const { keywords, status, uf, modalidade, esfera, pagina = 1, tamanhoPagina = 50,
            dataInicio, dataFim, orgao, orgaosLista, excludeKeywords, valorMin, valorMax } = req.body;

    // Determine if we can use the official API
    // The Elasticsearch API supports q (keywords/orgao), status, uf, modalidade. 
    // It does not support valorMin/valorMax natively.
    const canUseOfficialApi = !valorMin && !valorMax;

    if (canUseOfficialApi) {
        // ── PRIMARY: Gov.br Elasticsearch API (/api/search/) ──
        try {
            const axios = (await import('axios')).default;
            const https = (await import('https')).default;
            const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 5 });

            const pageSize = Math.min(Number(tamanhoPagina) || 50, 100);
            const pageNum = Math.max(1, Number(pagina) || 1);
            
            let url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=${pageSize}&pagina=${pageNum}`;
            
            // Map status
            if (status) {
                const STATUS_TO_GOVBR: Record<string, string> = {
                    'recebendo_proposta': 'recebendo_proposta',
                    'encerrada': 'encerradas',
                    'suspensa': 'suspensas',
                    'anulada': 'anuladas',
                    'revogada': 'anuladas'
                };
                const govStatus = STATUS_TO_GOVBR[status] || status;
                if (govStatus !== 'todas') url += `&status=${govStatus}`;
            }

            // Map keywords and orgao into the 'q' parameter using Elasticsearch syntax
            let queryParts: string[] = [];
            
            if (keywords) {
                const kws = keywords.split(',').map((k: string) => k.trim()).filter(Boolean);
                if (kws.length > 0) {
                    queryParts.push('(' + kws.map((k: string) => `"${k}"`).join(' OR ') + ')');
                }
            }
            
            if (excludeKeywords) {
                const exKws = excludeKeywords.split(',').map((k: string) => k.trim()).filter(Boolean);
                if (exKws.length > 0) {
                    queryParts.push('NOT (' + exKws.map((k: string) => `"${k}"`).join(' OR ') + ')');
                }
            }

            let orgaoParts: string[] = [];
            if (orgao) {
                const ol = orgao.split(/[\n,;]+/).map((s: string) => s.trim()).filter(Boolean);
                if (ol.length > 0) orgaoParts.push(...ol.map((o: string) => `"${o}"`));
            }
            if (orgaosLista) {
                const ol = orgaosLista.split(/[\n,;]+/).map((s: string) => s.trim()).filter(Boolean);
                if (ol.length > 0) orgaoParts.push(...ol.map((o: string) => `"${o}"`));
            }
            if (orgaoParts.length > 0) {
                queryParts.push('(' + orgaoParts.join(' OR ') + ')');
            }
            
            if (queryParts.length > 0) {
                url += `&q=${encodeURIComponent(queryParts.join(' AND '))}`;
            }

            if (uf && uf.trim() !== 'todas') {
                url += `&ufs=${uf.replace(/\s/g, '')}`;
            }

            if (modalidade && modalidade !== 'todas') {
                url += `&modalidades_licitacao=${encodeURIComponent(modalidade)}`;
            }
            
            // Fetch from API with retry
            let rawItems: any[] = [];
            let totalRegistros = 0;

            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const resp = await axios.get(url, { httpsAgent: agent, timeout: 15000 } as any);
                    const d = resp.data as any;
                    rawItems = Array.isArray(d?.items) ? d.items : [];
                    totalRegistros = d?.total || d?.totalRegistros || 0;
                    break;
                } catch (err: any) {
                    if (attempt < 2 && (err?.response?.status >= 500 || err.code === 'ECONNABORTED' || err.message.includes('timeout'))) {
                        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
                        continue;
                    }
                    throw err;
                }
            }

            // Map to frontend format
            const seenIds = new Set<string>();
            const items = rawItems.filter(Boolean).map((item: any) => {
                let cnpj = item.orgao_cnpj || item.orgaoEntidade?.cnpj || item.cnpj || '';
                let ano = item.ano || item.anoCompra || '';
                let nSeq = item.numero_sequencial || item.sequencialCompra || item.numero_compra || '';
                
                if (item.numero_controle_pncp && (!cnpj || !ano || !nSeq)) {
                    const ctrlMatch = item.numero_controle_pncp.match(/^(\d{11,14})-(\d+)-(\d+)\/(\d{4})$/);
                    if (ctrlMatch) { if (!cnpj) cnpj = ctrlMatch[1]; if (!nSeq) nSeq = ctrlMatch[3]; if (!ano) ano = ctrlMatch[4]; }
                }
                
                const rawVal = item.valor_estimado ?? item.valor_global ?? item.valorTotalEstimado ?? item.valorTotalHomologado ?? item.valorEstimado ?? 0;
                const pncpId = item.numero_controle_pncp || item.numeroControlePNCP || (cnpj && ano && nSeq ? `${cnpj}-${ano}-${nSeq}` : null) || item.id || Math.random().toString();
                
                if (seenIds.has(pncpId)) return null;
                seenIds.add(pncpId);

                return {
                    id: pncpId,
                    orgao_nome: item.orgao_nome || item.orgaoEntidade?.razaoSocial || item.nomeOrgao || 'Órgão não informado',
                    orgao_cnpj: cnpj, 
                    ano, 
                    numero_sequencial: nSeq,
                    titulo: item.title || item.titulo || item.identificador || 'Sem título',
                    objeto: item.description || item.objetoCompra || item.objeto || item.resumo || 'Sem objeto',
                    data_publicacao: item.createdAt || item.dataPublicacaoPncp || item.data_publicacao || new Date().toISOString(),
                    data_abertura: item.dataAberturaProposta || item.data_inicio_vigencia || item.data_abertura || '',
                    data_encerramento_proposta: item.dataEncerramentoProposta || item.data_fim_vigencia || '',
                    valor_estimado: Number(rawVal) || 0,
                    uf: item.uf || item.unidadeOrgao?.ufSigla || item.ufSigla || item.ufNome || '',
                    municipio: item.municipio_nome || item.unidadeOrgao?.municipioNome || item.municipio || '',
                    modalidade_nome: item.modalidade_licitacao_nome || item.modalidade_nome || item.modalidadeNome || '',
                    link_sistema: (cnpj && ano && nSeq) ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${nSeq}` : (item.linkSistemaOrigem || item.link || ''),
                    status: item.situacao_nome || item.situacaoCompraNome || item.status || status || '',
                    esfera_id: item.esfera_id || item.esferaId || item.orgaoEntidade?.esferaId || '',
                    urgency: 'medium',
                };
            }).filter(Boolean);

            // Apply client-side filters (esfera, data limite)
            let finalItems = items;
            if (esfera && esfera !== 'todas') {
                const esferaMap: Record<string, string[]> = { 'F': ['1', 'F'], 'E': ['2', 'E'], 'M': ['3', 'M'], 'D': ['4', 'D'] };
                const allowedIds = esferaMap[esfera] || [esfera];
                finalItems = finalItems.filter((it: any) => allowedIds.includes(String(it.esfera_id)));
            }

            if (dataInicio || dataFim) {
                const filterStart = dataInicio ? new Date(dataInicio + 'T00:00:00-03:00').getTime() : 0;
                const filterEnd = dataFim ? new Date(dataFim + 'T23:59:59-03:00').getTime() : Infinity;
                
                finalItems = finalItems.filter((it: any) => {
                    const deadlineStr = it.data_encerramento_proposta || it.data_abertura;
                    if (!deadlineStr) return true;
                    const t = new Date(deadlineStr).getTime();
                    return t >= filterStart && t <= filterEnd;
                });
            }

            // ── HYDRATION: Fetch missing values ──
            const itemsToHydrate = finalItems.filter((it: any) => !it.valor_estimado || it.valor_estimado === 0);
            if (itemsToHydrate.length > 0) {
                try {
                    const prisma = (await import('../lib/prisma')).default;
                    const ids = itemsToHydrate.map((it: any) => it.id);
                    
                    // 1. Check local DB first (fastest)
                    const localData = await prisma.pncpContratacao.findMany({
                        where: { numeroControle: { in: ids } },
                        select: { numeroControle: true, valorEstimado: true }
                    });
                    const valMap = new Map(localData.map((d: any) => [d.numeroControle, d.valorEstimado]));
                    
                    let stillMissing: any[] = [];
                    itemsToHydrate.forEach((it: any) => {
                        if (valMap.has(it.id) && valMap.get(it.id) != null && Number(valMap.get(it.id)) > 0) {
                            it.valor_estimado = Number(valMap.get(it.id));
                        } else {
                            stillMissing.push(it);
                        }
                    });

                    // 2. Fetch remainder from Gov.br API
                    if (stillMissing.length > 0) {
                        const hydrateResults = await Promise.allSettled(stillMissing.map((it: any) => 
                            axios.get(`https://pncp.gov.br/api/consulta/v1/orgaos/${it.orgao_cnpj}/compras/${it.ano}/${it.numero_sequencial}`, 
                            { httpsAgent: agent, timeout: 3500 } as any)
                        ));
                        
                        const needItemFetch: any[] = [];
                        hydrateResults.forEach((r, idx) => {
                            if (r.status === 'fulfilled') {
                                const val = (r.value.data as any)?.valorTotalEstimado ?? (r.value.data as any)?.valorTotalHomologado ?? null;
                                if (val != null && Number(val) > 0) {
                                    stillMissing[idx].valor_estimado = Number(val);
                                } else {
                                    needItemFetch.push(stillMissing[idx]);
                                }
                            } else {
                                needItemFetch.push(stillMissing[idx]);
                            }
                        });

                        // 3. Fallback: Fetch items if the global value is still 0
                        if (needItemFetch.length > 0) {
                            const itemFetchResults = await Promise.allSettled(needItemFetch.map((it: any) => 
                                fetchPncpItems(it.orgao_cnpj, String(it.ano), String(it.numero_sequencial))
                            ));
                            
                            itemFetchResults.forEach((r, idx) => {
                                if (r.status === 'fulfilled') {
                                    const itemsArray = r.value?.items || [];
                                    needItemFetch[idx].itens_preview = itemsArray;

                                    const sum = itemsArray.reduce((acc: number, item: any) => {
                                        return acc + (Number(item.totalValue) || 0);
                                    }, 0);

                                    if (sum > 0) {
                                        needItemFetch[idx].valor_estimado = sum;
                                    }
                                }
                            });
                        }
                    }
                } catch (hydrateErr: any) {
                    logger.warn(`[SEARCH-HYBRID] Value hydration failed: ${hydrateErr.message}`);
                }
            }

            // ── SORTING: Closest deadlines first ──
            finalItems.sort((a: any, b: any) => {
                const dateA = a.data_encerramento_proposta || a.data_abertura || '9999-12-31';
                const dateB = b.data_encerramento_proposta || b.data_abertura || '9999-12-31';
                const tA = new Date(dateA).getTime();
                const tB = new Date(dateB).getTime();
                if (status === 'recebendo_proposta' || !status || status === '') {
                    return tA - tB; // Ascending: deadlines closest to today appear first
                } else {
                    return tB - tA; // Descending: for other statuses
                }
            });

            const elapsed = Date.now() - start;
            logger.info(`[SEARCH-HYBRID] Gov.br API: ${finalItems.length} items (total=${totalRegistros}) in ${elapsed}ms | uf=${uf || '*'}`);

            return res.json({
                items: finalItems, total: totalRegistros,
                totalLocal: 0, elapsed,
                source: 'govbr-api',
                meta: { source: 'govbr-api', elapsedMs: elapsed, localCount: totalRegistros, errors: [] },
            });
        } catch (apiError: any) {
            logger.warn(`[SEARCH-HYBRID] Gov.br API failed, falling back to local: ${apiError?.message}`);
            // Fall through to local V3
        }
    }

    // ── FALLBACK / FILTERED SEARCH: Local V3 ──
    try {
        const { PncpSearchV3 } = await import('../services/pncp/pncp-search-v3.service');
        const result = await PncpSearchV3.search(req.body);
        const elapsed = Date.now() - start;
        logger.info(`[SEARCH-HYBRID] Local V3: ${result.total} items in ${elapsed}ms | uf=${uf || '*'}`);

        res.json({
            items: result.items, total: result.total,
            totalLocal: result.total, elapsed,
            source: result.source,
            meta: { source: result.source, elapsedMs: elapsed, localCount: result.total, errors: [] },
        });
    } catch (error: any) {
        handleApiError(res, error, 'pncp-search-hybrid');
    }
});

// ══════════════════════════════════════════
// ── Sync Health (estado do Aggregator) ──
// ══════════════════════════════════════════
router.get('/sync-health', authenticateToken, async (req: any, res) => {
    try {
        const state = await prisma.pncpSyncState.findUnique({ where: { id: 'singleton' } });
        const totalContratacoes = await prisma.pncpContratacao.count();
        const totalItens = await prisma.pncpItem.count();
        const totalAbertos = await prisma.pncpContratacao.count({ where: { situacao: { in: ['Divulgada', 'Aberta'] } } });

        const now = Date.now();
        const lastFullSyncMs = state?.lastFullSyncAt ? now - state.lastFullSyncAt.getTime() : null;
        const isStale = !state || !lastFullSyncMs || lastFullSyncMs > 2 * 3600 * 1000; // >2h

        res.json({
            lastSyncAt: state?.lastSyncAt || null,
            lastFullSyncAt: state?.lastFullSyncAt || null,
            lastSyncAgo: state?.lastSyncAt ? `${Math.round((now - state.lastSyncAt.getTime()) / 60000)} min` : 'nunca',
            totalContratacoes,
            totalItens,
            totalAbertos,
            isStale,
            isRunning: state?.isRunning || false,
            totalSynced: state?.totalSynced || 0,
            lastError: state?.lastError || null,
        });
    } catch (error: any) {
        res.status(500).json({ error: error?.message || 'Erro ao buscar estado do sync' });
    }
});

// ══════════════════════════════════════════
// ── DEBUG: Contagem por UF (temporário) ──
// ══════════════════════════════════════════
router.get('/debug-local-counts', async (req: any, res) => {
    try {
        const total = await prisma.pncpContratacao.count();
        const byUf = await prisma.pncpContratacao.groupBy({
            by: ['uf'],
            _count: { _all: true },
            orderBy: { _count: { uf: 'desc' } },
        });
        const bySituacao = await prisma.pncpContratacao.groupBy({
            by: ['situacao'],
            _count: { _all: true },
        });
        // Quick test: what would searchLocal see for PE + recebendo_proposta?
        const testPE = await prisma.pncpContratacao.count({
            where: {
                uf: 'PE',
                AND: [{
                    OR: [
                        { situacao: { in: ['Divulgada', 'Aberta'] } },
                        { situacao: null }
                    ]
                }]
            }
        });
        const testCE = await prisma.pncpContratacao.count({
            where: {
                uf: 'CE',
                AND: [{
                    OR: [
                        { situacao: { in: ['Divulgada', 'Aberta'] } },
                        { situacao: null }
                    ]
                }]
            }
        });
        res.json({
            total,
            byUf: byUf.map(r => ({ uf: r.uf, count: r._count._all })),
            bySituacao: bySituacao.map(r => ({ situacao: r.situacao, count: r._count._all })),
            searchSimulation: { PE_recebendo: testPE, CE_recebendo: testCE },
        });
    } catch (error: any) {
        res.status(500).json({ error: error?.message || 'Debug error' });
    }
});

// ══════════════════════════════════════════
// ── Items Local (consulta o banco PncpItem) ──
// ══════════════════════════════════════════
router.get('/items-local/:cnpj/:ano/:seq', authenticateToken, async (req: any, res) => {
    try {
        const { cnpj, ano, seq } = req.params;
        const cleanCnpj = String(cnpj).replace(/\D/g, '');
        const cleanAno = Number(ano);
        const cleanSeq = Number(seq);

        if (!cleanCnpj || !cleanAno || !cleanSeq) {
            return res.json([]);
        }

        // Buscar contratação com seus itens
        const contratacao = await prisma.pncpContratacao.findFirst({
            where: {
                cnpjOrgao: cleanCnpj,
                anoCompra: cleanAno,
                sequencialCompra: cleanSeq,
            },
            include: {
                itens: {
                    orderBy: { numeroItem: 'asc' },
                },
            },
        });

        if (!contratacao || contratacao.itens.length === 0) {
            return res.json([]);
        }

        // Retornar items normalizados
        const items = contratacao.itens.map(it => ({
            itemNumber: it.numeroItem,
            description: it.descricao || '',
            quantity: it.quantidade || 0,
            unit: it.unidadeMedida || 'UN',
            unitValue: it.valorUnitario || 0,
            totalValue: it.valorTotal || 0,
            status: it.situacao || 'Ativo',
        }));

        res.json(items);
    } catch (error: any) {
        logger.error("Items local error:", error?.message);
        res.json([]);
    }
});

export default router;
