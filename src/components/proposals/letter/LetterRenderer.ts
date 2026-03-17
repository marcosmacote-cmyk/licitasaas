/**
 * ══════════════════════════════════════════════════════════════
 * LetterRenderer
 * Converte LetterBlock[] em HTML estruturado para preview e impressão.
 * Separação total: o Builder monta os dados, o Renderer formata.
 *
 * v3.1 — Parágrafos justificados sem recuo na primeira linha.
 *        Espaçamento compacto para caber em página única.
 * ══════════════════════════════════════════════════════════════
 */

import type { LetterBlock, ProposalLetterResult } from './types';
import { LetterBlockType } from './types';

export class LetterRenderer {

    /**
     * Renderiza todos os blocos visíveis em HTML formal.
     */
    renderToHtml(result: ProposalLetterResult): string {
        const visibleBlocks = result.blocks.filter(b => b.visible);
        // Group closing + signature in a single non-breakable wrapper
        const parts: string[] = [];
        let closingBuffer = '';
        for (const b of visibleBlocks) {
            if (b.type === LetterBlockType.CLOSING) {
                closingBuffer = this.renderBlock(b);
            } else if (b.type === LetterBlockType.SIGNATURE && closingBuffer) {
                // Wrap closing + signature together to prevent page break between them
                parts.push(`<div style="page-break-inside: avoid;">${closingBuffer}\n${this.renderBlock(b)}</div>`);
                closingBuffer = '';
            } else {
                if (closingBuffer) { parts.push(closingBuffer); closingBuffer = ''; }
                parts.push(this.renderBlock(b));
            }
        }
        if (closingBuffer) parts.push(closingBuffer);
        return parts.join('\n\n');
    }

    /**
     * Renderiza um bloco individual em HTML.
     * Todos os parágrafos: text-align: justify, SEM text-indent.
     */
    renderBlock(block: LetterBlock): string {
        const escaped = this.escapeHtml(block.content);
        const formatted = this.formatText(escaped);

        switch (block.type) {
            case LetterBlockType.TITLE:
                return `<div class="block block-title" style="margin-bottom: 12px; text-align: center;">
                    <p style="font-weight: bold; font-size: 14px; margin: 0; letter-spacing: 0.5px;">${formatted}</p>
                </div>`;

            case LetterBlockType.RECIPIENT:
                return `<div class="block block-recipient" style="margin-bottom: 10px;">
                    <p style="font-weight: bold; margin: 0; line-height: 1.4;">${formatted.replace(/\n/g, '<br/>')}</p>
                </div>`;

            case LetterBlockType.REFERENCE:
                return `<div class="block block-reference" style="margin-bottom: 8px;">
                    <p style="font-weight: bold; font-size: 11.5px; margin: 0;">${formatted}</p>
                </div>`;

            case LetterBlockType.QUALIFICATION:
                return `<div class="block block-qualification" style="margin-bottom: 8px; text-align: justify;">
                    <p style="margin: 0; line-height: 1.4;">${formatted.replace(/\n/g, '<br/>')}</p>
                </div>`;

            case LetterBlockType.OBJECT:
                return `<div class="block block-object" style="margin-bottom: 8px; text-align: justify;">
                    <p style="margin: 0; line-height: 1.4;">${formatted.replace(/\n/g, '<br/>')}</p>
                </div>`;

            case LetterBlockType.COMMERCIAL:
                return `<div class="block block-commercial" style="margin-bottom: 8px; text-align: justify; page-break-inside: avoid;">
                    ${this.renderParagraphs(formatted)}
                </div>`;

            case LetterBlockType.PRICING_SUMMARY:
                return `<div class="block block-pricing" style="margin-bottom: 8px; page-break-inside: avoid;">
                    ${this.renderParagraphs(formatted)}
                </div>`;

            case LetterBlockType.VALIDITY:
                return `<div class="block block-validity" style="margin-bottom: 8px; text-align: justify;">
                    <p style="margin: 0; line-height: 1.4;">${formatted}</p>
                </div>`;

            case LetterBlockType.PROPOSAL_CONDITIONS:
                return `<div class="block block-conditions" style="margin-bottom: 8px; text-align: justify; page-break-inside: avoid;">
                    ${this.renderParagraphs(formatted)}
                </div>`;

            case LetterBlockType.EXECUTION:
                return `<div class="block block-execution" style="margin-bottom: 8px; text-align: justify; page-break-inside: avoid;">
                    ${this.renderParagraphs(formatted)}
                </div>`;

            case LetterBlockType.BANKING:
                return `<div class="block block-banking" style="margin-bottom: 8px;">
                    <p style="margin: 0; line-height: 1.4;">${formatted.replace(/\n/g, '<br/>')}</p>
                </div>`;

            case LetterBlockType.CLOSING:
                return `<div class="block block-closing" style="margin-bottom: 3px; margin-top: 12px; page-break-inside: avoid;">
                    <div style="text-align: right; margin-bottom: 8px;">${formatted.split('\n')[0]}</div>
                    <div style="text-align: left;">${formatted.split('\n').slice(1).join('<br/>').trim()}</div>
                </div>`;

            case LetterBlockType.SIGNATURE:
                return this.renderSignature(formatted);

            default:
                return `<div class="block" style="margin-bottom: 10px;">
                    <p style="margin: 0; line-height: 1.5;">${formatted.replace(/\n/g, '<br/>')}</p>
                </div>`;
        }
    }

    /**
     * Renderiza bloco de assinatura com layout lado-a-lado quando BOTH.
     * Espaçamento compacto para caber na mesma página.
     */
    private renderSignature(formatted: string): string {
        // Split into signature sections (separated by double newline)
        const sections = formatted.split(/\n\n+/).filter(s => s.trim());

        if (sections.length === 1) {
            return `<div class="block block-signature signature-block" style="margin-top: 15px; text-align: center; page-break-inside: avoid;">
                <div class="sig-item" style="display: inline-block; text-align: center; font-size: 11px;">
                    <div style="margin-bottom: 25px;"></div>
                    ${sections[0].replace(/\n/g, '<br/>')}
                </div>
            </div>`;
        }

        // Multiple signatures side by side
        const sigHtml = sections.map(s =>
            `<div class="sig-item" style="display: inline-block; width: 45%; vertical-align: top; text-align: center; font-size: 11px;">
                <div style="margin-bottom: 25px;"></div>
                ${s.replace(/\n/g, '<br/>')}
            </div>`
        ).join('');

        return `<div class="block block-signature signature-block" style="margin-top: 15px; text-align: center; page-break-inside: avoid;">
            ${sigHtml}
        </div>`;
    }

    /**
     * Transforma múltiplas linhas em parágrafos separados.
     * Justificado, SEM recuo na primeira linha.
     */
    private renderParagraphs(text: string): string {
        return text.split(/\n\n+/)
            .filter(p => p.trim())
            .map(p => `<p style="margin: 0 0 6px 0; text-align: justify; line-height: 1.4;">${p.replace(/\n/g, '<br/>')}</p>`)
            .join('\n');
    }

    /**
     * Escape HTML special characters.
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Processa formatação inline (bold, italic) respeitando texto escapado.
     */
    private formatText(text: string): string {
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>');
    }
}
