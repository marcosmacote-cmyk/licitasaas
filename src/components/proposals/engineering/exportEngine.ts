/**
 * exportEngine.ts — Motor de Exportação Excel/PDF para Engenharia
 * 
 * Gera CSV (compatível Excel) e PDF (via canvas/HTML) para:
 * 1. Hub de Insumos consolidado
 * 2. Composição individual (CPU)
 * 3. Planilha orçamentária completa
 */
import type { InsumoConsolidado, InsumoCategoria, InsumoHubStats, DescontoConfig } from './insumoEngine';
import { CATEGORIA_META } from './insumoEngine';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number) => v.toFixed(2).replace('.', ',');
const fmtCoef = (v: number) => v.toFixed(4).replace('.', ',');
const BOM = '\uFEFF';
const SEP = ';';

// ═══════════════════════════════════════════════════════════
// EXCEL (CSV) EXPORTS
// ═══════════════════════════════════════════════════════════

function downloadCsv(content: string, filename: string) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Exporta Hub de Insumos consolidado em CSV (Excel)
 */
export function exportHubExcel(
    insumos: InsumoConsolidado[],
    stats: InsumoHubStats | null,
    descontoConfig: DescontoConfig,
) {
    const header = [
        'Classe ABC', 'Código', 'Descrição', 'Categoria', 'Unidade', 'Base',
        'Preço Original', 'Desconto (%)', 'Preço Final', 'Coef. Total',
        'Custo Total', 'Composições Vinculadas',
    ];

    const rows = insumos.map(ins => [
        ins.abcClass || '—',
        ins.codigo,
        `"${ins.descricao.replace(/"/g, '""')}"`,
        CATEGORIA_META[ins.categoria]?.label || ins.categoria,
        ins.unidade,
        ins.base,
        fmtNum(ins.precoOriginal),
        fmtNum(ins.desconto),
        fmtNum(ins.precoFinal),
        fmtCoef(ins.coeficienteTotal),
        fmtNum(ins.custoTotal),
        `"${ins.composicoesVinculadas.join(', ')}"`,
    ]);

    // Summary rows
    rows.push([]);
    rows.push(['RESUMO DO HUB DE INSUMOS']);
    rows.push(['Total de Insumos', String(stats?.totalInsumos || insumos.length)]);
    rows.push(['Custo Total', fmtNum(stats?.totalCusto || 0)]);
    rows.push(['Custo Material', fmtNum(stats?.custoMaterial || 0)]);
    rows.push(['Custo Mão de Obra', fmtNum(stats?.custoMaoDeObra || 0)]);
    rows.push(['Custo Equipamento', fmtNum(stats?.custoEquipamento || 0)]);
    rows.push(['Custo Serviço', fmtNum(stats?.custoServico || 0)]);
    if (stats?.economiaTotalDesconto && stats.economiaTotalDesconto > 0) {
        rows.push(['Economia (Descontos)', fmtNum(stats.economiaTotalDesconto)]);
    }

    // Category discount summary
    rows.push([]);
    rows.push(['DESCONTOS CONFIGURADOS']);
    rows.push(['Global', `${fmtNum(descontoConfig.descontoGlobal)}%`]);
    for (const [cat, val] of Object.entries(descontoConfig.descontoPorCategoria)) {
        if (val > 0) rows.push([CATEGORIA_META[cat as InsumoCategoria]?.label || cat, `${fmtNum(val)}%`]);
    }

    const csv = BOM + [header.join(SEP), ...rows.map(r => r.join(SEP))].join('\n');
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `hub_insumos_${date}.csv`);
}

/**
 * Exporta composição individual (CPU) em CSV
 */
export function exportCompositionExcel(
    code: string,
    description: string,
    data: any,
) {
    if (!data?.groups) return;

    const header = ['Grupo', '#', 'Código', 'Descrição', 'Unidade', 'Coeficiente', 'Preço Unitário', 'Subtotal'];
    const rows: string[][] = [];

    const groupLabels: Record<string, string> = {
        MATERIAL: 'MATERIAL', MAO_DE_OBRA: 'MÃO DE OBRA',
        EQUIPAMENTO: 'EQUIPAMENTO', AUXILIAR: 'COMPOSIÇÃO AUXILIAR',
    };

    for (const [groupKey, groupLabel] of Object.entries(groupLabels)) {
        const items = data.groups[groupKey] || [];
        if (items.length === 0) continue;

        items.forEach((ci: any, idx: number) => {
            const itemData = ci.item || ci.auxiliaryComposition;
            rows.push([
                groupLabel,
                String(idx + 1),
                itemData?.code || '—',
                `"${(itemData?.description || '—').replace(/"/g, '""')}"`,
                itemData?.unit || '—',
                fmtCoef(ci.coefficient),
                fmtNum(itemData?.price || itemData?.totalPrice || 0),
                fmtNum(ci.price || 0),
            ]);
        });

        const groupTotal = items.reduce((s: number, ci: any) => s + (ci.price || 0), 0);
        rows.push(['', '', '', `SUBTOTAL ${groupLabel}`, '', '', '', fmtNum(groupTotal)]);
        rows.push([]);
    }

    rows.push(['', '', '', 'CUSTO UNITÁRIO DO SERVIÇO (S/ BDI)', '', '', '', fmtNum(data.totalPrice || data.totalDirect || 0)]);

    const csv = BOM + [
        `COMPOSIÇÃO DE PREÇOS UNITÁRIOS — ${code}`,
        `"${description}"`,
        '',
        header.join(SEP),
        ...rows.map(r => r.join(SEP)),
    ].join('\n');

    downloadCsv(csv, `cpu_${code}_${new Date().toISOString().slice(0, 10)}.csv`);
}

// ═══════════════════════════════════════════════════════════
// PDF EXPORTS (via HTML → print)
// ═══════════════════════════════════════════════════════════

function openPrintWindow(title: string, html: string) {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { alert('Habilite pop-ups para exportar PDF.'); return; }

    win.document.write(`<!DOCTYPE html>
<html><head><title>${title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10px; color: #1a1a2e; padding: 24px; }
  h1 { font-size: 14px; margin-bottom: 4px; }
  h2 { font-size: 12px; color: #2563eb; margin: 12px 0 6px; }
  .meta { font-size: 9px; color: #666; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { background: #f1f5f9; font-size: 8px; text-transform: uppercase; letter-spacing: 0.05em; padding: 5px 8px; text-align: left; border-bottom: 2px solid #e2e8f0; }
  td { padding: 4px 8px; border-bottom: 1px solid #f1f5f9; font-size: 9px; }
  .right { text-align: right; }
  .mono { font-family: 'Consolas', monospace; }
  .total-row { background: #f8fafc; font-weight: 700; }
  .grand-total { background: #2563eb; color: white; font-weight: 700; font-size: 11px; }
  .abc-a { color: #dc2626; font-weight: 700; }
  .abc-b { color: #d97706; font-weight: 600; }
  .abc-c { color: #16a34a; }
  .stats-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; margin-bottom: 16px; }
  .stat-card { border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px; text-align: center; }
  .stat-value { font-size: 14px; font-weight: 700; }
  .stat-label { font-size: 8px; color: #64748b; text-transform: uppercase; }
  .footer { margin-top: 16px; font-size: 8px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  @media print { body { padding: 12px; } .no-print { display: none; } }
</style>
</head><body>
${html}
<div class="footer">LicitaSaaS — Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}</div>
<div class="no-print" style="text-align:center;margin-top:16px;">
  <button onclick="window.print()" style="padding:8px 24px;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;">
    🖨️ Imprimir / Salvar PDF
  </button>
</div>
</body></html>`);
    win.document.close();
}

/**
 * Exporta Hub de Insumos como PDF (via print)
 */
export function exportHubPdf(
    insumos: InsumoConsolidado[],
    stats: InsumoHubStats | null,
) {
    const s = stats;
    const total = s?.totalCusto || 0;

    let html = `
<h1>Hub de Insumos — Relatório Consolidado</h1>
<div class="meta">Total: ${insumos.length} insumos · ${new Date().toLocaleDateString('pt-BR')}</div>

<div class="stats-grid">
  <div class="stat-card"><div class="stat-value" style="color:#2563eb">${fmt(s?.custoMaterial || 0)}</div><div class="stat-label">Material</div></div>
  <div class="stat-card"><div class="stat-value" style="color:#7c3aed">${fmt(s?.custoMaoDeObra || 0)}</div><div class="stat-label">Mão de Obra</div></div>
  <div class="stat-card"><div class="stat-value" style="color:#0891b2">${fmt(s?.custoEquipamento || 0)}</div><div class="stat-label">Equipamento</div></div>
  <div class="stat-card"><div class="stat-value" style="color:#059669">${fmt(s?.custoServico || 0)}</div><div class="stat-label">Serviço</div></div>
</div>

<table>
<thead><tr>
  <th style="width:30px">ABC</th><th>Código</th><th>Descrição</th><th>Cat.</th><th>Un.</th>
  <th class="right">Preço</th><th class="right">Desc.</th><th class="right">Final</th><th class="right">Coef.</th><th class="right">Custo Total</th>
</tr></thead><tbody>`;

    for (const ins of insumos) {
        const abcCls = ins.abcClass === 'A' ? 'abc-a' : ins.abcClass === 'B' ? 'abc-b' : 'abc-c';
        const catLabel = CATEGORIA_META[ins.categoria]?.label || ins.categoria;
        html += `<tr>
  <td class="${abcCls}">${ins.abcClass || '—'}</td>
  <td class="mono">${ins.codigo}</td>
  <td>${ins.descricao}</td>
  <td>${catLabel}</td>
  <td>${ins.unidade}</td>
  <td class="right">${fmt(ins.precoOriginal)}</td>
  <td class="right">${ins.desconto > 0 ? ins.desconto.toFixed(1) + '%' : '—'}</td>
  <td class="right">${fmt(ins.precoFinal)}</td>
  <td class="right mono">${ins.coeficienteTotal.toFixed(4)}</td>
  <td class="right" style="font-weight:600">${fmt(ins.custoTotal)}</td>
</tr>`;
    }

    html += `</tbody><tfoot>
<tr class="grand-total">
  <td colspan="9" style="text-align:right;padding:6px 8px">CUSTO TOTAL DO ORÇAMENTO</td>
  <td class="right" style="padding:6px 8px">${fmt(total)}</td>
</tr></tfoot></table>`;

    openPrintWindow('Hub de Insumos — LicitaSaaS', html);
}

/**
 * Exporta uma composição individual (CPU) como PDF
 */
export function exportCompositionPdf(
    code: string,
    description: string,
    data: any,
) {
    if (!data?.groups) return;

    const groupLabels: Record<string, { label: string; color: string }> = {
        MATERIAL: { label: 'Materiais', color: '#2563eb' },
        MAO_DE_OBRA: { label: 'Mão de Obra', color: '#16a34a' },
        EQUIPAMENTO: { label: 'Equipamentos', color: '#d97706' },
        AUXILIAR: { label: 'Composições Auxiliares', color: '#7c3aed' },
    };

    let html = `
<h1>CPU — Composição de Preços Unitários</h1>
<div class="meta">
  Código: <strong>${code}</strong>
  ${data.database ? ` · Base: ${data.database.name} ${data.database.uf || ''}` : ''}
</div>
<div style="margin-bottom:12px;font-size:11px;font-weight:600">${description}</div>`;

    for (const [groupKey, meta] of Object.entries(groupLabels)) {
        const items = data.groups[groupKey] || [];
        if (items.length === 0) continue;
        const groupTotal = items.reduce((s: number, ci: any) => s + (ci.price || 0), 0);

        html += `<h2 style="color:${meta.color}">${meta.label} (${items.length})</h2>
<table><thead><tr>
  <th style="width:30px">#</th><th>Código</th><th>Descrição</th><th>Un.</th>
  <th class="right">Coeficiente</th><th class="right">Preço Unit.</th><th class="right">Subtotal</th>
</tr></thead><tbody>`;

        items.forEach((ci: any, idx: number) => {
            const itemData = ci.item || ci.auxiliaryComposition;
            html += `<tr>
  <td>${idx + 1}</td>
  <td class="mono">${itemData?.code || '—'}</td>
  <td>${itemData?.description || '—'}</td>
  <td>${itemData?.unit || '—'}</td>
  <td class="right mono">${ci.coefficient.toFixed(4)}</td>
  <td class="right">${fmt(itemData?.price || itemData?.totalPrice || 0)}</td>
  <td class="right" style="font-weight:600;color:${meta.color}">${fmt(ci.price)}</td>
</tr>`;
        });

        html += `<tr class="total-row">
  <td colspan="6" style="text-align:right">Subtotal ${meta.label}</td>
  <td class="right" style="color:${meta.color}">${fmt(groupTotal)}</td>
</tr></tbody></table>`;
    }

    html += `
<table style="margin-top:8px"><tbody>
<tr class="grand-total">
  <td style="padding:8px">CUSTO UNITÁRIO DO SERVIÇO (S/ BDI)</td>
  <td class="right" style="padding:8px;font-size:13px">${fmt(data.totalPrice || data.totalDirect || 0)}</td>
</tr></tbody></table>`;

    openPrintWindow(`CPU ${code} — LicitaSaaS`, html);
}
