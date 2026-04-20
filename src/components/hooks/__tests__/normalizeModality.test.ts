/**
 * ══════════════════════════════════════════════════════════
 *  normalizeModality & normalizeTitle — Tests
 *  Cobertura para funções de normalização usadas em
 *  tabelas, dashboard, gráficos, cards e PNCP.
 * ══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { normalizeModality, normalizeTitle } from '../../../utils/normalizeModality';

// ── normalizeModality ─────────────────────────────────────

describe('normalizeModality (frontend)', () => {
    it('should return "Não informada" for null/undefined/empty', () => {
        expect(normalizeModality(null)).toBe('Não informada');
        expect(normalizeModality(undefined)).toBe('Não informada');
        expect(normalizeModality('')).toBe('Não informada');
    });

    it('should normalize pregão variants (com e sem acento)', () => {
        expect(normalizeModality('Pregão Eletrônico')).toBe('Pregão Eletrônico');
        expect(normalizeModality('pregao presencial')).toBe('Pregão Eletrônico');
        expect(normalizeModality('PREGÃO')).toBe('Pregão Eletrônico');
    });

    it('should normalize concorrência variants', () => {
        expect(normalizeModality('Concorrência Eletrônica')).toBe('Concorrência Eletrônica');
        expect(normalizeModality('concorrencia')).toBe('Concorrência Eletrônica');
    });

    it('should normalize diálogo competitivo', () => {
        expect(normalizeModality('Diálogo Competitivo')).toBe('Diálogo Competitivo');
        expect(normalizeModality('dialogo competitivo')).toBe('Diálogo Competitivo');
    });

    it('should normalize concurso', () => {
        expect(normalizeModality('Concurso Público')).toBe('Concurso');
    });

    it('should normalize leilão', () => {
        expect(normalizeModality('Leilão')).toBe('Leilão');
        expect(normalizeModality('leilao')).toBe('Leilão');
    });

    it('should normalize procedimentos auxiliares', () => {
        expect(normalizeModality('Pré-Qualificação')).toBe('Procedimento Auxiliar');
        expect(normalizeModality('pre-qualificacao')).toBe('Procedimento Auxiliar');
        expect(normalizeModality('pre qualificação')).toBe('Procedimento Auxiliar');
        expect(normalizeModality('Manifestação de Interesse')).toBe('Procedimento Auxiliar');
    });

    it('should normalize credenciamento', () => {
        expect(normalizeModality('Credenciamento')).toBe('Credenciamento');
    });

    it('should normalize contratação direta', () => {
        expect(normalizeModality('Dispensa de Licitação')).toBe('Dispensa');
        expect(normalizeModality('Inexigibilidade')).toBe('Inexigibilidade');
    });

    it('should handle "licitação eletrônica" → Concorrência', () => {
        expect(normalizeModality('Licitação Eletrônica')).toBe('Concorrência Eletrônica');
    });

    it('should fallback with capitalized first letter', () => {
        expect(normalizeModality('outra modalidade')).toBe('Outra modalidade');
    });
});

// ── normalizeTitle ────────────────────────────────────────

describe('normalizeTitle', () => {
    it('should return empty string for null/undefined/empty', () => {
        expect(normalizeTitle(null)).toBe('');
        expect(normalizeTitle(undefined)).toBe('');
        expect(normalizeTitle('')).toBe('');
    });

    it('should NOT modify text that is already mixed-case', () => {
        const normal = 'Pregão Eletrônico nº 045/2025';
        expect(normalizeTitle(normal)).toBe(normal);
    });

    it('should convert ALL CAPS to Title Case', () => {
        const allCaps = 'AQUISIÇÃO DE MATERIAIS DE LIMPEZA PARA A SECRETARIA DE EDUCAÇÃO';
        const result = normalizeTitle(allCaps);
        expect(result).not.toBe(allCaps); // Must have been transformed
        // Should start with uppercase
        expect(result.charAt(0)).toBe(result.charAt(0).toUpperCase());
    });

    it('should preserve state acronyms', () => {
        const result = normalizeTitle('SECRETARIA DE EDUCAÇÃO DO ESTADO DO CE');
        expect(result).toContain('CE');
    });

    it('should preserve corporate acronyms (CNPJ, CPF, etc.)', () => {
        const result = normalizeTitle('EMPRESA TESTE ME CNPJ 12345678');
        expect(result).toContain('CNPJ');
        expect(result).toContain('ME');
    });

    it('should preserve text with only numbers', () => {
        const numbers = '12345/2025';
        expect(normalizeTitle(numbers)).toBe(numbers);
    });

    it('should convert ALL CAPS pregão title to title case', () => {
        const result = normalizeTitle('PREGÃO ELETRÔNICO N° 045/2025');
        // Should convert to Title Case
        expect(result.charAt(0)).toBe('P');
        expect(result).not.toBe('PREGÃO ELETRÔNICO N° 045/2025');
    });
});
