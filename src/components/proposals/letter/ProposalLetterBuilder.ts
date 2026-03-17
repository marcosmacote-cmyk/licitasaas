/**
 * ══════════════════════════════════════════════════════════════
 * ProposalLetterBuilder
 * Motor de composição da carta proposta orientado a blocos.
 * Cada bloco tem regras fixas de montagem — a IA NÃO decide estrutura.
 * ══════════════════════════════════════════════════════════════
 */

import { numberToWords, currencyToWords } from './utils/numberToWords';
import type {
    ProposalLetterData, LetterBlock, ProposalLetterResult,
} from './types';
import { LetterBlockType } from './types';
import { TextSanitizer } from './TextSanitizer';

const BUILDER_VERSION = '3.0.0';

// ── Lista negra: padrões textuais que NÃO pertencem à carta proposta ──
// Cláusulas contratuais, habilitatórias e de julgamento que a IA pode
// erroneamente incluir nos blocos.
const PROHIBITED_PATTERNS: RegExp[] = [
    /a\s+fatura\s+dever[áa]\s+ser\s+apresentada/i,
    /os\s+pagamentos\s+ser[ãa]o\s+efetuados/i,
    /n[ãa]o\s+ser[áa]\s+reajustado/i,
    /propostas\s+com\s+valores\s+inferiores\s+a\s+\d{1,3}\s*%/i,
    /[ée]\s+exigida\s+declara[çc][ãa]o\s+do\s+respons[áa]vel\s+t[ée]cnico/i,
    /garantia\s+de\s+proposta/i,
    /garantia\s+contratual/i,
    /inexequ[ií]bilidade/i,
    /firma\s+reconhecida/i,
    /medi[çc][ãa]o|san[çc][õo]es|penalidades|habilita[çc][ãa]o/i,
    /pagamento\s+ser[áa]\s+(realizado|efetuado|feito)/i,
    /reajuste\s+de\s+pre[çc]os/i,
    /garantia\s+de\s+execu[çc][ãa]o/i,
];

export class ProposalLetterBuilder {
    private data: ProposalLetterData;
    private overrides: Map<string, string> = new Map();
    private aiBlocks: Map<string, string> = new Map();

    constructor(data: ProposalLetterData) {
        this.data = data;
    }

    /**
     * Sobrescreve o conteúdo de um bloco (edição manual do usuário).
     * Tem precedência sobre conteúdo gerado automaticamente e IA.
     */
    setOverride(blockId: string, content: string): this {
        this.overrides.set(blockId, content);
        return this;
    }

    /**
     * Define conteúdo gerado por IA para blocos específicos.
     * Usado pelo endpoint /ai-letter-blocks.
     */
    setAiContent(blockId: string, content: string): this {
        this.aiBlocks.set(blockId, content);
        return this;
    }

    /**
     * Monta todos os blocos e retorna o resultado completo.
     */
    build(): ProposalLetterResult {
        const allBlocks: LetterBlock[] = [
            this.buildRecipientBlock(),
            this.buildReferenceBlock(),
            this.buildQualificationBlock(),
            this.buildObjectBlock(),
            this.buildCommercialDeclarationBlock(),
            this.buildPricingSummaryBlock(),
            this.buildValidityBlock(),
            this.buildProposalConditionsBlock(),
            this.buildExecutionBlock(),
            this.buildBankingBlock(),
            this.buildClosingBlock(),
            this.buildSignatureBlock(),
        ];

        // Assign order and filter visible
        allBlocks.forEach((b, i) => { b.order = i; });

        // ── Sanitização final obrigatória ──
        const sanitizer = new TextSanitizer();
        const sanitizedBlocks = sanitizer.sanitizeAll(allBlocks);

        const visibleBlocks = sanitizedBlocks.filter(b => b.visible);

        const plainText = visibleBlocks
            .map(b => b.content)
            .join('\n\n');

        return {
            blocks: sanitizedBlocks,
            plainText,
            htmlContent: '',
            validation: { isValid: true, errors: [], warnings: [] },
            meta: {
                generatedAt: new Date().toISOString(),
                builderVersion: BUILDER_VERSION,
                aiBlockIds: sanitizedBlocks.filter(b => b.aiGenerated).map(b => b.id),
                dataHash: this.computeHash(),
            },
        };
    }

    // ════════════════════════════════════════
    // BLOCOS INDIVIDUAIS
    // ════════════════════════════════════════

    private buildRecipientBlock(): LetterBlock {
        const r = this.data.recipient;
        const title = r.title || 'Agente de Contratação / Pregoeiro(a)';

        // Inclui o órgão na saudação: "Ao Ilmo(a). Sr(a). Pregoeiro(a) da Prefeitura..."
        let line = `Ao Ilmo(a). Sr(a). ${title}`;
        if (r.orgao) {
            // Preposição adequada: "do", "da", "do(a)"
            const prep = this.derivePreposition(r.orgao);
            line += ` ${prep} ${r.orgao}`;
        }

        return this.createBlock(LetterBlockType.RECIPIENT, 'Destinatário',
            this.resolve(LetterBlockType.RECIPIENT, line),
            { required: true, editable: true });
    }

    private buildReferenceBlock(): LetterBlock {
        const ref = this.data.reference;
        const parts: string[] = [];

        if (ref.modalidade) parts.push(ref.modalidade);
        if (ref.numero) {
            // Strip any existing 'nº', 'Nº', 'N°' prefix to avoid duplication
            const cleanNum = ref.numero.replace(/^n[º°]\s*/i, '').trim();
            // Detect if number already contains year (e.g. '08.003/2026-CE')
            const alreadyHasYear = /\/\d{4}/.test(cleanNum);
            const numStr = (!alreadyHasYear && ref.ano) ? `${cleanNum}/${ref.ano}` : cleanNum;
            parts.push(`nº ${numStr}`);
        }

        let content = 'Ref.: ' + parts.join(' ');

        if (ref.processo) {
            // Strip prefix from processo too
            const cleanProc = ref.processo.replace(/^n[º°]\s*/i, '').trim();
            content += ` — Processo Administrativo nº ${cleanProc}`;
        }

        return this.createBlock(LetterBlockType.REFERENCE, 'Referência do Processo',
            content, { required: true, editable: false });
    }

    private buildQualificationBlock(): LetterBlock {
        const c = this.data.company;

        // Prioridade: override > qualification cadastrada > composição automática
        const autoComposition = this.composeQualification(c);
        const content = this.resolve(LetterBlockType.QUALIFICATION,
            c.qualification?.trim() || autoComposition);

        return this.createBlock(LetterBlockType.QUALIFICATION, 'Qualificação da Empresa',
            content, { required: true, editable: true });
    }

    private buildObjectBlock(): LetterBlock {
        // Prioridade: override > AI > dados do edital > placeholder
        const aiContent = this.aiBlocks.get(LetterBlockType.OBJECT);
        const editalContent = this.data.object.fullDescription?.trim();

        let content: string;
        let isAi = false;

        if (this.overrides.has(LetterBlockType.OBJECT)) {
            content = this.overrides.get(LetterBlockType.OBJECT)!;
        } else if (aiContent) {
            content = `Vem, respeitosamente, perante Vossa Senhoria, apresentar proposta comercial para o seguinte objeto:\n\n${aiContent}`;
            isAi = true;
        } else if (editalContent) {
            content = `Vem, respeitosamente, perante Vossa Senhoria, apresentar proposta comercial para o seguinte objeto:\n\n${editalContent}`;
        } else {
            content = 'Vem, respeitosamente, perante Vossa Senhoria, apresentar proposta comercial para o objeto descrito no Edital em referência.';
        }

        return this.createBlock(LetterBlockType.OBJECT, 'Objeto',
            content, { required: true, editable: true, aiGenerated: isAi });
    }

    private buildCommercialDeclarationBlock(): LetterBlock {
        // ═══ APENAS declarações essenciais fixas ═══
        // Condições de pagamento, reajuste, garantia contratual etc.
        // NÃO pertencem à carta proposta — são cláusulas contratuais.
        const declarations: string[] = [];

        // Declaração obrigatória — Inclusão de custos
        declarations.push(
            'Declaramos que nos preços propostos estão inclusos todos os custos diretos e indiretos, ' +
            'tributos, taxas, fretes, encargos sociais, trabalhistas e previdenciários, seguros, lucro ' +
            'e quaisquer outras despesas que incidam ou venham a incidir sobre o objeto desta licitação.'
        );

        // Declaração obrigatória — Ciência e concordância com o edital
        declarations.push(
            'Declaramos que tomamos conhecimento de todas as condições do Edital e seus anexos, ' +
            'concordando integralmente com os termos estabelecidos.'
        );

        // Declaração obrigatória — Trabalho de menores (Lei 14.133/2021)
        declarations.push(
            'Declaramos que não empregamos menores de 18 (dezoito) anos em trabalho noturno, perigoso ou insalubre, ' +
            'nem menores de 16 (dezesseis) anos em qualquer trabalho, salvo na condição de aprendiz, a partir de ' +
            '14 (quatorze) anos, conforme art. 68, inciso VI, da Lei nº 14.133/2021.'
        );

        const content = this.resolve(LetterBlockType.COMMERCIAL, declarations.join('\n\n'));

        return this.createBlock(LetterBlockType.COMMERCIAL, 'Declarações Essenciais',
            content, { required: true, editable: true });
    }

    /**
     * NOVO — Bloco "Condições da Proposta"
     * Contém apenas dados pertinentes à proposta:
     * - Prazo de execução/fornecimento
     * - Prazo para início
     * - Local de execução
     * - Observações objetivas ligadas à proposta
     */
    private buildProposalConditionsBlock(): LetterBlock {
        const e = this.data.execution;
        const isUseful = (v?: string) => v && !/^(não informado|n\/a|—|-|\.{3})$/i.test(v.trim());

        const lines: string[] = [];

        // Prazo de execução/fornecimento
        if (isUseful(e.executionDeadline)) {
            lines.push(`Prazo de execução/fornecimento: ${e.executionDeadline!.replace(/\s*\[.*\]\s*$/, '').trim()}.`);
        }

        // Local de execução
        if (isUseful(e.executionLocation)) {
            lines.push(`Local de execução: ${e.executionLocation!.replace(/\s*\[.*\]\s*$/, '').trim()}.`);
        }

        // Vigência (se disponível)
        if (isUseful(e.contractDuration)) {
            lines.push(`Vigência do contrato: ${e.contractDuration!.replace(/\s*\[.*\]\s*$/, '').trim()}.`);
        }

        // Condições específicas da IA (filtradas pela blacklist)
        const aiExtras = this.aiBlocks.get('commercialExtras');
        if (aiExtras?.trim()) {
            const filtered = this.filterProhibited(aiExtras.trim());
            if (filtered.trim()) {
                lines.push(filtered);
            }
        }

        const hasContent = lines.length > 0;
        const content = this.resolve(LetterBlockType.PROPOSAL_CONDITIONS,
            hasContent ? lines.join('\n\n') : '');

        return this.createBlock(LetterBlockType.PROPOSAL_CONDITIONS, 'Condições da Proposta',
            content, {
                required: false,
                editable: true,
                aiGenerated: !!aiExtras?.trim(),
                visible: hasContent || this.overrides.has(LetterBlockType.PROPOSAL_CONDITIONS),
            });
    }

    private buildPricingSummaryBlock(): LetterBlock {
        const p = this.data.pricing;
        const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

        const lines: string[] = [];

        // Valor Global por extenso
        const extenso = p.totalValueExtended || currencyToWords(p.totalValue);
        lines.push(`Valor Global: ${fmt(p.totalValue)} (${extenso}).`);

        // BDI — só mostra se > 0
        if (p.bdiPercentage > 0) {
            lines.push(`BDI aplicado: ${p.bdiPercentage.toFixed(2)}%.`);
        }

        // Desconto — só mostra se > 0
        if (p.discountPercentage > 0) {
            lines.push(`Desconto linear aplicado: ${p.discountPercentage.toFixed(2)}%.`);
        }

        // Referência à planilha com pluralização correta
        const itemLabel = p.itemCount === 1 ? '1 item' : `${p.itemCount} itens`;
        lines.push(`Conforme Planilha de Formação de Preços em anexo, contendo ${itemLabel}.`);

        return this.createBlock(LetterBlockType.PRICING_SUMMARY, 'Resumo de Preços',
            lines.join('\n'), { required: true, editable: false });
    }

    private buildValidityBlock(): LetterBlock {
        const days = this.data.commercial.validityDays || 60;
        const extensoDias = numberToWords(days);

        const content = this.resolve(LetterBlockType.VALIDITY,
            `A presente proposta tem prazo de validade de ${days} (${extensoDias}) dias corridos, ` +
            `contados da data de sua apresentação.`
        );

        return this.createBlock(LetterBlockType.VALIDITY, 'Validade da Proposta',
            content, { required: true, editable: true });
    }

    private buildExecutionBlock(): LetterBlock {
        const e = this.data.execution;
        const isUseful = (v?: string) => v && !/^(não informado|n\/a|—|-|\.{3})$/i.test(v.trim());
        const aiContent = this.aiBlocks.get(LetterBlockType.EXECUTION);

        // Se IA gerou conteúdo para o bloco, filtrar pela blacklist
        let filteredAiContent = '';
        if (aiContent?.trim()) {
            filteredAiContent = this.filterProhibited(aiContent.trim());
        }

        // Se já há ProposalConditions com dados de execução, este bloco fica oculto
        // para evitar duplicação
        const proposalConditionsHasData = isUseful(e.executionDeadline) || isUseful(e.executionLocation) || isUseful(e.contractDuration);
        if (proposalConditionsHasData && !filteredAiContent && !this.overrides.has(LetterBlockType.EXECUTION)) {
            return this.createBlock(LetterBlockType.EXECUTION, 'Condições de Execução (Complementar)',
                '', { required: false, visible: false });
        }

        // Conteúdo AI filtrado é o único que aparece aqui (dados diretos vão para ProposalConditions)
        if (!filteredAiContent && !this.overrides.has(LetterBlockType.EXECUTION)) {
            return this.createBlock(LetterBlockType.EXECUTION, 'Condições de Execução (Complementar)',
                '', { required: false, visible: false });
        }

        const content = this.overrides.get(LetterBlockType.EXECUTION) || filteredAiContent;

        return this.createBlock(LetterBlockType.EXECUTION, 'Condições de Execução (Complementar)',
            content, { required: false, editable: true, aiGenerated: !!filteredAiContent });
    }

    private buildBankingBlock(): LetterBlock {
        const b = this.data.banking;
        const hasRealData = b.bank || b.agency || b.account || b.pix;

        // Sem dados bancários → ocultar bloco (opt-in)
        if (!hasRealData && !this.overrides.has(LetterBlockType.BANKING)) {
            return this.createBlock(LetterBlockType.BANKING, 'Dados Bancários',
                '', { required: false, visible: false, editable: true });
        }

        const lines = ['Dados bancários para pagamento:'];
        if (b.bank) lines.push(`Banco: ${b.bank}`);
        if (b.agency) lines.push(`Agência: ${b.agency}`);
        if (b.account) lines.push(`${b.accountType || 'Conta Corrente'}: ${b.account}`);
        if (b.pix) lines.push(`PIX: ${b.pix}`);

        const content = this.resolve(LetterBlockType.BANKING, lines.join('\n'));

        return this.createBlock(LetterBlockType.BANKING, 'Dados Bancários',
            content, { required: false, editable: true });
    }

    private buildClosingBlock(): LetterBlock {
        const localDate = this.data.signature.localDate || this.deriveLocalDate();
        const content = `${localDate}\n\nAtenciosamente,`;

        return this.createBlock(LetterBlockType.CLOSING, 'Encerramento',
            content, { required: true, editable: false });
    }

    private buildSignatureBlock(): LetterBlock {
        const sig = this.data.signature;
        const company = this.data.company;
        const sections: string[] = [];

        if (sig.mode === 'LEGAL' || sig.mode === 'BOTH') {
            const legalLines = [
                '___________________________________',
                sig.legalRepresentative.name || company.contactName || 'Representante Legal',
            ];
            if (sig.legalRepresentative.cpf || company.contactCpf) {
                legalLines.push(`CPF: ${sig.legalRepresentative.cpf || company.contactCpf}`);
            }
            legalLines.push(sig.legalRepresentative.role || 'Representante Legal');
            legalLines.push(company.razaoSocial);
            legalLines.push(`CNPJ: ${company.cnpj}`);
            sections.push(legalLines.join('\n'));
        }

        if (sig.mode === 'TECH' || sig.mode === 'BOTH') {
            const techLines = [
                '___________________________________',
                sig.technicalRepresentative?.name || company.technicalResponsible || 'Responsável Técnico',
            ];
            if (sig.technicalRepresentative?.registration || company.technicalRegistration) {
                techLines.push(sig.technicalRepresentative?.registration || company.technicalRegistration!);
            }
            techLines.push(sig.technicalRepresentative?.role || 'Responsável Técnico');
            techLines.push(company.razaoSocial);
            techLines.push(`CNPJ: ${company.cnpj}`);
            sections.push(techLines.join('\n'));
        }

        return this.createBlock(LetterBlockType.SIGNATURE, 'Assinatura',
            sections.join('\n\n'), { required: true, editable: false });
    }

    // ════════════════════════════════════════
    // HELPERS
    // ════════════════════════════════════════

    /**
     * Resolve conteúdo: override > input
     */
    private resolve(blockType: LetterBlockType, defaultContent: string): string {
        return this.overrides.get(blockType) || defaultContent;
    }

    /**
     * Filtra texto da IA removendo parágrafos que contêm cláusulas proibidas.
     * Apenas PROPOSAL_CORE e PROPOSAL_OPTIONAL passam — cláusulas contratuais,
     * habilitatórias e de julgamento são descartadas.
     */
    private filterProhibited(text: string): string {
        const paragraphs = text.split(/\n\n+/);
        const allowed = paragraphs.filter(p => {
            const trimmed = p.trim();
            if (!trimmed) return false;
            // Verifica se algum padrão proibido está presente
            for (const pattern of PROHIBITED_PATTERNS) {
                if (pattern.test(trimmed)) {
                    return false; // Descarta este parágrafo
                }
            }
            return true;
        });
        return allowed.join('\n\n');
    }

    /**
     * Compõe qualificação automaticamente a partir dos campos da empresa.
     */
    private composeQualification(c: ProposalLetterData['company']): string {
        const parts: string[] = [];
        parts.push(c.razaoSocial || '[Razão Social]');
        parts.push(`inscrita no CNPJ sob o nº ${c.cnpj || '[CNPJ]'}`);

        if (c.address) {
            parts.push(`com sede em ${c.address}`);
        } else if (c.city && c.state) {
            parts.push(`com sede em ${c.city}/${c.state}`);
        }

        // Representante legal com conectivos naturais
        if (c.contactName) {
            let repText = `neste ato representada por ${c.contactName}`;
            if (c.contactCpf) {
                repText += `, portador(a) do CPF nº ${c.contactCpf}`;
            }
            parts.push(repText);
        }

        return parts.join(', ') + ',';
    }

    /**
     * Derive local/date from company data.
     */
    private deriveLocalDate(): string {
        const c = this.data.company;
        const now = new Date();
        const dateStr = new Intl.DateTimeFormat('pt-BR', {
            day: '2-digit', month: 'long', year: 'numeric'
        }).format(now);

        const locParts = [c.city, c.state].filter(Boolean);
        if (locParts.length > 0) {
            return `${locParts.join('/')}, ${dateStr}`;
        }
        return dateStr;
    }

    /**
     * Creates a LetterBlock with standard defaults.
     */
    private createBlock(
        type: LetterBlockType,
        label: string,
        content: string,
        opts: {
            required?: boolean;
            editable?: boolean;
            aiGenerated?: boolean;
            visible?: boolean;
        } = {}
    ): LetterBlock {
        const isRequired = opts.required ?? true;
        const isEmpty = !content.trim();

        return {
            id: type,
            type,
            label,
            required: isRequired,
            editable: opts.editable ?? false,
            aiGenerated: opts.aiGenerated ?? false,
            content,
            order: 0,
            visible: opts.visible ?? true,
            validationStatus: isEmpty
                ? (isRequired ? 'error' : 'pending')
                : 'valid',
            validationMessage: isEmpty && isRequired
                ? `O bloco "${label}" é obrigatório mas está vazio.`
                : undefined,
        };
    }

    /**
     * Compute a simple hash of key data for change detection.
     */
    private computeHash(): string {
        const str = JSON.stringify({
            c: this.data.company.cnpj,
            r: this.data.reference.numero,
            t: this.data.pricing.totalValue,
            n: this.data.pricing.itemCount,
            v: this.data.commercial.validityDays,
        });
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * Derive preposition for organ name (da, do, de).
     * Ex: "Prefeitura" → "da", "Município" → "do", "IFCE" → "do"
     */
    private derivePreposition(orgao: string): string {
        const normalized = orgao.trim().toLowerCase();
        // Femininos comuns
        const femininos = ['prefeitura', 'secretaria', 'câmara', 'assembleia', 'fundação', 'agência', 'autarquia', 'companhia', 'empresa', 'universidade'];
        for (const f of femininos) {
            if (normalized.startsWith(f)) return 'da';
        }
        // Masculinos comuns
        const masculinos = ['município', 'estado', 'governo', 'tribunal', 'ministério', 'instituto', 'conselho', 'departamento', 'serviço', 'centro'];
        for (const m of masculinos) {
            if (normalized.startsWith(m)) return 'do';
        }
        // Siglas (ex: IFCE, DNIT) → "do"
        if (/^[A-Z]{2,}/.test(orgao.trim())) return 'do';
        // Default
        return 'do(a)';
    }
}
