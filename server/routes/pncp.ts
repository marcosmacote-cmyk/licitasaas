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
async function fetchPncpItems(cleanCnpj: string, cleanAno: string, cleanSeq: string): Promise<{ items: any[], message?: string }> {
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

        // Limit to 5 concurrent prefetches to avoid overwhelming Gov.br
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

        // Warm cache in background with 500ms stagger between calls
        for (const proc of toFetch) {
            const cleanCnpj = String(proc.cnpj).replace(/\D/g, '');
            const cleanAno = String(proc.ano).replace(/\D/g, '');
            const cleanSeq = String(proc.seq).replace(/\D/g, '');
            
            fetchPncpItems(cleanCnpj, cleanAno, cleanSeq).catch(err => {
                logger.warn(`[PNCP Prefetch] Failed for ${cleanCnpj}-${cleanAno}-${cleanSeq}: ${err?.message}`);
            });
            
            await new Promise(r => setTimeout(r, 500)); // 500ms stagger
        }
    } catch (error: any) {
        logger.error('[PNCP Prefetch] Error:', error?.message);
        if (!res.headersSent) res.json({ prefetched: 0, error: error?.message });
    }
});

// ══════════════════════════════════════════
// ── PNCP Search (Extracted from index.ts) ──
// ══════════════════════════════════════════

// The Gov.br search API uses DIFFERENT status values than what our UI sends.
// Our UI sends: 'recebendo_proposta', 'encerrada', 'suspensa', 'anulada', 'todas'
// Gov.br expects: 'recebendo_proposta', 'encerradas', 'suspensas', 'anuladas', (omit for all)
const STATUS_TO_GOVBR: Record<string, string> = {
    'recebendo_proposta': 'recebendo_proposta',
    'encerrada': 'encerradas',
    'suspensa': 'suspensas',
    'anulada': 'anuladas',
    'todas': '',  // omit param entirely
};

// In-memory cache for PNCP search results (avoids repeated slow Gov.br calls)
const pncpSearchCache = new Map<string, { data: any, timestamp: number }>();
const PNCP_SEARCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Periodic cache cleanup to prevent memory leaks (P4 fix) ──
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of pncpSearchCache) {
        if (now - val.timestamp > PNCP_SEARCH_CACHE_TTL * 2) pncpSearchCache.delete(key);
    }
    for (const [key, val] of pncpItemsCache) {
        if (now - val.timestamp > PNCP_ITEMS_CACHE_TTL * 2) pncpItemsCache.delete(key);
    }
}, 5 * 60 * 1000); // Every 5 minutes

router.post('/search', authenticateToken, async (req: any, res) => {
    try {
        const { keywords, status, uf, pagina = 1, modalidade, dataInicio, dataFim, esfera, orgao, orgaosLista, excludeKeywords } = req.body;

        // ── Cache check: hash search params to avoid redundant Gov.br calls ──
        const cacheKey = JSON.stringify({ keywords, status, uf, modalidade, dataInicio, dataFim, esfera, orgao, orgaosLista, excludeKeywords });
        const cached = pncpSearchCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < PNCP_SEARCH_CACHE_TTL) {
            const totalResults = cached.data.length;
            logger.info(`[PNCP] Cache HIT for search (${totalResults} total)`);
            return res.json({ items: cached.data, total: totalResults });
        }

        const startTime = Date.now();
        const agent = pncpKeepAliveAgent; // Reuse global agent (prevents socket leak)
        logger.info(`[PNCP] SEARCH REQUEST - status="${status}" uf="${uf}" keywords="${keywords}" modalidade="${modalidade}"`);

        // ══════════════════════════════════════════════════════════════
        // ── STRATEGY: Use Official Consulta API when possible ──
        // The /api/consulta/v1/ returns valorTotalEstimado, UF reliable,
        // and structured data. The /api/search/ is needed only for 
        // full-text keyword matching.
        // ══════════════════════════════════════════════════════════════

        let filteredItems: any[] = [];
        // If keywords are provided, we MUST use the search API fallback because the official
        // consulta API doesn't support text search and we would only be searching within the first 500 items.
        const useOfficialApi = (status === 'recebendo_proposta' || !status || status === '') 
            && !orgao && !orgaosLista && !keywords;

        if (useOfficialApi) {
            // ── FAST PATH: Official PNCP Consulta API ──
            // Endpoint: /api/consulta/v1/contratacoes/proposta
            // Returns: valorTotalEstimado, UF, modalidade, everything!
            logger.info(`[PNCP] Using OFFICIAL API (contratacoes/proposta) fast path`);
            
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const dataFinalParam = dataFim ? dataFim.replace(/-/g, '') : tomorrow.toISOString().split('T')[0].replace(/-/g, '');
            const dataInicialParam = dataInicio ? dataInicio.replace(/-/g, '') : '';

            // Build UF list for iteration
            let ufsForApi: string[] = [];
            if (uf && typeof uf === 'string' && uf.trim()) {
                if (uf.includes(',')) {
                    ufsForApi = uf.split(',').map((u: string) => u.trim()).filter(Boolean);
                } else {
                    ufsForApi = [uf.trim()];
                }
            }

            // Build modalidade code if specified
            const modalidadeCode = modalidade && modalidade !== 'todas' ? modalidade : '';

            const fetchOfficialPage = async (pageNum: number, singleUf?: string): Promise<{ data: any[], totalPages: number }> => {
                let url = `https://pncp.gov.br/api/consulta/v1/contratacoes/proposta?dataFinal=${dataFinalParam}&pagina=${pageNum}&tamanhoPagina=50`;
                if (dataInicialParam) url += `&dataInicial=${dataInicialParam}`;
                if (singleUf) url += `&uf=${singleUf}`;
                if (modalidadeCode) url += `&codigoModalidadeContratacao=${modalidadeCode}`;

                // Exponential backoff retry
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const resp = await axios.get(url, { httpsAgent: agent, timeout: 10000 } as any);
                        const body: any = resp.data;
                        return {
                            data: Array.isArray(body?.data) ? body.data : [],
                            totalPages: body?.totalPaginas || 1
                        };
                    } catch (err: any) {
                        if (attempt < 2 && (err?.response?.status >= 500 || err.code === 'ECONNABORTED')) {
                            const delay = 1000 * Math.pow(2, attempt);
                            logger.warn(`[PNCP] Official API retry ${attempt + 1} after ${delay}ms (${err?.message})`);
                            await new Promise(r => setTimeout(r, delay));
                            continue;
                        }
                        logger.error(`[PNCP] Official API failed: ${err?.message}`);
                        return { data: [], totalPages: 0 };
                    }
                }
                return { data: [], totalPages: 0 };
            };

            const MAX_PAGES = 10; // Max 500 items (50/page * 10 pages)
            const MAX_ITEMS = 500;
            let rawConsulta: any[] = [];

            if (ufsForApi.length > 0) {
                // Fetch per UF in parallel
                const ufBatches = await Promise.allSettled(
                    ufsForApi.map(async (singleUf) => {
                        const first = await fetchOfficialPage(1, singleUf);
                        let allData = [...first.data];
                        const pagesToFetch = Math.min(first.totalPages, MAX_PAGES);
                        if (pagesToFetch > 1) {
                            const pageResults = await Promise.allSettled(
                                Array.from({ length: pagesToFetch - 1 }, (_, i) => fetchOfficialPage(i + 2, singleUf))
                            );
                            for (const pr of pageResults) {
                                if (pr.status === 'fulfilled') allData.push(...pr.value.data);
                            }
                        }
                        return allData;
                    })
                );
                for (const batch of ufBatches) {
                    if (batch.status === 'fulfilled') rawConsulta.push(...batch.value);
                    if (rawConsulta.length >= MAX_ITEMS) break;
                }
            } else {
                // No UF filter — fetch nationally
                const first = await fetchOfficialPage(1);
                rawConsulta = [...first.data];
                const pagesToFetch = Math.min(first.totalPages, MAX_PAGES);
                if (pagesToFetch > 1) {
                    const pageResults = await Promise.allSettled(
                        Array.from({ length: pagesToFetch - 1 }, (_, i) => fetchOfficialPage(i + 2))
                    );
                    for (const pr of pageResults) {
                        if (pr.status === 'fulfilled') rawConsulta.push(...pr.value.data);
                    }
                }
            }

            // ── Map official API response to our standard format ──
            const seenIds = new Set<string>();
            filteredItems = rawConsulta.filter(item => item != null).map((item: any) => {
                const org = item.orgaoEntidade || {};
                const uni = item.unidadeOrgao || {};
                const cnpj = org.cnpj || '';
                const ano = String(item.anoCompra || '');
                const nSeq = String(item.sequencialCompra || '');
                const pncpId = item.numeroControlePNCP || (cnpj && ano && nSeq ? `${cnpj}-${ano}-${nSeq}` : Math.random().toString());

                // Urgency level based on deadline
                let urgency = 'medium';
                if (item.dataAberturaProposta) {
                    const daysUntil = (new Date(item.dataAberturaProposta).getTime() - Date.now()) / (1000 * 3600 * 24);
                    if (daysUntil <= 3) urgency = 'critical';
                    else if (daysUntil <= 7) urgency = 'high';
                    else if (daysUntil <= 15) urgency = 'medium';
                    else urgency = 'low';
                }

                return {
                    id: pncpId,
                    orgao_nome: org.razaoSocial || 'Órgão não informado',
                    orgao_cnpj: cnpj,
                    ano,
                    numero_sequencial: nSeq,
                    titulo: item.numeroCompra ? `Compra nº ${item.numeroCompra}/${ano}` : `${item.modalidadeNome || 'Licitação'} nº ${nSeq}/${ano}`,
                    objeto: item.objetoCompra || 'Sem objeto',
                    data_publicacao: item.dataPublicacaoPncp || item.dataInclusao || new Date().toISOString(),
                    data_abertura: item.dataAberturaProposta || '',
                    data_encerramento_proposta: item.dataEncerramentoProposta || '',
                    valor_estimado: Number(item.valorTotalEstimado || item.valorTotalHomologado || 0),
                    uf: uni.ufSigla || '',
                    municipio: uni.municipioNome || '',
                    modalidade_nome: item.modalidadeNome || '',
                    link_sistema: (cnpj && ano && nSeq)
                        ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${nSeq}`
                        : (item.linkSistemaOrigem || ''),
                    link_comprasnet: item.linkSistemaOrigem || '',
                    status: item.situacaoCompraNome || 'Aberta',
                    esfera_id: org.esferaId || '',
                    urgency,
                    srp: item.srp || false,
                    modo_disputa: item.modoDisputaNome || '',
                };
            }).filter(item => {
                if (seenIds.has(item.id)) return false;
                seenIds.add(item.id);
                return true;
            });

            // ── Client-side keyword filtering (official API has no text search) ──
            if (keywords && typeof keywords === 'string' && keywords.trim()) {
                const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const kwTerms = keywords.split(',')
                    .map((k: string) => normalize(k.trim().replace(/^"|"$/g, '')))
                    .filter((k: string) => k.length > 1);
                if (kwTerms.length > 0) {
                    filteredItems = filteredItems.filter((it: any) => {
                        const searchText = normalize((it.objeto || '') + ' ' + (it.titulo || '') + ' ' + (it.orgao_nome || ''));
                        return kwTerms.some((term: string) => searchText.includes(term));
                    });
                    logger.info(`[PNCP] Keyword filter applied: ${filteredItems.length} items match "${keywords}"`);
                }
            }

            logger.info(`[PNCP] Official API returned ${filteredItems.length} items (from ${rawConsulta.length} raw)`);

        } else {
            // ── FALLBACK: Search API (for non-open statuses or org-specific searches) ──
            logger.info(`[PNCP] Using SEARCH API fallback (status="${status}")`);

            let kwList: string[] = [];
            if (keywords) {
                if (keywords.includes(',')) {
                    kwList = keywords.split(',')
                        .map((k: string) => k.trim().replace(/^"|"$/g, ''))
                        .filter((k: string) => k.length > 0)
                        .map((k: string) => k.includes(' ') ? `"${k}"` : k);
                } else {
                    kwList = [keywords.includes(' ') && !keywords.startsWith('"') ? `"${keywords}"` : keywords];
                }
            }

            let effectiveOrgao = orgao || '';
            let effectiveOrgaosLista = orgaosLista || '';
            if (effectiveOrgao.includes(',')) {
                effectiveOrgaosLista = effectiveOrgaosLista
                    ? `${effectiveOrgaosLista},${effectiveOrgao}`
                    : effectiveOrgao;
                effectiveOrgao = '';
            }

            let ufsToIterate: string[] = [];
            if (uf && uf.includes(',')) {
                ufsToIterate = uf.split(',').map((u: string) => u.trim()).filter(Boolean);
            } else if (uf) {
                ufsToIterate = [uf];
            }

            const buildBaseUrl = (qItems: string[], overrideCnpj?: string, singleUf?: string) => {
                let url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=${overrideCnpj ? 50 : 100}&pagina=1`;
                if (overrideCnpj) url += `&cnpj=${overrideCnpj}`;
                if (qItems.length > 0) url += `&q=${encodeURIComponent(qItems.join(' '))}`;
                const govStatus = STATUS_TO_GOVBR[status] || status;
                if (govStatus && govStatus !== '') url += `&status=${govStatus}`;
                if (singleUf) url += `&ufs=${singleUf}`;
                if (modalidade && modalidade !== 'todas') url += `&modalidades_licitacao=${encodeURIComponent(modalidade)}`;
                if (dataInicio) url += `&data_inicio=${dataInicio}`;
                if (dataFim) url += `&data_fim=${dataFim}`;
                if (esfera && esfera !== 'todas') url += `&esferas=${esfera}`;
                return url;
            };

            let extractedNames: string[] = [];
            if (effectiveOrgaosLista) {
                extractedNames = effectiveOrgaosLista.split(/[\n,;]+/).map((s: string) => s.trim().replace(/^"|"$/g, '')).filter((s: string) => s.length > 0);
                extractedNames = [...new Set(extractedNames)];
            }

            let urlsToFetch: string[] = [];
            const keywordsToIterate = kwList.length > 0 ? kwList : [null];
            const orgaosToIterate = extractedNames.length > 0 ? extractedNames : (effectiveOrgao ? [effectiveOrgao] : [null]);
            const ufsForIteration = ufsToIterate.length > 0 ? ufsToIterate : [null];

            for (const kw of keywordsToIterate) {
                for (const org2 of orgaosToIterate) {
                    for (const singleUf of ufsForIteration) {
                        let localParams: string[] = [];
                        let overrideCnpj: string | undefined = undefined;
                        if (kw) localParams.push(kw);
                        if (org2) {
                            const onlyNumbers = org2.replace(/\D/g, '');
                            if (onlyNumbers.length === 14) {
                                overrideCnpj = onlyNumbers;
                            } else {
                                const exactOrgName = org2.includes(' ') && !org2.startsWith('"') ? `"${org2}"` : org2;
                                localParams.push(exactOrgName);
                            }
                        }
                        urlsToFetch.push(buildBaseUrl(localParams, overrideCnpj, singleUf || undefined));
                    }
                }
            }
            urlsToFetch = urlsToFetch.slice(0, 30);

            let rawItems: any[] = [];
            const MAX_ITEMS = 500;

            // Fetch all URLs with retry (Gov.br is unstable, especially from Railway EU)
            const fetchWithRetry = async (url: string, retries = 2): Promise<any[]> => {
                for (let attempt = 0; attempt <= retries; attempt++) {
                    try {
                        const resp = await axios.get(url, {
                            headers: { 'Accept': 'application/json' },
                            httpsAgent: agent,
                            timeout: 12000
                        } as any);
                        const data: any = resp.data;
                        return Array.isArray(data?.items) ? data.items : (Array.isArray(data?.data) ? data.data : []);
                    } catch (err: any) {
                        if (attempt < retries && (err.code === 'ECONNABORTED' || err?.response?.status >= 500)) {
                            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                            continue;
                        }
                        logger.warn(`[PNCP] Search fetch failed: ${err?.message?.substring(0, 80)}`);
                        return [];
                    }
                }
                return [];
            };

            // Process URLs in parallel chunks (max 10 concurrent)
            const chunkSize = 10;
            for (let i = 0; i < urlsToFetch.length; i += chunkSize) {
                if (rawItems.length >= MAX_ITEMS) break;
                const chunk = urlsToFetch.slice(i, i + chunkSize);
                const results = await Promise.all(chunk.map(u => fetchWithRetry(u)));
                for (const items of results) {
                    rawItems = rawItems.concat(items);
                }
            }

            // Map search API results to standard format
            const seenIds = new Set<string>();
            filteredItems = rawItems.filter(item => item != null).map((item: any) => {
                let cnpj = item.orgao_cnpj || item.orgaoEntidade?.cnpj || item.cnpj || '';
                // C4v2: Unified extraction of CNPJ + ano + seq from numeroControlePNCP
                // Format: "12345678000199-1-000042/2026" -> CNPJ, SEQ, ANO
                let ano = item.ano || item.anoCompra || '';
                let nSeq = item.numero_sequencial || item.sequencialCompra || item.numero_compra || '';
                if (item.numeroControlePNCP && (!cnpj || !ano || !nSeq)) {
                    const ctrlMatch = item.numeroControlePNCP.match(/^(\d{11,14})-(\d+)-(\d+)\/(\d{4})$/);
                    if (ctrlMatch) {
                        if (!cnpj) cnpj = ctrlMatch[1];
                        if (!nSeq) nSeq = ctrlMatch[3];
                        if (!ano) ano = ctrlMatch[4];
                    } else {
                        const pncpParts = item.numeroControlePNCP.split('-');
                        if (pncpParts.length >= 2) {
                            const digits0 = pncpParts[0].replace(/\D/g, '');
                            if (!cnpj && digits0.length >= 11) cnpj = digits0;
                            const lastPart = pncpParts[pncpParts.length - 1];
                            const seqAno = lastPart.match(/(\d+)\/(\d{4})/);
                            if (seqAno) {
                                if (!nSeq) nSeq = seqAno[1];
                                if (!ano) ano = seqAno[2];
                            }
                        }
                    }
                }
                // Fallback: extract all three from PNCP link URL (/editais/CNPJ/ANO/SEQ)
                if ((!cnpj || !ano || !nSeq) && (item.link || item.linkSistemaOrigem)) {
                    const lm = (item.link || item.linkSistemaOrigem || '').match(/editais\/(\d{11,14})\/(\d{4})\/(\d+)/);
                    if (lm) { if (!cnpj) cnpj = lm[1]; if (!ano) ano = lm[2]; if (!nSeq) nSeq = lm[3]; }
                }
                const rawVal = item.valor_estimado ?? item.valor_global ?? item.valorTotalEstimado
                    ?? item.valorTotalHomologado ?? item.amountInfo?.amount ?? item.valorTotalLicitacao
                    ?? item.valorEstimado ?? item.valorGlobal ?? item.valor_total ?? item.amount ?? null;
                const valorEstimado = rawVal != null ? (Number(rawVal) || 0) : 0;
                const modalidadeNome = item.modalidade_licitacao_nome || item.modalidade_nome || item.modalidadeNome
                    || item.modalidadeLicitacaoNome || '';
                const pncpId = item.numeroControlePNCP || (cnpj && ano && nSeq ? `${cnpj}-${ano}-${nSeq}` : null) || item.id || Math.random().toString();
                return {
                    id: pncpId,
                    orgao_nome: item.orgao_nome || item.orgaoEntidade?.razaoSocial || item.nomeOrgao || 'Órgão não informado',
                    orgao_cnpj: cnpj, ano, numero_sequencial: nSeq,
                    titulo: item.title || item.titulo || item.identificador || 'Sem título',
                    objeto: item.description || item.objetoCompra || item.objeto || item.resumo || 'Sem objeto',
                    data_publicacao: item.createdAt || item.dataPublicacaoPncp || item.data_publicacao || new Date().toISOString(),
                    data_abertura: item.dataAberturaProposta || item.data_inicio_vigencia || item.data_abertura || '',
                    data_encerramento_proposta: item.dataEncerramentoProposta || item.data_fim_vigencia || '',
                    valor_estimado: valorEstimado,
                    uf: item.uf || item.unidadeOrgao?.ufSigla || item.ufSigla || item.ufNome || '',
                    municipio: item.municipio_nome || item.unidadeOrgao?.municipioNome || item.municipio || '',
                    modalidade_nome: modalidadeNome,
                    link_sistema: (cnpj && ano && nSeq)
                        ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${nSeq}`
                        : (item.linkSistemaOrigem || item.link || ''),
                    link_comprasnet: item.linkSistemaOrigem || '',
                    status: item.situacao_nome || item.situacaoCompraNome || item.status || status || '',
                    esfera_id: item.esfera_id || item.esferaId || item.orgaoEntidade?.esferaId || '',
                    urgency: 'medium',
                };
            }).filter(item => {
                if (seenIds.has(item.id)) return false;
                seenIds.add(item.id);
                return true;
            });

            // ── Post-filter by UF (search API leaks UFs) ──
            if (typeof uf === 'string' && uf.trim() !== '') {
                const beforeCount = filteredItems.length;
                if (uf.includes(',')) {
                    const allowedUfs = new Set(uf.split(',').map((u: string) => u.trim().toUpperCase()));
                    filteredItems = filteredItems.filter((it: any) => {
                        const itemUf = (it.uf || '').toString().trim().toUpperCase();
                        return !itemUf || allowedUfs.has(itemUf);
                    });
                } else {
                    const ufUpper = uf.trim().toUpperCase();
                    filteredItems = filteredItems.filter((it: any) => {
                        const itemUf = (it.uf || '').toString().trim().toUpperCase();
                        return !itemUf || itemUf === ufUpper;
                    });
                }
                logger.info(`[PNCP] UF Post-Filter: kept ${filteredItems.length}/${beforeCount}`);
            }

            // ── Hydrate valor_estimado for search API results (top 10, time-budgeted) ──
            const elapsed = Date.now() - startTime;
            const hydrateBudget = Math.max(0, 15000 - elapsed); // Max 15s total for search+hydration
            if (hydrateBudget > 2000) {
                const itemsToHydrate = filteredItems.slice(0, 10).filter((it: any) =>
                    it.orgao_cnpj && it.ano && it.numero_sequencial && (!it.valor_estimado || it.valor_estimado === 0)
                );
                if (itemsToHydrate.length > 0) {
                    const hydrateResults = await Promise.allSettled(
                        itemsToHydrate.map((it: any) =>
                            axios.get(
                                `https://pncp.gov.br/api/consulta/v1/orgaos/${it.orgao_cnpj}/compras/${it.ano}/${it.numero_sequencial}`,
                                { httpsAgent: agent, timeout: Math.min(hydrateBudget, 5000) } as any
                            )
                        )
                    );
                    hydrateResults.forEach((r, idx) => {
                        if (r.status === 'fulfilled') {
                            const detail: any = r.value.data;
                            const val = detail?.valorTotalEstimado ?? detail?.valorTotalHomologado ?? null;
                            if (val != null && Number(val) > 0) {
                                itemsToHydrate[idx].valor_estimado = Number(val);
                            }
                        }
                    });
                    logger.info(`[PNCP] Hydrated values for ${itemsToHydrate.length} items (budget: ${hydrateBudget}ms)`);
                }
            } else {
                logger.warn(`[PNCP] Skipping hydration - time budget exhausted (${elapsed}ms elapsed)`);
            }
        }

        // ═══════════════════════════════════════
        // ── COMMON: Post-processing for both paths ──
        // ═══════════════════════════════════════

        // ── Post-filter by modalidade ──
        const modalidadeMap: Record<string, string> = {
            '1': 'Pregão', '2': 'Concorrência', '3': 'Concurso',
            '4': 'Leilão', '5': 'Diálogo Competitivo', '6': 'Dispensa',
            '7': 'Inexigibilidade', '8': 'Tomada de Preços', '9': 'Convite',
        };
        if (modalidade && modalidade !== 'todas') {
            const modalidadeLabel = (modalidadeMap[modalidade] || '').toLowerCase();
            if (modalidadeLabel) {
                filteredItems = filteredItems.filter((it: any) =>
                    (it.modalidade_nome || '').toLowerCase().includes(modalidadeLabel)
                );
            }
        }

        // ── C2 Fix: Post-filter by esfera (was completely missing) ──
        if (esfera && esfera !== 'todas') {
            const esferaMap: Record<string, string[]> = {
                'F': ['F', '1'], 'E': ['E', '2'], 'M': ['M', '3'], 'D': ['D', '4'],
            };
            const allowed = new Set(esferaMap[esfera] || [esfera]);
            const beforeEsfera = filteredItems.length;
            filteredItems = filteredItems.filter((it: any) =>
                !it.esfera_id || allowed.has(String(it.esfera_id))
            );
            if (filteredItems.length !== beforeEsfera) {
                logger.info(`[PNCP] Esfera Post-Filter (${esfera}): kept ${filteredItems.length}/${beforeEsfera}`);
            }
        }

        // ── Post-filter: exclude keywords ──
        if (excludeKeywords && typeof excludeKeywords === 'string' && excludeKeywords.trim()) {
            const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const excludeTerms = excludeKeywords.split(',')
                .map((t: string) => normalize(t.trim()))
                .filter((t: string) => t.length > 0);
            if (excludeTerms.length > 0) {
                filteredItems = filteredItems.filter((it: any) => {
                    const objNorm = normalize((it.objeto || '') + ' ' + (it.titulo || ''));
                    return !excludeTerms.some((term: string) => objNorm.includes(term));
                });
            }
        }

        // ── C3 Fix: Post-filter by publication date (Official API doesn't filter this) ──
        if (dataInicio || dataFim) {
            const beforeDate = filteredItems.length;
            const startTs = dataInicio ? new Date(dataInicio + 'T00:00:00').getTime() : 0;
            const endTs = dataFim ? new Date(dataFim + 'T23:59:59').getTime() : Infinity;
            filteredItems = filteredItems.filter((it: any) => {
                if (!it.data_publicacao) return true; // Keep items without pub date
                const pubTs = new Date(it.data_publicacao).getTime();
                if (isNaN(pubTs)) return true;
                return pubTs >= startTs && pubTs <= endTs;
            });
            if (filteredItems.length !== beforeDate) {
                logger.info(`[PNCP] Date Post-Filter: kept ${filteredItems.length}/${beforeDate}`);
            }
        }

        // ── C6 Fix: Sort by closest FUTURE deadline (expired items go to end) ──
        const now = Date.now();
        filteredItems.sort((a: any, b: any) => {
            const dateA = new Date(a.data_encerramento_proposta || a.data_abertura || '9999').getTime();
            const dateB = new Date(b.data_encerramento_proposta || b.data_abertura || '9999').getTime();
            const validA = !isNaN(dateA);
            const validB = !isNaN(dateB);
            const futureA = validA && dateA >= now;
            const futureB = validB && dateB >= now;
            // Future dates first
            if (futureA && !futureB) return -1;
            if (!futureA && futureB) return 1;
            // Both future: soonest deadline first
            if (futureA && futureB) return dateA - dateB;
            // Both past or invalid: most recent expired first
            if (!validA && !validB) return 0;
            if (!validA) return 1;
            if (!validB) return -1;
            return dateB - dateA;
        });

        const totalResults = filteredItems.length;
        pncpSearchCache.set(cacheKey, { data: filteredItems, timestamp: Date.now() });

        const endTime = Date.now();
        logger.info(`[PNCP] END (${endTime - startTime}ms) - Total: ${totalResults} items`);

        res.json({ items: filteredItems, total: totalResults });
    } catch (error: any) {
        logger.error("PNCP search error:", error?.message || error);
        handleApiError(res, error, 'pncp-search');
    }
});

// ══════════════════════════════════════════════════════════════
// ── PNCP Aggregator: Local search (queries PostgreSQL) ──
// Ultra-fast: < 200ms vs 8-25s from Gov.br
// ══════════════════════════════════════════════════════════════

router.post('/search-local', authenticateToken, async (req: any, res) => {
    try {
        const { keywords, status, uf, modalidade, esfera, valorMin, valorMax, pagina = 1, tamanhoPagina = 50 } = req.body;
        const startTime = Date.now();

        // ══════════════════════════════════════════════════
        // Prisma native queries — no BigInt issues, no raw SQL
        // ══════════════════════════════════════════════════

        const where: any = {};

        // UF filter
        if (uf) {
            const ufs = uf.split(',').map((u: string) => u.trim()).filter(Boolean);
            if (ufs.length === 1) {
                where.uf = ufs[0];
            } else if (ufs.length > 1) {
                where.uf = { in: ufs };
            }
        }

        // Status filter — include NULL for 'recebendo_proposta'
        if (status) {
            const statusMap: Record<string, string[]> = {
                'recebendo_proposta': ['Divulgada', 'Aberta'],
                'encerrada': ['Encerrada'],
                'suspensa': ['Suspensa'],
                'revogada': ['Revogada', 'Anulada'],
            };
            const mapped = statusMap[status];
            if (mapped) {
                if (status === 'recebendo_proposta') {
                    // Include NULL situacao — aggregator pulls from /proposta (all open)
                    where.OR = [
                        { situacao: { in: mapped } },
                        { situacao: null },
                    ];
                } else {
                    where.situacao = { in: mapped };
                }
            }
        }

        // Modalidade filter
        if (modalidade) {
            where.modalidade = { contains: modalidade, mode: 'insensitive' };
        }

        // Esfera filter
        if (esfera) {
            where.esfera = esfera;
        }

        // Valor range filter
        if (valorMin || valorMax) {
            where.valorEstimado = {};
            if (valorMin) where.valorEstimado.gte = Number(valorMin);
            if (valorMax) where.valorEstimado.lte = Number(valorMax);
        }

        // Keyword filter — ILIKE on objeto + orgaoNome + unidadeNome
        if (keywords && keywords.trim()) {
            const rawTerms = keywords.trim().split(/\s+/).filter((t: string) => t.length > 1);
            if (rawTerms.length > 0) {
                // Each term must match at least one field (AND between terms)
                const keywordFilters = rawTerms.map((term: string) => ({
                    OR: [
                        { objeto: { contains: term, mode: 'insensitive' as const } },
                        { orgaoNome: { contains: term, mode: 'insensitive' as const } },
                        { unidadeNome: { contains: term, mode: 'insensitive' as const } },
                    ]
                }));
                // Merge with existing OR (status filter)
                if (where.OR) {
                    // Status already has OR — wrap everything in AND
                    where.AND = [
                        { OR: where.OR }, // status condition
                        ...keywordFilters, // keyword conditions
                    ];
                    delete where.OR;
                } else {
                    where.AND = keywordFilters;
                }
            }
        }

        // Count total
        const total = await prisma.pncpContratacao.count({ where });

        // Fetch page with items
        const skip = (Number(pagina) - 1) * Number(tamanhoPagina);
        const contratacoes = await prisma.pncpContratacao.findMany({
            where,
            include: { itens: { take: 20, orderBy: { numeroItem: 'asc' } } },
            orderBy: { dataEncerramento: 'asc' },
            skip,
            take: Number(tamanhoPagina),
        });

        // Map to frontend format — MUST match Gov.br /search response exactly
        const now = Date.now();
        const items = contratacoes.map((c) => {
            const cnpj = c.cnpjOrgao || '';
            const ano = String(c.anoCompra || '');
            const nSeq = String(c.sequencialCompra || '');
            const pncpId = c.numeroControle || (cnpj && ano && nSeq ? `${cnpj}-${ano}-${nSeq}` : String(c.id));

            // Urgency based on deadline
            let urgency = 'medium';
            if (c.dataEncerramento) {
                const daysUntil = (new Date(c.dataEncerramento).getTime() - now) / (1000 * 3600 * 24);
                if (daysUntil <= 3) urgency = 'critical';
                else if (daysUntil <= 7) urgency = 'high';
                else if (daysUntil <= 15) urgency = 'medium';
                else urgency = 'low';
            }

            const titulo = c.objeto?.substring(0, 120) || `${c.modalidade || 'Licitação'} nº ${nSeq}/${ano}`;

            return {
                id: pncpId,
                orgao_cnpj: cnpj,
                ano,
                numero_sequencial: nSeq,
                titulo,
                objeto: c.objeto || 'Sem objeto',
                orgao_nome: c.orgaoNome || 'Órgão não informado',
                unidade_nome: c.unidadeNome || '',
                uf: c.uf || '',
                municipio: c.municipio || '',
                esfera: c.esfera || '',
                esfera_id: c.esfera || '',
                modalidade: c.modalidade || '',
                modalidade_nome: c.modalidade || '',
                situacao: c.situacao || '',
                status: c.situacao || 'Aberta',
                valor_estimado: c.valorEstimado ? Number(c.valorEstimado) : 0,
                valor_homologado: c.valorHomologado ? Number(c.valorHomologado) : null,
                srp: c.srp || false,
                data_publicacao: c.dataPublicacao ? c.dataPublicacao.toISOString() : new Date().toISOString(),
                data_abertura: c.dataAbertura ? c.dataAbertura.toISOString() : '',
                data_encerramento_proposta: c.dataEncerramento ? c.dataEncerramento.toISOString() : '',
                link_sistema: (cnpj && ano && nSeq)
                    ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${nSeq}`
                    : (c.linkOrigem || c.linkSistema || ''),
                link_comprasnet: c.linkSistema || '',
                numeroControlePNCP: c.numeroControle,
                urgency,
                itens_preview: (c as any).itens?.map((it: any) => ({
                    numero: it.numeroItem,
                    descricao: it.descricao,
                    quantidade: it.quantidade ? Number(it.quantidade) : null,
                    unidade: it.unidadeMedida,
                    valorUnitario: it.valorUnitario ? Number(it.valorUnitario) : null,
                    valorTotal: it.valorTotal ? Number(it.valorTotal) : null,
                })) || [],
                _source: 'local',
            };
        });

        const elapsed = Date.now() - startTime;
        logger.info(`[PNCP-LOCAL] Search: ${total} results in ${elapsed}ms (keywords="${keywords || ''}" uf="${uf || ''}")`);

        res.json({ items, total: Number(total), elapsed, source: 'local' });
    } catch (error: any) {
        logger.error("PNCP local search error:", error?.message || error);
        handleApiError(res, error, 'pncp-search-local');
    }
});

// ── Aggregator Stats (for admin dashboard) ──
router.get('/aggregator/stats', authenticateToken, async (req: any, res) => {
    try {
        const { getPncpAggregatorStats } = await import('../workers/pncpAggregator');
        const stats = await getPncpAggregatorStats();
        res.json(stats);
    } catch (error: any) {
        handleApiError(res, error, 'aggregator-stats');
    }
});

// ── Aggregator: Manual sync trigger (admin only) ──
router.post('/aggregator/sync', authenticateToken, async (req: any, res) => {
    try {
        if (req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Apenas administradores podem disparar sync manual' });
        }
        const { runPncpSync } = await import('../workers/pncpAggregator');
        // Fire and forget — don't block the response
        runPncpSync().then(result => {
            logger.info(`[PNCP-AGG] Manual sync complete: ${JSON.stringify(result)}`);
        }).catch(err => {
            logger.error(`[PNCP-AGG] Manual sync failed: ${err?.message}`);
        });
        res.json({ message: 'Sync manual iniciado. Verifique os stats em alguns minutos.' });
    } catch (error: any) {
        handleApiError(res, error, 'aggregator-sync');
    }
});

// ── Local items endpoint (fetches from PncpItem table) ──
router.get('/items-local/:cnpj/:ano/:seq', authenticateToken, async (req: any, res) => {
    try {
        const { cnpj, ano, seq } = req.params;
        const contratacao = await prisma.pncpContratacao.findFirst({
            where: {
                cnpjOrgao: cnpj,
                anoCompra: Number(ano),
                sequencialCompra: Number(seq),
            },
            include: { itens: { orderBy: { numeroItem: 'asc' } } },
        });

        if (!contratacao || contratacao.itens.length === 0) {
            return res.status(404).json({ error: 'Itens não encontrados na base local' });
        }

        // Map to same format as Gov.br API
        const items = contratacao.itens.map(it => ({
            numeroItem: it.numeroItem,
            descricao: it.descricao,
            quantidade: it.quantidade,
            unidadeMedida: it.unidadeMedida,
            valorUnitarioEstimado: it.valorUnitario,
            valorTotal: it.valorTotal,
            situacaoCompraItemNome: it.situacao,
            tipoBeneficioNome: it.tipoBeneficio,
        }));

        res.json(items);
    } catch (error: any) {
        handleApiError(res, error, 'items-local');
    }
});


export default router;

