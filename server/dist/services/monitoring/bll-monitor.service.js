"use strict";
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
exports.BLLMonitor = void 0;
const cheerio = __importStar(require("cheerio"));
const crypto_1 = __importDefault(require("crypto"));
class BLLMonitor {
    /**
     * Extrai o hash `param1` de uma URL BLL.
     *
     * Suporta múltiplos formatos:
     *   - "https://bllcompras.com/Process/ProcessView?param1=[gkz]eAMK1w..."
     *   - String multi-link separada por vírgula (extrai apenas o BLL)
     *
     * @returns O param1 decodificado ou null se não encontrado
     */
    static extractParam1(linkField) {
        if (!linkField)
            return null;
        // Se é multi-link, encontrar o do BLL
        const parts = linkField.split(',').map(s => s.trim());
        const bllUrl = parts.find(p => p.includes('bllcompras') || p.includes('bll.org'));
        if (!bllUrl)
            return null;
        const match = bllUrl.match(/param1=([^&]+)/);
        if (!match)
            return null;
        try {
            return decodeURIComponent(match[1]);
        }
        catch {
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
    static async fetchMessages(param1) {
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
                console.warn(`[BLLMonitor] HTTP ${res.status} para param1=${param1.substring(0, 20)}...`);
                return [];
            }
            const data = await res.json();
            const html = data?.html || '';
            if (!html || !html.includes('MsgProcess')) {
                return [];
            }
            return this.parseMessages(html);
        }
        catch (error) {
            if (error.name === 'AbortError') {
                console.warn(`[BLLMonitor] Timeout (${this.TIMEOUT_MS}ms) para param1=${param1.substring(0, 20)}...`);
            }
            else {
                console.error(`[BLLMonitor] Erro ao buscar mensagens:`, error.message);
            }
            return [];
        }
    }
    /**
     * Parse do HTML retornado pela API BLL.
     * Extrai mensagens da tabela #MsgProcess.
     */
    static parseMessages(html) {
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
            // Gerar messageId único via hash MD5
            const messageId = crypto_1.default
                .createHash('md5')
                .update(`bll|${timestamp}|${content}`)
                .digest('hex')
                .substring(0, 16);
            // Detectar se é mensagem do sistema ou pregoeiro
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
                captureSource: 'bll-api',
            });
        });
        return messages;
    }
    /**
     * Verifica se uma URL/link contém referência ao BLL Compras.
     */
    static isBLLLink(link) {
        return link.includes('bllcompras') || link.includes('bll.org');
    }
}
exports.BLLMonitor = BLLMonitor;
BLLMonitor.BASE_URL = 'https://bllcompras.com/BatchList/GetProcessMessageView';
BLLMonitor.TIMEOUT_MS = 15000;
