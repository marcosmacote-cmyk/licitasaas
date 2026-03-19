/**
 * ══════════════════════════════════════════════════════════════
 * Exportador PDF — Composição de Preços Unitários
 *
 * Gera HTML formatado para impressão com quebra de página por item.
 * Suporta 3 modos: Composições apenas, Completa c/ composição, Completa s/ composição.
 * ══════════════════════════════════════════════════════════════
 */

import type { ProposalItem, CompanyProfile } from '../../../types';
import type { CostCompositionLine, CostGroupMeta } from './types';
import { COST_GROUP_META, getCostGroupMeta } from './types';
import { deserializeComposition, calculateCompositionTotals } from './compositionEngine';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (v: number) => v.toFixed(2) + '%';

export type CompositionExportMode = 'COMPOSITION_ONLY' | 'FULL_WITH_COMPOSITION' | 'FULL_WITHOUT_COMPOSITION';

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
 * Gera o HTML de composição de um único item
 */
function buildItemCompositionHtml(item: ProposalItem, bdi: number): string {
    const comp = deserializeComposition(item.costComposition, item.id);
    if (!comp.lines || comp.lines.length === 0) {
        return `
        <div class="comp-item">
            <div class="comp-header">
                <strong>Item ${item.itemNumber}:</strong> ${esc(item.description || '(sem descrição)')}
            </div>
            <div style="padding: 10px 15px; color: #888; font-style: italic;">
                Composição não elaborada para este item.
            </div>
        </div>`;
    }

    const totals = calculateCompositionTotals(comp.lines);

    // Group lines by category
    const categories: { label: string, category: string, groups: CostGroupMeta[], color: string }[] = [
        { label: 'Custos Diretos', category: 'DIRETO', groups: COST_GROUP_META.filter(g => g.category === 'DIRETO'), color: '#2563eb' },
        { label: 'Custos Indiretos', category: 'INDIRETO', groups: COST_GROUP_META.filter(g => g.category === 'INDIRETO'), color: '#7c3aed' },
        { label: 'Tributos', category: 'TRIBUTO', groups: COST_GROUP_META.filter(g => g.category === 'TRIBUTO'), color: '#dc2626' },
        { label: 'Lucro / Benefício', category: 'LUCRO', groups: COST_GROUP_META.filter(g => g.category === 'LUCRO'), color: '#16a34a' },
    ];

    let rowsHtml = '';
    for (const cat of categories) {
        const catLines = comp.lines.filter((l: CostCompositionLine) =>
            cat.groups.some(g => g.key === l.group)
        );
        if (catLines.length === 0) continue;

        const catTotal = catLines.reduce((s: number, l: CostCompositionLine) => s + l.totalValue, 0);
        const catPct = totals.grandTotal > 0 ? (catTotal / totals.grandTotal * 100) : 0;

        // Category header row
        rowsHtml += `<tr class="cat-header" style="background: ${cat.color}08; border-top: 2px solid ${cat.color}40;">
            <td colspan="4" style="font-weight: 700; color: ${cat.color}; padding: 5px 8px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em;">
                ${cat.label}
            </td>
            <td style="text-align: right; font-weight: 700; color: ${cat.color}; padding: 5px 8px;">${fmt(catTotal)}</td>
            <td style="text-align: right; font-weight: 600; color: ${cat.color}; padding: 5px 8px; font-size: 9px;">${fmtPct(catPct)}</td>
        </tr>`;

        // Individual lines within category
        for (const line of catLines) {
            const meta = getCostGroupMeta(line.group);
            const linePct = totals.grandTotal > 0 ? (line.totalValue / totals.grandTotal * 100) : 0;
            rowsHtml += `<tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 3px 8px 3px 20px; color: #555; font-size: 9px;">${meta.label}</td>
                <td style="padding: 3px 6px;">${esc(line.description)}</td>
                <td style="padding: 3px 6px; text-align: center;">${line.unit}</td>
                <td style="padding: 3px 6px; text-align: right;">${fmtNum(line.quantity)}</td>
                <td style="padding: 3px 6px; text-align: right;">${fmt(line.totalValue)}</td>
                <td style="padding: 3px 6px; text-align: right; font-size: 9px; color: #666;">${fmtPct(linePct)}</td>
            </tr>`;
        }
    }

    return `
    <div class="comp-item">
        <div class="comp-header">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                    <strong>Item ${item.itemNumber}:</strong> ${esc((item.description || '').substring(0, 120))}
                </div>
                <div style="text-align: right; white-space: nowrap; margin-left: 15px;">
                    <div style="font-size: 9px; color: #666;">Preço Unit. Planilha</div>
                    <div style="font-weight: 700; color: #2563eb;">${fmt(item.unitPrice)}</div>
                </div>
            </div>
            <div style="font-size: 9px; color: #888; margin-top: 3px;">
                Unid: ${item.unit} | Qtd: ${fmtNum(item.quantity)} | Custo: ${fmt(item.unitCost)} | BDI: ${fmtPct(bdi)}
            </div>
        </div>
        <table class="comp-table">
            <thead>
                <tr>
                    <th style="width: 120px;">Grupo</th>
                    <th>Descrição</th>
                    <th style="width: 50px; text-align: center;">Unid</th>
                    <th style="width: 65px; text-align: right;">Coeficiente</th>
                    <th style="width: 80px; text-align: right;">Valor</th>
                    <th style="width: 50px; text-align: right;">%</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
            <tfoot>
                <tr class="total-row">
                    <td colspan="4" style="text-align: right; font-weight: 700; padding: 6px 8px; border-top: 2px solid #333;">TOTAL DA COMPOSIÇÃO</td>
                    <td style="text-align: right; font-weight: 700; padding: 6px 8px; border-top: 2px solid #333; color: #2563eb;">${fmt(totals.grandTotal)}</td>
                    <td style="text-align: right; font-weight: 700; padding: 6px 8px; border-top: 2px solid #333;">100%</td>
                </tr>
                <tr style="font-size: 9px; color: #666;">
                    <td colspan="3" style="padding: 3px 8px;">BDI Implícito: ${fmtPct(totals.bdiImplicit)}</td>
                    <td colspan="3" style="text-align: right; padding: 3px 8px;">
                        Direto: ${fmt(totals.totalDirect)} | Indireto: ${fmt(totals.totalIndirect)} | Tributos: ${fmt(totals.totalTaxes)} | Lucro: ${fmt(totals.profit)}
                    </td>
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

    const topMargin = headerImage ? (headerImageHeight + 20) : 80;
    const bottomMargin = footerImage ? (footerImageHeight + 30) : 60;

    // Build all item compositions
    const compositionsHtml = items.map(item => buildItemCompositionHtml(item, bdi)).join('');

    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Composição de Preços Unitários${processNumber ? ' - ' + processNumber : ''}</title>
    <style>
        body { font-family: 'Arial', sans-serif; color: #111; line-height: 1.3; font-size: 10px; margin: 0; padding: 0; }
        .fixed-header { position: fixed; top: 0; left: 0; right: 0; text-align: center; background: #fff; z-index: 100; padding: 0; }
        .fixed-header img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
        .fixed-footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; background: #fff; z-index: 100; padding: 0; }
        .fixed-footer img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
        .fixed-footer .gen-info { font-size: 7px; color: #bbb; margin-top: 2px; }
        
        table.print-wrapper { width: 100%; border: none; border-collapse: collapse; }
        table.print-wrapper > thead > tr > td { height: ${topMargin}px; border: none; padding: 0; }
        table.print-wrapper > tfoot > tr > td { height: ${bottomMargin}px; border: none; padding: 0; }
        table.print-wrapper > tbody > tr > td { border: none; padding: 0; vertical-align: top; }
        
        .content-wrapper { padding: 5px 15px; }
        
        .page-title {
            font-size: 14px; font-weight: 700; text-align: center; margin-bottom: 5px;
            color: #1e3a5f; text-transform: uppercase; letter-spacing: 0.05em;
            border-bottom: 2px solid #2563eb; padding-bottom: 8px;
        }
        .page-subtitle { font-size: 10px; text-align: center; color: #666; margin-bottom: 15px; }
        
        .comp-item {
            margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px;
            overflow: hidden; page-break-inside: avoid;
        }
        .comp-header {
            background: #f8fafc; padding: 8px 12px; border-bottom: 1px solid #ddd;
            font-size: 10px; line-height: 1.4;
        }
        .comp-table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
        .comp-table th {
            background: #f1f5f9; border-bottom: 2px solid #cbd5e1;
            padding: 5px 8px; font-size: 8px; font-weight: 700;
            text-transform: uppercase; letter-spacing: 0.04em; color: #475569;
        }
        .comp-table td { padding: 3px 6px; font-size: 9.5px; }
        
        @media print {
            @page {
                size: ${printLandscape ? 'landscape' : 'portrait'};
                margin: ${printLandscape ? '0.3cm 0.5cm' : '0.5cm 0.8cm'};
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
            : `<div style="border-bottom: 2px solid #222; padding: 15px 0; margin: 0 40px;">
                <h1 style="margin: 0; font-size: 18px;">${esc(company?.razaoSocial || 'EMPRESA')}</h1>
                <p style="margin: 3px 0; font-weight: bold; font-size: 11px;">CNPJ: ${company?.cnpj || '-'}</p>
               </div>`
        }
    </div>

    <div class="fixed-footer">
        ${footerImage
            ? `<img src="${footerImage}" alt="Rodapé" style="max-height: ${footerImageHeight}px;" />`
            : `<div style="border-top: 1px solid #ddd; padding: 8px 0; font-size: 9px; color: #444; margin: 0 40px;">
                ${esc(company?.address || company?.razaoSocial || '')}
               </div>`
        }
        <div class="gen-info">Documento gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}.</div>
    </div>

    <table class="print-wrapper">
        <thead><tr><td></td></tr></thead>
        <tfoot><tr><td></td></tr></tfoot>
        <tbody><tr><td>
            <div class="content-wrapper">
                <div class="page-title">Composição de Preços Unitários</div>
                ${processTitle ? `<div class="page-subtitle">${esc(processTitle)}${processNumber ? ' — ' + esc(processNumber) : ''}</div>` : ''}
                
                ${compositionsHtml}
                
                <!-- Summary footer -->
                <div style="margin-top: 15px; padding: 8px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 9px; color: #64748b; page-break-inside: avoid;">
                    <strong>${items.length}</strong> item(ns) | 
                    <strong>${items.filter(i => {
                        try { const c = JSON.parse(i.costComposition || '{}'); return c.lines?.length > 0; } catch { return false; }
                    }).length}</strong> com composição detalhada |
                    BDI referência: <strong>${fmtPct(bdi)}</strong>
                </div>
            </div>
        </td></tr></tbody>
    </table>
</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    return printWindow;
}

function esc(text: string): string {
    return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
