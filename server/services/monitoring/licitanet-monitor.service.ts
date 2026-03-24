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
 * Fluxo:
 * 1. Detecta se o link é da Licitanet (licitanet.com.br)
 * 2. Extrai o sessionId da URL
 * 3. GET na API REST JSON com tab=general e per_page=50
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
    authorType: 'pregoeiro' | 'sistema';
    timestamp: string;
    captureSource: typeof LICITANET_PLATFORM.captureSource;
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

export class LicitanetMonitor {
    private static readonly TIMEOUT_MS = 20_000;
    private static readonly MAX_PER_PAGE = 50;
    private static readonly USER_AGENT = 'Mozilla/5.0 (compatible; LicitaSaaS/1.0; +https://licitasaas.com)';

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
     * 
     * Formatos suportados:
     *   - https://licitanet.com.br/sessao/175551
     *   - https://licitanet.com.br/dispute-room/175551/...
     *   - https://www.licitanet.com.br/sessao/175551
     */
    static extractSessionId(url: string): string | null {
        if (!url) return null;
        // Formato: /sessao/{id} ou /dispute-room/{id}
        const match = url.match(/(?:sessao|dispute-room)\/(\d+)/);
        return match ? match[1] : null;
    }

    /**
     * Busca mensagens de uma sessão via API REST JSON pública.
     * 
     * Faz GET em: https://licitanet.com.br/dispute-room/{sessionId}/messages
     * com tab=general e per_page=50 para capturar todas as mensagens recentes.
     */
    static async fetchMessages(sessionUrl: string): Promise<LicitanetMessage[]> {
        const sessionId = this.extractSessionId(sessionUrl);
        if (!sessionId) {
            console.warn(`[Licitanet Monitor] Não foi possível extrair sessionId de: ${sessionUrl.substring(0, 60)}...`);
            return [];
        }

        try {
            const apiUrl = `https://${LICITANET_PLATFORM.domain}/dispute-room/${sessionId}/messages?page=1&per_page=${this.MAX_PER_PAGE}&tab=general&sort=newest`;

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
                console.warn(`[Licitanet Monitor] HTTP ${res.status} para sessão ${sessionId}`);
                return [];
            }

            const data: LicitanetApiResponse = await res.json();

            if (!data?.data || data.data.length === 0) {
                return [];
            }

            return this.parseMessages(data.data);
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.warn(`[Licitanet Monitor] Timeout (${this.TIMEOUT_MS}ms) para sessão na URL ${sessionUrl.substring(0, 60)}...`);
            } else {
                console.error(`[Licitanet Monitor] Erro ao buscar mensagens:`, error.message);
            }
            return [];
        }
    }

    /**
     * Parse das mensagens da API JSON para o formato padronizado.
     * 
     * Diferente do BLL/BNC/PCP, a Licitanet já retorna JSON estruturado
     * com autor, conteúdo e timestamp. Não precisa de cheerio/scraping.
     */
    private static parseMessages(apiMessages: LicitanetApiMessage[]): LicitanetMessage[] {
        return apiMessages.map(msg => {
            // Determinar tipo do autor
            const authorLower = (msg.author || '').toLowerCase();
            const authorType: 'pregoeiro' | 'sistema' =
                authorLower.includes('sistema') ? 'sistema' : 'pregoeiro';

            // Gerar messageId único via hash MD5
            // Usa o ID numérico da API como parte do hash para garantir unicidade
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
            };
        }).filter(m => m.content && m.content.length > 0);
    }
}
