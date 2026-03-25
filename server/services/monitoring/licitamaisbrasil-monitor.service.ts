/**
 * ══════════════════════════════════════════════════════════════════
 * Licita Mais Brasil Monitor — licitamaisbrasil.com.br
 * ══════════════════════════════════════════════════════════════════
 * 
 * A plataforma Licita Mais Brasil usa uma API REST JSON com autenticação
 * via Bearer Token. O token é obtido via login (email + senha) e tem
 * validade de ~24h (campo expirationDateSession).
 * 
 * Fluxo de captura de mensagens:
 * 
 * 1. Login: POST /auth/login → retorna { token, expirationDateSession }
 * 2. Listar batches do auction: POST /app/batch/list → { auctionBatches[].id }
 * 3. Ler batch: POST /app/batch/read → { chatChannel.id }
 * 4. Buscar mensagens: POST /chat/getMessages → [ { id, text, createdDate, isSystemMessage } ]
 * 
 * API Base: https://api.licitamaisbrasil.com.br
 * 
 * Estrutura da resposta de chat (/chat/getMessages):
 * [
 *   {
 *     "id": "nLVUn9Gc8D0hzXdT",
 *     "createdDate": "2026-02-24T20:00:04.244Z",
 *     "isSystemMessage": 1,
 *     "text": "O processo está aberto para o envio das propostas iniciais.",
 *     "mediaFiles": [],
 *     "metadata": null,
 *     "isDeleted": 0,
 *     "chatChannel": { "id": "kaQ6tV0yF44hgs7t" }
 *   }
 * ]
 * 
 * URL pública do edital: https://licitamaisbrasil.com.br/detalhes-do-edital/{auctionId}
 * URL da sala:           https://licitamaisbrasil.com.br/sala-de-negociacao/{auctionId}
 * 
 * Acesso: Requer autenticação (email/senha de cidadão).
 */

import crypto from 'crypto';

export const LICITA_MAIS_BRASIL_PLATFORM = {
    id: 'licitamaisbrasil' as const,
    domain: 'licitamaisbrasil.com.br',
    apiDomain: 'api.licitamaisbrasil.com.br',
    label: 'Licita Mais Brasil',
    captureSource: 'licitamaisbrasil-api' as const,
};

export interface LicitaMaisBrasilMessage {
    messageId: string;
    content: string;
    authorType: 'pregoeiro' | 'sistema';
    timestamp: string;
    captureSource: typeof LICITA_MAIS_BRASIL_PLATFORM.captureSource;
}

interface LMBApiMessage {
    id: string;
    createdDate: string;
    updatedDate: string;
    isSystemMessage: number; // 1 = system, 0 = user
    text: string;
    mediaFiles: any[];
    metadata: any;
    isDeleted: number;
    chatChannel: { id: string };
}

interface LMBBatch {
    id: string;
    chatChannel?: { id: string };
}

interface LMBAuthResponse {
    token: string;
    expirationDateSession: string;
    user: {
        id: string;
        name: string;
        email: string;
    };
    status: string;
}

export class LicitaMaisBrasilMonitor {
    private static readonly TIMEOUT_MS = 20_000;
    private static readonly API_BASE = `https://${LICITA_MAIS_BRASIL_PLATFORM.apiDomain}`;
    private static readonly USER_AGENT = 'Mozilla/5.0 (compatible; LicitaSaaS/1.0; +https://licitasaas.com)';
    private static readonly LOGIN_EMAIL = 'licitasaas@gmail.com';
    private static readonly LOGIN_PASSWORD = '100809LicitaSaas!';

    // Token cache
    private static cachedToken: string | null = null;
    private static tokenExpiry: Date | null = null;

    /**
     * Verifica se um link é da Licita Mais Brasil.
     */
    static isLMBLink(link: string): boolean {
        if (!link) return false;
        return link.toLowerCase().includes(LICITA_MAIS_BRASIL_PLATFORM.domain);
    }

    /**
     * Detecta se o link pertence à Licita Mais Brasil.
     */
    static detectPlatform(link: string): typeof LICITA_MAIS_BRASIL_PLATFORM | null {
        if (!link) return null;
        if (link.toLowerCase().includes(LICITA_MAIS_BRASIL_PLATFORM.domain)) return LICITA_MAIS_BRASIL_PLATFORM;
        return null;
    }

    /**
     * Extrai a URL da Licita Mais Brasil de um campo de link (pode ser multi-link).
     */
    static extractLMBUrl(linkField: string): string | null {
        if (!linkField) return null;
        const parts = linkField.split(',').map(s => s.trim());
        return parts.find(p => p.toLowerCase().includes(LICITA_MAIS_BRASIL_PLATFORM.domain)) || null;
    }

    /**
     * Extrai o auctionId de uma URL da Licita Mais Brasil.
     * 
     * Formatos suportados:
     *   - https://licitamaisbrasil.com.br/detalhes-do-edital/xwo_iPsPPIauYqSA
     *   - https://licitamaisbrasil.com.br/sala-de-negociacao/xwo_iPsPPIauYqSA
     *   - https://licitamaisbrasil.com.br/editais-publicados (sem ID — ignorar)
     */
    static extractAuctionId(url: string): string | null {
        if (!url) return null;
        // Formatos: /detalhes-do-edital/{id} ou /sala-de-negociacao/{id}
        const match = url.match(/(?:detalhes-do-edital|sala-de-negociacao)\/([A-Za-z0-9_-]+)/);
        return match ? match[1] : null;
    }

    /**
     * Autentica na API e retorna um Bearer token.
     * Usa cache para evitar logins desnecessários.
     * Token expira em ~24h (campo expirationDateSession).
     */
    static async getToken(): Promise<string | null> {
        // Check cache — renovar com 30min de margem
        if (this.cachedToken && this.tokenExpiry) {
            const margin = 30 * 60 * 1000; // 30 minutos
            if (new Date().getTime() < this.tokenExpiry.getTime() - margin) {
                return this.cachedToken;
            }
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

            const res = await fetch(`${this.API_BASE}/auth/login`, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Origin': `https://${LICITA_MAIS_BRASIL_PLATFORM.domain}`,
                    'User-Agent': this.USER_AGENT,
                },
                body: JSON.stringify({
                    email: this.LOGIN_EMAIL,
                    password: this.LOGIN_PASSWORD,
                    buyer: {},
                }),
            });

            clearTimeout(timeoutId);

            if (!res.ok) {
                console.error(`[LMB Monitor] Login falhou: HTTP ${res.status}`);
                return null;
            }

            const data: LMBAuthResponse = await res.json();

            if (!data.token) {
                console.error(`[LMB Monitor] Login retornou sem token`);
                return null;
            }

            this.cachedToken = data.token;
            this.tokenExpiry = new Date(data.expirationDateSession);
            console.log(`[LMB Monitor] 🔑 Token obtido, expira em: ${data.expirationDateSession}`);

            return data.token;
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.error(`[LMB Monitor] Timeout no login`);
            } else {
                console.error(`[LMB Monitor] Erro no login:`, error.message);
            }
            return null;
        }
    }

    /**
     * Busca os batch IDs de um auction.
     */
    static async fetchBatchIds(auctionId: string, token: string): Promise<string[]> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

            const res = await fetch(`${this.API_BASE}/app/batch/list`, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Origin': `https://${LICITA_MAIS_BRASIL_PLATFORM.domain}`,
                    'User-Agent': this.USER_AGENT,
                },
                body: JSON.stringify({ auctionNoticeId: auctionId, page: 1 }),
            });

            clearTimeout(timeoutId);

            if (!res.ok) {
                console.warn(`[LMB Monitor] Erro ao listar batches: HTTP ${res.status}`);
                return [];
            }

            const data = await res.json();
            const batches: LMBBatch[] = data.auctionBatches || [];
            return batches.map(b => b.id);
        } catch (error: any) {
            console.error(`[LMB Monitor] Erro ao buscar batches:`, error.message);
            return [];
        }
    }

    /**
     * Busca o chatChannel ID de um batch.
     */
    static async fetchChatChannelId(batchId: string, token: string): Promise<string | null> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

            const res = await fetch(`${this.API_BASE}/app/batch/read`, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Origin': `https://${LICITA_MAIS_BRASIL_PLATFORM.domain}`,
                    'User-Agent': this.USER_AGENT,
                },
                body: JSON.stringify({ id: batchId }),
            });

            clearTimeout(timeoutId);

            if (!res.ok) {
                console.warn(`[LMB Monitor] Erro ao ler batch ${batchId}: HTTP ${res.status}`);
                return null;
            }

            const data = await res.json();
            return data?.chatChannel?.id || null;
        } catch (error: any) {
            console.error(`[LMB Monitor] Erro ao buscar chatChannel:`, error.message);
            return null;
        }
    }

    /**
     * Busca mensagens de um chatChannel.
     */
    static async fetchChatMessages(chatChannelId: string, token: string): Promise<LicitaMaisBrasilMessage[]> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

            const res = await fetch(`${this.API_BASE}/chat/getMessages`, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Origin': `https://${LICITA_MAIS_BRASIL_PLATFORM.domain}`,
                    'User-Agent': this.USER_AGENT,
                },
                body: JSON.stringify({ chatChannel: chatChannelId }),
            });

            clearTimeout(timeoutId);

            if (!res.ok) {
                console.warn(`[LMB Monitor] HTTP ${res.status} para chatChannel ${chatChannelId}`);
                return [];
            }

            const data = await res.json();

            // A resposta pode ser um array direto ou { messages: [...] }
            const messages: LMBApiMessage[] = Array.isArray(data) ? data : (data.messages || data.data || []);

            if (messages.length === 0) return [];

            return this.parseMessages(messages);
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.warn(`[LMB Monitor] Timeout (${this.TIMEOUT_MS}ms) para chatChannel ${chatChannelId}`);
            } else {
                console.error(`[LMB Monitor] Erro ao buscar mensagens:`, error.message);
            }
            return [];
        }
    }

    /**
     * Fluxo completo: dado uma URL, busca todas as mensagens de todos os lotes.
     * 
     * 1. Extrai auctionId da URL
     * 2. Login (com cache)
     * 3. Lista batches do auction
     * 4. Para cada batch: busca chatChannelId → busca mensagens
     * 5. Retorna todas as mensagens unificadas
     */
    static async fetchMessages(lmbUrl: string): Promise<LicitaMaisBrasilMessage[]> {
        const auctionId = this.extractAuctionId(lmbUrl);
        if (!auctionId) {
            console.warn(`[LMB Monitor] Não foi possível extrair auctionId de: ${lmbUrl.substring(0, 60)}...`);
            return [];
        }

        const token = await this.getToken();
        if (!token) {
            console.error(`[LMB Monitor] Sem token para buscar mensagens`);
            return [];
        }

        const batchIds = await this.fetchBatchIds(auctionId, token);
        if (batchIds.length === 0) {
            return [];
        }

        const allMessages: LicitaMaisBrasilMessage[] = [];

        for (const batchId of batchIds) {
            const channelId = await this.fetchChatChannelId(batchId, token);
            if (!channelId) continue;

            const messages = await this.fetchChatMessages(channelId, token);
            allMessages.push(...messages);
        }

        return allMessages;
    }

    /**
     * Parse das mensagens da API para o formato padronizado.
     */
    private static parseMessages(apiMessages: LMBApiMessage[]): LicitaMaisBrasilMessage[] {
        return apiMessages
            .filter(msg => !msg.isDeleted && msg.text && msg.text.length > 0)
            .map(msg => {
                // Determinar tipo do autor
                const authorType: 'pregoeiro' | 'sistema' =
                    msg.isSystemMessage === 1 ? 'sistema' : 'pregoeiro';

                // Gerar messageId único via hash MD5
                // Usa o ID da API para garantir unicidade
                const messageId = crypto
                    .createHash('md5')
                    .update(`lmb|${msg.id}|${msg.createdDate}|${msg.text}`)
                    .digest('hex')
                    .substring(0, 16);

                return {
                    messageId,
                    content: msg.text,
                    authorType,
                    timestamp: msg.createdDate,
                    captureSource: LICITA_MAIS_BRASIL_PLATFORM.captureSource,
                };
            });
    }
}
