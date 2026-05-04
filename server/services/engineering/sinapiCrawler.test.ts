import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

vi.mock('../../lib/prisma', () => ({
  prisma: {},
}));

import { parseExcelAllUFs } from './sinapiCrawler';

function workbookBuffer(
  sheets: Record<string, any[][]>,
  formulas: Record<string, Record<string, XLSX.CellObject>> = {},
): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    for (const [address, cell] of Object.entries(formulas[name] || {})) {
      sheet[address] = cell;
    }
    XLSX.utils.book_append_sheet(wb, sheet, name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('SINAPI crawler parser', () => {
  it('keeps analytical children when SINAPI omits repeated parent code in merged rows', () => {
    const ufHeaders = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'RR'];
    const buffer = workbookBuffer({
      CCD: [
        ['GRUPO', 'CÓDIGO', 'DESCRIÇÃO', 'UNIDADE', ...ufHeaders],
        ['SERVICO', '103689', 'FORNECIMENTO E INSTALAÇÃO DE PLACA DE OBRA', 'M2', 470.47, 470.47, 470.47, 470.47, 470.47, 470.47, 470.47, 470.47, 470.47, 460.61],
      ],
      ANALÍTICO: [
        ['COMPOSIÇÃO', 'GRUPO', 'TIPO ITEM', 'CÓDIGO DO ITEM', 'DESCRIÇÃO', 'UNIDADE', 'COEFICIENTE'],
        ['103689', '', 'INSUMO', '5069', 'PREGO DE ACO POLIDO COM CABECA 17 X 27', 'KG', 0.0132],
        ['', '', 'INSUMO', '5065', 'PREGO DE ACO POLIDO COM CABECA 10 X 10', 'KG', 0.0113],
        ['', '', 'INSUMO', '4509', 'SARRAFO *2,5 X 10* CM EM PINUS', 'M', 3.2083],
        ['', '', 'INSUMO', '00004813', 'PLACA DE OBRA EM CHAPA GALVANIZADA', 'M2', 1],
      ],
    });

    const parsed = parseExcelAllUFs(buffer, true);
    const rrItems = parsed.get('RR')?.compositionItems || [];

    expect(rrItems.filter(item => item.parentCode === '103689')).toHaveLength(4);
    expect(rrItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parentCode: '103689',
        code: '00004813',
        description: 'PLACA DE OBRA EM CHAPA GALVANIZADA',
        quantity: 1,
      }),
    ]));
  });

  it('recovers analytical parent and child codes stored as Caixa hyperlink formulas', () => {
    const buffer = workbookBuffer({
      CCD: [
        ['GRUPO', 'CÓDIGO', 'DESCRIÇÃO', 'UNIDADE', 'AC', 'PA'],
        ['SERVICO', '103689', 'FORNECIMENTO E INSTALAÇÃO DE PLACA DE OBRA', 'M2', 470.47, 473.56],
      ],
      ANALÍTICO: [
        ['COMPOSIÇÃO', 'GRUPO', 'TIPO ITEM', 'CÓDIGO DO ITEM', 'DESCRIÇÃO', 'UNIDADE', 'COEFICIENTE', 'AC', 'PA'],
        [0, '', 'INSUMO', 0, 'PLACA DE OBRA EM CHAPA GALVANIZADA', 'M2', 1, 400, 399.97],
      ],
    }, {
      ANALÍTICO: {
        A2: { t: 'n', v: 0, f: 'HYPERLINK("#Composições!A1","103689")' },
        D2: { t: 'n', v: 0, f: 'HYPERLINK("#Insumos!A1","00004813")' },
      },
    });

    const parsed = parseExcelAllUFs(buffer, true);
    const pa = parsed.get('PA');

    expect(pa?.compositionItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parentCode: '103689',
        code: '00004813',
        description: 'PLACA DE OBRA EM CHAPA GALVANIZADA',
        quantity: 1,
      }),
    ]));
    expect(pa?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: '00004813',
        description: 'PLACA DE OBRA EM CHAPA GALVANIZADA',
        price: 399.97,
      }),
    ]));
  });

  it('uses the SINAPI attributed SP price when a child item has no local UF price', () => {
    const ufHeaders = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'PA', 'SP', 'TO'];
    const buffer = workbookBuffer({
      ISD: [
        ['SINAPI'],
        ['RELATÓRIO DE PREÇOS DE INSUMOS'],
        ['Mês de Referência:', '02/2026'],
        ['Data de emissão:', '23/03/2026'],
        ['Classificação', 'Código do\r\nInsumo', 'Descrição do Insumo', 'Unidade', 'Origem de\r\nPreço', ...ufHeaders],
        ['MATERIAL', '39873', 'JUNTA DE EXPANSAO DE COBRE, PONTA X PONTA, 22 MM', 'UN', 'CR', '', '', '', '', '', '', '', '', '', '', 563.28, ''],
      ],
      CSD: [
        ['SINAPI'],
        ['RELATÓRIO DE CUSTOS DE COMPOSIÇÕES'],
        ['Mês de Referência:', '02/2026'],
        ['Data de emissão:', '23/03/2026'],
        ['Grupo', 'Código da\r\nComposição', 'Descrição', 'Unidade', ...ufHeaders.flatMap(uf => [uf, ''])],
        ['Instalações em Cobre', '93052', 'JUNTA DE EXPANSÃO EM COBRE, DN 22 MM', 'UN', ...ufHeaders.flatMap(uf => [uf === 'PA' ? 568.42 : 570, 0])],
      ],
      ANALÍTICO: [
        ['SINAPI'],
        ['RELATÓRIO ANALÍTICO DE COMPOSIÇÕES'],
        ['Mês de Referência:', '02/2026'],
        ['Data de emissão:', '23/03/2026'],
        ['Grupo', 'Código da\r\nComposição', 'Tipo Item', 'Código do\r\nItem', 'Descrição', 'Unidade', 'Coeficiente', 'Situação'],
        ['Instalações em Cobre', '93052', 'INSUMO', '39873', 'JUNTA DE EXPANSAO DE COBRE, PONTA X PONTA, 22 MM', 'UN', 1, 'COM PREÇO'],
      ],
    });

    const parsed = parseExcelAllUFs(buffer, false);
    const pa = parsed.get('PA');

    expect(pa?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: '39873',
        description: 'JUNTA DE EXPANSAO DE COBRE, PONTA X PONTA, 22 MM',
        price: 563.28,
      }),
    ]));
    expect(pa?.compositionItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parentCode: '93052',
        code: '39873',
        quantity: 1,
      }),
    ]));
  });
});
