import axios from 'axios';
import https from 'https';
import { prisma } from '../../lib/prisma';
import { NotificationService } from '../monitoring/notification.service';

/**
 * PNCP Opportunity Scanner — Monitora automaticamente pesquisas salvas
 * e notifica o tenant quando novos editais correspondentes são publicados.
 * 
 * Arquitetura:
 *   PncpSavedSearch (DB)  →  PNCP API  →  Dedup (OpportunityScannerLog DB)  →  NotificationService
 * 
 * Melhorias implementadas:
 *   1. Retry com backoff exponencial (3 tentativas)
 *   2. Paginação completa (até 250 resultados por pesquisa)
 *   3. Limpeza automática de registros >30 dias
 *   4. Sumário consolidado ao final da varredura
 *   5. Rastreamento de resultados por pesquisa (para badges no frontend)
 */

// Rate limit: máximo de buscas a cada ciclo para não sobrecarregar PNCP
const MAX_SEARCHES_PER_CYCLE = 20;
const PNCP_REQUEST_DELAY_MS = 1500; // 1.5s entre requisições à API do PNCP
const MAX_RETRIES = 3;
const MAX_PAGES_PER_SEARCH = 5; // Máximo 5 páginas = 250 resultados
const DEDUP_EXPIRY_DAYS = 30; // Limpar registros com mais de 30 dias

const agent = new https.Agent({ rejectUnauthorized: false });

interface PncpSearchResult {
    id: string;
    titulo: string;
    objeto: string;
    orgao_nome: string;
    uf: string;
    municipio: string;
    valor_estimado: number;
    data_encerramento_proposta: string;
    modalidade_nome: string;
    link_sistema: string;
}

/** Resultado do scan por pesquisa — usado para sumário e badges */
interface SearchScanResult {
    searchId: string;
    searchName: string;
    companyName: string;
    totalFound: number;
    newCount: number;
    status: 'ok' | 'error';
    errorMessage?: string;
}

/**
 * Faz uma requisição HTTP com retry e backoff exponencial.
 * @param url URL a ser buscada
 * @param retries Número de tentativas restantes (default: 3)
 * @returns dados da resposta ou null se todas falharem
 */
async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<any | null> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await axios.get(url, {
                headers: { 'Accept': 'application/json' },
                httpsAgent: agent,
                timeout: 15000
            } as any);
            return res.data;
        } catch (err: any) {
            const isLast = attempt === retries;
            if (isLast) {
                console.warn(`[OpportunityScanner] ❌ Falha após ${retries} tentativas: ${err.message}`);
                return null;
            }
            const backoffMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
            console.warn(`[OpportunityScanner] ⚠️ Tentativa ${attempt}/${retries} falhou (${err.message}). Retentando em ${backoffMs / 1000}s...`);
            await new Promise(r => setTimeout(r, backoffMs));
        }
    }
    return null;
}

/**
 * Executa uma busca PNCP com os mesmos filtros da pesquisa salva.
 * Agora com paginação completa (até MAX_PAGES_PER_SEARCH páginas) e retry.
 */
async function executePncpSearch(search: {
    keywords: string | null;
    status: string | null;
    states: string | null;
}): Promise<PncpSearchResult[]> {
    const keywords = search.keywords || '';
    const status = search.status || 'recebendo_proposta';

    // Parse keywords (mesma lógica do endpoint /api/pncp/search)
    let kwList: string[] = [];
    if (keywords) {
        if (keywords.includes(',')) {
            kwList = keywords.split(',')
                .map(k => k.trim().replace(/^"|"$/g, ''))
                .filter(k => k.length > 0)
                .map(k => k.includes(' ') ? `"${k}"` : k);
        } else {
            kwList = [keywords.includes(' ') && !keywords.startsWith('"') ? `"${keywords}"` : keywords];
        }
    }

    // Parse extra filters from states (stored as JSON string)
    let ufs: string[] = [];
    let modalidade = ''; let esfera = ''; let orgao = ''; let orgaosLista = ''; let excludeKeywords = ''; let dataInicio = ''; let dataFim = '';

    if (search.states) {
        try {
            const parsed = JSON.parse(search.states);
            if (Array.isArray(parsed)) ufs = parsed;
            else if (typeof parsed === 'object') {
                if (parsed.uf) {
                    if (parsed.uf.includes(',')) ufs = parsed.uf.split(',').map((u: string) => u.trim()).filter(Boolean);
                    else ufs = [parsed.uf];
                }
                modalidade = parsed.modalidade || '';
                esfera = parsed.esfera || '';
                orgao = parsed.orgao || '';
                orgaosLista = parsed.orgaosLista || '';
                excludeKeywords = parsed.excludeKeywords || '';
                dataInicio = parsed.dataInicio || '';
                dataFim = parsed.dataFim || '';
            } else if (typeof parsed === 'string' && parsed.length > 0) ufs = parsed.split(',');
        } catch {
            if (search.states.includes(',')) ufs = search.states.split(',').map(s => s.trim());
            else if (search.states.length === 2) ufs = [search.states];
        }
    }

    // Process orgao and orgaosLista into single list
    let extractedNames: string[] = [];
    if (orgao && orgao.includes(',')) {
        orgaosLista = orgaosLista ? `${orgaosLista},${orgao}` : orgao;
        orgao = '';
    }
    if (orgaosLista) {
        extractedNames = orgaosLista.split(/[\n,;]+/).map((s: string) => s.trim().replace(/^"|"$/g, '')).filter((s: string) => s.length > 0);
        extractedNames = [...new Set(extractedNames)]; // Remove duplicates
    }
    const orgaosToIterate = extractedNames.length > 0 ? extractedNames : (orgao ? [orgao] : [null]);

    // Build URL (now accepts page parameter)
    const buildUrl = (qItems: string[], singleUf?: string, singleOrgao?: string, pagina = 1) => {
        let url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=50&pagina=${pagina}`;
        
        let terms = [...qItems];
        if (singleOrgao) terms.push(singleOrgao.includes(' ') && !singleOrgao.startsWith('"') ? `"${singleOrgao}"` : singleOrgao);

        if (terms.length > 0) url += `&q=${encodeURIComponent(terms.join(' '))}`;

        if (status && status !== 'todas') url += `&status=${status}`;
        if (singleUf) url += `&ufs=${singleUf}`;
        if (modalidade && modalidade !== 'todas') url += `&modalidades_licitacao=${encodeURIComponent(modalidade)}`;
        if (dataInicio) url += `&data_inicio=${dataInicio}`;
        if (dataFim) url += `&data_fim=${dataFim}`;
        if (esfera && esfera !== 'todas') url += `&esferas=${esfera}`;
        return url;
    };

    const keywordsToIterate = kwList.length > 0 ? kwList : [null];
    const ufsForIteration = ufs.length > 0 ? ufs : [null];

    // Build base URL combinations (page 1)
    const baseUrlCombinations: { params: string[]; uf?: string; org?: string }[] = [];
    for (const kw of keywordsToIterate) {
        for (const singleUf of ufsForIteration) {
            for (const org of orgaosToIterate) {
                const params: string[] = [];
                if (kw) params.push(kw);
                baseUrlCombinations.push({ params, uf: singleUf || undefined, org: org || undefined });
            }
        }
    }

    // Limit combinations
    const combinations = baseUrlCombinations.slice(0, 20);
    
    let excludeList: string[] = [];
    if (excludeKeywords) {
        excludeList = excludeKeywords.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    }

    let rawItems: any[] = [];
    
    for (const combo of combinations) {
        // ── Paginação: buscar múltiplas páginas por combinação ──
        for (let page = 1; page <= MAX_PAGES_PER_SEARCH; page++) {
            const url = buildUrl(combo.params, combo.uf, combo.org, page);
            
            const data = await fetchWithRetry(url);
            if (!data) break; // Falhou após retries, pular combinação
            
            const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.data) ? data.data : []);
            rawItems = rawItems.concat(items);
            
            // Se retornou menos que 50, não há mais páginas
            if (items.length < 50) break;
            
            // Rate limit entre páginas
            await new Promise(r => setTimeout(r, PNCP_REQUEST_DELAY_MS));
        }
        
        // Rate limit entre combinações
        await new Promise(r => setTimeout(r, PNCP_REQUEST_DELAY_MS));
    }

    // Dedup and normalize
    const seenIds = new Set<string>();
    return rawItems.filter(item => item != null).map((item: any) => {
        const cnpj = item.orgao_cnpj || item.orgaoEntidade?.cnpj || '';
        const ano = item.ano || item.anoCompra || '';
        const nSeq = item.numero_sequencial || item.sequencialCompra || '';
        const pncpId = item.numeroControlePNCP || (cnpj && ano && nSeq ? `${cnpj}-${ano}-${nSeq}` : null) || item.id || Math.random().toString();

        return {
            id: pncpId,
            titulo: item.title || item.titulo || 'Sem título',
            objeto: item.description || item.objetoCompra || item.objeto || '',
            orgao_nome: item.orgao_nome || item.orgaoEntidade?.razaoSocial || 'Órgão não informado',
            uf: item.uf || item.unidadeOrgao?.ufSigla || '--',
            municipio: item.municipio_nome || item.unidadeOrgao?.municipioNome || '--',
            valor_estimado: Number(item.valor_estimado ?? item.valor_global ?? item.valorTotalEstimado ?? 0) || 0,
            data_encerramento_proposta: item.dataEncerramentoProposta || item.data_fim_vigencia || '',
            modalidade_nome: item.modalidade_licitacao_nome || item.modalidade_nome || '',
            link_sistema: (cnpj && ano && nSeq) ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${nSeq}` : (item.linkSistemaOrigem || ''),
        };
    }).filter(item => {
        if (seenIds.has(item.id)) return false;

        if (excludeList.length > 0) {
            const txt = `${item.titulo} ${item.objeto}`.toLowerCase();
            const containsExclude = excludeList.some(ex => txt.includes(ex));
            if (containsExclude) return false;
        }

        seenIds.add(item.id);
        return true;
    });
}

/**
 * Formata valor em BRL
 */
function formatBRL(value: number): string {
    if (!value) return 'N/D';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

/**
 * Formata data para exibição
 */
function formatDate(dateStr: string): string {
    if (!dateStr) return 'N/D';
    try {
        return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return dateStr; }
}

/**
 * Verifica se um pncpId já foi notificado para um tenant (usando DB persistente)
 */
async function isAlreadyNotified(tenantId: string, pncpId: string): Promise<boolean> {
    const existing = await prisma.opportunityScannerLog.findUnique({
        where: { tenantId_pncpId: { tenantId, pncpId } }
    });
    return !!existing;
}

/**
 * Marca um pncpId como notificado para um tenant (persistido no DB)
 */
async function markAsNotified(tenantId: string, pncpId: string, searchId?: string): Promise<void> {
    try {
        await prisma.opportunityScannerLog.create({
            data: { tenantId, pncpId, searchId }
        });
    } catch {
        // Unique constraint violation — already notified. Ok to ignore.
    }
}

/**
 * Limpeza automática: remove registros de dedup com mais de DEDUP_EXPIRY_DAYS dias.
 * Isso permite que editais antigos sejam "re-descobertos" caso voltem a aceitar propostas.
 */
async function cleanupOldDedupRecords(): Promise<number> {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - DEDUP_EXPIRY_DAYS);
        
        const result = await prisma.opportunityScannerLog.deleteMany({
            where: { createdAt: { lt: cutoffDate } }
        });
        
        if (result.count > 0) {
            console.log(`[OpportunityScanner] 🧹 Limpeza automática: ${result.count} registros com >${DEDUP_EXPIRY_DAYS} dias removidos`);
        }
        return result.count;
    } catch (error: any) {
        console.error(`[OpportunityScanner] ⚠️ Erro na limpeza automática:`, error.message);
        return 0;
    }
}

/**
 * Salva os resultados da última varredura no GlobalConfig do tenant
 * para que o frontend possa exibir informações sobre último scan.
 */
async function saveScanResults(tenantId: string, results: SearchScanResult[], totalNew: number): Promise<void> {
    try {
        const existing = await prisma.globalConfig.findUnique({ where: { tenantId } });
        const config = existing ? JSON.parse(existing.config || '{}') : {};
        
        config.lastScanAt = new Date().toISOString();
        config.lastScanTotalNew = totalNew;
        config.lastScanResults = results.map(r => ({
            searchId: r.searchId,
            searchName: r.searchName,
            companyName: r.companyName,
            totalFound: r.totalFound,
            newCount: r.newCount,
            status: r.status,
            errorMessage: r.errorMessage,
        }));
        
        // Calcular próxima varredura (4 horas após a última)
        const nextScan = new Date();
        nextScan.setHours(nextScan.getHours() + 4);
        config.nextScanAt = nextScan.toISOString();
        
        if (existing) {
            await prisma.globalConfig.update({
                where: { tenantId },
                data: { config: JSON.stringify(config) }
            });
        } else {
            await prisma.globalConfig.create({
                data: { tenantId, config: JSON.stringify(config) }
            });
        }
    } catch (error: any) {
        console.error(`[OpportunityScanner] Erro ao salvar resultados do scan:`, error.message);
    }
}

/**
 * Envia mensagem de sumário consolidado ao final da varredura
 */
async function sendConsolidatedSummary(
    tenantId: string, 
    config: any, 
    scanResults: SearchScanResult[], 
    totalNew: number
): Promise<void> {
    // Só envia sumário se houve pelo menos 1 pesquisa processada
    if (scanResults.length === 0) return;
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza' });
    const nextScan = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const nextTimeStr = nextScan.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza' });
    
    let message = `📊 <b>Varredura PNCP Concluída</b> (${timeStr})\n`;
    message += `━━━━━━━━━━━━━━━\n`;
    
    for (const r of scanResults) {
        const icon = r.status === 'error' ? '❌' : (r.newCount > 0 ? '✅' : '⏩');
        const companyTag = r.companyName ? ` <i>(${r.companyName})</i>` : '';
        
        if (r.status === 'error') {
            message += `${icon} ${r.searchName}${companyTag}: erro\n`;
        } else if (r.newCount > 0) {
            message += `${icon} ${r.searchName}${companyTag}: <b>${r.newCount} novo(s)</b>\n`;
        } else {
            message += `${icon} ${r.searchName}${companyTag}: 0 novos\n`;
        }
    }
    
    message += `━━━━━━━━━━━━━━━\n`;
    message += `<b>Total: ${totalNew} novo(s) edital(is)</b>\n`;
    message += `⏰ Próxima varredura: ~${nextTimeStr}\n`;
    message += `\n<i>LicitaSaaS — Scanner PNCP</i>`;
    
    // Enviar via Telegram
    if (config?.telegramChatId) {
        await NotificationService.sendTelegram(tenantId, config.telegramChatId, message);
    }
    
    // Enviar via WhatsApp
    if (config?.phoneNumber) {
        const plainMessage = message.replace(/<[^>]*>/g, '').replace(/━+/g, '───');
        await NotificationService.sendWhatsApp(tenantId, config.phoneNumber, plainMessage);
    }
}

/**
 * Ciclo principal: executa todas as pesquisas salvas com autoMonitor ativo
 */
export async function runOpportunityScan() {
    try {
        // ── Melhoria 5: Limpeza automática de registros antigos ──
        await cleanupOldDedupRecords();
        
        // Buscar todas as pesquisas salvas de todos os tenants ativos
        const searches = await prisma.pncpSavedSearch.findMany({
            include: {
                tenant: {
                    include: { chatMonitorConfig: true }
                },
                company: true
            },
            take: MAX_SEARCHES_PER_CYCLE
        });

        if (searches.length === 0) {
            console.log(`[OpportunityScanner] ⚠️ Nenhuma pesquisa salva encontrada. Configure pesquisas no PNCP.`);
            return;
        }

        console.log(`[OpportunityScanner] 🔍 Iniciando varredura de ${searches.length} pesquisas salvas...`);

        // Fetch GlobalConfigs to check if scanner is disabled
        const tenantIds = Array.from(new Set(searches.map(s => s.tenantId)));
        const globalConfigs = await prisma.globalConfig.findMany({
            where: { tenantId: { in: tenantIds } }
        });
        const scannerEnabledMap = new Map<string, boolean>();
        for (const gc of globalConfigs) {
            try {
                const conf = JSON.parse(gc.config || '{}');
                // Default to true if not explicitly false
                scannerEnabledMap.set(gc.tenantId, conf.opportunityScannerEnabled !== false);
            } catch {
                scannerEnabledMap.set(gc.tenantId, true);
            }
        }

        // Agrupar pesquisas por tenant para consolidar notificações
        const byTenant = new Map<string, { searches: typeof searches; config: any }>();
        for (const s of searches) {
            const tenantId = s.tenantId;
            
            // Se o tenant desativou o scanner globalmente, ignora as pesquisas dele
            if (scannerEnabledMap.has(tenantId) && scannerEnabledMap.get(tenantId) === false) {
                continue;
            }

            if (!byTenant.has(tenantId)) {
                byTenant.set(tenantId, { searches: [], config: (s.tenant as any).chatMonitorConfig });
            }
            byTenant.get(tenantId)!.searches.push(s);
        }

        let totalNewResults = 0;

        for (const [tenantId, { searches: tenantSearches, config }] of byTenant) {
            
            // ── Rastrear resultados por pesquisa para sumário e badges ──
            const scanResults: SearchScanResult[] = [];

            for (const search of tenantSearches) {
                const companyName = (search as any).company?.name || (search as any).company?.razaoSocial || '';
                
                try {
                    const results = await executePncpSearch({
                        keywords: search.keywords,
                        status: search.status,
                        states: search.states,
                    });

                    console.log(`[OpportunityScanner] 📋 "${search.name}": ${results.length} resultados encontrados na API PNCP`);

                    // Filtrar apenas resultados novos (não notificados anteriormente — via DB)
                    const newResults: PncpSearchResult[] = [];
                    for (const r of results) {
                        const alreadyNotified = await isAlreadyNotified(tenantId, r.id);
                        if (!alreadyNotified) {
                            newResults.push(r);
                        }
                    }

                    // Registrar TODOS como notificados no DB (persistente)
                    for (const r of newResults) {
                        await markAsNotified(tenantId, r.id, search.id);
                    }

                    // ── Registrar resultado desta pesquisa ──
                    scanResults.push({
                        searchId: search.id,
                        searchName: search.name,
                        companyName,
                        totalFound: results.length,
                        newCount: newResults.length,
                        status: 'ok',
                    });

                    if (newResults.length > 0) {
                        console.log(`[OpportunityScanner] ✅ "${search.name}": ${newResults.length} novos resultados`);
                        totalNewResults += newResults.length;

                        // ── Enviar notificação individual por pesquisa ──
                        const headerCompany = companyName ? ` (${companyName})` : '';
                        const displayResults = newResults.slice(0, 8); // Máx 8 por notificação

                        // Telegram / WhatsApp message
                        let message = `🔔 <b>PNCP: ${search.name}</b>${headerCompany}\n\n`;
                        message += `<b>${newResults.length} novo(s) edital(is)</b> encontrado(s)\n`;

                        for (const r of displayResults) {
                            message += `\n━━━━━━━━━━━━━━━\n`;
                            message += `📌 <b>${r.titulo}</b>\n`;
                            message += `🏛 ${r.orgao_nome}\n`;
                            message += `📍 ${r.municipio !== '--' ? `${r.municipio}-` : ''}${r.uf}\n`;
                            if (r.valor_estimado) message += `💰 ${formatBRL(r.valor_estimado)}\n`;
                            if (r.data_encerramento_proposta) message += `📅 Prazo: ${formatDate(r.data_encerramento_proposta)}\n`;
                            if (r.modalidade_nome) message += `📎 ${r.modalidade_nome}\n`;
                            message += `🔗 ${r.link_sistema}\n`;
                        }

                        if (newResults.length > displayResults.length) {
                            message += `\n━━━━━━━━━━━━━━━\n`;
                            message += `... e mais <b>${newResults.length - displayResults.length}</b> edital(is).\n`;
                        }

                        message += `\n<i>LicitaSaaS — Scanner PNCP</i>`;

                        // Send Telegram
                        if (config?.telegramChatId) {
                            await NotificationService.sendTelegram(tenantId, config.telegramChatId, message);
                            await new Promise(r => setTimeout(r, 1000)); // Rate limit between messages
                        }

                        // Send WhatsApp
                        if (config?.phoneNumber) {
                            const plainMessage = message.replace(/<[^>]*>/g, '').replace(/━+/g, '───');
                            await NotificationService.sendWhatsApp(tenantId, config.phoneNumber, plainMessage);
                        }

                        // Send Email
                        const htmlMessage = `
                            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
                                <h2 style="color: #2563eb;">📋 ${search.name}${headerCompany}</h2>
                                <p>${newResults.length} novo(s) edital(is) encontrado(s) para esta pesquisa.</p>
                                ${displayResults.map(r => `
                                    <div style="background-color: #f3f4f6; padding: 12px; border-radius: 8px; margin: 12px 0; border-left: 4px solid #2563eb;">
                                        <strong>${r.titulo}</strong><br>
                                        <span style="color: #6b7280;">🏛 ${r.orgao_nome} — ${r.municipio !== '--' ? `${r.municipio}-` : ''}${r.uf}</span><br>
                                        ${r.valor_estimado ? `<span>💰 ${formatBRL(r.valor_estimado)}</span><br>` : ''}
                                        ${r.data_encerramento_proposta ? `<span>📅 Prazo: ${formatDate(r.data_encerramento_proposta)}</span><br>` : ''}
                                        ${r.modalidade_nome ? `<span>📎 ${r.modalidade_nome}</span><br>` : ''}
                                        <a href="${r.link_sistema}" style="color: #2563eb;">Ver no PNCP →</a>
                                    </div>
                                `).join('')}
                                ${newResults.length > displayResults.length ? `<p style="color: #6b7280;">... e mais ${newResults.length - displayResults.length} edital(is). Acesse o LicitaSaaS para ver todos.</p>` : ''}
                                <br>
                                <p style="font-size: 12px; color: #9ca3af;">LicitaSaaS — Scanner de Oportunidades PNCP</p>
                            </div>
                        `;

                        try {
                            const activeUsers = await prisma.user.findMany({ where: { tenantId, isActive: true }, select: { email: true } });
                            for (const user of activeUsers) {
                                if (user.email) {
                                    await NotificationService.sendEmail(tenantId, user.email, `PNCP: ${search.name} — ${newResults.length} novo(s)`, htmlMessage);
                                }
                            }
                        } catch (error: any) {
                            console.error(`[OpportunityScanner] Erro ao enviar e-mail para tenant ${tenantId}:`, error.message);
                        }

                        console.log(`[OpportunityScanner] 📤 "${search.name}" → ${newResults.length} oportunidades notificadas`);
                    } else {
                        console.log(`[OpportunityScanner] ⏩ "${search.name}": 0 novos (já notificados)`);
                    }
                } catch (err: any) {
                    console.warn(`[OpportunityScanner] ❌ Erro na pesquisa "${search.name}": ${err.message}`);
                    scanResults.push({
                        searchId: search.id,
                        searchName: search.name,
                        companyName,
                        totalFound: 0,
                        newCount: 0,
                        status: 'error',
                        errorMessage: err.message,
                    });
                }

                // Rate limit between searches
                await new Promise(r => setTimeout(r, 2000));
            }

            // ── Melhoria 2: Sumário consolidado ──
            await sendConsolidatedSummary(tenantId, config, scanResults, totalNewResults);
            
            // ── Melhoria 4: Salvar resultados para frontend (badges + último scan) ──
            await saveScanResults(tenantId, scanResults, totalNewResults);
        }

        if (totalNewResults > 0) {
            console.log(`[OpportunityScanner] ✅ Varredura concluída: ${totalNewResults} novas oportunidades encontradas e notificadas`);
        } else {
            console.log(`[OpportunityScanner] ✅ Varredura concluída: nenhuma nova oportunidade (todos já notificados)`);
        }

    } catch (error: any) {
        console.error(`[OpportunityScanner] ❌ Erro fatal:`, error.message);
    }
}

/**
 * Inicializa o scanner com intervalo configurável
 * @param intervalHours - Intervalo em horas entre varreduras (default: 4)
 */
export function startOpportunityScanner(intervalHours: number = 4) {
    const intervalMs = intervalHours * 60 * 60 * 1000;
    
    console.log(`[OpportunityScanner] 🚀 Scanner de Oportunidades PNCP iniciado (intervalo: ${intervalHours}h)`);

    // Primeira execução: aguardar 2 minutos após boot (dar tempo para o sistema estabilizar)
    setTimeout(() => {
        console.log(`[OpportunityScanner] Executando primeira varredura...`);
        runOpportunityScan();
    }, 2 * 60 * 1000);

    // Execuções recorrentes
    setInterval(() => {
        runOpportunityScan();
    }, intervalMs);
}
