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
// ── PNCP Search (Extracted from index.ts) ──
// ══════════════════════════════════════════
router.post('/search', auth_1.authenticateToken, async (req, res) => {
    try {
        const { keywords, status, uf, pagina = 1, modalidade, dataInicio, dataFim, esfera, orgao, orgaosLista, excludeKeywords } = req.body;
        const pageSize = 10;
        let kwList = [];
        if (keywords) {
            if (keywords.includes(',')) {
                kwList = keywords.split(',')
                    .map((k) => k.trim().replace(/^"|"$/g, ''))
                    .filter((k) => k.length > 0)
                    .map((k) => k.includes(' ') ? `"${k}"` : k);
            }
            else {
                kwList = [keywords.includes(' ') && !keywords.startsWith('"') ? `"${keywords}"` : keywords];
            }
        }
        // Merge single orgao into orgaosLista if it contains commas
        let effectiveOrgao = orgao || '';
        let effectiveOrgaosLista = orgaosLista || '';
        if (effectiveOrgao.includes(',')) {
            effectiveOrgaosLista = effectiveOrgaosLista
                ? `${effectiveOrgaosLista},${effectiveOrgao}`
                : effectiveOrgao;
            effectiveOrgao = '';
        }
        // Expand region UF groups into individual UFs for separate fetches
        let ufsToIterate = [];
        if (uf && uf.includes(',')) {
            ufsToIterate = uf.split(',').map((u) => u.trim()).filter(Boolean);
        }
        else if (uf) {
            ufsToIterate = [uf];
        }
        const buildBaseUrl = (qItems, overrideCnpj, singleUf) => {
            let url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=${overrideCnpj ? 100 : 500}&pagina=1`;
            if (overrideCnpj) {
                url += `&cnpj=${overrideCnpj}`;
            }
            if (qItems.length > 0) {
                url += `&q=${encodeURIComponent(qItems.join(' '))}`;
            }
            if (status && status !== 'todas')
                url += `&status=${status}`;
            // Use single UF per request (region groups are split upstream)
            if (singleUf)
                url += `&ufs=${singleUf}`;
            if (modalidade && modalidade !== 'todas')
                url += `&modalidades_licitacao=${encodeURIComponent(modalidade)}`;
            if (dataInicio)
                url += `&data_inicio=${dataInicio}`;
            if (dataFim)
                url += `&data_fim=${dataFim}`;
            if (esfera && esfera !== 'todas')
                url += `&esferas=${esfera}`;
            return url;
        };
        let extractedNames = [];
        if (effectiveOrgaosLista) {
            extractedNames = effectiveOrgaosLista.split(/[\n,;]+/).map((s) => s.trim().replace(/^"|"$/g, '')).filter((s) => s.length > 0);
            extractedNames = [...new Set(extractedNames)]; // Remove duplicates
        }
        let urlsToFetch = [];
        const keywordsToIterate = kwList.length > 0 ? kwList : [null];
        const orgaosToIterate = extractedNames.length > 0 ? extractedNames : (effectiveOrgao ? [effectiveOrgao] : [null]);
        const ufsForIteration = ufsToIterate.length > 0 ? ufsToIterate : [null];
        for (const kw of keywordsToIterate) {
            for (const org of orgaosToIterate) {
                for (const singleUf of ufsForIteration) {
                    let localParams = [];
                    let overrideCnpj = undefined;
                    if (kw)
                        localParams.push(kw);
                    if (org) {
                        const onlyNumbers = org.replace(/\D/g, '');
                        if (onlyNumbers.length === 14) {
                            overrideCnpj = onlyNumbers;
                        }
                        else {
                            const exactOrgName = org.includes(' ') && !org.startsWith('"') ? `"${org}"` : org;
                            localParams.push(exactOrgName);
                        }
                    }
                    urlsToFetch.push(buildBaseUrl(localParams, overrideCnpj, singleUf || undefined));
                }
            }
        }
        // Limit max generated combinations to 1000 to avoid complete application DOS (extreme user input).
        urlsToFetch = urlsToFetch.slice(0, 1000);
        const agent = new https_1.default.Agent({ rejectUnauthorized: false });
        const startTime = Date.now();
        logger_1.logger.info(`[PNCP] START GET ${urlsToFetch.length} url(s) in batches...`);
        let rawItems = [];
        const chunkSize = 60;
        for (let i = 0; i < urlsToFetch.length; i += chunkSize) {
            const chunk = urlsToFetch.slice(i, i + chunkSize);
            const responses = await Promise.allSettled(chunk.map(u => axios_1.default.get(u, {
                headers: { 'Accept': 'application/json' },
                httpsAgent: agent,
                timeout: 25000
            })));
            responses.forEach((res) => {
                if (res.status === 'fulfilled') {
                    const data = res.value.data;
                    const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.data) ? data.data : []);
                    rawItems = rawItems.concat(items);
                }
                else {
                    logger_1.logger.error('[PNCP] Request failed:', res.reason?.message);
                }
            });
        }
        // First pass: extract what we can from search results
        // Also ensure no duplicate results based on PNCP ID just in case
        const seenIds = new Set();
        const items = rawItems.filter(item => item != null).map((item) => {
            const cnpj = item.orgao_cnpj || item.orgaoEntidade?.cnpj || item.cnpj || '';
            const ano = item.ano || item.anoCompra || '';
            const nSeq = item.numero_sequencial || item.sequencialCompra || item.numero_compra || '';
            // Extract value from all possible fields aggressively (null-safe)
            const rawVal = item.valor_estimado ?? item.valor_global ?? item.valorTotalEstimado
                ?? item.valorTotalHomologado ?? item.amountInfo?.amount ?? item.valorTotalLicitacao ?? null;
            const valorEstimado = rawVal != null ? (Number(rawVal) || 0) : 0;
            // Extract modalidade from API response
            const modalidadeNome = item.modalidade_licitacao_nome || item.modalidade_nome || item.modalidadeNome
                || item.modalidadeLicitacaoNome || '';
            const pncpId = item.numeroControlePNCP || (cnpj && ano && nSeq ? `${cnpj}-${ano}-${nSeq}` : null) || item.id || Math.random().toString();
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
                valor_estimado: valorEstimado,
                uf: item.uf || item.unidadeOrgao?.ufSigla || uf || '--',
                municipio: item.municipio_nome || item.unidadeOrgao?.municipioNome || item.municipio || '--',
                modalidade_nome: modalidadeNome,
                link_sistema: (cnpj && ano && nSeq)
                    ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${nSeq}`
                    : (item.linkSistemaOrigem || item.link || ''),
                link_comprasnet: item.linkSistemaOrigem || '',
                status: item.situacao_nome || item.situacaoCompraNome || item.status || status || '',
                esfera_id: item.esferaId || item.orgaoEntidade?.esferaId || '',
            };
        }).filter(item => {
            if (seenIds.has(item.id))
                return false;
            seenIds.add(item.id);
            return true;
        });
        // ── Post-filter by modalidade (API may not filter precisely) ──
        const modalidadeMap = {
            '1': 'Pregão - Eletrônico', '2': 'Concorrência', '3': 'Concurso',
            '4': 'Leilão', '5': 'Diálogo Competitivo', '6': 'Dispensa de Licitação',
            '7': 'Inexigibilidade', '8': 'Tomada de Preços', '9': 'Convite',
        };
        let filteredItems = items;
        if (modalidade && modalidade !== 'todas') {
            const modalidadeLabel = (modalidadeMap[modalidade] || '').toLowerCase();
            if (modalidadeLabel) {
                filteredItems = filteredItems.filter((it) => {
                    const nome = (it.modalidade_nome || '').toLowerCase();
                    return nome.includes(modalidadeLabel.split(' - ')[0]) || nome.includes(modalidadeLabel);
                });
            }
        }
        // ── Post-filter by exclude keywords (remove results with unwanted terms in objeto) ──
        if (excludeKeywords && typeof excludeKeywords === 'string' && excludeKeywords.trim()) {
            const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const excludeTerms = excludeKeywords.split(',')
                .map((t) => normalize(t.trim()))
                .filter((t) => t.length > 0);
            if (excludeTerms.length > 0) {
                filteredItems = filteredItems.filter((it) => {
                    const objNorm = normalize((it.objeto || '') + ' ' + (it.titulo || ''));
                    return !excludeTerms.some((term) => objNorm.includes(term));
                });
            }
        }
        // ── Post-filter by esfera (additional accuracy) ──
        // The PNCP API esfera param works on the search API but results may leak
        // We don't post-filter esfera since the API handles it and we don't have esfera in results
        // GLOBAL sort ALL items by closest deadline using search API dates
        const now = Date.now();
        filteredItems.sort((a, b) => {
            const dateA = new Date(a.data_encerramento_proposta || a.data_abertura || '9999').getTime();
            const dateB = new Date(b.data_encerramento_proposta || b.data_abertura || '9999').getTime();
            const absA = isNaN(dateA) ? Infinity : Math.abs(dateA - now);
            const absB = isNaN(dateB) ? Infinity : Math.abs(dateB - now);
            return absA - absB;
        });
        // Paginate first, then hydrate ONLY the page items (fast!)
        const totalResults = filteredItems.length;
        const startIdx = (Number(pagina) - 1) * pageSize;
        const pageItems = filteredItems.slice(startIdx, startIdx + pageSize);
        // Hydrate only the 10 items on this page from detail API
        const hydratedPageItems = await Promise.all(pageItems.map(async (item) => {
            if (item.orgao_cnpj && item.ano && item.numero_sequencial) {
                try {
                    const detailUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${item.orgao_cnpj}/compras/${item.ano}/${item.numero_sequencial}`;
                    const detailRes = await axios_1.default.get(detailUrl, { httpsAgent: agent, timeout: 5000 });
                    const d = detailRes.data;
                    if (d) {
                        if (!item.valor_estimado) {
                            const v = Number(d.valorTotalEstimado ?? d.valorTotalHomologado ?? d.valorGlobal ?? 0);
                            if (v > 0)
                                item.valor_estimado = v;
                        }
                        if (!item.modalidade_nome) {
                            item.modalidade_nome = d.modalidadeNome || d.modalidadeLicitacaoNome || d.modalidade?.nome || '';
                        }
                        // Hydrate dates from detail API
                        if (d.dataEncerramentoProposta) {
                            item.data_encerramento_proposta = d.dataEncerramentoProposta;
                        }
                        if (d.dataAberturaProposta) {
                            item.data_abertura = d.dataAberturaProposta;
                        }
                    }
                }
                catch (e) {
                    // Safe mute — detail endpoint can fail for some items
                }
            }
            return item;
        }));
        const endTime = Date.now();
        logger_1.logger.info(`[PNCP] END GET (${endTime - startTime}ms) - Total: ${totalResults}, Page ${pagina}: items ${startIdx}-${startIdx + hydratedPageItems.length}`);
        res.json({
            items: hydratedPageItems,
            total: totalResults
        });
    }
    catch (error) {
        logger_1.logger.error("PNCP search error:", error?.message || error);
        (0, errorHandler_1.handleApiError)(res, error, 'pncp-search');
    }
});
exports.default = router;
