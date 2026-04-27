import { describe, expect, it } from 'vitest';
import { parseAndNormalizeEngineeringExtraction } from './resultNormalizer';

describe('parseAndNormalizeEngineeringExtraction', () => {
    it('wraps direct arrays and normalizes Portuguese fields', () => {
        const result = parseAndNormalizeEngineeringExtraction(JSON.stringify([
            {
                numero: '1.1',
                tipo: 'composição',
                banco: 'sinapi',
                codigo: 87640,
                descricao: 'EXECUCAO DE CONTRAPISO EM ARGAMASSA',
                unidade: 'm2',
                quantidade: '1.234,50',
                precoUnitario: 'R$ 48,26',
            },
        ]));

        expect(result.engineeringItems).toHaveLength(1);
        expect(result.engineeringItems[0]).toMatchObject({
            item: '1.1',
            type: 'COMPOSICAO',
            sourceName: 'SINAPI',
            code: '87640',
            unit: 'm2',
            quantity: 1234.5,
            unitCost: 48.26,
        });
        expect(result.repaired).toBe(true);
        expect(result.repairs).toContain('payload_array_wrapped');
    });

    it('accepts alternate array keys and zeros groupers', () => {
        const result = parseAndNormalizeEngineeringExtraction(`
            \`\`\`json
            {
              "itens": [
                {
                  "itemNumber": "2.0",
                  "tipo": "ETAPA",
                  "descricao": "INFRAESTRUTURA",
                  "quantidade": "99",
                  "precoUnitario": "123,45"
                }
              ]
            }
            \`\`\`
        `);

        expect(result.engineeringItems[0]).toMatchObject({
            item: '2.0',
            type: 'ETAPA',
            quantity: 0,
            unitCost: 0,
            unit: '',
        });
        expect(result.repairs).toContain('array_key:itens->engineeringItems');
    });

    it('salvages valid items from a malformed large JSON response', () => {
        const result = parseAndNormalizeEngineeringExtraction(`
            {
              "engineeringItems": [
                {"item":"1.1","description":"ATERRO COMPACTADO","unit":"m3","quantity":"10,00","unitCost":"25,50"},
                {"item":"1.2","description":"texto quebrado " sem escape","unit":"m2","quantity":1},
                {"item":"1.3","descricao":"FORMA PLANA","unidade":"m2","quantidade":"2.000,00","precoUnitario":"R$ 15,25"}
              ]
            }
        `);

        expect(result.engineeringItems).toHaveLength(2);
        expect(result.engineeringItems.map(item => item.item)).toEqual(['1.1', '1.3']);
        expect(result.engineeringItems[1]).toMatchObject({
            description: 'FORMA PLANA',
            quantity: 2000,
            unitCost: 15.25,
        });
        expect(result.repairs).toContain('salvaged_array:engineeringItems:2');
    });
});
