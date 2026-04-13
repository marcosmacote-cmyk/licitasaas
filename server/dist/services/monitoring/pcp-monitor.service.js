"use strict";
/**
 * ══════════════════════════════════════════════════════════════════
 * PCP Monitor — Portal de Compras Públicas
 * ══════════════════════════════════════════════════════════════════
 *
 * O Portal de Compras Públicas (portaldecompraspublicas.com.br)
 * renderiza as mensagens via SSR (Angular) diretamente no HTML.
 *
 * A seção "Andamento do processo" usa a classe `.timeline-item`,
 * com sub-elementos `.time` e `.description`.
 *
 * Estrutura HTML:
 * ```html
 * <app-assistance>
 *   <div class="timeline-item">
 *     <div class="time"> 31/03/2026 14:33:34 | Sistema </div>
 *     <div class="description">O lote 0002 foi adjudicado por FLAVIO LUIZ BENINI.</div>
 *   </div>
 * </app-assistance>
 * ```
 *
 * v1.1 changelog:
 *   - eventCategory classification via regex (9 categories)
 *   - itemRef extraction from content ("lote XXXX" → "Lote XXXX")
 *   - Timestamp conversion to ISO 8601 (DD/MM/YYYY HH:MM:SS → ISO)
 *   - Browser-like User-Agent (anti-blocking)
 *
 * Fluxo:
 * 1. Detecta se o link é do Portal de Compras Públicas
 * 2. Faz GET na URL pública do processo (SSR)
 * 3. Parse do HTML com Cheerio (`.timeline-item`)
 * 4. Extrai timestamp, autor, conteúdo, eventCategory e itemRef
 * 5. Retorna mensagens padronizadas para o pipeline de ingestão
 *
 * Acesso: Público, sem autenticação.
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
exports.PCPMonitor = exports.PCP_PLATFORM = void 0;
const cheerio = __importStar(require("cheerio"));
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("../../lib/logger");
exports.PCP_PLATFORM = {
    id: 'pcp',
    domain: 'portaldecompraspublicas.com.br',
    label: 'Portal de Compras Públicas',
    captureSource: 'pcp-api',
};
// ── Event category classification via regex (aligned with alertTaxonomy.ts) ──
function classifyEventCategory(text) {
    if (!text)
        return null;
    const t = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    // Closure / Encerramento
    if (/\b(encerrad[oa]|homologad[oa]|cancelad[oa]|anulad[oa]|revogad[oa]|desert[oa]|fracassad[oa]|finalizada)\b/.test(t))
        return 'encerramento';
    // Convocação
    if (/\b(convoca|habilitacao|documentos?\s+de\s+habilitacao|prazo\s+para\s+(?:envio|apresentacao))\b/.test(t))
        return 'convocacao';
    // Suspensão
    if (/\b(suspend?[oae]|suspen[cs]ao|interromp)\b/.test(t))
        return 'suspensao';
    // Reabertura
    if (/\b(reabert[oa]|reabrir|retom[ao]d[oa]|retomada)\b/.test(t))
        return 'reabertura';
    // Negociação
    if (/\b(negociacao|contraproposta|negocia[rc]|lance|melhor\s+oferta)\b/.test(t))
        return 'negociacao';
    // Vencedor / Adjudicação
    if (/\b(vencedor|adjudica|arrematante|melhor\s+classificad[oa])\b/.test(t))
        return 'vencedor';
    // Impugnação / Recurso
    if (/\b(impugnacao|recurso|contrarrazao|contrarraz[oo]es|intencao\s+de\s+recurso)\b/.test(t))
        return 'impugnacao';
    // Inabilitação
    if (/\b(inabilit|desclassific)\b/.test(t))
        return 'inabilitacao';
    // Abertura / Início
    if (/\b(abert[oa]\s+para|processo\s+.*\s+aberto|sessao\s+.*\s+aberta|lances?\s+abertos?|fase\s+de\s+lances?)\b/.test(t))
        return 'abertura';
    return null;
}
// ── Extract itemRef (lot number) from message content ──
function extractItemRef(text) {
    if (!text)
        return null;
    // Match: "lote 0001", "lote 01", "lote 1", "LOTE 0002"
    const match = text.match(/\blote\s+([\d]+)\b/i);
    if (match) {
        const num = match[1].replace(/^0+/, '') || '0'; // Remove leading zeros
        return `Lote ${num.padStart(2, '0')}`;
    }
    return null;
}
// ── Convert "DD/MM/YYYY HH:MM:SS" to ISO 8601 ──
function convertToISO(brTimestamp) {
    if (!brTimestamp)
        return brTimestamp;
    // Match: "31/03/2026 14:33:34"
    const match = brTimestamp.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!match)
        return brTimestamp; // Fallback: return as-is
    const [, day, month, year, hour, min, sec] = match;
    // BRT is UTC-3
    return `${year}-${month}-${day}T${hour}:${min}:${sec}-03:00`;
}
class PCPMonitor {
    /**
     * Verifica se um link é do Portal de Compras Públicas.
     */
    static isPCPLink(link) {
        if (!link)
            return false;
        return link.toLowerCase().includes(exports.PCP_PLATFORM.domain);
    }
    /**
     * Detecta se o link pertence ao Portal de Compras Públicas.
     * Retorna o platform object ou null.
     */
    static detectPlatform(link) {
        if (!link)
            return null;
        const lower = link.toLowerCase();
        if (lower.includes(exports.PCP_PLATFORM.domain))
            return exports.PCP_PLATFORM;
        return null;
    }
    /**
     * Extrai a URL do PCP de um campo de link (pode ser multi-link).
     */
    static extractPCPUrl(linkField) {
        if (!linkField)
            return null;
        const parts = linkField.split(',').map(s => s.trim());
        const pcpUrl = parts.find(p => p.toLowerCase().includes(exports.PCP_PLATFORM.domain));
        return pcpUrl || null;
    }
    /**
     * Busca mensagens de um processo via scraping do HTML SSR.
     *
     * O PCP renderiza tudo no HTML inicial (Angular SSR).
     * Basta fazer um GET na URL do processo e parsear `.timeline-item`.
     */
    static async fetchMessages(processUrl) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);
            const res = await fetch(processUrl, {
                signal: controller.signal,
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'User-Agent': this.USER_AGENT,
                    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                },
            });
            clearTimeout(timeoutId);
            if (!res.ok) {
                logger_1.logger.warn(`[PCP Monitor] HTTP ${res.status} para ${processUrl.substring(0, 60)}...`);
                return [];
            }
            const html = await res.text();
            if (!html.includes('timeline-item')) {
                logger_1.logger.warn(`[PCP Monitor] Nenhuma timeline encontrada em ${processUrl.substring(0, 60)}...`);
                return [];
            }
            return this.parseMessages(html);
        }
        catch (error) {
            if (error.name === 'AbortError') {
                logger_1.logger.warn(`[PCP Monitor] Timeout (${this.TIMEOUT_MS}ms) para ${processUrl.substring(0, 60)}...`);
            }
            else {
                logger_1.logger.error(`[PCP Monitor] Erro ao buscar mensagens:`, error.message);
            }
            return [];
        }
    }
    /**
     * Parse do HTML SSR para extrair mensagens da timeline.
     *
     * Cada mensagem tem a estrutura:
     * <div class="timeline-item">
     *   <div class="time"> DD/MM/YYYY HH:MM:SS | Autor </div>
     *   <div class="description">Conteúdo</div>
     * </div>
     *
     * v1.1: Includes eventCategory, itemRef, ISO timestamp, fornecedor detection.
     */
    static parseMessages(html) {
        const $ = cheerio.load(html);
        const messages = [];
        // Use 'app-assistance .timeline-item' to only capture chat messages
        // (the page also has a status timeline with the same class)
        $('app-assistance .timeline-item').each((_, item) => {
            const timeText = $(item).find('.time').text().trim();
            const description = $(item).find('.description').text().trim();
            if (!description || description.length === 0)
                return;
            // Parse do formato: "DD/MM/YYYY HH:MM:SS | Autor"
            const { timestamp: rawTimestamp, author } = this.parseTimeField(timeText);
            if (!rawTimestamp)
                return;
            // Convert timestamp to ISO 8601
            const timestamp = convertToISO(rawTimestamp);
            // Determine author type (sistema, pregoeiro, fornecedor)
            const authorLower = author.toLowerCase();
            let authorType;
            if (authorLower.includes('sistema')) {
                authorType = 'sistema';
            }
            else if (authorLower.includes('fornecedor') || authorLower.includes('licitante')) {
                authorType = 'fornecedor';
            }
            else {
                authorType = 'pregoeiro';
            }
            // Classify event category via regex
            const eventCategory = classifyEventCategory(description);
            // Extract item/lot reference from content
            const itemRef = extractItemRef(description);
            // Gerar messageId único via hash MD5
            // Uses rawTimestamp + description for stability (ISO conversion doesn't affect hash)
            const messageId = crypto_1.default
                .createHash('md5')
                .update(`pcp|${rawTimestamp}|${description}`)
                .digest('hex')
                .substring(0, 16);
            messages.push({
                messageId,
                content: description,
                authorType,
                timestamp,
                captureSource: exports.PCP_PLATFORM.captureSource,
                itemRef,
                eventCategory,
            });
        });
        return messages;
    }
    /**
     * Parse do campo "time" no formato "DD/MM/YYYY HH:MM:SS | Autor".
     * Retorna o timestamp original e o nome do autor.
     */
    static parseTimeField(timeText) {
        if (!timeText)
            return { timestamp: '', author: '' };
        // Formato: "DD/MM/YYYY HH:MM:SS | Autor"
        const pipeIndex = timeText.indexOf('|');
        if (pipeIndex === -1) {
            return { timestamp: timeText.trim(), author: 'Sistema' };
        }
        const timestamp = timeText.substring(0, pipeIndex).trim();
        const author = timeText.substring(pipeIndex + 1).trim();
        return { timestamp, author };
    }
}
exports.PCPMonitor = PCPMonitor;
PCPMonitor.TIMEOUT_MS = 20000;
PCPMonitor.USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
