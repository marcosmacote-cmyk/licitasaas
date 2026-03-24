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
 * <div class="timeline-item">
 *   <div class="time"> 24/03/2026 17:06:09 | Sistema </div>
 *   <div class="description">Mensagem do chat aqui</div>
 * </div>
 * ```
 * 
 * Fluxo:
 * 1. Detecta se o link é do Portal de Compras Públicas
 * 2. Faz GET na URL pública do processo (SSR)
 * 3. Parse do HTML com Cheerio (`.timeline-item`)
 * 4. Extrai timestamp, autor e conteúdo
 * 5. Retorna mensagens padronizadas para o pipeline de ingestão
 * 
 * Acesso: Público, sem autenticação.
 */

import * as cheerio from 'cheerio';
import crypto from 'crypto';

export const PCP_PLATFORM = {
    id: 'pcp' as const,
    domain: 'portaldecompraspublicas.com.br',
    label: 'Portal de Compras Públicas',
    captureSource: 'pcp-api' as const,
};

export interface PCPMessage {
    messageId: string;
    content: string;
    authorType: 'pregoeiro' | 'sistema';
    timestamp: string;
    captureSource: typeof PCP_PLATFORM.captureSource;
}

export class PCPMonitor {
    private static readonly TIMEOUT_MS = 20_000;

    /**
     * Verifica se um link é do Portal de Compras Públicas.
     */
    static isPCPLink(link: string): boolean {
        if (!link) return false;
        return link.toLowerCase().includes(PCP_PLATFORM.domain);
    }

    /**
     * Detecta se o link pertence ao Portal de Compras Públicas.
     * Retorna o platform object ou null.
     */
    static detectPlatform(link: string): typeof PCP_PLATFORM | null {
        if (!link) return null;
        const lower = link.toLowerCase();
        if (lower.includes(PCP_PLATFORM.domain)) return PCP_PLATFORM;
        return null;
    }

    /**
     * Extrai a URL do PCP de um campo de link (pode ser multi-link).
     */
    static extractPCPUrl(linkField: string): string | null {
        if (!linkField) return null;

        const parts = linkField.split(',').map(s => s.trim());
        const pcpUrl = parts.find(p =>
            p.toLowerCase().includes(PCP_PLATFORM.domain)
        );

        return pcpUrl || null;
    }



    /**
     * Busca mensagens de um processo via scraping do HTML SSR.
     * 
     * O PCP renderiza tudo no HTML inicial (Angular SSR).
     * Basta fazer um GET na URL do processo e parsear `.timeline-item`.
     */
    static async fetchMessages(processUrl: string): Promise<PCPMessage[]> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

            const res = await fetch(processUrl, {
                signal: controller.signal,
                headers: {
                    'Accept': 'text/html,application/xhtml+xml',
                    'User-Agent': 'Mozilla/5.0 (compatible; LicitaSaaS/1.0)',
                    'Accept-Language': 'pt-BR,pt;q=0.9',
                },
            });

            clearTimeout(timeoutId);

            if (!res.ok) {
                console.warn(`[PCP Monitor] HTTP ${res.status} para ${processUrl.substring(0, 60)}...`);
                return [];
            }

            const html = await res.text();

            if (!html.includes('timeline-item')) {
                console.warn(`[PCP Monitor] Nenhuma timeline encontrada em ${processUrl.substring(0, 60)}...`);
                return [];
            }

            return this.parseMessages(html);
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.warn(`[PCP Monitor] Timeout (${this.TIMEOUT_MS}ms) para ${processUrl.substring(0, 60)}...`);
            } else {
                console.error(`[PCP Monitor] Erro ao buscar mensagens:`, error.message);
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
     */
    private static parseMessages(html: string): PCPMessage[] {
        const $ = cheerio.load(html);
        const messages: PCPMessage[] = [];

        // Use 'app-assistance .timeline-item' to only capture chat messages
        // (the page also has a status timeline with the same class)
        $('app-assistance .timeline-item').each((_: number, item: any) => {
            const timeText = $(item).find('.time').text().trim();
            const description = $(item).find('.description').text().trim();

            if (!description || description.length === 0) return;

            // Parse do formato: "DD/MM/YYYY HH:MM:SS | Autor"
            const { timestamp, author } = this.parseTimeField(timeText);
            if (!timestamp) return;

            // Determinar tipo do autor
            const authorLower = author.toLowerCase();
            const authorType: 'pregoeiro' | 'sistema' = 
                authorLower.includes('sistema') ? 'sistema' : 'pregoeiro';

            // Gerar messageId único via hash MD5
            const messageId = crypto
                .createHash('md5')
                .update(`pcp|${timestamp}|${description}`)
                .digest('hex')
                .substring(0, 16);

            messages.push({
                messageId,
                content: description,
                authorType,
                timestamp,
                captureSource: PCP_PLATFORM.captureSource,
            });
        });

        return messages;
    }

    /**
     * Parse do campo "time" no formato "DD/MM/YYYY HH:MM:SS | Autor".
     * Retorna o timestamp original e o nome do autor.
     */
    private static parseTimeField(timeText: string): { timestamp: string; author: string } {
        if (!timeText) return { timestamp: '', author: '' };

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
