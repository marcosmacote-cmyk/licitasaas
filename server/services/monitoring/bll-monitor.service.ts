/**
 * ══════════════════════════════════════════════════════════════════
 * BLLMonitor — Serviço de monitoramento de chat para BLL Compras
 * ══════════════════════════════════════════════════════════════════
 * 
 * O BLL Compras expõe uma API REST pública que retorna mensagens
 * em formato HTML. Não precisa de autenticação nem de browser.
 * 
 * Fluxo:
 * 1. Extrai `param1` da URL do processo BLL
 * 2. GET na API pública: /BatchList/GetProcessMessageView?param1=...
 * 3. Parse do HTML com cheerio (tabela #MsgProcess)
 * 4. Retorna mensagens padronizadas para o pipeline de ingestão
 */

import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { logger } from '../../lib/logger';

export interface BLLMessage {
    messageId: string;
    content: string;
    authorType: 'pregoeiro' | 'sistema';
    timestamp: string;
    captureSource: 'bll-api';
}

export class BLLMonitor {
    private static readonly BASE_URL = 'https://bllcompras.com/BatchList/GetProcessMessageView';
    private static readonly TIMEOUT_MS = 15_000;

    /**
     * Extrai o hash `param1` de uma URL BLL.
     * 
     * Suporta múltiplos formatos:
     *   - "https://bllcompras.com/Process/ProcessView?param1=[gkz]eAMK1w..."
     *   - String multi-link separada por vírgula (extrai apenas o BLL)
     * 
     * @returns O param1 decodificado ou null se não encontrado
     */
    static extractParam1(linkField: string): string | null {
        if (!linkField) return null;

        // Se é multi-link, encontrar o do BLL
        const parts = linkField.split(',').map(s => s.trim());
        const bllUrl = parts.find(p => p.includes('bllcompras') || p.includes('bll.org'));

        if (!bllUrl) return null;

        const match = bllUrl.match(/param1=([^&]+)/);
        if (!match) return null;

        try {
            return decodeURIComponent(match[1]);
        } catch {
            return match[1]; // Retorna sem decode se falhar
        }
    }

    /**
     * Busca mensagens de um processo BLL via API REST pública.
     * 
     * Endpoint: GET /BatchList/GetProcessMessageView?param1=[hash]
     * Retorna JSON: { modal: "", html: "<div>...<tbody id='MsgProcess'>...</tbody>...</div>" }
     * 
     * Cada <tr> no #MsgProcess tem:
     *   <td class="datetimesecwidth">20/03/2026 16:51:38</td>
     *   <td>Texto da mensagem...</td>
     */
    static async fetchMessages(param1: string): Promise<BLLMessage[]> {
        const url = `${this.BASE_URL}?param1=${encodeURIComponent(param1)}`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'LicitaSaaS/1.0',
                },
            });

            clearTimeout(timeoutId);

            if (!res.ok) {
                logger.warn(`[BLLMonitor] HTTP ${res.status} para param1=${param1.substring(0, 20)}...`);
                return [];
            }

            const data = await res.json();
            const html = data?.html || '';

            if (!html || !html.includes('MsgProcess')) {
                return [];
            }

            return this.parseMessages(html);
        } catch (error: any) {
            if (error.name === 'AbortError') {
                logger.warn(`[BLLMonitor] Timeout (${this.TIMEOUT_MS}ms) para param1=${param1.substring(0, 20)}...`);
            } else {
                logger.error(`[BLLMonitor] Erro ao buscar mensagens:`, error.message);
            }
            return [];
        }
    }

    /**
     * Parse do HTML retornado pela API BLL.
     * Extrai mensagens da tabela #MsgProcess.
     */
    private static parseMessages(html: string): BLLMessage[] {
        const $ = cheerio.load(html);
        const messages: BLLMessage[] = [];

        $('#MsgProcess tr').each((_: number, row: any) => {
            const cells = $(row).find('td');
            if (cells.length < 2) return;

            const timestamp = $(cells[0]).text().trim();
            const content = $(cells[1]).text().trim();

            if (!content || content.length === 0) return;

            // Gerar messageId único via hash MD5
            const messageId = crypto
                .createHash('md5')
                .update(`bll|${timestamp}|${content}`)
                .digest('hex')
                .substring(0, 16);

            // Detectar se é mensagem do sistema ou pregoeiro
            const isSystem = content.startsWith('O ') && (
                content.includes('lance') ||
                content.includes('encerrad') ||
                content.includes('suspens') ||
                content.includes('aberto') ||
                content.includes('classificad')
            );

            messages.push({
                messageId,
                content,
                authorType: isSystem ? 'sistema' : 'pregoeiro',
                timestamp,
                captureSource: 'bll-api',
            });
        });

        return messages;
    }

    /**
     * Verifica se uma URL/link contém referência ao BLL Compras.
     */
    static isBLLLink(link: string): boolean {
        return link.includes('bllcompras') || link.includes('bll.org');
    }
}
