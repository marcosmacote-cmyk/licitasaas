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
import type { EngItem, EngineeringConfig, EncargosSociaisConfig } from './types';
import { isGrouper } from './types';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v: number) => v.toFixed(2).replace('.', ',') + '%';
const fmtQty = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

// ═══════════════════════════════════════════════════════════
// SHARED STYLES — FIX D1-D6, B10
// ═══════════════════════════════════════════════════════════
const CSS = `
* { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; color-adjust:exact !important; }
body { font-family:'Segoe UI',Arial,sans-serif; font-size:10px; color:#1a1a2e; padding:20px; }
h1 { font-size:14px; margin-bottom:2px; color:#1e293b; text-transform:uppercase; letter-spacing:0.04em; }
h2 { font-size:11px; color:#2563eb; margin:14px 0 6px; border-bottom:2px solid #2563eb; padding-bottom:3px; }
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
.total { background:#f1f5f9; font-weight:700; border-top:2px solid #cbd5e1; }
.grand { background:#1e40af; color:white; font-weight:700; font-size:10px; }
.abc-a { color:#dc2626; font-weight:700; }
.abc-b { color:#d97706; font-weight:600; }
.abc-c { color:#16a34a; }
.footer { margin-top:12px; font-size:7.5px; color:#94a3b8; text-align:center; border-top:1px solid #cbd5e1; padding-top:6px; }
.no-print { text-align:center; margin-top:12px; }
.cover { page-break-after:always; display:flex; flex-direction:column; justify-content:center; align-items:center; min-height:80vh; text-align:center; }
.cover h1 { font-size:22px; margin-bottom:8px; }
.cover .meta { font-size:11px; }
@media print {
  .no-print { display:none; }
  @page { margin:15mm 12mm; size:A4; }
  @page:first { margin-top:20mm; }
  body { padding:0; }
}
`;

const CSS_LANDSCAPE = `@media print { @page { size:A4 landscape; } }`;

function openDoc(title: string, html: string, landscape: boolean = false) {
    const w = window.open('', '_blank', 'width=1000,height=750');
    if (!w) { alert('Habilite pop-ups.'); return; }
    const extraCss = landscape ? CSS_LANDSCAPE : '';
    w.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>${CSS}${extraCss}</style></head><body>
${html}
<div class="footer">LicitaSaaS — ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}</div>
<div class="no-print"><button onclick="window.print()" style="padding:8px 24px;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px">Imprimir / Salvar PDF</button></div>
</body></html>`);
    w.document.close();
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
function renderGlobalTotals(billable: EngItem[], bdi: number) {
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
export function docOrcamentoResumido(items: EngItem[], bdi: number, engineeringConfig?: any) {
    const chapters = groupByChapter(items);
    // FIX B4: Only count billable items (not ETAPAs/SUBETAPAs)
    const billable = items.filter(i => !isGrouper(i.type as any));
    const total = billable.reduce((s, i) => s + i.totalPrice, 0);
    let rows = '';
    for (const [prefix, ch] of chapters) {
        const pct = total > 0 ? (ch.total / total * 100) : 0;
        rows += `<tr><td class="bold">${prefix}</td><td class="bold">${ch.title}</td><td class="r">${ch.items.length}</td><td class="r">${fmt(ch.total)}</td><td class="r">${fmtPct(pct)}</td></tr>`;
    }
    openDoc('Orçamento Resumido', `
<h1>ORÇAMENTO RESUMIDO</h1>
<div class="meta">BDI: ${fmtPct(bdi)} · ${billable.length} itens</div>
${renderConfigTable(engineeringConfig)}
<table><thead><tr><th>Nº</th><th>Etapa</th><th class="r">Itens</th><th class="r">Valor (R$)</th><th class="r">%</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr class="grand"><td colspan="3">TOTAL GERAL</td><td class="r">${fmt(total)}</td><td class="r">100%</td></tr></tfoot></table>
${renderGlobalTotals(billable, bdi)}`);
}

// ═══════════════════════════════════════════════════════════
// 2. ORÇAMENTO SINTÉTICO
// ═══════════════════════════════════════════════════════════
export function docOrcamentoSintetico(items: EngItem[], bdi: number, engineeringConfig?: any) {
    // FIX B4: Only count billable items
    const billable = items.filter(i => !isGrouper(i.type as any));
    const total = billable.reduce((s, i) => s + i.totalPrice, 0);
    const chapters = groupByChapter(items);
    let html = `<h1>ORÇAMENTO SINTÉTICO</h1><div class="meta">BDI: ${fmtPct(bdi)} · ${billable.length} itens</div>${renderConfigTable(engineeringConfig)}`;

    for (const [prefix, ch] of chapters) {
        html += `<h2>${ch.title}</h2>
<table><thead><tr><th>Item</th><th>Código</th><th>Descrição</th><th>Un.</th><th class="r">Qtd.</th><th class="r">Custo Unit.</th><th class="r">Preço Unit.</th><th class="r">Total</th></tr></thead><tbody>`;
        for (const it of ch.items) {
            // FIX B5: Format quantity with locale separators
            html += `<tr><td>${it.itemNumber}</td><td class="mono">${it.code}</td><td>${it.description}</td><td class="c">${it.unit}</td><td class="r mono">${fmtQty(it.quantity)}</td><td class="r">${fmt(it.unitCost)}</td><td class="r">${fmt(it.unitPrice)}</td><td class="r bold">${fmt(it.totalPrice)}</td></tr>`;
        }
        html += `<tr class="total"><td colspan="7" class="r">Subtotal ${ch.title}</td><td class="r">${fmt(ch.total)}</td></tr></tbody></table>`;
    }
    html += `<table><tfoot><tr class="grand"><td colspan="7" class="r">TOTAL GERAL DO ORÇAMENTO</td><td class="r">${fmt(total)}</td></tr></tfoot></table>`;
    html += renderGlobalTotals(billable, bdi);
    openDoc('Orçamento Sintético', html);
}

// ═══════════════════════════════════════════════════════════
// 5. CURVA ABC DE SERVIÇOS
// ═══════════════════════════════════════════════════════════
export function docCurvaAbcServicos(items: EngItem[], engineeringConfig?: any) {
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
        rows += `<tr><td class="${cls}">${abc}</td><td>${idx+1}</td><td>${it.itemNumber}</td><td class="mono">${it.code}</td><td>${it.description}</td><td class="r">${fmt(it.totalPrice)}</td><td class="r">${fmtPct(pct)}</td><td class="r bold">${fmtPct(pctAccum)}</td></tr>`;
    });
    openDoc('Curva ABC de Serviços', `
<h1>CURVA ABC DE SERVIÇOS</h1>
<div class="meta">${validItems.length} serviços · Total: ${fmt(total)}</div>
${renderConfigTable(engineeringConfig)}
<table><thead><tr><th>ABC</th><th>#</th><th>Item</th><th>Código</th><th>Descrição</th><th class="r">Valor</th><th class="r">%</th><th class="r">% Acum.</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr class="grand"><td colspan="5">TOTAL</td><td class="r">${fmt(total)}</td><td class="r">100%</td><td class="r">100%</td></tr></tfoot></table>`);
}

// ═══════════════════════════════════════════════════════════
// 6. CURVA ABC DE INSUMOS
// ═══════════════════════════════════════════════════════════
export function docCurvaAbcInsumos(insumos: InsumoConsolidado[], engineeringConfig?: any) {
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
    openDoc('Curva ABC de Insumos', `
<h1>CURVA ABC DE INSUMOS</h1>
<div class="meta">${insumos.length} insumos · Total: ${fmt(total)}</div>
${renderConfigTable(engineeringConfig)}
<table><thead><tr><th>ABC</th><th>#</th><th>Código</th><th>Descrição</th><th>Cat.</th><th>Un.</th><th class="r">Preço</th><th class="r">Custo Total</th><th class="r">%</th><th class="r">% Acum.</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr class="grand"><td colspan="7">TOTAL</td><td class="r">${fmt(total)}</td><td class="r">100%</td><td class="r">100%</td></tr></tfoot></table>`);
}

// ═══════════════════════════════════════════════════════════
// 7. CRONOGRAMA FÍSICO-FINANCEIRO
// ═══════════════════════════════════════════════════════════
export function docCronograma(result: CronogramaResult) {
    const { meses, etapas, mensalTotal, acumulado, percentMensal, percentAcumulado, totalGlobal } = result;
    let headerCols = '<th>Etapa</th><th class="r">Valor</th>';
    for (let m = 0; m < meses; m++) headerCols += `<th class="r">Mês ${m+1}</th>`;
    headerCols += '<th class="r">Total</th>';

    let rows = '';
    for (const et of etapas) {
        rows += `<tr><td class="bold">${et.nome}</td><td class="r">${fmt(et.valorTotal)}</td>`;
        let etTotal = 0;
        for (let m = 0; m < meses; m++) {
            const v = et.valoresMensais[m] || 0;
            etTotal += v;
            rows += `<td class="r">${v > 0 ? fmt(v) : '—'}</td>`;
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
    openDoc('Cronograma Físico-Financeiro', `
<h1>CRONOGRAMA FÍSICO-FINANCEIRO</h1>
<div class="meta">${meses} meses · ${etapas.length} etapas · Total: ${fmt(totalGlobal)}</div>
${renderConfigTable((result as any).engineeringConfig)}
<table><thead><tr>${headerCols}</tr></thead><tbody>${rows}</tbody></table>`, true);
}

// ═══════════════════════════════════════════════════════════
// 8. BDI E ENCARGOS SOCIAIS
// FIX BUG-04: Encargos agora são dinâmicos a partir do engineeringConfig
// ═══════════════════════════════════════════════════════════

/** Gera a tabela de encargos sociais padrão baseada no regime */
function buildEncargosSociais(es: EncargosSociaisConfig, regime: string) {
    const isDesonerado = regime === 'DESONERADO';
    // Grupo A — Encargos Básicos e Obrigatórios
    // Em regime DESONERADO, INSS patronal (20%) é substituído pela CPRB (inclusa no BDI)
    const grupoA = [
        { item: 'INSS', pct: isDesonerado ? 0.00 : 20.00 },
        { item: 'SESI', pct: 1.50 },
        { item: 'SENAI', pct: 1.00 },
        { item: 'INCRA', pct: 0.20 },
        { item: 'SEBRAE', pct: 0.60 },
        { item: 'Salário Educação', pct: 2.50 },
        { item: 'Seguro Acidente Trabalho (RAT)', pct: 3.00 },
        { item: 'FGTS', pct: 8.00 },
    ];
    const grupoB = [
        { item: 'Férias (indenizadas)', pct: 14.06 },
        { item: '13º Salário', pct: 10.87 },
        { item: 'Auxílio Doença', pct: 0.79 },
        { item: 'Faltas Justificadas', pct: 0.69 },
        { item: 'Acidente de Trabalho', pct: 0.14 },
        { item: 'Aviso Prévio (indenizado)', pct: 5.57 },
    ];
    const grupoC = [
        { item: 'Multa Rescisória FGTS', pct: 4.44 },
    ];
    const subA = grupoA.reduce((s, i) => s + i.pct, 0);
    const subB = grupoB.reduce((s, i) => s + i.pct, 0);
    const grupoD = [
        { item: 'Reincidência Grupo A sobre Grupo B', pct: Math.round(subA * subB / 100 * 100) / 100 },
    ];
    return {
        horista: es.horista,
        mensalista: es.mensalista,
        groups: [
            { key: 'grupo_a', label: 'Grupo A — Encargos Básicos e Obrigatórios', items: grupoA },
            { key: 'grupo_b', label: 'Grupo B — Encargos que recebem incidência de A', items: grupoB },
            { key: 'grupo_c', label: 'Grupo C — Encargos que não recebem incidência', items: grupoC },
            { key: 'grupo_d', label: 'Grupo D — Reincidências', items: grupoD },
        ],
    };
}

export function docBdiEncargos(config: BdiConfig, bdiEfetivo: number, engConfig?: EngineeringConfig) {
    const tcu = config.tcu;
    const isTcu = config.mode === 'TCU';
    const regime = engConfig?.regimeOneracao || 'DESONERADO';
    const esConfig = engConfig?.encargosSociais || { horista: 114.3, mensalista: 47.8 };

    let bdiHtml = `<h2>Composição do BDI</h2>`;
    if (isTcu) {
        const rows = [
            ['Administração Central (AC)', tcu.adminCentral],
            ['Seguros (S)', tcu.seguros],
            ['Garantias (G)', tcu.garantias],
            ['Riscos (R)', tcu.riscos],
            ['Despesas Financeiras (DF)', tcu.despFinanceiras],
            ['Lucro / Remuneração (L)', tcu.lucro],
            ['PIS', tcu.pis],
            ['COFINS', tcu.cofins],
            ['ISS', tcu.iss],
            ['CSLL', tcu.csll || 0],
            ['Tributos (I = PIS+COFINS+ISS+CSLL)', (tcu.pis || 0) + (tcu.cofins || 0) + (tcu.iss || 0) + (tcu.csll || 0)],
        ];
        bdiHtml += `<p style="font-size:8px;color:#64748b;margin-bottom:6px">Fórmula TCU — Acórdão 2622/2013:<br>BDI = {(1+AC+S+G+R)×(1+DF)×(1+L) / (1−I) − 1} × 100</p>
<table><thead><tr><th>Componente</th><th class="r">Valor (%)</th></tr></thead><tbody>`;
        for (const [label, val] of rows) bdiHtml += `<tr><td>${label}</td><td class="r">${fmtPct(val as number)}</td></tr>`;
        bdiHtml += `</tbody><tfoot><tr class="grand"><td>BDI CALCULADO</td><td class="r">${fmtPct(bdiEfetivo)}</td></tr></tfoot></table>`;
    } else {
        bdiHtml += `<table><tbody><tr class="grand"><td>BDI SIMPLIFICADO</td><td class="r">${fmtPct(bdiEfetivo)}</td></tr></tbody></table>`;
    }

    // Encargos Sociais — dinâmicos conforme regime
    const esData = buildEncargosSociais(esConfig, regime);
    let esHtml = `<h2>Encargos Sociais sobre Mão de Obra</h2>`;
    esHtml += `<p style="font-size:8px;color:#64748b;margin-bottom:6px">Regime: <strong>${regime}</strong> | Taxas configuradas: Horista ${esData.horista.toFixed(2)}% · Mensalista ${esData.mensalista.toFixed(2)}%</p>`;
    let totalES = 0;
    for (const g of esData.groups) {
        const subtotal = g.items.reduce((s, i) => s + i.pct, 0);
        totalES += subtotal;
        esHtml += `<h2 style="font-size:9px;color:#475569">${g.label}</h2><table><thead><tr><th>Descrição</th><th class="r">%</th></tr></thead><tbody>`;
        for (const i of g.items) esHtml += `<tr><td>${i.item}</td><td class="r">${fmtPct(i.pct)}</td></tr>`;
        esHtml += `<tr class="total"><td class="r">Subtotal ${g.key.replace('_', ' ').toUpperCase()}</td><td class="r">${fmtPct(subtotal)}</td></tr></tbody></table>`;
    }
    esHtml += `<table><tfoot><tr class="grand"><td>TOTAL ENCARGOS SOCIAIS (detalhado)</td><td class="r">${fmtPct(totalES)}</td></tr></tfoot></table>`;

    openDoc('BDI e Encargos Sociais', `<h1>BDI E ENCARGOS SOCIAIS</h1><div class="meta">Modo: ${config.mode} | Regime: ${regime}</div>${renderConfigTable(engConfig)}${bdiHtml}${esHtml}`);
}

// Helper para renderizar Composição no padrão TCU
function renderComposition(comp: any, showQuantities: boolean = false) {
    let ch = `<div style="margin-bottom:15px; border:1px solid #e2e8f0; page-break-inside:avoid;">
        <div style="background:#f1f5f9; padding:6px; font-weight:bold; font-size:9px;">
            ${comp.itemNumbers?.length ? `<span style="background:#2563eb; color:white; padding:2px 7px; border-radius:3px; font-size:8px; margin-right:6px; font-weight:700;">${comp.itemNumbers.join(', ')}</span>` : ''}
            <span style="color:#2563eb;">${comp.code || 'N/A'}</span> — ${comp.description} <br>
            <span style="font-size:7.5px; font-weight:normal; color:#64748b;">Banco: ${comp.sourceName} · Unidade: ${comp.unit}</span>
        </div>
        <table>
        <thead><tr><th>Tipo</th><th>Código</th><th>Banco</th><th>Descrição</th><th class="c">Und</th><th class="r">Coef.</th><th class="r">Valor Unit</th><th class="r">Total</th></tr></thead>
        <tbody>`;

    for (const ci of comp.items) {
        let tipo = 'Comp. Auxiliar';
        if (ci.type === 'MAO_DE_OBRA') tipo = 'Mão de Obra';
        else if (ci.type === 'MATERIAL') tipo = 'Material';
        else if (ci.type === 'EQUIPAMENTO') tipo = 'Equipamento';
        else if (ci.type === 'SERVICO') tipo = 'Serviço';
        else if (ci.type === 'OBSERVACAO') tipo = 'Observação';

        ch += `<tr>
            <td>${tipo}</td>
            <td class="mono">${ci.code || ''}</td>
            <td>${ci.sourceName || ''}</td>
            <td>${ci.description || '—'}</td>
            <td class="c">${ci.type === 'OBSERVACAO' ? '—' : (ci.unit || '')}</td>
            <td class="r mono">${ci.type === 'OBSERVACAO' ? '—' : ci.coefficient.toFixed(7)}</td>
            <td class="r">${ci.type === 'OBSERVACAO' ? '—' : fmt(ci.unitPrice || 0)}</td>
            <td class="r">${ci.type === 'OBSERVACAO' ? '—' : fmt(ci.totalPrice || 0)}</td>
        </tr>`;
    }

    // Composition footer: CUSTO UNITÁRIO TOTAL is the primary highlight (sem BDI)
    // Preço com BDI is secondary info below
    ch += `</tbody></table>
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
    </div>`;
    return ch;
}

// ═══════════════════════════════════════════════════════════
// 3. ORÇAMENTO ANALÍTICO (Flattened TCU Standard - Only Principals)
// ═══════════════════════════════════════════════════════════
export async function docOrcamentoAnalitico(proposalId: string, items: EngItem[], bdi: number, engineeringConfig?: any) {
    const token = localStorage.getItem('token') || '';
    const hdrs = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    // FIX B4: Only count billable items
    const billable = items.filter(i => !isGrouper(i.type as any));
    const total = billable.reduce((s, i) => s + i.totalPrice, 0);

    let html = `<h1>PLANILHA ORÇAMENTÁRIA ANALÍTICA</h1><div class="meta">BDI: ${fmtPct(bdi)} · ${billable.length} itens · Total: ${fmt(total)}</div>${renderConfigTable(engineeringConfig)}`;

    try {
        // FIX B7: Pass engineeringConfig to backend for proper LS calculation
        const res = await fetch(`/api/engineering/proposals/${proposalId}/analytical-report`, { 
            method: 'POST',
            headers: hdrs,
            body: JSON.stringify({ items, bdi, engineeringConfig })
        });
        if (!res.ok) throw new Error('Falha ao carregar relatório analítico');
        const report = await res.json();

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
                html += renderComposition(comp, true);
            }
            html += `<div style="background:#f1f5f9; padding:6px 10px; font-weight:700; font-size:9px; text-align:right; border:1px solid #cbd5e1; margin-bottom:16px;">Subtotal ${chTitle}: ${fmt(chTotal)}</div>`;
        }
        
    } catch (e: any) {
        html += `<div style="color:#dc2626; font-size:10px;">Erro ao gerar relatório analítico: ${e.message}</div>`;
    }

    html += renderGlobalTotals(billable, bdi);
    openDoc('Planilha Orçamentária Analítica', html);
}

// ═══════════════════════════════════════════════════════════
// 4. CPU — COMPOSIÇÕES DE CUSTOS UNITÁRIOS (batch)
// ═══════════════════════════════════════════════════════════
export async function docCpuBatch(proposalId: string, items: EngItem[], bdi: number, engineeringConfig?: any) {
    const token = localStorage.getItem('token') || '';
    const hdrs = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    // FIX B4/B7: Count only billable items and pass engineeringConfig to backend
    const billable = items.filter(i => !isGrouper(i.type as any));
    let html = `<h1>CADERNO DE COMPOSIÇÕES DE PREÇOS UNITÁRIOS</h1><div class="meta">${billable.length} serviços</div>${renderConfigTable(engineeringConfig)}`;

    try {
        const res = await fetch(`/api/engineering/proposals/${proposalId}/analytical-report`, { 
            method: 'POST',
            headers: hdrs,
            body: JSON.stringify({ items, bdi, engineeringConfig })
        });
        if (!res.ok) throw new Error('Falha ao carregar relatório analítico');
        const report = await res.json();

        html += `<div style="text-align:center; margin: 15px 0; font-size:12px; font-weight:bold; color:#1e40af;">Composições Principais</div>`;
        for (const comp of report.principalCompositions) {
            html += renderComposition(comp, false);
        }

        if (report.auxiliaryCompositions.length > 0) {
            html += `<div style="text-align:center; margin: 25px 0 15px; font-size:12px; font-weight:bold; color:#7c3aed;">Composições Auxiliares</div>`;
            for (const comp of report.auxiliaryCompositions) {
                html += renderComposition(comp, false);
            }
        }
        
    } catch (e: any) {
        html += `<div style="color:#dc2626; font-size:10px;">Erro ao gerar Caderno de Composições: ${e.message}</div>`;
    }

    openDoc('Caderno de Composições', html);
}
