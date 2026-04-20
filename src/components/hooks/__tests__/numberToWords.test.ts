/**
 * ══════════════════════════════════════════════════════════
 *  numberToWords & currencyToWords — Tests
 *  Valores por extenso em cartas propostas licitatórias.
 *  Erros aqui → documento jurídico inválido.
 * ══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { numberToWords, currencyToWords } from '../../proposals/letter/utils/numberToWords';

describe('numberToWords', () => {
    it('should handle zero', () => {
        expect(numberToWords(0)).toBe('zero');
    });

    it('should handle single digits', () => {
        expect(numberToWords(1)).toBe('um');
        expect(numberToWords(5)).toBe('cinco');
        expect(numberToWords(9)).toBe('nove');
    });

    it('should handle teens', () => {
        expect(numberToWords(10)).toBe('dez');
        expect(numberToWords(11)).toBe('onze');
        expect(numberToWords(15)).toBe('quinze');
        expect(numberToWords(19)).toBe('dezenove');
    });

    it('should handle tens', () => {
        expect(numberToWords(20)).toBe('vinte');
        expect(numberToWords(30)).toBe('trinta');
        expect(numberToWords(42)).toBe('quarenta e dois');
        expect(numberToWords(99)).toBe('noventa e nove');
    });

    it('should handle hundreds', () => {
        expect(numberToWords(100)).toBe('cem');
        expect(numberToWords(101)).toBe('cento e um');
        expect(numberToWords(200)).toBe('duzentos');
        expect(numberToWords(999)).toBe('novecentos e noventa e nove');
    });

    it('should handle thousands', () => {
        expect(numberToWords(1000)).toBe('mil');
        expect(numberToWords(1001)).toBe('mil e um');
        expect(numberToWords(1500)).toBe('mil e quinhentos');
        expect(numberToWords(2000)).toBe('dois mil');
        expect(numberToWords(10000)).toBe('dez mil');
        expect(numberToWords(100000)).toBe('cem mil');
    });

    it('should handle complex thousands', () => {
        expect(numberToWords(12345)).toBe('doze mil e trezentos e quarenta e cinco');
        expect(numberToWords(50000)).toBe('cinquenta mil');
    });

    it('should handle millions', () => {
        expect(numberToWords(1000000)).toBe('um milhão');
        expect(numberToWords(2500000)).toBe('dois milhões e quinhentos mil');
        expect(numberToWords(1234567)).toBe('um milhão, duzentos e trinta e quatro mil e quinhentos e sessenta e sete');
    });

    it('should handle billions', () => {
        expect(numberToWords(1000000000)).toBe('um bilhão');
        expect(numberToWords(2000000000)).toBe('dois bilhões');
    });

    it('should handle negative numbers', () => {
        expect(numberToWords(-5)).toBe('menos cinco');
        expect(numberToWords(-1000)).toBe('menos mil');
    });

    it('should ignore decimals (floor)', () => {
        expect(numberToWords(5.99)).toBe('cinco');
        expect(numberToWords(10.5)).toBe('dez');
    });

    it('should handle typical licitação validity (60 dias)', () => {
        expect(numberToWords(60)).toBe('sessenta');
    });

    it('should handle 90 dias', () => {
        expect(numberToWords(90)).toBe('noventa');
    });
});

describe('currencyToWords', () => {
    it('should handle zero', () => {
        expect(currencyToWords(0)).toBe('zero reais');
    });

    it('should handle R$ 1,00', () => {
        expect(currencyToWords(1)).toBe('um real');
    });

    it('should handle R$ 2,00', () => {
        expect(currencyToWords(2)).toBe('dois reais');
    });

    it('should handle cents only', () => {
        expect(currencyToWords(0.01)).toBe('um centavo');
        expect(currencyToWords(0.50)).toBe('cinquenta centavos');
        expect(currencyToWords(0.99)).toBe('noventa e nove centavos');
    });

    it('should handle reais + centavos', () => {
        expect(currencyToWords(1.50)).toBe('um real e cinquenta centavos');
        expect(currencyToWords(100.99)).toBe('cem reais e noventa e nove centavos');
    });

    it('should handle typical licitação values', () => {
        const result = currencyToWords(1234567.89);
        expect(result).toContain('um milhão');
        expect(result).toContain('reais');
        expect(result).toContain('oitenta e nove centavos');
    });

    it('should handle large values without cents', () => {
        const result = currencyToWords(5000000.00);
        expect(result).toBe('cinco milhões reais');
    });

    it('should handle R$ 1.000,00', () => {
        expect(currencyToWords(1000)).toBe('mil reais');
    });

    it('should handle R$ 2.500,00', () => {
        expect(currencyToWords(2500)).toBe('dois mil e quinhentos reais');
    });
});
