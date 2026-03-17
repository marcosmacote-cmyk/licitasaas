/**
 * ══════════════════════════════════════════════════════════════
 * LetterPdfExporter
 * Abre uma janela de impressão com o documento renderizado.
 * Suporta 5 modos de exportação.
 * Substitui a lógica dispersa do exportServices.ts com dados do Builder.
 * ══════════════════════════════════════════════════════════════
 */

import type { ProposalLetterResult, LetterExportMode, ProposalLetterData } from './types';
import type { ProposalItem } from '../../../types';
import { LetterRenderer } from './LetterRenderer';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface PdfExportOptions {
    result: ProposalLetterResult;
    data: ProposalLetterData;
    items: ProposalItem[];
    mode: LetterExportMode;
    headerImage: string;
    footerImage: string;
    headerImageHeight: number;
    footerImageHeight: number;
    printLandscape?: boolean;
}

export class LetterPdfExporter {
    private renderer = new LetterRenderer();

    /**
     * Gera e abre a janela de impressão.
     */
    export(options: PdfExportOptions): void {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            console.warn('[LetterPdfExporter] Pop-up blocked. Please allow pop-ups.');
            return;
        }

        const html = this.buildFullHtml(options);
        printWindow.document.write(html);
        printWindow.document.close();
    }

    /**
     * Monta o HTML completo do documento.
     */
    private buildFullHtml(opts: PdfExportOptions): string {
        const { result, data, items, mode, headerImage, footerImage,
                headerImageHeight, footerImageHeight, printLandscape } = opts;

        const showLetter = mode !== 'SPREADSHEET';
        const showSpreadsheet = mode === 'SPREADSHEET' || mode === 'FULL';
        const showSummaryTable = mode === 'LETTER_WITH_SUMMARY';
        const showAnalyticalTable = mode === 'LETTER_ANALYTICAL';

        const topMargin = headerImage ? (headerImageHeight + 20) : 100;
        const bottomMargin = footerImage ? (footerImageHeight + 30) : 80;

        // ── Letter HTML ──
        const letterHtml = showLetter ? this.renderer.renderToHtml(result) : '';

        // ── Items Table ──
        const totalValue = items.reduce((sum, it) => sum + (it.totalPrice || 0), 0);
        const itemsTableHtml = (showSpreadsheet || showAnalyticalTable)
            ? this.buildItemsTable(items, totalValue, data.pricing.discountPercentage, data.commercial.validityDays)
            : '';

        // ── Summary Table (compact) ──
        const summaryTableHtml = showSummaryTable
            ? this.buildSummaryTable(items, totalValue, data.commercial.validityDays)
            : '';

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Proposta Comercial - ${data.company.razaoSocial}</title>
    <style>
        body { font-family: 'Arial', sans-serif; color: #111; line-height: 1.35; font-size: 11px; margin: 0; padding: 0; }
        .fixed-header { position: fixed; top: 0; left: 0; right: 0; text-align: center; background: #fff; z-index: 100; padding: 0; }
        .fixed-header img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
        .fixed-footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; background: #fff; z-index: 100; padding: 0; }
        .fixed-footer img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
        .fixed-footer .gen-info { font-size: 7px; color: #999; margin-top: 1px; }
        .content-wrapper { padding: 5px 10px; }
        .letter { margin-bottom: 10px; text-align: justify; font-size: 11px; line-height: 1.35; }
        table.items { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 10px; table-layout: auto; }
        table.items th { border-bottom: 2px solid #222; padding: 6px 4px; text-align: left; background: #f5f5f5; font-size: 10px; overflow: hidden; }
        table.items td { padding: 4px 6px; border-bottom: 1px solid #ddd; font-size: 10px; word-wrap: break-word; overflow: visible; }
        table.summary { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 11px; }
        table.summary th { border-bottom: 2px solid #222; padding: 5px; text-align: left; background: #f5f5f5; font-size: 10px; }
        table.summary td { padding: 4px 5px; border-bottom: 1px solid #ddd; }
        .totals { width: 250px; margin-left: auto; margin-top: 10px; page-break-inside: avoid; }
        .totals tr th, .totals tr td { padding: 4px; text-align: right; border-bottom: 1px solid #ddd; font-size: 11px; }
        .totals-clearfix { clear: both; height: 1px; }
        .signature-block { text-align: center; page-break-inside: avoid; clear: both; margin-top: 15px; }
        .sig-item { display: inline-block; width: 45%; vertical-align: top; text-align: center; font-size: 10px; }
        table.print-wrapper { width: 100%; border: none; border-collapse: collapse; }
        table.print-wrapper > thead > tr > td { height: ${topMargin}px; border: none; padding: 0; }
        table.print-wrapper > tfoot > tr > td { height: ${bottomMargin}px; border: none; padding: 0; }
        table.print-wrapper > tbody > tr > td { border: none; padding: 0; vertical-align: top; }

        /* ── REGRA: Todo conteúdo da carta deve caber em 1 página ── */
        .letter * { page-break-inside: avoid; }
        .letter .block { margin-bottom: 6px !important; }
        .letter .block p { margin-bottom: 5px !important; line-height: 1.35 !important; }

        /* ── Modo Paisagem: compactação extra ── */
        body.landscape-mode { font-size: 9.5px; line-height: 1.2; }
        body.landscape-mode .letter { font-size: 9.5px; line-height: 1.2; margin-bottom: 5px; }
        body.landscape-mode .block { margin-bottom: 3px !important; }
        body.landscape-mode .block p { margin-bottom: 3px !important; line-height: 1.2 !important; }
        body.landscape-mode .block-recipient { margin-bottom: 4px !important; }
        body.landscape-mode .block-reference { margin-bottom: 3px !important; }
        body.landscape-mode .block-closing { margin-top: 5px !important; margin-bottom: 2px !important; }
        body.landscape-mode .signature-block { margin-top: 6px !important; }
        body.landscape-mode .sig-item { font-size: 9px; }
        body.landscape-mode .sig-item div:first-child { margin-bottom: 10px !important; }
        body.landscape-mode .content-wrapper { padding: 3px 8px; }

        @media print {
            body { font-size: 10.5px; }
            body.landscape-mode { font-size: 9px; }
            .content-wrapper { padding: 0; }
            @page { size: ${printLandscape ? 'landscape' : 'portrait'}; margin: ${printLandscape ? '0.4cm 0.6cm' : '0.6cm 0.8cm'}; }
        }
    </style>
</head>
<body${printLandscape ? ' class="landscape-mode"' : ''}>
    <script>
    window.onload = function() {
        // Auto-scale: mede o conteúdo e reduz se necessário para caber em 1 página
        setTimeout(function() {
            var wrapper = document.querySelector('.content-wrapper');
            if (!wrapper) { window.print(); return; }
            
            var isLandscape = document.body.classList.contains('landscape-mode');
            // Altura útil da página (A4 menos margens e header/footer)
            var pageH = isLandscape ? 490 : 750;
            var headerH = ${topMargin};
            var footerH = ${bottomMargin};
            var availableH = pageH - headerH - footerH;
            
            var contentH = wrapper.scrollHeight;
            
            if (contentH > availableH) {
                var scale = Math.max(0.65, availableH / contentH);
                wrapper.style.transform = 'scale(' + scale + ')';
                wrapper.style.transformOrigin = 'top left';
                wrapper.style.width = (100 / scale) + '%';
            }
            
            setTimeout(function() { window.print(); }, 300);
        }, 400);
    };
    </script>

    <div class="fixed-header">
        ${headerImage
            ? `<img src="${headerImage}" alt="Cabeçalho" style="max-height: ${headerImageHeight}px;" />`
            : `<div style="border-bottom: 2px solid #222; padding: 20px 0; margin: 0 40px;">
                <h1 style="margin: 0; font-size: 20px;">${this.esc(data.company.razaoSocial)}</h1>
                <p style="margin: 5px 0; font-weight: bold;">CNPJ: ${data.company.cnpj}</p>
               </div>`
        }
    </div>

    <div class="fixed-footer">
        ${footerImage
            ? `<img src="${footerImage}" alt="Rodapé" style="max-height: ${footerImageHeight}px;" />`
            : `<div style="border-top: 1px solid #ddd; padding: 10px 0; font-size: 10px; color: #444; margin: 0 40px;">
                ${data.company.address || data.company.razaoSocial}<br/>
                ${data.company.email || ''}${data.company.phone ? ' | Tel: ' + data.company.phone : ''}
               </div>`
        }
        <div class="gen-info">Gerado por LicitaSaaS em ${new Date().toLocaleDateString('pt-BR')}</div>
    </div>

    <table class="print-wrapper">
        <thead><tr><td></td></tr></thead>
        <tfoot><tr><td></td></tr></tfoot>
        <tbody><tr><td>
            <div class="content-wrapper">
                ${showLetter ? `<div class="letter">${letterHtml}</div>` : ''}
                ${summaryTableHtml}
                ${showSpreadsheet || showAnalyticalTable ? `
                    ${showLetter ? '<div style="page-break-before: always; border-top: 2px solid #333; margin-top: 30px; padding-top: 15px;"></div>' : ''}
                    <h3 style="font-size: 14px; margin-bottom: 10px; font-weight: bold;">
                        ${mode === 'SPREADSHEET' ? 'Planilha de Preços' : 'Planilha de Formação de Preços'}
                    </h3>
                    ${itemsTableHtml}
                    <div class="totals-clearfix"></div>
                ` : ''}
            </div>
        </td></tr></tbody>
    </table>
</body>
</html>`;
    }

    /**
     * Tabela completa de itens (mesma que exportServices, mas usando dados do Builder).
     */
    private buildItemsTable(items: ProposalItem[], totalValue: number, discountPct: number, validityDays: number): string {
        const rows = items.map((it, i) => {
            const peso = totalValue > 0 ? ((it.totalPrice || 0) / totalValue) * 100 : 0;
            return `<tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 4px 6px; text-align: center;">${it.itemNumber || i + 1}</td>
                <td style="padding: 4px 6px; text-align: justify; hyphens: auto;">${this.esc(it.description)}</td>
                <td style="padding: 4px 6px; text-align: center;">${it.brand || '-'}</td>
                <td style="padding: 4px 6px; text-align: center;">${it.model || '-'}</td>
                <td style="padding: 4px 6px; text-align: center; white-space: nowrap;">${it.unit}</td>
                <td style="padding: 4px 6px; text-align: center; white-space: nowrap;">${fmtNum(it.quantity)}</td>
                <td style="padding: 4px 6px; text-align: center;">${it.multiplier > 1 ? it.multiplier : '1'}</td>
                <td style="padding: 4px 6px; text-align: right; white-space: nowrap;">${fmt(it.unitPrice)}</td>
                <td style="padding: 4px 6px; text-align: right; font-weight: bold; white-space: nowrap;">${fmt(it.totalPrice)}</td>
                <td style="padding: 4px 6px; text-align: right; font-size: 0.8em; color: #555;">${peso.toFixed(1)}%</td>
            </tr>`;
        }).join('');

        return `<table class="items">
            <thead><tr>
                <th style="text-align:center; width: 35px;">Item</th>
                <th style="width: auto;">Descrição detalhada</th>
                <th style="text-align:center; width: 55px;">Marca</th>
                <th style="text-align:center; width: 55px;">Modelo</th>
                <th style="text-align:center; width: 35px;">Unid</th>
                <th style="text-align:center; width: 45px;">Qtd</th>
                <th style="text-align:center; width: 28px;">Mult.</th>
                <th style="text-align:right; width: 75px;">Unitário</th>
                <th style="text-align:right; width: 85px;">Total</th>
                <th style="text-align:right; width: 35px;">%</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <table class="totals"><tbody>
            <tr><th style="font-size: 1.1em;">TOTAL GLOBAL</th><td style="font-size: 1.1em; font-weight: bold;">${fmt(totalValue)}</td></tr>
            ${discountPct > 0 ? `<tr><th style="font-weight: normal; color: #555;">Desconto Linear</th><td style="font-weight: normal; color: #555;">${fmtNum(discountPct)}%</td></tr>` : ''}
            <tr><th style="font-weight: normal; color: #555;">Validade</th><td style="font-weight: normal; color: #555;">${validityDays} dias</td></tr>
        </tbody></table>`;
    }

    /**
     * Tabela resumida (para LETTER_WITH_SUMMARY).
     */
    private buildSummaryTable(items: ProposalItem[], totalValue: number, validityDays: number): string {
        if (items.length === 0) return '';

        const rows = items.map((it, i) =>
            `<tr>
                <td style="text-align: center;">${it.itemNumber || i + 1}</td>
                <td>${this.esc((it.description || '').substring(0, 80))}${(it.description || '').length > 80 ? '...' : ''}</td>
                <td style="text-align: center;">${it.unit}</td>
                <td style="text-align: center;">${fmtNum(it.quantity)}</td>
                <td style="text-align: right;">${fmt(it.totalPrice)}</td>
            </tr>`
        ).join('');

        return `<div style="margin: 20px 0; page-break-inside: avoid;">
            <h4 style="font-size: 12px; margin-bottom: 8px; color: #333;">Quadro Resumo dos Itens</h4>
            <table class="summary">
                <thead><tr>
                    <th style="width: 50px; text-align: center;">Item</th>
                    <th>Descrição</th>
                    <th style="width: 45px; text-align: center;">Unid</th>
                    <th style="width: 55px; text-align: center;">Qtd</th>
                    <th style="width: 90px; text-align: right;">Total</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div style="text-align: right; font-weight: bold; font-size: 12px; margin-top: 5px;">
                TOTAL: ${fmt(totalValue)} | Validade: ${validityDays} dias
            </div>
        </div>`;
    }

    /**
     * Escape HTML.
     */
    private esc(text: string): string {
        return (text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}
