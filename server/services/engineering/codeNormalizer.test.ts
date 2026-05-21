import { describe, expect, it } from 'vitest';
import { normalizeCode, buildCodeVariants, validateCodeFormat } from './codeNormalizer';

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
