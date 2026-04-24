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

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v: number) => v.toFixed(2).replace('.', ',') + '%';

interface EngItem {
    id: string; itemNumber: string; code: string; sourceName: string;
    description: string; unit: string; quantity: number;
    unitCost: number; unitPrice: number; totalPrice: number;
}

// ═══════════════════════════════════════════════════════════
// SHARED STYLES
// ═══════════════════════════════════════════════════════════
const CSS = `
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Segoe UI',Arial,sans-serif; font-size:9px; color:#1a1a2e; padding:20px; }
h1 { font-size:13px; margin-bottom:2px; color:#1e293b; }
h2 { font-size:11px; color:#2563eb; margin:14px 0 6px; border-bottom:1px solid #e2e8f0; padding-bottom:3px; }
.meta { font-size:8px; color:#64748b; margin-bottom:14px; }
table { width:100%; border-collapse:collapse; margin-bottom:10px; page-break-inside:auto; }
tr { page-break-inside:avoid; }
th { background:#f1f5f9; font-size:7.5px; text-transform:uppercase; letter-spacing:.04em; padding:4px 6px; text-align:left; border-bottom:2px solid #cbd5e1; color:#475569; }
td { padding:3px 6px; border-bottom:1px solid #f1f5f9; font-size:8.5px; }
.r { text-align:right; }
.c { text-align:center; }
.mono { font-family:Consolas,monospace; }
.bold { font-weight:700; }
.total { background:#f8fafc; font-weight:700; }
.grand { background:#1e40af; color:white; font-weight:700; font-size:10px; }
.abc-a { color:#dc2626; font-weight:700; }
.abc-b { color:#d97706; font-weight:600; }
.abc-c { color:#16a34a; }
.footer { margin-top:12px; font-size:7px; color:#94a3b8; text-align:center; border-top:1px solid #e2e8f0; padding-top:6px; }
.no-print { text-align:center; margin-top:12px; }
@media print { .no-print{display:none;} @page{margin:12mm;} }
`;

function openDoc(title: string, html: string) {
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { alert('Habilite pop-ups.'); return; }
    w.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>${CSS}</style></head><body>
${html}
<div class="footer">LicitaSaaS — ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}</div>
<div class="no-print"><button onclick="window.print()" style="padding:6px 20px;background:#2563eb;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:600;font-size:11px">🖨️ Imprimir / Salvar PDF</button></div>
</body></html>`);
    w.document.close();
}

// Helper: group items by chapter prefix
function groupByChapter(items: EngItem[]) {
    const map = new Map<string, { items: EngItem[]; total: number }>();
    for (const it of items) {
        const prefix = it.itemNumber.split('.')[0] || '1';
        if (!map.has(prefix)) map.set(prefix, { items: [], total: 0 });
        const g = map.get(prefix)!;
        g.items.push(it);
        g.total += it.totalPrice;
    }
    return map;
}

// ═══════════════════════════════════════════════════════════
// 1. ORÇAMENTO RESUMIDO
// ═══════════════════════════════════════════════════════════
export function docOrcamentoResumido(items: EngItem[], bdi: number) {
    const chapters = groupByChapter(items);
    const total = items.reduce((s, i) => s + i.totalPrice, 0);
    let rows = '';
    for (const [prefix, ch] of chapters) {
        const pct = total > 0 ? (ch.total / total * 100) : 0;
        rows += `<tr><td class="bold">${prefix}</td><td class="bold">Etapa ${prefix}</td><td class="r">${ch.items.length}</td><td class="r">${fmt(ch.total)}</td><td class="r">${fmtPct(pct)}</td></tr>`;
    }
    openDoc('Orçamento Resumido', `
<h1>ORÇAMENTO RESUMIDO</h1>
<div class="meta">BDI: ${fmtPct(bdi)} · ${items.length} itens</div>
<table><thead><tr><th>Nº</th><th>Etapa</th><th class="r">Itens</th><th class="r">Valor (R$)</th><th class="r">%</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr class="grand"><td colspan="3">TOTAL GERAL</td><td class="r">${fmt(total)}</td><td class="r">100%</td></tr></tfoot></table>`);
}

// ═══════════════════════════════════════════════════════════
// 2. ORÇAMENTO SINTÉTICO
// ═══════════════════════════════════════════════════════════
export function docOrcamentoSintetico(items: EngItem[], bdi: number) {
    const total = items.reduce((s, i) => s + i.totalPrice, 0);
    const chapters = groupByChapter(items);
    let html = `<h1>ORÇAMENTO SINTÉTICO</h1><div class="meta">BDI: ${fmtPct(bdi)} · ${items.length} itens</div>`;

    for (const [prefix, ch] of chapters) {
        html += `<h2>Etapa ${prefix}</h2>
<table><thead><tr><th>Item</th><th>Código</th><th>Descrição</th><th>Un.</th><th class="r">Qtd.</th><th class="r">Custo Unit.</th><th class="r">Preço Unit.</th><th class="r">Total</th></tr></thead><tbody>`;
        for (const it of ch.items) {
            html += `<tr><td>${it.itemNumber}</td><td class="mono">${it.code}</td><td>${it.description}</td><td class="c">${it.unit}</td><td class="r">${it.quantity}</td><td class="r">${fmt(it.unitCost)}</td><td class="r">${fmt(it.unitPrice)}</td><td class="r bold">${fmt(it.totalPrice)}</td></tr>`;
        }
        html += `<tr class="total"><td colspan="7" class="r">Subtotal Etapa ${prefix}</td><td class="r">${fmt(ch.total)}</td></tr></tbody></table>`;
    }
    html += `<table><tfoot><tr class="grand"><td colspan="7" class="r">TOTAL GERAL DO ORÇAMENTO</td><td class="r">${fmt(total)}</td></tr></tfoot></table>`;
    openDoc('Orçamento Sintético', html);
}

// ═══════════════════════════════════════════════════════════
// 5. CURVA ABC DE SERVIÇOS
// ═══════════════════════════════════════════════════════════
export function docCurvaAbcServicos(items: EngItem[]) {
    const total = items.reduce((s, i) => s + i.totalPrice, 0);
    const sorted = [...items].sort((a, b) => b.totalPrice - a.totalPrice);
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
<div class="meta">${items.length} serviços · Total: ${fmt(total)}</div>
<table><thead><tr><th>ABC</th><th>#</th><th>Item</th><th>Código</th><th>Descrição</th><th class="r">Valor</th><th class="r">%</th><th class="r">% Acum.</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr class="grand"><td colspan="5">TOTAL</td><td class="r">${fmt(total)}</td><td class="r">100%</td><td class="r">100%</td></tr></tfoot></table>`);
}

// ═══════════════════════════════════════════════════════════
// 6. CURVA ABC DE INSUMOS
// ═══════════════════════════════════════════════════════════
export function docCurvaAbcInsumos(insumos: InsumoConsolidado[]) {
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

    openDoc('Cronograma Físico-Financeiro', `
<h1>CRONOGRAMA FÍSICO-FINANCEIRO</h1>
<div class="meta">${meses} meses · ${etapas.length} etapas · Total: ${fmt(totalGlobal)}</div>
<table><thead><tr>${headerCols}</tr></thead><tbody>${rows}</tbody></table>`);
}

// ═══════════════════════════════════════════════════════════
// 8. BDI E ENCARGOS SOCIAIS
// ═══════════════════════════════════════════════════════════

const ENCARGOS_SOCIAIS = {
    grupo_a: [
        { item: 'INSS', pct: 20.00 },
        { item: 'SESI', pct: 1.50 },
        { item: 'SENAI', pct: 1.00 },
        { item: 'INCRA', pct: 0.20 },
        { item: 'SEBRAE', pct: 0.60 },
        { item: 'Salário Educação', pct: 2.50 },
        { item: 'Seguro Acidente Trabalho (RAT)', pct: 3.00 },
        { item: 'FGTS', pct: 8.00 },
    ],
    grupo_b: [
        { item: 'Férias (indenizadas)', pct: 14.06 },
        { item: '13º Salário', pct: 10.87 },
        { item: 'Auxílio Doença', pct: 0.79 },
        { item: 'Faltas Justificadas', pct: 0.69 },
        { item: 'Acidente de Trabalho', pct: 0.14 },
        { item: 'Aviso Prévio (indenizado)', pct: 5.57 },
    ],
    grupo_c: [
        { item: 'Multa Rescisória FGTS', pct: 4.44 },
    ],
    grupo_d: [
        { item: 'Reincidência Grupo A sobre Grupo B', pct: 11.74 },
    ],
};

export function docBdiEncargos(config: BdiConfig, bdiEfetivo: number) {
    const tcu = config.tcu;
    const isTcu = config.mode === 'TCU';

    let bdiHtml = `<h2>Composição do BDI</h2>`;
    if (isTcu) {
        const rows = [
            ['Administração Central (AC)', tcu.adminCentral],
            ['Seguros (S)', tcu.seguros],
            ['Garantias (G)', tcu.garantias],
            ['Riscos (R)', tcu.riscos],
            ['Despesas Financeiras (DF)', tcu.despFinanceiras],
            ['Lucro / Remuneração (L)', tcu.lucro],
            ['Tributos (I = PIS + COFINS + ISS)', tcu.tributos],
        ];
        bdiHtml += `<p style="font-size:8px;color:#64748b;margin-bottom:6px">Fórmula TCU — Acórdão 2622/2013:<br>BDI = {(1+AC+S+G+R)×(1+DF)×(1+L) / (1−I) − 1} × 100</p>
<table><thead><tr><th>Componente</th><th class="r">Valor (%)</th></tr></thead><tbody>`;
        for (const [label, val] of rows) bdiHtml += `<tr><td>${label}</td><td class="r">${fmtPct(val as number)}</td></tr>`;
        bdiHtml += `</tbody><tfoot><tr class="grand"><td>BDI CALCULADO</td><td class="r">${fmtPct(bdiEfetivo)}</td></tr></tfoot></table>`;
    } else {
        bdiHtml += `<table><tbody><tr class="grand"><td>BDI SIMPLIFICADO</td><td class="r">${fmtPct(bdiEfetivo)}</td></tr></tbody></table>`;
    }

    // Encargos Sociais
    const groups = [
        { key: 'grupo_a', label: 'Grupo A — Encargos Básicos e Obrigatórios', items: ENCARGOS_SOCIAIS.grupo_a },
        { key: 'grupo_b', label: 'Grupo B — Encargos que recebem incidência de A', items: ENCARGOS_SOCIAIS.grupo_b },
        { key: 'grupo_c', label: 'Grupo C — Encargos que não recebem incidência', items: ENCARGOS_SOCIAIS.grupo_c },
        { key: 'grupo_d', label: 'Grupo D — Reincidências', items: ENCARGOS_SOCIAIS.grupo_d },
    ];
    let esHtml = '<h2>Encargos Sociais sobre Mão de Obra</h2>';
    let totalES = 0;
    for (const g of groups) {
        const subtotal = g.items.reduce((s, i) => s + i.pct, 0);
        totalES += subtotal;
        esHtml += `<h2 style="font-size:9px;color:#475569">${g.label}</h2><table><thead><tr><th>Descrição</th><th class="r">%</th></tr></thead><tbody>`;
        for (const i of g.items) esHtml += `<tr><td>${i.item}</td><td class="r">${fmtPct(i.pct)}</td></tr>`;
        esHtml += `<tr class="total"><td class="r">Subtotal ${g.key.replace('_', ' ').toUpperCase()}</td><td class="r">${fmtPct(subtotal)}</td></tr></tbody></table>`;
    }
    esHtml += `<table><tfoot><tr class="grand"><td>TOTAL ENCARGOS SOCIAIS</td><td class="r">${fmtPct(totalES)}</td></tr></tfoot></table>`;

    openDoc('BDI e Encargos Sociais', `<h1>BDI E ENCARGOS SOCIAIS</h1><div class="meta">Modo: ${config.mode}</div>${bdiHtml}${esHtml}`);
}

// ═══════════════════════════════════════════════════════════
// 3. ORÇAMENTO ANALÍTICO (Flattened TCU Standard)
// ═══════════════════════════════════════════════════════════
export async function docOrcamentoAnalitico(proposalId: string, items: EngItem[], bdi: number) {
    const token = localStorage.getItem('token') || '';
    const hdrs = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    const total = items.reduce((s, i) => s + i.totalPrice, 0);

    let html = `<h1>ORÇAMENTO ANALÍTICO</h1><div class="meta">BDI: ${fmtPct(bdi)} · ${items.length} itens · Total: ${fmt(total)}</div>`;
    html += `<div style="text-align:center; margin: 15px 0; font-size:12px; font-weight:bold; color:#1e40af;">Composições Principais</div>`;

    try {
        const res = await fetch(`/api/engineering/proposals/${proposalId}/analytical-report`, { headers: hdrs });
        if (!res.ok) throw new Error('Falha ao carregar relatório analítico');
        const report = await res.json();

        const renderComposition = (comp: any) => {
            let ch = `<div style="margin-bottom:15px; border:1px solid #e2e8f0;">
                <div style="background:#f1f5f9; padding:6px; font-weight:bold; font-size:9px;">
                    <span style="color:#2563eb;">${comp.code || 'N/A'}</span> — ${comp.description} <br>
                    <span style="font-size:7.5px; font-weight:normal; color:#64748b;">Banco: ${comp.sourceName} · Unidade: ${comp.unit}</span>
                </div>
                <table>
                <thead><tr><th>Tipo</th><th>Código</th><th>Descrição</th><th class="c">Un.</th><th class="r">Coef.</th><th class="r">Preço Unit.</th><th class="r">Total</th></tr></thead>
                <tbody>`;

            for (const ci of comp.items) {
                const tipo = ci.type === 'MAO_DE_OBRA' ? 'Mão de Obra' : ci.type === 'MATERIAL' ? 'Material' : ci.type === 'EQUIPAMENTO' ? 'Equipamento' : 'Comp. Auxiliar';
                ch += `<tr>
                    <td>${tipo}</td>
                    <td class="mono">${ci.code || ''}</td>
                    <td>${ci.description || '—'}</td>
                    <td class="c">${ci.unit || ''}</td>
                    <td class="r mono">${ci.coefficient.toFixed(4)}</td>
                    <td class="r">${fmt(ci.unitPrice || 0)}</td>
                    <td class="r">${fmt(ci.totalPrice || 0)}</td>
                </tr>`;
            }

            ch += `</tbody></table>
            <div style="display:flex; justify-content:space-between; padding:6px; background:#f8fafc; font-size:8px; border-top:1px solid #e2e8f0;">
                <div style="color:#475569;">
                    MO sem LS: <b>${fmt(comp.totalMoSemLs || 0)}</b> &nbsp;|&nbsp; 
                    LS: <b>${fmt(comp.totalLs || 0)}</b> &nbsp;|&nbsp; 
                    MO com LS: <b>${fmt(comp.totalMoComLs || 0)}</b>
                </div>
                <div style="color:#475569;">
                    Valor do BDI: <b>${fmt(comp.valorBdi || 0)}</b> &nbsp;|&nbsp; 
                    <span style="color:#1e40af; font-weight:bold;">Valor com BDI: ${fmt(comp.valorComBdi || 0)}</span>
                </div>
            </div>
            </div>`;
            return ch;
        };

        for (const comp of report.principalCompositions) {
            html += renderComposition(comp);
        }

        if (report.auxiliaryCompositions.length > 0) {
            html += `<div style="text-align:center; margin: 25px 0 15px; font-size:12px; font-weight:bold; color:#7c3aed; page-break-before: always;">Composições Auxiliares</div>`;
            for (const comp of report.auxiliaryCompositions) {
                html += renderComposition(comp);
            }
        }
        
    } catch (e: any) {
        html += `<div style="color:#dc2626; font-size:10px;">Erro ao gerar relatório analítico: ${e.message}</div>`;
    }

    openDoc('Orçamento Analítico', html);
}

// ═══════════════════════════════════════════════════════════
// 4. CPU — COMPOSIÇÕES DE CUSTOS UNITÁRIOS (batch)
// ═══════════════════════════════════════════════════════════
export async function docCpuBatch(items: EngItem[]) {
    const token = localStorage.getItem('token') || '';
    const hdrs = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    const groupLabels: Record<string,{label:string;color:string}> = {
        MATERIAL:{label:'Materiais',color:'#2563eb'}, MAO_DE_OBRA:{label:'Mão de Obra',color:'#16a34a'},
        EQUIPAMENTO:{label:'Equipamentos',color:'#d97706'}, AUXILIAR:{label:'Auxiliares',color:'#7c3aed'},
    };

    let html = `<h1>COMPOSIÇÃO DE PREÇOS UNITÁRIOS — CPU</h1><div class="meta">${items.length} serviços</div>`;
    let count = 0;

    for (const it of items) {
        if (!it.code || it.code === 'N/A') continue;
        try {
            const res = await fetch(`/api/engineering/compositions/${encodeURIComponent(it.code)}`, { headers: hdrs });
            if (!res.ok) continue;
            const d = await res.json();
            count++;
            html += `<h2 style="page-break-before:${count>1?'always':'auto'}">${it.itemNumber} — ${it.code} — ${it.description}</h2>`;
            for (const [gk, meta] of Object.entries(groupLabels)) {
                const gItems = d.groups?.[gk] || [];
                if (gItems.length === 0) continue;
                const gTotal = gItems.reduce((s:number, ci:any) => s + (ci.price||0), 0);
                html += `<div style="font-size:8.5px;font-weight:700;color:${meta.color};margin:6px 0 2px">${meta.label} (${gItems.length}) — ${fmt(gTotal)}</div>
<table><thead><tr><th>#</th><th>Descrição</th><th>Un.</th><th class="r">Coef.</th><th class="r">Preço</th><th class="r">Subtotal</th></tr></thead><tbody>`;
                gItems.forEach((ci:any, idx:number) => {
                    const id = ci.item || ci.auxiliaryComposition;
                    html += `<tr><td>${idx+1}</td><td>${id?.description||'—'}</td><td class="c">${id?.unit||''}</td><td class="r mono">${ci.coefficient.toFixed(4)}</td><td class="r">${fmt(id?.price||0)}</td><td class="r" style="color:${meta.color};font-weight:600">${fmt(ci.price)}</td></tr>`;
                });
                html += `</tbody></table>`;
            }
            html += `<table><tfoot><tr class="grand"><td colspan="5">CUSTO UNITÁRIO (S/ BDI)</td><td class="r">${fmt(d.totalPrice||d.totalDirect||0)}</td></tr></tfoot></table>`;
        } catch { /* skip */ }
    }
    openDoc('CPU — Composição de Preços Unitários', html);
}
