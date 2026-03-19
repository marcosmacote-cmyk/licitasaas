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
     * Blocos do corpo principal recebem título de seção em negrito.
     * REGRA: espaçamento compacto para caber em UMA ÚNICA PÁGINA.
     */
    renderBlock(block: LetterBlock): string {
        const escaped = this.escapeHtml(block.content);
        const formatted = this.formatText(escaped);

        // ── Mapa de títulos de seção (corpo principal da proposta) ──
        const SECTION_TITLES: Record<string, string> = {
            [LetterBlockType.OBJECT]:               'DO OBJETO',
            [LetterBlockType.COMMERCIAL]:            'DAS DECLARAÇÕES',
            [LetterBlockType.PRICING_SUMMARY]:       'DO RESUMO DE PREÇOS',
            [LetterBlockType.VALIDITY]:              'DA VALIDADE DA PROPOSTA',
            [LetterBlockType.PROPOSAL_CONDITIONS]:   'DAS CONDIÇÕES DA PROPOSTA',
            [LetterBlockType.EXECUTION]:             'DAS CONDIÇÕES DE EXECUÇÃO',
            [LetterBlockType.BANKING]:               'DOS DADOS BANCÁRIOS',
        };

        const sectionTitle = SECTION_TITLES[block.type];
        const titleHtml = sectionTitle
            ? `<p style="margin: 0 0 2px 0; font-weight: bold; font-size: 10.5px; letter-spacing: 0.3px;">${sectionTitle}</p>\n`
            : '';

        switch (block.type) {
            case LetterBlockType.TITLE:
                return `<div class="block block-title" style="margin-bottom: 8px; text-align: center;">
                    <p style="font-weight: bold; font-size: 13px; margin: 0; letter-spacing: 0.5px;">${formatted}</p>
                </div>`;

            case LetterBlockType.RECIPIENT:
                return `<div class="block block-recipient" style="margin-bottom: 6px;">
                    <p style="font-weight: bold; margin: 0; line-height: 1.25;">${formatted.replace(/\n/g, '<br/>')}</p>
                </div>`;

            case LetterBlockType.REFERENCE:
                return `<div class="block block-reference" style="margin-bottom: 5px;">
                    <p style="font-weight: bold; font-size: 10.5px; margin: 0;">${formatted}</p>
                </div>`;

            case LetterBlockType.QUALIFICATION:
                return `<div class="block block-qualification" style="margin-bottom: 4px; text-align: justify;">
                    <p style="margin: 0; line-height: 1.25;">${formatted.replace(/\n/g, '<br/>')}</p>
                </div>`;

            case LetterBlockType.OBJECT:
                return `<div class="block block-object" style="margin-bottom: 4px; text-align: justify;">
                    ${titleHtml}<p style="margin: 0; line-height: 1.25;">${formatted.replace(/\n/g, '<br/>')}</p>
                </div>`;

            case LetterBlockType.COMMERCIAL:
                return `<div class="block block-commercial" style="margin-bottom: 4px; text-align: justify;">
                    ${titleHtml}${this.renderParagraphs(formatted)}
                </div>`;

            case LetterBlockType.PRICING_SUMMARY:
                return `<div class="block block-pricing" style="margin-bottom: 4px;">
                    ${titleHtml}${this.renderParagraphs(formatted)}
                </div>`;

            case LetterBlockType.VALIDITY:
                return `<div class="block block-validity" style="margin-bottom: 4px; text-align: justify;">
                    ${titleHtml}<p style="margin: 0; line-height: 1.25;">${formatted}</p>
                </div>`;

            case LetterBlockType.PROPOSAL_CONDITIONS:
                return `<div class="block block-conditions" style="margin-bottom: 4px; text-align: justify;">
                    ${titleHtml}${this.renderParagraphs(formatted)}
                </div>`;

            case LetterBlockType.EXECUTION:
                return `<div class="block block-execution" style="margin-bottom: 4px; text-align: justify;">
                    ${titleHtml}${this.renderParagraphs(formatted)}
                </div>`;

            case LetterBlockType.BANKING:
                return `<div class="block block-banking" style="margin-bottom: 4px;">
                    ${titleHtml}<p style="margin: 0; line-height: 1.25;">${formatted.replace(/\n/g, '<br/>')}</p>
                </div>`;

            case LetterBlockType.CLOSING:
                return `<div class="block block-closing" style="margin-bottom: 2px; margin-top: 6px; page-break-inside: avoid;">
                    <div style="text-align: right; margin-bottom: 5px;">${formatted.split('\n')[0]}</div>
                    <div style="text-align: left;">${formatted.split('\n').slice(1).join('<br/>').trim()}</div>
                </div>`;

            case LetterBlockType.SIGNATURE:
                return this.renderSignature(formatted);

            default:
                return `<div class="block" style="margin-bottom: 4px;">
                    <p style="margin: 0; line-height: 1.25;">${formatted.replace(/\n/g, '<br/>')}</p>
                </div>`;
        }
    }

    /**
     * Renderiza bloco de assinatura com layout lado-a-lado quando BOTH.
     * Formato fixo por linha:
     *   ___________________________________
     *   Nome do Representante
     *   CPF: xxx.xxx.xxx-xx
     *   Cargo / Função
     *   RAZÃO SOCIAL DA EMPRESA
     *   CNPJ: xx.xxx.xxx/xxxx-xx
     */
    private renderSignature(formatted: string): string {
        const sections = formatted.split(/\n\n+/).filter(s => s.trim());

        const renderSigItem = (section: string, width: string) => {
            const lines = section.split('\n').filter(l => l.trim());
            const linesHtml = lines.map(line => {
                // Linha de underline — renderizar como separador visual
                if (/^_{5,}$/.test(line.trim())) {
                    return `<div style="margin: 12px auto 4px; width: 220px; border-top: 1px solid #333;"></div>`;
                }
                return `<div>${line}</div>`;
            }).join('\n');

            return `<div class="sig-item" style="display: inline-block; width: ${width}; vertical-align: top; text-align: center; font-size: 10.5px; line-height: 1.5;">
                ${linesHtml}
            </div>`;
        };

        if (sections.length === 1) {
            return `<div class="block block-signature signature-block" style="margin-top: 6px; text-align: center; page-break-inside: avoid;">
                ${renderSigItem(sections[0], 'auto')}
            </div>`;
        }

        const sigHtml = sections.map(s => renderSigItem(s, '45%')).join('');

        return `<div class="block block-signature signature-block" style="margin-top: 6px; text-align: center; page-break-inside: avoid;">
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
            .map(p => `<p style="margin: 0 0 3px 0; text-align: justify; line-height: 1.25;">${p.replace(/\n/g, '<br/>')}</p>`)
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
