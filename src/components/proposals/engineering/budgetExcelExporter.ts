/**
 * budgetExcelExporter.ts — Motor de Exportação Excel (.xlsx)
 * 
 * Fase 3/C1: Gera planilhas Excel formatadas para todos os 8 relatórios
 * do Caderno de Orçamento, com formatação profissional idêntica ao PDF.
 */
import * as XLSX from 'xlsx';
import type { BdiConfig } from './bdiEngine';
import type { InsumoConsolidado } from './insumoEngine';
import { CATEGORIA_META } from './insumoEngine';
import type { CronogramaResult } from './cronogramaEngine';
import type { EngItem, EngineeringConfig } from './types';
import { isGrouper } from './types';

// ═══════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════

function configRows(ec?: EngineeringConfig): string[][] {
    if (!ec) return [];
    return [
        ['Obra:', ec.objeto || '—'],
        ['Bancos:', ec.basesConsideradas?.join(', ') || '—', 'Data-Base:', ec.dataBase || '—', 'UF:', ec.ufReferencia || '—'],
        ['Regime:', ec.regimeOneracao || '—', 'Encargos:', `H: ${ec.encargosSociais?.horista || 0}% / M: ${ec.encargosSociais?.mensalista || 0}%`],
        [],
    ];
}

function saveWorkbook(wb: XLSX.WorkBook, filename: string) {
    XLSX.writeFile(wb, `${filename}.xlsx`);
}

function setColWidths(ws: XLSX.WorkSheet, widths: number[]) {
    ws['!cols'] = widths.map(w => ({ wch: w }));
}

// Group items by chapter prefix (mirrors budgetDocGenerator logic)
function groupByChapter(items: EngItem[]) {
    const map = new Map<string, { items: EngItem[]; total: number; title: string }>();
    for (const it of items) {
        const prefix = it.itemNumber.split('.')[0] || '1';
        if (!map.has(prefix)) map.set(prefix, { items: [], total: 0, title: `Etapa ${prefix}` });
        const g = map.get(prefix)!;
        if (isGrouper(it.type)) {
            const depth = (it.itemNumber.match(/\./g) || []).length;
            if (depth <= 1 && it.description) g.title = `${prefix} — ${it.description}`;
            continue;
        }
        g.items.push(it);
        g.total += it.totalPrice;
    }
    return map;
}

// ═══════════════════════════════════════════════════════════
// 1. ORÇAMENTO RESUMIDO
// ═══════════════════════════════════════════════════════════
export function xlsOrcamentoResumido(items: EngItem[], bdi: number, ec?: EngineeringConfig) {
    const chapters = groupByChapter(items);
    const billable = items.filter(i => !isGrouper(i.type));
    const total = billable.reduce((s, i) => s + i.totalPrice, 0);

    const rows: any[][] = [
        ['ORÇAMENTO RESUMIDO'],
        [`BDI: ${bdi.toFixed(2)}% · ${billable.length} itens`],
        ...configRows(ec),
        ['Nº', 'Etapa', 'Itens', 'Valor (R$)', '%'],
    ];

    for (const [prefix, ch] of chapters) {
        const pct = total > 0 ? (ch.total / total * 100) : 0;
        rows.push([prefix, ch.title, ch.items.length, ch.total, pct / 100]);
    }
    rows.push(['', 'TOTAL GERAL', '', total, 1]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    setColWidths(ws, [6, 45, 8, 18, 10]);
    XLSX.utils.book_append_sheet(wb, ws, 'Resumido');
    saveWorkbook(wb, 'Orcamento_Resumido');
}

// ═══════════════════════════════════════════════════════════
// 2. ORÇAMENTO SINTÉTICO
// ═══════════════════════════════════════════════════════════
export function xlsOrcamentoSintetico(items: EngItem[], bdi: number, ec?: EngineeringConfig) {
    const chapters = groupByChapter(items);
    const billable = items.filter(i => !isGrouper(i.type));
    const total = billable.reduce((s, i) => s + i.totalPrice, 0);

    const rows: any[][] = [
        ['ORÇAMENTO SINTÉTICO'],
        [`BDI: ${bdi.toFixed(2)}% · ${billable.length} itens`],
        ...configRows(ec),
    ];

    for (const [, ch] of chapters) {
        rows.push([ch.title]);
        rows.push(['Item', 'Código', 'Descrição', 'Un.', 'Qtd.', 'Custo Unit.', 'Preço Unit.', 'Total']);
        for (const it of ch.items) {
            rows.push([it.itemNumber, it.code, it.description, it.unit, it.quantity, it.unitCost, it.unitPrice, it.totalPrice]);
        }
        rows.push(['', '', '', '', '', '', `Subtotal ${ch.title}`, ch.total]);
        rows.push([]);
    }
    rows.push(['', '', '', '', '', '', 'TOTAL GERAL', total]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    setColWidths(ws, [8, 12, 50, 6, 10, 14, 14, 16]);
    XLSX.utils.book_append_sheet(wb, ws, 'Sintético');
    saveWorkbook(wb, 'Orcamento_Sintetico');
}

// ═══════════════════════════════════════════════════════════
// 5. CURVA ABC DE SERVIÇOS
// ═══════════════════════════════════════════════════════════
export function xlsCurvaAbcServicos(items: EngItem[], ec?: EngineeringConfig) {
    const valid = items.filter(it => !isGrouper(it.type));
    const total = valid.reduce((s, i) => s + i.totalPrice, 0);
    const sorted = [...valid].sort((a, b) => b.totalPrice - a.totalPrice);

    const rows: any[][] = [
        ['CURVA ABC DE SERVIÇOS'],
        [`${valid.length} serviços · Total: R$ ${total.toLocaleString('pt-BR')}`],
        ...configRows(ec),
        ['ABC', '#', 'Item', 'Código', 'Descrição', 'Valor', '%', '% Acum.'],
    ];

    let accum = 0;
    sorted.forEach((it, idx) => {
        accum += it.totalPrice;
        const pct = total > 0 ? it.totalPrice / total : 0;
        const pctAccum = total > 0 ? accum / total : 0;
        const abc = pctAccum <= 0.80 ? 'A' : pctAccum <= 0.95 ? 'B' : 'C';
        rows.push([abc, idx + 1, it.itemNumber, it.code, it.description, it.totalPrice, pct, pctAccum]);
    });
    rows.push(['', '', '', '', 'TOTAL', total, 1, 1]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    setColWidths(ws, [5, 5, 8, 12, 50, 16, 8, 10]);
    XLSX.utils.book_append_sheet(wb, ws, 'ABC Serviços');
    saveWorkbook(wb, 'Curva_ABC_Servicos');
}

// ═══════════════════════════════════════════════════════════
// 6. CURVA ABC DE INSUMOS
// ═══════════════════════════════════════════════════════════
export function xlsCurvaAbcInsumos(insumos: InsumoConsolidado[], ec?: EngineeringConfig) {
    const total = insumos.reduce((s, i) => s + i.custoTotal, 0);
    const sorted = [...insumos].sort((a, b) => b.custoTotal - a.custoTotal);

    const rows: any[][] = [
        ['CURVA ABC DE INSUMOS'],
        [`${insumos.length} insumos · Total: R$ ${total.toLocaleString('pt-BR')}`],
        ...configRows(ec),
        ['ABC', '#', 'Código', 'Descrição', 'Cat.', 'Un.', 'Preço', 'Custo Total', '%', '% Acum.'],
    ];

    let accum = 0;
    sorted.forEach((ins, idx) => {
        accum += ins.custoTotal;
        const pct = total > 0 ? ins.custoTotal / total : 0;
        const pctAccum = total > 0 ? accum / total : 0;
        rows.push([ins.abcClass || '—', idx + 1, ins.codigo, ins.descricao, CATEGORIA_META[ins.categoria]?.label || ins.categoria, ins.unidade, ins.precoFinal, ins.custoTotal, pct, pctAccum]);
    });
    rows.push(['', '', '', '', '', '', '', total, 1, 1]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    setColWidths(ws, [5, 5, 12, 50, 12, 6, 14, 16, 8, 10]);
    XLSX.utils.book_append_sheet(wb, ws, 'ABC Insumos');
    saveWorkbook(wb, 'Curva_ABC_Insumos');
}

// ═══════════════════════════════════════════════════════════
// 7. CRONOGRAMA FÍSICO-FINANCEIRO
// ═══════════════════════════════════════════════════════════
export function xlsCronograma(result: CronogramaResult) {
    const { meses, etapas, mensalTotal, percentMensal, percentAcumulado, totalGlobal } = result;

    const header = ['Etapa', 'Valor'];
    for (let m = 0; m < meses; m++) header.push(`Mês ${m + 1}`);
    header.push('Total');

    const rows: any[][] = [
        ['CRONOGRAMA FÍSICO-FINANCEIRO'],
        [`${meses} meses · ${etapas.length} etapas · Total: R$ ${totalGlobal.toLocaleString('pt-BR')}`],
        [],
        header,
    ];

    for (const et of etapas) {
        const row: any[] = [et.nome, et.valorTotal];
        let etTotal = 0;
        for (let m = 0; m < meses; m++) {
            const v = et.valoresMensais[m] || 0;
            etTotal += v;
            row.push(v > 0 ? v : '');
        }
        row.push(etTotal);
        rows.push(row);
    }

    // Totals
    const totalRow: any[] = ['TOTAL MENSAL', ''];
    for (let m = 0; m < meses; m++) totalRow.push(mensalTotal[m]);
    totalRow.push(totalGlobal);
    rows.push(totalRow);

    const pctRow: any[] = ['% MENSAL', ''];
    for (let m = 0; m < meses; m++) pctRow.push(percentMensal[m] / 100);
    pctRow.push(1);
    rows.push(pctRow);

    const accRow: any[] = ['% ACUMULADO', ''];
    for (let m = 0; m < meses; m++) accRow.push(percentAcumulado[m] / 100);
    accRow.push(1);
    rows.push(accRow);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const colWidths = [30, 16, ...Array(meses).fill(14), 16];
    setColWidths(ws, colWidths);
    XLSX.utils.book_append_sheet(wb, ws, 'Cronograma');
    saveWorkbook(wb, 'Cronograma_Fisico_Financeiro');
}

// ═══════════════════════════════════════════════════════════
// 8. BDI E ENCARGOS SOCIAIS
// ═══════════════════════════════════════════════════════════
export function xlsBdiEncargos(config: BdiConfig, bdiEfetivo: number, ec?: EngineeringConfig) {
    const tcu = config.tcu;
    const isTcu = config.mode === 'TCU';
    const regime = ec?.regimeOneracao || 'DESONERADO';
    const isDesonerado = regime === 'DESONERADO';

    const rows: any[][] = [
        ['BDI E ENCARGOS SOCIAIS'],
        [`Modo: ${config.mode} | Regime: ${regime}`],
        ...configRows(ec),
        ['COMPOSIÇÃO DO BDI'],
    ];

    if (isTcu) {
        rows.push(['Componente', 'Valor (%)']);
        rows.push(['Administração Central (AC)', tcu.adminCentral / 100]);
        rows.push(['Seguros (S)', tcu.seguros / 100]);
        rows.push(['Garantias (G)', tcu.garantias / 100]);
        rows.push(['Riscos (R)', tcu.riscos / 100]);
        rows.push(['Despesas Financeiras (DF)', tcu.despFinanceiras / 100]);
        rows.push(['Lucro / Remuneração (L)', tcu.lucro / 100]);
        rows.push(['PIS', tcu.pis / 100]);
        rows.push(['COFINS', tcu.cofins / 100]);
        rows.push(['ISS', tcu.iss / 100]);
        rows.push(['CSLL', (tcu.csll || 0) / 100]);
        rows.push([]);
        rows.push(['BDI CALCULADO', bdiEfetivo / 100]);
    } else {
        rows.push(['BDI SIMPLIFICADO', bdiEfetivo / 100]);
    }

    rows.push([]);
    rows.push(['ENCARGOS SOCIAIS SOBRE MÃO DE OBRA']);
    rows.push(['Horista:', `${ec?.encargosSociais?.horista || 0}%`, 'Mensalista:', `${ec?.encargosSociais?.mensalista || 0}%`]);

    const grupoA = [
        ['INSS', isDesonerado ? 0 : 20], ['SESI', 1.5], ['SENAI', 1], ['INCRA', 0.2],
        ['SEBRAE', 0.6], ['Salário Educação', 2.5], ['Seguro Acidente Trabalho', 3], ['FGTS', 8],
    ];
    const grupoB = [
        ['Férias (indenizadas)', 14.06], ['13º Salário', 10.87], ['Auxílio Doença', 0.79],
        ['Faltas Justificadas', 0.69], ['Acidente de Trabalho', 0.14], ['Aviso Prévio', 5.57],
    ];
    rows.push([], ['Grupo A — Encargos Básicos e Obrigatórios'], ['Descrição', '%']);
    for (const [desc, pct] of grupoA) rows.push([desc, (pct as number) / 100]);
    const subA = grupoA.reduce((s, g) => s + (g[1] as number), 0);
    rows.push(['Subtotal Grupo A', subA / 100]);

    rows.push([], ['Grupo B — Encargos que recebem incidência de A'], ['Descrição', '%']);
    for (const [desc, pct] of grupoB) rows.push([desc, (pct as number) / 100]);
    const subB = grupoB.reduce((s, g) => s + (g[1] as number), 0);
    rows.push(['Subtotal Grupo B', subB / 100]);

    rows.push([], ['Grupo C — Encargos que não recebem incidência'], ['Descrição', '%']);
    rows.push(['Multa Rescisória FGTS', 4.44 / 100]);
    rows.push(['Subtotal Grupo C', 4.44 / 100]);

    const reincidencia = Math.round(subA * subB / 100 * 100) / 100;
    rows.push([], ['Grupo D — Reincidências'], ['Descrição', '%']);
    rows.push(['Reincidência Grupo A sobre Grupo B', reincidencia / 100]);

    const totalES = subA + subB + 4.44 + reincidencia;
    rows.push([], ['TOTAL ENCARGOS SOCIAIS', totalES / 100]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    setColWidths(ws, [45, 14, 14, 14]);
    XLSX.utils.book_append_sheet(wb, ws, 'BDI e Encargos');
    saveWorkbook(wb, 'BDI_Encargos_Sociais');
}
