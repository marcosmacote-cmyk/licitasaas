/**
 * compositionSaveService.test.ts — Tests for extracted save helpers
 * G10: Integration-level tests for the composition save flow
 */
import { describe, it, expect } from 'vitest';
import {
    isTempId,
    flattenCompositionGroups,
    buildCompositionMetadata,
    correctCoefficientScaling,
    generateItemCode,
    type SaveWarning
} from './compositionSaveService';

describe('isTempId', () => {
    it('detects null/undefined/empty as temporary', () => {
        expect(isTempId(null)).toBe(true);
        expect(isTempId(undefined)).toBe(true);
        expect(isTempId('')).toBe(true);
    });

    it('detects all temp prefixes', () => {
        expect(isTempId('new-abc123')).toBe(true);
        expect(isTempId('temp-xyz')).toBe(true);
        expect(isTempId('new-casca-001')).toBe(true);
        expect(isTempId('new-aux-002')).toBe(true);
        expect(isTempId('synthetic-003')).toBe(true);
        expect(isTempId('etapa-004')).toBe(true);
    });

    it('identifies real UUIDs as non-temporary', () => {
        expect(isTempId('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
        expect(isTempId('abc123')).toBe(false);
        expect(isTempId('some-real-id')).toBe(false);
    });
});

describe('flattenCompositionGroups', () => {
    it('flattens grouped items with correct groupKey', () => {
        const composition = {
            groups: {
                MATERIAL: [
                    { item: { code: 'I001', price: 10 }, coefficient: 2 },
                    { item: { code: 'I002', price: 20 }, coefficient: 1 },
                ],
                MAO_DE_OBRA: [
                    { item: { code: 'I003', price: 30 }, coefficient: 1.5 },
                ],
            },
        };

        const { flatItems, hasGroups } = flattenCompositionGroups(composition);
        expect(hasGroups).toBe(true);
        expect(flatItems).toHaveLength(3);
        expect(flatItems[0].groupKey).toBe('MATERIAL');
        expect(flatItems[1].groupKey).toBe('MATERIAL');
        expect(flatItems[2].groupKey).toBe('MAO_DE_OBRA');
        expect(flatItems[0].item.code).toBe('I001');
    });

    it('returns empty for composition without groups', () => {
        const { flatItems, hasGroups } = flattenCompositionGroups({});
        expect(hasGroups).toBe(false);
        expect(flatItems).toHaveLength(0);
    });

    it('handles groups with non-array values gracefully', () => {
        const composition = {
            groups: {
                MATERIAL: 'not-an-array',
                MAO_DE_OBRA: [{ item: { code: 'I001' }, coefficient: 1 }],
            },
        };
        const { flatItems, hasGroups } = flattenCompositionGroups(composition);
        expect(hasGroups).toBe(true);
        expect(flatItems).toHaveLength(1);
    });
});

describe('buildCompositionMetadata', () => {
    it('builds metadata with all fields', () => {
        const composition = {
            groupNotes: { MATERIAL: 'nota' },
            customGroupLabels: { MAO_DE_OBRA: 'Mão de Obra Qualificada' },
            groupOrder: ['MATERIAL', 'MAO_DE_OBRA'],
            referenceDivisor: { value: 2, label: 'Por metro' },
            _officialRef: { databaseName: 'SINAPI' },
            observation: 'Obs teste',
            rateio: { prazo: 3, fracao: 100 },
        };

        const meta = buildCompositionMetadata(composition);
        expect(meta.groupNotes).toEqual({ MATERIAL: 'nota' });
        expect(meta.referenceDivisor).toEqual({ value: 2, label: 'Por metro' });
        expect(meta.observation).toBe('Obs teste');
    });

    it('returns nulls for empty composition', () => {
        const meta = buildCompositionMetadata({});
        expect(meta.groupNotes).toBeNull();
        expect(meta.customGroupLabels).toBeNull();
        expect(meta.groupOrder).toBeNull();
        expect(meta.referenceDivisor).toBeNull();
        expect(meta._officialRef).toBeNull();
        expect(meta.observation).toBeNull();
        expect(meta.rateio).toBeNull();
    });
});

describe('correctCoefficientScaling', () => {
    it('corrects 100x scaling anomaly', () => {
        const item = {
            coefficient: 100,
            price: 50,
            item: { code: 'I001', price: 50 },
        } as any;
        const warnings: SaveWarning[] = [];
        const { coefficient, corrected } = correctCoefficientScaling(item, warnings);
        expect(corrected).toBe(true);
        expect(coefficient).toBe(1);
        expect(warnings).toHaveLength(1);
        expect(warnings[0].type).toBe('COEF_CORRECTED');
    });

    it('does not correct valid high coefficients', () => {
        const item = {
            coefficient: 15,
            price: 150,
            item: { code: 'I001', price: 10 },
        } as any;
        const warnings: SaveWarning[] = [];
        const { coefficient, corrected } = correctCoefficientScaling(item, warnings);
        expect(corrected).toBe(false);
        expect(coefficient).toBe(15);
        expect(warnings).toHaveLength(0);
    });

    it('handles zero coefficient', () => {
        const item = {
            coefficient: 0,
            price: 0,
            item: { code: 'I001', price: 10 },
        } as any;
        const warnings: SaveWarning[] = [];
        const { coefficient, corrected } = correctCoefficientScaling(item, warnings);
        expect(corrected).toBe(false);
        expect(coefficient).toBe(0);
    });
});

describe('generateItemCode', () => {
    it('uses existing item code', () => {
        const item = { item: { code: 'SINAPI-12345' } } as any;
        expect(generateItemCode(item)).toBe('SINAPI-12345');
    });

    it('generates unique code for LIVRE items', () => {
        const item = { item: { code: 'LIVRE' } } as any;
        const code = generateItemCode(item);
        expect(code).toMatch(/^LIVRE-/);
    });

    it('generates unique code for OBS items', () => {
        const item = { item: { code: 'OBS', type: 'OBSERVACAO' } } as any;
        const code = generateItemCode(item);
        expect(code).toMatch(/^OBS-/);
    });

    it('generates AI code when no item code exists', () => {
        const item = {} as any;
        const code = generateItemCode(item);
        expect(code).toMatch(/^AI-/);
    });
});
