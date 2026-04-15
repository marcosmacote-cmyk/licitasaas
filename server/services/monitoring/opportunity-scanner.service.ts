import axios from 'axios';
import https from 'https';
import { prisma } from '../../lib/prisma';
import { NotificationService } from '../monitoring/notification.service';
import { logger } from '../../lib/logger';

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
 * Executa uma busca PNCP utilizando o novo PncpSearchService unificado.
 * Isso garante que o robô obtenha EXATAMENTE os mesmos resultados
 * da tela de Busca, eliminando discrepâncias.
 */
async function executePncpSearch(search: {
    keywords: string | null;
    status: string | null;
    states: string | null;
}): Promise<PncpSearchResult[]> {
    const { PncpSearchService } = await import('../pncp/pncp-search.service');
    
    let ufs = '';
    let modalidade = ''; let esfera = ''; let orgao = ''; let orgaosLista = ''; let excludeKeywords = '';
    let dataInicio = ''; let dataFim = '';

    if (search.states) {
        try {
            const parsed = JSON.parse(search.states);
            if (Array.isArray(parsed)) ufs = parsed.join(',');
            else if (typeof parsed === 'object') {
                if (parsed.uf) ufs = parsed.uf;
                modalidade = parsed.modalidade || '';
                esfera = parsed.esfera || '';
                orgao = parsed.orgao || '';
                orgaosLista = parsed.orgaosLista || '';
                excludeKeywords = parsed.excludeKeywords || '';
                dataInicio = parsed.dataInicio || '';
                dataFim = parsed.dataFim || '';
            } else if (typeof parsed === 'string' && parsed.length > 0) ufs = parsed;
        } catch {
            ufs = search.states;
        }
    }

    const input = {
        keywords: search.keywords || '',
        status: search.status || 'recebendo_proposta',
        uf: ufs, modalidade, esfera, orgao, orgaosLista, excludeKeywords,
        dataInicio, dataFim,
        pagina: 1,
        // Carga máxima permitida por varredura
        tamanhoPagina: 150 
    };

    // A mágica agora mora no Service. O robô sempre usará a base unificada.
    const result = await PncpSearchService.search(input);

    return result.items.map((c: any) => ({
        id: c.id,
        titulo: c.titulo,
        objeto: c.objeto,
        orgao_nome: c.orgao_nome,
        uf: c.uf,
        municipio: c.municipio,
        valor_estimado: c.valor_estimado,
        data_encerramento_proposta: c.data_encerramento_proposta,
        modalidade_nome: c.modalidade_nome,
        link_sistema: c.link_sistema
    }));
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
 * Verifica se um pncpId já foi notificado para um tenant e para uma pesquisa específica.
 * Usando findFirst pois searchId poderia ser nulo no banco antigo, mas não sob a nova regra.
 */
async function isAlreadyNotified(tenantId: string, searchId: string, pncpId: string): Promise<boolean> {
    const existing = await prisma.opportunityScannerLog.findUnique({
        where: { tenantId_searchId_pncpId: { tenantId, searchId, pncpId } }
    });
    return !!existing;
}

/**
 * Marca um pncpId como notificado para um tenant e salva dados completos do edital.
 * searchId e searchName agora são OBRIGATÓRIOS.
 */
async function markAsNotified(tenantId: string, result: PncpSearchResult, searchId: string, searchName: string): Promise<void> {
    try {
        await prisma.opportunityScannerLog.create({
            data: {
                tenantId,
                pncpId: result.id,
                searchId,
                searchName,
                titulo: result.titulo,
                objeto: result.objeto,
                orgaoNome: result.orgao_nome,
                uf: result.uf,
                municipio: result.municipio,
                valorEstimado: result.valor_estimado || null,
                dataEncerramentoProposta: result.data_encerramento_proposta || null,
                modalidadeNome: result.modalidade_nome || null,
                linkSistema: result.link_sistema || null,
            }
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
            logger.info(`[OpportunityScanner] 🧹 Limpeza automática: ${result.count} registros com >${DEDUP_EXPIRY_DAYS} dias removidos`);
        }
        return result.count;
    } catch (error: any) {
        logger.error(`[OpportunityScanner] ⚠️ Erro na limpeza automática:`, error.message);
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
        logger.error(`[OpportunityScanner] Erro ao salvar resultados do scan:`, error.message);
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
    message += `\n📱 <b>Ver no LicitaSaaS:</b> Aba "Encontradas" na Busca PNCP`;
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
export async function runOpportunityScan(targetTenantId?: string) {
    try {
        // ── Melhoria 5: Limpeza automática de registros antigos ──
        await cleanupOldDedupRecords();
        
        // Buscar pesquisas salvas (opcionalmente filtradas por tenant se manual)
        const whereClause: any = {};
        if (targetTenantId) {
            whereClause.tenantId = targetTenantId;
        }

        const searches = await prisma.pncpSavedSearch.findMany({
            where: whereClause,
            include: {
                tenant: {
                    include: { chatMonitorConfig: true }
                },
                company: true
            }
            // Removed take: MAX_SEARCHES_PER_CYCLE. The job now processes all searches
            // throttled by PNCP_REQUEST_DELAY_MS, preventing starvation of later searches.
        });

        if (searches.length === 0) {
            logger.info(`[OpportunityScanner] ⚠️ Nenhuma pesquisa salva encontrada.`);
            return;
        }

        logger.info(`[OpportunityScanner] 🔍 Iniciando varredura de ${searches.length} pesquisas salvas...`);

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
            let tenantTotalNew = 0;

            for (const search of tenantSearches) {
                const companyName = (search as any).company?.name || (search as any).company?.razaoSocial || '';
                
                try {
                    const results = await executePncpSearch({
                        keywords: search.keywords,
                        status: search.status,
                        states: search.states,
                    });

                    logger.info(`[OpportunityScanner] 📋 "${search.name}": ${results.length} resultados encontrados na API PNCP`);

                    // Filtrar apenas resultados novos (não notificados anteriormente — via DB)
                    const newResults: PncpSearchResult[] = [];
                    for (const r of results) {
                        // Passamos o search.id garantindo que a mesma oportunidade não conflita entre diferentes pesquisas
                        const alreadyNotified = await isAlreadyNotified(tenantId, search.id, r.id);
                        if (!alreadyNotified) {
                            newResults.push(r);
                        }
                    }

                    // Registrar TODOS como notificados no DB (persistente) — com dados completos
                    for (const r of newResults) {
                        await markAsNotified(tenantId, r, search.id, search.name);
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
                        logger.info(`[OpportunityScanner] ✅ "${search.name}": ${newResults.length} novos resultados`);
                        totalNewResults += newResults.length;
                        tenantTotalNew += newResults.length;

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
                            logger.error(`[OpportunityScanner] Erro ao enviar e-mail para tenant ${tenantId}:`, error.message);
                        }

                        logger.info(`[OpportunityScanner] 📤 "${search.name}" → ${newResults.length} oportunidades notificadas`);
                    } else {
                        logger.info(`[OpportunityScanner] ⏩ "${search.name}": 0 novos (já notificados)`);
                    }
                } catch (err: any) {
                    logger.warn(`[OpportunityScanner] ❌ Erro na pesquisa "${search.name}": ${err.message}`);
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
            await sendConsolidatedSummary(tenantId, config, scanResults, tenantTotalNew);
            
            // ── Melhoria 4: Salvar resultados para frontend (badges + último scan) ──
            await saveScanResults(tenantId, scanResults, tenantTotalNew);
        }

        if (totalNewResults > 0) {
            logger.info(`[OpportunityScanner] ✅ Varredura concluída: ${totalNewResults} novas oportunidades encontradas e notificadas globalmente`);
        } else {
            logger.info(`[OpportunityScanner] ✅ Varredura concluída: nenhuma nova oportunidade (todos já notificados)`);
        }

    } catch (error: any) {
        logger.error(`[OpportunityScanner] ❌ Erro fatal:`, error.message);
    }
}

/**
 * Inicializa o scanner com intervalo configurável
 * @param intervalHours - Intervalo em horas entre varreduras (default: 4)
 */
export function startOpportunityScanner(intervalHours: number = 4) {
    const intervalMs = intervalHours * 60 * 60 * 1000;
    
    logger.info(`[OpportunityScanner] 🚀 Scanner de Oportunidades PNCP iniciado (intervalo: ${intervalHours}h)`);

    // Primeira execução: aguardar 2 minutos após boot (dar tempo para o sistema estabilizar)
    setTimeout(() => {
        logger.info(`[OpportunityScanner] Executando primeira varredura...`);
        runOpportunityScan();
    }, 2 * 60 * 1000);

    // Execuções recorrentes
    setInterval(() => {
        runOpportunityScan();
    }, intervalMs);
}
