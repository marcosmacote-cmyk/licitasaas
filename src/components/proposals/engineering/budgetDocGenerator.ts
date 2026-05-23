/**
 * budgetDocGenerator.ts — Gerador do Caderno de Orçamento
 * 
 * Gera HTML profissional para impressão/PDF dos 8 documentos:
 * 1. Orçamento Resumido   5. Curva ABC Serviços
 * 2. Orçamento Sintético  6. Curva ABC Insumos
 * 3. Orçamento Analítico  7. Cronograma Físico-Financeiro
 * 4. CPU                  8. BDI e Encargos Sociais
 */
import type { BdiConfig, BdiTcuParams } from './bdiEngine';
import type { InsumoConsolidado } from './insumoEngine';
import { CATEGORIA_META } from './insumoEngine';
import type { CronogramaResult } from './cronogramaEngine';
import type { EngItem, EngineeringConfig, EncargosSociaisConfig, ColorPalette } from './types';
import { isGrouper, DEFAULT_COLOR_PALETTE } from './types';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v: number) => v.toFixed(2).replace('.', ',') + '%';
const fmtQty = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** Resolve a paleta de cores: user overrides > defaults */
function resolvePalette(reportConfig?: any): ColorPalette {
    return { ...DEFAULT_COLOR_PALETTE, ...(reportConfig?.colorPalette || {}) };
}

// ═══════════════════════════════════════════════════════════
// DYNAMIC CSS — reads from user color palette
// ═══════════════════════════════════════════════════════════
function buildCSS(palette: ColorPalette): string {
    return `
* { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; color-adjust:exact !important; }
body { font-family:'Segoe UI',Arial,sans-serif; font-size:10px; color:#1a1a2e; margin:0; padding:0; }
h1 { font-size:14px; margin-bottom:2px; color:#1e293b; text-transform:uppercase; letter-spacing:0.04em; }
h2 { font-size:11px; color:${palette.accent}; margin:14px 0 6px; border-bottom:2px solid ${palette.accent}; padding-bottom:3px; }
.meta { font-size:9px; color:#64748b; margin-bottom:14px; }
table { width:100%; border-collapse:collapse; margin-bottom:10px; page-break-inside:auto; }
tr { page-break-inside:avoid; }
thead { display:table-header-group; }
th { background:#e2e8f0; font-size:8px; text-transform:uppercase; letter-spacing:.04em; padding:5px 6px; text-align:left; border:1px solid #cbd5e1; color:#334155; font-weight:700; }
td { padding:4px 6px; border:1px solid #e2e8f0; font-size:9px; }
.r { text-align:right; font-variant-numeric:tabular-nums; }
.c { text-align:center; }
.mono { font-family:Consolas,'Courier New',monospace; font-variant-numeric:tabular-nums; }
.bold { font-weight:700; }
.total { background:${palette.subtotalBg}; font-weight:700; border-top:2px solid #cbd5e1; }
.grand { background:${palette.primary}; color:white; font-weight:700; font-size:10px; }
.abc-a { color:#dc2626; font-weight:700; }
.abc-b { color:#d97706; font-weight:600; }
.abc-c { color:#16a34a; }
.cover { page-break-after:always; display:flex; flex-direction:column; justify-content:center; align-items:center; min-height:80vh; text-align:center; }
.cover h1 { font-size:22px; margin-bottom:8px; }
.cover .meta { font-size:11px; }
.fixed-header { position:fixed; top:0; left:0; right:0; text-align:center; background:#fff; z-index:100; padding:0; }
.fixed-header img { max-width:100%; height:auto; display:block; margin:0 auto; }
.fixed-footer { position:fixed; bottom:0; left:0; right:0; text-align:center; background:#fff; z-index:100; padding:0; }
.fixed-footer img { max-width:100%; height:auto; display:block; margin:0 auto; }
table.print-wrapper { width:100%; border:none; border-collapse:collapse; }
table.print-wrapper > thead > tr > td { border:none; padding:0; }
table.print-wrapper > tfoot > tr > td { border:none; padding:0; }
table.print-wrapper > tbody > tr > td { border:none; padding:0; vertical-align:top; }
.content-wrapper { padding:2px 15px; }
.no-print { text-align:center; margin-top:12px; }
@media print {
  .no-print { display:none; }
  body { padding:0; }
}
`;
}

const CSS_LANDSCAPE = `@media print { @page { size:A4 landscape; } }`;
const CSS_PORTRAIT = `@media print { @page { size:A4 portrait; } }`;

export type DocMode = 'view' | 'download' | 'blob';

/** Build a complete standalone HTML document string with embedded CSS */
function buildFullHtmlDoc(title: string, bodyHtml: string, landscape: boolean = false, reportConfig?: any): string {
    const pageCss = landscape ? CSS_LANDSCAPE : CSS_PORTRAIT;
    const palette = resolvePalette(reportConfig);
    const css = buildCSS(palette);
    const rc = reportConfig || {};
    const now = new Date();
    const dataStr = now.toLocaleDateString('pt-BR');
    const horaStr = now.toLocaleTimeString('pt-BR');

    // ── Fixed Header (repeats on every printed page via position:fixed) ──
    const headerImgB64 = rc.headerImageBase64 || '';
    const headerImgH = rc.headerImageHeight || 80;
    let fixedHeaderContent = '';
    let topMargin = 20; // base margin when no header

    if (headerImgB64) {
        fixedHeaderContent = `<img src="${headerImgB64}" alt="Cabeçalho" style="max-height:${headerImgH}px;max-width:100%;object-fit:contain;" />`;
        topMargin = headerImgH + 16;
    } else {
        const logoBase64 = rc.logoBase64 || '';
        const logoPos = rc.logoPosition || 'left';
        const logoMaxH = rc.logoMaxHeight || 50;
        const logoHtml = logoBase64
            ? `<div style="text-align:${logoPos};margin-bottom:4px;"><img src="${logoBase64}" style="max-height:${logoMaxH}px;max-width:90%;object-fit:contain;" /></div>`
            : '';
        const hdrLines = [rc.headerLine1, rc.headerLine2, rc.headerLine3].filter(Boolean);
        const headerTextHtml = hdrLines.length > 0
            ? `<div style="text-align:center;">${hdrLines.map((l: string, i: number) => `<div style="font-size:${i === 0 ? '11px' : '8.5px'};font-weight:${i === 0 ? '700' : '400'};color:#334155;margin-bottom:1px;">${l}</div>`).join('')}</div>`
            : '';
        if (logoHtml || headerTextHtml) {
            fixedHeaderContent = `${logoHtml}${headerTextHtml}`;
            topMargin = (logoBase64 ? logoMaxH : 0) + (hdrLines.length * 14) + 16;
        }
    }

    const fixedHeaderHtml = fixedHeaderContent
        ? `<div class="fixed-header" style="border-bottom:1px solid #cbd5e1;padding:6px 15px 4px;">${fixedHeaderContent}</div>`
        : '';

    // ── Fixed Footer (repeats on every printed page via position:fixed) ──
    const footerImgB64 = rc.footerImageBase64 || '';
    const footerImgH = rc.footerImageHeight || 60;
    let fixedFooterContent = '';
    let bottomMargin = 15; // base margin when no footer

    // Footer text lines — ONLY user-defined, no auto-generated notes
    const footL = rc.footerLine1 ? rc.footerLine1.replace('{data}', dataStr).replace('{hora}', horaStr) : '';
    const footR = rc.footerLine2 ? rc.footerLine2.replace('{pagina}', '').replace('{total}', '') : '';
    const hasFooterText = footL || footR;

    if (footerImgB64) {
        fixedFooterContent = `<img src="${footerImgB64}" alt="Rodapé" style="max-height:${footerImgH}px;max-width:100%;object-fit:contain;" />`;
        if (hasFooterText) {
            fixedFooterContent += `<div style="font-size:7.5px;color:#64748b;margin-top:3px;display:flex;justify-content:space-between;padding:0 4px;"><span>${footL}</span><span>${footR}</span></div>`;
        }
        bottomMargin = footerImgH + (hasFooterText ? 20 : 10);
    } else if (hasFooterText) {
        fixedFooterContent = `<div style="font-size:8px;color:#64748b;display:flex;justify-content:space-between;padding:0 4px;"><span>${footL}</span><span>${footR}</span></div>`;
        bottomMargin = 25;
    }

    const fixedFooterHtml = fixedFooterContent
        ? `<div class="fixed-footer" style="border-top:1px solid #cbd5e1;padding:4px 15px 6px;">${fixedFooterContent}</div>`
        : '';

    // ── Signature lines (end of document, not repeated) ──
    let sigHtml = '';
    if (rc.showSignatureLines) {
        const lines: string[] = [];
        if (rc.responsavelTecnico) lines.push(`<div style="text-align:center;margin-top:40px;"><div style="border-top:1px solid #334155;width:280px;margin:0 auto;padding-top:4px;font-size:8.5px;font-weight:600;">${rc.responsavelTecnico}${rc.registroCrea ? ` — ${rc.registroCrea}` : ''}</div><div style="font-size:7.5px;color:#64748b;">Responsável Técnico</div></div>`);
        if (rc.responsavelLegal) lines.push(`<div style="text-align:center;margin-top:30px;"><div style="border-top:1px solid #334155;width:280px;margin:0 auto;padding-top:4px;font-size:8.5px;font-weight:600;">${rc.responsavelLegal}</div><div style="font-size:7.5px;color:#64748b;">Representante Legal</div></div>`);
        sigHtml = lines.join('');
    }

    // ── General observation (end of document) ──
    const obsHtml = rc.observacaoGeral
        ? `<div style="margin-top:14px;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;font-size:8px;color:#475569;"><strong>Observação:</strong> ${rc.observacaoGeral}</div>`
        : '';

    // ── Assemble full HTML with table-trick for repeating header/footer ──
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}${pageCss}
@media print { @page { margin:${Math.max(topMargin + 5, 15)}px 12mm ${Math.max(bottomMargin + 5, 15)}px 12mm; } }</style></head><body>
${fixedHeaderHtml}
${fixedFooterHtml}
<table class="print-wrapper">
<thead><tr><td style="height:${topMargin}px;"></td></tr></thead>
<tfoot><tr><td style="height:${bottomMargin}px;"></td></tr></tfoot>
<tbody><tr><td>
<div class="content-wrapper">
${bodyHtml}
${obsHtml}
${sigHtml}
</div>
</td></tr></tbody>
</table>
<div class="no-print" style="padding:20px;"><button onclick="window.print()" style="padding:10px 28px;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px">Salvar como PDF</button></div>
</body></html>`;
}

/**
 * Unified document output — supports 3 modes:
 * - 'view': opens in new window for preview
 * - 'download': generates native PDF via jsPDF+html2canvas (direct download, no print dialog)
 * - 'blob': returns Blob for ZIP packaging (HTML format for maximum compatibility)
 */
function openDoc(title: string, html: string, landscape: boolean = false, reportConfig?: any, mode: DocMode = 'download'): Blob | void | Promise<Blob | void> {
    const fullHtml = buildFullHtmlDoc(title, html, landscape, reportConfig);
    
    if (mode === 'blob') {
        return import('./htmlToPdfEngine').then(({ htmlToPdf }) =>
            htmlToPdf({
                html: fullHtml,
                filename: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                orientation: landscape ? 'landscape' : 'portrait',
                output: 'blob',
            })
        ).catch(e => {
            console.error('Erro ao gerar PDF blob:', e);
            return new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
        });
    }
    
    if (mode === 'download') {
        // Native PDF generation — direct download, no print dialog
        return import('./htmlToPdfEngine').then(({ htmlToPdf }) =>
            htmlToPdf({
                html: fullHtml,
                filename: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                orientation: landscape ? 'landscape' : 'portrait',
            })
        ).catch(e => {
            console.error('Erro ao gerar PDF:', e);
            // Fallback: open in new window
            const w = window.open('', '_blank', 'width=1000,height=750');
            if (w) { w.document.write(fullHtml); w.document.close(); }
        });
    }
    
    // mode === 'view' — open in new window for preview
    const w = window.open('', '_blank', 'width=1000,height=750');
    if (!w) { alert('Habilite pop-ups para visualizar.'); return; }
    w.document.write(fullHtml);
    w.document.close();
}

// ═══════════════════════════════════════════════════════════
// API Cache — avoids duplicate analytical-report calls for Analítico + CPU
// ═══════════════════════════════════════════════════════════
const _analyticalCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 60_000; // 60s

async function fetchAnalyticalReport(proposalId: string, items: any[], bdi: number, engineeringConfig: any): Promise<any> {
    const key = proposalId;
    const cached = _analyticalCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

    const token = localStorage.getItem('token') || '';
    const res = await fetch(`/api/engineering/proposals/${proposalId}/analytical-report`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, bdi, engineeringConfig }),
    });
    if (!res.ok) throw new Error('Falha ao carregar relatório analítico');
    const data = await res.json();
    _analyticalCache.set(key, { data, ts: Date.now() });
    return data;
}

/** Invalidate analytical cache (call when items change) */
export function invalidateAnalyticalCache(proposalId?: string) {
    if (proposalId) _analyticalCache.delete(proposalId);
    else _analyticalCache.clear();
}

function renderConfigTable(engineeringConfig?: any) {
    if (!engineeringConfig) return '';
    // FIX B9: Render Data-Base, UF and Regime alongside existing fields
    const dataBase = engineeringConfig.dataBase || '—';
    const uf = engineeringConfig.ufReferencia || '—';
    const regime = engineeringConfig.regimeOneracao || '—';
    return `
<table style="margin-bottom: 14px; border: 1px solid #e2e8f0;">
  <tr>
    <td style="width: 15%; background: #f8fafc; font-weight: 600;">Obra</td>
    <td colspan="5">${engineeringConfig.objeto || '—'}</td>
  </tr>
  <tr>
    <td style="background: #f8fafc; font-weight: 600;">Bancos</td>
    <td>${engineeringConfig.basesConsideradas?.join(', ') || '—'}</td>
    <td style="background: #f8fafc; font-weight: 600;">Data-Base</td>
    <td>${dataBase}</td>
    <td style="background: #f8fafc; font-weight: 600;">UF</td>
    <td>${uf}</td>
  </tr>
  <tr>
    <td style="background: #f8fafc; font-weight: 600;">Regime</td>
    <td>${regime}</td>
    <td style="background: #f8fafc; font-weight: 600;">Encargos Sociais</td>
    <td colspan="3">${regime} (H: ${engineeringConfig.encargosSociais?.horista || 0}% / M: ${engineeringConfig.encargosSociais?.mensalista || 0}%)</td>
  </tr>
</table>`;
}

// Helper: Render the BDI tripé (Sem BDI / Valor do BDI / Com BDI)
function renderGlobalTotals(billable: EngItem[], bdi: number, reportConfig?: any) {
    if (reportConfig?.showBdiTripe === false) return '';
    const totalComBdi = billable.reduce((s, i) => s + i.totalPrice, 0);
    const totalSemBdi = billable.reduce((s, i) => s + (i.unitCost * i.quantity), 0);
    const valorBdi = totalComBdi - totalSemBdi;
    return `
<table style="margin-top:8px;">
  <tbody>
    <tr class="total"><td colspan="2" style="text-align:right; padding-right:12px;">VALOR GLOBAL SEM BDI</td><td class="r bold" style="width:180px;">${fmt(totalSemBdi)}</td></tr>
    <tr class="total"><td colspan="2" style="text-align:right; padding-right:12px;">VALOR DO BDI (${fmtPct(bdi)})</td><td class="r bold" style="width:180px;">${fmt(valorBdi)}</td></tr>
    <tr class="grand"><td colspan="2" style="text-align:right; padding-right:12px;">VALOR GLOBAL COM BDI</td><td class="r" style="width:180px; font-size:11px;">${fmt(totalComBdi)}</td></tr>
  </tbody>
</table>`;
}

function groupByChapter(items: EngItem[]) {
    const map = new Map<string, { items: EngItem[]; total: number; title: string }>();
    for (const it of items) {
        const prefix = it.itemNumber.split('.')[0] || '1';
        if (!map.has(prefix)) map.set(prefix, { items: [], total: 0, title: `Etapa ${prefix}` });
        const g = map.get(prefix)!;
        
        // FIX B1: Use isGrouper() to identify structural nodes (ETAPA/SUBETAPA)
        // and capture their real description as the chapter title.
        // Matches: "1" | "1.0" | "1.00" | "01" — any top-level grouper for this prefix.
        if (isGrouper(it.type as any)) {
            const depth = (it.itemNumber.match(/\./g) || []).length;
            // Only use top-level ETAPAs (depth 0 or 1) as chapter titles
            if (depth <= 1 && it.description) {
                g.title = `${prefix} — ${it.description}`;
            }
            continue; // Skip groupers from the items list
        }

        g.items.push(it);
        g.total += it.totalPrice;
    }
    return map;
}

// ═══════════════════════════════════════════════════════════
// 1. ORÇAMENTO RESUMIDO
// ═══════════════════════════════════════════════════════════
export function docOrcamentoResumido(items: EngItem[], bdi: number, engineeringConfig?: any, mode: DocMode = 'download') {
    const chapters = groupByChapter(items);
    // FIX B4: Only count billable items (not ETAPAs/SUBETAPAs)
    const billable = items.filter(i => !isGrouper(i.type as any));
    const total = billable.reduce((s, i) => s + i.totalPrice, 0);
    let rows = '';
    for (const [prefix, ch] of chapters) {
        const pct = total > 0 ? (ch.total / total * 100) : 0;
        rows += `<tr><td class="bold">${prefix}</td><td class="bold">${ch.title}</td><td class="r">${ch.items.length}</td><td class="r">${fmt(ch.total)}</td><td class="r">${fmtPct(pct)}</td></tr>`;
    }
    return openDoc('Orçamento Resumido', `
<h1>ORÇAMENTO RESUMIDO</h1>
<div class="meta">BDI: ${fmtPct(bdi)} · ${billable.length} itens</div>
${renderConfigTable(engineeringConfig)}
<table><thead><tr><th>Nº</th><th>Etapa</th><th class="r">Itens</th><th class="r">Valor (R$)</th><th class="r">%</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr class="grand"><td colspan="3">TOTAL GERAL</td><td class="r">${fmt(total)}</td><td class="r">100%</td></tr></tfoot></table>
${renderGlobalTotals(billable, bdi, engineeringConfig?.reportConfig)}`, false, engineeringConfig?.reportConfig, mode);
}

// ═══════════════════════════════════════════════════════════
// 2. ORÇAMENTO SINTÉTICO
// ═══════════════════════════════════════════════════════════
export function docOrcamentoSintetico(items: EngItem[], bdi: number, engineeringConfig?: any, mode: DocMode = 'download') {
    const rc = engineeringConfig?.reportConfig || {};
    const showCU = rc.showCustoUnit !== false;
    const showPU = rc.showPrecoUnit !== false;
    // FIX B4: Only count billable items
    const billable = items.filter(i => !isGrouper(i.type as any));
    const total = billable.reduce((s, i) => s + i.totalPrice, 0);
    const chapters = groupByChapter(items);
    let html = `<h1>ORÇAMENTO SINTÉTICO</h1><div class="meta">BDI: ${fmtPct(bdi)} · ${billable.length} itens</div>${renderConfigTable(engineeringConfig)}`;

    for (const [prefix, ch] of chapters) {
        html += `<h2>${ch.title}</h2>
<table><thead><tr><th>Item</th><th>Código</th><th>Base</th><th>Descrição</th><th>Un.</th><th class="r">Qtd.</th>${showCU ? '<th class="r">Custo Unit.</th>' : ''}${showPU ? '<th class="r">Preço Unit.</th>' : ''}<th class="r">Total</th></tr></thead><tbody>`;
        const colSpan = 6 + (showCU ? 1 : 0) + (showPU ? 1 : 0);
        for (const it of ch.items) {
            html += `<tr><td>${it.itemNumber}</td><td class="mono">${it.code}</td><td>${it.sourceName || '—'}</td><td>${it.description}</td><td class="c">${it.unit}</td><td class="r mono">${fmtQty(it.quantity)}</td>${showCU ? `<td class="r">${fmt(it.unitCost)}</td>` : ''}${showPU ? `<td class="r">${fmt(it.unitPrice)}</td>` : ''}<td class="r bold">${fmt(it.totalPrice)}</td></tr>`;
        }
        html += `<tr class="total"><td colspan="${colSpan}" class="r">Subtotal ${ch.title}</td><td class="r">${fmt(ch.total)}</td></tr></tbody></table>`;
    }
    html += `<table><tfoot><tr class="grand"><td colspan="${6 + (showCU ? 1 : 0) + (showPU ? 1 : 0)}" class="r">TOTAL GERAL DO ORÇAMENTO</td><td class="r">${fmt(total)}</td></tr></tfoot></table>`;
    html += renderGlobalTotals(billable, bdi, engineeringConfig?.reportConfig);
    return openDoc('Orçamento Sintético', html, false, engineeringConfig?.reportConfig, mode);
}

// ═══════════════════════════════════════════════════════════
// 5. CURVA ABC DE SERVIÇOS
// ═══════════════════════════════════════════════════════════
export function docCurvaAbcServicos(items: EngItem[], engineeringConfig?: any, mode: DocMode = 'download') {
    // FIX B8: Filter using isGrouper instead of unit check
    const validItems = items.filter(it => !isGrouper(it.type as any));
    const total = validItems.reduce((s, i) => s + i.totalPrice, 0);
    const sorted = [...validItems].sort((a, b) => b.totalPrice - a.totalPrice);
    let accum = 0;
    let rows = '';
    sorted.forEach((it, idx) => {
        accum += it.totalPrice;
        const pct = total > 0 ? (it.totalPrice / total * 100) : 0;
        const pctAccum = total > 0 ? (accum / total * 100) : 0;
        const cls = pctAccum <= 80 ? 'abc-a' : pctAccum <= 95 ? 'abc-b' : 'abc-c';
        const abc = pctAccum <= 80 ? 'A' : pctAccum <= 95 ? 'B' : 'C';
        rows += `<tr><td class="${cls}">${abc}</td><td>${idx+1}</td><td>${it.itemNumber}</td><td class="mono">${it.code}</td><td>${it.sourceName || '—'}</td><td>${it.description}</td><td class="r">${fmt(it.totalPrice)}</td><td class="r">${fmtPct(pct)}</td><td class="r bold">${fmtPct(pctAccum)}</td></tr>`;
    });
    return openDoc('Curva ABC de Serviços', `
<h1>CURVA ABC DE SERVIÇOS</h1>
<div class="meta">${validItems.length} serviços · Total: ${fmt(total)}</div>
${renderConfigTable(engineeringConfig)}
<table><thead><tr><th>ABC</th><th>#</th><th>Item</th><th>Código</th><th>Base</th><th>Descrição</th><th class="r">Valor</th><th class="r">%</th><th class="r">% Acum.</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr class="grand"><td colspan="6">TOTAL</td><td class="r">${fmt(total)}</td><td class="r">100%</td><td class="r">100%</td></tr></tfoot></table>`, false, engineeringConfig?.reportConfig, mode);
}

// ═══════════════════════════════════════════════════════════
// 6. CURVA ABC DE INSUMOS
// ═══════════════════════════════════════════════════════════
export function docCurvaAbcInsumos(insumos: InsumoConsolidado[], engineeringConfig?: any, mode: DocMode = 'download') {
    const total = insumos.reduce((s, i) => s + i.custoTotal, 0);
    const sorted = [...insumos].sort((a, b) => b.custoTotal - a.custoTotal);
    let accum = 0;
    let rows = '';
    sorted.forEach((ins, idx) => {
        accum += ins.custoTotal;
        const pct = total > 0 ? (ins.custoTotal / total * 100) : 0;
        const pctAccum = total > 0 ? (accum / total * 100) : 0;
        const cls = ins.abcClass === 'A' ? 'abc-a' : ins.abcClass === 'B' ? 'abc-b' : 'abc-c';
        rows += `<tr><td class="${cls}">${ins.abcClass||'—'}</td><td>${idx+1}</td><td class="mono">${ins.codigo}</td><td>${ins.descricao}</td><td>${CATEGORIA_META[ins.categoria]?.label||ins.categoria}</td><td class="c">${ins.unidade}</td><td class="r">${fmt(ins.precoFinal)}</td><td class="r">${fmt(ins.custoTotal)}</td><td class="r">${fmtPct(pct)}</td><td class="r bold">${fmtPct(pctAccum)}</td></tr>`;
    });
    return openDoc('Curva ABC de Insumos', `
<h1>CURVA ABC DE INSUMOS</h1>
<div class="meta">${insumos.length} insumos · Total: ${fmt(total)}</div>
${renderConfigTable(engineeringConfig)}
<table><thead><tr><th>ABC</th><th>#</th><th>Código</th><th>Descrição</th><th>Base</th><th>Cat.</th><th>Un.</th><th class="r">Preço</th><th class="r">Custo Total</th><th class="r">%</th><th class="r">% Acum.</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr class="grand"><td colspan="8">TOTAL</td><td class="r">${fmt(total)}</td><td class="r">100%</td><td class="r">100%</td></tr></tfoot></table>`, false, engineeringConfig?.reportConfig, mode);
}

// ═══════════════════════════════════════════════════════════
// 7. CRONOGRAMA FÍSICO-FINANCEIRO
// ═══════════════════════════════════════════════════════════
export function docCronograma(result: CronogramaResult, mode: DocMode = 'download') {
    const { meses, etapas, mensalTotal, acumulado, percentMensal, percentAcumulado, totalGlobal } = result;
    let headerCols = '<th>Etapa</th><th class="r">Valor</th>';
    for (let m = 0; m < meses; m++) headerCols += `<th class="r">Mês ${m+1}</th>`;
    headerCols += '<th class="r">Total</th>';

    let rows = '';
    for (const et of etapas) {
        // Etapa % of global total
        const etPctGlobal = totalGlobal > 0 ? (et.valorTotal / totalGlobal * 100) : 0;
        rows += `<tr><td class="bold">${et.nome}</td><td class="r">${fmt(et.valorTotal)}<div style="font-size:7px;color:#64748b;">${fmtPct(etPctGlobal)}</div></td>`;
        let etTotal = 0;
        for (let m = 0; m < meses; m++) {
            const v = et.valoresMensais[m] || 0;
            const pct = et.percentuais?.[m] || 0;
            etTotal += v;
            rows += `<td class="r">${v > 0 ? `${fmt(v)}<div style="font-size:7px;color:#64748b;">${fmtPct(pct)}</div>` : '—'}</td>`;
        }
        rows += `<td class="r bold">${fmt(etTotal)}</td></tr>`;
    }

    // Monthly totals
    rows += `<tr class="total"><td>TOTAL MENSAL</td><td></td>`;
    for (let m = 0; m < meses; m++) rows += `<td class="r">${fmt(mensalTotal[m])}</td>`;
    rows += `<td class="r">${fmt(totalGlobal)}</td></tr>`;

    // Percentage
    rows += `<tr class="total"><td>% MENSAL</td><td></td>`;
    for (let m = 0; m < meses; m++) rows += `<td class="r">${fmtPct(percentMensal[m])}</td>`;
    rows += `<td class="r">100%</td></tr>`;

    // Accumulated
    rows += `<tr class="total"><td>% ACUMULADO</td><td></td>`;
    for (let m = 0; m < meses; m++) rows += `<td class="r">${fmtPct(percentAcumulado[m])}</td>`;
    rows += `<td class="r">100%</td></tr>`;

    // FIX D5: Cronograma uses landscape orientation
    return openDoc('Cronograma Físico-Financeiro', `
<h1>CRONOGRAMA FÍSICO-FINANCEIRO</h1>
<div class="meta">${meses} meses · ${etapas.length} etapas · Total: ${fmt(totalGlobal)}</div>
${renderConfigTable((result as any).engineeringConfig)}
<table><thead><tr>${headerCols}</tr></thead><tbody>${rows}</tbody></table>`, true, (result as any).engineeringConfig?.reportConfig, mode);
}

// ═══════════════════════════════════════════════════════════
// 8. BDI E ENCARGOS SOCIAIS
// FIX BUG-04: Encargos agora são dinâmicos a partir do engineeringConfig
// ═══════════════════════════════════════════════════════════

/** Gera a tabela de encargos sociais a partir dos valores reais configurados */
function buildEncargosSociais(es: EncargosSociaisConfig, regime: string) {
    const isDesonerado = regime === 'DESONERADO';
    // Defaults SINAPI — usados quando os campos individuais não foram configurados
    const d = {
        a1_h: isDesonerado ? 0.00 : 20.00, a1_m: isDesonerado ? 0.00 : 20.00,
        a2_h: 1.50,  a2_m: 1.50,  a3_h: 1.00,  a3_m: 1.00,
        a4_h: 0.20,  a4_m: 0.20,  a5_h: 0.60,  a5_m: 0.60,
        a6_h: 2.50,  a6_m: 2.50,  a7_h: 3.00,  a7_m: 3.00,
        a8_h: 8.00,  a8_m: 8.00,  a9_h: 0.00,  a9_m: 0.00,
        b1_h: 17.84, b1_m: 0.00,  b2_h: 3.71,  b2_m: 0.00,
        b3_h: 0.87,  b3_m: 0.67,  b4_h: 10.80, b4_m: 8.33,
        b5_h: 0.07,  b5_m: 0.06,  b6_h: 0.72,  b6_m: 0.56,
        b7_h: 1.55,  b7_m: 0.00,  b8_h: 0.11,  b8_m: 0.08,
        b9_h: 8.71,  b9_m: 6.73,  b10_h: 0.03, b10_m: 0.03,
        c1_h: 5.40,  c1_m: 4.17,  c2_h: 0.13,  c2_m: 0.10,
        c3_h: 4.85,  c3_m: 3.75,  c4_h: 3.90,  c4_m: 3.01,
        c5_h: 0.45,  c5_m: 0.35,
        d1_h: 0.00,  d1_m: 0.00,  d2_h: 0.00,  d2_m: 0.00,
    };
    type DKey = keyof typeof d;
    const v = (key: DKey): number => {
        const cfgVal = (es as any)[key];
        return typeof cfgVal === 'number' ? cfgVal : d[key];
    };

    const grupoA = [
        { cod:'A1', item:'INSS',                                  h:v('a1_h'), m:v('a1_m') },
        { cod:'A2', item:'SESI',                                  h:v('a2_h'), m:v('a2_m') },
        { cod:'A3', item:'SENAI',                                 h:v('a3_h'), m:v('a3_m') },
        { cod:'A4', item:'INCRA',                                 h:v('a4_h'), m:v('a4_m') },
        { cod:'A5', item:'SEBRAE',                                h:v('a5_h'), m:v('a5_m') },
        { cod:'A6', item:'Salário Educação',                      h:v('a6_h'), m:v('a6_m') },
        { cod:'A7', item:'Seguro Contra Acidentes de Trabalho',   h:v('a7_h'), m:v('a7_m') },
        { cod:'A8', item:'FGTS',                                  h:v('a8_h'), m:v('a8_m') },
        { cod:'A9', item:'SECONCI',                               h:v('a9_h'), m:v('a9_m') },
    ];
    const grupoB = [
        { cod:'B1',  item:'Repouso Semanal Remunerado',           h:v('b1_h'),  m:v('b1_m')  },
        { cod:'B2',  item:'Feriados',                             h:v('b2_h'),  m:v('b2_m')  },
        { cod:'B3',  item:'Auxílio Enfermidade',                  h:v('b3_h'),  m:v('b3_m')  },
        { cod:'B4',  item:'13º Salário',                          h:v('b4_h'),  m:v('b4_m')  },
        { cod:'B5',  item:'Licença Paternidade',                  h:v('b5_h'),  m:v('b5_m')  },
        { cod:'B6',  item:'Faltas Justificadas',                  h:v('b6_h'),  m:v('b6_m')  },
        { cod:'B7',  item:'Dias de Chuvas',                       h:v('b7_h'),  m:v('b7_m')  },
        { cod:'B8',  item:'Auxílio Acidente de Trabalho',         h:v('b8_h'),  m:v('b8_m')  },
        { cod:'B9',  item:'Férias Gozadas',                       h:v('b9_h'),  m:v('b9_m')  },
        { cod:'B10', item:'Salário Maternidade',                  h:v('b10_h'), m:v('b10_m') },
    ];
    const grupoC = [
        { cod:'C1', item:'Aviso Prévio Indenizado',               h:v('c1_h'), m:v('c1_m') },
        { cod:'C2', item:'Aviso Prévio Trabalhado',               h:v('c2_h'), m:v('c2_m') },
        { cod:'C3', item:'Férias Indenizadas',                    h:v('c3_h'), m:v('c3_m') },
        { cod:'C4', item:'Depósito Rescisão Sem Justa Causa',     h:v('c4_h'), m:v('c4_m') },
        { cod:'C5', item:'Indenização Adicional',                 h:v('c5_h'), m:v('c5_m') },
    ];
    // D — Reincidências: usa config se disponível, senão recalcula
    const subAh = grupoA.reduce((s,i) => s+i.h, 0);
    const subBh = grupoB.reduce((s,i) => s+i.h, 0);
    const subAm = grupoA.reduce((s,i) => s+i.m, 0);
    const subBm = grupoB.reduce((s,i) => s+i.m, 0);
    const grupoD = [
        { cod:'D1', item:'Reincidência de Grupo A sobre Grupo B',
            h: v('d1_h') || Math.round(subAh*subBh/100*100)/100,
            m: v('d1_m') || Math.round(subAm*subBm/100*100)/100 },
        { cod:'D2', item:'Reinc. Grupo A s/ Aviso Prévio Trab. e FGTS s/ AP Ind.',
            h: v('d2_h'), m: v('d2_m') },
    ];
    return {
        horista: es.horista,
        mensalista: es.mensalista,
        groups: [
            { label:'Grupo A — Encargos Sociais Básicos',   items:grupoA },
            { label:'Grupo B — Encargos Trabalhistas',       items:grupoB },
            { label:'Grupo C — Encargos Rescisórios',        items:grupoC },
            { label:'Grupo D — Reincidências',               items:grupoD },
        ],
    };
}

/** Shared BDI HTML builder — TCU formula, tax breakdown, numeric demo */
function buildBdiHtml(tcu: any, isTcu: boolean, bdiEfetivo: number): string {
    let h = `<h2>Composição do BDI</h2>`;
    if (isTcu) {
        const ac = tcu.adminCentral, s = tcu.seguros, g = tcu.garantias, r = tcu.riscos;
        const df = tcu.despFinanceiras, l = tcu.lucro;
        const pis = tcu.pis || 0, cofins = tcu.cofins || 0, iss = tcu.iss || 0, csll = tcu.csll || 0, cprb = tcu.cprb || 0;
        const tribI = pis + cofins + iss + csll + cprb;

        // Formula reference
        h += `<div style="margin-bottom:10px;padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;">
<p style="font-size:9px;font-weight:700;color:#1e40af;margin-bottom:4px;">Fórmula TCU — Acórdão 2622/2013-Plenário</p>
<p style="font-size:9px;color:#334155;margin-bottom:6px;font-family:Consolas,'Courier New',monospace;">BDI = { (1 + AC + S + G + R) × (1 + DF) × (1 + L) / (1 − I) − 1 } × 100</p>
<p style="font-size:8px;color:#64748b;margin-bottom:2px;">Onde: AC = Adm. Central · S = Seguros · G = Garantias · R = Riscos · DF = Desp. Financeiras · L = Lucro · I = Tributos</p>
</div>`;

        // Components table
        const rows: [string, number, string][] = [
            ['Administração Central (AC)', ac, 'AC'],
            ['Seguros (S)', s, 'S'],
            ['Garantias (G)', g, 'G'],
            ['Riscos (R)', r, 'R'],
            ['Despesas Financeiras (DF)', df, 'DF'],
            ['Lucro / Remuneração (L)', l, 'L'],
        ];
        h += `<table><thead><tr><th>Componente</th><th>Sigla</th><th class="r">Valor (%)</th></tr></thead><tbody>`;
        for (const [label, val, sigla] of rows) h += `<tr><td>${label}</td><td class="c mono bold">${sigla}</td><td class="r">${fmtPct(val)}</td></tr>`;
        h += `</tbody></table>`;

        // Tax breakdown table
        h += `<h2 style="font-size:10px;color:#dc2626;">Detalhamento dos Tributos (I)</h2>`;
        h += `<table><thead><tr><th>Tributo</th><th class="r">Alíquota (%)</th></tr></thead><tbody>`;
        h += `<tr><td>PIS (Programa de Integração Social)</td><td class="r">${fmtPct(pis)}</td></tr>`;
        h += `<tr><td>COFINS (Contribuição p/ Financiamento da Seg. Social)</td><td class="r">${fmtPct(cofins)}</td></tr>`;
        h += `<tr><td>ISS (Imposto Sobre Serviços)</td><td class="r">${fmtPct(iss)}</td></tr>`;
        h += `<tr><td>CSLL (Contribuição Social sobre Lucro Líquido)</td><td class="r">${fmtPct(csll)}</td></tr>`;
        h += `<tr><td>CPRB (Contribuição Previdenciária sobre a Receita Bruta)</td><td class="r">${fmtPct(cprb)}</td></tr>`;
        h += `<tr class="total"><td class="r">Total Tributos (I = PIS + COFINS + ISS + CSLL + CPRB)</td><td class="r bold">${fmtPct(tribI)}</td></tr>`;
        h += `</tbody></table>`;

        // Numeric demonstration
        const acD = ac/100, sD = s/100, gD = g/100, rD = r/100, dfD = df/100, lD = l/100, iD = tribI/100;
        const p1 = (1 + acD + sD + gD + rD);
        const p2 = (1 + dfD);
        const p3 = (1 + lD);
        const p4 = (1 - iD);
        const bdiCalc = (p1 * p2 * p3 / p4 - 1) * 100;
        h += `<div style="margin-top:8px;padding:8px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;">
<p style="font-size:8.5px;font-weight:700;color:#1e40af;margin-bottom:4px;">Demonstração Numérica</p>
<p style="font-size:8px;color:#334155;font-family:Consolas,monospace;line-height:1.6;">
BDI = { (1 + ${(acD).toFixed(4)} + ${(sD).toFixed(4)} + ${(gD).toFixed(4)} + ${(rD).toFixed(4)}) × (1 + ${(dfD).toFixed(4)}) × (1 + ${(lD).toFixed(4)}) / (1 − ${(iD).toFixed(4)}) − 1 } × 100<br>
BDI = { ${p1.toFixed(4)} × ${p2.toFixed(4)} × ${p3.toFixed(4)} / ${p4.toFixed(4)} − 1 } × 100<br>
BDI = { ${(p1*p2*p3/p4).toFixed(4)} − 1 } × 100<br>
<strong style="font-size:9px;color:#1e40af;">BDI = ${bdiCalc.toFixed(2).replace('.', ',')}%</strong>
</p></div>`;

        // Final result
        h += `<table><tfoot><tr class="grand"><td>BDI CALCULADO (TCU)</td><td class="r">${fmtPct(bdiEfetivo)}</td></tr></tfoot></table>`;
    } else {
        h += `<table><tbody><tr class="grand"><td>BDI SIMPLIFICADO</td><td class="r">${fmtPct(bdiEfetivo)}</td></tr></tbody></table>`;
    }
    return h;
}

export function docBdiEncargos(config: BdiConfig, bdiEfetivo: number, engConfig?: EngineeringConfig, mode: DocMode = 'download') {
    const tcu = config.tcu;
    const isTcu = config.mode === 'TCU';
    const regime = engConfig?.regimeOneracao || 'DESONERADO';
    const esConfig = engConfig?.encargosSociais || { horista: 83.85, mensalista: 47.76 } as EncargosSociaisConfig;

    // ── BDI ──
    let bdiHtml = buildBdiHtml(tcu, isTcu, bdiEfetivo);

    // ── Encargos Sociais — valores reais configurados ──
    const esData = buildEncargosSociais(esConfig, regime);
    let esHtml = `<h2>Encargos Sociais sobre Mão de Obra</h2>`;
    esHtml += `<p style="font-size:8px;color:#64748b;margin-bottom:6px">Regime: <strong>${regime}</strong> | Horista: <strong>${esData.horista.toFixed(2)}%</strong> · Mensalista: <strong>${esData.mensalista.toFixed(2)}%</strong></p>`;

    let totalH = 0, totalM = 0;
    for (const g of esData.groups) {
        const subH = g.items.reduce((s,i) => s + (i.h||0), 0);
        const subM = g.items.reduce((s,i) => s + (i.m||0), 0);
        totalH += subH; totalM += subM;
        esHtml += `<h2 style="font-size:9px;color:#475569">${g.label}</h2>
<table><thead><tr><th>Cód</th><th>Descrição</th><th class="r">Horista %</th><th class="r">Mensalista %</th></tr></thead><tbody>`;
        for (const i of g.items) {
            esHtml += `<tr><td class="mono bold">${i.cod}</td><td>${i.item}</td><td class="r">${fmtPct(i.h||0)}</td><td class="r">${fmtPct(i.m||0)}</td></tr>`;
        }
        esHtml += `<tr class="total"><td colspan="2" class="r">Subtotal ${g.label.split(' — ')[0]}</td><td class="r">${fmtPct(subH)}</td><td class="r">${fmtPct(subM)}</td></tr></tbody></table>`;
    }
    esHtml += `<table><tfoot><tr class="grand"><td colspan="2">A + B + C + D =</td><td class="r">${fmtPct(totalH)}</td><td class="r">${fmtPct(totalM)}</td></tr></tfoot></table>`;

    return openDoc('BDI e Encargos Sociais', `<h1>BDI E ENCARGOS SOCIAIS</h1><div class="meta">Modo: ${config.mode} | Regime: ${regime}</div>${renderConfigTable(engConfig)}${bdiHtml}${esHtml}`, false, engConfig?.reportConfig, mode);
}

// Helper para renderizar Composição no padrão TCU
function renderComposition(comp: any, showQuantities: boolean = false, reportConfig?: any) {
    const rc = reportConfig || {};
    const showCoef = rc.showCoeficientes !== false;
    const showBanco = rc.showBancoOrigem !== false;

    // Grouping metadata
    const metadata = comp.metadata || {};
    const customGroupLabels = metadata.customGroupLabels || {};
    const groupOrder = metadata.groupOrder || [];
    const groupNotes = metadata.groupNotes || {};

    const GROUP_META_PDF: Record<string, { label: string; color: string }> = {
        MATERIAL: { label: 'Materiais', color: '#2563eb' },
        MAO_DE_OBRA: { label: 'Mão de Obra', color: '#16a34a' },
        EQUIPAMENTO: { label: 'Equipamentos', color: '#d97706' },
        SERVICO: { label: 'Serviços', color: '#0ea5e9' },
        AUXILIAR: { label: 'Composições Auxiliares', color: '#7c3aed' },
        OBSERVACAO: { label: 'Observações e Textos', color: '#64748b' },
    };

    // Separate items by group Key
    const itemsByGroup: Record<string, any[]> = {};
    for (const ci of comp.items || []) {
        let gKey = ci.groupKey;
        if (!gKey) {
            if (ci.type === 'MAO_DE_OBRA') gKey = 'MAO_DE_OBRA';
            else if (ci.type === 'MATERIAL') gKey = 'MATERIAL';
            else if (ci.type === 'EQUIPAMENTO') gKey = 'EQUIPAMENTO';
            else if (ci.type === 'COMPOSICAO_AUXILIAR' || ci.type === 'SERVICO') gKey = 'AUXILIAR';
            else gKey = 'OBSERVACAO';
        }
        if (!itemsByGroup[gKey]) itemsByGroup[gKey] = [];
        itemsByGroup[gKey].push(ci);
    }

    // Determine ordering
    const allKeys = new Set([
        ...Object.keys(GROUP_META_PDF),
        ...Object.keys(itemsByGroup)
    ]);
    const orderedKeys: string[] = [];
    if (groupOrder.length > 0) {
        for (const key of groupOrder) {
            if (allKeys.has(key)) {
                orderedKeys.push(key);
                allKeys.delete(key);
            }
        }
    }
    for (const key of allKeys) {
        orderedKeys.push(key);
    }

    let ch = `<div style="margin-bottom:15px; border:1px solid #e2e8f0; page-break-inside:avoid;">
        <div style="background:#f1f5f9; padding:6px; font-weight:bold; font-size:9px;">
            ${comp.itemNumbers?.length ? `<span style="background:#2563eb; color:white; padding:2px 7px; border-radius:3px; font-size:8px; margin-right:6px; font-weight:700;">${comp.itemNumbers.join(', ')}</span>` : ''}
            <span style="color:#2563eb;">${comp.code || 'N/A'}</span> — ${comp.description} <br>
            <span style="font-size:7.5px; font-weight:normal; color:#64748b;">Banco: ${comp.sourceName} · Unidade: ${comp.unit}</span>
        </div>`;

    for (const groupKey of orderedKeys) {
        const items = itemsByGroup[groupKey] || [];
        if (items.length === 0) continue;

        const defaultMeta = GROUP_META_PDF[groupKey] || { label: groupKey, color: '#64748b' };
        const label = customGroupLabels[groupKey] || defaultMeta.label;
        const color = defaultMeta.color;
        const groupTotal = items.reduce((s, ci) => s + (ci.totalPrice || 0), 0);

        ch += `<h4 style="color:${color}; font-size:8.5px; margin:10px 6px 4px; font-weight:700;">${label} (${items.length})</h4>
        <table style="width:100%; border-collapse:collapse; margin-bottom:6px;">
        <thead><tr><th>Tipo</th><th>Código</th>${showBanco ? '<th>Banco</th>' : ''}<th>Descrição</th><th class="c">Und</th>${showCoef ? '<th class="r">Coef.</th>' : ''}<th>Valor Unit</th><th class="r">Total</th></tr></thead>
        <tbody>`;

        for (const ci of items) {
            let tipo = 'Comp. Auxiliar';
            if (ci.type === 'MAO_DE_OBRA') tipo = 'Mão de Obra';
            else if (ci.type === 'MATERIAL') tipo = 'Material';
            else if (ci.type === 'EQUIPAMENTO') tipo = 'Equipamento';
            else if (ci.type === 'SERVICO') tipo = 'Serviço';
            else if (ci.type === 'OBSERVACAO') tipo = 'Observação';

            ch += `<tr>
                <td>${tipo}</td>
                <td class="mono">${ci.code || ''}</td>
                ${showBanco ? `<td>${ci.sourceName || ''}</td>` : ''}
                <td>${ci.description || '—'}</td>
                <td class="c">${ci.type === 'OBSERVACAO' ? '—' : (ci.unit || '')}</td>
                ${showCoef ? `<td class="r mono">${ci.type === 'OBSERVACAO' ? '—' : (ci.coefficientExpression ? `<span style="color:#64748b;font-size:8px">${ci.coefficientExpression.replace(/\*/g, '×')} = </span>${ci.coefficient.toFixed(7)}` : ci.coefficient.toFixed(7))}</td>` : ''}
                <td class="r">${ci.type === 'OBSERVACAO' ? '—' : fmt(ci.unitPrice || 0)}</td>
                <td class="r">${ci.type === 'OBSERVACAO' ? '—' : fmt(ci.totalPrice || 0)}</td>
            </tr>`;
        }

        ch += `<tr class="total-row" style="background:#f8fafc; font-weight:700;">
            <td colspan="${showBanco ? 5 : 4}" class="r" style="font-size:7.5px;">Subtotal ${label}</td>
            <td class="r" style="font-size:7.5px; color:${color};" colspan="${(showCoef ? 1 : 0) + 2}">${fmt(groupTotal)}</td>
        </tr>`;
        ch += `</tbody></table>`;

        const note = groupNotes[groupKey];
        if (note) {
            ch += `<div style="margin: -4px 0 10px 8px; font-size: 7.5px; font-style: italic; color: #475569; padding: 3px 6px; border-left: 2px solid ${color}; background: #f8fafc; page-break-inside: avoid; text-align: left;">
                <strong>Nota:</strong> ${note}
            </div>`;
        }
    }

    ch += `
    <div style="padding:6px; background:#f8fafc; font-size:8px; border-top:1px solid #e2e8f0; line-height: 1.4;">
        <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
            <div style="color:#475569;">
                MO sem LS => <b>${fmt(comp.totalMoSemLs || 0)}</b> &nbsp;&nbsp;&nbsp;&nbsp; 
                LS => <b>${fmt(comp.totalLs || 0)}</b> &nbsp;&nbsp;&nbsp;&nbsp; 
                MO com LS => <b>${fmt(comp.totalMoComLs || 0)}</b>
            </div>
        </div>
    </div>
    <div style="background:#1e40af; color:white; padding:7px 10px; font-size:9.5px; font-weight:700; display:flex; justify-content:space-between; align-items:center;">
        <span>CUSTO UNITÁRIO TOTAL</span>
        <span style="font-size:11px;">${fmt(comp.totalPrice || 0)}</span>
    </div>
    <div style="background:#f1f5f9; padding:5px 10px; font-size:8px; display:flex; justify-content:space-between; align-items:center; border:1px solid #e2e8f0; border-top:none;">
        <span style="color:#475569;">Valor do BDI => <b>${fmt(comp.valorBdi || 0)}</b></span>
        <span style="color:#1e40af; font-weight:700; font-size:8.5px;">Preço Unitário (com BDI) => ${fmt(comp.valorComBdi || 0)}</span>
    </div>
    ${showQuantities && comp.proposalQuantity ? `
    <div style="background:#eff6ff; padding:5px 10px; font-size:8.5px; font-weight:700; display:flex; justify-content:space-between; align-items:center; color:#1e40af; border:1px solid #bfdbfe; border-top:none;">
        <span>Quantidade: ${fmtQty(comp.proposalQuantity)}</span>
        <span style="font-size:9px;">PREÇO TOTAL => ${fmt(comp.proposalTotal || 0)}</span>
    </div>` : ''}
    ${comp.observacao ? `<div style="padding:5px 10px; font-size:7.5px; color:#475569; background:#fefce8; border:1px solid #fde68a; border-top:none;"><strong>Obs:</strong> ${comp.observacao}</div>` : ''}
    </div>`;
    return ch;
}

// ═══════════════════════════════════════════════════════════
// 3. ORÇAMENTO ANALÍTICO (Flattened TCU Standard - Only Principals)
// ═══════════════════════════════════════════════════════════
export async function docOrcamentoAnalitico(proposalId: string, items: EngItem[], bdi: number, engineeringConfig?: any, mode: DocMode = 'download') {
    // FIX B4: Only count billable items
    const billable = items.filter(i => !isGrouper(i.type as any));
    const total = billable.reduce((s, i) => s + i.totalPrice, 0);

    let html = `<h1>PLANILHA ORÇAMENTÁRIA ANALÍTICA</h1><div class="meta">BDI: ${fmtPct(bdi)} · ${billable.length} itens · Total: ${fmt(total)}</div>${renderConfigTable(engineeringConfig)}`;

    try {
        const report = await fetchAnalyticalReport(proposalId, items, bdi, engineeringConfig);

        // Inject compositionNotes from reportConfig
        const cNotes = engineeringConfig?.reportConfig?.compositionNotes || {};
        for (const comp of [...report.principalCompositions, ...report.auxiliaryCompositions]) {
            if (comp.code && cNotes[comp.code]) comp.observacao = cNotes[comp.code];
        }

        // FIX B6: Group compositions by etapa/chapter, using itemNumbers[0] for routing
        const chapters = groupByChapter(items);
        const compMap = new Map<string, any[]>();
        for (const comp of report.principalCompositions) {
            // Use first linked itemNumber to determine the chapter
            const firstItemNum = (comp.itemNumbers?.[0] || '');
            const prefix = firstItemNum.split('.')[0] || '?';
            if (!compMap.has(prefix)) compMap.set(prefix, []);
            compMap.get(prefix)!.push(comp);
        }

        // Sort each chapter's compositions by their first itemNumber (budget order)
        for (const [, chComps] of compMap) {
            chComps.sort((a: any, b: any) => {
                const na = a.itemNumbers?.[0] || '';
                const nb = b.itemNumbers?.[0] || '';
                return na.localeCompare(nb, 'pt-BR', { numeric: true });
            });
        }

        for (const [prefix, chapterComps] of compMap) {
            const ch = chapters.get(prefix);
            const chTitle = ch ? ch.title : `Etapa ${prefix}`;
            const chTotal = chapterComps.reduce((s: number, c: any) => s + (c.proposalTotal || 0), 0);
            html += `<h2 style="margin-top:20px;">${chTitle}</h2>`;
            for (const comp of chapterComps) {
                html += renderComposition(comp, true, engineeringConfig?.reportConfig);
            }
            html += `<div style="background:#f1f5f9; padding:6px 10px; font-weight:700; font-size:9px; text-align:right; border:1px solid #cbd5e1; margin-bottom:16px;">Subtotal ${chTitle}: ${fmt(chTotal)}</div>`;
        }
        
    } catch (e: any) {
        html += `<div style="color:#dc2626; font-size:10px;">Erro ao gerar relatório analítico: ${e.message}</div>`;
    }

    html += renderGlobalTotals(billable, bdi, engineeringConfig?.reportConfig);
    return openDoc('Planilha Orçamentária Analítica', html, false, engineeringConfig?.reportConfig, mode);
}

// ═══════════════════════════════════════════════════════════
// 4. CPU — COMPOSIÇÕES DE CUSTOS UNITÁRIOS (batch)
// ═══════════════════════════════════════════════════════════
export async function docCpuBatch(proposalId: string, items: EngItem[], bdi: number, engineeringConfig?: any, mode: DocMode = 'download') {
    // FIX B4/B7: Count only billable items and pass engineeringConfig to backend
    const billable = items.filter(i => !isGrouper(i.type as any));
    let html = `<h1>CADERNO DE COMPOSIÇÕES DE PREÇOS UNITÁRIOS</h1><div class="meta">${billable.length} serviços</div>${renderConfigTable(engineeringConfig)}`;

    try {
        const report = await fetchAnalyticalReport(proposalId, items, bdi, engineeringConfig);

        // Inject compositionNotes from reportConfig
        const cNotes = engineeringConfig?.reportConfig?.compositionNotes || {};
        for (const comp of [...report.principalCompositions, ...report.auxiliaryCompositions]) {
            if (comp.code && cNotes[comp.code]) comp.observacao = cNotes[comp.code];
        }

        html += `<div style="text-align:center; margin: 15px 0; font-size:12px; font-weight:bold; color:#1e40af;">Composições Principais</div>`;
        for (const comp of report.principalCompositions) {
            html += renderComposition(comp, false, engineeringConfig?.reportConfig);
        }

        if (report.auxiliaryCompositions.length > 0) {
            html += `<div style="text-align:center; margin: 25px 0 15px; font-size:12px; font-weight:bold; color:#7c3aed;">Composições Auxiliares</div>`;
            for (const comp of report.auxiliaryCompositions) {
                html += renderComposition(comp, false, engineeringConfig?.reportConfig);
            }
        }
        
    } catch (e: any) {
        html += `<div style="color:#dc2626; font-size:10px;">Erro ao gerar Caderno de Composições: ${e.message}</div>`;
    }

    return openDoc('Caderno de Composições', html, false, engineeringConfig?.reportConfig, mode);
}

// ═══════════════════════════════════════════════════════════
// 9. PROPOSTA COMPLETA — PDF UNIFICADO
// Combina múltiplas seções em um único documento.
// ═══════════════════════════════════════════════════════════
export type PropostaSectionId = 'resumido' | 'sintetico' | 'analitico' | 'cpu' | 'abc_servicos' | 'abc_insumos' | 'cronograma' | 'bdi' | 'memoria';

export interface PropostaCompletaParams {
    sections: PropostaSectionId[];
    items: EngItem[];
    bdi: number;
    insumos: InsumoConsolidado[];
    cronogramaResult?: CronogramaResult | null;
    bdiConfig: BdiConfig;
    proposalId: string;
    engineeringConfig?: EngineeringConfig;
    /** Pre-rendered Carta Proposta HTML (from LetterPdfExporter.buildHtml) */
    cartaHtml?: string;
    /** Output mode: view, download, or blob */
    mode?: DocMode;
}

export async function docPropostaCompleta(params: PropostaCompletaParams) {
    const { sections, items, bdi, insumos, cronogramaResult, bdiConfig, proposalId, engineeringConfig } = params;
    const rc = engineeringConfig?.reportConfig || {};
    const billable = items.filter(i => !isGrouper(i.type as any));
    const total = billable.reduce((s, i) => s + i.totalPrice, 0);
    const chapters = groupByChapter(items);
    const showCU = rc.showCustoUnit !== false;
    const showPU = rc.showPrecoUnit !== false;

    const parts: string[] = [];

    // ── Carta Proposta (optional, pre-built HTML) ──
    if (params.cartaHtml) {
        parts.push(params.cartaHtml);
    }

    // ── Orçamento Resumido ──
    if (sections.includes('resumido')) {
        let rows = '';
        for (const [prefix, ch] of chapters) {
            const pct = total > 0 ? (ch.total / total * 100) : 0;
            rows += `<tr><td class="bold">${prefix}</td><td class="bold">${ch.title}</td><td class="r">${ch.items.length}</td><td class="r">${fmt(ch.total)}</td><td class="r">${fmtPct(pct)}</td></tr>`;
        }
        parts.push(`<h1>ORÇAMENTO RESUMIDO</h1><div class="meta">BDI: ${fmtPct(bdi)} · ${billable.length} itens</div>${renderConfigTable(engineeringConfig)}
<table><thead><tr><th>Nº</th><th>Etapa</th><th class="r">Itens</th><th class="r">Valor (R$)</th><th class="r">%</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr class="grand"><td colspan="3">TOTAL GERAL</td><td class="r">${fmt(total)}</td><td class="r">100%</td></tr></tfoot></table>
${renderGlobalTotals(billable, bdi, rc)}`);
    }

    // ── Orçamento Sintético ──
    if (sections.includes('sintetico')) {
        let h = `<h1>ORÇAMENTO SINTÉTICO</h1><div class="meta">BDI: ${fmtPct(bdi)} · ${billable.length} itens</div>${renderConfigTable(engineeringConfig)}`;
        for (const [prefix, ch] of chapters) {
            h += `<h2>${ch.title}</h2>
<table><thead><tr><th>Item</th><th>Código</th><th>Base</th><th>Descrição</th><th>Un.</th><th class="r">Qtd.</th>${showCU ? '<th class="r">Custo Unit.</th>' : ''}${showPU ? '<th class="r">Preço Unit.</th>' : ''}<th class="r">Total</th></tr></thead><tbody>`;
            const colSpan = 6 + (showCU ? 1 : 0) + (showPU ? 1 : 0);
            for (const it of ch.items) {
                h += `<tr><td>${it.itemNumber}</td><td class="mono">${it.code}</td><td>${it.sourceName || '—'}</td><td>${it.description}</td><td class="c">${it.unit}</td><td class="r mono">${fmtQty(it.quantity)}</td>${showCU ? `<td class="r">${fmt(it.unitCost)}</td>` : ''}${showPU ? `<td class="r">${fmt(it.unitPrice)}</td>` : ''}<td class="r bold">${fmt(it.totalPrice)}</td></tr>`;
            }
            h += `<tr class="total"><td colspan="${colSpan}" class="r">Subtotal ${ch.title}</td><td class="r">${fmt(ch.total)}</td></tr></tbody></table>`;
        }
        h += `<table><tfoot><tr class="grand"><td colspan="${6 + (showCU ? 1 : 0) + (showPU ? 1 : 0)}" class="r">TOTAL GERAL DO ORÇAMENTO</td><td class="r">${fmt(total)}</td></tr></tfoot></table>`;
        h += renderGlobalTotals(billable, bdi, rc);
        parts.push(h);
    }

    // ── Memória de Cálculo ──
    if (sections.includes('memoria')) {
        let h = `<h1>RELATÓRIO DE MEMÓRIA DE CÁLCULO</h1><div class="meta">${billable.length} itens</div>${renderConfigTable(engineeringConfig)}`;
        let rowsHtml = '';
        for (const it of items) {
            if (isGrouper(it.type as any)) {
                if (rowsHtml) {
                    h += `<table><thead><tr><th>Item</th><th>Descrição</th><th>Un.</th><th>Detalhamento da Memória</th><th class="r">Quant/Mult</th><th class="r">Compr (m)</th><th class="r">Larg (m)</th><th class="r">Alt (m)</th><th class="r">Subtotal</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
                    rowsHtml = '';
                }
                h += `<h2>${it.itemNumber} — ${it.description}</h2>`;
                continue;
            }
            const hasCalc = !!(it.calculationMemory && it.calculationMemory.trim() !== '');
            let calcObj: any = null;
            if (hasCalc && it.calculationMemory) {
                try { calcObj = JSON.parse(it.calculationMemory); } catch (e) {}
            }
            if (!calcObj) {
                rowsHtml += `<tr>
                    <td>${it.itemNumber}</td>
                    <td>${it.description}</td>
                    <td class="c">${it.unit || '—'}</td>
                    <td>Quantidade direta (sem memória cadastrada)</td>
                    <td class="r">1,00</td>
                    <td class="r">—</td>
                    <td class="r">—</td>
                    <td class="r">—</td>
                    <td class="r bold">${fmtQty(it.quantity)}</td>
                </tr>`;
            } else if (calcObj.mode === 'SIMPLE') {
                rowsHtml += `<tr>
                    <td>${it.itemNumber}</td>
                    <td>${it.description}</td>
                    <td class="c">${it.unit || '—'}</td>
                    <td>Fórmula: <code class="mono">${calcObj.formula}</code></td>
                    <td class="r">1,00</td>
                    <td class="r">—</td>
                    <td class="r">—</td>
                    <td class="r">—</td>
                    <td class="r bold">${fmtQty(it.quantity)}</td>
                </tr>`;
            } else if (calcObj.mode === 'STRUCTURED' && Array.isArray(calcObj.rows)) {
                const calcRows = calcObj.rows;
                calcRows.forEach((row: any, rIdx: number) => {
                    rowsHtml += `<tr>
                        <td>${rIdx === 0 ? it.itemNumber : ''}</td>
                        <td>${rIdx === 0 ? it.description : ''}</td>
                        <td class="c">${rIdx === 0 ? (it.unit || '—') : ''}</td>
                        <td>${row.description || `Linha ${rIdx + 1}`}</td>
                        <td class="r">${fmtQty(Number(row.multiplier) || 0)}</td>
                        <td class="r">${row.length ? fmtQty(Number(row.length)) : '—'}</td>
                        <td class="r">${row.width ? fmtQty(Number(row.width)) : '—'}</td>
                        <td class="r">${row.height ? fmtQty(Number(row.height)) : '—'}</td>
                        <td class="r bold">${fmtQty(Number(row.subtotal) || 0)}</td>
                    </tr>`;
                });
            }
        }
        if (rowsHtml) {
            h += `<table><thead><tr><th>Item</th><th>Descrição</th><th>Un.</th><th>Detalhamento da Memória</th><th class="r">Quant/Mult</th><th class="r">Compr (m)</th><th class="r">Larg (m)</th><th class="r">Alt (m)</th><th class="r">Subtotal</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
        }
        parts.push(h);
    }


    // ── Orçamento Analítico ──
    if (sections.includes('analitico')) {
        let h = `<h1>PLANILHA ORÇAMENTÁRIA ANALÍTICA</h1><div class="meta">BDI: ${fmtPct(bdi)} · ${billable.length} itens · Total: ${fmt(total)}</div>${renderConfigTable(engineeringConfig)}`;
        try {
            const token = localStorage.getItem('token') || '';
            const res = await fetch(`/api/engineering/proposals/${proposalId}/analytical-report`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ items, bdi, engineeringConfig })
            });
            if (!res.ok) throw new Error('Falha ao carregar relatório analítico');
            const report = await res.json();
            const cNotes = rc.compositionNotes || {};
            for (const comp of [...report.principalCompositions, ...report.auxiliaryCompositions]) {
                if (comp.code && cNotes[comp.code]) comp.observacao = cNotes[comp.code];
            }
            const compMap = new Map<string, any[]>();
            for (const comp of report.principalCompositions) {
                const prefix = (comp.itemNumbers?.[0] || '').split('.')[0] || '?';
                if (!compMap.has(prefix)) compMap.set(prefix, []);
                compMap.get(prefix)!.push(comp);
            }
            for (const [, chComps] of compMap) {
                chComps.sort((a: any, b: any) => (a.itemNumbers?.[0] || '').localeCompare(b.itemNumbers?.[0] || '', 'pt-BR', { numeric: true }));
            }
            for (const [prefix, chComps] of compMap) {
                const ch = chapters.get(prefix);
                const chTitle = ch ? ch.title : `Etapa ${prefix}`;
                h += `<h2 style="margin-top:20px;">${chTitle}</h2>`;
                for (const comp of chComps) h += renderComposition(comp, true, rc);
                const chTotal = chComps.reduce((s: number, c: any) => s + (c.proposalTotal || 0), 0);
                h += `<div style="background:#f1f5f9; padding:6px 10px; font-weight:700; font-size:9px; text-align:right; border:1px solid #cbd5e1; margin-bottom:16px;">Subtotal ${chTitle}: ${fmt(chTotal)}</div>`;
            }
        } catch (e: any) {
            h += `<div style="color:#dc2626; font-size:10px;">Erro ao gerar relatório analítico: ${e.message}</div>`;
        }
        h += renderGlobalTotals(billable, bdi, rc);
        parts.push(h);
    }

    // ── CPU — Composições ──
    if (sections.includes('cpu')) {
        let h = `<h1>CADERNO DE COMPOSIÇÕES DE PREÇOS UNITÁRIOS</h1><div class="meta">${billable.length} serviços</div>${renderConfigTable(engineeringConfig)}`;
        try {
            const token = localStorage.getItem('token') || '';
            const res = await fetch(`/api/engineering/proposals/${proposalId}/analytical-report`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ items, bdi, engineeringConfig })
            });
            if (!res.ok) throw new Error('Falha ao carregar relatório analítico');
            const report = await res.json();
            const cNotes = rc.compositionNotes || {};
            for (const comp of [...report.principalCompositions, ...report.auxiliaryCompositions]) {
                if (comp.code && cNotes[comp.code]) comp.observacao = cNotes[comp.code];
            }
            h += `<div style="text-align:center; margin: 15px 0; font-size:12px; font-weight:bold; color:#1e40af;">Composições Principais</div>`;
            for (const comp of report.principalCompositions) h += renderComposition(comp, false, rc);
            if (report.auxiliaryCompositions.length > 0) {
                h += `<div style="text-align:center; margin: 25px 0 15px; font-size:12px; font-weight:bold; color:#7c3aed;">Composições Auxiliares</div>`;
                for (const comp of report.auxiliaryCompositions) h += renderComposition(comp, false, rc);
            }
        } catch (e: any) {
            h += `<div style="color:#dc2626; font-size:10px;">Erro ao gerar Caderno de Composições: ${e.message}</div>`;
        }
        parts.push(h);
    }

    // ── Curva ABC de Serviços ──
    if (sections.includes('abc_servicos')) {
        const validItems = items.filter(it => !isGrouper(it.type as any));
        const svTotal = validItems.reduce((s, i) => s + i.totalPrice, 0);
        const sorted = [...validItems].sort((a, b) => b.totalPrice - a.totalPrice);
        let accum = 0;
        let rows = '';
        sorted.forEach((it, idx) => {
            accum += it.totalPrice;
            const pct = svTotal > 0 ? (it.totalPrice / svTotal * 100) : 0;
            const pctAccum = svTotal > 0 ? (accum / svTotal * 100) : 0;
            const cls = pctAccum <= 80 ? 'abc-a' : pctAccum <= 95 ? 'abc-b' : 'abc-c';
            const abc = pctAccum <= 80 ? 'A' : pctAccum <= 95 ? 'B' : 'C';
            rows += `<tr><td class="${cls}">${abc}</td><td>${idx+1}</td><td>${it.itemNumber}</td><td class="mono">${it.code}</td><td>${it.sourceName || '—'}</td><td>${it.description}</td><td class="r">${fmt(it.totalPrice)}</td><td class="r">${fmtPct(pct)}</td><td class="r bold">${fmtPct(pctAccum)}</td></tr>`;
        });
        parts.push(`<h1>CURVA ABC DE SERVIÇOS</h1>
<div class="meta">${validItems.length} serviços · Total: ${fmt(svTotal)}</div>
${renderConfigTable(engineeringConfig)}
<table><thead><tr><th>ABC</th><th>#</th><th>Item</th><th>Código</th><th>Base</th><th>Descrição</th><th class="r">Valor</th><th class="r">%</th><th class="r">% Acum.</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr class="grand"><td colspan="6">TOTAL</td><td class="r">${fmt(svTotal)}</td><td class="r">100%</td><td class="r">100%</td></tr></tfoot></table>`);
    }

    // ── Curva ABC de Insumos ──
    if (sections.includes('abc_insumos') && insumos.length > 0) {
        const insTotal = insumos.reduce((s, i) => s + i.custoTotal, 0);
        const sorted = [...insumos].sort((a, b) => b.custoTotal - a.custoTotal);
        let accum = 0;
        let rows = '';
        sorted.forEach((ins, idx) => {
            accum += ins.custoTotal;
            const pct = insTotal > 0 ? (ins.custoTotal / insTotal * 100) : 0;
            const pctAccum = insTotal > 0 ? (accum / insTotal * 100) : 0;
            const cls = ins.abcClass === 'A' ? 'abc-a' : ins.abcClass === 'B' ? 'abc-b' : 'abc-c';
            rows += `<tr><td class="${cls}">${ins.abcClass||'—'}</td><td>${idx+1}</td><td class="mono">${ins.codigo}</td><td>${ins.descricao}</td><td>${CATEGORIA_META[ins.categoria]?.label||ins.categoria}</td><td class="c">${ins.unidade}</td><td class="r">${fmt(ins.precoFinal)}</td><td class="r">${fmt(ins.custoTotal)}</td><td class="r">${fmtPct(pct)}</td><td class="r bold">${fmtPct(pctAccum)}</td></tr>`;
        });
        parts.push(`<h1>CURVA ABC DE INSUMOS</h1>
<div class="meta">${insumos.length} insumos · Total: ${fmt(insTotal)}</div>
${renderConfigTable(engineeringConfig)}
<table><thead><tr><th>ABC</th><th>#</th><th>Código</th><th>Descrição</th><th>Cat.</th><th>Un.</th><th class="r">Preço</th><th class="r">Custo Total</th><th class="r">%</th><th class="r">% Acum.</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr class="grand"><td colspan="7">TOTAL</td><td class="r">${fmt(insTotal)}</td><td class="r">100%</td><td class="r">100%</td></tr></tfoot></table>`);
    }

    // ── Cronograma ──
    if (sections.includes('cronograma') && cronogramaResult) {
        const { meses, etapas, mensalTotal, percentMensal, percentAcumulado, totalGlobal } = cronogramaResult;
        let headerCols = '<th>Etapa</th><th class="r">Valor</th>';
        for (let m = 0; m < meses; m++) headerCols += `<th class="r">Mês ${m+1}</th>`;
        headerCols += '<th class="r">Total</th>';
        let rows = '';
        for (const et of etapas) {
            const etPctGlobal = totalGlobal > 0 ? (et.valorTotal / totalGlobal * 100) : 0;
            rows += `<tr><td class="bold">${et.nome}</td><td class="r">${fmt(et.valorTotal)}<div style="font-size:7px;color:#64748b;">${fmtPct(etPctGlobal)}</div></td>`;
            let etTotal = 0;
            for (let m = 0; m < meses; m++) {
                const v = et.valoresMensais[m] || 0;
                const pct = et.percentuais?.[m] || 0;
                etTotal += v;
                rows += `<td class="r">${v > 0 ? `${fmt(v)}<div style="font-size:7px;color:#64748b;">${fmtPct(pct)}</div>` : '—'}</td>`;
            }
            rows += `<td class="r bold">${fmt(etTotal)}</td></tr>`;
        }
        rows += `<tr class="total"><td>TOTAL MENSAL</td><td></td>`;
        for (let m = 0; m < meses; m++) rows += `<td class="r">${fmt(mensalTotal[m])}</td>`;
        rows += `<td class="r">${fmt(totalGlobal)}</td></tr>`;
        rows += `<tr class="total"><td>% MENSAL</td><td></td>`;
        for (let m = 0; m < meses; m++) rows += `<td class="r">${fmtPct(percentMensal[m])}</td>`;
        rows += `<td class="r">100%</td></tr>`;
        rows += `<tr class="total"><td>% ACUMULADO</td><td></td>`;
        for (let m = 0; m < meses; m++) rows += `<td class="r">${fmtPct(percentAcumulado[m])}</td>`;
        rows += `<td class="r">100%</td></tr>`;
        parts.push(`<h1>CRONOGRAMA FÍSICO-FINANCEIRO</h1>
<div class="meta">${meses} meses · ${etapas.length} etapas · Total: ${fmt(totalGlobal)}</div>
${renderConfigTable(engineeringConfig)}
<table><thead><tr>${headerCols}</tr></thead><tbody>${rows}</tbody></table>`);
    }

    // ── BDI e Encargos ──
    if (sections.includes('bdi')) {
        const tcu = bdiConfig.tcu;
        const isTcu = bdiConfig.mode === 'TCU';
        const regime = engineeringConfig?.regimeOneracao || 'DESONERADO';
        const esConfig = engineeringConfig?.encargosSociais || { horista: 83.85, mensalista: 47.76 } as EncargosSociaisConfig;
        let h = `<h1>BDI E ENCARGOS SOCIAIS</h1>`;
        h += buildBdiHtml(tcu, isTcu, bdi);
        // Encargos Sociais
        if (rc.showEncargosSociais !== false) {
            const es = buildEncargosSociais(esConfig, regime);
            h += `<h2>Encargos Sociais (${regime})</h2>
<div class="meta">Horista: ${fmtPct(es.horista ?? 0)} · Mensalista: ${fmtPct(es.mensalista ?? 0)}</div>`;
            for (const g of es.groups) {
                h += `<h2 style="font-size:10px;">${g.label}</h2><table><thead><tr><th>Cód</th><th>Descrição</th><th class="r">Horista (%)</th><th class="r">Mensalista (%)</th></tr></thead><tbody>`;
                let subH = 0, subM = 0;
                for (const item of g.items) { subH += item.h; subM += item.m; h += `<tr><td>${item.cod}</td><td>${item.item}</td><td class="r">${fmtPct(item.h)}</td><td class="r">${fmtPct(item.m)}</td></tr>`; }
                h += `<tr class="total"><td colspan="2" class="r">Subtotal ${g.label.split('—')[0]}</td><td class="r">${fmtPct(subH)}</td><td class="r">${fmtPct(subM)}</td></tr></tbody></table>`;
            }
        }
        parts.push(h);
    }

    // Combine with page breaks
    const combined = parts.map((p, i) => i === 0 ? p : `<div style="page-break-before:always;"></div>${p}`).join('\n');
    return openDoc('Proposta Completa', combined, false, rc, params.mode || 'download');
}

// ── 9. MEMÓRIA DE CÁLCULO — dedicated HTML/PDF report ─────────────────────────
export function docMemoriaCalculo(items: EngItem[], engineeringConfig?: any, mode: DocMode = 'download') {
    const rc = engineeringConfig?.reportConfig || {};
    const billable = items.filter(i => !isGrouper(i.type as any));
    let html = `<h1>RELATÓRIO DE MEMÓRIA DE CÁLCULO</h1><div class="meta">${billable.length} itens</div>${renderConfigTable(engineeringConfig)}`;

    let rowsHtml = '';

    for (const it of items) {
        if (isGrouper(it.type as any)) {
            if (rowsHtml) {
                html += `<table><thead><tr><th>Item</th><th>Descrição</th><th>Un.</th><th>Detalhamento da Memória</th><th class="r">Quant/Mult</th><th class="r">Compr (m)</th><th class="r">Larg (m)</th><th class="r">Alt (m)</th><th class="r">Subtotal</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
                rowsHtml = '';
            }
            html += `<h2>${it.itemNumber} — ${it.description}</h2>`;
            continue;
        }

        const hasCalc = !!(it.calculationMemory && it.calculationMemory.trim() !== '');
        let calcObj: any = null;
        if (hasCalc && it.calculationMemory) {
            try {
                calcObj = JSON.parse(it.calculationMemory);
            } catch (e) {
                console.error("Erro ao fazer parse da memoria de calculo:", e);
            }
        }

        if (!calcObj) {
            rowsHtml += `<tr>
                <td style="width: 80px;">${it.itemNumber}</td>
                <td style="width: 250px;">${it.description}</td>
                <td class="c" style="width: 40px;">${it.unit || '—'}</td>
                <td>Quantidade direta (sem memória cadastrada)</td>
                <td class="r" style="width: 70px;">1,00</td>
                <td class="r" style="width: 70px;">—</td>
                <td class="r" style="width: 70px;">—</td>
                <td class="r" style="width: 70px;">—</td>
                <td class="r bold" style="width: 90px;">${fmtQty(it.quantity)}</td>
            </tr>`;
        } else if (calcObj.mode === 'SIMPLE') {
            rowsHtml += `<tr>
                <td>${it.itemNumber}</td>
                <td>${it.description}</td>
                <td class="c">${it.unit || '—'}</td>
                <td>Fórmula: <code class="mono">${calcObj.formula}</code></td>
                <td class="r">1,00</td>
                <td class="r">—</td>
                <td class="r">—</td>
                <td class="r">—</td>
                <td class="r bold">${fmtQty(it.quantity)}</td>
            </tr>`;
        } else if (calcObj.mode === 'STRUCTURED' && Array.isArray(calcObj.rows)) {
            const calcRows = calcObj.rows;
            calcRows.forEach((row: any, rIdx: number) => {
                rowsHtml += `<tr>
                    <td>${rIdx === 0 ? it.itemNumber : ''}</td>
                    <td>${rIdx === 0 ? it.description : ''}</td>
                    <td class="c">${rIdx === 0 ? (it.unit || '—') : ''}</td>
                    <td>${row.description || `Linha ${rIdx + 1}`}</td>
                    <td class="r">${fmtQty(Number(row.multiplier) || 0)}</td>
                    <td class="r">${row.length ? fmtQty(Number(row.length)) : '—'}</td>
                    <td class="r">${row.width ? fmtQty(Number(row.width)) : '—'}</td>
                    <td class="r">${row.height ? fmtQty(Number(row.height)) : '—'}</td>
                    <td class="r bold">${fmtQty(Number(row.subtotal) || 0)}</td>
                </tr>`;
            });
        }
    }

    if (rowsHtml) {
        html += `<table><thead><tr><th>Item</th><th>Descrição</th><th>Un.</th><th>Detalhamento da Memória</th><th class="r">Quant/Mult</th><th class="r">Compr (m)</th><th class="r">Larg (m)</th><th class="r">Alt (m)</th><th class="r">Subtotal</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
    }

    return openDoc('Memória de Cálculo', html, false, rc, mode);
}

