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
 *     "chatChannel": { "id": "kaQ6tV0yF44hgs7t" },
 *     "user": { "kind": "BUYER" | "SUPPLIER", "name": "..." }
 *   }
 * ]
 * 
 * URL pública do edital: https://licitamaisbrasil.com.br/detalhes-do-edital/{auctionId}
 * URL da sala:           https://licitamaisbrasil.com.br/sala-de-negociacao/{auctionId}
 * 
 * Acesso: Requer autenticação (email/senha de cidadão).
 * Credenciais via env vars: LMB_LOGIN_EMAIL, LMB_LOGIN_PASSWORD.
 */

import crypto from 'crypto';
import { logger } from '../../lib/logger';

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
    authorType: 'pregoeiro' | 'fornecedor' | 'sistema';
    timestamp: string;
    captureSource: typeof LICITA_MAIS_BRASIL_PLATFORM.captureSource;
    itemRef: string | null;
    eventCategory: string | null;
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
    user?: { kind?: string; name?: string };
}

interface LMBBatch {
    id: string;
    description?: string;
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

// ── Event category classification via regex (aligned with alertTaxonomy.ts) ──
function classifyEventCategory(text: string): string | null {
    if (!text) return null;
    const t = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    // Closure / Encerramento
    if (/\b(encerrad[oa]|homologad[oa]|cancelad[oa]|anuladad[oa]|revogad[oa]|desert[oa]|fracassad[oa])\b/.test(t)) return 'encerramento';
    // Convocação
    if (/\b(convoca|habilitacao|documentos?\s+de\s+habilitacao|prazo\s+para\s+(?:envio|apresentacao))\b/.test(t)) return 'convocacao';
    // Suspensão
    if (/\b(suspend?[oae]|suspen[cs]ao|interromp)\b/.test(t)) return 'suspensao';
    // Reabertura
    if (/\b(reabert[oa]|reabrir|retom[ao]d[oa]|retomada)\b/.test(t)) return 'reabertura';
    // Negociação
    if (/\b(negociacao|contraproposta|negocia[rç]|lance|melhor\s+oferta)\b/.test(t)) return 'negociacao';
    // Vencedor / Adjudicação
    if (/\b(vencedor|adjudica|arrematante|melhor\s+classificad[oa])\b/.test(t)) return 'vencedor';
    // Impugnação / Recurso
    if (/\b(impugnacao|recurso|contrarrazao|contrarraz[oõ]es)\b/.test(t)) return 'impugnacao';
    // Inabilitação
    if (/\b(inabilit|desclassific)\b/.test(t)) return 'inabilitacao';
    // Abertura / Início
    if (/\b(abert[oa]\s+para|processo\s+.*\s+aberto|sessao\s+.*\s+aberta|propostas?\s+iniciais)\b/.test(t)) return 'abertura';

    return null;
}

export class LicitaMaisBrasilMonitor {
    private static readonly TIMEOUT_MS = 20_000;
    private static readonly API_BASE = `https://${LICITA_MAIS_BRASIL_PLATFORM.apiDomain}`;
    private static readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

    // Credentials from env vars (fallback to hardcoded for backwards compat)
    private static readonly LOGIN_EMAIL = process.env.LMB_LOGIN_EMAIL || 'licitasaas@gmail.com';
    private static readonly LOGIN_PASSWORD = process.env.LMB_LOGIN_PASSWORD || '100809LicitaSaas!';

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
                logger.error(`[LMB Monitor] Login falhou: HTTP ${res.status}`);
                return null;
            }

            const data: LMBAuthResponse = await res.json();

            if (!data.token) {
                logger.error(`[LMB Monitor] Login retornou sem token`);
                return null;
            }

            this.cachedToken = data.token;
            this.tokenExpiry = new Date(data.expirationDateSession);
            logger.info(`[LMB Monitor] 🔑 Token obtido, expira em: ${data.expirationDateSession}`);

            return data.token;
        } catch (error: any) {
            if (error.name === 'AbortError') {
                logger.error(`[LMB Monitor] Timeout no login`);
            } else {
                logger.error(`[LMB Monitor] Erro no login:`, error.message);
            }
            return null;
        }
    }

    /**
     * Busca os batch IDs de um auction (com paginação).
     */
    static async fetchBatchIds(auctionId: string, token: string): Promise<LMBBatch[]> {
        const allBatches: LMBBatch[] = [];
        let page = 1;
        const maxPages = 5;

        while (page <= maxPages) {
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
                    body: JSON.stringify({ auctionNoticeId: auctionId, page }),
                });

                clearTimeout(timeoutId);

                if (!res.ok) {
                    logger.warn(`[LMB Monitor] Erro ao listar batches: HTTP ${res.status}`);
                    break;
                }

                const data = await res.json();
                const batches: LMBBatch[] = data.auctionBatches || [];
                if (batches.length === 0) break;

                allBatches.push(...batches);

                // Check if there are more pages
                const total = data.total || data.totalPages || 0;
                if (allBatches.length >= total || batches.length < 20) break;

                page++;
            } catch (error: any) {
                logger.error(`[LMB Monitor] Erro ao buscar batches:`, error.message);
                break;
            }
        }

        return allBatches;
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
                logger.warn(`[LMB Monitor] Erro ao ler batch ${batchId}: HTTP ${res.status}`);
                return null;
            }

            const data = await res.json();
            return data?.chatChannel?.id || null;
        } catch (error: any) {
            logger.error(`[LMB Monitor] Erro ao buscar chatChannel:`, error.message);
            return null;
        }
    }

    /**
     * Busca mensagens de um chatChannel.
     */
    static async fetchChatMessages(chatChannelId: string, token: string, batchLabel: string | null): Promise<LicitaMaisBrasilMessage[]> {
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
                logger.warn(`[LMB Monitor] HTTP ${res.status} para chatChannel ${chatChannelId}`);
                return [];
            }

            const data = await res.json();

            // A resposta pode ser um array direto ou { messages: [...] }
            const messages: LMBApiMessage[] = Array.isArray(data) ? data : (data.messages || data.data || []);

            if (messages.length === 0) return [];

            return this.parseMessages(messages, batchLabel);
        } catch (error: any) {
            if (error.name === 'AbortError') {
                logger.warn(`[LMB Monitor] Timeout (${this.TIMEOUT_MS}ms) para chatChannel ${chatChannelId}`);
            } else {
                logger.error(`[LMB Monitor] Erro ao buscar mensagens:`, error.message);
            }
            return [];
        }
    }

    /**
     * Fluxo completo: dado uma URL, busca todas as mensagens de todos os lotes.
     * 
     * 1. Extrai auctionId da URL
     * 2. Login (com cache)
     * 3. Lista batches do auction (com paginação)
     * 4. Para cada batch: busca chatChannelId → busca mensagens
     * 5. Retorna todas as mensagens unificadas (com itemRef e eventCategory)
     */
    static async fetchMessages(lmbUrl: string): Promise<LicitaMaisBrasilMessage[]> {
        const auctionId = this.extractAuctionId(lmbUrl);
        if (!auctionId) {
            logger.warn(`[LMB Monitor] Não foi possível extrair auctionId de: ${lmbUrl.substring(0, 60)}...`);
            return [];
        }

        const token = await this.getToken();
        if (!token) {
            logger.error(`[LMB Monitor] Sem token para buscar mensagens`);
            return [];
        }

        const batches = await this.fetchBatchIds(auctionId, token);
        if (batches.length === 0) {
            return [];
        }

        const allMessages: LicitaMaisBrasilMessage[] = [];

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const channelId = await this.fetchChatChannelId(batch.id, token);
            if (!channelId) continue;

            // Build batch label for itemRef (e.g. "Lote 1", "Lote 2")
            const batchLabel = batches.length > 1
                ? (batch.description || `Lote ${i + 1}`)
                : null;

            const messages = await this.fetchChatMessages(channelId, token, batchLabel);
            allMessages.push(...messages);
        }

        return allMessages;
    }

    /**
     * Parse das mensagens da API para o formato padronizado.
     * Inclui eventCategory (via regex) e itemRef (batch label).
     */
    private static parseMessages(apiMessages: LMBApiMessage[], batchLabel: string | null): LicitaMaisBrasilMessage[] {
        return apiMessages
            .filter(msg => !msg.isDeleted && msg.text && msg.text.length > 0)
            .map(msg => {
                // Determinar tipo do autor (3 tipos)
                let authorType: 'pregoeiro' | 'fornecedor' | 'sistema';
                if (msg.isSystemMessage === 1) {
                    authorType = 'sistema';
                } else {
                    const userKind = msg.user?.kind?.toUpperCase() || '';
                    authorType = userKind === 'SUPPLIER' ? 'fornecedor' : 'pregoeiro';
                }

                // Classificar evento via regex no conteúdo
                const eventCategory = classifyEventCategory(msg.text);

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
                    itemRef: batchLabel,
                    eventCategory,
                };
            });
    }
}
