import { describe, expect, it } from 'vitest';
import {
    buildBudgetRowCandidateBatches,
    extractBudgetRowCandidatesFromMarkdown,
    formatBudgetRowCandidatesForPrompt,
} from './budgetRowCandidateExtractor';

describe('budgetRowCandidateExtractor', () => {
    it('builds deterministic row candidates from OCR markdown tables', () => {
        const result = extractBudgetRowCandidatesFromMarkdown(`
══ Página 7 — PLANILHA ORCAMENTARIA ══

| ITEM | CODIGO | DESCRICAO | UNID | QTD | PRECO UNIT | TOTAL |
| --- | --- | --- | --- | --- | --- | --- |
| 1 |  | SERVICOS PRELIMINARES |  |  |  | 12.000,00 |
| 1.1 | SINAPI 97622 | LOCACAO DA OBRA - EXECUCAO DE GABARITO | M | 120,00 | 3,45 | 414,00 |
| 1.2 | C4495 | TAPUME COM TELHA METALICA | M2 | 80,00 | 85,32 | 6.825,60 |

══ Página 8 — MEMORIAL ══
O licitante devera comprovar experiencia tecnica.
Cronograma fisico 30 dias 60 dias 90 dias.
        `);

        expect(result.pageCount).toBe(2);
        expect(result.candidates).toHaveLength(3);
        expect(result.candidates.map(row => row.rowId)).toEqual([
            'ocr-p7-r4',
            'ocr-p7-r5',
            'ocr-p7-r6',
        ]);
        expect(result.candidates[0]).toMatchObject({
            itemNumberHint: '1',
            signals: { likelyHeader: true },
        });
        expect(result.candidates[1]).toMatchObject({
            itemNumberHint: '1.1',
            signals: {
                hasOfficialCode: true,
                hasUnit: true,
            },
        });
    });

    it('detects whitespace separated OCR rows without markdown pipes', () => {
        const result = extractBudgetRowCandidatesFromMarkdown(`
══ Página 12 ══
2.1    SINAPI    96523    ESCAVACAO MANUAL CAMPO ABERTO    M3    45,00    54,20    2.439,00
2.2    ADMINISTRACAO LOCAL
Memorial descritivo de execucao dos servicos.
        `);

        expect(result.candidates).toHaveLength(2);
        expect(result.candidates[0].rawCells.length).toBeGreaterThan(4);
        expect(result.candidates[0].signals.numericCellCount).toBeGreaterThanOrEqual(3);
        expect(result.candidates[1].signals.likelyHeader).toBe(true);
    });

    it('creates bounded batches and prompt rows with stable row ids', () => {
        const result = extractBudgetRowCandidatesFromMarkdown(`
══ Página 1 ══
1.1 SINAPI 97622 LOCACAO DA OBRA M 120,00 3,45 414,00
1.2 SINAPI 94990 TAPUME M2 80,00 85,32 6.825,60
1.3 SINAPI 96523 ESCAVACAO M3 45,00 54,20 2.439,00
        `);

        const batches = buildBudgetRowCandidateBatches(result.candidates, 2);
        expect(batches).toHaveLength(2);
        expect(batches[0]).toMatchObject({ index: 1, total: 2 });
        expect(batches[0].candidates).toHaveLength(2);

        const prompt = formatBudgetRowCandidatesForPrompt(batches[0].candidates);
        expect(prompt).toContain('[ocr-p1-r1 p.1 l.1 itemHint=1.1]');
        expect(prompt).toContain('LOCACAO DA OBRA');
    });
});
