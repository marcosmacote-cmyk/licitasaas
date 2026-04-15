/**
 * ═══════════════════════════════════════════════════════════════════
 * PNCP Aggregator — Serviço Independente de Sincronização
 * 
 * Roda como serviço separado no Railway. Conecta ao MESMO PostgreSQL 
 * do LicitaSaaS e sincroniza contratações do PNCP (Gov.br).
 *
 * Ciclos:
 * - SYNC: a cada 10 min, busca contratações com proposta aberta
 * - ITEMS: baixa itens para contratações recentes
 * - CLEANUP: 1x/dia, remove processos encerrados há >60 dias
 * - HEALTH: endpoint GET / para Railway health checks
 * ═══════════════════════════════════════════════════════════════════
 */

import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import https from 'https';
import http from 'http';

// ── Config ──
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('❌ FATAL: DATABASE_URL not set');
    process.exit(1);
}

const PORT = process.env.PORT || 3002;
const SYNC_INTERVAL_MS = 8 * 60 * 1000; // 8 minutes
const ITEMS_PER_CYCLE = 100;             // Fetch items for 100 contratações per cycle
const PNCP_BASE = 'https://pncp.gov.br/api/consulta/v1';
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 5 });

const prisma = new PrismaClient();

// All Brazilian states
const BRAZILIAN_UFS = [
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
    'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

// ── Stats ──
let lastSyncResult = { synced: 0, items: 0, cleaned: 0, elapsed: '0s', error: '' };
let totalCycles = 0;
let isRunning = false;

// ══════════════════════════════════════════
// ── Logger ──
// ══════════════════════════════════════════
function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: any) {
    const ts = new Date().toISOString();
    const emoji = level === 'INFO' ? '📡' : level === 'WARN' ? '⚠️' : '❌';
    const payload = data ? ' ' + JSON.stringify(data).substring(0, 300) : '';
    console.log(`[${ts}] ${emoji} [${level}] ${msg}${payload}`);
}

// ══════════════════════════════════════════
// ── HTTP Fetch with Retry ──
// ══════════════════════════════════════════
async function fetchWithRetry(url: string, retries = 3, delayMs = 2000): Promise<any> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const resp = await axios.get(url, {
                httpsAgent: agent,
                timeout: 15000,
                headers: { 'Accept': 'application/json' },
            });
            return resp.data;
        } catch (err: any) {
            const status = err?.response?.status;
            if (attempt < retries && (err.code === 'ECONNABORTED' || err.code === 'ECONNRESET' || status === 429 || status === 503 || status === 502)) {
                const wait = delayMs * (attempt + 1);
                log('WARN', `Retry ${attempt + 1}/${retries} after ${wait}ms`, { status: status || err.code, url: url.substring(0, 80) });
                await new Promise(r => setTimeout(r, wait));
                continue;
            }
            throw err;
        }
    }
}

// ══════════════════════════════════════════
// ── Data Mapping ──
// ══════════════════════════════════════════
function formatDate(d: Date): string {
    return d.toISOString().split('T')[0].replace(/-/g, '');
}

function mapSituacao(id: any): string {
    const map: Record<string, string> = {
        '1': 'Divulgada', '2': 'Aberta', '3': 'Encerrada',
        '4': 'Suspensa', '5': 'Revogada', '6': 'Anulada',
        '7': 'Deserta', '8': 'Fracassada',
    };
    return map[String(id)] || String(id);
}

function mapContratacao(item: any): any {
    const orgao = item.orgaoEntidade || {};
    const unidade = item.unidadeOrgao || {};
    const cnpj = orgao.cnpj || item.cnpjOrgao || '';
    const ano = item.anoCompra || item.ano || 0;
    const seq = item.sequencialCompra || item.numeroSequencial || 0;
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

function mapItem(contratacaoId: string, item: any, idx: number): any {
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

// ══════════════════════════════════════════
// ── SYNC: Fetch contratações with open proposals ──
// Endpoint: /contratacoes/proposta (same as working search)
// ══════════════════════════════════════════
async function syncContratacoes(): Promise<number> {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dataFinal = formatDate(tomorrow);
    let totalUpserted = 0;

    log('INFO', `Sync contratações via /contratacoes/proposta (dataFinal=${dataFinal})`);

    for (const uf of BRAZILIAN_UFS) {
        try {
            const url = `${PNCP_BASE}/contratacoes/proposta?dataFinal=${dataFinal}&uf=${uf}&pagina=1&tamanhoPagina=50`;
            const data = await fetchWithRetry(url, 2, 2000);
            const items = data?.data || [];

            if (items.length === 0) {
                log('INFO', `UF ${uf}: 0 contratações (vazio)`);
                continue;
            }

            // Fetch additional pages (up to 15 — captures ~750 per UF)
            let allItems = [...items];
            const totalPages = Math.min(data?.totalPaginas || 1, 15);
            for (let p = 2; p <= totalPages; p++) {
                try {
                    const pageUrl = `${PNCP_BASE}/contratacoes/proposta?dataFinal=${dataFinal}&uf=${uf}&pagina=${p}&tamanhoPagina=50`;
                    const pageData = await fetchWithRetry(pageUrl, 1, 2000);
                    if (pageData?.data?.length > 0) allItems.push(...pageData.data);
                } catch { break; }
                await new Promise(r => setTimeout(r, 300));
            }

            // Upsert contratações
            let ufUpserted = 0;
            for (const item of allItems) {
                try {
                    const mapped = mapContratacao(item);
                    if (!mapped.cnpjOrgao || !mapped.anoCompra || !mapped.sequencialCompra) continue;

                    await prisma.pncpContratacao.upsert({
                        where: { numeroControle: mapped.numeroControle },
                        update: { ...mapped, syncedAt: new Date() },
                        create: mapped,
                    });
                    ufUpserted++;
                } catch (err: any) {
                    if (!err?.message?.includes('Unique constraint')) {
                        log('WARN', `Skip: ${err?.message?.substring(0, 60)}`);
                    }
                }
            }

            totalUpserted += ufUpserted;
            log('INFO', `UF ${uf}: ${allItems.length} fetched → ${ufUpserted} upserted (total: ${totalUpserted})`);

            // Rate limit between UFs
            await new Promise(r => setTimeout(r, 500));
        } catch (err: any) {
            log('WARN', `UF ${uf} failed: ${err?.message?.substring(0, 80)}`);
            continue;
        }
    }

    return totalUpserted;
}

// ══════════════════════════════════════════
// ── SYNC ITEMS: Fetch items for contratações that don't have them yet ──
// ══════════════════════════════════════════
async function syncItems(limit: number): Promise<number> {
    const contratacoes = await prisma.pncpContratacao.findMany({
        where: {
            itens: { none: {} },
            cnpjOrgao: { not: '' },
            anoCompra: { gt: 0 },
            sequencialCompra: { gt: 0 },
        },
        select: { id: true, cnpjOrgao: true, anoCompra: true, sequencialCompra: true },
        take: limit,
        orderBy: { syncedAt: 'desc' },
    });

    if (contratacoes.length === 0) {
        log('INFO', 'Items sync: todas contratações já têm itens');
        return 0;
    }

    log('INFO', `Syncing items for ${contratacoes.length} contratações...`);
    let totalItems = 0;
    let fetched = 0;
    let errors = 0;

    for (const c of contratacoes) {
        try {
            const url = `${PNCP_BASE}/orgaos/${c.cnpjOrgao}/compras/${c.anoCompra}/${c.sequencialCompra}/itens?pagina=1&tamanhoPagina=500`;
            const data = await fetchWithRetry(url, 2, 1500);
            const items = Array.isArray(data) ? data : [];

            if (items.length > 0) {
                const mapped = items.map((it: any, idx: number) => mapItem(c.id, it, idx));
                await prisma.pncpItem.createMany({ data: mapped, skipDuplicates: true });
                totalItems += items.length;
            }
            fetched++;
            await new Promise(r => setTimeout(r, 300));
        } catch (err: any) {
            if (err?.response?.status === 404) continue;
            errors++;
            log('WARN', `Items failed ${c.cnpjOrgao}/${c.anoCompra}/${c.sequencialCompra}: ${err?.message?.substring(0, 60)}`);
        }
    }

    log('INFO', `Items sync: ${totalItems} itens for ${fetched}/${contratacoes.length} contratações (${errors} errors)`);
    return totalItems;
}

// ══════════════════════════════════════════
// ── CLEANUP: Remove old closed procurements ──
// ══════════════════════════════════════════
async function cleanup(): Promise<number> {
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

// ══════════════════════════════════════════
// ── MAIN SYNC CYCLE ──
// ══════════════════════════════════════════
async function runSyncCycle(): Promise<void> {
    if (isRunning) {
        log('WARN', 'Sync already running, skipping');
        return;
    }

    isRunning = true;
    const start = Date.now();
    totalCycles++;

    log('INFO', `═══════════════════════════════════════════`);
    log('INFO', `  PNCP SYNC CYCLE #${totalCycles} STARTING`);
    log('INFO', `═══════════════════════════════════════════`);

    try {
        // Update sync state
        await prisma.pncpSyncState.upsert({
            where: { id: 'singleton' },
            update: { isRunning: true },
            create: { id: 'singleton', isRunning: true },
        });

        // Phase 1: Sync contratações
        const synced = await syncContratacoes();

        // Phase 2: Sync items
        const items = await syncItems(ITEMS_PER_CYCLE);

        // Phase 3: Cleanup (once per day)
        let cleaned = 0;
        const state = await prisma.pncpSyncState.findUnique({ where: { id: 'singleton' } });
        if (state && (Date.now() - state.lastFullSyncAt.getTime()) > 24 * 60 * 60 * 1000) {
            cleaned = await cleanup();
            await prisma.pncpSyncState.update({
                where: { id: 'singleton' },
                data: { lastFullSyncAt: new Date() },
            });
        }

        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        lastSyncResult = { synced, items, cleaned, elapsed: `${elapsed}s`, error: '' };

        // Update sync state
        await prisma.pncpSyncState.update({
            where: { id: 'singleton' },
            data: {
                lastSyncAt: new Date(),
                totalSynced: { increment: synced },
                lastError: null,
                isRunning: false,
            },
        });

        // Final stats
        const totalContratacoes = await prisma.pncpContratacao.count();
        const totalItens = await prisma.pncpItem.count();

        log('INFO', `═══════════════════════════════════════════`);
        log('INFO', `  SYNC COMPLETE in ${elapsed}s`);
        log('INFO', `  📊 ${synced} contratações upserted`);
        log('INFO', `  📦 ${items} itens synced`);
        log('INFO', `  🧹 ${cleaned} cleaned`);
        log('INFO', `  💾 DB total: ${totalContratacoes} contratações, ${totalItens} itens`);
        log('INFO', `═══════════════════════════════════════════`);

    } catch (err: any) {
        lastSyncResult.error = err?.message || 'Unknown error';
        log('ERROR', `Sync cycle failed: ${err?.message}`);

        try {
            await prisma.pncpSyncState.update({
                where: { id: 'singleton' },
                data: { isRunning: false, lastError: err?.message?.substring(0, 500) },
            });
        } catch { /* ignore */ }
    } finally {
        isRunning = false;
    }
}

// ══════════════════════════════════════════
// ── Health Check HTTP Server ──
// (Railway needs a health endpoint)
// ══════════════════════════════════════════
const server = http.createServer(async (req, res) => {
    if (req.url === '/health' || req.url === '/') {
        try {
            await prisma.$queryRaw`SELECT 1`;
            const totalContratacoes = await prisma.pncpContratacao.count();
            const totalItens = await prisma.pncpItem.count();
            const state = await prisma.pncpSyncState.findUnique({ where: { id: 'singleton' } });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                service: 'pncp-aggregator',
                status: 'healthy',
                uptime: Math.floor(process.uptime()),
                cycles: totalCycles,
                isRunning,
                lastSync: lastSyncResult,
                database: {
                    contratacoes: totalContratacoes,
                    itens: totalItens,
                    lastSyncAt: state?.lastSyncAt,
                    totalSynced: state?.totalSynced || 0,
                },
            }));
        } catch (err: any) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'unhealthy', error: err.message }));
        }
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

// ══════════════════════════════════════════
// ── BOOT ──
// ══════════════════════════════════════════
async function main() {
    console.log(`
╔══════════════════════════════════════════╗
║   PNCP AGGREGATOR — v1.0.0              ║
║   Serviço de Sincronização PNCP         ║
╠══════════════════════════════════════════╣
║   Interval: ${SYNC_INTERVAL_MS / 60000} minutes                     ║
║   Items/cycle: ${ITEMS_PER_CYCLE}                       ║
║   UFs: ${BRAZILIAN_UFS.length} states                       ║
╚══════════════════════════════════════════╝
`);

    // Test database connection
    try {
        await prisma.$queryRaw`SELECT 1`;
        const count = await prisma.pncpContratacao.count();
        log('INFO', `✅ Database connected (${count} contratações in DB)`);
    } catch (err: any) {
        log('ERROR', `❌ Database connection failed: ${err.message}`);
        process.exit(1);
    }

    // Start health check server
    server.listen(PORT, () => {
        log('INFO', `🌐 Health check server on port ${PORT}`);
    });

    // Run first sync immediately
    log('INFO', '🚀 Starting initial sync...');
    await runSyncCycle();

    // Schedule recurring syncs
    setInterval(async () => {
        await runSyncCycle();
    }, SYNC_INTERVAL_MS);

    log('INFO', `⏰ Next sync in ${SYNC_INTERVAL_MS / 60000} minutes`);
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
