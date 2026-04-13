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
const logger_1 = require("../../lib/logger");
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
                logger_1.logger.warn(`[${platform.label}] HTTP ${res.status} para GetProcessMessageView param1=${param1.substring(0, 20)}...`);
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
                logger_1.logger.warn(`[${platform.label}] Timeout GetProcessMessageView param1=${param1.substring(0, 20)}...`);
            }
            else {
                logger_1.logger.error(`[${platform.label}] Erro GetProcessMessageView:`, error.message);
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
     * Descobre os lotes de um processo via AJAX (como o browser faz).
     *
     * Fluxo real da BLL/BNC:
     * 1. GET ProcessView → botão "Lotes" com onclick="GetBatchesInfo('[innerParam]')"
     * 2. POST /Process/ProcessBatches?param1=[innerParam]&token= → HTML modal com tabela #batchListRows
     * 3. Cada <tr> tem onclick="GetBatchItemsInfo('[batchParam1]', this, '[batchParam2]')"
     * 4. GetBatchMessageView?param1=[batchParam1]&param2=[batchParam2] → mensagens do lote
     *
     * IMPORTANTE: o param1 da URL do processo NÃO é o mesmo usado nas chamadas de lote.
     *             Cada lote tem seus próprios batchParam1 e batchParam2 (hashes [gkz]).
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
                logger_1.logger.warn(`[${platform.label}] HTTP ${res.status} para ProcessView`);
                return [];
            }
            const html = await res.text();
            const $ = cheerio.load(html);
            // ── Step 1: Extract inner process hash from "Lotes" button ──
            const batchBtn = $('button[onclick*="GetBatchesInfo"]');
            if (!batchBtn.length) {
                // No "Lotes" button = single-lot process, skip lot discovery
                return [];
            }
            const batchOnclick = batchBtn.attr('onclick') || '';
            const innerMatch = batchOnclick.match(/GetBatchesInfo\s*\(\s*'([^']+)'\s*\)/);
            if (!innerMatch) {
                logger_1.logger.warn(`[${platform.label}] GetBatchesInfo button found but could not extract param`);
                return [];
            }
            const innerParam = innerMatch[1];
            // ── Step 2: POST to ProcessBatches AJAX endpoint ──
            const batchUrl = `https://${platform.domain}/Process/ProcessBatches?param1=${encodeURIComponent(innerParam)}&token=`;
            const controller2 = new AbortController();
            const timeoutId2 = setTimeout(() => controller2.abort(), this.TIMEOUT_MS);
            const batchRes = await fetch(batchUrl, {
                method: 'POST',
                signal: controller2.signal,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
            });
            clearTimeout(timeoutId2);
            if (!batchRes.ok) {
                logger_1.logger.warn(`[${platform.label}] HTTP ${batchRes.status} para ProcessBatches`);
                return [];
            }
            const batchData = await batchRes.json();
            const modalHtml = batchData?.modal || batchData?.html || '';
            if (!modalHtml) {
                return [];
            }
            const $modal = cheerio.load(modalHtml);
            const lots = [];
            // ── Step 3: Parse lot rows from #batchListRows table ──
            // Each <tr> has onclick="GetBatchItemsInfo('[batchParam1]', this, '[batchParam2]')"
            $modal('#batchListRows tr[onclick*="GetBatchItemsInfo"]').each((_, el) => {
                const onclick = $modal(el).attr('onclick') || '';
                // Pattern: GetBatchItemsInfo('hash1', this, 'hash2')
                const m = onclick.match(/GetBatchItemsInfo\s*\(\s*'([^']+)'\s*,\s*this\s*,\s*'([^']+)'\s*\)/);
                if (!m)
                    return;
                const batchParam1 = m[1];
                const batchParam2 = m[2];
                // Extract lot number from the first <td> text content
                const firstTd = $modal(el).find('td').first().text().trim();
                const lotNum = parseInt(firstTd);
                const lotNumber = !isNaN(lotNum) ? lotNum : lots.length + 1;
                lots.push({ lotNumber, param2: batchParam2, batchParam1 });
            });
            if (lots.length > 0) {
                logger_1.logger.info(`[${platform.label}] 🔍 Descobertos ${lots.length} lote(s) via ProcessBatches AJAX`);
            }
            else {
                // Fallback: Try to find lot info directly in ProcessView HTML
                // (some older versions may render lots inline)
                $('a[onclick*="LoadBatch"], a[onclick*="loadBatch"]').each((_, el) => {
                    const onclick = $(el).attr('onclick') || '';
                    const paramMatch = onclick.match(/['"]([^'"]+)['"]/);
                    const text = $(el).text().trim();
                    const num = parseInt(text);
                    if (paramMatch && paramMatch[1] && !isNaN(num)) {
                        lots.push({ lotNumber: num, param2: paramMatch[1], batchParam1: param1 });
                    }
                });
            }
            return lots;
        }
        catch (error) {
            if (error.name === 'AbortError') {
                logger_1.logger.warn(`[${platform.label}] Timeout ao buscar lotes`);
            }
            else {
                logger_1.logger.error(`[${platform.label}] Erro ao buscar lotes:`, error.message);
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
                logger_1.logger.warn(`[${platform.label}] HTTP ${res.status} para GetBatchMessageView Lote ${lotNumber}`);
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
                logger_1.logger.warn(`[${platform.label}] Timeout GetBatchMessageView Lote ${lotNumber}`);
            }
            else {
                // Don't spam logs — lot endpoints may legitimately fail for public access
                if (!error.message?.includes('Unexpected token')) {
                    logger_1.logger.warn(`[${platform.label}] Erro GetBatchMessageView Lote ${lotNumber}:`, error.message);
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
     * 2. Descobre lotes via AJAX (ProcessBatches)
     * 3. Para cada lote: busca mensagens (GetBatchMessageView) com batchParam1+param2
     * 4. Retorna tudo unificado
     */
    static async fetchAllMessages(param1, platform) {
        const allMessages = [];
        // 1. Process-level messages (existing behavior)
        const processMessages = await this.fetchProcessMessages(param1, platform);
        allMessages.push(...processMessages);
        // 2. Discover lots (now returns batchParam1 per lot)
        const lots = await this.fetchLotParams(param1, platform);
        if (lots.length > 0) {
            // 3. Fetch lot-level messages for each lot
            // IMPORTANT: use lot.batchParam1 (NOT the process param1) for GetBatchMessageView
            for (const lot of lots) {
                const batchMessages = await this.fetchBatchMessages(lot.batchParam1, lot.param2, lot.lotNumber, platform);
                allMessages.push(...batchMessages);
                // Gentil com o servidor: 500ms entre lotes
                if (lots.length > 1) {
                    await new Promise(r => setTimeout(r, 500));
                }
            }
            const totalBatch = allMessages.filter(m => m.itemRef).length;
            if (totalBatch > 0) {
                logger_1.logger.info(`[${platform.label}] 📋 ${lots.length} lote(s) verificados, ${totalBatch} msg(s) de lote encontradas`);
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
