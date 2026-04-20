/**
 * ══════════════════════════════════════════════════════════
 *  ProposalLetterValidator — Tests
 *  Validações obrigatórias antes da geração e exportação
 *  da carta proposta licitatória.
 * ══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { ProposalLetterValidator } from '../../proposals/letter/ProposalLetterValidator';
import type { ProposalLetterData, LetterBlock } from '../../proposals/letter/types';

const validator = new ProposalLetterValidator();

// ── Helper: dados mínimos válidos ──

function makeValidData(): Partial<ProposalLetterData> {
    return {
        company: {
            razaoSocial: 'Empresa Teste LTDA',
            cnpj: '12.345.678/0001-99',
            qualification: 'Empresa inscrita no CNPJ...',
            contactName: 'João Silva',
            contactCpf: '123.456.789-00',
            city: 'Fortaleza',
            state: 'CE',
        },
        reference: {
            modalidade: 'Pregão Eletrônico',
            numero: '045/2025',
            processo: '2025.001',
            ano: '2025',
            portal: 'Compras.gov.br',
        },
        pricing: {
            totalValue: 50000,
            totalValueExtended: 'cinquenta mil reais',
            bdiPercentage: 25,
            discountPercentage: 0,
            items: [],
            itemCount: 10,
        },
        object: {
            fullDescription: 'Aquisição de materiais de escritório',
            shortDescription: 'Materiais',
        },
        commercial: {
            validityDays: 60,
        },
        recipient: {
            title: 'Pregoeiro',
            orgao: 'Secretaria de Educação',
        },
        execution: {
            executionDeadline: '30 dias',
        },
        banking: {
            bank: 'Banco do Brasil',
            agency: '1234',
            account: '56789-0',
        },
        signature: {
            mode: 'LEGAL',
            localDate: 'Fortaleza/CE, 20 de abril de 2025',
            legalRepresentative: { name: 'João Silva', cpf: '123.456.789-00', role: 'Sócio Administrador' },
        },
    };
}

// ── validate() — Erros Impeditivos ────────────────────────

describe('ProposalLetterValidator.validate', () => {
    it('should pass with valid data', () => {
        const result = validator.validate(makeValidData());
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('should error: razão social missing', () => {
        const data = makeValidData();
        data.company!.razaoSocial = '';
        const result = validator.validate(data);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'company.razaoSocial')).toBe(true);
    });

    it('should error: CNPJ missing', () => {
        const data = makeValidData();
        data.company!.cnpj = '';
        const result = validator.validate(data);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'company.cnpj')).toBe(true);
    });

    it('should error: CNPJ invalid format', () => {
        const data = makeValidData();
        data.company!.cnpj = '123456'; // too short
        const result = validator.validate(data);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('formato inválido'))).toBe(true);
    });

    it('should error: qualification AND contactName both missing', () => {
        const data = makeValidData();
        data.company!.qualification = '';
        data.company!.contactName = '';
        const result = validator.validate(data);
        expect(result.isValid).toBe(false);
    });

    it('should NOT error when qualification is empty but contactName exists', () => {
        const data = makeValidData();
        data.company!.qualification = '';
        data.company!.contactName = 'João';
        const result = validator.validate(data);
        expect(result.errors.some(e => e.field === 'company.qualification')).toBe(false);
    });

    it('should error: modalidade missing', () => {
        const data = makeValidData();
        data.reference!.modalidade = '';
        const result = validator.validate(data);
        expect(result.isValid).toBe(false);
    });

    it('should error: edital and processo both missing', () => {
        const data = makeValidData();
        data.reference!.numero = '';
        data.reference!.processo = '';
        const result = validator.validate(data);
        expect(result.isValid).toBe(false);
    });

    it('should NOT error when only processo exists', () => {
        const data = makeValidData();
        data.reference!.numero = '';
        data.reference!.processo = '2025.001';
        const result = validator.validate(data);
        expect(result.errors.some(e => e.field === 'reference.numero')).toBe(false);
    });

    it('should error: totalValue zero', () => {
        const data = makeValidData();
        data.pricing!.totalValue = 0;
        const result = validator.validate(data);
        expect(result.isValid).toBe(false);
    });

    it('should error: totalValue negative', () => {
        const data = makeValidData();
        data.pricing!.totalValue = -100;
        const result = validator.validate(data);
        expect(result.isValid).toBe(false);
    });

    it('should error: no items', () => {
        const data = makeValidData();
        data.pricing!.itemCount = 0;
        const result = validator.validate(data);
        expect(result.isValid).toBe(false);
    });
});

// ── validate() — Warnings ──────────────────────────────────

describe('ProposalLetterValidator.validate — Warnings', () => {
    it('should warn: object fullDescription missing', () => {
        const data = makeValidData();
        data.object!.fullDescription = '';
        const result = validator.validate(data);
        expect(result.warnings.some(w => w.field === 'object.fullDescription')).toBe(true);
    });

    it('should warn: CPF missing', () => {
        const data = makeValidData();
        data.company!.contactCpf = '';
        const result = validator.validate(data);
        expect(result.warnings.some(w => w.field === 'company.contactCpf')).toBe(true);
    });

    it('should warn: city missing', () => {
        const data = makeValidData();
        data.company!.city = '';
        const result = validator.validate(data);
        expect(result.warnings.some(w => w.field === 'company.city')).toBe(true);
    });

    it('should warn: value above estimated', () => {
        const data = makeValidData();
        data.pricing!.estimatedValue = 40000;
        data.pricing!.totalValue = 50000;
        const result = validator.validate(data);
        expect(result.warnings.some(w => w.field === 'pricing.totalValue')).toBe(true);
    });

    it('should NOT warn: value below estimated', () => {
        const data = makeValidData();
        data.pricing!.estimatedValue = 60000;
        data.pricing!.totalValue = 50000;
        const result = validator.validate(data);
        expect(result.warnings.some(w => w.field === 'pricing.totalValue' && w.message.includes('ACIMA'))).toBe(false);
    });

    it('should warn: validity < 60 days', () => {
        const data = makeValidData();
        data.commercial!.validityDays = 30;
        const result = validator.validate(data);
        expect(result.warnings.some(w => w.field === 'commercial.validityDays')).toBe(true);
    });

    it('should warn: validity > 365 days', () => {
        const data = makeValidData();
        data.commercial!.validityDays = 400;
        const result = validator.validate(data);
        expect(result.warnings.some(w => w.field === 'commercial.validityDays')).toBe(true);
    });

    it('should warn: banking data missing', () => {
        const data = makeValidData();
        data.banking = {};
        const result = validator.validate(data);
        expect(result.warnings.some(w => w.field === 'banking.bank')).toBe(true);
    });

    it('should warn: orgao missing', () => {
        const data = makeValidData();
        data.recipient!.orgao = '';
        const result = validator.validate(data);
        expect(result.warnings.some(w => w.field === 'recipient.orgao')).toBe(true);
    });

    it('should warn: TECH mode without technicalResponsible', () => {
        const data = makeValidData();
        data.signature!.mode = 'BOTH';
        data.company!.technicalResponsible = '';
        const result = validator.validate(data);
        expect(result.warnings.some(w => w.field === 'company.technicalResponsible')).toBe(true);
    });

    it('should warn: execution deadline missing', () => {
        const data = makeValidData();
        data.execution!.executionDeadline = '';
        const result = validator.validate(data);
        expect(result.warnings.some(w => w.field === 'execution.executionDeadline')).toBe(true);
    });
});

// ── validateForExport() ────────────────────────────────────

describe('ProposalLetterValidator.validateForExport', () => {
    function makeBlock(id: string, content: string, visible = true): LetterBlock {
        return {
            id, type: id as any, label: id, required: true,
            editable: true, aiGenerated: false, content,
            order: 0, visible, validationStatus: 'valid',
        };
    }

    it('should pass for clean blocks', () => {
        const blocks = [makeBlock('test', 'Conteúdo limpo e válido.')];
        const result = validator.validateForExport(blocks);
        expect(result.isValid).toBe(true);
    });

    it('should error: truncated text marker', () => {
        const blocks = [makeBlock('test', 'Texto [texto incompleto] deve ser revisado')];
        const result = validator.validateForExport(blocks);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should error: incomplete data marker', () => {
        const blocks = [makeBlock('test', 'Campo [dado incompleto] encontrado')];
        const result = validator.validateForExport(blocks);
        expect(result.isValid).toBe(false);
    });

    it('should warn: verification marker', () => {
        const blocks = [makeBlock('test', 'Prazo de [verificar no edital] dias')];
        const result = validator.validateForExport(blocks);
        expect(result.isValid).toBe(true); // não é impeditivo
        expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should warn: prohibited contractual clause detected', () => {
        const blocks = [makeBlock('test', 'Os pagamentos serão efetuados em 30 dias após medição')];
        const result = validator.validateForExport(blocks);
        expect(result.warnings.some(w => w.message.includes('cláusula contratual'))).toBe(true);
    });

    it('should warn: inexequibilidade clause', () => {
        const blocks = [makeBlock('test', 'Propostas com análise de inexequibilidade serão avaliadas')];
        const result = validator.validateForExport(blocks);
        expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should skip invisible blocks', () => {
        const blocks = [makeBlock('test', '[texto incompleto]', false)];
        const result = validator.validateForExport(blocks);
        expect(result.isValid).toBe(true);
    });

    it('should skip empty blocks', () => {
        const blocks = [makeBlock('test', '  ')];
        const result = validator.validateForExport(blocks);
        expect(result.isValid).toBe(true);
    });
});
