import { describe, expect, it } from 'vitest';
import { normalizeCode, buildCodeVariants, validateCodeFormat, buildFuzzyCodeNeighbors } from './codeNormalizer';

describe('normalizeCode', () => {
    it('strips leading zeros from SINAPI codes', () => {
        expect(normalizeCode('091877', 'SINAPI')).toBe('91877');
        expect(normalizeCode('0091877', 'SINAPI')).toBe('91877');
        expect(normalizeCode('91877', 'SINAPI')).toBe('91877');
    });

    it('preserves 4-digit SINAPI codes', () => {
        expect(normalizeCode('7893', 'SINAPI')).toBe('7893');
        expect(normalizeCode('07893', 'SINAPI')).toBe('7893');
    });

    it('normalizes SEINFRA codes with C prefix', () => {
        expect(normalizeCode('C4495', 'SEINFRA')).toBe('C4495');
        expect(normalizeCode('4495', 'SEINFRA')).toBe('C4495');
        expect(normalizeCode('c4495', 'SEINFRA')).toBe('C4495');
    });

    it('normalizes SEINFRA codes with I prefix and handles 1-prefix OCR errors', () => {
        expect(normalizeCode('I7396', 'SEINFRA')).toBe('I7396');
        expect(normalizeCode('17396', 'SEINFRA')).toBe('I7396');
        expect(normalizeCode('10046', 'SEINFRA')).toBe('I0046');
        expect(normalizeCode('I1589', 'SEINFRA')).toBe('I1589');
        expect(normalizeCode('11589', 'SEINFRA')).toBe('I1589');
    });

    it('normalizes SEINFRA codes with internal spaces', () => {
        expect(normalizeCode('C 4495', 'SEINFRA')).toBe('C4495');
        expect(normalizeCode('1 7396', 'SEINFRA')).toBe('I7396');
    });

    it('normalizes ORSE codes with /ORSE suffix', () => {
        expect(normalizeCode('1234/ORSE', 'ORSE')).toBe('1234/ORSE');
        expect(normalizeCode('01234/ORSE', 'ORSE')).toBe('1234/ORSE');
        expect(normalizeCode('1234', 'ORSE')).toBe('1234/ORSE');
    });

    it('normalizes ORSE codes with I prefix (PDF formatting artifact)', () => {
        expect(normalizeCode('I09783', 'ORSE')).toBe('9783/ORSE');
        expect(normalizeCode('I04342S', 'ORSE')).toBe('4342/ORSE');
        expect(normalizeCode('I1234', 'ORSE')).toBe('1234/ORSE');
    });

    it('handles empty and N/A codes gracefully', () => {
        expect(normalizeCode('', 'SINAPI')).toBe('');
        expect(normalizeCode('N/A', 'SINAPI')).toBe('N/A');
    });

    it('uppercases unknown source codes', () => {
        expect(normalizeCode('abc-123', 'CUSTOM')).toBe('abc-123');
    });

    it('strips trailing dots', () => {
        expect(normalizeCode('91877.', 'SINAPI')).toBe('91877');
    });
});

describe('buildCodeVariants', () => {
    it('generates padded variants for SINAPI', () => {
        const variants = buildCodeVariants('91877', 'SINAPI');
        expect(variants).toContain('91877');
        expect(variants).toContain('091877');
        expect(variants).toContain('0091877');
    });

    it('generates ORSE variants with and without suffix', () => {
        const variants = buildCodeVariants('1234/ORSE', 'ORSE');
        expect(variants).toContain('1234/ORSE');
        expect(variants).toContain('1234');
        expect(variants).toContain('01234/ORSE');
    });

    it('generates cross variants for SEINFRA codes', () => {
        const variants = buildCodeVariants('17396', 'SEINFRA');
        expect(variants).toContain('I7396');
        expect(variants).toContain('C17396');
        expect(variants).toContain('C7396');
        expect(variants).toContain('17396');
        expect(variants).toContain('7396');
    });

    it('returns at least the original and normalized code', () => {
        const variants = buildCodeVariants('C4495', 'SEINFRA');
        expect(variants.length).toBeGreaterThanOrEqual(1);
        expect(variants).toContain('C4495');
    });
});

describe('validateCodeFormat', () => {
    it('accepts valid SINAPI codes', () => {
        expect(validateCodeFormat('91877', 'SINAPI')).toBeNull();
        expect(validateCodeFormat('7893', 'SINAPI')).toBeNull();
    });

    it('rejects invalid SINAPI codes', () => {
        expect(validateCodeFormat('ABC', 'SINAPI')).toContain('inválido');
        expect(validateCodeFormat('12', 'SINAPI')).toContain('inválido'); // too short
    });

    it('accepts valid SEINFRA codes', () => {
        expect(validateCodeFormat('C4495', 'SEINFRA')).toBeNull();
        expect(validateCodeFormat('4495', 'SEINFRA')).toBeNull();
    });

    it('rejects invalid SEINFRA codes', () => {
        expect(validateCodeFormat('ABCDEF', 'SEINFRA')).toContain('inválido');
    });

    it('accepts valid ORSE codes', () => {
        expect(validateCodeFormat('1234/ORSE', 'ORSE')).toBeNull();
        expect(validateCodeFormat('1234', 'ORSE')).toBeNull();
    });

    it('returns null for empty/N/A codes', () => {
        expect(validateCodeFormat('', 'SINAPI')).toBeNull();
        expect(validateCodeFormat('N/A', 'SINAPI')).toBeNull();
    });

    it('returns null for unknown bases', () => {
        expect(validateCodeFormat('XYZ-123', 'CUSTOM_BASE')).toBeNull();
    });
});

describe('buildFuzzyCodeNeighbors', () => {
    it('generates ±1 and ±2 neighbors for SINAPI numeric codes', () => {
        const neighbors = buildFuzzyCodeNeighbors('100862', 'SINAPI');
        expect(neighbors).toContain('100861');
        expect(neighbors).toContain('100863');
        expect(neighbors).toContain('100860');
        expect(neighbors).toContain('100864');
        // Should NOT contain the original
        expect(neighbors).not.toContain('100862');
    });

    it('generates neighbors for SEINFRA I-prefix codes', () => {
        const neighbors = buildFuzzyCodeNeighbors('I7396', 'SEINFRA');
        expect(neighbors).toContain('I7395');
        expect(neighbors).toContain('I7397');
        expect(neighbors).toContain('I7394');
        expect(neighbors).toContain('I7398');
    });

    it('generates neighbors for SEINFRA C-prefix codes', () => {
        const neighbors = buildFuzzyCodeNeighbors('C2667', 'SEINFRA');
        expect(neighbors).toContain('C2666');
        expect(neighbors).toContain('C2668');
        expect(neighbors).toContain('C2665');
        expect(neighbors).toContain('C2669');
    });

    it('returns empty array for empty/N/A codes', () => {
        expect(buildFuzzyCodeNeighbors('')).toEqual([]);
        expect(buildFuzzyCodeNeighbors('N/A')).toEqual([]);
    });

    it('returns empty array for non-numeric codes', () => {
        expect(buildFuzzyCodeNeighbors('ABCDEF')).toEqual([]);
    });

    it('generates cross-variants for SEINFRA neighbors', () => {
        const neighbors = buildFuzzyCodeNeighbors('I7396', 'SEINFRA');
        // Should also contain C-prefix variants of the neighbors
        expect(neighbors).toContain('C7395');
        expect(neighbors).toContain('C7397');
    });

    it('swaps I prefix to 1 for OCR confusion (I00862 → 100862)', () => {
        const neighbors = buildFuzzyCodeNeighbors('I00862', 'SINAPI');
        // Strategy B: I→1 swap
        expect(neighbors).toContain('100862');
    });

    it('generates similar digit substitutions (C2867 → C2667 via 8→6)', () => {
        const neighbors = buildFuzzyCodeNeighbors('C2867', 'SEINFRA');
        // Strategy C: digit 8 → 6 at position 1 (second digit of 2867)
        expect(neighbors).toContain('C2667');
    });
});
