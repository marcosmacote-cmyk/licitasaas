import { describe, expect, it } from 'vitest';
import { screenEngineeringItems, validateEngineeringExtraction } from './extractionValidator';

describe('screenEngineeringItems', () => {
    it('keeps budget rows and rejects narrative/subtotal noise', () => {
        const screening = screenEngineeringItems([
            {
                item: '1.0',
                type: 'ETAPA',
                description: 'SERVICOS PRELIMINARES',
                quantity: 0,
                unitCost: 0,
            },
            {
                item: '1.1',
                type: 'COMPOSICAO',
                sourceName: 'SINAPI',
                code: '87640',
                description: 'EXECUCAO DE CONTRAPISO EM ARGAMASSA',
                unit: 'M2',
                quantity: 100,
                unitCost: 48.26,
            },
            {
                item: '9.1',
                type: 'COMPOSICAO',
                description: 'O licitante devera comprovar atestado de capacidade tecnica',
                quantity: 0,
                unitCost: 0,
            },
            {
                item: '99',
                type: 'COMPOSICAO',
                description: 'TOTAL GERAL',
                quantity: 0,
                unitCost: 0,
            },
        ]);

        expect(screening.acceptedItems.map(item => item.item)).toEqual(['1.0', '1.1']);
        expect(screening.rejectedItems.map(item => item.item)).toEqual(['9.1', '99']);
    });

    it('adds screening diagnostics to the validation report', () => {
        const items = [
            {
                item: '1.1',
                type: 'COMPOSICAO',
                sourceName: 'SINAPI',
                code: '87640',
                description: 'EXECUCAO DE CONTRAPISO EM ARGAMASSA',
                unit: 'M2',
                quantity: 100,
                unitCost: 48.26,
            },
            {
                item: '9.1',
                type: 'COMPOSICAO',
                description: 'O licitante devera apresentar declaracao',
                quantity: 0,
                unitCost: 0,
            },
        ];
        const screening = screenEngineeringItems(items);
        const report = validateEngineeringExtraction(screening.acceptedItems, null, screening);

        expect(report.rejectedItems).toHaveLength(1);
        expect(report.itemQuality?.some(item => item.classification === 'narrative_noise')).toBe(true);
        expect(report.issues.some(issue => issue.code === 'EV00')).toBe(true);
    });
});
