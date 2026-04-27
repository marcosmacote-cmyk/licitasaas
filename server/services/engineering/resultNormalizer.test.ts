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
});
