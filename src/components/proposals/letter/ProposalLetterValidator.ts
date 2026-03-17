/**
 * ══════════════════════════════════════════════════════════════
 * ProposalLetterValidator
 * Valida campos obrigatórios e condições antes da geração da carta.
 * Também valida blocos gerados ANTES da exportação (pré-export).
 * Retorna erros impeditivos e warnings não impeditivos.
 * ══════════════════════════════════════════════════════════════
 */

import type { ProposalLetterData, ValidationResult, ValidationIssue, LetterBlock } from './types';

// Padrões proibidos — cláusulas que NÃO pertencem à carta proposta
const EXPORT_PROHIBITED_PATTERNS: RegExp[] = [
    /a\s+fatura\s+dever[áa]\s+ser\s+apresentada/i,
    /os\s+pagamentos\s+ser[ãa]o\s+efetuados/i,
    /n[ãa]o\s+ser[áa]\s+reajustado/i,
    /propostas\s+com\s+valores\s+inferiores\s+a\s+\d{1,3}\s*%/i,
    /[ée]\s+exigida\s+declara[çc][ãa]o\s+do\s+respons[áa]vel\s+t[ée]cnico/i,
    /garantia\s+de\s+proposta/i,
    /inexequ[ií]bilidade/i,
    /firma\s+reconhecida/i,
    /san[çc][õo]es|penalidades/i,
    /pagamento\s+ser[áa]\s+(realizado|efetuado|feito)/i,
    /reajuste\s+de\s+pre[çc]os/i,
];

export class ProposalLetterValidator {

    /**
     * Valida os dados normalizados e retorna resultado com erros e warnings.
     * Se `isValid === false`, a carta NÃO deve ser gerada.
     */
    validate(data: Partial<ProposalLetterData>): ValidationResult {
        const errors: ValidationIssue[] = [];
        const warnings: ValidationIssue[] = [];

        // ════════════════════════════════════════
        // ERROS IMPEDITIVOS — bloqueiam a geração
        // ════════════════════════════════════════

        // ── Empresa ──
        if (!data.company?.razaoSocial?.trim()) {
            errors.push(this.error('qualificationBlock', 'company.razaoSocial',
                'Razão Social da empresa é obrigatória.'));
        }
        if (!data.company?.cnpj?.trim()) {
            errors.push(this.error('qualificationBlock', 'company.cnpj',
                'CNPJ da empresa é obrigatório.'));
        } else if (!this.isValidCnpj(data.company.cnpj)) {
            errors.push(this.error('qualificationBlock', 'company.cnpj',
                'CNPJ informado está em formato inválido.',
                'Formato esperado: XX.XXX.XXX/XXXX-XX'));
        }
        if (!data.company?.qualification?.trim() && !data.company?.contactName?.trim()) {
            errors.push(this.error('qualificationBlock', 'company.qualification',
                'Qualificação da empresa ou nome do representante legal é obrigatório.',
                'Cadastre a qualificação completa no perfil da empresa.'));
        }

        // ── Referência do Processo ──
        if (!data.reference?.modalidade?.trim()) {
            errors.push(this.error('referenceBlock', 'reference.modalidade',
                'Modalidade da licitação não identificada.',
                'Verifique se o processo possui análise IA completa.'));
        }
        if (!data.reference?.numero?.trim() && !data.reference?.processo?.trim()) {
            errors.push(this.error('referenceBlock', 'reference.numero',
                'Número do edital ou do processo administrativo é obrigatório.',
                'Este dado vem da análise IA do edital.'));
        }

        // ── Preços ──
        if (!data.pricing?.totalValue || data.pricing.totalValue <= 0) {
            errors.push(this.error('pricingSummaryBlock', 'pricing.totalValue',
                'O valor total da proposta deve ser maior que zero.',
                'Adicione itens à planilha de preços na aba "Planilha de Preços".'));
        }
        if (!data.pricing?.itemCount || data.pricing.itemCount === 0) {
            errors.push(this.error('pricingSummaryBlock', 'pricing.itemCount',
                'A proposta não possui nenhum item.',
                'Use "Orçamento IA" ou adicione itens manualmente.'));
        }

        // ════════════════════════════════════════
        // WARNINGS — não impeditivos, mas alertam
        // ════════════════════════════════════════

        // ── Objeto ──
        if (!data.object?.fullDescription?.trim()) {
            warnings.push(this.warning('objectBlock', 'object.fullDescription',
                'Descrição completa do objeto não disponível.',
                'A IA tentará extrair do resumo do edital. Recomenda-se revisar o texto gerado.'));
        }

        // ── Representante ──
        if (!data.company?.contactCpf?.trim()) {
            warnings.push(this.warning('signatureBlock', 'company.contactCpf',
                'CPF do representante legal não cadastrado.',
                'O bloco de assinatura ficará sem CPF. Cadastre no perfil da empresa.'));
        }
        if (!data.company?.contactName?.trim()) {
            warnings.push(this.warning('signatureBlock', 'company.contactName',
                'Nome do representante legal não cadastrado.',
                'O bloco de assinatura usará "Representante Legal" como nome genérico.'));
        }

        // ── Local ──
        if (!data.company?.city?.trim()) {
            warnings.push(this.warning('closingBlock', 'company.city',
                'Cidade da empresa não cadastrada.',
                'O sistema tentará derivar da qualificação. Se não encontrar, o local ficará em branco.'));
        }

        // ── Financeiro ──
        if (data.pricing?.estimatedValue && data.pricing?.totalValue &&
            data.pricing.totalValue > data.pricing.estimatedValue) {
            const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            warnings.push(this.warning('pricingSummaryBlock', 'pricing.totalValue',
                `Valor proposto (${fmt(data.pricing.totalValue)}) está ACIMA do estimado (${fmt(data.pricing.estimatedValue)}).`,
                'Isso pode resultar em desclassificação se o edital estabelecer preço máximo.'));
        }

        // ── Valor por extenso ──
        if (!data.pricing?.totalValueExtended?.trim() && data.pricing?.totalValue && data.pricing.totalValue > 0) {
            warnings.push(this.warning('pricingSummaryBlock', 'pricing.totalValueExtended',
                'Valor por extenso será gerado automaticamente.',
                'Revise se o extenso confere com o valor numérico.'));
        }

        // ── Validade ──
        if (data.commercial?.validityDays && data.commercial.validityDays < 60) {
            warnings.push(this.warning('validityBlock', 'commercial.validityDays',
                `Validade de ${data.commercial.validityDays} dias é inferior ao mínimo usual de 60 dias.`,
                'Verifique se o edital permite esse prazo menor.'));
        }
        if (data.commercial?.validityDays && data.commercial.validityDays > 365) {
            warnings.push(this.warning('validityBlock', 'commercial.validityDays',
                `Validade de ${data.commercial.validityDays} dias é incomum (mais de 1 ano).`));
        }

        // ── Dados bancários ──
        if (!data.banking?.bank) {
            warnings.push(this.warning('bankingBlock', 'banking.bank',
                'Dados bancários não informados.',
                'Campos em branco serão incluídos na carta para preenchimento manual.'));
        }

        // ── Destinatário ──
        if (!data.recipient?.orgao?.trim()) {
            warnings.push(this.warning('recipientBlock', 'recipient.orgao',
                'Nome do órgão licitante não identificado.',
                'A carta será endereçada apenas ao "Agente de Contratação".'));
        }

        // ── Assinatura técnica ──
        if ((data.signature?.mode === 'TECH' || data.signature?.mode === 'BOTH') &&
            !data.company?.technicalResponsible?.trim()) {
            warnings.push(this.warning('signatureBlock', 'company.technicalResponsible',
                'Modo de assinatura inclui Responsável Técnico, mas não há RT cadastrado.',
                'Cadastre o Responsável Técnico no perfil da empresa.'));
        }

        // ── Prazo de execução/fornecimento (campo essencial) ──
        if (!data.execution?.executionDeadline?.trim()) {
            warnings.push(this.warning('proposalConditionsBlock', 'execution.executionDeadline',
                'Prazo de execução/fornecimento não identificado no edital.',
                'Preencha manualmente no bloco "Condições da Proposta" antes de exportar.'));
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
        };
    }

    /**
     * ═══ PRÉ-EXPORTAÇÃO ═══
     * Valida os blocos GERADOS antes da exportação final.
     * Verifica: truncamento, marcadores de revisão, cláusulas proibidas.
     * Se retornar isValid === false, a exportação deve ser BLOQUEADA.
     */
    validateForExport(blocks: LetterBlock[]): ValidationResult {
        const errors: ValidationIssue[] = [];
        const warnings: ValidationIssue[] = [];

        for (const block of blocks) {
            if (!block.visible || !block.content?.trim()) continue;
            const content = block.content;

            // ── Detectar marcadores de truncamento / revisão ──
            if (/\[texto incompleto/.test(content) || /\[dado incompleto/.test(content)) {
                errors.push(this.error(block.id, 'content',
                    `O bloco "${block.label}" contém texto incompleto que precisa ser revisado.`,
                    'Edite o bloco para completar a informação ou remova o trecho truncado.'));
            }

            // ── Detectar marcadores de verificação ──
            if (/\[verificar/.test(content)) {
                warnings.push(this.warning(block.id, 'content',
                    `O bloco "${block.label}" contém marcador de verificação.`,
                    'Revise o conteúdo e remova o marcador antes de protocolar.'));
            }

            // ── Detectar cláusulas proibidas que passaram ──
            for (const pattern of EXPORT_PROHIBITED_PATTERNS) {
                if (pattern.test(content)) {
                    warnings.push(this.warning(block.id, 'content',
                        `O bloco "${block.label}" pode conter cláusula contratual/habilitatória que não deve constar na carta proposta.`,
                        'Verifique se este trecho é pertinente à proposta ou se é uma cláusula do contrato.'));
                    break; // 1 warning per block is enough
                }
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
        };
    }

    // ── Helpers ──

    private error(blockId: string, field: string, message: string, suggestion?: string): ValidationIssue {
        return { blockId, field, message, severity: 'error', suggestion };
    }

    private warning(blockId: string, field: string, message: string, suggestion?: string): ValidationIssue {
        return { blockId, field, message, severity: 'warning', suggestion };
    }

    private isValidCnpj(cnpj: string): boolean {
        const clean = cnpj.replace(/[^\d]/g, '');
        return clean.length === 14;
    }
}
