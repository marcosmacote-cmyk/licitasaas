import ExcelJS from 'exceljs';
import type { EngineeringConfig, ColorPalette, EncargosSociaisConfig } from './types';
import { isGrouper, DEFAULT_COLOR_PALETTE, displaySourceName } from './types';
import type { BdiConfig } from './bdiEngine';
import { calculateBdiTCU, DEFAULT_TCU_FORNECIMENTO_PARAMS } from './bdiEngine';
import { applyPrecision as applyPrecisionNum } from './precisionEngine';
import { getOrientation } from './budgetDocGenerator';
import { CATEGORIA_META, type InsumoCategoria } from './insumoEngine';

function fmtQty(v: number) { return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const cleanCodeForDisplay = (code: string) => {
    return (code || '').replace(/\/(?:ORSE|SINAPI|SEINFRA|SICRO)$/i, '').trim();
};

const cleanUnitForDisplay = (unit: string) => {
    const u = (unit || '').trim().toUpperCase();
    if (u === 'M2' || u === 'M²') return 'M²';
    if (u === 'M3' || u === 'M³') return 'M³';
    return unit;
};

function safeParseJson(val: any): any {
    if (!val) return null;
    if (typeof val === 'object') return val;
    if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed) return null;
        try {
            return JSON.parse(trimmed);
        } catch {
            return null;
        }
    }
    return null;
}

// Replicate groupByChapter from budgetDocGenerator for consistent data

function applyPrecision(formulaStr: string, engConfig?: EngineeringConfig): string {
    if (!engConfig?.precision) return formulaStr;
    const tipo = engConfig.precision.tipo;
    const casasDecimais = typeof engConfig.precision.casasDecimais === 'number' ? engConfig.precision.casasDecimais : 2;
    if (tipo === 'ROUND') {
        return `ROUND(${formulaStr}, ${casasDecimais})`;
    } else if (tipo === 'TRUNCATE') {
        return `TRUNC(${formulaStr}, ${casasDecimais})`;
    }
    return formulaStr;
}

function colToLetter(col: number): string {
  let temp = col;
  let letter = '';
  while (temp > 0) {
    let modulo = (temp - 1) % 26;
    letter = String.fromCharCode(65 + modulo) + letter;
    temp = Math.floor((temp - modulo) / 26);
  }
  return letter;
}


function groupByChapter(items: any[]) {
  const map = new Map<string, { items: any[]; total: number; title: string }>();
  for (const it of items) {
    const prefix = (it.itemNumber || '1').split('.')[0] || '1';
    if (!map.has(prefix)) map.set(prefix, { items: [], total: 0, title: `Etapa ${prefix}` });
    const g = map.get(prefix)!;
    if (it.type === 'ETAPA') {
      if (it.description) {
        g.title = `${prefix} — ${it.description}`;
      }
      continue;
    }
    g.items.push(it);
    if (it.type !== 'SUBETAPA') {
      g.total += Number(it.totalPrice) || 0;
    }
  }
  return map;
}

/** Convert CSS hex (#1e40af) to ARGB (FF1E40AF) for ExcelJS */
function hexToArgb(hex: string): string {
  const clean = hex.replace('#', '').toUpperCase();
  return `FF${clean.padStart(6, '0')}`;
}

/** Lighten a hex color by a given amount (0-1) for subtle backgrounds */
function lightenHex(hex: string, amount: number = 0.9): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `FF${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`.toUpperCase();
}

/** Resolve a paleta de cores do reportConfig */
function resolvePalette(engConfig?: EngineeringConfig): ColorPalette {
  return { ...DEFAULT_COLOR_PALETTE, ...(engConfig?.reportConfig?.colorPalette || {}) };
}

/** Build ExcelJS color palette from user config */
function buildExcelColors(palette: ColorPalette) {
  return {
    BLUE_DARK : hexToArgb(palette.primary),
    BLUE_MED  : hexToArgb(palette.accent),
    BLUE_LIGHT: lightenHex(palette.accent, 0.88),
    ETAPA_BG  : hexToArgb(palette.etapaBg),
    COMP_BG   : hexToArgb(palette.composicaoBg),
    INSUMO_BG : hexToArgb(palette.insumoBg),
    SUB_BG    : hexToArgb(palette.subtotalBg),
    GRAY_HEAD : 'FFE2E8F0', GRAY_SUB  : 'FFF1F5F9', GRAY_ROW  : 'FFF8FAFC',
    WHITE     : 'FFFFFFFF', TEXT_DARK : 'FF1E293B', TEXT_MID  : 'FF475569',
    BORDER    : 'FFCBD5E1', GREEN     : 'FF16A34A', AMBER     : 'FFD97706', RED: 'FFDC2626',
  };
}

// ── Default static palette (used when no engConfig is available) ──
const C = buildExcelColors(DEFAULT_COLOR_PALETTE);

const border = (color = C.BORDER): Partial<ExcelJS.Borders> => ({
  top   : { style: 'thin', color: { argb: color } },
  left  : { style: 'thin', color: { argb: color } },
  bottom: { style: 'thin', color: { argb: color } },
  right : { style: 'thin', color: { argb: color } },
});

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

let activePrecisionCasas = 2;

function fmt(v: number) {
  return `R$ ${v.toFixed(activePrecisionCasas).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function fmtPct(v: number) { return `${v.toFixed(2).replace('.', ',')}%`; }

function setGlobalPrecision(engConfig?: EngineeringConfig) {
  activePrecisionCasas = typeof engConfig?.precision?.casasDecimais === 'number' 
    ? engConfig.precision.casasDecimais 
    : 2;
}

async function saveWb(wb: ExcelJS.Workbook, name: string, returnBuffer?: boolean): Promise<ArrayBuffer | void> {
  const buf = await wb.xlsx.writeBuffer();
  if (returnBuffer) return buf as ArrayBuffer;
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function setupPrint(ws: ExcelJS.Worksheet, landscape = false, reportConfig?: any) {
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: landscape ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0, // auto pages vertically
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
  };
  const rc = reportConfig || {};
  // Custom header (3 lines max: &L left, &C center, &R right — we center all)
  const hdrLines = [rc.headerLine1, rc.headerLine2, rc.headerLine3].filter(Boolean);
  if (hdrLines.length > 0) {
    const hdr = hdrLines.map((l: string, i: number) => i === 0 ? `&"Segoe UI,Bold"&10${l}` : `&"Segoe UI"&8${l}`).join('\n');
    ws.headerFooter = {
      oddHeader: `&C${hdr}`,
      oddFooter: buildFooter(rc),
    };
  } else {
    ws.headerFooter = { oddFooter: buildFooter(rc) };
  }
}

function buildFooter(rc: any): string {
  const now = new Date();
  const d = now.toLocaleDateString('pt-BR');
  const t = now.toLocaleTimeString('pt-BR');
  const left = (rc.footerLine1 || `LicitaSaaS — ${d} ${t}`).replace('{data}', d).replace('{hora}', t);
  const right = (rc.footerLine2 || 'Página &P de &N').replace('{pagina}', '&P').replace('{total}', '&N');
  return `&L${left}&R${right}`;
}

function metaRows(ws: ExcelJS.Worksheet, engConfig: EngineeringConfig | undefined, _items: any[], colCount: number) {
  const cfg = engConfig || {} as any;
  const obra = cfg.objeto || '—';
  const banks = cfg.basesConsideradas?.join(', ') || '—';
  const dataBase = cfg.dataBase || '—';
  const uf = cfg.ufReferencia || '—';
  const regime = cfg.regimeOneracao || '—';
  const es = cfg.encargosSociais || {} as any;
  const horista = es.horista ?? '—';
  const mensalista = es.mensalista ?? '—';

  const addMeta = (label: string, value: string) => {
    const rn = ws.rowCount + 1;
    const r = ws.addRow([label, value, ...Array(Math.max(0, colCount - 2)).fill('')]);
    // Merge value cell across all remaining columns
    if (colCount > 2) ws.mergeCells(rn, 2, rn, colCount);
    r.getCell(1).font = { bold: true, size: 9, color: { argb: C.TEXT_MID } };
    r.getCell(2).font = { size: 9, color: { argb: C.TEXT_DARK } };
    r.getCell(2).alignment = { vertical: 'middle', wrapText: true };
    for (let c = 1; c <= colCount; c++) {
      r.getCell(c).fill = fill(C.GRAY_SUB);
      r.getCell(c).border = border();
    }
    r.height = 16;
  };
  addMeta('Obra', obra);
  addMeta('Bancos', `${banks}    Data-Base: ${dataBase}    UF: ${uf}`);
  addMeta('Regime', `${regime}    Encargos Sociais: ${regime} (H: ${horista}% / M: ${mensalista}%)`);
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

function dataRow(ws: ExcelJS.Worksheet, vals: any[], idx: number, rightCols: number[]) {
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
  const rn = ws.rowCount + 1;
  const r = ws.addRow([label, ...Array(Math.max(0, colCount - 2)).fill(''), value]);
  // Merge label across all columns except the last (value)
  if (colCount > 2) ws.mergeCells(rn, 1, rn, colCount - 1);
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
  const rn = ws.rowCount + 1;
  const row = ws.addRow([label, ...Array(Math.max(0, colCount - values.length - 1)).fill(''), ...values]);
  // Merge label across columns before the value columns
  const labelEnd = colCount - values.length;
  if (labelEnd > 1) ws.mergeCells(rn, 1, rn, labelEnd);
  row.height = 20;
  for (let i = 1; i <= colCount; i++) {
    const c = row.getCell(i);
    c.fill = fill(C.BLUE_DARK);
    c.border = border(C.BLUE_DARK);
    c.font = { bold: true, size: 10, color: { argb: C.WHITE } };
    c.alignment = { horizontal: 'right', vertical: 'middle' };
  }
}

// BDI tripé — matches PDF renderGlobalTotals exactly
function bdiRows(ws: ExcelJS.Worksheet, items: any[], bdi: number, colCount: number, totalCellRef?: string) {
  // Same logic as PDF: Sem BDI = unitCost * quantity, Com BDI = totalPrice
  const billable = items.filter((i: any) => !isGrouper(i.type));
  const totalComBdi = billable.reduce((s: number, i: any) => s + (Number(i.totalPrice) || 0), 0);
  const totalSemBdi = billable.reduce((s: number, i: any) => {
    return s + (Number(i.unitCost) || 0) * (Number(i.quantity) || 0);
  }, 0);
  const valorBdi = totalComBdi - totalSemBdi;
  const bdiRate = bdi > 1 ? bdi / 100 : bdi;
  const bdiColLetter = colToLetter(colCount);

  const formatBdiRow = (r: ExcelJS.Row, isGrand: boolean) => {
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
  
  const rnSem = ws.rowCount + 1;
  const rSem = ws.addRow([
    'VALOR GLOBAL SEM BDI', 
    ...Array(Math.max(0, colCount - 2)).fill(''), 
    totalCellRef ? { formula: `ROUND(${totalCellRef}/(1+${bdiRate}), 2)` } : totalSemBdi
  ]);
  ws.mergeCells(rnSem, 1, rnSem, colCount - 1);
  rSem.getCell(colCount).numFmt = '#,##0.00';
  formatBdiRow(rSem, false);

  const rnVal = ws.rowCount + 1;
  const rVal = ws.addRow([
    `VALOR DO BDI (${(bdiRate * 100).toFixed(2)}%)`, 
    ...Array(Math.max(0, colCount - 2)).fill(''), 
    totalCellRef ? { formula: `ROUND(${totalCellRef}-${bdiColLetter}${rnSem}, 2)` } : valorBdi
  ]);
  ws.mergeCells(rnVal, 1, rnVal, colCount - 1);
  rVal.getCell(colCount).numFmt = '#,##0.00';
  formatBdiRow(rVal, false);

  const rnCom = ws.rowCount + 1;
  const rCom = ws.addRow([
    'VALOR GLOBAL COM BDI', 
    ...Array(Math.max(0, colCount - 2)).fill(''), 
    totalCellRef ? { formula: totalCellRef } : totalComBdi
  ]);
  ws.mergeCells(rnCom, 1, rnCom, colCount - 1);
  rCom.getCell(colCount).numFmt = '#,##0.00';
  formatBdiRow(rCom, true);
}

/** Insert company logo as embedded image in the worksheet header area */
function logoRow(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, colCount: number, reportConfig?: any) {
  const rc = reportConfig || {};
  const logoB64 = rc.logoBase64 || '';
  if (!logoB64) return;

  try {
    // Extract raw Base64 and extension from data URI
    const match = logoB64.match(/^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/i);
    if (!match) return;
    const ext = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
    const b64data = match[2];

    const imageId = wb.addImage({ base64: b64data, extension: ext as 'png' | 'jpeg' | 'gif' });

    const maxH = rc.logoMaxHeight || 50;
    // ExcelJS row height in points: ~0.75pt per px → 50px ≈ 38pt, add buffer
    const rowH = Math.max(28, Math.round(maxH * 0.8));

    // Add an empty row for the logo
    const rn = ws.rowCount + 1;
    ws.addRow(Array(colCount).fill(''));
    ws.mergeCells(rn, 1, rn, colCount);
    ws.getRow(rn).height = rowH;

    // Position logo based on logoPosition
    const pos = rc.logoPosition || 'left';
    let col0 = 0; // 0-indexed column
    if (pos === 'center') col0 = Math.max(0, Math.floor((colCount - 2) / 2));
    else if (pos === 'right') col0 = Math.max(0, colCount - 3);

    ws.addImage(imageId, {
      tl: { col: col0, row: rn - 1 } as any,
      ext: { width: 200, height: maxH },
    });
  } catch (e) {
    // Silently skip logo if Base64 is invalid
    console.warn('Logo insertion failed:', e);
  }
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

// ── 1. ORÇAMENTO RESUMIDO — with numeric values & formulas ───────────────────
export async function xlsOrcamentoResumido(items: any[], engConfig: EngineeringConfig | undefined, bdi: number, returnBuffer?: boolean) {
  setGlobalPrecision(engConfig);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Orçamento Resumido');
  setupPrint(ws, getOrientation('resumido', engConfig?.reportConfig, false), engConfig?.reportConfig);
  ws.columns = [{ width: 6 }, { width: 40 }, { width: 8 }, { width: 16 }, { width: 10 }];
  logoRow(wb, ws, 5, engConfig?.reportConfig);

  const billable = items.filter((i: any) => !isGrouper(i.type));
  const chapters = groupByChapter(items);
  const total = billable.reduce((s: number, i: any) => s + (Number(i.totalPrice) || 0), 0);

  titleRow(ws, 'ORÇAMENTO RESUMIDO', 5);
  const bdiRate = bdi > 1 ? bdi / 100 : bdi;
  const rn0 = ws.rowCount + 1;
  const r0 = ws.addRow([`BDI: ${(bdiRate * 100).toFixed(2)}% · ${billable.length} itens`]);
  ws.mergeCells(rn0, 1, rn0, 5);
  r0.getCell(1).font = { size: 9, color: { argb: C.TEXT_MID } };
  ws.addRow([]);
  metaRows(ws, engConfig, items, 5);
  headRow(ws, ['Nº', 'ETAPA', 'ITENS', 'VALOR (R$)', '%']);

  const dataRowNums: number[] = [];
  let idx = 0;
  const firstDataRow = ws.rowCount + 1;
  const gRn = firstDataRow + chapters.size;
  for (const [prefix, ch] of chapters) {
    const billableCount = ch.items.filter((i: any) => !isGrouper(i.type)).length;
    const r = dataRow(ws, [prefix, ch.title, billableCount, ch.total, 0], idx++, [3, 4, 5]);
    r.getCell(2).font = { bold: true, size: 9, color: { argb: C.TEXT_DARK } };
    r.getCell(4).numFmt = '#,##0.00';
    const rn = ws.rowCount;
    dataRowNums.push(rn);
    r.getCell(5).numFmt = '0.00%';
    if (engConfig?.reportConfig?.exportExcelWithFormulas) {
      r.getCell(5).value = { formula: `D${rn}/D${gRn}` } as any;
    } else {
      r.getCell(5).value = total > 0 ? ch.total / total : 0;
    }
  }

  // Grand total with SUM formula
  const totalRowIndex = ws.rowCount + 1;
  const gRow = ws.addRow(['TOTAL GERAL', '', '', '', '']);
  ws.mergeCells(totalRowIndex, 1, totalRowIndex, 3);
  if (dataRowNums.length > 0) {
    gRow.getCell(4).value = { formula: `SUM(D${dataRowNums[0]}:D${dataRowNums[dataRowNums.length - 1]})` } as any;
  } else {
    gRow.getCell(4).value = total;
  }
  gRow.getCell(4).numFmt = '#,##0.00';
  gRow.getCell(5).value = 1;
  gRow.getCell(5).numFmt = '0.00%';
  gRow.height = 20;
  for (let i = 1; i <= 5; i++) {
    const c = gRow.getCell(i);
    c.fill = fill(C.BLUE_DARK);
    c.border = border(C.BLUE_DARK);
    c.font = { bold: true, size: 10, color: { argb: C.WHITE } };
    c.alignment = { horizontal: 'right', vertical: 'middle' };
  }

  bdiRows(ws, items, bdi, 5, `D${totalRowIndex}`);
  return saveWb(wb, 'orcamento-resumido.xlsx', returnBuffer);
}

// ── 2. ORÇAMENTO SINTÉTICO — with Base column, toggles & formulas ────────────
export async function xlsOrcamentoSintetico(items: any[], engConfig: EngineeringConfig | undefined, bdi: number, returnBuffer?: boolean) {
  setGlobalPrecision(engConfig);
  const rc = engConfig?.reportConfig || {} as any;
  const showCU = rc.showCustoUnit !== false;
  const showPU = rc.showPrecoUnit !== false;
  const p = resolvePalette(engConfig);
  const pc = buildExcelColors(p);

  // Dynamic column set: ITEM | CÓDIGO | BASE | DESCRIÇÃO | UN. | QTD. | [CU] | [PU] | TOTAL
  const headers: string[] = ['ITEM', 'CÓDIGO', 'BASE', 'DESCRIÇÃO', 'UN.', 'QTD.'];
  const widths: { width: number }[] = [{ width: 6 }, { width: 8 }, { width: 10 }, { width: 42 }, { width: 7 }, { width: 10 }];
  if (showCU) { headers.push('CUSTO UNIT.'); widths.push({ width: 14 }); }
  if (showPU) { headers.push('PREÇO UNIT.'); widths.push({ width: 14 }); }
  headers.push('TOTAL');
  widths.push({ width: 16 });
  const colCount = headers.length;
  const totalColIdx = colCount; // 1-indexed

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Orçamento Sintético');
  setupPrint(ws, getOrientation('sintetico', rc, false), rc);
  ws.columns = widths;
  logoRow(wb, ws, colCount, rc);

  const billable = items.filter((i: any) => !isGrouper(i.type));
  const chapters = groupByChapter(items);
  const total = billable.reduce((s: number, i: any) => s + (Number(i.totalPrice) || 0), 0);

  titleRow(ws, 'ORÇAMENTO SINTÉTICO', colCount);
  const bdiRate = bdi > 1 ? bdi / 100 : bdi;
  const rn0 = ws.rowCount + 1;
  const r0 = ws.addRow([`BDI: ${(bdiRate * 100).toFixed(2)}% · ${billable.length} itens`]);
  ws.mergeCells(rn0, 1, rn0, colCount);
  r0.getCell(1).font = { size: 9, color: { argb: pc.TEXT_MID } };
  ws.addRow([]);
  metaRows(ws, engConfig, items, colCount);

  const subtotalRowNums: number[] = [];

  for (const [, ch] of chapters) {
    sectionHeaderRow(ws, ch.title, colCount);
    headRow(ws, headers);
    const firstDataRow = ws.rowCount + 1;
    let idx = 0;
    for (const it of ch.items) {
      if (it.type === 'SUBETAPA') {
        const rn = ws.rowCount + 1;
        const r = ws.addRow([it.itemNumber || '', it.description || '', ...Array(Math.max(0, colCount - 2)).fill('')]);
        if (colCount > 2) ws.mergeCells(rn, 2, rn, colCount);
        r.height = 16;
        for (let i = 1; i <= colCount; i++) {
          const c = r.getCell(i);
          c.fill = fill(pc.GRAY_SUB);
          c.border = border();
          c.font = { bold: true, size: 9, color: { argb: pc.BLUE_MED } };
          c.alignment = { vertical: 'middle', horizontal: 'left', indent: i === 2 ? 1 : 0 };
        }
        continue;
      }

      const qty = Number(it.quantity) || 0;
      const uc  = Number(it.unitCost) || 0;
      const up  = Number(it.unitPrice) || 0;
      const tp  = Number(it.totalPrice) || 0;
      const vals: any[] = [it.itemNumber || '', cleanCodeForDisplay(it.code || ''), displaySourceName(it.sourceName) || '—', it.description || '', cleanUnitForDisplay(it.unit || ''), qty];
      if (showCU) vals.push(uc);
      if (showPU) vals.push(up);
      let totalVal: any = tp;
      if (engConfig?.reportConfig?.exportExcelWithFormulas && qty > 0) {
        if (showPU && up > 0) {
          const puColLetter = colToLetter(totalColIdx - 1);
          totalVal = { formula: applyPrecision(`F${ws.rowCount + 1}*${puColLetter}${ws.rowCount + 1}`, engConfig) };
        } else if (!showPU && showCU && uc > 0) {
          const cuColLetter = colToLetter(totalColIdx - 1);
          totalVal = { formula: applyPrecision(`F${ws.rowCount + 1}*${cuColLetter}${ws.rowCount + 1}`, engConfig) };
        }
      }
      vals.push(totalVal);
      const r = dataRow(ws, vals, idx++, Array.from({ length: colCount - 5 }, (_, i) => 6 + i));
      // Apply number format to numeric cells
      const qtyCol = 6;
      r.getCell(qtyCol).numFmt = '#,##0.00##';
      let ci = qtyCol + 1;
      if (showCU) { r.getCell(ci).numFmt = '#,##0.00'; ci++; }
      if (showPU) { r.getCell(ci).numFmt = '#,##0.00'; ci++; }
      r.getCell(totalColIdx).numFmt = '#,##0.00';
    }
    const lastDataRow = ws.rowCount;
    // Subtotal with SUM formula
    const stRn = ws.rowCount + 1;
    const stRow = ws.addRow([`Subtotal ${ch.title}`, ...Array(colCount - 2).fill(''), '']);
    ws.mergeCells(stRn, 1, stRn, colCount - 1);
    stRow.height = 16;
    // SUM formula for total column
    const totalColLetter = String.fromCharCode(64 + totalColIdx);
    if (firstDataRow <= lastDataRow) {
      stRow.getCell(totalColIdx).value = { formula: `SUM(${totalColLetter}${firstDataRow}:${totalColLetter}${lastDataRow})` } as any;
    } else {
      stRow.getCell(totalColIdx).value = 0;
    }
    stRow.getCell(totalColIdx).numFmt = '#,##0.00';
    for (let i = 1; i <= colCount; i++) {
      const c = stRow.getCell(i);
      c.fill = fill(pc.SUB_BG);
      c.border = border(pc.BORDER);
      c.font = { bold: true, size: 9, color: { argb: pc.TEXT_DARK } };
      c.alignment = { horizontal: 'right', vertical: 'middle' };
    }
    subtotalRowNums.push(stRn);
    ws.addRow([]);
  }

  // Grand total with SUM of subtotals
  const gRn = ws.rowCount + 1;
  const gRow = ws.addRow(['TOTAL GERAL DO ORÇAMENTO', ...Array(colCount - 2).fill(''), '']);
  if (colCount > 2) ws.mergeCells(gRn, 1, gRn, colCount - 1);
  const totalColLetter = String.fromCharCode(64 + totalColIdx);
  if (subtotalRowNums.length > 0) {
    const sumRefs = subtotalRowNums.map(rn => `${totalColLetter}${rn}`).join('+');
    gRow.getCell(totalColIdx).value = { formula: sumRefs } as any;
  } else {
    gRow.getCell(totalColIdx).value = total;
  }
  gRow.getCell(totalColIdx).numFmt = '#,##0.00';
  gRow.height = 20;
  for (let i = 1; i <= colCount; i++) {
    const c = gRow.getCell(i);
    c.fill = fill(pc.BLUE_DARK);
    c.border = border(pc.BLUE_DARK);
    c.font = { bold: true, size: 10, color: { argb: pc.WHITE } };
    c.alignment = { horizontal: 'right', vertical: 'middle' };
  }

  bdiRows(ws, items, bdi, colCount, `${totalColLetter}${gRn}`);
  return saveWb(wb, 'orcamento-sintetico.xlsx', returnBuffer);
}

// Helper: fetch analytical report from backend (same API as PDF)
async function fetchAnalyticalReport(proposalId: string, items: any[], bdi: number, engConfig: any) {
  const token = localStorage.getItem('token') || '';
  const res = await fetch(`/api/engineering/proposals/${proposalId}/analytical-report`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, bdi, engineeringConfig: engConfig }),
  });
  if (!res.ok) throw new Error('Falha ao carregar relatório analítico');
  return res.json();
}

// Helper: render one composition as Excel rows
function renderCompXls(ws: ExcelJS.Worksheet, comp: any, showQty: boolean, engConfig?: EngineeringConfig, bdi?: number) {
  // Grouping metadata
  const metadata = safeParseJson(comp.metadata) || {};
  const isDirectInsumo = metadata?._isDirectInsumo === true;

  // Header row for the composition
  const rn = ws.rowCount + 1;
  const badge = comp.itemNumbers?.length ? `[${comp.itemNumbers.join(', ')}] ` : '';
  const hdr = ws.addRow([`${badge}${cleanCodeForDisplay(comp.code || 'N/A')} — ${comp.description}`, '', '', '', '', '', `Banco: ${displaySourceName(comp.sourceName) || ''}`, `Unidade: ${cleanUnitForDisplay(comp.unit || '')}`]);
  ws.mergeCells(rn, 1, rn, 6);
  hdr.height = 18;
  for (let i = 1; i <= 8; i++) {
    hdr.getCell(i).fill = fill(C.GRAY_SUB);
    hdr.getCell(i).border = border();
    hdr.getCell(i).font = { bold: true, size: 9, color: { argb: C.BLUE_MED } };
  }

  if (isDirectInsumo) {
    const bdiRate = typeof bdi === 'number' ? (bdi > 1 ? bdi / 100 : bdi) : 0.25;
    const costRn = ws.rowCount + 1;
    const costRow = ws.addRow(['VALOR UNITÁRIO (sem BDI)', '', '', '', '', '', '', Number(comp.totalPrice) || 0]);
    ws.mergeCells(costRn, 1, costRn, 7);
    costRow.getCell(8).numFmt = '#,##0.00';
    costRow.height = 18;
    for (let i = 1; i <= 8; i++) {
      costRow.getCell(i).fill = fill(C.BLUE_MED);
      costRow.getCell(i).border = border(C.BLUE_MED);
      costRow.getCell(i).font = { bold: true, size: 9, color: { argb: C.WHITE } };
      costRow.getCell(i).alignment = { horizontal: i === 8 ? 'right' : 'left', vertical: 'middle' };
    }

    const bdiValRn = ws.rowCount + 1;
    const bdiValRow = ws.addRow([
      `Valor do BDI (${(bdiRate * 100).toFixed(2)}%)`, 
      '', '', '', '', '', '', 
      { formula: `ROUND(H${costRn}*${bdiRate}, 2)` }
    ]);
    ws.mergeCells(bdiValRn, 1, bdiValRn, 7);
    bdiValRow.getCell(8).numFmt = '#,##0.00';
    bdiValRow.height = 14;
    for (let i = 1; i <= 8; i++) {
      bdiValRow.getCell(i).fill = fill(C.GRAY_SUB);
      bdiValRow.getCell(i).border = border();
      bdiValRow.getCell(i).font = { size: 8, color: { argb: C.TEXT_MID }, bold: true };
      bdiValRow.getCell(i).alignment = { horizontal: i === 8 ? 'right' : 'left', vertical: 'middle' };
    }

    const bdiPriceRn = ws.rowCount + 1;
    const bdiPriceRow = ws.addRow([
      'Preço Unitário (com BDI)', 
      '', '', '', '', '', '', 
      { formula: `ROUND(H${costRn}+H${bdiValRn}, 2)` }
    ]);
    ws.mergeCells(bdiPriceRn, 1, bdiPriceRn, 7);
    bdiPriceRow.getCell(8).numFmt = '#,##0.00';
    bdiPriceRow.height = 14;
    for (let i = 1; i <= 8; i++) {
      bdiPriceRow.getCell(i).fill = fill(C.GRAY_SUB);
      bdiPriceRow.getCell(i).border = border();
      bdiPriceRow.getCell(i).font = { size: 8.5, color: { argb: C.BLUE_DARK }, bold: true };
      bdiPriceRow.getCell(i).alignment = { horizontal: i === 8 ? 'right' : 'left', vertical: 'middle' };
    }

    if (showQty && comp.proposalQuantity) {
      const qRn = ws.rowCount + 1;
      const proposalQty = Number(comp.proposalQuantity) || 0;
      const qRow = ws.addRow([
        'Quantidade de Serviço:', 
        '', '', '', '', 
        proposalQty, 
        'PREÇO TOTAL =>', 
        { formula: `ROUND(F${qRn}*H${bdiPriceRn}, 2)` }
      ]);
      ws.mergeCells(qRn, 1, qRn, 5);
      qRow.getCell(6).numFmt = '#,##0.00##';
      qRow.getCell(8).numFmt = '#,##0.00';
      qRow.height = 18;
      for (let i = 1; i <= 8; i++) {
        qRow.getCell(i).fill = fill(C.BLUE_LIGHT);
        qRow.getCell(i).border = border(C.BLUE_MED);
        qRow.getCell(i).font = { bold: true, size: 9, color: { argb: C.BLUE_DARK } };
        qRow.getCell(i).alignment = { horizontal: i === 6 || i === 8 ? 'right' : 'left', vertical: 'middle' };
      }
    }

    if (comp.observacao) {
      const obsRn = ws.rowCount + 1;
      const obsRow = ws.addRow([`Obs: ${comp.observacao}`]);
      ws.mergeCells(obsRn, 1, obsRn, 8);
      obsRow.height = 14;
      obsRow.getCell(1).fill = fill('FEFCE8');
      obsRow.getCell(1).border = border('FDE68A');
      obsRow.getCell(1).font = { italic: true, size: 8, color: { argb: '92400E' } };
    }

    ws.addRow([]); // spacing
    return;
  }

  // Insumos header
  headRow(ws, ['Tipo', 'Código', 'Banco', 'Descrição', 'Und', 'Coef.', 'Custo Unit.', 'Total']);

  // Grouping metadata already parsed at function start
  const customGroupLabels = metadata.customGroupLabels || {};
  const groupOrder = metadata.groupOrder || [];
  const groupNotes = metadata.groupNotes || {};

  const rateio = metadata.rateio;
  const hasRateio = rateio && typeof rateio === 'object' && Number(rateio.prazo) > 0 && Number(rateio.fracao) > 0;
  const rateioFactor = hasRateio ? (Number(rateio.prazo) / Number(rateio.fracao)) : 1;

  const GROUP_META: Record<string, { label: string; color: string }> = {
    MATERIAL: { label: 'Materiais', color: 'FF2563EB' },
    MAO_DE_OBRA: { label: 'Mão de Obra', color: 'FF16A34A' },
    EQUIPAMENTO: { label: 'Equipamentos', color: 'FFD97706' },
    SERVICO: { label: 'Serviços', color: 'FF0EA5E9' },
    AUXILIAR: { label: 'Composições Auxiliares', color: 'FF7C3AED' },
    OBSERVACAO: { label: 'Observações e Textos', color: 'FF64748B' },
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
    ...Object.keys(GROUP_META),
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

  const subtotalRowNums: number[] = [];

  // Render each group
  for (const groupKey of orderedKeys) {
    const items = itemsByGroup[groupKey] || [];
    if (items.length === 0) continue;

    const defaultMeta = GROUP_META[groupKey] || { label: groupKey, color: 'FF64748B' };
    const groupLabel = customGroupLabels[groupKey] || defaultMeta.label;
    const groupColor = defaultMeta.color;

    // Group header row
    const grn = ws.rowCount + 1;
    const groupRow = ws.addRow([`${groupLabel} (${items.length})`]);
    ws.mergeCells(grn, 1, grn, 8);
    groupRow.height = 16;
    for (let i = 1; i <= 8; i++) {
      groupRow.getCell(i).fill = fill('FFF8FAFC');
      groupRow.getCell(i).border = border();
      groupRow.getCell(i).font = { bold: true, size: 8.5, color: { argb: groupColor } };
    }

    // Insumos data for this group
    const firstGroupRow = ws.rowCount + 1;
    items.forEach((ci: any, idx: number) => {
      let tipo = 'Comp. Auxiliar';
      if (ci.type === 'MAO_DE_OBRA') tipo = 'Mão de Obra';
      else if (ci.type === 'MATERIAL') tipo = 'Material';
      else if (ci.type === 'EQUIPAMENTO') tipo = 'Equipamento';
      else if (ci.type === 'SERVICO') tipo = 'Serviço';
      else if (ci.type === 'OBSERVACAO') tipo = 'Observação';

      const rawCoef = Number(ci.coefficient) || 0;
      const coef = hasRateio ? rawCoef / rateioFactor : rawCoef;
      const up = Number(ci.unitPrice) || 0;
      const tp = hasRateio ? applyPrecisionNum(coef * up, engConfig) : (Number(ci.totalPrice) || 0);

      let coefVal: any = coef;
      if (ci.coefficientExpression) {
        if (engConfig?.reportConfig?.exportExcelWithFormulas) {
          coefVal = { formula: ci.coefficientExpression };
        } else {
          coefVal = `${ci.coefficientExpression.replace(/\*/g, '×')} = ${coef.toFixed(4).replace('.', ',')}`;
        }
      }

      let totalVal: any = tp;
      if (engConfig?.reportConfig?.exportExcelWithFormulas && coef > 0 && up > 0) {
        const nextRn = ws.rowCount + 1;
        totalVal = { formula: applyPrecision(`F${nextRn}*G${nextRn}`, engConfig) };
      }

      const r = dataRow(ws, [tipo, cleanCodeForDisplay(ci.code || ''), displaySourceName(ci.sourceName) || '', ci.description || '', cleanUnitForDisplay(ci.unit || ''), coefVal, up, totalVal], idx, [6, 7, 8]);
      if (!ci.coefficientExpression || engConfig?.reportConfig?.exportExcelWithFormulas) {
        r.getCell(6).numFmt = '#,##0.0000';
      }
      r.getCell(7).numFmt = '#,##0.00';
      r.getCell(8).numFmt = '#,##0.00';
    });
    const lastGroupRow = ws.rowCount;

    // Group Subtotal Row
    const subRn = ws.rowCount + 1;
    const rawGroupTotal = items.reduce((s, ci) => s + (ci.totalPrice || 0), 0);
    const groupTotal = hasRateio ? rawGroupTotal / rateioFactor : rawGroupTotal;
    let subtotalVal: any = groupTotal;
    if (engConfig?.reportConfig?.exportExcelWithFormulas && items.length > 0) {
      subtotalVal = { formula: `SUM(H${firstGroupRow}:H${lastGroupRow})` };
    }
    const subtotalRowObj = ws.addRow([`Subtotal ${groupLabel}`, '', '', '', '', '', '', subtotalVal]);
    ws.mergeCells(subRn, 1, subRn, 7);
    subtotalRowObj.getCell(8).numFmt = '#,##0.00';
    subtotalRowObj.height = 16;
    for (let i = 1; i <= 8; i++) {
      subtotalRowObj.getCell(i).fill = fill('FFF8FAFC');
      subtotalRowObj.getCell(i).border = border();
      subtotalRowObj.getCell(i).font = { bold: true, size: 8, color: { argb: groupColor } };
      subtotalRowObj.getCell(i).alignment = { horizontal: i === 8 ? 'right' : 'left', vertical: 'middle' };
    }
    subtotalRowNums.push(subRn);

    // Group Note Row
    const note = groupNotes[groupKey];
    if (note) {
      const noteRn = ws.rowCount + 1;
      const noteRow = ws.addRow([`Nota: ${note}`]);
      ws.mergeCells(noteRn, 1, noteRn, 8);
      noteRow.height = 14;
      for (let i = 1; i <= 8; i++) {
        noteRow.getCell(i).fill = fill('FFF8FAFC');
        noteRow.getCell(i).border = border();
        noteRow.getCell(i).font = { italic: true, size: 7.5, color: { argb: 'FF475569' } };
      }
    }
  }

  // Footer: Custo Unitário Total
  const totalPriceVal = Number(comp.totalPrice) || 0;
  const bdiRate = typeof bdi === 'number' 
    ? (bdi > 1 ? bdi / 100 : bdi) 
    : (comp.totalPrice > 0 ? (comp.valorBdi || 0) / comp.totalPrice : 0.25);

  let costRn = 0;
  let bdiPriceRn = ws.rowCount + 1;

  if (hasRateio) {
    // 1. TOTAL SIMPLES
    const totalSimplesRn = ws.rowCount + 1;
    let simplesVal: any = totalPriceVal / rateioFactor;
    if (engConfig?.reportConfig?.exportExcelWithFormulas && subtotalRowNums.length > 0) {
      simplesVal = { formula: subtotalRowNums.map(rn => `H${rn}`).join('+') };
    }
    const simplesRow = ws.addRow(['TOTAL SIMPLES', '', '', '', '', '', '', simplesVal]);
    ws.mergeCells(totalSimplesRn, 1, totalSimplesRn, 7);
    simplesRow.getCell(8).numFmt = '#,##0.00';
    simplesRow.height = 15;
    for (let i = 1; i <= 8; i++) {
      simplesRow.getCell(i).fill = fill('FFF8FAFC');
      simplesRow.getCell(i).border = border();
      simplesRow.getCell(i).font = { bold: true, size: 8, color: { argb: C.TEXT_MID } };
      simplesRow.getCell(i).alignment = { horizontal: i === 8 ? 'right' : 'left', vertical: 'middle' };
    }

    // 2. TOTAL P/ X MESES
    const totalPrazoRn = ws.rowCount + 1;
    let prazoVal: any = (totalPriceVal / rateioFactor) * Number(rateio.prazo);
    if (engConfig?.reportConfig?.exportExcelWithFormulas) {
      prazoVal = { formula: `H${totalSimplesRn}*${Number(rateio.prazo)}` };
    }
    const prazoRow = ws.addRow([`TOTAL P/ ${rateio.prazo} MESES`, '', '', '', '', '', '', prazoVal]);
    ws.mergeCells(totalPrazoRn, 1, totalPrazoRn, 7);
    prazoRow.getCell(8).numFmt = '#,##0.00';
    prazoRow.height = 15;
    for (let i = 1; i <= 8; i++) {
      prazoRow.getCell(i).fill = fill('FFF8FAFC');
      prazoRow.getCell(i).border = border();
      prazoRow.getCell(i).font = { bold: true, size: 8, color: { argb: C.TEXT_MID } };
      prazoRow.getCell(i).alignment = { horizontal: i === 8 ? 'right' : 'left', vertical: 'middle' };
    }

    // 3. FRAÇÃO DE Y%
    const fracaoRn = ws.rowCount + 1;
    costRn = fracaoRn;
    let fracaoVal: any = totalPriceVal;
    if (engConfig?.reportConfig?.exportExcelWithFormulas) {
      fracaoVal = { formula: `H${totalPrazoRn}/${Number(rateio.fracao)}` };
    }
    const fracaoRow = ws.addRow([`FRAÇÃO DE ${rateio.fracao}% (sem BDI)`, '', '', '', '', '', '', fracaoVal]);
    ws.mergeCells(fracaoRn, 1, fracaoRn, 7);
    fracaoRow.getCell(8).numFmt = '#,##0.00';
    fracaoRow.height = 16;
    for (let i = 1; i <= 8; i++) {
      fracaoRow.getCell(i).fill = fill(C.BLUE_LIGHT);
      fracaoRow.getCell(i).border = border(C.BLUE_MED);
      fracaoRow.getCell(i).font = { bold: true, size: 8.5, color: { argb: C.BLUE_DARK } };
      fracaoRow.getCell(i).alignment = { horizontal: i === 8 ? 'right' : 'left', vertical: 'middle' };
    }

    // 4. BDI
    const bdiValRn = ws.rowCount + 1;
    const bdiValRow = ws.addRow([
      `Valor do BDI (${(bdiRate * 100).toFixed(2)}%)`, 
      '', '', '', '', '', '', 
      { formula: `ROUND(H${fracaoRn}*${bdiRate}, 2)` }
    ]);
    ws.mergeCells(bdiValRn, 1, bdiValRn, 7);
    bdiValRow.getCell(8).numFmt = '#,##0.00';
    bdiValRow.height = 14;
    for (let i = 1; i <= 8; i++) {
      bdiValRow.getCell(i).fill = fill(C.GRAY_SUB);
      bdiValRow.getCell(i).border = border();
      bdiValRow.getCell(i).font = { size: 8, color: { argb: C.TEXT_MID }, bold: true };
      bdiValRow.getCell(i).alignment = { horizontal: i === 8 ? 'right' : 'left', vertical: 'middle' };
    }

    // 5. TOTAL GERAL
    bdiPriceRn = ws.rowCount + 1;
    const bdiPriceRow = ws.addRow([
      'TOTAL GERAL', 
      '', '', '', '', '', '', 
      { formula: `ROUND(H${fracaoRn}+H${bdiValRn}, 2)` }
    ]);
    ws.mergeCells(bdiPriceRn, 1, bdiPriceRn, 7);
    bdiPriceRow.getCell(8).numFmt = '#,##0.00';
    bdiPriceRow.height = 18;
    for (let i = 1; i <= 8; i++) {
      bdiPriceRow.getCell(i).fill = fill(C.BLUE_MED);
      bdiPriceRow.getCell(i).border = border(C.BLUE_MED);
      bdiPriceRow.getCell(i).font = { bold: true, size: 9, color: { argb: C.WHITE } };
      bdiPriceRow.getCell(i).alignment = { horizontal: i === 8 ? 'right' : 'left', vertical: 'middle' };
    }
  } else {
    costRn = ws.rowCount + 1;
    let costVal: any = totalPriceVal;
    if (engConfig?.reportConfig?.exportExcelWithFormulas && subtotalRowNums.length > 0) {
      costVal = { formula: subtotalRowNums.map(rn => `H${rn}`).join('+') };
    }
    const costRow = ws.addRow(['CUSTO UNITÁRIO TOTAL (sem BDI)', '', '', '', '', '', '', costVal]);
    ws.mergeCells(costRn, 1, costRn, 7);
    costRow.getCell(8).numFmt = '#,##0.00';
    costRow.height = 18;
    for (let i = 1; i <= 8; i++) {
      costRow.getCell(i).fill = fill(C.BLUE_MED);
      costRow.getCell(i).border = border(C.BLUE_MED);
      costRow.getCell(i).font = { bold: true, size: 9, color: { argb: C.WHITE } };
      costRow.getCell(i).alignment = { horizontal: i === 8 ? 'right' : 'left', vertical: 'middle' };
    }

    const bdiValRn = ws.rowCount + 1;
    const bdiValRow = ws.addRow([
      `Valor do BDI (${(bdiRate * 100).toFixed(2)}%)`, 
      '', '', '', '', '', '', 
      { formula: `ROUND(H${costRn}*${bdiRate}, 2)` }
    ]);
    ws.mergeCells(bdiValRn, 1, bdiValRn, 7);
    bdiValRow.getCell(8).numFmt = '#,##0.00';
    bdiValRow.height = 14;
    for (let i = 1; i <= 8; i++) {
      bdiValRow.getCell(i).fill = fill(C.GRAY_SUB);
      bdiValRow.getCell(i).border = border();
      bdiValRow.getCell(i).font = { size: 8, color: { argb: C.TEXT_MID }, bold: true };
      bdiValRow.getCell(i).alignment = { horizontal: i === 8 ? 'right' : 'left', vertical: 'middle' };
    }

    bdiPriceRn = ws.rowCount + 1;
    const bdiPriceRow = ws.addRow([
      'Preço Unitário (com BDI)', 
      '', '', '', '', '', '', 
      { formula: `ROUND(H${costRn}+H${bdiValRn}, 2)` }
    ]);
    ws.mergeCells(bdiPriceRn, 1, bdiPriceRn, 7);
    bdiPriceRow.getCell(8).numFmt = '#,##0.00';
    bdiPriceRow.height = 14;
    for (let i = 1; i <= 8; i++) {
      bdiPriceRow.getCell(i).fill = fill(C.GRAY_SUB);
      bdiPriceRow.getCell(i).border = border();
      bdiPriceRow.getCell(i).font = { size: 8.5, color: { argb: C.BLUE_DARK }, bold: true };
      bdiPriceRow.getCell(i).alignment = { horizontal: i === 8 ? 'right' : 'left', vertical: 'middle' };
    }
  }

  // Reference Divisor
  const referenceDivisor = metadata.referenceDivisor || null;
  if (referenceDivisor && referenceDivisor.value > 0) {
    const divRn = ws.rowCount + 1;
    const divLabel = referenceDivisor.label || 'Referência';
    const divVal = referenceDivisor.value;
    const divRow = ws.addRow([
      `Divisor de Referência: ${divLabel} (Qtd: ${divVal})    |    Custo/Ref (sem BDI):`, 
      '', '', '', '', '', '', 
      { formula: `ROUND(H${costRn}/${divVal}, 2)` }
    ]);
    ws.mergeCells(divRn, 1, divRn, 7);
    divRow.getCell(8).numFmt = '#,##0.00';
    divRow.height = 14;
    for (let i = 1; i <= 8; i++) {
      divRow.getCell(i).fill = fill('FFF0FDF4');
      divRow.getCell(i).border = border('FFBBF7D0');
      divRow.getCell(i).font = { size: 8, color: { argb: 'FF166534' }, bold: true };
      divRow.getCell(i).alignment = { horizontal: i === 8 ? 'right' : 'left', vertical: 'middle' };
    }
  }

  // Quantity + Total (for analytical)
  if (showQty && comp.proposalQuantity) {
    const qRn = ws.rowCount + 1;
    const proposalQty = Number(comp.proposalQuantity) || 0;
    const divisor = referenceDivisor && referenceDivisor.value > 0 ? referenceDivisor.value : null;
    const formulaString = divisor
      ? `ROUND((F${qRn}*H${bdiPriceRn})/${divisor}, 2)`
      : `ROUND(F${qRn}*H${bdiPriceRn}, 2)`;
    const qRow = ws.addRow([
      'Quantidade de Serviço:', 
      '', '', '', '', 
      proposalQty, 
      'PREÇO TOTAL =>', 
      { formula: formulaString }
    ]);
    ws.mergeCells(qRn, 1, qRn, 5);
    qRow.getCell(6).numFmt = '#,##0.00##';
    qRow.getCell(8).numFmt = '#,##0.00';
    qRow.height = 18;
    for (let i = 1; i <= 8; i++) {
      qRow.getCell(i).fill = fill(C.BLUE_LIGHT);
      qRow.getCell(i).border = border(C.BLUE_MED);
      qRow.getCell(i).font = { bold: true, size: 9, color: { argb: C.BLUE_DARK } };
      qRow.getCell(i).alignment = { horizontal: i === 6 || i === 8 ? 'right' : 'left', vertical: 'middle' };
    }
  }

  // Observation note (from reportConfig.compositionNotes)
  if (comp.observacao) {
    const obsRn = ws.rowCount + 1;
    const obsRow = ws.addRow([`Obs: ${comp.observacao}`]);
    ws.mergeCells(obsRn, 1, obsRn, 8);
    obsRow.height = 14;
    obsRow.getCell(1).fill = fill('FEFCE8');
    obsRow.getCell(1).border = border('FDE68A');
    obsRow.getCell(1).font = { italic: true, size: 8, color: { argb: '92400E' } };
  }

  ws.addRow([]); // spacing
}

// ── 2B. ORÇAMENTO ANALÍTICO — mirrors docOrcamentoAnalitico ──────────────────
export async function xlsOrcamentoAnalitico(proposalId: string, items: any[], engConfig: EngineeringConfig | undefined, bdi: number, returnBuffer?: boolean) {
  setGlobalPrecision(engConfig);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Orçamento Analítico');
  setupPrint(ws, getOrientation('analitico', engConfig?.reportConfig, false), engConfig?.reportConfig);
  ws.columns = [{ width: 12 }, { width: 10 }, { width: 10 }, { width: 38 }, { width: 7 }, { width: 12 }, { width: 14 }, { width: 16 }];
  logoRow(wb, ws, 8, engConfig?.reportConfig);

  const billable = items.filter((i: any) => !isGrouper(i.type));
  const total = billable.reduce((s: number, i: any) => s + (Number(i.totalPrice) || 0), 0);
  const chapters = groupByChapter(items);

  titleRow(ws, 'PLANILHA ORÇAMENTÁRIA ANALÍTICA', 8);
  const bdiRate = bdi > 1 ? bdi / 100 : bdi;
  const rn0 = ws.rowCount + 1;
  ws.addRow([`BDI: ${(bdiRate * 100).toFixed(2)}% · ${billable.length} itens · Total: ${fmt(total)}`]);
  ws.mergeCells(rn0, 1, rn0, 8);
  ws.getRow(rn0).getCell(1).font = { size: 9, color: { argb: C.TEXT_MID } };
  ws.addRow([]);
  metaRows(ws, engConfig, items, 8);

  try {
    const report = await fetchAnalyticalReport(proposalId, items, bdi, engConfig);

    // Inject compositionNotes from reportConfig
    const cNotes = engConfig?.reportConfig?.compositionNotes || {};
    const comps = report?.principalCompositions || [];
    const auxComps = report?.auxiliaryCompositions || [];
    for (const comp of [...comps, ...auxComps]) {
      if (comp.code && cNotes[comp.code]) {
        comp.observacao = cNotes[comp.code];
      } else if (comp.metadata) {
        const meta = safeParseJson(comp.metadata);
        if (meta?.observation) {
          comp.observacao = meta.observation;
        }
      }
    }

    // Group compositions by chapter
    const compMap = new Map<string, any[]>();
    for (const comp of comps) {
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
      sectionHeaderRow(ws, chTitle, 8);
      for (const comp of chComps) renderCompXls(ws, comp, true, engConfig, bdi);
      const chTotal = chComps.reduce((s: number, c: any) => s + (c.proposalTotal || 0), 0);
      subtotalRow(ws, `Subtotal ${chTitle}`, fmt(chTotal), 8);
    }
  } catch (e: any) {
    ws.addRow([`Erro: ${e.message}`]);
  }

  bdiRows(ws, items, bdi, 8);
  return saveWb(wb, 'orcamento-analitico.xlsx', returnBuffer);
}

// ── 2C. CADERNO DE COMPOSIÇÕES (CPU) — mirrors docCpuBatch ───────────────────
export async function xlsCpuBatch(proposalId: string, items: any[], engConfig: EngineeringConfig | undefined, bdi: number, returnBuffer?: boolean) {
  setGlobalPrecision(engConfig);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Composições');
  setupPrint(ws, getOrientation('cpu', engConfig?.reportConfig, false), engConfig?.reportConfig);
  ws.columns = [{ width: 12 }, { width: 10 }, { width: 10 }, { width: 38 }, { width: 7 }, { width: 12 }, { width: 14 }, { width: 16 }];
  logoRow(wb, ws, 8, engConfig?.reportConfig);

  const billable = items.filter((i: any) => !isGrouper(i.type));
  titleRow(ws, 'CADERNO DE COMPOSIÇÕES DE PREÇOS UNITÁRIOS', 8);
  const rn0 = ws.rowCount + 1;
  ws.addRow([`${billable.length} serviços`]);
  ws.mergeCells(rn0, 1, rn0, 8);
  ws.getRow(rn0).getCell(1).font = { size: 9, color: { argb: C.TEXT_MID } };
  ws.addRow([]);
  metaRows(ws, engConfig, items, 8);

  try {
    const report = await fetchAnalyticalReport(proposalId, items, bdi, engConfig);

    const comps = (report?.principalCompositions || []).filter((c: any) => !safeParseJson(c.metadata)?._isDirectInsumo);
    const auxComps = report?.auxiliaryCompositions || [];

    // Inject compositionNotes from reportConfig
    const cNotes = engConfig?.reportConfig?.compositionNotes || {};
    for (const comp of [...comps, ...auxComps]) {
      if (comp.code && cNotes[comp.code]) {
        comp.observacao = cNotes[comp.code];
      } else if (comp.metadata) {
        const meta = safeParseJson(comp.metadata);
        if (meta?.observation) {
          comp.observacao = meta.observation;
        }
      }
    }

    sectionHeaderRow(ws, 'Composições Principais', 8);
    for (const comp of comps) renderCompXls(ws, comp, false, engConfig, bdi);

    if (auxComps.length > 0) {
      sectionHeaderRow(ws, 'Composições Auxiliares', 8);
      for (const comp of auxComps) renderCompXls(ws, comp, false, engConfig, bdi);
    }
  } catch (e: any) {
    ws.addRow([`Erro: ${e.message}`]);
  }

  return saveWb(wb, 'composicoes-cpu.xlsx', returnBuffer);
}

// ── 3. CURVA ABC SERVIÇOS — with numeric values & formulas ───────────────────
export async function xlsCurvaAbcServicos(items: any[], engConfig: EngineeringConfig | undefined, bdi: number, returnBuffer?: boolean) {
  setGlobalPrecision(engConfig);
  const rc = engConfig?.reportConfig || {} as any;
  const showCU = rc.showCustoUnit !== false;
  const showPU = rc.showPrecoUnit !== false;

  const headers: string[] = ['Nº', 'CÓDIGO', 'BANCO', 'DESCRIÇÃO', 'UN.', 'QTD.'];
  const widths: { width: number }[] = [{ width: 6 }, { width: 8 }, { width: 10 }, { width: 42 }, { width: 7 }, { width: 10 }];
  if (showCU) { headers.push('CUSTO UNIT.'); widths.push({ width: 14 }); }
  if (showPU) { headers.push('PREÇO UNIT.'); widths.push({ width: 14 }); }
  headers.push('TOTAL', '% ITEM', '% ACUM.');
  widths.push({ width: 16 }, { width: 10 }, { width: 10 });
  const colCount = headers.length;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ABC Serviços');
  setupPrint(ws, getOrientation('abc_servicos', rc, false), rc);
  ws.columns = widths;
  logoRow(wb, ws, colCount, rc);

  titleRow(ws, 'CURVA ABC DE SERVIÇOS', colCount);
  metaRows(ws, engConfig, items, colCount);
  headRow(ws, headers);

  const svcs = items.filter(i => i.type === 'COMPOSICAO' || (!['ETAPA','SUBETAPA'].includes(i.type) && i.code));
  const total = svcs.reduce((s, i) => s + (Number(i.totalPrice) || 0), 0);
  const sorted = [...svcs].sort((a, b) => (Number(b.totalPrice) || 0) - (Number(a.totalPrice) || 0));

  const totalColIdx = colCount - 2; // TOTAL is 3rd from end
  const pctColIdx = colCount - 1;
  const acumColIdx = colCount;
  let acum = 0;

  const firstData = ws.rowCount + 1;
  const gRn = firstData + sorted.length;

  sorted.forEach((item, idx) => {
    const v = Number(item.totalPrice) || 0;
    const pct = total > 0 ? v / total : 0;
    acum += pct;
    const cls = (acum * 100) <= 80 ? C.RED : (acum * 100) <= 95 ? C.AMBER : C.GREEN;

    const qty = Number(item.quantity) || 0;
    const uc = Number(item.unitCost) || 0;
    const up = Number(item.unitPrice) || 0;

    let totalVal: any = v;
    let pctVal: any = pct;
    let acumVal: any = acum;
    const rNum = ws.rowCount + 1;

    if (engConfig?.reportConfig?.exportExcelWithFormulas) {
      if (qty > 0) {
        if (showPU && up > 0) {
          const puColLetter = colToLetter(totalColIdx - 1);
          totalVal = { formula: applyPrecision(`F${rNum}*${puColLetter}${rNum}`, engConfig) };
        } else if (!showPU && showCU && uc > 0) {
          const cuColLetter = colToLetter(totalColIdx - 1);
          totalVal = { formula: applyPrecision(`F${rNum}*${cuColLetter}${rNum}`, engConfig) };
        }
      }
      const totalColLetter = colToLetter(totalColIdx);
      pctVal = { formula: `${totalColLetter}${rNum}/$${totalColLetter}$${gRn}` };
      const pctColLetter = colToLetter(pctColIdx);
      const acumColLetter = colToLetter(acumColIdx);
      if (rNum === firstData) {
        acumVal = { formula: `${pctColLetter}${rNum}` };
      } else {
        acumVal = { formula: `${acumColLetter}${rNum - 1}+${pctColLetter}${rNum}` };
      }
    }

    const vals: any[] = [idx + 1, cleanCodeForDisplay(item.code || ''), displaySourceName(item.sourceName) || '', item.description || '', cleanUnitForDisplay(item.unit || ''), qty];
    if (showCU) vals.push(uc);
    if (showPU) vals.push(up);
    vals.push(totalVal, pctVal, acumVal);

    const r = dataRow(ws, vals, idx, Array.from({ length: colCount - 4 }, (_, i) => 6 + i));
    // Number formats
    r.getCell(6).numFmt = '#,##0.00##'; // QTD
    let ci = 7;
    if (showCU) { r.getCell(ci).numFmt = '#,##0.00'; ci++; }
    if (showPU) { r.getCell(ci).numFmt = '#,##0.00'; ci++; }
    r.getCell(totalColIdx).numFmt = '#,##0.00';
    r.getCell(pctColIdx).numFmt = '0.00%';
    r.getCell(acumColIdx).numFmt = '0.00%';
    r.getCell(pctColIdx).font = { bold: true, size: 9, color: { argb: cls } };
    r.getCell(acumColIdx).font = { bold: true, size: 9, color: { argb: cls } };
  });

  // Grand total
  const lastData = ws.rowCount;
  const tLetter = String.fromCharCode(64 + totalColIdx);
  const gRow = ws.addRow(['TOTAL', ...Array(colCount - 4).fill(''), '', 1, '']);
  ws.mergeCells(gRn, 1, gRn, totalColIdx - 1);
  gRow.getCell(totalColIdx).value = { formula: `SUM(${tLetter}${firstData}:${tLetter}${lastData})` } as any;
  gRow.getCell(totalColIdx).numFmt = '#,##0.00';
  gRow.getCell(pctColIdx).value = 1;
  gRow.getCell(pctColIdx).numFmt = '0.00%';
  gRow.height = 20;
  for (let i = 1; i <= colCount; i++) {
    const c = gRow.getCell(i);
    c.fill = fill(C.BLUE_DARK);
    c.border = border(C.BLUE_DARK);
    c.font = { bold: true, size: 10, color: { argb: C.WHITE } };
    c.alignment = { horizontal: 'right', vertical: 'middle' };
  }

  bdiRows(ws, items, bdi, colCount, `${tLetter}${gRn}`);
  return saveWb(wb, 'abc-servicos.xlsx', returnBuffer);
}

function renderBdiXlsBlock(wsBdi: ExcelJS.Worksheet, tcu: any, isTcu: boolean, bdiRate: number, title: string) {
  titleRow(wsBdi, title, 3);
  
  if (isTcu && tcu) {
    headRow(wsBdi, ['COMPONENTE', 'SIGLA', 'TAXA (%)']);

    const compRows = [
      { name: 'Administração Central (AC)', sigla: 'AC', val: (tcu.adminCentral || 0) / 100 },
      { name: 'Seguros (S)', sigla: 'S', val: (tcu.seguros || 0) / 100 },
      { name: 'Garantias (G)', sigla: 'G', val: (tcu.garantias || 0) / 100 },
      { name: 'Riscos (R)', sigla: 'R', val: (tcu.riscos || 0) / 100 },
      { name: 'Despesas Financeiras (DF)', sigla: 'DF', val: (tcu.despFinanceiras || 0) / 100 },
      { name: 'Lucro / Remuneração (L)', sigla: 'L', val: (tcu.lucro || 0) / 100 },
    ];

    let acRn = 0, sRn = 0, gRn = 0, rRn = 0, dfRn = 0, lRn = 0;

    compRows.forEach((c, idx) => {
      const r = wsBdi.addRow([c.name, c.sigla, c.val]);
      const rn = wsBdi.rowCount;
      if (c.sigla === 'AC') acRn = rn;
      else if (c.sigla === 'S') sRn = rn;
      else if (c.sigla === 'G') gRn = rn;
      else if (c.sigla === 'R') rRn = rn;
      else if (c.sigla === 'DF') dfRn = rn;
      else if (c.sigla === 'L') lRn = rn;

      r.getCell(3).numFmt = '0.00%';
      r.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
      r.height = 15;
      for (let i = 1; i <= 3; i++) {
        r.getCell(i).fill = fill(idx % 2 === 0 ? C.WHITE : C.GRAY_ROW);
        r.getCell(i).border = border();
        r.getCell(i).font = { size: 9, color: { argb: C.TEXT_DARK } };
      }
    });

    // Detalhamento dos tributos (I)
    sectionHeaderRow(wsBdi, 'Detalhamento dos Tributos (I)', 3);
    headRow(wsBdi, ['TRIBUTO', '', 'TAXA (%)']);

    const pis = (tcu.pis || 0) / 100;
    const cofins = (tcu.cofins || 0) / 100;
    const iss = (tcu.iss || 0) / 100;
    const csll = (tcu.csll || 0) / 100;
    const cprb = (tcu.cprb || 0) / 100;

    const tribRows = [
      ['PIS (Programa de Integração Social)', '', pis],
      ['COFINS (Contribuição p/ Financiamento da Seg. Social)', '', cofins],
      ['ISS (Imposto Sobre Serviços)', '', iss],
      ['CSLL (Contribuição Social sobre Lucro Líquido)', '', csll],
      ['CPRB (Contribuição Previdenciária sobre a Receita Bruta)', '', cprb],
    ];

    const firstTribRow = wsBdi.rowCount + 1;
    tribRows.forEach((tr, idx) => {
      const rn = wsBdi.rowCount + 1;
      const r = wsBdi.addRow(tr);
      wsBdi.mergeCells(rn, 1, rn, 2);
      r.getCell(3).numFmt = '0.00%';
      r.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
      r.height = 15;
      for (let i = 1; i <= 3; i++) {
        r.getCell(i).fill = fill(idx % 2 === 0 ? C.WHITE : C.GRAY_ROW);
        r.getCell(i).border = border();
        r.getCell(i).font = { size: 9, color: { argb: C.TEXT_DARK } };
      }
    });
    const lastTribRow = wsBdi.rowCount;

    // Total Tributos
    const totalTribRn = wsBdi.rowCount + 1;
    const totalTribRow = wsBdi.addRow(['Total Tributos (I = PIS + COFINS + ISS + CSLL + CPRB)', '', { formula: `SUM(C${firstTribRow}:C${lastTribRow})` }]);
    wsBdi.mergeCells(totalTribRn, 1, totalTribRn, 2);
    totalTribRow.getCell(3).numFmt = '0.00%';
    totalTribRow.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
    totalTribRow.height = 16;
    for (let i = 1; i <= 3; i++) {
      totalTribRow.getCell(i).fill = fill(C.GRAY_SUB);
      totalTribRow.getCell(i).border = border(C.BORDER);
      totalTribRow.getCell(i).font = { bold: true, size: 9, color: { argb: C.TEXT_DARK } };
    }

    // BDI TCU Calculado final
    wsBdi.addRow([]);
    const bdiFinalRn = wsBdi.rowCount + 1;
    const bdiFormula = `ROUND((((1+C${acRn}+C${sRn}+C${gRn}+C${rRn})*(1+C${dfRn})*(1+C${lRn}))/(1-C${totalTribRn}))-1, 4)`;
    const bdiFinalRow = wsBdi.addRow(['BDI TCU CALCULADO (FÓRMULA TCU)', '', { formula: bdiFormula }]);
    wsBdi.mergeCells(bdiFinalRn, 1, bdiFinalRn, 2);
    bdiFinalRow.getCell(3).numFmt = '0.00%';
    bdiFinalRow.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
    bdiFinalRow.height = 20;
    for (let i = 1; i <= 3; i++) {
      bdiFinalRow.getCell(i).fill = fill(C.BLUE_DARK);
      bdiFinalRow.getCell(i).border = border(C.BLUE_DARK);
      bdiFinalRow.getCell(i).font = { bold: true, size: 10, color: { argb: C.WHITE } };
    }

  } else {
    headRow(wsBdi, ['TIPO DE BDI', '', 'TAXA (%)']);
    const rnRow = wsBdi.rowCount + 1;
    const bRow = wsBdi.addRow(['BDI Simplificado', '', bdiRate]);
    wsBdi.mergeCells(rnRow, 1, rnRow, 2);
    bRow.getCell(3).numFmt = '0.00%';
    bRow.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
    bRow.height = 18;
    for (let i = 1; i <= 3; i++) {
      bRow.getCell(i).fill = fill(C.BLUE_DARK);
      bRow.getCell(i).border = border(C.BLUE_DARK);
      bRow.getCell(i).font = { bold: true, size: 10, color: { argb: C.WHITE } };
    }
  }
}

function populateEncargosXlsSheet(wb: ExcelJS.Workbook, wsEs: ExcelJS.Worksheet, es: any, label: string, engConfig: EngineeringConfig | undefined) {
  setupPrint(wsEs, getOrientation('bdi', engConfig?.reportConfig, false), engConfig?.reportConfig);
  wsEs.columns = [{ width: 8 }, { width: 45 }, { width: 14 }, { width: 14 }];
  logoRow(wb, wsEs, 4, engConfig?.reportConfig);

  titleRow(wsEs, `ENCARGOS SOCIAIS SOBRE MÃO DE OBRA (${label})`, 4);

  const isDesonerado = (engConfig?.regimeOneracao || 'DESONERADO') === 'DESONERADO';
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

  headRow(wsEs, ['CÓD', 'DESCRIÇÃO', 'HORISTA %', 'MENSALISTA %']);
  const subtotalRowNums: number[] = [];

  for (const g of groups) {
    const secRow = wsEs.addRow([g.label]);
    wsEs.mergeCells(secRow.number, 1, secRow.number, 4);
    secRow.getCell(1).fill = fill(C.BLUE_LIGHT);
    secRow.getCell(1).font = { bold: true, size: 9, color: { argb: C.BLUE_MED } };
    secRow.getCell(1).border = border(C.BLUE_MED);
    secRow.height = 16;

    const firstItemRow = wsEs.rowCount + 1;
    g.items.forEach(([cod, desc, key], idx) => {
      const h = v(`${key}_h`), m = v(`${key}_m`);
      const r = dataRow(wsEs, [cod, desc, h / 100, m / 100], idx, [3, 4]);
      r.getCell(1).font = { bold: true, size: 9, color: { argb: C.BLUE_MED } };
      r.getCell(3).numFmt = '0.00%';
      r.getCell(4).numFmt = '0.00%';
    });
    const lastItemRow = wsEs.rowCount;

    // Subtotal with SUM formula
    const stRn = wsEs.rowCount + 1;
    const sr = wsEs.addRow(['', `Subtotal ${g.label.split(' — ')[0]}`, '', '']);
    sr.getCell(3).value = { formula: `SUM(C${firstItemRow}:C${lastItemRow})` } as any;
    sr.getCell(4).value = { formula: `SUM(D${firstItemRow}:D${lastItemRow})` } as any;
    sr.getCell(3).numFmt = '0.00%';
    sr.getCell(4).numFmt = '0.00%';
    sr.height = 16;
    for (let i = 1; i <= 4; i++) {
      sr.getCell(i).fill = fill(C.GRAY_SUB);
      sr.getCell(i).font = { bold: true, size: 9 };
      sr.getCell(i).border = border();
      sr.getCell(i).alignment = { horizontal: i >= 3 ? 'right' : 'left', vertical: 'middle' };
    }
    subtotalRowNums.push(stRn);
    wsEs.addRow([]);
  }

  // Grand total with SUM of subtotals
  const gRn = wsEs.rowCount + 1;
  const gRow = wsEs.addRow(['A + B + C + D =', '', '', '']);
  wsEs.mergeCells(gRn, 1, gRn, 2);
  if (subtotalRowNums.length > 0) {
    const hRefs = subtotalRowNums.map(rn => `C${rn}`).join('+');
    const mRefs = subtotalRowNums.map(rn => `D${rn}`).join('+');
    gRow.getCell(3).value = { formula: hRefs } as any;
    gRow.getCell(4).value = { formula: mRefs } as any;
  }
  gRow.getCell(3).numFmt = '0.00%';
  gRow.getCell(4).numFmt = '0.00%';
  gRow.height = 20;
  for (let i = 1; i <= 4; i++) {
    const c = gRow.getCell(i);
    c.fill = fill(C.BLUE_DARK);
    c.border = border(C.BLUE_DARK);
    c.font = { bold: true, size: 10, color: { argb: C.WHITE } };
    c.alignment = { horizontal: 'right', vertical: 'middle' };
  }
}

export async function xlsBdiEncargos(
  engConfig: EngineeringConfig | undefined,
  bdi: number,
  bdiConfig?: BdiConfig,
  returnBuffer?: boolean
) {
  setGlobalPrecision(engConfig);
  const wb = new ExcelJS.Workbook();

  // ═══════════════════════════════════════════════════════════
  // PLANILHA 1: COMPOSIÇÃO DE BDI
  // ═══════════════════════════════════════════════════════════
  const wsBdi = wb.addWorksheet('Composição de BDI');
  setupPrint(wsBdi, getOrientation('bdi', engConfig?.reportConfig, false), engConfig?.reportConfig);
  wsBdi.columns = [{ width: 48 }, { width: 12 }, { width: 16 }];
  logoRow(wb, wsBdi, 3, engConfig?.reportConfig);

  const bdiRate = bdi > 1 ? bdi / 100 : bdi;
  const isTcu = !!(bdiConfig?.mode === 'TCU' && bdiConfig?.tcu);

  if (engConfig?.bdiDiferenciado) {
    renderBdiXlsBlock(wsBdi, bdiConfig?.tcu, isTcu, bdiRate, 'BDI - TIPO OBRA (SERVIÇOS)');
    wsBdi.addRow([]);
    wsBdi.addRow([]);
    const tcuFornec = bdiConfig?.tcuFornecimento || DEFAULT_TCU_FORNECIMENTO_PARAMS;
    const bdiFornecVal = bdiConfig?.mode === 'TCU' ? calculateBdiTCU(tcuFornec, engConfig?.precision) : (engConfig?.bdiFornecimento || 0);
    const bdiFornecRate = bdiFornecVal > 1 ? bdiFornecVal / 100 : bdiFornecVal;
    renderBdiXlsBlock(wsBdi, tcuFornec, isTcu, bdiFornecRate, 'BDI - TIPO FORNECIMENTO (MATERIAIS/EQUIPAMENTOS)');
  } else {
    renderBdiXlsBlock(wsBdi, bdiConfig?.tcu, isTcu, bdiRate, isTcu ? 'COMPOSIÇÃO DO BDI ( TCU )' : 'COMPOSIÇÃO DO BDI');
  }

  // ═══════════════════════════════════════════════════════════
  // PLANILHA 2: ENCARGOS SOCIAIS
  // ═══════════════════════════════════════════════════════════
  const esConfig = engConfig?.encargosSociais || { horista: 83.85, mensalista: 47.76 } as EncargosSociaisConfig;
  const principalLabel = esConfig.basePrincipal || 'Principal';
  
  const wsEs = wb.addWorksheet('Encargos Sociais');
  populateEncargosXlsSheet(wb, wsEs, esConfig, principalLabel, engConfig);

  if (Array.isArray(esConfig.encargosAdicionais) && esConfig.encargosAdicionais.length > 0) {
    for (const sheet of esConfig.encargosAdicionais) {
      const sheetName = `Encargos - ${sheet.label || 'Adicional'}`;
      const cleanSheetName = sheetName.replace(/[:\\/?*\[\]]/g, '').substring(0, 31);
      const wsEsAdic = wb.addWorksheet(cleanSheetName);
      populateEncargosXlsSheet(wb, wsEsAdic, sheet, sheet.label || 'Adicional', engConfig);
    }
  }

  return saveWb(wb, 'bdi-encargos.xlsx', returnBuffer);
}

// ── 5. CRONOGRAMA FÍSICO-FINANCEIRO — with numeric values & formulas ─────────
export async function xlsCronograma(result: any, engConfig: EngineeringConfig | undefined, returnBuffer?: boolean) {
  setGlobalPrecision(engConfig);
  const { meses, etapas, mensalTotal, percentMensal, percentAcumulado, totalGlobal } = result;
  const colCount = 2 + meses + 1;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cronograma');
  setupPrint(ws, getOrientation('cronograma', engConfig?.reportConfig, true), engConfig?.reportConfig);
  const widths = [{ width: 40 }, { width: 14 }];
  for (let m = 0; m < meses; m++) widths.push({ width: 12 });
  widths.push({ width: 14 });
  ws.columns = widths;
  logoRow(wb, ws, colCount, engConfig?.reportConfig);

  titleRow(ws, 'CRONOGRAMA FÍSICO-FINANCEIRO', colCount);
  const rn0 = ws.rowCount + 1;
  ws.addRow([`${meses} meses · ${etapas.length} etapas · Total: ${fmt(totalGlobal)}`]);
  ws.mergeCells(rn0, 1, rn0, colCount);
  ws.getRow(rn0).getCell(1).font = { size: 9, color: { argb: C.TEXT_MID } };
  ws.addRow([]);
  metaRows(ws, engConfig || (result as any).engineeringConfig, etapas, colCount);

  const header = ['ETAPA', 'VALOR (R$)', ...Array.from({ length: meses }, (_, i) => `Mês ${i + 1}`), 'TOTAL'];
  headRow(ws, header);

  const firstDataRow = ws.rowCount + 1;
  const tmRn = firstDataRow + 2 * etapas.length;
  const pmRn = tmRn + 1;
  const paRn = tmRn + 2;
  const gRn = tmRn + 3;

  const etapaValueRowNums: number[] = [];
  let idx = 0;
  for (const et of etapas) {
    const vals = Array.from({ length: meses }, (_, m) => et.valoresMensais?.[m] || 0);
    const etTotal = vals.reduce((s: number, v: number) => s + v, 0);

    let totalVal: any = etTotal;
    if (engConfig?.reportConfig?.exportExcelWithFormulas) {
      const lastMonthCol = 2 + meses;
      totalVal = { formula: `SUM(C${ws.rowCount + 1}:${colToLetter(lastMonthCol)}${ws.rowCount + 1})` };
    }

    const r = dataRow(ws, [et.nome || et.description || '', et.valorTotal || 0, ...vals, totalVal], idx, Array.from({ length: meses + 2 }, (_, i) => i + 2));
    r.getCell(1).font = { bold: true, size: 9, color: { argb: C.TEXT_DARK } };
    // Apply number format to all monetary cells
    for (let i = 2; i <= colCount; i++) r.getCell(i).numFmt = '#,##0.00';

    const etapaRow = ws.rowCount;
    etapaValueRowNums.push(etapaRow);

    // Percentage sub-row
    const pctVals = Array.from({ length: meses }, (_, m) => {
      const col = 3 + m;
      const colLetter = colToLetter(col);
      if (engConfig?.reportConfig?.exportExcelWithFormulas) {
        return { formula: `${colLetter}${etapaRow}/B${etapaRow}` };
      } else {
        const pct = et.percentuais?.[m] || 0;
        return pct > 0 ? pct / 100 : '';
      }
    });

    let etPctGlobalVal: any = totalGlobal > 0 ? (et.valorTotal / totalGlobal) : 0;
    if (engConfig?.reportConfig?.exportExcelWithFormulas) {
      etPctGlobalVal = { formula: `B${etapaRow}/${colToLetter(colCount)}${gRn}` };
    }

    const pctR = ws.addRow(['', etPctGlobalVal, ...pctVals, '']);
    pctR.height = 12;
    for (let i = 1; i <= colCount; i++) {
      pctR.getCell(i).font = { size: 7, color: { argb: C.TEXT_MID }, italic: true };
      pctR.getCell(i).alignment = { horizontal: i >= 2 ? 'right' : 'left', vertical: 'middle' };
      pctR.getCell(i).border = border();
      if (i >= 2 && pctR.getCell(i).value !== '') pctR.getCell(i).numFmt = '0.00%';
    }
    idx++;
  }

  // TOTAL MENSAL row with SUM formulas
  const tmRow = ws.addRow(['TOTAL MENSAL', '', ...Array(meses).fill(''), '']);
  tmRow.height = 16;
  // SUM formula per month column
  for (let col = 2; col <= colCount; col++) {
    const colLetter = colToLetter(col);
    const refs = etapaValueRowNums.map(rn => `${colLetter}${rn}`).join('+');
    if (etapaValueRowNums.length > 0) {
      tmRow.getCell(col).value = { formula: refs } as any;
    }
    tmRow.getCell(col).numFmt = '#,##0.00';
  }
  for (let i = 1; i <= colCount; i++) {
    tmRow.getCell(i).fill = fill(C.GRAY_SUB);
    tmRow.getCell(i).border = border();
    tmRow.getCell(i).font = { bold: true, size: 9, color: { argb: C.TEXT_DARK } };
    tmRow.getCell(i).alignment = { horizontal: i >= 2 ? 'right' : 'left', vertical: 'middle' };
  }

  // % MENSAL row
  const pmVals = Array.from({ length: meses }, (_, m) => {
    const col = 3 + m;
    const colLetter = colToLetter(col);
    if (engConfig?.reportConfig?.exportExcelWithFormulas) {
      return { formula: `${colLetter}${tmRn}/${colToLetter(colCount)}${tmRn}` };
    } else {
      return (percentMensal?.[m] || 0) / 100;
    }
  });
  const pmRow = ws.addRow(['% MENSAL', '', ...pmVals, 1]);
  pmRow.height = 16;
  for (let i = 1; i <= colCount; i++) {
    pmRow.getCell(i).fill = fill(C.GRAY_ROW);
    pmRow.getCell(i).border = border();
    pmRow.getCell(i).font = { bold: true, size: 9, color: { argb: C.TEXT_MID } };
    pmRow.getCell(i).alignment = { horizontal: i >= 2 ? 'right' : 'left', vertical: 'middle' };
    if (i >= 2) pmRow.getCell(i).numFmt = '0.00%';
  }

  // % ACUMULADO row
  const paVals = Array.from({ length: meses }, (_, m) => {
    const col = 3 + m;
    const colLetter = colToLetter(col);
    if (engConfig?.reportConfig?.exportExcelWithFormulas) {
      if (m === 0) {
        return { formula: `${colLetter}${pmRn}` };
      } else {
        const prevColLetter = colToLetter(col - 1);
        return { formula: `${prevColLetter}${paRn}+${colLetter}${pmRn}` };
      }
    } else {
      return (percentAcumulado?.[m] || 0) / 100;
    }
  });
  const paRow = ws.addRow(['% ACUMULADO', '', ...paVals, 1]);
  paRow.height = 16;
  for (let i = 1; i <= colCount; i++) {
    paRow.getCell(i).fill = fill(C.GRAY_ROW);
    paRow.getCell(i).border = border();
    paRow.getCell(i).font = { bold: true, size: 9, color: { argb: C.TEXT_MID } };
    paRow.getCell(i).alignment = { horizontal: i >= 2 ? 'right' : 'left', vertical: 'middle' };
    if (i >= 2) paRow.getCell(i).numFmt = '0.00%';
  }

  // Grand total
  const gRow = ws.addRow(['TOTAL GERAL', '', ...Array(meses).fill(''), 1]);
  ws.mergeCells(gRn, 1, gRn, colCount - 1);
  gRow.getCell(colCount).value = totalGlobal;
  gRow.getCell(colCount).numFmt = '#,##0.00';
  gRow.height = 20;
  for (let i = 1; i <= colCount; i++) {
    const c = gRow.getCell(i);
    c.fill = fill(C.BLUE_DARK);
    c.border = border(C.BLUE_DARK);
    c.font = { bold: true, size: 10, color: { argb: C.WHITE } };
    c.alignment = { horizontal: 'right', vertical: 'middle' };
  }

  return saveWb(wb, 'cronograma.xlsx', returnBuffer);
}

// ── 6. CURVA ABC INSUMOS — with numeric values & formulas ────────────────────
export async function xlsCurvaAbcInsumos(insumos: any[], engConfig: EngineeringConfig | undefined, returnBuffer?: boolean) {
  setGlobalPrecision(engConfig);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ABC Insumos');
  setupPrint(ws, getOrientation('abc_insumos', engConfig?.reportConfig, false), engConfig?.reportConfig);
  ws.columns = [{ width: 6 }, { width: 10 }, { width: 15 }, { width: 42 }, { width: 10 }, { width: 7 }, { width: 14 }, { width: 10 }, { width: 10 }];
  logoRow(wb, ws, 9, engConfig?.reportConfig);

  titleRow(ws, 'CURVA ABC DE INSUMOS', 9);
  metaRows(ws, engConfig, insumos, 9);
  headRow(ws, ['Nº', 'CÓDIGO', 'CATEGORIA', 'DESCRIÇÃO', 'BASE', 'UN.', 'CUSTO TOTAL', '% ITEM', '% ACUM.']);

  const safeInsumos = insumos || [];
  const list = [...safeInsumos].sort((a, b) => (Number(b.custoTotal) || 0) - (Number(a.custoTotal) || 0));
  const total = list.reduce((s, i) => s + (Number(i.custoTotal) || 0), 0);
  const firstData = ws.rowCount + 1;
  const gRn = firstData + list.length;
  let acum = 0;

  list.forEach((item, idx) => {
    const v = Number(item.custoTotal) || 0;
    const pct = total > 0 ? v / total : 0;
    acum += pct;
    const cls = (acum * 100) <= 80 ? C.RED : (acum * 100) <= 95 ? C.AMBER : C.GREEN;

    let pctVal: any = pct;
    let acumVal: any = acum;
    const rNum = ws.rowCount + 1;

    if (engConfig?.reportConfig?.exportExcelWithFormulas) {
      pctVal = { formula: `G${rNum}/$G$${gRn}` };
      if (rNum === firstData) {
        acumVal = { formula: `H${rNum}` };
      } else {
        acumVal = { formula: `I${rNum - 1}+H${rNum}` };
      }
    }

    const catLabel = (item.categoria && CATEGORIA_META[item.categoria as InsumoCategoria])
      ? CATEGORIA_META[item.categoria as InsumoCategoria].label
      : (item.categoria || '—');

    const r = dataRow(ws, [idx + 1, cleanCodeForDisplay(item.codigo || ''), catLabel, item.descricao || '', item.base || '', cleanUnitForDisplay(item.unidade || ''), v, pctVal, acumVal], idx, [7, 8, 9]);
    r.getCell(7).numFmt = '#,##0.00';
    r.getCell(8).numFmt = '0.00%';
    r.getCell(9).numFmt = '0.00%';
    r.getCell(8).font = { bold: true, size: 9, color: { argb: cls } };
    r.getCell(9).font = { bold: true, size: 9, color: { argb: cls } };
  });

  // Grand total with SUM formula
  const lastData = ws.rowCount;
  const gRow = ws.addRow(['TOTAL', '', '', '', '', '', '', 1, '']);
  ws.mergeCells(gRn, 1, gRn, 6);
  if (list.length > 0) {
    gRow.getCell(7).value = { formula: `SUM(G${firstData}:G${lastData})` } as any;
  } else {
    gRow.getCell(7).value = total;
  }
  gRow.getCell(7).numFmt = '#,##0.00';
  gRow.getCell(8).value = 1;
  gRow.getCell(8).numFmt = '0.00%';
  gRow.height = 20;
  for (let i = 1; i <= 9; i++) {
    const c = gRow.getCell(i);
    c.fill = fill(C.BLUE_DARK);
    c.border = border(C.BLUE_DARK);
    c.font = { bold: true, size: 10, color: { argb: C.WHITE } };
    c.alignment = { horizontal: 'right', vertical: 'middle' };
  }

  return saveWb(wb, 'abc-insumos.xlsx', returnBuffer);
}

// ── 9. MEMÓRIA DE CÁLCULO — dedicated report ──────────────────────────────────
export async function xlsMemoriaCalculo(items: any[], engConfig: EngineeringConfig | undefined, returnBuffer?: boolean) {
  setGlobalPrecision(engConfig);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Memória de Cálculo');
  setupPrint(ws, getOrientation('memoria', engConfig?.reportConfig, false), engConfig?.reportConfig);
  ws.columns = [
    { width: 10 }, // Item
    { width: 35 }, // Descrição
    { width: 8 },  // Unidade
    { width: 30 }, // Detalhamento da Memória
    { width: 12 }, // Quant/Mult
    { width: 12 }, // Comprimento
    { width: 12 }, // Largura
    { width: 12 }, // Altura
    { width: 15 }, // Subtotal
  ];
  logoRow(wb, ws, 9, engConfig?.reportConfig);
  titleRow(ws, 'MEMÓRIA DE CÁLCULO', 9);
  metaRows(ws, engConfig, items, 9);
  headRow(ws, ['ITEM', 'DESCRIÇÃO', 'UN', 'DETALHAMENTO DA MEMÓRIA', 'QUANT/MULT', 'COMPR (m)', 'LARG (m)', 'ALT (m)', 'SUBTOTAL']);

  let idx = 0;
  for (const it of items) {
    if (isGrouper(it.type)) {
      ws.addRow([]);
      const rn = ws.rowCount;
      ws.mergeCells(rn, 1, rn, 9);
      const r = ws.lastRow!;
      r.getCell(1).value = `${it.itemNumber} — ${it.description}`;
      r.getCell(1).font = { bold: true, size: 10, color: { argb: C.TEXT_DARK } };
      r.getCell(1).fill = fill(C.GRAY_SUB);
      r.height = 18;
      continue;
    }

    const hasCalc = it.calculationMemory && it.calculationMemory.trim() !== '';
    let calcObj: any = null;
    if (hasCalc) {
      try {
        calcObj = JSON.parse(it.calculationMemory);
      } catch (e) {
        console.error("Erro ao fazer parse da memoria de calculo:", e);
      }
    }

    const itemBg = idx % 2 === 0 ? C.WHITE : C.GRAY_ROW;
    idx++;

    if (!calcObj) {
      const r = ws.addRow([
        it.itemNumber,
        it.description,
        cleanUnitForDisplay(it.unit || '—'),
        'Quantidade direta (sem memória cadastrada)',
        1,
        '—',
        '—',
        '—',
        Number(it.quantity) || 0
      ]);
      r.height = 16;
      for (let i = 1; i <= 9; i++) {
        const cell = r.getCell(i);
        cell.fill = fill(itemBg);
        cell.border = border();
        cell.font = { size: 9, color: { argb: C.TEXT_DARK } };
        if (i >= 5) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          if (i === 9 || i === 5) cell.numFmt = '#,##0.00';
        } else {
          cell.alignment = { horizontal: i === 3 ? 'center' : 'left', vertical: 'middle', wrapText: true };
        }
      }
    } else if (calcObj.mode === 'SIMPLE') {
      const r = ws.addRow([
        it.itemNumber,
        it.description,
        cleanUnitForDisplay(it.unit || '—'),
        `Fórmula: ${calcObj.formula}`,
        1,
        '—',
        '—',
        '—',
        Number(it.quantity) || 0
      ]);
      r.height = 16;
      for (let i = 1; i <= 9; i++) {
        const cell = r.getCell(i);
        cell.fill = fill(itemBg);
        cell.border = border();
        cell.font = { size: 9, color: { argb: C.TEXT_DARK } };
        if (i >= 5) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          if (i === 9 || i === 5) cell.numFmt = '#,##0.00';
        } else {
          cell.alignment = { horizontal: i === 3 ? 'center' : 'left', vertical: 'middle', wrapText: true };
        }
      }
    } else if (calcObj.mode === 'STRUCTURED' && Array.isArray(calcObj.rows)) {
      const startRow = ws.rowCount + 1;
      const calcRows = calcObj.rows;

      calcRows.forEach((row: any, rIdx: number) => {
        const rNum = ws.rowCount + 1;
        const r = ws.addRow([
          rIdx === 0 ? it.itemNumber : '',
          rIdx === 0 ? it.description : '',
          rIdx === 0 ? cleanUnitForDisplay(it.unit || '—') : '',
          row.description || `Linha ${rIdx + 1}`,
          Number(row.multiplier) || 0,
          row.length ? Number(row.length) : '—',
          row.width ? Number(row.width) : '—',
          row.height ? Number(row.height) : '—',
          { formula: `ROUND(E${rNum} * IF(ISNUMBER(F${rNum}), F${rNum}, 1) * IF(ISNUMBER(G${rNum}), G${rNum}, 1) * IF(ISNUMBER(H${rNum}), H${rNum}, 1), 4)` }
        ]);
        r.height = 16;
        for (let i = 1; i <= 9; i++) {
          const cell = r.getCell(i);
          cell.fill = fill(itemBg);
          cell.border = border();
          cell.font = { size: 9, color: { argb: C.TEXT_DARK } };
          if (i >= 5) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            if (i === 5 || i === 9) cell.numFmt = '#,##0.00##';
            else if (typeof cell.value === 'number') cell.numFmt = '#,##0.00##';
          } else {
            cell.alignment = { horizontal: i === 3 ? 'center' : 'left', vertical: 'middle', wrapText: true };
          }
        }
      });
      const endRow = ws.rowCount;

      if (calcRows.length > 1) {
        ws.mergeCells(startRow, 1, endRow, 1);
        ws.mergeCells(startRow, 2, endRow, 2);
        ws.mergeCells(startRow, 3, endRow, 3);
        ws.getCell(startRow, 1).alignment = { vertical: 'middle', horizontal: 'left' };
        ws.getCell(startRow, 2).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        ws.getCell(startRow, 3).alignment = { vertical: 'middle', horizontal: 'center' };
      }
    }
  }

  return saveWb(wb, 'memoria-calculo.xlsx', returnBuffer);
}

