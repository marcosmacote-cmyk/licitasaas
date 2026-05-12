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

    it('forces quarantine when OCR row coverage is too low', () => {
        const screening = screenEngineeringItems([
            {
                item: '1',
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
                item: '1.2',
                type: 'COMPOSICAO',
                sourceName: 'SINAPI',
                code: '94990',
                description: 'EXECUCAO DE TAPUME COM TELHA METALICA',
                unit: 'M2',
                quantity: 80,
                unitCost: 85.32,
            },
            {
                item: '1.3',
                type: 'COMPOSICAO',
                sourceName: 'SINAPI',
                code: '96523',
                description: 'ESCAVACAO MANUAL CAMPO ABERTO',
                unit: 'M3',
                quantity: 45,
                unitCost: 54.2,
            },
            {
                item: '1.4',
                type: 'COMPOSICAO',
                sourceName: 'SINAPI',
                code: '74164',
                description: 'CONCRETO NAO ESTRUTURAL',
                unit: 'M3',
                quantity: 12,
                unitCost: 398.5,
            },
        ]);
        const report = validateEngineeringExtraction(screening.acceptedItems, null, screening, {
            candidateCount: 20,
            consumedRowCount: 9,
            missingRowCount: 11,
            coveragePercent: 45,
            missingRowIds: ['ocr-p1-r10', 'ocr-p1-r11'],
        });

        expect(report.publishable).toBe(false);
        expect(report.rowCoverage?.coveragePercent).toBe(45);
        expect(report.issues.some(issue => issue.code === 'EV14' && issue.severity === 'error')).toBe(true);
    });
});
