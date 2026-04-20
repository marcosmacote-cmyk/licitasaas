/**
 * ══════════════════════════════════════════════════════════
 *  TextSanitizer — Tests
 *  Camada final de higienização textual da carta proposta.
 *  Testa remoção de placeholders, normalização de espaçamento,
 *  correção de pontuação e normalização de ALL CAPS.
 * ══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { TextSanitizer } from '../../proposals/letter/TextSanitizer';
import { LetterBlockType } from '../../proposals/letter/types';
import type { LetterBlock } from '../../proposals/letter/types';

const sanitizer = new TextSanitizer();

// ── Helper ──
function makeBlock(type: string, content: string, visible = true): LetterBlock {
    return {
        id: type,
        type: type as any,
        label: 'Test',
        required: true,
        editable: true,
        aiGenerated: false,
        content,
        order: 0,
        visible,
        validationStatus: 'valid',
    };
}

// ── sanitize (pipeline individual) ────────────────────────

describe('TextSanitizer.sanitize', () => {
    it('should return empty/whitespace text unchanged', () => {
        expect(sanitizer.sanitize('')).toBe('');
        expect(sanitizer.sanitize('   ')).toBe('   ');
    });

    it('should remove orphan placeholders', () => {
        const result = sanitizer.sanitize('Linha válida\nNão informado\nOutra linha');
        expect(result).not.toContain('Não informado');
        expect(result).toContain('Linha válida');
        expect(result).toContain('Outra linha');
    });

    it('should remove labeled placeholders', () => {
        const result = sanitizer.sanitize('Endereço: Não informado.\nRua: Teste');
        expect(result).not.toContain('Endereço: Não informado');
        expect(result).toContain('Rua: Teste');
    });

    it('should remove N/A placeholders', () => {
        const result = sanitizer.sanitize('N/A\nTexto real');
        expect(result).not.toMatch(/^N\/A$/m);
        expect(result).toContain('Texto real');
    });

    it('should normalize multiple spaces', () => {
        expect(sanitizer.sanitize('texto   com    espaços')).toBe('texto com espaços');
    });

    it('should normalize excessive blank lines', () => {
        const input = 'A\n\n\n\n\nB';
        const result = sanitizer.sanitize(input);
        // Should not have more than 3 consecutive newlines
        expect(result).not.toMatch(/\n{4,}/);
    });

    it('should remove spaces before punctuation', () => {
        expect(sanitizer.sanitize('texto , com espaço')).toBe('texto, com espaço');
        expect(sanitizer.sanitize('texto . com espaço')).toBe('texto. Com espaço');
    });

    it('should fix double periods', () => {
        expect(sanitizer.sanitize('final..')).toBe('final.');
    });

    it('should fix double commas', () => {
        expect(sanitizer.sanitize('a, , b')).toBe('a, b');
    });

    it('should fix comma before period', () => {
        expect(sanitizer.sanitize('texto,.')).toBe('texto.');
    });

    it('should remove orphan labels (label without value)', () => {
        const result = sanitizer.sanitize('Endereço: \nRua: 123');
        expect(result).not.toMatch(/^Endereço:\s*$/m);
        expect(result).toContain('Rua: 123');
    });

    it('should capitalize after period', () => {
        expect(sanitizer.sanitize('fim. início')).toBe('fim. Início');
    });

    it('should normalize ALL CAPS institution names to Title Case', () => {
        const result = sanitizer.sanitize('A SECRETARIA DE EDUCAÇÃO DO ESTADO atua aqui');
        expect(result).toContain('Secretaria de Educação do Estado');
    });

    it('should preserve acronyms within ALL CAPS conversion', () => {
        const result = sanitizer.sanitize('EMPRESA TESTE CNPJ 12345 LTDA EIRELI');
        expect(result).toContain('CNPJ');
        expect(result).toContain('LTDA');
        expect(result).toContain('EIRELI');
    });

    it('should remove tabs', () => {
        expect(sanitizer.sanitize('a\tb')).toBe('a b');
    });

    it('should fix space before slash', () => {
        expect(sanitizer.sanitize('nº 045 /2026')).toBe('nº 045/2026');
    });
});

// ── sanitizeAll (block-level) ─────────────────────────────

describe('TextSanitizer.sanitizeAll', () => {
    it('should sanitize visible blocks', () => {
        const blocks = [
            makeBlock(LetterBlockType.VALIDITY, 'texto   com    espaços'),
        ];
        const result = sanitizer.sanitizeAll(blocks);
        expect(result[0].content).toBe('texto com espaços');
    });

    it('should NOT sanitize invisible blocks', () => {
        const blocks = [
            makeBlock(LetterBlockType.BANKING, 'texto   com    espaços', false),
        ];
        const result = sanitizer.sanitizeAll(blocks);
        expect(result[0].content).toBe('texto   com    espaços');
    });

    it('should NOT sanitize fixed-format blocks (SIGNATURE, CLOSING, OBJECT)', () => {
        const signatureBlock = makeBlock(LetterBlockType.SIGNATURE, 'NOME   COMPLETO');
        const closingBlock = makeBlock(LetterBlockType.CLOSING, 'texto   com    espaços');
        const objectBlock = makeBlock(LetterBlockType.OBJECT, 'TEXTO  EM  CAPS');

        const result = sanitizer.sanitizeAll([signatureBlock, closingBlock, objectBlock]);
        expect(result[0].content).toBe('NOME   COMPLETO');
        expect(result[1].content).toBe('texto   com    espaços');
        expect(result[2].content).toBe('TEXTO  EM  CAPS');
    });

    it('should sanitize editable blocks like QUALIFICATION', () => {
        const blocks = [
            makeBlock(LetterBlockType.QUALIFICATION, 'Empresa  de  Teste..  CNPJ'),
        ];
        const result = sanitizer.sanitizeAll(blocks);
        expect(result[0].content).not.toContain('..');
    });
});
