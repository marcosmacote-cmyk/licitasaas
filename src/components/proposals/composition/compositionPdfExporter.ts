/**
 * ══════════════════════════════════════════════════════════════
 * Exportador PDF — Composição de Preços Unitários
 *
 * Cada composição cabe em UMA ÚNICA PÁGINA (paisagem).
 * Descrição completa do item — sem truncar, sem esconder.
 * ══════════════════════════════════════════════════════════════
 */

import type { ProposalItem, CompanyProfile } from '../../../types';
import type { CostCompositionLine, CostGroupMeta } from './types';
import { COST_GROUP_META, getCostGroupMeta } from './types';
import { deserializeComposition, calculateCompositionTotals } from './compositionEngine';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (v: number) => v.toFixed(2) + '%';

export interface CompositionExportOptions {
    items: ProposalItem[];
    bdi: number;
    company?: CompanyProfile;
    headerImage?: string;
    footerImage?: string;
    headerImageHeight?: number;
    footerImageHeight?: number;
    printLandscape?: boolean;
    processTitle?: string;
    processNumber?: string;
}

/**
 * Gera o HTML de composição de um único item (compacto — cabe em 1 página)
 */
function buildItemCompositionHtml(item: ProposalItem, bdi: number, isLast: boolean): string {
    const comp = deserializeComposition(item.costComposition, item.id);
    if (!comp.lines || comp.lines.length === 0) {
        return `
        <div class="comp-item" ${!isLast ? 'style="page-break-after: always;"' : ''}>
            <div class="comp-header">
                <strong>Item ${item.itemNumber}:</strong> ${esc(item.description || '(sem descrição)')}
            </div>
            <div style="padding: 6px 10px; color: #888; font-style: italic; font-size: 8px;">
                Composição não elaborada para este item.
            </div>
        </div>`;
    }

    const totals = calculateCompositionTotals(comp.lines);

    // Group lines by category
    const categories: { label: string, groups: CostGroupMeta[], color: string }[] = [
        { label: 'CUSTOS DIRETOS', groups: COST_GROUP_META.filter(g => g.category === 'DIRETO'), color: '#2563eb' },
        { label: 'CUSTOS INDIRETOS', groups: COST_GROUP_META.filter(g => g.category === 'INDIRETO'), color: '#7c3aed' },
        { label: 'TRIBUTOS', groups: COST_GROUP_META.filter(g => g.category === 'TRIBUTO'), color: '#dc2626' },
        { label: 'LUCRO / BENEFÍCIO', groups: COST_GROUP_META.filter(g => g.category === 'LUCRO'), color: '#16a34a' },
    ];

    let rowsHtml = '';
    for (const cat of categories) {
        const catLines = comp.lines.filter((l: CostCompositionLine) =>
            cat.groups.some(g => g.key === l.group)
        );
        if (catLines.length === 0) continue;

        const catTotal = catLines.reduce((s: number, l: CostCompositionLine) => s + l.totalValue, 0);
        const catPct = totals.grandTotal > 0 ? (catTotal / totals.grandTotal * 100) : 0;

        // Category header
        rowsHtml += `<tr style="background: ${cat.color}08;">
            <td colspan="5" style="font-weight: 700; color: ${cat.color}; padding: 3px 6px; font-size: 7.5px; text-transform: uppercase; letter-spacing: 0.04em; border-top: 1.5px solid ${cat.color}30;">
                ${cat.label}
            </td>
            <td style="text-align: right; font-weight: 700; color: ${cat.color}; padding: 3px 6px; font-size: 8px; border-top: 1.5px solid ${cat.color}30;">${fmt(catTotal)}</td>
            <td style="text-align: right; font-weight: 600; color: ${cat.color}; padding: 3px 6px; font-size: 7.5px; border-top: 1.5px solid ${cat.color}30;">${fmtPct(catPct)}</td>
        </tr>`;

        for (const line of catLines) {
            const meta = getCostGroupMeta(line.group);
            const linePct = totals.grandTotal > 0 ? (line.totalValue / totals.grandTotal * 100) : 0;
            rowsHtml += `<tr>
                <td style="padding: 2px 6px 2px 14px; color: #555; font-size: 7.5px; white-space: nowrap;">${meta.label}</td>
                <td style="padding: 2px 4px; text-align: justify; hyphens: auto; word-break: break-word;">${esc(line.description)}</td>
                <td style="padding: 2px 4px; text-align: center; white-space: nowrap;">${line.unit}</td>
                <td style="padding: 2px 4px; text-align: right; white-space: nowrap;">${fmtNum(line.quantity)}</td>
                <td style="padding: 2px 4px; text-align: right; white-space: nowrap;">${fmt(line.unitValue)}</td>
                <td style="padding: 2px 4px; text-align: right; white-space: nowrap;">${fmt(line.totalValue)}</td>
                <td style="padding: 2px 4px; text-align: right; color: #555; white-space: nowrap;">${fmtPct(linePct)}</td>
            </tr>`;
        }
    }

    return `
    <div class="comp-item" ${!isLast ? 'style="page-break-after: always;"' : ''}>
        <div class="comp-header">
            <table style="width: 100%; border: none; border-collapse: collapse;">
                <tr>
                    <td style="padding: 0; vertical-align: top; border: none; text-align: justify; hyphens: auto; word-break: break-word;">
                        <strong>Item ${item.itemNumber}:</strong> ${esc(item.description || '')}
                    </td>
                    <td style="padding: 0 0 0 10px; vertical-align: top; text-align: right; white-space: nowrap; width: 120px; border: none;">
                        <span style="font-size: 7px; color: #888;">Preço Unit.</span><br/>
                        <strong style="color: #2563eb; font-size: 10px;">${fmt(item.unitPrice)}</strong>
                    </td>
                </tr>
            </table>
            <div style="font-size: 7.5px; color: #999; margin-top: 3px; padding-top: 2px; border-top: 1px dashed #e0e0e0;">
                Unid: <strong>${item.unit}</strong> | Qtd: <strong>${fmtNum(item.quantity)}</strong> | Custo Unit: <strong>${fmt(item.unitCost)}</strong> | BDI: <strong>${fmtPct(bdi)}</strong>
            </div>
        </div>
        <table class="comp-table">
            <thead>
                <tr>
                    <th style="width: 95px;">Grupo</th>
                    <th>Descrição</th>
                    <th style="width: 40px; text-align: center;">Unid</th>
                    <th style="width: 50px; text-align: right;">Coef.</th>
                    <th style="width: 65px; text-align: right;">Unit.</th>
                    <th style="width: 65px; text-align: right;">Valor</th>
                    <th style="width: 40px; text-align: right;">%</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot>
                <tr>
                    <td colspan="5" style="text-align: right; font-weight: 700; padding: 3px 6px; border-top: 2px solid #333;">TOTAL DA COMPOSIÇÃO</td>
                    <td style="text-align: right; font-weight: 700; padding: 3px 6px; border-top: 2px solid #333; color: #2563eb;">${fmt(totals.grandTotal)}</td>
                    <td style="text-align: right; font-weight: 700; padding: 3px 6px; border-top: 2px solid #333;">100%</td>
                </tr>
                <tr style="font-size: 7px; color: #888;">
                    <td colspan="4" style="padding: 2px 6px;">BDI Implícito: ${fmtPct(totals.bdiImplicit)} | Direto: ${fmt(totals.totalDirect)} | Indireto: ${fmt(totals.totalIndirect)} | Tributos: ${fmt(totals.totalTaxes)} | Lucro: ${fmt(totals.profit)}</td>
                    <td colspan="3"></td>
                </tr>
            </tfoot>
        </table>
    </div>`;
}

/**
 * Exporta composições para impressão (abre janela de print)
 */
export function exportCompositionPdf(options: CompositionExportOptions): Window | null {
    const {
        items, bdi, company,
        headerImage, footerImage,
        headerImageHeight = 150, footerImageHeight = 100,
        printLandscape = true,
        processTitle, processNumber,
    } = options;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        console.warn('[CompositionPdfExporter] Pop-up blocked.');
        return null;
    }

    const topMargin = headerImage ? (headerImageHeight + 15) : 70;
    const bottomMargin = footerImage ? (footerImageHeight + 25) : 50;

    // Build all item compositions
    const compositionsHtml = items.map((item, idx) =>
        buildItemCompositionHtml(item, bdi, idx === items.length - 1)
    ).join('');

    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Composição de Preços Unitários${processNumber ? ' - ' + processNumber : ''}</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: 'Arial', sans-serif; color: #111; line-height: 1.15; font-size: 8.5px; margin: 0; padding: 0; }
        .fixed-header { position: fixed; top: 0; left: 0; right: 0; text-align: center; background: #fff; z-index: 100; }
        .fixed-header img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
        .fixed-footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; background: #fff; z-index: 100; }
        .fixed-footer img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
        .fixed-footer .gen-info { font-size: 6px; color: #ccc; }
        
        table.print-wrapper { width: 100%; border: none; border-collapse: collapse; }
        table.print-wrapper > thead > tr > td { height: ${topMargin}px; border: none; padding: 0; }
        table.print-wrapper > tfoot > tr > td { height: ${bottomMargin}px; border: none; padding: 0; }
        table.print-wrapper > tbody > tr > td { border: none; padding: 0; vertical-align: top; }
        
        .content-wrapper { padding: 2px 10px; }
        
        .page-title {
            font-size: 11px; font-weight: 700; text-align: center; margin-bottom: 3px;
            color: #1e3a5f; text-transform: uppercase; letter-spacing: 0.04em;
            border-bottom: 1.5px solid #2563eb; padding-bottom: 4px;
        }
        .page-subtitle { font-size: 8px; text-align: center; color: #888; margin-bottom: 8px; }
        
        .comp-item {
            border: 1px solid #ddd; border-radius: 4px;
            overflow: hidden; margin-bottom: 6px;
        }
        .comp-header {
            background: #f8fafc; padding: 5px 10px; border-bottom: 1px solid #ddd;
            font-size: 8.5px; line-height: 1.3; text-align: justify; hyphens: auto; word-break: break-word;
        }
        .comp-table { width: 100%; border-collapse: collapse; font-size: 8px; }
        .comp-table th {
            background: #f1f5f9; border-bottom: 1.5px solid #cbd5e1;
            padding: 2px 6px; font-size: 7px; font-weight: 700;
            text-transform: uppercase; letter-spacing: 0.03em; color: #475569;
        }
        .comp-table td { padding: 2px 4px; font-size: 8px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
        
        @media print {
            @page {
                size: ${printLandscape ? 'landscape' : 'portrait'};
                margin: ${printLandscape ? '0.2cm 0.4cm' : '0.4cm 0.6cm'};
            }
            .comp-item { page-break-inside: avoid; }
        }
    </style>
</head>
<body>
    <script>window.onload = function() { setTimeout(function() { window.print(); }, 500); };</script>

    <div class="fixed-header">
        ${headerImage
            ? `<img src="${headerImage}" alt="Cabeçalho" style="max-height: ${headerImageHeight}px;" />`
            : `<div style="border-bottom: 1.5px solid #222; padding: 8px 0; margin: 0 30px;">
                <h1 style="margin: 0; font-size: 14px;">${esc(company?.razaoSocial || 'EMPRESA')}</h1>
                <p style="margin: 2px 0; font-weight: bold; font-size: 9px;">CNPJ: ${company?.cnpj || '-'}</p>
               </div>`
        }
    </div>

    <div class="fixed-footer">
        ${footerImage
            ? `<img src="${footerImage}" alt="Rodapé" style="max-height: ${footerImageHeight}px;" />`
            : `<div style="border-top: 1px solid #ddd; padding: 4px 0; font-size: 7px; color: #666; margin: 0 30px;">
                ${esc(company?.address || company?.razaoSocial || '')}
               </div>`
        }
        <div class="gen-info">Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}</div>
    </div>

    <table class="print-wrapper">
        <thead><tr><td></td></tr></thead>
        <tfoot><tr><td></td></tr></tfoot>
        <tbody><tr><td>
            <div class="content-wrapper">
                <div class="page-title">Composição de Preços Unitários</div>
                ${processTitle ? `<div class="page-subtitle">${esc(processTitle)}${processNumber ? ' — ' + esc(processNumber) : ''}</div>` : ''}
                
                ${compositionsHtml}
            </div>
        </td></tr></tbody>
    </table>
</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    return printWindow;
}

/**
 * Gera APENAS o HTML inline das composições (sem documento completo).
 * Para ser embutido dentro do LetterPdfExporter via compositionHtml.
 */
export function buildCompositionInlineHtml(items: ProposalItem[], bdi: number): string {
    const compositionsHtml = items.map((item, idx) =>
        buildItemCompositionHtml(item, bdi, idx === items.length - 1)
    ).join('');

    return `
    <style>
        .comp-item { border: 1px solid #ddd; border-radius: 4px; overflow: hidden; margin-bottom: 6px; }
        .comp-header { background: #f8fafc; padding: 5px 10px; border-bottom: 1px solid #ddd; font-size: 8.5px; line-height: 1.3; text-align: justify; hyphens: auto; word-break: break-word; }
        .comp-table { width: 100%; border-collapse: collapse; font-size: 8px; }
        .comp-table th { background: #f1f5f9; border-bottom: 1.5px solid #cbd5e1; padding: 2px 6px; font-size: 7px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #475569; }
        .comp-table td { padding: 2px 4px; font-size: 8px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
    </style>
    <h3 style="font-size: 11px; margin-bottom: 6px; font-weight: bold; text-align: center; color: #1e3a5f; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1.5px solid #2563eb; padding-bottom: 4px;">
        Composição de Preços Unitários
    </h3>
    ${compositionsHtml}`;
}

function esc(text: string): string {
    return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
