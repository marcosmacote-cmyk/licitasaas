import { describe, expect, it } from 'vitest';
import { classifyEngineeringAttachments } from './documentClassifier';

describe('classifyEngineeringAttachments', () => {
    it('prioritizes budget spreadsheets over edital/legal attachments', () => {
        const result = classifyEngineeringAttachments([
            {
                titulo: 'Edital Pregao 012 2026.pdf',
                url: 'https://pncp.gov.br/edital.pdf',
                purpose: 'edital',
                ativo: true,
            },
            {
                titulo: 'Ata de julgamento.pdf',
                url: 'https://pncp.gov.br/ata.pdf',
                purpose: 'anexo_geral',
                ativo: true,
            },
            {
                titulo: 'Planilha Orcamentaria SINAPI SEINFRA.pdf',
                url: 'https://pncp.gov.br/planilha.pdf',
                purpose: 'planilha_orcamentaria',
                ativo: true,
            },
        ]);

        expect(result.selected).toHaveLength(1);
        expect(result.selected[0].title).toContain('Planilha');
        expect(result.selected[0].score).toBeGreaterThan(result.rejected[0].score);
    });
});
