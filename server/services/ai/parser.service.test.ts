import { describe, it, expect } from 'vitest';
import { robustJsonParse, robustJsonParseDetailed } from './parser.service';

describe('parser.service - robustJsonParse', () => {
    it('deve fazer o parse de um objeto JSON válido diretamente', () => {
        const json = '{"name": "test", "value": 123}';
        const result = robustJsonParse(json);
        expect(result).toEqual({ name: 'test', value: 123 });
    });

    it('deve fazer o parse de um array JSON válido diretamente', () => {
        const json = '[{"name": "test1"}, {"name": "test2"}]';
        const result = robustJsonParse(json);
        expect(result).toEqual([{ name: 'test1' }, { name: 'test2' }]);
    });

    it('deve limpar delimitadores markdown de blocos de código json', () => {
        const json = '```json\n[{"requirement_id": "REQ-1", "title": "Test"}]\n```';
        const result = robustJsonParse(json);
        expect(result).toEqual([{ requirement_id: 'REQ-1', title: 'Test' }]);
    });

    it('deve reparar e parsear um array JSON truncado', () => {
        // Truncated array JSON
        const json = '```json\n[{"requirement_id": "REQ-1", "title": "Test"';
        const result = robustJsonParseDetailed(json);
        expect(result.repaired).toBe(true);
        expect(result.data).toEqual([{ requirement_id: 'REQ-1', title: 'Test' }]);
    });
});
