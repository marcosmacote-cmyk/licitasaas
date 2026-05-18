import ExcelJS from 'exceljs';
import type { EngineeringConfig } from './types';

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  BLUE_DARK : 'FF1E40AF', BLUE_MED  : 'FF2563EB', BLUE_LIGHT: 'FFEFF6FF',
  GRAY_HEAD : 'FFE2E8F0', GRAY_SUB  : 'FFF1F5F9', GRAY_ROW  : 'FFF8FAFC',
  WHITE     : 'FFFFFFFF', TEXT_DARK : 'FF1E293B', TEXT_MID  : 'FF475569',
  BORDER    : 'FFCBD5E1', GREEN     : 'FF16A34A', AMBER     : 'FFD97706', RED: 'FFDC2626',
};

const border = (color = C.BORDER): Partial<ExcelJS.Borders> => ({
  top   : { style: 'thin', color: { argb: color } },
  left  : { style: 'thin', color: { argb: color } },
  bottom: { style: 'thin', color: { argb: color } },
  right : { style: 'thin', color: { argb: color } },
});

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function fmt(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function fmtPct(v: number) { return `${v.toFixed(2).replace('.', ',')}%`; }

async function saveWb(wb: ExcelJS.Workbook, name: string) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function metaRows(ws: ExcelJS.Worksheet, engConfig: EngineeringConfig | undefined, items: any[]) {
  const cfg = engConfig || {} as any;
  const obra = cfg.obraDescricao || '—';
  const banks = [...new Set((items || []).map((i: any) => i.sourceName).filter(Boolean))].join(', ') || '—';
  const regime = cfg.regimeOneracao || '—';
  const es = cfg.encargosSociais || {};
  const horista = es.horista ?? '—';
  const mensalista = es.mensalista ?? '—';

  const addMeta = (label: string, value: string) => {
    const r = ws.addRow([label, value]);
    r.getCell(1).font = { bold: true, size: 9, color: { argb: C.TEXT_MID } };
    r.getCell(2).font = { size: 9, color: { argb: C.TEXT_DARK } };
    r.getCell(1).fill = fill(C.GRAY_SUB);
    r.getCell(2).fill = fill(C.GRAY_SUB);
    for (let c = 1; c <= 2; c++) r.getCell(c).border = border();
    r.height = 16;
  };
  addMeta('Obra', obra);
  addMeta('Bancos', banks);
  addMeta('Regime', `${regime}   Encargos: H: ${horista}% / M: ${mensalista}%`);
  ws.addRow([]);
}

function headRow(ws: ExcelJS.Worksheet, cols: string[]) {
  const r = ws.addRow(cols);
  r.font = { bold: true, size: 8, color: { argb: C.WHITE } };
  r.height = 18;
  cols.forEach((_, i) => {
    r.getCell(i + 1).fill = fill(C.BLUE_DARK);
    r.getCell(i + 1).border = border(C.BLUE_DARK);
    r.getCell(i + 1).alignment = { horizontal: i >= 3 ? 'right' : 'left', vertical: 'middle', wrapText: true };
  });
}

function dataRow(ws: ExcelJS.Worksheet, vals: (string | number)[], idx: number, rightCols: number[]) {
  const r = ws.addRow(vals);
  const bg = idx % 2 === 0 ? C.WHITE : C.GRAY_ROW;
  r.height = 15;
  vals.forEach((_, i) => {
    r.getCell(i + 1).fill = fill(bg);
    r.getCell(i + 1).border = border();
    r.getCell(i + 1).font = { size: 9, color: { argb: C.TEXT_DARK } };
    r.getCell(i + 1).alignment = { horizontal: rightCols.includes(i + 1) ? 'right' : 'left', vertical: 'middle', wrapText: true };
  });
  return r;
}

function subtotalRow(ws: ExcelJS.Worksheet, label: string, value: string, colCount: number) {
  const r = ws.addRow([...Array(colCount - 2).fill(''), label, value]);
  r.height = 16;
  for (let i = 1; i <= colCount; i++) {
    const c = r.getCell(i);
    c.fill = fill(C.GRAY_SUB);
    c.border = border(C.BORDER);
    c.font = { bold: true, size: 9, color: { argb: C.TEXT_DARK } };
    c.alignment = { horizontal: 'right', vertical: 'middle' };
  }
  ws.addRow([]);
}

function grandRow(ws: ExcelJS.Worksheet, label: string, values: string[], colCount: number) {
  const row = ws.addRow([...Array(colCount - values.length - 1).fill(''), label, ...values]);
  row.height = 20;
  for (let i = 1; i <= colCount; i++) {
    const c = row.getCell(i);
    c.fill = fill(C.BLUE_DARK);
    c.border = border(C.BLUE_DARK);
    c.font = { bold: true, size: 10, color: { argb: C.WHITE } };
    c.alignment = { horizontal: 'right', vertical: 'middle' };
  }
}

function bdiRows(ws: ExcelJS.Worksheet, items: any[], bdi: number, colCount: number) {
  const totalSemBdi = items.reduce((s: number, i: any) => {
    if (i.type === 'ETAPA' || i.type === 'SUBETAPA') return s;
    const qty = Number(i.quantity) || 0;
    const up  = Number(i.unitCost)  || Number(i.unitPrice) || 0;
    return s + qty * up;
  }, 0);
  const bdiRate = bdi > 1 ? bdi / 100 : bdi;
  const bdiVal  = totalSemBdi * bdiRate;
  const comBdi  = totalSemBdi + bdiVal;

  const mkRow = (label: string, value: string, isGrand = false) => {
    const r = ws.addRow([...Array(colCount - 2).fill(''), label, value]);
    r.height = isGrand ? 20 : 16;
    for (let i = 1; i <= colCount; i++) {
      const c = r.getCell(i);
      c.fill = fill(isGrand ? C.BLUE_DARK : C.GRAY_SUB);
      c.border = border(isGrand ? C.BLUE_DARK : C.BORDER);
      c.font = { bold: true, size: isGrand ? 10 : 9, color: { argb: isGrand ? C.WHITE : C.TEXT_DARK } };
      c.alignment = { horizontal: 'right', vertical: 'middle' };
    }
  };
  ws.addRow([]);
  mkRow('VALOR GLOBAL SEM BDI', fmt(totalSemBdi));
  mkRow(`VALOR DO BDI (${(bdiRate * 100).toFixed(2)}%)`, fmt(bdiVal));
  mkRow('VALOR GLOBAL COM BDI', fmt(comBdi), true);
}

function titleRow(ws: ExcelJS.Worksheet, title: string, colCount: number) {
  ws.mergeCells(ws.rowCount + 1, 1, ws.rowCount + 1, colCount);
  const r = ws.lastRow!;
  r.getCell(1).value = title;
  r.getCell(1).font = { bold: true, size: 14, color: { argb: C.TEXT_DARK } };
  r.getCell(1).fill = fill(C.WHITE);
  r.height = 24;
  ws.addRow([]);
}

function sectionHeaderRow(ws: ExcelJS.Worksheet, label: string, colCount: number) {
  ws.addRow([]);
  ws.mergeCells(ws.rowCount + 1, 1, ws.rowCount + 1, colCount);
  const r = ws.lastRow!;
  r.getCell(1).value = label;
  r.getCell(1).font  = { bold: true, size: 11, color: { argb: C.WHITE } };
  r.getCell(1).fill  = fill(C.BLUE_MED);
  r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  r.getCell(1).border = border(C.BLUE_MED);
  r.height = 20;
}

// ── 1. ORÇAMENTO RESUMIDO ────────────────────────────────────────────────────
export async function xlsOrcamentoResumido(items: any[], engConfig: EngineeringConfig | undefined, bdi: number) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Orçamento Resumido', { pageSetup: { paperSize: 9, orientation: 'portrait' } });
  ws.columns = [
    { width: 6 }, { width: 40 }, { width: 8 }, { width: 14 }, { width: 8 },
  ];

  titleRow(ws, 'ORÇAMENTO RESUMIDO', 5);
  metaRows(ws, engConfig, items);
  headRow(ws, ['Nº', 'ETAPA', 'ITENS', 'VALOR (R$)', '%']);

  const etapas = items.filter(i => i.type === 'ETAPA');
  const total  = etapas.reduce((s, e) => s + (Number(e.totalPrice) || 0), 0);
  let idx = 0;
  for (const e of etapas) {
    const v = Number(e.totalPrice) || 0;
    const pct = total > 0 ? (v / total * 100) : 0;
    const children = items.filter(i => i.parentId === e.id && i.type !== 'ETAPA');
    const r = dataRow(ws, [(e.itemNumber || ''), e.description, children.length, fmt(v), fmtPct(pct)], idx++, [3, 4, 5]);
    r.getCell(2).font = { bold: true, size: 9, color: { argb: C.TEXT_DARK } };
  }

  subtotalRow(ws, 'TOTAL GERAL', fmt(total), 5);
  bdiRows(ws, items, bdi, 5);
  await saveWb(wb, 'orcamento-resumido.xlsx');
}

// ── 2. ORÇAMENTO SINTÉTICO ───────────────────────────────────────────────────
export async function xlsOrcamentoSintetico(items: any[], engConfig: EngineeringConfig | undefined, bdi: number) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Orçamento Sintético', { pageSetup: { paperSize: 9, orientation: 'portrait' } });
  ws.columns = [{ width: 6 }, { width: 8 }, { width: 42 }, { width: 7 }, { width: 10 }, { width: 14 }, { width: 14 }, { width: 16 }];

  titleRow(ws, 'ORÇAMENTO SINTÉTICO', 8);
  metaRows(ws, engConfig, items);

  const etapas = items.filter(i => i.type === 'ETAPA');
  let grandTotal = 0;

  for (const etapa of etapas) {
    sectionHeaderRow(ws, `${etapa.itemNumber || ''} — ${etapa.description}`, 8);
    headRow(ws, ['ITEM', 'CÓDIGO', 'DESCRIÇÃO', 'UN.', 'QTD.', 'CUSTO UNIT.', 'PREÇO UNIT.', 'TOTAL']);
    const children = items.filter(i => i.parentId === etapa.id && i.type === 'COMPOSICAO');
    let etapaTotal = 0;
    let idx = 0;
    for (const item of children) {
      const qty       = Number(item.quantity) || 0;
      const unitCost  = Number(item.unitCost)  || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const total     = Number(item.totalPrice) || qty * unitPrice;
      etapaTotal += total;
      dataRow(ws, [item.itemNumber || '', item.code || '', item.description || '', item.unit || '', qty, fmt(unitCost), fmt(unitPrice), fmt(total)], idx++, [5, 6, 7, 8]);
    }
    grandTotal += etapaTotal;
    const subLabel = `Subtotal ${etapa.itemNumber || ''} — ${etapa.description}`;
    subtotalRow(ws, subLabel, fmt(etapaTotal), 8);
  }

  grandRow(ws, 'TOTAL GERAL', [fmt(grandTotal)], 8);
  bdiRows(ws, items, bdi, 8);
  await saveWb(wb, 'orcamento-sintetico.xlsx');
}

// ── 3. CURVA ABC SERVIÇOS ────────────────────────────────────────────────────
export async function xlsCurvaAbcServicos(items: any[], engConfig: EngineeringConfig | undefined, bdi: number) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ABC Serviços', { pageSetup: { paperSize: 9, orientation: 'landscape' } });
  ws.columns = [{ width: 6 }, { width: 8 }, { width: 10 }, { width: 42 }, { width: 7 }, { width: 10 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 8 }, { width: 8 }];

  titleRow(ws, 'CURVA ABC DE SERVIÇOS', 11);
  metaRows(ws, engConfig, items);
  headRow(ws, ['Nº', 'CÓDIGO', 'BANCO', 'DESCRIÇÃO', 'UN.', 'QTD.', 'CUSTO UNIT.', 'PREÇO UNIT.', 'TOTAL', '% ITEM', '% ACUM.']);

  const svcs = items.filter(i => i.type === 'COMPOSICAO' || (!['ETAPA','SUBETAPA'].includes(i.type) && i.code));
  const total = svcs.reduce((s, i) => s + (Number(i.totalPrice) || 0), 0);
  const sorted = [...svcs].sort((a, b) => (Number(b.totalPrice) || 0) - (Number(a.totalPrice) || 0));
  let acum = 0;
  sorted.forEach((item, idx) => {
    const v   = Number(item.totalPrice) || 0;
    const pct = total > 0 ? v / total * 100 : 0;
    acum += pct;
    const cls = acum <= 50 ? C.RED : acum <= 80 ? C.AMBER : C.GREEN;
    const r = dataRow(ws, [idx + 1, item.code || '', item.sourceName || '', item.description || '', item.unit || '', Number(item.quantity) || 0, fmt(Number(item.unitCost) || 0), fmt(Number(item.unitPrice) || 0), fmt(v), fmtPct(pct), fmtPct(acum)], idx, [6, 7, 8, 9, 10, 11]);
    r.getCell(10).font = { bold: true, size: 9, color: { argb: cls } };
    r.getCell(11).font = { bold: true, size: 9, color: { argb: cls } };
  });

  grandRow(ws, 'TOTAL', [fmt(total), '100,00%', ''], 11);
  bdiRows(ws, items, bdi, 11);
  await saveWb(wb, 'abc-servicos.xlsx');
}

// ── 4. BDI E ENCARGOS SOCIAIS ────────────────────────────────────────────────
export async function xlsBdiEncargos(engConfig: EngineeringConfig | undefined, bdi: number) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BDI e Encargos', { pageSetup: { paperSize: 9, orientation: 'portrait' } });
  ws.columns = [{ width: 8 }, { width: 45 }, { width: 14 }, { width: 14 }];

  titleRow(ws, 'BDI E ENCARGOS SOCIAIS', 4);

  const isDesonerado = (engConfig?.regimeOneracao || 'DESONERADO') === 'DESONERADO';
  const es = engConfig?.encargosSociais || {} as any;
  const def: Record<string, number> = {
    a1_h: isDesonerado ? 0 : 20, a1_m: isDesonerado ? 0 : 20,
    a2_h:1.5,a2_m:1.5,a3_h:1,a3_m:1,a4_h:0.2,a4_m:0.2,a5_h:0.6,a5_m:0.6,
    a6_h:2.5,a6_m:2.5,a7_h:3,a7_m:3,a8_h:8,a8_m:8,a9_h:0,a9_m:0,
    b1_h:17.84,b1_m:0,b2_h:3.71,b2_m:0,b3_h:0.87,b3_m:0.67,b4_h:10.8,b4_m:8.33,
    b5_h:0.07,b5_m:0.06,b6_h:0.72,b6_m:0.56,b7_h:1.55,b7_m:0,b8_h:0.11,b8_m:0.08,
    b9_h:8.71,b9_m:6.73,b10_h:0.03,b10_m:0.03,
    c1_h:5.4,c1_m:4.17,c2_h:0.13,c2_m:0.1,c3_h:4.85,c3_m:3.75,c4_h:3.9,c4_m:3.01,c5_h:0.45,c5_m:0.35,
    d1_h:0,d1_m:0,d2_h:0,d2_m:0,
  };
  const v = (k: string) => typeof es[k] === 'number' ? es[k] : (def[k] ?? 0);

  const groups = [
    { label:'Grupo A — Encargos Sociais Básicos', items:[
      ['A1','INSS','a1'],['A2','SESI','a2'],['A3','SENAI','a3'],['A4','INCRA','a4'],
      ['A5','SEBRAE','a5'],['A6','Salário Educação','a6'],['A7','Seguro Contra Acidentes','a7'],
      ['A8','FGTS','a8'],['A9','SECONCI','a9'],
    ]},
    { label:'Grupo B — Encargos Trabalhistas', items:[
      ['B1','Repouso Semanal Remunerado','b1'],['B2','Feriados','b2'],['B3','Auxílio Enfermidade','b3'],
      ['B4','13º Salário','b4'],['B5','Licença Paternidade','b5'],['B6','Faltas Justificadas','b6'],
      ['B7','Dias de Chuvas','b7'],['B8','Auxílio Acidente de Trabalho','b8'],
      ['B9','Férias Gozadas','b9'],['B10','Salário Maternidade','b10'],
    ]},
    { label:'Grupo C — Encargos Rescisórios', items:[
      ['C1','Aviso Prévio Indenizado','c1'],['C2','Aviso Prévio Trabalhado','c2'],
      ['C3','Férias Indenizadas','c3'],['C4','Depósito Rescisão','c4'],['C5','Indenização Adicional','c5'],
    ]},
    { label:'Grupo D — Reincidências', items:[
      ['D1','Reincidência de Grupo A sobre Grupo B','d1'],
      ['D2','Reinc. Grupo A s/ Aviso Prévio Trab. e FGTS','d2'],
    ]},
  ];

  headRow(ws, ['CÓD', 'DESCRIÇÃO', 'HORISTA %', 'MENSALISTA %']);
  let totalH = 0, totalM = 0;

  for (const g of groups) {
    const secRow = ws.addRow([g.label]);
    ws.mergeCells(secRow.number, 1, secRow.number, 4);
    secRow.getCell(1).fill = fill(C.BLUE_LIGHT);
    secRow.getCell(1).font = { bold: true, size: 9, color: { argb: C.BLUE_MED } };
    secRow.getCell(1).border = border(C.BLUE_MED);
    secRow.height = 16;

    let subH = 0, subM = 0;
    g.items.forEach(([cod, desc, key], idx) => {
      const h = v(`${key}_h`), m = v(`${key}_m`);
      subH += h; subM += m;
      const r = dataRow(ws, [cod, desc, fmtPct(h), fmtPct(m)], idx, [3, 4]);
      r.getCell(1).font = { bold: true, size: 9, color: { argb: C.BLUE_MED } };
    });
    totalH += subH; totalM += subM;
    const sr = ws.addRow(['', `Subtotal ${g.label.split(' — ')[0]}`, fmtPct(subH), fmtPct(subM)]);
    sr.height = 16;
    for (let i = 1; i <= 4; i++) {
      sr.getCell(i).fill = fill(C.GRAY_SUB);
      sr.getCell(i).font = { bold: true, size: 9 };
      sr.getCell(i).border = border();
      sr.getCell(i).alignment = { horizontal: i >= 3 ? 'right' : 'left' };
    }
    ws.addRow([]);
  }

  grandRow(ws, 'A + B + C + D =', [fmtPct(totalH), fmtPct(totalM)], 4);
  await saveWb(wb, 'bdi-encargos.xlsx');
}

// ── 5. CRONOGRAMA FÍSICO-FINANCEIRO ─────────────────────────────────────────
export async function xlsCronograma(result: any, engConfig: EngineeringConfig | undefined) {
  const etapas  = result?.etapas || result?.items?.filter((i: any) => i.type === 'ETAPA') || [];
  const meses   = Math.max(result?.meses || 3, etapas.length > 0 ? Math.max(...etapas.map((e: any) => e.meses || 1)) : 3);
  const colCount = 3 + meses + 1;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cronograma', { pageSetup: { paperSize: 9, orientation: 'landscape' } });
  const widths = [{ width: 6 }, { width: 40 }, { width: 14 }];
  for (let m = 0; m < meses; m++) widths.push({ width: 10 });
  widths.push({ width: 12 });
  ws.columns = widths;

  titleRow(ws, 'CRONOGRAMA FÍSICO-FINANCEIRO', colCount);
  metaRows(ws, engConfig, etapas);

  const header = ['Nº', 'ETAPA', 'VALOR (R$)', ...Array.from({ length: meses }, (_, i) => `Mês ${i + 1}`), 'TOTAL %'];
  headRow(ws, header);

  const totalGlobal = etapas.reduce((s: number, e: any) => s + (Number(e.totalPrice) || 0), 0);
  let idx = 0;
  for (const e of etapas) {
    const v    = Number(e.totalPrice) || 0;
    const pct  = totalGlobal > 0 ? v / totalGlobal * 100 : 0;
    const dist = Array.from({ length: meses }, (_, m) => {
      if (!e.meses) return m === 0 ? fmt(v) : '';
      return m < e.meses ? fmt(v / e.meses) : '';
    });
    dataRow(ws, [e.itemNumber || '', e.description || '', fmt(v), ...dist, fmtPct(pct)], idx++, Array.from({ length: meses + 2 }, (_, i) => i + 3));
  }

  grandRow(ws, 'TOTAL GERAL', [fmt(totalGlobal), ...Array(meses).fill(''), '100,00%'], colCount);
  await saveWb(wb, 'cronograma.xlsx');
}

// ── 6. CURVA ABC INSUMOS ─────────────────────────────────────────────────────
export async function xlsCurvaAbcInsumos(insumos: any[], engConfig: EngineeringConfig | undefined) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ABC Insumos', { pageSetup: { paperSize: 9, orientation: 'landscape' } });
  ws.columns = [{ width: 6 }, { width: 10 }, { width: 12 }, { width: 42 }, { width: 7 }, { width: 14 }, { width: 10 }, { width: 10 }];

  titleRow(ws, 'CURVA ABC DE INSUMOS', 8);
  metaRows(ws, engConfig, insumos);
  headRow(ws, ['Nº', 'CÓDIGO', 'CATEGORIA', 'DESCRIÇÃO', 'UN.', 'CUSTO TOTAL', '% ITEM', '% ACUM.']);

  const list = [...(insumos || [])].sort((a, b) => (Number(b.custoTotal) || 0) - (Number(a.custoTotal) || 0));
  const total = list.reduce((s, i) => s + (Number(i.custoTotal) || 0), 0);
  let acum = 0;
  list.forEach((item, idx) => {
    const v = Number(item.custoTotal) || 0;
    const pct = total > 0 ? v / total * 100 : 0;
    acum += pct;
    const cls = acum <= 50 ? C.RED : acum <= 80 ? C.AMBER : C.GREEN;
    const r = dataRow(ws, [idx + 1, item.codigo || '', item.categoria || '', item.descricao || '', item.unidade || '', fmt(v), fmtPct(pct), fmtPct(acum)], idx, [6, 7, 8]);
    r.getCell(7).font = { bold: true, size: 9, color: { argb: cls } };
    r.getCell(8).font = { bold: true, size: 9, color: { argb: cls } };
  });

  grandRow(ws, 'TOTAL', [fmt(total), '100,00%', ''], 8);
  await saveWb(wb, 'abc-insumos.xlsx');
}
