import axios from 'axios';
import https from 'https';
import { prisma } from '../../lib/prisma';
import { NotificationService } from '../monitoring/notification.service';

/**
 * PNCP Opportunity Scanner — Monitora automaticamente pesquisas salvas
 * e notifica o tenant quando novos editais correspondentes são publicados.
 * 
 * Arquitetura:
 *   PncpSavedSearch (DB)  →  PNCP API  →  Dedup (alertHistory)  →  NotificationService
 */

// In-memory dedup set (survives restart via DB check)
const notifiedIds = new Set<string>();

// Rate limit: máximo de buscas a cada ciclo para não sobrecarregar PNCP
const MAX_SEARCHES_PER_CYCLE = 20;
const PNCP_REQUEST_DELAY_MS = 1500; // 1.5s entre requisições à API do PNCP

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

/**
 * Executa uma busca PNCP com os mesmos filtros da pesquisa salva
 */
async function executePncpSearch(search: {
    keywords: string | null;
    status: string | null;
    states: string | null;
}): Promise<PncpSearchResult[]> {
    const keywords = search.keywords || '';
    const status = search.status || 'aberta';

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

    // Parse UFs from states (stored as JSON string)
    let ufs: string[] = [];
    if (search.states) {
        try {
            const parsed = JSON.parse(search.states);
            if (Array.isArray(parsed)) ufs = parsed;
            else if (typeof parsed === 'string' && parsed.length > 0) ufs = parsed.split(',');
        } catch {
            if (search.states.includes(',')) ufs = search.states.split(',').map(s => s.trim());
            else if (search.states.length === 2) ufs = [search.states];
        }
    }

    // Build URL (simplified version — only search, no hydration needed for alerts)
    const buildUrl = (qItems: string[], singleUf?: string) => {
        let url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=50&pagina=1`;
        if (qItems.length > 0) url += `&q=${encodeURIComponent(qItems.join(' '))}`;
        if (status && status !== 'todas') url += `&status=${status}`;
        if (singleUf) url += `&ufs=${singleUf}`;
        return url;
    };

    const keywordsToIterate = kwList.length > 0 ? kwList : [null];
    const ufsForIteration = ufs.length > 0 ? ufs : [null as string | null];

    const urlsToFetch: string[] = [];
    for (const kw of keywordsToIterate) {
        for (const singleUf of ufsForIteration) {
            const params: string[] = [];
            if (kw) params.push(kw);
            urlsToFetch.push(buildUrl(params, singleUf || undefined));
        }
    }

    // Limit combinations
    const urls = urlsToFetch.slice(0, 20);
    
    let rawItems: any[] = [];
    for (const url of urls) {
        try {
            const res = await axios.get(url, {
                headers: { 'Accept': 'application/json' },
                httpsAgent: agent,
                timeout: 15000
            } as any);
            const data = res.data as any;
            const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.data) ? data.data : []);
            rawItems = rawItems.concat(items);
        } catch (err: any) {
            console.warn(`[OpportunityScanner] Request failed: ${err.message}`);
        }
        // Rate limit
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
 * Ciclo principal: executa todas as pesquisas salvas com autoMonitor ativo
 */
export async function runOpportunityScan() {
    try {
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

        if (searches.length === 0) return;

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
                // Defaul to true if not explicitly false
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
            const newOpportunities: Array<{ search: typeof searches[0]; result: PncpSearchResult }> = [];

            for (const search of tenantSearches) {
                try {
                    const results = await executePncpSearch({
                        keywords: search.keywords,
                        status: search.status,
                        states: search.states,
                    });

                    // Filtrar apenas resultados novos (não notificados anteriormente)
                    const newResults = results.filter(r => {
                        const dedupKey = `${tenantId}:${r.id}`;
                        if (notifiedIds.has(dedupKey)) return false;
                        return true;
                    });

                    // Limitar a 5 novos resultados por pesquisa para não spammar
                    for (const r of newResults.slice(0, 5)) {
                        const dedupKey = `${tenantId}:${r.id}`;
                        notifiedIds.add(dedupKey);
                        newOpportunities.push({ search, result: r });
                    }

                    if (newResults.length > 0) {
                        console.log(`[OpportunityScanner] ✅ "${search.name}": ${newResults.length} novos resultados (notificando ${Math.min(newResults.length, 5)})`);
                    }
                } catch (err: any) {
                    console.warn(`[OpportunityScanner] ❌ Erro na pesquisa "${search.name}": ${err.message}`);
                }

                // Rate limit between searches
                await new Promise(r => setTimeout(r, 2000));
            }

            // Consolidar e enviar notificações para este tenant
            if (newOpportunities.length > 0 && config) {
                totalNewResults += newOpportunities.length;

                // Agrupar por pesquisa
                const grouped = new Map<string, typeof newOpportunities>();
                for (const opp of newOpportunities) {
                    const key = opp.search.name;
                    if (!grouped.has(key)) grouped.set(key, []);
                    grouped.get(key)!.push(opp);
                }

                // Montar mensagem consolidada
                let message = `🔔 <b>NOVAS OPORTUNIDADES PNCP</b>\n\n`;
                message += `<b>${newOpportunities.length} novo(s) edital(is) encontrado(s)!</b>\n\n`;

                for (const [searchName, opps] of grouped) {
                    message += `📋 <b>Pesquisa:</b> "${searchName}"\n`;
                    for (const opp of opps.slice(0, 3)) { // Max 3 per group in notification
                        const r = opp.result;
                        message += `\n  • <b>${r.titulo}</b>\n`;
                        message += `    📍 ${r.orgao_nome} (${r.uf})\n`;
                        if (r.valor_estimado) message += `    💰 ${formatBRL(r.valor_estimado)}\n`;
                        if (r.data_encerramento_proposta) message += `    📅 Prazo: ${formatDate(r.data_encerramento_proposta)}\n`;
                        message += `    🔗 ${r.link_sistema}\n`;
                    }
                    if (opps.length > 3) {
                        message += `\n  ... e mais ${opps.length - 3} resultado(s)\n`;
                    }
                    message += '\n';
                }

                message += `<i>Acesse o LicitaSaaS para ver todos os detalhes.</i>`;

                // Build HTML message for Email
                const htmlMessage = `
                    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #2563eb;">Novas Oportunidades Encontradas</h2>
                        <p>Olá,</p>
                        <p>A inteligência do LicitaSaaS encontrou <strong>${newOpportunities.length} novo(s) edital(is)</strong> baseado nas suas pesquisas salvas do PNCP.</p>
                        <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
                            ${message.replace(/\n/g, '<br>')}
                        </div>
                        <p>Para ver a análise completa ou favoritar essas oportunidades, acesse o painel do <strong>LicitaSaaS</strong>.</p>
                        <br>
                        <p style="font-size: 12px; color: #9ca3af;">Você está recebendo este e-mail porque o monitoramento automático está ligado na sua conta do LicitaSaaS.</p>
                    </div>
                `;

                // Enviar via canais configurados
                if (config.telegramChatId) {
                    await NotificationService.sendTelegram(tenantId, config.telegramChatId, message);
                }
                if (config.phoneNumber) {
                    const plainMessage = message.replace(/<[^>]*>/g, '');
                    await NotificationService.sendWhatsApp(tenantId, config.phoneNumber, plainMessage);
                }

                // Enviar via E-mail para todos os usuários ativos do Tenant
                try {
                    const activeUsers = await prisma.user.findMany({ where: { tenantId, isActive: true }, select: { email: true } });
                    for (const user of activeUsers) {
                        if (user.email) {
                            await NotificationService.sendEmail(tenantId, user.email, 'LicitaSaaS: Novas Oportunidades do PNCP', htmlMessage);
                        }
                    }
                } catch (error: any) {
                    console.error(`[OpportunityScanner] Erro ao enviar e-mail para tenant ${tenantId}:`, error.message);
                }

                console.log(`[OpportunityScanner] 📤 Tenant ${tenantId}: ${newOpportunities.length} oportunidades notificadas (Telegram/WA/Email)`);
            }
        }

        if (totalNewResults > 0) {
            console.log(`[OpportunityScanner] ✅ Varredura concluída: ${totalNewResults} novas oportunidades encontradas`);
        } else {
            console.log(`[OpportunityScanner] ✅ Varredura concluída: nenhuma nova oportunidade`);
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
