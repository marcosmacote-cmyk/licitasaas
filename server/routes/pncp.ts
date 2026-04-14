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

router.get('/items', authenticateToken, async (req: any, res) => {
    try {
        const { cnpj, ano, seq } = req.query;
        if (!cnpj || !ano || !seq) return res.status(400).json({ error: 'cnpj, ano, and seq required' });
        
        // Validate params — avoid doomed requests
        const cleanCnpj = String(cnpj).replace(/\D/g, '');
        const cleanAno = String(ano).replace(/\D/g, '');
        const cleanSeq = String(seq).replace(/\D/g, '');
        
        if (cleanCnpj.length < 11 || !cleanAno || !cleanSeq) {
            logger.warn(`[PNCP Items] Invalid params: cnpj=${cnpj}, ano=${ano}, seq=${seq}`);
            return res.json({ items: [], message: 'Dados insuficientes para consultar itens (CNPJ/ano/sequencial incompletos)' });
        }
        
        const cacheKey = `${cleanCnpj}-${cleanAno}-${cleanSeq}`;
        const cached = pncpItemsCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < PNCP_ITEMS_CACHE_TTL) {
            return res.json(cached.data);
        }

        const startTime = Date.now();
        const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
        
        // The old /api/pncp/v1/ now returns 301, so prioritize /api/consulta/v1/
        const primaryUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${cleanCnpj}/compras/${cleanAno}/${cleanSeq}/itens?pagina=1&tamanhoPagina=100`;
        const fallbackUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${cleanCnpj}/compras/${cleanAno}/${cleanSeq}/itens?pagina=1&tamanhoPagina=100`;
        
        let responseData: any = null;
        
        try {
            // Try primary endpoint first (fast path)
            try {
                const primaryRes = await axios.get(primaryUrl, { httpsAgent: agent, timeout: 6000 } as any);
                responseData = primaryRes.data;
            } catch (primaryErr: any) {
                // If primary fails with non-404, try fallback
                if (primaryErr?.response?.status === 404) {
                    const emptyResult = { items: [], message: 'Itens não cadastrados no portal PNCP para este processo' };
                    pncpItemsCache.set(cacheKey, { data: emptyResult, timestamp: Date.now() });
                    return res.json(emptyResult);
                }
                logger.warn(`[PNCP Items] Primary endpoint failed (${primaryErr?.message}), trying fallback...`);
                const fallbackRes = await axios.get(fallbackUrl, { httpsAgent: agent, timeout: 5000, maxRedirects: 5 } as any);
                responseData = fallbackRes.data;
            }
        } catch (fetchErr: any) {
            throw fetchErr;
        }
        
        const elapsed = Date.now() - startTime;
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
        logger.info(`[PNCP Items] ✅ ${items.length} items for ${cacheKey} in ${elapsed}ms`);
        
        res.json(result);
    } catch (error: any) {
        if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
            return res.status(504).json({ error: 'A API do Gov.br não respondeu a tempo. Tente novamente em alguns segundos.' });
        }
        logger.error(`PNCP items error for ${req.query.cnpj}/${req.query.ano}/${req.query.seq}:`, error?.message || error);
        res.status(500).json({ error: 'Erro ao buscar itens no PNCP. Verifique se o processo possui itens cadastrados.' });
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
        const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
        logger.info(`[PNCP] SEARCH REQUEST - status="${status}" uf="${uf}" keywords="${keywords}" modalidade="${modalidade}"`);

        // ══════════════════════════════════════════════════════════════
        // ── STRATEGY: Use Official Consulta API when possible ──
        // The /api/consulta/v1/ returns valorTotalEstimado, UF reliable,
        // and structured data. The /api/search/ is needed only for 
        // full-text keyword matching.
        // ══════════════════════════════════════════════════════════════

        let filteredItems: any[] = [];
        const useOfficialApi = (status === 'recebendo_proposta' || !status || status === '') && !orgao && !orgaosLista;

        if (useOfficialApi) {
            // ── FAST PATH: Official PNCP Consulta API ──
            // Endpoint: /api/consulta/v1/contratacoes/proposta
            // Returns: valorTotalEstimado, UF, modalidade, everything!
            logger.info(`[PNCP] Using OFFICIAL API (contratacoes/proposta) fast path`);
            
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const dataFinalParam = dataFim ? dataFim.replace(/-/g, '') : tomorrow.toISOString().split('T')[0].replace(/-/g, '');

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
            const chunkSize = 15;
            const MAX_ITEMS = 500;

            for (let i = 0; i < urlsToFetch.length; i += chunkSize) {
                if (rawItems.length >= MAX_ITEMS) break;
                const chunk = urlsToFetch.slice(i, i + chunkSize);
                const responses = await Promise.allSettled(
                    chunk.map(u => axios.get(u, {
                        headers: { 'Accept': 'application/json' },
                        httpsAgent: agent,
                        timeout: 8000
                    } as any))
                );
                for (const r of responses) {
                    if (r.status === 'fulfilled') {
                        const data = r.value.data as any;
                        const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.data) ? data.data : []);
                        rawItems = rawItems.concat(items);
                    }
                }
            }

            // Map search API results to standard format
            const seenIds = new Set<string>();
            filteredItems = rawItems.filter(item => item != null).map((item: any) => {
                const cnpj = item.orgao_cnpj || item.orgaoEntidade?.cnpj || item.cnpj || '';
                const ano = item.ano || item.anoCompra || '';
                const nSeq = item.numero_sequencial || item.sequencialCompra || item.numero_compra || '';
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
                    esfera_id: item.esferaId || item.orgaoEntidade?.esferaId || '',
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

            // ── Hydrate valor_estimado for search API results (top 30) ──
            const itemsToHydrate = filteredItems.slice(0, 30).filter((it: any) =>
                it.orgao_cnpj && it.ano && it.numero_sequencial && (!it.valor_estimado || it.valor_estimado === 0)
            );
            if (itemsToHydrate.length > 0) {
                const hydrateResults = await Promise.allSettled(
                    itemsToHydrate.map((it: any) =>
                        axios.get(
                            `https://pncp.gov.br/api/consulta/v1/orgaos/${it.orgao_cnpj}/compras/${it.ano}/${it.numero_sequencial}`,
                            { httpsAgent: agent, timeout: 4000 } as any
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
                logger.info(`[PNCP] Hydrated values for ${itemsToHydrate.length} items`);
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

        // ── Sort by closest deadline ──
        const now = Date.now();
        filteredItems.sort((a: any, b: any) => {
            const dateA = new Date(a.data_encerramento_proposta || a.data_abertura || '9999').getTime();
            const dateB = new Date(b.data_encerramento_proposta || b.data_abertura || '9999').getTime();
            const absA = isNaN(dateA) ? Infinity : Math.abs(dateA - now);
            const absB = isNaN(dateB) ? Infinity : Math.abs(dateB - now);
            return absA - absB;
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


export default router;

