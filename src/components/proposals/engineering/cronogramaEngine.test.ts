/**
 * cronogramaEngine.test.ts — Testes do motor de cronograma físico-financeiro
 */
import { describe, it, expect } from 'vitest';
import { calcularCronograma, gerarEtapasPadrao, type CronogramaEtapa } from './cronogramaEngine';
import { syncCronogramaFromItems, buildEtapaTotals } from './cronogramaSync';

// ═══════════════════════════════════════════════
// calcularCronograma
// ═══════════════════════════════════════════════

describe('calcularCronograma', () => {
    it('calcula totais mensais corretamente', () => {
        const etapas: CronogramaEtapa[] = [
            { id: '1', nome: 'Fundações', valorTotal: 100000, percentuais: [60, 40] },
            { id: '2', nome: 'Estrutura', valorTotal: 200000, percentuais: [0, 100] },
        ];
        const result = calcularCronograma(etapas, 2);
        expect(result.meses).toBe(2);
        expect(result.totalGlobal).toBe(300000);
        // Mês 1: 100k*60% + 200k*0% = 60000
        expect(result.mensalTotal[0]).toBe(60000);
        // Mês 2: 100k*40% + 200k*100% = 240000
        expect(result.mensalTotal[1]).toBe(240000);
    });

    it('calcula acumulado corretamente', () => {
        const etapas: CronogramaEtapa[] = [
            { id: '1', nome: 'Etapa 1', valorTotal: 100000, percentuais: [30, 30, 40] },
        ];
        const result = calcularCronograma(etapas, 3);
        expect(result.acumulado[0]).toBe(30000);
        expect(result.acumulado[1]).toBe(60000);
        expect(result.acumulado[2]).toBe(100000);
    });

    it('último mês ajusta percentual acumulado para 100%', () => {
        const etapas: CronogramaEtapa[] = [
            { id: '1', nome: 'Etapa 1', valorTotal: 100, percentuais: [33, 33, 34] },
        ];
        const result = calcularCronograma(etapas, 3);
        expect(result.percentAcumulado[2]).toBe(100);
    });

    it('com 0 meses → arrays vazios sem crash', () => {
        const etapas: CronogramaEtapa[] = [
            { id: '1', nome: 'Etapa 1', valorTotal: 100000, percentuais: [] },
        ];
        const result = calcularCronograma(etapas, 0);
        expect(result.meses).toBe(0);
        expect(result.mensalTotal).toHaveLength(0);
        expect(result.acumulado).toHaveLength(0);
        expect(result.totalGlobal).toBe(100000);
    });

    it('etapas vazias → totalGlobal = 0', () => {
        const result = calcularCronograma([], 6);
        expect(result.totalGlobal).toBe(0);
        expect(result.mensalTotal.every(v => v === 0)).toBe(true);
    });

    it('percentuais > 100% → acumulado extrapola', () => {
        const etapas: CronogramaEtapa[] = [
            { id: '1', nome: 'Etapa 1', valorTotal: 100000, percentuais: [70, 70] },
        ];
        const result = calcularCronograma(etapas, 2);
        // 70% + 70% = 140% → acumulado > total
        expect(result.acumulado[1]).toBe(140000);
    });
});

// ═══════════════════════════════════════════════
// gerarEtapasPadrao
// ═══════════════════════════════════════════════

describe('gerarEtapasPadrao', () => {
    it('items vazios → array vazio', () => {
        expect(gerarEtapasPadrao([])).toHaveLength(0);
    });

    it('usa descrição real da ETAPA como nome', () => {
        const items = [
            { itemNumber: '1', description: 'Serviços Preliminares', totalPrice: 0, type: 'ETAPA' },
            { itemNumber: '1.1', description: 'Limpeza do terreno', totalPrice: 5000, type: 'COMPOSICAO' },
            { itemNumber: '2', description: 'Fundações', totalPrice: 0, type: 'ETAPA' },
            { itemNumber: '2.1', description: 'Estacas', totalPrice: 80000, type: 'COMPOSICAO' },
        ];
        const etapas = gerarEtapasPadrao(items);
        expect(etapas).toHaveLength(2);
        expect(etapas[0].nome).toContain('Serviços Preliminares');
        expect(etapas[0].valorTotal).toBe(5000);
        expect(etapas[1].nome).toContain('Fundações');
        expect(etapas[1].valorTotal).toBe(80000);
    });

    it('não conta ETAPAs no total', () => {
        const items = [
            { itemNumber: '1', description: 'Etapa 1', totalPrice: 99999, type: 'ETAPA' },
            { itemNumber: '1.1', description: 'Item 1', totalPrice: 100, type: 'COMPOSICAO' },
        ];
        const etapas = gerarEtapasPadrao(items);
        expect(etapas[0].valorTotal).toBe(100);
    });

    it('percentuais iniciam vazios', () => {
        const items = [
            { itemNumber: '1', description: 'Etapa', totalPrice: 0, type: 'ETAPA' },
            { itemNumber: '1.1', description: 'Item', totalPrice: 100, type: 'COMPOSICAO' },
        ];
        const etapas = gerarEtapasPadrao(items);
        expect(etapas[0].percentuais).toHaveLength(0);
    });
});

// ═══════════════════════════════════════════════
// cronogramaSync — syncCronogramaFromItems
// ═══════════════════════════════════════════════

describe('syncCronogramaFromItems', () => {
    it('atualiza valorTotal de etapa existente', () => {
        const items = [
            { itemNumber: '1', description: 'Etapa 1', totalPrice: 0, type: 'ETAPA' },
            { itemNumber: '1.1', description: 'Item', totalPrice: 200, type: 'COMPOSICAO' },
        ];
        const prev: CronogramaEtapa[] = [
            { id: '1', nome: 'Etapa 1', valorTotal: 100, percentuais: [50, 50] },
        ];
        const { etapas, changed } = syncCronogramaFromItems(items, prev);
        expect(changed).toBe(true);
        expect(etapas[0].valorTotal).toBe(200);
        expect(etapas[0].percentuais).toEqual([50, 50]); // preserva percentuais
    });

    it('adiciona nova etapa da planilha', () => {
        const items = [
            { itemNumber: '1', description: 'Etapa 1', totalPrice: 0, type: 'ETAPA' },
            { itemNumber: '1.1', description: 'Item', totalPrice: 100, type: 'COMPOSICAO' },
            { itemNumber: '2', description: 'Nova Etapa', totalPrice: 0, type: 'ETAPA' },
            { itemNumber: '2.1', description: 'Item 2', totalPrice: 500, type: 'COMPOSICAO' },
        ];
        const prev: CronogramaEtapa[] = [
            { id: '1', nome: 'Etapa 1', valorTotal: 100, percentuais: [100] },
        ];
        const { etapas, changed } = syncCronogramaFromItems(items, prev);
        expect(changed).toBe(true);
        expect(etapas).toHaveLength(2);
        expect(etapas[1].id).toBe('2');
        expect(etapas[1].valorTotal).toBe(500);
    });

    it('sem mudanças → changed = false', () => {
        const items = [
            { itemNumber: '1', description: 'Etapa 1', totalPrice: 0, type: 'ETAPA' },
            { itemNumber: '1.1', description: 'Item', totalPrice: 100, type: 'COMPOSICAO' },
        ];
        const prev: CronogramaEtapa[] = [
            { id: '1', nome: 'Etapa 1', valorTotal: 100, percentuais: [50, 50] },
        ];
        const { etapas, changed } = syncCronogramaFromItems(items, prev);
        expect(changed).toBe(false);
        expect(etapas).toStrictEqual(prev); // conteúdo igual
    });

    it('items vazios → preserva etapas existentes', () => {
        const prev: CronogramaEtapa[] = [
            { id: '1', nome: 'Etapa 1', valorTotal: 100, percentuais: [100] },
        ];
        const { etapas, changed } = syncCronogramaFromItems([], prev);
        expect(changed).toBe(false);
        expect(etapas).toBe(prev);
    });
});

// ═══════════════════════════════════════════════
// buildEtapaTotals
// ═══════════════════════════════════════════════

describe('buildEtapaTotals', () => {
    it('constrói mapa de totais por etapa', () => {
        const items = [
            { itemNumber: '1', description: 'Fundações', totalPrice: 0, type: 'ETAPA' },
            { itemNumber: '1.1', description: 'Escavação', totalPrice: 1000, type: 'COMPOSICAO' },
            { itemNumber: '1.2', description: 'Concreto', totalPrice: 2000, type: 'COMPOSICAO' },
        ];
        const totals = buildEtapaTotals(items);
        expect(totals.size).toBe(1);
        expect(totals.get('1')?.total).toBe(3000);
        expect(totals.get('1')?.name).toBe('Fundações');
    });
});
