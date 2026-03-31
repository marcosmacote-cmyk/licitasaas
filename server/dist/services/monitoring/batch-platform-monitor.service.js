"use strict";
/**
 * ══════════════════════════════════════════════════════════════════
 * BatchPlatformMonitor — Monitoramento genérico para plataformas Batch
 * ══════════════════════════════════════════════════════════════════
 *
 * BLL Compras e BNC Compras usam o MESMO software (ASP.NET MVC).
 * A API, os endpoints e a estrutura HTML são idênticos.
 *
 * Este serviço unifica o monitoramento para TODAS as plataformas
 * que usam esse padrão. Para adicionar uma nova, basta incluir
 * uma entrada no array BATCH_PLATFORMS.
 *
 * Fluxo de captura:
 *
 * A) Mensagens do PROCESSO (global):
 *    1. GET /BatchList/GetProcessMessageView?param1=[hash]
 *    2. Parse tabela #MsgProcess (2 colunas: Horário, Mensagem)
 *
 * B) Mensagens do LOTE (por lote — NOVO):
 *    1. GET /Process/ProcessView?param1=[hash] → extrai param2 de cada lote
 *    2. GET /BatchList/GetBatchMessageView?param1=[hash]&param2=[loteHash]
 *    3. Parse tabela #MsgBatch (3 colunas: Horário, Autor, Mensagem)
 *
 * As mensagens do lote são onde o pregoeiro faz convocações,
 * negociações, classificação e comunicações críticas.
 */
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
exports.BatchPlatformMonitor = exports.BATCH_PLATFORMS = void 0;
exports.isBLLLink = isBLLLink;
const cheerio = __importStar(require("cheerio"));
const crypto_1 = __importDefault(require("crypto"));
// ── Plataformas reconhecidas ──
exports.BATCH_PLATFORMS = [
    { id: 'bll', domain: 'bllcompras.com', label: 'BLL Compras', captureSource: 'bll-api' },
    { id: 'bnc', domain: 'bnccompras.com', label: 'BNC Compras', captureSource: 'bnc-api' },
];
class BatchPlatformMonitor {
    /**
     * Detecta qual plataforma Batch está presente no link.
     * Retorna null se nenhuma for encontrada.
     */
    static detectPlatform(linkField) {
        if (!linkField)
            return null;
        const lower = linkField.toLowerCase();
        return exports.BATCH_PLATFORMS.find(p => lower.includes(p.domain)) || null;
    }
    /**
     * Verifica se um link contém referência a QUALQUER plataforma Batch.
     */
    static isBatchLink(link) {
        return this.detectPlatform(link) !== null;
    }
    /**
     * Extrai o hash `param1` de uma URL de plataforma Batch.
     *
     * Suporta:
     *   - "https://bllcompras.com/Process/ProcessView?param1=[gkz]eAMK1w..."
     *   - "https://bnccompras.com/Process/ProcessView?param1=[gkz]h7/cdo..."
     *   - String multi-link separada por vírgula (extrai o da plataforma Batch)
     */
    static extractParam1(linkField) {
        if (!linkField)
            return null;
        // Se é multi-link, encontrar o da plataforma Batch
        const parts = linkField.split(',').map(s => s.trim());
        const batchUrl = parts.find(p => exports.BATCH_PLATFORMS.some(bp => p.toLowerCase().includes(bp.domain)));
        if (!batchUrl)
            return null;
        const match = batchUrl.match(/param1=([^&]+)/);
        if (!match)
            return null;
        try {
            return decodeURIComponent(match[1]);
        }
        catch {
            return match[1];
        }
    }
    // ══════════════════════════════════════════════════════════════
    // ── PROCESS-LEVEL MESSAGES (existing) ──
    // ══════════════════════════════════════════════════════════════
    /**
     * Busca mensagens do PROCESSO via API REST pública.
     *
     * Endpoint: GET https://{domain}/BatchList/GetProcessMessageView?param1=[hash]
     * Retorna JSON: { modal: "", html: "<div>...<tbody id='MsgProcess'>...</tbody>...</div>" }
     */
    static async fetchProcessMessages(param1, platform) {
        const url = `https://${platform.domain}/BatchList/GetProcessMessageView?param1=${encodeURIComponent(param1)}`;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (compatible; LicitaSaaS/1.0)',
                },
            });
            clearTimeout(timeoutId);
            if (!res.ok) {
                console.warn(`[${platform.label}] HTTP ${res.status} para GetProcessMessageView param1=${param1.substring(0, 20)}...`);
                return [];
            }
            const data = await res.json();
            const html = data?.html || '';
            if (!html || !html.includes('MsgProcess')) {
                return [];
            }
            return this.parseProcessMessages(html, platform);
        }
        catch (error) {
            if (error.name === 'AbortError') {
                console.warn(`[${platform.label}] Timeout GetProcessMessageView param1=${param1.substring(0, 20)}...`);
            }
            else {
                console.error(`[${platform.label}] Erro GetProcessMessageView:`, error.message);
            }
            return [];
        }
    }
    /**
     * Backward-compatible alias for fetchProcessMessages.
     */
    static async fetchMessages(param1, platform) {
        return this.fetchProcessMessages(param1, platform);
    }
    // ══════════════════════════════════════════════════════════════
    // ── LOT/BATCH-LEVEL MESSAGES (NEW) ──
    // ══════════════════════════════════════════════════════════════
    /**
     * Descobre os hashes param2 de cada lote de um processo.
     *
     * Faz GET na página pública do processo e extrai os links de
     * "Mensagens" de cada lote no HTML do tab "Lotes".
     *
     * Alternativamente, tenta números sequenciais 1..N se o HTML
     * não contiver os hashes.
     */
    static async fetchLotParams(param1, platform) {
        const url = `https://${platform.domain}/Process/ProcessView?param1=${encodeURIComponent(param1)}`;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'Accept': 'text/html,application/xhtml+xml',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
            });
            clearTimeout(timeoutId);
            if (!res.ok) {
                console.warn(`[${platform.label}] HTTP ${res.status} para ProcessView`);
                return [];
            }
            const html = await res.text();
            const $ = cheerio.load(html);
            const lots = [];
            // Strategy 1: Find lot tabs/links with param2 in onclick/href
            // BLL renders lot numbers in a sidebar: <a onclick="LoadBatch('[hash]')">1</a>
            // or via hidden inputs / batch list items
            $('a[onclick*="LoadBatch"], a[onclick*="loadBatch"], a[onclick*="GetBatch"]').each((_, el) => {
                const onclick = $(el).attr('onclick') || '';
                const paramMatch = onclick.match(/['"]([^'"]+)['"]/);
                const text = $(el).text().trim();
                const num = parseInt(text);
                if (paramMatch && paramMatch[1] && !isNaN(num)) {
                    lots.push({ lotNumber: num, param2: paramMatch[1] });
                }
            });
            // Strategy 2: Find lot tabs in sidebar (BLL uses "Lote nº X" with data attribute)
            if (lots.length === 0) {
                $('[data-batchid], [data-batch-id], [data-param2]').each((_, el) => {
                    const param2 = $(el).attr('data-batchid') || $(el).attr('data-batch-id') || $(el).attr('data-param2') || '';
                    const text = $(el).text().trim();
                    const num = parseInt(text);
                    if (param2 && !isNaN(num)) {
                        lots.push({ lotNumber: num, param2 });
                    }
                });
            }
            // Strategy 3: Find the lot list/table and extract batch IDs from links
            if (lots.length === 0) {
                // Look for "Lote n°" pattern in the page with associated param values
                $('table a[href*="param2"], table a[onclick*="param2"]').each((_, el) => {
                    const href = $(el).attr('href') || $(el).attr('onclick') || '';
                    const p2Match = href.match(/param2=([^&'"]+)/);
                    const text = $(el).closest('tr').text().trim();
                    const numMatch = text.match(/(\d+)/);
                    if (p2Match && numMatch) {
                        lots.push({ lotNumber: parseInt(numMatch[1]), param2: p2Match[1] });
                    }
                });
            }
            // Strategy 4: Count lots via lot number elements & use sequential approach
            if (lots.length === 0) {
                // In BLL, the left sidebar shows lot numbers in tabs
                // We count them and will try sequential fetching
                let lotCount = 0;
                $('td, div, span, a').each((_, el) => {
                    const text = $(el).text().trim();
                    if (/^Lote\s*n[°º]?\s*$/i.test(text)) {
                        // Count the sibling/child elements with numbers
                        const siblings = $(el).parent().find('a, span, td');
                        siblings.each((_, s) => {
                            const n = parseInt($(s).text().trim());
                            if (!isNaN(n) && n > lotCount)
                                lotCount = n;
                        });
                    }
                });
                // If we found lot numbers but no param2 hashes, use sequential
                if (lotCount === 0) {
                    // Default: assume at least 1 lot exists
                    lotCount = 1;
                    // Check if there are numbered tab links
                    const tabLinks = $('td a').filter((_, el) => {
                        const t = $(el).text().trim();
                        return /^\d+$/.test(t);
                    });
                    if (tabLinks.length > 0) {
                        lotCount = tabLinks.length;
                    }
                }
                for (let i = 1; i <= lotCount; i++) {
                    lots.push({ lotNumber: i, param2: String(i) });
                }
            }
            return lots;
        }
        catch (error) {
            if (error.name === 'AbortError') {
                console.warn(`[${platform.label}] Timeout ao buscar lotes`);
            }
            else {
                console.error(`[${platform.label}] Erro ao buscar lotes:`, error.message);
            }
            return [];
        }
    }
    /**
     * Busca mensagens de um LOTE específico via API REST.
     *
     * Endpoint: GET https://{domain}/BatchList/GetBatchMessageView?param1=[procHash]&param2=[loteHash]
     * Retorna JSON: { html: "<div>...<tbody id='MsgBatch'>...</tbody>...</div>" }
     *
     * A tabela #MsgBatch tem 3 colunas: Horário, Autor, Mensagem
     */
    static async fetchBatchMessages(param1, param2, lotNumber, platform) {
        const url = `https://${platform.domain}/BatchList/GetBatchMessageView?param1=${encodeURIComponent(param1)}&param2=${encodeURIComponent(param2)}`;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
            });
            clearTimeout(timeoutId);
            if (!res.ok) {
                // 302/404 = lot doesn't exist or requires auth — skip silently
                if (res.status === 302 || res.status === 404)
                    return [];
                console.warn(`[${platform.label}] HTTP ${res.status} para GetBatchMessageView Lote ${lotNumber}`);
                return [];
            }
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('json')) {
                // Probably a redirect to login page
                return [];
            }
            const data = await res.json();
            const html = data?.html || '';
            if (!html)
                return [];
            return this.parseBatchMessages(html, platform, lotNumber);
        }
        catch (error) {
            if (error.name === 'AbortError') {
                console.warn(`[${platform.label}] Timeout GetBatchMessageView Lote ${lotNumber}`);
            }
            else {
                // Don't spam logs — lot endpoints may legitimately fail for public access
                if (!error.message?.includes('Unexpected token')) {
                    console.warn(`[${platform.label}] Erro GetBatchMessageView Lote ${lotNumber}:`, error.message);
                }
            }
            return [];
        }
    }
    /**
     * Busca TODAS as mensagens (processo + todos os lotes) de um processo.
     *
     * Fluxo:
     * 1. Busca mensagens do processo (GetProcessMessageView)
     * 2. Descobre lotes do processo (ProcessView HTML)
     * 3. Para cada lote: busca mensagens (GetBatchMessageView)
     * 4. Retorna tudo unificado
     */
    static async fetchAllMessages(param1, platform) {
        const allMessages = [];
        // 1. Process-level messages (existing behavior)
        const processMessages = await this.fetchProcessMessages(param1, platform);
        allMessages.push(...processMessages);
        // 2. Discover lots
        const lots = await this.fetchLotParams(param1, platform);
        if (lots.length > 0) {
            // 3. Fetch lot-level messages for each lot
            for (const lot of lots) {
                const batchMessages = await this.fetchBatchMessages(param1, lot.param2, lot.lotNumber, platform);
                allMessages.push(...batchMessages);
                // Gentil com o servidor: 500ms entre lotes
                if (lots.length > 1) {
                    await new Promise(r => setTimeout(r, 500));
                }
            }
            if (lots.length > 0) {
                const totalBatch = allMessages.filter(m => m.itemRef).length;
                if (totalBatch > 0) {
                    console.log(`[${platform.label}] 📋 ${lots.length} lote(s) verificados, ${totalBatch} msg(s) de lote encontradas`);
                }
            }
        }
        return allMessages;
    }
    // ══════════════════════════════════════════════════════════════
    // ── PARSERS ──
    // ══════════════════════════════════════════════════════════════
    /**
     * Parse do HTML retornado pela GetProcessMessageView.
     * Extrai mensagens da tabela #MsgProcess (2 colunas: Horário, Mensagem).
     */
    static parseProcessMessages(html, platform) {
        const $ = cheerio.load(html);
        const messages = [];
        $('#MsgProcess tr').each((_, row) => {
            const cells = $(row).find('td');
            if (cells.length < 2)
                return;
            const timestamp = $(cells[0]).text().trim();
            const content = $(cells[1]).text().trim();
            if (!content || content.length === 0)
                return;
            const messageId = crypto_1.default
                .createHash('md5')
                .update(`${platform.id}|proc|${timestamp}|${content}`)
                .digest('hex')
                .substring(0, 16);
            const isSystem = content.startsWith('O ') && (content.includes('lance') ||
                content.includes('encerrad') ||
                content.includes('suspens') ||
                content.includes('aberto') ||
                content.includes('classificad'));
            messages.push({
                messageId,
                content,
                authorType: isSystem ? 'sistema' : 'pregoeiro',
                timestamp,
                captureSource: platform.captureSource,
                itemRef: null, // process-level
            });
        });
        return messages;
    }
    /**
     * Parse do HTML retornado pela GetBatchMessageView.
     * Extrai mensagens da tabela #MsgBatch (3 colunas: Horário, Autor, Mensagem).
     *
     * Diferente de #MsgProcess, #MsgBatch tem uma coluna extra de "Autor",
     * o que é crucial para identificar quem está falando (pregoeiro vs participante).
     */
    static parseBatchMessages(html, platform, lotNumber) {
        const $ = cheerio.load(html);
        const messages = [];
        $('#MsgBatch tr').each((_, row) => {
            const cells = $(row).find('td');
            if (cells.length < 3)
                return;
            const timestamp = $(cells[0]).text().trim();
            const author = $(cells[1]).text().trim();
            const content = $(cells[2]).text().trim();
            if (!content || content.length === 0)
                return;
            const messageId = crypto_1.default
                .createHash('md5')
                .update(`${platform.id}|lote${lotNumber}|${timestamp}|${author}|${content}`)
                .digest('hex')
                .substring(0, 16);
            // Detect author type from the author column
            const authorLower = author.toLowerCase();
            const isSystem = authorLower.includes('sistema') ||
                (authorLower === '' && content.startsWith('O '));
            const isPregoeiro = authorLower.includes('pregoeiro') ||
                authorLower.includes('agente de cont') ||
                authorLower.includes('autoridade');
            const authorType = isSystem ? 'sistema' : 'pregoeiro';
            messages.push({
                messageId,
                content: author ? `[${author}] ${content}` : content,
                authorType,
                timestamp,
                captureSource: platform.captureSource,
                itemRef: `Lote ${lotNumber}`,
            });
        });
        // Also check if this endpoint returns process messages (#MsgProcess)
        // and extract them too (some endpoints return both)
        // We skip this to avoid duplicates — process messages are already fetched separately
        return messages;
    }
}
exports.BatchPlatformMonitor = BatchPlatformMonitor;
BatchPlatformMonitor.TIMEOUT_MS = 15000;
// ── Backward compatibility: manter isBLLLink exportado ──
function isBLLLink(link) {
    return link.includes('bllcompras') || link.includes('bll.org');
}
