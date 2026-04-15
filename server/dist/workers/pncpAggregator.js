"use strict";
/**
 * ═══════════════════════════════════════════════════════════
 * PNCP Aggregator — Worker de sincronização
 *
 * Sincroniza contratações do PNCP (Gov.br) para o PostgreSQL local.
 * Roda como cron job a cada 15 minutos.
 *
 * Estratégia:
 * - INCREMENTAL: a cada 15min, busca contratações publicadas desde o último sync
 * - FULL REFRESH: 1x por dia (3h), varre os últimos 7 dias completos
 * - CLEANUP: Remove contratações encerradas há mais de 60 dias
 * ═══════════════════════════════════════════════════════════
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPncpSync = runPncpSync;
exports.getPncpAggregatorStats = getPncpAggregatorStats;
const client_1 = require("@prisma/client");
const axios_1 = __importDefault(require("axios"));
const https_1 = __importDefault(require("https"));
const prisma = new client_1.PrismaClient();
const PNCP_BASE = 'https://pncp.gov.br/api/consulta/v1';
const PNCP_SEARCH = 'https://pncp.gov.br/api/search';
const agent = new https_1.default.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 5 });
// Logger
const log = (level, msg, data) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [PNCP-AGG] [${level}] ${msg}`, data ? JSON.stringify(data).substring(0, 200) : '');
};
/**
 * Formata data para YYYYMMDD (formato da API consulta PNCP)
 */
function formatDate(d) {
    return d.toISOString().split('T')[0].replace(/-/g, '');
}
// All Brazilian states for full coverage sync
const BRAZILIAN_UFS = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
    'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];
/**
 * Fetch com retry e backoff
 */
async function fetchWithRetry(url, retries = 3, delayMs = 2000) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const resp = await axios_1.default.get(url, {
                httpsAgent: agent,
                timeout: 15000,
                headers: { 'Accept': 'application/json' },
            });
            return resp.data;
        }
        catch (err) {
            const status = err?.response?.status;
            if (attempt < retries && (err.code === 'ECONNABORTED' || err.code === 'ECONNRESET' || status === 429 || status === 503 || status === 502)) {
                const wait = delayMs * (attempt + 1);
                log('WARN', `Retry ${attempt + 1}/${retries} after ${wait}ms (${err.code || status})`, { url: url.substring(0, 100) });
                await new Promise(r => setTimeout(r, wait));
                continue;
            }
            throw err;
        }
    }
}
/**
 * Mapeia dados do endpoint /publicacao para o modelo PncpContratacao
 */
function mapContratacao(item) {
    const orgao = item.orgaoEntidade || {};
    const unidade = item.unidadeOrgao || {};
    const cnpj = orgao.cnpj || item.cnpjOrgao || '';
    const ano = item.anoCompra || item.ano || 0;
    const seq = item.sequencialCompra || item.numeroSequencial || item.numero_sequencial || 0;
    const numeroControle = item.numeroControlePNCP || `${cnpj}-1-${seq}/${ano}`;
    return {
        numeroControle,
        cnpjOrgao: cnpj,
        anoCompra: Number(ano),
        sequencialCompra: Number(seq),
        orgaoNome: orgao.razaoSocial || item.orgaoNome || null,
        unidadeNome: unidade.nomeUnidade || item.unidadeNome || null,
        uf: unidade.ufSigla || unidade.uf || item.uf || null,
        municipio: unidade.nomeMunicipio || unidade.municipio || item.municipio || null,
        esfera: orgao.esferaId || item.esfera || null,
        objeto: item.objetoCompra || item.objeto || null,
        modalidade: item.modalidadeNome || item.modalidade || null,
        modalidadeCodigo: item.modalidadeId?.toString() || item.modalidadeCodigo || null,
        situacao: item.situacaoCompraId ? mapSituacao(item.situacaoCompraId) : (item.situacao || null),
        valorEstimado: item.valorTotalEstimado ? Number(item.valorTotalEstimado) : null,
        valorHomologado: item.valorTotalHomologado ? Number(item.valorTotalHomologado) : null,
        srp: item.srp === true || item.srp === 'Sim',
        modoDisputa: item.modoDisputaNome || item.modoDisputa || null,
        numeroCompra: item.numeroCompra || null,
        dataPublicacao: item.dataPublicacaoPncp ? new Date(item.dataPublicacaoPncp) : null,
        dataAbertura: item.dataAberturaProposta ? new Date(item.dataAberturaProposta) : null,
        dataEncerramento: item.dataEncerramentoProposta ? new Date(item.dataEncerramentoProposta) : null,
        dataInclusao: item.dataInclusao ? new Date(item.dataInclusao) : null,
        linkSistema: item.linkSistemaOrigem || null,
        linkOrigem: numeroControle ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}` : null,
    };
}
function mapSituacao(id) {
    const map = {
        '1': 'Divulgada', '2': 'Aberta', '3': 'Encerrada',
        '4': 'Suspensa', '5': 'Revogada', '6': 'Anulada',
        '7': 'Deserta', '8': 'Fracassada',
    };
    return map[String(id)] || String(id);
}
/**
 * Mapeia item da API para PncpItem
 */
function mapItem(contratacaoId, item, idx) {
    return {
        contratacaoId,
        numeroItem: item.numeroItem || idx + 1,
        descricao: item.descricao || item.materialOuServico || null,
        quantidade: item.quantidade ? Number(item.quantidade) : null,
        unidadeMedida: item.unidadeMedida || null,
        valorUnitario: item.valorUnitarioEstimado ? Number(item.valorUnitarioEstimado) : null,
        valorTotal: item.valorTotal ? Number(item.valorTotal) : null,
        situacao: item.situacaoCompraItemNome || null,
        tipoBeneficio: item.tipoBeneficioNome || null,
    };
}
/**
 * SYNC INCREMENTAL: Busca contratações com proposta aberta
 * Usa o mesmo endpoint que funciona no search: /contratacoes/proposta
 */
async function syncIncremental() {
    // Get or create sync state
    let state = await prisma.pncpSyncState.findUnique({ where: { id: 'singleton' } });
    if (!state) {
        state = await prisma.pncpSyncState.create({
            data: { id: 'singleton', lastSyncAt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        });
    }
    if (state.isRunning) {
        log('WARN', 'Sync already running, skipping');
        return 0;
    }
    await prisma.pncpSyncState.update({
        where: { id: 'singleton' },
        data: { isRunning: true }
    });
    try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dataFinal = formatDate(tomorrow);
        let totalUpserted = 0;
        log('INFO', `Sync incremental via /contratacoes/proposta (dataFinal=${dataFinal})`);
        // Fetch per UF for better coverage (same strategy as working search)
        for (const uf of BRAZILIAN_UFS) {
            try {
                const url = `${PNCP_BASE}/contratacoes/proposta?dataFinal=${dataFinal}&uf=${uf}&pagina=1&tamanhoPagina=50`;
                const data = await fetchWithRetry(url, 2, 2000);
                const items = data?.data || [];
                if (items.length === 0)
                    continue;
                // Fetch additional pages (up to 5 pages per UF = 250 items)
                let allItems = [...items];
                const totalPages = Math.min(data?.totalPaginas || 1, 20);
                for (let p = 2; p <= totalPages; p++) {
                    try {
                        const pageUrl = `${PNCP_BASE}/contratacoes/proposta?dataFinal=${dataFinal}&uf=${uf}&pagina=${p}&tamanhoPagina=50`;
                        const pageData = await fetchWithRetry(pageUrl, 1, 2000);
                        if (pageData?.data?.length > 0)
                            allItems.push(...pageData.data);
                    }
                    catch {
                        break;
                    }
                    await new Promise(r => setTimeout(r, 300));
                }
                // Upsert contratações
                for (const item of allItems) {
                    try {
                        const mapped = mapContratacao(item);
                        if (!mapped.cnpjOrgao || !mapped.anoCompra || !mapped.sequencialCompra)
                            continue;
                        await prisma.pncpContratacao.upsert({
                            where: { numeroControle: mapped.numeroControle },
                            update: { ...mapped, syncedAt: new Date() },
                            create: mapped,
                        });
                        totalUpserted++;
                    }
                    catch (err) {
                        if (!err?.message?.includes('Unique constraint')) {
                            log('WARN', `Skip item: ${err?.message?.substring(0, 80)}`);
                        }
                    }
                }
                log('INFO', `UF ${uf}: ${allItems.length} items fetched, total upserted so far: ${totalUpserted}`);
                // Rate limit between UFs
                await new Promise(r => setTimeout(r, 500));
            }
            catch (err) {
                log('WARN', `UF ${uf} failed: ${err?.message?.substring(0, 80)}`);
                continue; // Skip failed UFs, don't stop entire sync
            }
        }
        // Update sync state
        await prisma.pncpSyncState.update({
            where: { id: 'singleton' },
            data: {
                lastSyncAt: new Date(),
                totalSynced: { increment: totalUpserted },
                lastError: null,
                isRunning: false,
            }
        });
        log('INFO', `Sync incremental complete: ${totalUpserted} upserted across ${BRAZILIAN_UFS.length} UFs`);
        return totalUpserted;
    }
    catch (err) {
        log('ERROR', `Sync incremental failed: ${err?.message}`);
        await prisma.pncpSyncState.update({
            where: { id: 'singleton' },
            data: { isRunning: false, lastError: err?.message?.substring(0, 500) }
        });
        return 0;
    }
}
/**
 * SYNC ITENS: Baixa itens para contratações que ainda não têm
 */
async function syncItens(limit = 50) {
    // Find contratacoes without items
    const contratacoes = await prisma.pncpContratacao.findMany({
        where: {
            itens: { none: {} },
            cnpjOrgao: { not: '' },
            anoCompra: { gt: 0 },
            sequencialCompra: { gt: 0 },
        },
        select: { id: true, cnpjOrgao: true, anoCompra: true, sequencialCompra: true },
        take: limit,
        orderBy: { syncedAt: 'desc' }, // Newest first
    });
    if (contratacoes.length === 0)
        return 0;
    log('INFO', `Syncing items for ${contratacoes.length} contratações`);
    let totalItems = 0;
    for (const c of contratacoes) {
        try {
            const url = `${PNCP_BASE}/orgaos/${c.cnpjOrgao}/compras/${c.anoCompra}/${c.sequencialCompra}/itens?pagina=1&tamanhoPagina=500`;
            const data = await fetchWithRetry(url, 2, 1500);
            const items = Array.isArray(data) ? data : [];
            if (items.length > 0) {
                // Use createMany with skipDuplicates for efficiency
                const mapped = items.map((it, idx) => mapItem(c.id, it, idx));
                await prisma.pncpItem.createMany({
                    data: mapped,
                    skipDuplicates: true,
                });
                totalItems += items.length;
            }
            // Rate limit
            await new Promise(r => setTimeout(r, 500));
        }
        catch (err) {
            // Skip 404s (no items) and continue
            if (err?.response?.status === 404)
                continue;
            log('WARN', `Items fetch failed for ${c.cnpjOrgao}/${c.anoCompra}/${c.sequencialCompra}: ${err?.message?.substring(0, 80)}`);
        }
    }
    log('INFO', `Items sync complete: ${totalItems} items for ${contratacoes.length} contratações`);
    return totalItems;
}
/**
 * CLEANUP: Remove contratações encerradas há mais de 60 dias
 */
async function cleanup() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    const result = await prisma.pncpContratacao.deleteMany({
        where: {
            dataEncerramento: { lt: cutoff },
            situacao: { in: ['Encerrada', 'Revogada', 'Anulada', 'Deserta', 'Fracassada'] },
        }
    });
    if (result.count > 0) {
        log('INFO', `Cleanup: removed ${result.count} old contratações`);
    }
    return result.count;
}
/**
 * MAIN SYNC CYCLE — chamado pelo cron
 */
async function runPncpSync() {
    log('INFO', '═══ PNCP Sync cycle starting ═══');
    const start = Date.now();
    const synced = await syncIncremental();
    const items = await syncItens(500); // Sync items for 500 contratações per cycle (boosted to catch up)
    // Cleanup once per day (check if last full sync was > 24h ago)
    let cleaned = 0;
    const state = await prisma.pncpSyncState.findUnique({ where: { id: 'singleton' } });
    if (state && (Date.now() - state.lastFullSyncAt.getTime()) > 24 * 60 * 60 * 1000) {
        cleaned = await cleanup();
        await prisma.pncpSyncState.update({
            where: { id: 'singleton' },
            data: { lastFullSyncAt: new Date() }
        });
    }
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log('INFO', `═══ PNCP Sync complete in ${elapsed}s: ${synced} contratações, ${items} items, ${cleaned} cleaned ═══`);
    return { synced, items, cleaned };
}
/**
 * GET STATS — para o health check / admin
 */
async function getPncpAggregatorStats() {
    const state = await prisma.pncpSyncState.findUnique({ where: { id: 'singleton' } });
    const totalContratacoes = await prisma.pncpContratacao.count();
    const totalItens = await prisma.pncpItem.count();
    const totalAbertos = await prisma.pncpContratacao.count({ where: { situacao: { in: ['Divulgada', 'Aberta'] } } });
    return {
        lastSyncAt: state?.lastSyncAt,
        lastFullSyncAt: state?.lastFullSyncAt,
        totalSynced: state?.totalSynced || 0,
        totalContratacoes,
        totalItens,
        totalAbertos,
        isRunning: state?.isRunning || false,
        lastError: state?.lastError,
    };
}
