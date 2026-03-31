/**
 * ══════════════════════════════════════════════════════════════════
 * Licitanet Monitor — licitanet.com.br
 * ══════════════════════════════════════════════════════════════════
 * 
 * A Licitanet fornece uma API REST JSON pública e paginada para
 * mensagens de sessões de pregão. Não requer autenticação.
 * 
 * Endpoint:
 *   GET https://licitanet.com.br/dispute-room/{sessionId}/messages
 *   Query params: page, per_page (max 50), tab (general|lots), sort (newest)
 * 
 * Requer User-Agent de browser (WAF da AWS bloqueia curl padrão).
 * 
 * URL pública da sessão: https://licitanet.com.br/sessao/{sessionId}
 * API interna:            https://licitanet.com.br/dispute-room/{sessionId}/messages
 * 
 * Estrutura da resposta JSON:
 * {
 *   "data": [
 *     {
 *       "id": 72141967,
 *       "author": "Pregoeiro(a)",
 *       "message": "Texto da mensagem...",
 *       "createdAt": "2026-03-24T15:57:39-03:00",
 *       "type": "general",
 *       "batch": 1,
 *       "batchCaption": "LOTE-01"
 *     }
 *   ],
 *   "meta": { "total": 29, "currentPage": 1, "perPage": 50, "totalPages": 1 }
 * }
 * 
 * v1.1 changelog:
 *   - eventCategory classification via regex (9 categories)
 *   - authorType: added 'fornecedor' detection
 *   - Browser-like User-Agent (anti-blocking)
 *   - Multi-page pagination support (up to 5 pages per tab)
 * 
 * Fluxo:
 * 1. Detecta se o link é da Licitanet (licitanet.com.br)
 * 2. Extrai o sessionId da URL
 * 3. GET na API REST JSON com tab=general e tab=lots (paralelo)
 * 4. Parse direto do JSON (sem cheerio/HTML)
 * 5. Retorna mensagens padronizadas para o pipeline de ingestão
 * 
 * Acesso: Público, sem autenticação (requer User-Agent de browser).
 */

import crypto from 'crypto';

export const LICITANET_PLATFORM = {
    id: 'licitanet' as const,
    domain: 'licitanet.com.br',
    label: 'Licitanet',
    captureSource: 'licitanet-api' as const,
};

export interface LicitanetMessage {
    messageId: string;
    content: string;
    authorType: 'pregoeiro' | 'fornecedor' | 'sistema';
    timestamp: string;
    captureSource: typeof LICITANET_PLATFORM.captureSource;
    itemRef: string | null;
    eventCategory: string | null;
}

interface LicitanetApiMessage {
    id: number;
    author: string;
    message: string;
    createdAt: string;
    type: string;
    batch: number;
    batchCaption: string;
}

interface LicitanetApiResponse {
    data: LicitanetApiMessage[];
    meta: {
        total: number;
        currentPage: number;
        perPage: number;
        totalPages: number;
    };
}

// ── Event category classification via regex (aligned with alertTaxonomy.ts) ──
function classifyEventCategory(text: string): string | null {
    if (!text) return null;
    const t = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    if (/\b(encerrad[oa]|homologad[oa]|cancelad[oa]|anulad[oa]|revogad[oa]|desert[oa]|fracassad[oa]|finalizada)\b/.test(t)) return 'encerramento';
    if (/\b(convoca|habilitacao|documentos?\s+de\s+habilitacao|prazo\s+para\s+(?:envio|apresentacao))\b/.test(t)) return 'convocacao';
    if (/\b(suspend?[oae]|suspen[cs]ao|interromp)\b/.test(t)) return 'suspensao';
    if (/\b(reabert[oa]|reabrir|retom[ao]d[oa]|retomada)\b/.test(t)) return 'reabertura';
    if (/\b(negociacao|contraproposta|negocia[rc]|lance|melhor\s+oferta)\b/.test(t)) return 'negociacao';
    if (/\b(vencedor|adjudica|arrematante|melhor\s+classificad[oa])\b/.test(t)) return 'vencedor';
    if (/\b(impugnacao|recurso|contrarrazao|contrarraz[oo]es|intencao\s+de\s+recurso)\b/.test(t)) return 'impugnacao';
    if (/\b(inabilit|desclassific)\b/.test(t)) return 'inabilitacao';
    if (/\b(abert[oa]\s+para|processo\s+.*\s+aberto|sessao\s+.*\s+aberta|fase\s+de\s+lances?)\b/.test(t)) return 'abertura';

    return null;
}

export class LicitanetMonitor {
    private static readonly TIMEOUT_MS = 20_000;
    private static readonly MAX_PER_PAGE = 50;
    private static readonly MAX_PAGES = 5;
    private static readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

    /**
     * Verifica se um link é da Licitanet.
     */
    static isLicitanetLink(link: string): boolean {
        if (!link) return false;
        return link.toLowerCase().includes(LICITANET_PLATFORM.domain);
    }

    /**
     * Detecta se o link pertence à Licitanet.
     * Retorna o platform object ou null.
     */
    static detectPlatform(link: string): typeof LICITANET_PLATFORM | null {
        if (!link) return null;
        if (link.toLowerCase().includes(LICITANET_PLATFORM.domain)) return LICITANET_PLATFORM;
        return null;
    }

    /**
     * Extrai a URL da Licitanet de um campo de link (pode ser multi-link).
     */
    static extractLicitanetUrl(linkField: string): string | null {
        if (!linkField) return null;
        const parts = linkField.split(',').map(s => s.trim());
        return parts.find(p => p.toLowerCase().includes(LICITANET_PLATFORM.domain)) || null;
    }

    /**
     * Extrai o sessionId de uma URL da Licitanet.
     */
    static extractSessionId(url: string): string | null {
        if (!url) return null;
        const match = url.match(/(?:sessao|dispute-room)\/(\d+)/);
        return match ? match[1] : null;
    }

    /**
     * Helper to fetch a specific tab ('general' or 'lots') with pagination.
     */
    private static async fetchTab(sessionId: string, tab: 'general' | 'lots', sessionUrl: string): Promise<LicitanetApiMessage[]> {
        const allMessages: LicitanetApiMessage[] = [];
        let page = 1;

        while (page <= this.MAX_PAGES) {
            const apiUrl = `https://${LICITANET_PLATFORM.domain}/dispute-room/${sessionId}/messages?page=${page}&per_page=${this.MAX_PER_PAGE}&tab=${tab}&sort=newest`;

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

                const res = await fetch(apiUrl, {
                    signal: controller.signal,
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'User-Agent': this.USER_AGENT,
                        'X-Requested-With': 'XMLHttpRequest',
                        'Referer': `https://${LICITANET_PLATFORM.domain}/sessao/${sessionId}`,
                    },
                });

                clearTimeout(timeoutId);

                if (!res.ok) {
                    console.warn(`[Licitanet Monitor] HTTP ${res.status} para sessão ${sessionId} (tab=${tab}, page=${page})`);
                    break;
                }

                const data: LicitanetApiResponse = await res.json();
                const messages = data?.data || [];
                if (messages.length === 0) break;

                allMessages.push(...messages);

                // Check if there are more pages
                const totalPages = data?.meta?.totalPages || 1;
                if (page >= totalPages) break;

                page++;
            } catch (error: any) {
                if (error.name === 'AbortError') {
                    console.warn(`[Licitanet Monitor] Timeout (${this.TIMEOUT_MS}ms) tab=${tab} para sessão ${sessionId}`);
                } else {
                    console.error(`[Licitanet Monitor] Erro ao buscar tab=${tab}:`, error.message);
                }
                break;
            }
        }

        return allMessages;
    }

    /**
     * Busca mensagens de uma sessão via API REST JSON pública.
     * 
     * Busca tanto tab=general quanto tab=lots para não perder mensagens de negociação.
     * Suporta paginação multi-page (até MAX_PAGES por tab).
     */
    static async fetchMessages(sessionUrl: string): Promise<LicitanetMessage[]> {
        const sessionId = this.extractSessionId(sessionUrl);
        if (!sessionId) {
            console.warn(`[Licitanet Monitor] Não foi possível extrair sessionId de: ${sessionUrl.substring(0, 60)}...`);
            return [];
        }

        const [generalMessages, lotMessages] = await Promise.all([
            this.fetchTab(sessionId, 'general', sessionUrl),
            this.fetchTab(sessionId, 'lots', sessionUrl)
        ]);

        const allApiMessages = [...generalMessages, ...lotMessages];
        
        // Remove duplicates if any (though usually general != lots)
        const uniqueMessages = Array.from(new Map(allApiMessages.map(item => [item.id, item])).values());

        if (uniqueMessages.length === 0) return [];

        return this.parseMessages(uniqueMessages);
    }

    /**
     * Parse das mensagens da API JSON para o formato padronizado.
     * v1.1: includes eventCategory, fornecedor authorType.
     */
    private static parseMessages(apiMessages: LicitanetApiMessage[]): LicitanetMessage[] {
        return apiMessages.map(msg => {
            // Determine author type (sistema, pregoeiro, fornecedor)
            const authorLower = (msg.author || '').toLowerCase();
            let authorType: 'pregoeiro' | 'fornecedor' | 'sistema';
            if (authorLower.includes('sistema')) {
                authorType = 'sistema';
            } else if (authorLower.includes('fornecedor') || authorLower.includes('licitante') || authorLower.includes('empresa')) {
                authorType = 'fornecedor';
            } else {
                authorType = 'pregoeiro';
            }

            // Classify event category via regex
            const eventCategory = classifyEventCategory(msg.message);

            // Gerar messageId único via hash MD5
            const messageId = crypto
                .createHash('md5')
                .update(`licitanet|${msg.id}|${msg.createdAt}|${msg.message}`)
                .digest('hex')
                .substring(0, 16);

            return {
                messageId,
                content: msg.message,
                authorType,
                timestamp: msg.createdAt,
                captureSource: LICITANET_PLATFORM.captureSource,
                itemRef: msg.batchCaption || null,
                eventCategory,
            };
        }).filter(m => m.content && m.content.length > 0);
    }
}
