"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * ══════════════════════════════════════════════════════════
 *  PNCP Routes — Saved Searches, Scanner, Favorites
 *  Extracted from server/index.ts (Sprint 8.1)
 * ══════════════════════════════════════════════════════════
 *
 *  NOTE: The /pncp/search and /pncp/analyze routes remain
 *  in index.ts due to their complexity and external deps.
 */
const express_1 = __importDefault(require("express"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middlewares/auth");
const logger_1 = require("../lib/logger");
const errorHandler_1 = require("../middlewares/errorHandler");
const axios_1 = __importDefault(require("axios"));
const https_1 = __importDefault(require("https"));
const router = express_1.default.Router();
// ══════════════════════════════════════════
// ── Saved Searches CRUD ──
// ══════════════════════════════════════════
router.get('/searches', auth_1.authenticateToken, async (req, res) => {
    try {
        const searches = await prisma_1.default.pncpSavedSearch.findMany({
            where: { tenantId: req.user.tenantId },
            include: { company: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(searches);
    }
    catch (error) {
        logger_1.logger.error("Fetch saved searches error:", error);
        res.status(500).json({ error: 'Failed to fetch saved searches' });
    }
});
router.post('/searches', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const search = await prisma_1.default.pncpSavedSearch.create({
            data: { ...req.body, tenantId }
        });
        res.json(search);
    }
    catch (error) {
        logger_1.logger.error("Create saved search error:", error);
        res.status(500).json({ error: 'Failed to create saved search' });
    }
});
router.delete('/searches/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const id = req.params.id;
        const tenantId = req.user.tenantId;
        await prisma_1.default.pncpSavedSearch.deleteMany({
            where: { id, tenantId }
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error("Delete saved search error:", error);
        res.status(500).json({ error: 'Failed to delete saved search' });
    }
});
// ── Update a single saved search ──
router.put('/searches/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const id = req.params.id;
        const tenantId = req.user.tenantId;
        const { name, keywords, status, states, listName, companyProfileId } = req.body;
        const data = {};
        if (name !== undefined)
            data.name = name;
        if (keywords !== undefined)
            data.keywords = keywords;
        if (status !== undefined)
            data.status = status;
        if (states !== undefined)
            data.states = states;
        if (listName !== undefined)
            data.listName = listName;
        if (companyProfileId !== undefined)
            data.companyProfileId = companyProfileId || null;
        await prisma_1.default.pncpSavedSearch.updateMany({
            where: { id, tenantId },
            data
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error("Update saved search error:", error);
        res.status(500).json({ error: 'Failed to update saved search' });
    }
});
// ── Rename a saved search list (bulk update listName) ──
router.put('/searches/list/rename', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { oldName, newName } = req.body;
        if (!oldName || !newName)
            return res.status(400).json({ error: 'oldName and newName required' });
        await prisma_1.default.pncpSavedSearch.updateMany({
            where: { tenantId, listName: oldName },
            data: { listName: newName.trim() }
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error("Rename search list error:", error);
        res.status(500).json({ error: 'Failed to rename list' });
    }
});
// ── Delete a saved search list (migrate items to default) ──
router.delete('/searches/list/:name', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const listName = decodeURIComponent(req.params.name);
        if (listName === 'Pesquisas Gerais')
            return res.status(400).json({ error: 'Cannot delete default list' });
        // Move all searches from this list to the default list
        await prisma_1.default.pncpSavedSearch.updateMany({
            where: { tenantId, listName },
            data: { listName: 'Pesquisas Gerais' }
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error("Delete search list error:", error);
        res.status(500).json({ error: 'Failed to delete list' });
    }
});
// ══════════════════════════════════════════
// ── Opportunity Scanner ──
// ══════════════════════════════════════════
router.get('/scanner/status', auth_1.authenticateToken, async (req, res) => {
    try {
        const globalConfig = await prisma_1.default.globalConfig.findUnique({
            where: { tenantId: req.user.tenantId }
        });
        if (!globalConfig)
            return res.json({ enabled: true });
        try {
            const conf = JSON.parse(globalConfig.config || '{}');
            res.json({
                enabled: conf.opportunityScannerEnabled !== false,
                lastScanAt: conf.lastScanAt || null,
                lastScanTotalNew: conf.lastScanTotalNew || 0,
                lastScanResults: conf.lastScanResults || [],
                nextScanAt: conf.nextScanAt || null,
            });
        }
        catch {
            res.json({ enabled: true });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get scanner status' });
    }
});
router.post('/scanner/toggle', auth_1.authenticateToken, async (req, res) => {
    try {
        const { enabled } = req.body;
        const tenantId = req.user.tenantId;
        const globalConfig = await prisma_1.default.globalConfig.upsert({
            where: { tenantId },
            update: {},
            create: { tenantId, config: '{}' }
        });
        let conf = {};
        try {
            conf = JSON.parse(globalConfig.config || '{}');
        }
        catch { }
        conf.opportunityScannerEnabled = enabled;
        await prisma_1.default.globalConfig.update({
            where: { tenantId },
            data: { config: JSON.stringify(conf) }
        });
        res.json({ success: true, enabled });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to toggle scanner status' });
    }
});
// ── Manual trigger for Opportunity Scanner ──
router.post('/scan-opportunities', auth_1.authenticateToken, async (req, res) => {
    try {
        const { runOpportunityScan } = await Promise.resolve().then(() => __importStar(require('../services/monitoring/opportunity-scanner.service')));
        logger_1.logger.info(`[OpportunityScanner] Manual scan triggered by tenant ${req.user.tenantId}`);
        // Run async — don't block the response
        runOpportunityScan(req.user.tenantId).catch(err => logger_1.logger.error('[OpportunityScanner] Manual scan error:', err));
        res.json({ success: true, message: 'Varredura de oportunidades iniciada. Você receberá notificações se houver novos editais.' });
    }
    catch (error) {
        logger_1.logger.error("Manual scan trigger error:", error);
        res.status(500).json({ error: 'Failed to trigger scan' });
    }
});
// ── List scanner-found opportunities ──
router.get('/scanner/opportunities', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const searchId = req.query.searchId;
        const page = parseInt(req.query.page) || 1;
        const pageSize = 50;
        const where = { tenantId };
        if (searchId)
            where.searchId = searchId;
        const [items, total] = await Promise.all([
            prisma_1.default.opportunityScannerLog.findMany({
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
            prisma_1.default.opportunityScannerLog.count({ where })
        ]);
        res.json({ items, total, page, pageSize });
    }
    catch (error) {
        logger_1.logger.error("Scanner opportunities error:", error);
        res.status(500).json({ error: 'Failed to list scanner opportunities' });
    }
});
// ── Mark opportunities as viewed ──
router.patch('/scanner/opportunities/mark-viewed', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { ids } = req.body;
        if (ids === 'all') {
            await prisma_1.default.opportunityScannerLog.updateMany({
                where: { tenantId, isViewed: false },
                data: { isViewed: true }
            });
        }
        else if (Array.isArray(ids) && ids.length > 0) {
            await prisma_1.default.opportunityScannerLog.updateMany({
                where: { tenantId, id: { in: ids } },
                data: { isViewed: true }
            });
        }
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error("Mark viewed error:", error);
        res.status(500).json({ error: 'Failed to mark as viewed' });
    }
});
// ── Get unread count (for sidebar badge) ──
router.get('/scanner/opportunities/unread-count', auth_1.authenticateToken, async (req, res) => {
    try {
        const count = await prisma_1.default.opportunityScannerLog.count({
            where: { tenantId: req.user.tenantId, isViewed: false }
        });
        res.json({ count });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get unread count' });
    }
});
// ── Reset scanner dedup history ──
router.post('/scanner/reset', auth_1.authenticateToken, async (req, res) => {
    try {
        const deleted = await prisma_1.default.opportunityScannerLog.deleteMany({
            where: { tenantId: req.user.tenantId }
        });
        logger_1.logger.info(`[OpportunityScanner] 🔄 Histórico de dedup resetado para tenant ${req.user.tenantId} (${deleted.count} registros removidos)`);
        res.json({ success: true, deleted: deleted.count, message: `Histórico limpo. ${deleted.count} registros removidos. Próxima varredura reenviará notificações.` });
    }
    catch (error) {
        logger_1.logger.error("Scanner reset error:", error);
        res.status(500).json({ error: 'Failed to reset scanner history' });
    }
});
// ══════════════════════════════════════════
// ── Favorites CRUD ──
// ══════════════════════════════════════════
router.get('/favorites', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const lists = await prisma_1.default.pncpFavoriteList.findMany({
            where: { tenantId },
            include: { items: true },
            orderBy: { createdAt: 'asc' }
        });
        res.json({ lists });
    }
    catch (error) {
        logger_1.logger.error("Fetch favorites error:", error);
        res.status(500).json({ error: 'Failed to fetch favorites' });
    }
});
router.post('/favorites/lists', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { name } = req.body;
        if (!name?.trim())
            return res.status(400).json({ error: 'Name required' });
        const list = await prisma_1.default.pncpFavoriteList.upsert({
            where: { tenantId_name: { tenantId, name: name.trim() } },
            update: {},
            create: { tenantId, name: name.trim() }
        });
        res.json(list);
    }
    catch (error) {
        logger_1.logger.error("Create fav list error:", error);
        res.status(500).json({ error: 'Failed to create list' });
    }
});
router.put('/favorites/lists/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { name } = req.body;
        if (!name?.trim())
            return res.status(400).json({ error: 'Name required' });
        await prisma_1.default.pncpFavoriteList.updateMany({
            where: { id: req.params.id, tenantId },
            data: { name: name.trim() }
        });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error("Rename fav list error:", error);
        res.status(500).json({ error: 'Failed to rename list' });
    }
});
router.delete('/favorites/lists/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const listId = req.params.id;
        const defaultList = await prisma_1.default.pncpFavoriteList.upsert({
            where: { tenantId_name: { tenantId, name: 'Favoritos Gerais' } },
            update: {},
            create: { tenantId, name: 'Favoritos Gerais' }
        });
        if (listId === defaultList.id)
            return res.status(400).json({ error: 'Cannot delete default list' });
        const itemsToMove = await prisma_1.default.pncpFavoriteItem.findMany({ where: { listId, tenantId } });
        for (const item of itemsToMove) {
            try {
                await prisma_1.default.pncpFavoriteItem.update({ where: { id: item.id }, data: { listId: defaultList.id } });
            }
            catch { /* duplicate — delete instead */
                await prisma_1.default.pncpFavoriteItem.delete({ where: { id: item.id } }).catch(() => { });
            }
        }
        await prisma_1.default.pncpFavoriteList.deleteMany({ where: { id: listId, tenantId } });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error("Delete fav list error:", error);
        res.status(500).json({ error: 'Failed to delete list' });
    }
});
router.post('/favorites/items', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { listId, pncpId, data } = req.body;
        if (!listId || !pncpId)
            return res.status(400).json({ error: 'listId and pncpId required' });
        const item = await prisma_1.default.pncpFavoriteItem.upsert({
            where: { tenantId_listId_pncpId: { tenantId, listId, pncpId } },
            update: { data },
            create: { tenantId, listId, pncpId, data }
        });
        res.json(item);
    }
    catch (error) {
        logger_1.logger.error("Add fav item error:", error);
        res.status(500).json({ error: 'Failed to add favorite' });
    }
});
router.delete('/favorites/items/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        await prisma_1.default.pncpFavoriteItem.deleteMany({ where: { id: req.params.id, tenantId } });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error("Remove fav item error:", error);
        res.status(500).json({ error: 'Failed to remove favorite' });
    }
});
router.delete('/favorites/items/by-pncp/:pncpId', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const pncpId = decodeURIComponent(req.params.pncpId);
        await prisma_1.default.pncpFavoriteItem.deleteMany({ where: { tenantId, pncpId } });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error("Remove fav by pncpId error:", error);
        res.status(500).json({ error: 'Failed to remove favorite' });
    }
});
// ── Bulk import favorites (migration from localStorage) ──
router.post('/favorites/import', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { lists, items } = req.body;
        let imported = 0;
        const listMap = new Map();
        for (const l of (lists || [])) {
            const list = await prisma_1.default.pncpFavoriteList.upsert({
                where: { tenantId_name: { tenantId, name: l.name } },
                update: {},
                create: { tenantId, name: l.name }
            });
            listMap.set(l.name, list.id);
        }
        for (const item of (items || [])) {
            const listId = listMap.get(item.listName) || listMap.get('Favoritos Gerais');
            if (!listId || !item.pncpId)
                continue;
            try {
                await prisma_1.default.pncpFavoriteItem.upsert({
                    where: { tenantId_listId_pncpId: { tenantId, listId, pncpId: item.pncpId } },
                    update: { data: item.data },
                    create: { tenantId, listId, pncpId: item.pncpId, data: item.data }
                });
                imported++;
            }
            catch { /* skip duplicates */ }
        }
        res.json({ success: true, imported, listsCreated: listMap.size });
    }
    catch (error) {
        logger_1.logger.error("Import favorites error:", error);
        res.status(500).json({ error: 'Failed to import favorites' });
    }
});
// ══════════════════════════════════════════
// ── PNCP Items API (Pre-filter capability) ──
// ══════════════════════════════════════════
// In-memory cache for PNCP items (avoids repeated slow Gov.br calls)
const pncpItemsCache = new Map();
const PNCP_ITEMS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
// Shared keepAlive agent — reuses TCP connections, eliminates TLS handshake overhead
const pncpKeepAliveAgent = new https_1.default.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 10 });
/**
 * Fetch items for a single process from Gov.br with retry + backoff.
 * Returns the parsed result or throws on complete failure.
 */
async function fetchPncpItems(cleanCnpj, cleanAno, cleanSeq) {
    const cacheKey = `${cleanCnpj}-${cleanAno}-${cleanSeq}`;
    const cached = pncpItemsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < PNCP_ITEMS_CACHE_TTL) {
        return cached.data;
    }
    const itemsUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${cleanCnpj}/compras/${cleanAno}/${cleanSeq}/itens?pagina=1&tamanhoPagina=100`;
    // Retry with escalating timeout: 5s first, 10s second attempt
    const timeouts = [5000, 10000];
    let lastError = null;
    for (let attempt = 0; attempt < timeouts.length; attempt++) {
        try {
            const resp = await axios_1.default.get(itemsUrl, {
                httpsAgent: pncpKeepAliveAgent,
                timeout: timeouts[attempt],
            });
            const responseData = resp.data;
            const rawItems = Array.isArray(responseData) ? responseData : (responseData?.data || responseData?.items || []);
            const items = rawItems.map((it) => ({
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
        }
        catch (err) {
            lastError = err;
            if (err?.response?.status === 404) {
                const emptyResult = { items: [], message: 'Itens não cadastrados no portal PNCP para este processo' };
                pncpItemsCache.set(cacheKey, { data: emptyResult, timestamp: Date.now() });
                return emptyResult;
            }
            // On timeout/network error: retry with longer timeout
            if (attempt < timeouts.length - 1) {
                logger_1.logger.warn(`[PNCP Items] Attempt ${attempt + 1} failed (${err?.message}), retrying with ${timeouts[attempt + 1]}ms timeout...`);
                await new Promise(r => setTimeout(r, 800)); // 800ms backoff
            }
        }
    }
    throw lastError;
}
router.get('/items', auth_1.authenticateToken, async (req, res) => {
    try {
        const { cnpj, ano, seq } = req.query;
        if (!cnpj || !ano || !seq)
            return res.status(400).json({ error: 'cnpj, ano, and seq required' });
        const cleanCnpj = String(cnpj).replace(/\D/g, '');
        const cleanAno = String(ano).replace(/\D/g, '');
        const cleanSeq = String(seq).replace(/\D/g, '');
        if (cleanCnpj.length < 11 || !cleanAno || !cleanSeq) {
            logger_1.logger.warn(`[PNCP Items] Invalid params: cnpj=${cnpj}, ano=${ano}, seq=${seq}`);
            return res.json({ items: [], message: 'Dados insuficientes para consultar itens (CNPJ/ano/sequencial incompletos)' });
        }
        const startTime = Date.now();
        const result = await fetchPncpItems(cleanCnpj, cleanAno, cleanSeq);
        const elapsed = Date.now() - startTime;
        if (elapsed > 100) { // Only log non-cached calls
            logger_1.logger.info(`[PNCP Items] ✅ ${result.items.length} items for ${cleanCnpj}-${cleanAno}-${cleanSeq} in ${elapsed}ms`);
        }
        res.json(result);
    }
    catch (error) {
        if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
            return res.status(504).json({ error: 'A API do Gov.br não respondeu a tempo. Tente novamente em alguns segundos.' });
        }
        logger_1.logger.error(`PNCP items error for ${req.query.cnpj}/${req.query.ano}/${req.query.seq}:`, error?.message || error);
        res.status(500).json({ error: 'Erro ao buscar itens no PNCP. Verifique se o processo possui itens cadastrados.' });
    }
});
/**
 * Batch prefetch endpoint — pre-warms cache for multiple items in parallel.
 * Called by the frontend immediately after search results load.
 * Returns nothing meaningful; the goal is to warm the cache.
 */
router.post('/items/prefetch', auth_1.authenticateToken, async (req, res) => {
    try {
        const { processes } = req.body; // Array of { cnpj, ano, seq }
        if (!Array.isArray(processes) || processes.length === 0) {
            return res.json({ prefetched: 0 });
        }
        // Limit to 5 concurrent prefetches to avoid overwhelming Gov.br
        const toFetch = processes.slice(0, 10).filter((p) => {
            if (!p.cnpj || !p.ano || !p.seq)
                return false;
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
                logger_1.logger.warn(`[PNCP Prefetch] Failed for ${cleanCnpj}-${cleanAno}-${cleanSeq}: ${err?.message}`);
            });
            await new Promise(r => setTimeout(r, 500)); // 500ms stagger
        }
    }
    catch (error) {
        logger_1.logger.error('[PNCP Prefetch] Error:', error?.message);
        if (!res.headersSent)
            res.json({ prefetched: 0, error: error?.message });
    }
});
// ══════════════════════════════════════════
// ── PNCP Search (Extracted from index.ts) ──
// ══════════════════════════════════════════
// The Gov.br search API uses DIFFERENT status values than what our UI sends.
// Our UI sends: 'recebendo_proposta', 'encerrada', 'suspensa', 'anulada', 'todas'
// Gov.br expects: 'recebendo_proposta', 'encerradas', 'suspensas', 'anuladas', (omit for all)
const STATUS_TO_GOVBR = {
    'recebendo_proposta': 'recebendo_proposta',
    'encerrada': 'encerradas',
    'suspensa': 'suspensas',
    'anulada': 'anuladas',
    'todas': '', // omit param entirely
};
// In-memory cache for PNCP search results (avoids repeated slow Gov.br calls)
const pncpSearchCache = new Map();
const PNCP_SEARCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
// ── Periodic cache cleanup to prevent memory leaks (P4 fix) ──
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of pncpSearchCache) {
        if (now - val.timestamp > PNCP_SEARCH_CACHE_TTL * 2)
            pncpSearchCache.delete(key);
    }
    for (const [key, val] of pncpItemsCache) {
        if (now - val.timestamp > PNCP_ITEMS_CACHE_TTL * 2)
            pncpItemsCache.delete(key);
    }
}, 5 * 60 * 1000); // Every 5 minutes
router.post('/search', auth_1.authenticateToken, async (req, res) => {
    try {
        const { PncpSearchService } = await Promise.resolve().then(() => __importStar(require('../services/pncp/pncp-search.service')));
        const result = await PncpSearchService.searchGovbr(req.body);
        res.json({ items: result.items, total: result.total, meta: result.meta });
    }
    catch (error) {
        logger_1.logger.error("PNCP search error:", error?.message || error);
        (0, errorHandler_1.handleApiError)(res, error, 'pncp-search');
    }
});
router.post('/search-local', auth_1.authenticateToken, async (req, res) => {
    try {
        const { PncpSearchService } = await Promise.resolve().then(() => __importStar(require('../services/pncp/pncp-search.service')));
        const result = await PncpSearchService.searchLocal(req.body);
        res.json({ items: result.items, total: result.total, totalLocal: result.meta.localCount, elapsed: result.meta.elapsedMs, source: 'local', meta: result.meta });
    }
    catch (error) {
        logger_1.logger.error("PNCP local search error:", error?.message || error);
        (0, errorHandler_1.handleApiError)(res, error, 'pncp-search-local');
    }
});
router.post('/search-hybrid', auth_1.authenticateToken, async (req, res) => {
    try {
        const { PncpSearchService } = await Promise.resolve().then(() => __importStar(require('../services/pncp/pncp-search.service')));
        const result = await PncpSearchService.search(req.body); // Faz a mágica do fallback automaticamente
        res.json({ items: result.items, total: result.total, totalLocal: result.meta.localCount, elapsed: result.meta.elapsedMs, source: result.meta.source, meta: result.meta });
    }
    catch (error) {
        logger_1.logger.error("PNCP hybrid search error:", error?.message || error);
        (0, errorHandler_1.handleApiError)(res, error, 'pncp-search-hybrid');
    }
});
// ══════════════════════════════════════════
// ── Sync Health (estado do Aggregator) ──
// ══════════════════════════════════════════
router.get('/sync-health', auth_1.authenticateToken, async (req, res) => {
    try {
        const state = await prisma_1.default.pncpSyncState.findUnique({ where: { id: 'singleton' } });
        const totalContratacoes = await prisma_1.default.pncpContratacao.count();
        const totalItens = await prisma_1.default.pncpItem.count();
        const totalAbertos = await prisma_1.default.pncpContratacao.count({ where: { situacao: { in: ['Divulgada', 'Aberta'] } } });
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
    }
    catch (error) {
        res.status(500).json({ error: error?.message || 'Erro ao buscar estado do sync' });
    }
});
// ══════════════════════════════════════════
// ── Items Local (consulta o banco PncpItem) ──
// ══════════════════════════════════════════
router.get('/items-local/:cnpj/:ano/:seq', auth_1.authenticateToken, async (req, res) => {
    try {
        const { cnpj, ano, seq } = req.params;
        const cleanCnpj = String(cnpj).replace(/\D/g, '');
        const cleanAno = Number(ano);
        const cleanSeq = Number(seq);
        if (!cleanCnpj || !cleanAno || !cleanSeq) {
            return res.json([]);
        }
        // Buscar contratação com seus itens
        const contratacao = await prisma_1.default.pncpContratacao.findFirst({
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
    }
    catch (error) {
        logger_1.logger.error("Items local error:", error?.message);
        res.json([]);
    }
});
exports.default = router;
