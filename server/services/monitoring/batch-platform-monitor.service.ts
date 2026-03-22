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
 * Fluxo:
 * 1. Detecta qual plataforma está no link do processo
 * 2. Extrai `param1` da URL
 * 3. GET na API pública: /BatchList/GetProcessMessageView?param1=...
 * 4. Parse do HTML com cheerio (tabela #MsgProcess)
 * 5. Retorna mensagens padronizadas para o pipeline de ingestão
 */

import * as cheerio from 'cheerio';
import crypto from 'crypto';

// ── Plataformas reconhecidas ──
export const BATCH_PLATFORMS = [
    { id: 'bll' as const, domain: 'bllcompras.com', label: 'BLL Compras', captureSource: 'bll-api' as const },
    { id: 'bnc' as const, domain: 'bnccompras.com', label: 'BNC Compras', captureSource: 'bnc-api' as const },
] as const;

export type BatchPlatform = typeof BATCH_PLATFORMS[number];
export type BatchCaptureSource = BatchPlatform['captureSource'];

export interface BatchMessage {
    messageId: string;
    content: string;
    authorType: 'pregoeiro' | 'sistema';
    timestamp: string;
    captureSource: BatchCaptureSource;
}

export class BatchPlatformMonitor {
    private static readonly TIMEOUT_MS = 15_000;

    /**
     * Detecta qual plataforma Batch está presente no link.
     * Retorna null se nenhuma for encontrada.
     */
    static detectPlatform(linkField: string): BatchPlatform | null {
        if (!linkField) return null;
        const lower = linkField.toLowerCase();
        return BATCH_PLATFORMS.find(p => lower.includes(p.domain)) || null;
    }

    /**
     * Verifica se um link contém referência a QUALQUER plataforma Batch.
     */
    static isBatchLink(link: string): boolean {
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
    static extractParam1(linkField: string): string | null {
        if (!linkField) return null;

        // Se é multi-link, encontrar o da plataforma Batch
        const parts = linkField.split(',').map(s => s.trim());
        const batchUrl = parts.find(p => 
            BATCH_PLATFORMS.some(bp => p.toLowerCase().includes(bp.domain))
        );

        if (!batchUrl) return null;

        const match = batchUrl.match(/param1=([^&]+)/);
        if (!match) return null;

        try {
            return decodeURIComponent(match[1]);
        } catch {
            return match[1];
        }
    }

    /**
     * Busca mensagens de um processo via API REST pública.
     * 
     * Endpoint: GET https://{domain}/BatchList/GetProcessMessageView?param1=[hash]
     * Retorna JSON: { modal: "", html: "<div>...<tbody id='MsgProcess'>...</tbody>...</div>" }
     */
    static async fetchMessages(param1: string, platform: BatchPlatform): Promise<BatchMessage[]> {
        const url = `https://${platform.domain}/BatchList/GetProcessMessageView?param1=${encodeURIComponent(param1)}`;

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
                console.warn(`[${platform.label}] HTTP ${res.status} para param1=${param1.substring(0, 20)}...`);
                return [];
            }

            const data = await res.json();
            const html = data?.html || '';

            if (!html || !html.includes('MsgProcess')) {
                return [];
            }

            return this.parseMessages(html, platform);
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.warn(`[${platform.label}] Timeout (${this.TIMEOUT_MS}ms) para param1=${param1.substring(0, 20)}...`);
            } else {
                console.error(`[${platform.label}] Erro ao buscar mensagens:`, error.message);
            }
            return [];
        }
    }

    /**
     * Parse do HTML retornado pela API.
     * Extrai mensagens da tabela #MsgProcess.
     */
    private static parseMessages(html: string, platform: BatchPlatform): BatchMessage[] {
        const $ = cheerio.load(html);
        const messages: BatchMessage[] = [];

        $('#MsgProcess tr').each((_: number, row: any) => {
            const cells = $(row).find('td');
            if (cells.length < 2) return;

            const timestamp = $(cells[0]).text().trim();
            const content = $(cells[1]).text().trim();

            if (!content || content.length === 0) return;

            // Gerar messageId único via hash MD5 (inclui platform.id para evitar colisões)
            const messageId = crypto
                .createHash('md5')
                .update(`${platform.id}|${timestamp}|${content}`)
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
                captureSource: platform.captureSource,
            });
        });

        return messages;
    }
}

// ── Backward compatibility: manter isBLLLink exportado ──
export function isBLLLink(link: string): boolean {
    return link.includes('bllcompras') || link.includes('bll.org');
}
