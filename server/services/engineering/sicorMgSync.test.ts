import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { hasConfiguredSicorAuthToken, normalizeSicorPublication, parseSicorWorkbook, validateSicorAuthToken } from './sicorMgSync';

function workbookBuffer(rows: any[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Servicos');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('sicorMgSync', () => {
  it('normalizes SICOR publication metadata from DER payloads', () => {
    const publication = normalizeSicorPublication({
      id: 123,
      tpCondicao: { codigo: 'CD', descricao: 'Com Desoneração' },
      tpRegiao: { codigo: 'CENTRAL', descricao: 'Central' },
      publicacao: { tpMes: 'Março', nrAno: 2026, dtPublicacao: '2026-03-15T10:00:00' },
      xlsServicos: { id: 77, nmArquivo: 'servicos.xlsx' },
    });

    expect(publication).toMatchObject({
      id: 123,
      conditionCode: 'CD',
      payrollExemption: true,
      regionCode: 'CENTRAL',
      period: { year: 2026, month: 3, version: '03/2026' },
      xlsServicesAttachment: { id: 77, fileName: 'servicos.xlsx' },
    });
  });

  it('parses generic SICOR service workbooks into service compositions', () => {
    const buffer = workbookBuffer([
      ['Sistema de Custos e Orçamentos Referenciais'],
      ['Código Auxiliar', 'Descrição do Serviço', 'Unidade', 'Custo Unitário'],
      ['ED-12345', 'ALVENARIA DE VEDAÇÃO COM BLOCO CERÂMICO', 'M2', '1.234,56'],
      ['ED-99999', 'LINHA SEM PREÇO', 'M2', ''],
    ]);

    expect(parseSicorWorkbook(buffer, 'SERVICO')).toEqual([
      {
        code: 'ED-12345',
        description: 'ALVENARIA DE VEDAÇÃO COM BLOCO CERÂMICO',
        unit: 'M2',
        price: 1234.56,
        type: 'SERVICO',
      },
    ]);
  });

  it('validates configured or explicit auth tokens without exposing token values', () => {
    const originalSicor = process.env.SICOR_MG_TOKEN;
    const originalDer = process.env.DER_MG_SCO_TOKEN;

    try {
      delete process.env.SICOR_MG_TOKEN;
      delete process.env.DER_MG_SCO_TOKEN;

      expect(hasConfiguredSicorAuthToken()).toBe(false);
      expect(() => validateSicorAuthToken()).toThrow(/Token SICOR-MG ausente/);
      expect(() => validateSicorAuthToken('temporary-token')).not.toThrow();

      process.env.SICOR_MG_TOKEN = 'configured-token';
      expect(hasConfiguredSicorAuthToken()).toBe(true);
      expect(() => validateSicorAuthToken()).not.toThrow();
    } finally {
      if (originalSicor === undefined) delete process.env.SICOR_MG_TOKEN;
      else process.env.SICOR_MG_TOKEN = originalSicor;
      if (originalDer === undefined) delete process.env.DER_MG_SCO_TOKEN;
      else process.env.DER_MG_SCO_TOKEN = originalDer;
    }
  });
});
