/**
 * ══════════════════════════════════════════════════════════════
 * Carta Proposta Redigida — Types & Interfaces
 * Motor de composição documental licitatória (Lei 14.133/2021)
 * ══════════════════════════════════════════════════════════════
 */

// ── Block Types ──

export const LetterBlockType = {
    RECIPIENT:            'recipientBlock',
    REFERENCE:            'referenceBlock',
    QUALIFICATION:        'qualificationBlock',
    OBJECT:               'objectBlock',
    COMMERCIAL:           'commercialDeclarationBlock',
    PRICING_SUMMARY:      'pricingSummaryBlock',
    VALIDITY:             'validityBlock',
    PROPOSAL_CONDITIONS:  'proposalConditionsBlock',
    EXECUTION:            'executionBlock',
    BANKING:              'bankingBlock',
    CLOSING:              'closingBlock',
    SIGNATURE:            'signatureBlock',
} as const;

export type LetterBlockType = typeof LetterBlockType[keyof typeof LetterBlockType];

export interface LetterBlock {
    id: string;
    type: LetterBlockType;
    label: string;
    required: boolean;
    editable: boolean;
    aiGenerated: boolean;
    content: string;
    rawData?: Record<string, any>;
    order: number;
    visible: boolean;
    validationStatus: 'valid' | 'warning' | 'error' | 'pending';
    validationMessage?: string;
}

// ── Proposal Letter Data (DTO de entrada normalizado) ──

export interface ProposalLetterData {
    recipient: {
        title: string;
        orgao: string;
        customRecipient?: string;
    };

    reference: {
        modalidade: string;
        numero: string;
        processo: string;
        ano: string;
        portal: string;
        linkSistema?: string;
    };

    company: {
        razaoSocial: string;
        cnpj: string;
        qualification: string;
        contactName: string;
        contactCpf: string;
        technicalResponsible?: string;
        technicalRegistration?: string;
        address?: string;
        city: string;
        state: string;
        phone?: string;
        email?: string;
    };

    object: {
        fullDescription: string;
        shortDescription: string;
        scope?: string;
    };

    pricing: {
        totalValue: number;
        totalValueExtended: string;
        estimatedValue?: number;
        bdiPercentage: number;
        discountPercentage: number;
        items: ProposalItemSummary[];
        itemCount: number;
    };

    commercial: {
        validityDays: number;
        paymentConditions?: string;
        warrantyPercentage?: number;
        readjustmentClause?: string;
    };

    execution: {
        executionLocation?: string;
        executionDeadline?: string;
        contractDuration?: string;
    };

    banking: {
        bank?: string;
        agency?: string;
        account?: string;
        accountType?: string;
        pix?: string;
    };

    signature: {
        mode: 'LEGAL' | 'TECH' | 'BOTH';
        localDate: string;
        legalRepresentative: {
            name: string;
            cpf: string;
            role: string;
        };
        technicalRepresentative?: {
            name: string;
            registration: string;
            role: string;
        };
    };

    meta: {
        proposalId: string;
        proposalVersion: number;
        biddingProcessId: string;
        generatedAt: string;
        aiModel?: string;
    };
}

export interface ProposalItemSummary {
    itemNumber: string;
    description: string;
    unit: string;
    quantity: number;
    multiplier: number;
    unitPrice: number;
    totalPrice: number;
}

// ── Validation ──

export interface ValidationResult {
    isValid: boolean;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
}

export interface ValidationIssue {
    blockId: string;
    field: string;
    message: string;
    severity: 'error' | 'warning';
    suggestion?: string;
}

// ── Builder Output ──

export interface ProposalLetterResult {
    blocks: LetterBlock[];
    plainText: string;
    htmlContent: string;
    validation: ValidationResult;
    meta: {
        generatedAt: string;
        builderVersion: string;
        aiBlockIds: string[];
        dataHash: string;
    };
}

// ── AI Block Generation ──

export interface AiLetterBlocksRequest {
    biddingProcessId: string;
    requestedBlocks: ('objectBlock' | 'executionBlock' | 'commercialExtras')[];
}

export interface AiLetterBlocksResponse {
    blocks: Record<string, string>;
}

// ── Export Modes ──

export type LetterExportMode =
    | 'LETTER'              // Carta apenas
    | 'SPREADSHEET'         // Planilha apenas
    | 'FULL'                // Carta + Planilha
    | 'LETTER_WITH_SUMMARY' // Carta com resumo dos itens
    | 'LETTER_ANALYTICAL';  // Carta com detalhamento analítico

// ── Content Classification ──
// Classifica trechos extraídos do edital para filtrar o que pode entrar na carta

export const ContentClassification = {
    PROPOSAL_CORE:        'PROPOSAL_CORE',        // Deve constar na proposta
    PROPOSAL_OPTIONAL:    'PROPOSAL_OPTIONAL',    // Pode constar se relevante
    CONTRACTUAL_ONLY:     'CONTRACTUAL_ONLY',     // Cláusula contratual — NÃO entra na carta
    HABILITATION_ONLY:    'HABILITATION_ONLY',    // Exigência de habilitação — NÃO entra na carta
    JUDGMENT_RULE:        'JUDGMENT_RULE',         // Regra de julgamento — NÃO entra na carta
    TECHNICAL_ATTACHMENT: 'TECHNICAL_ATTACHMENT',  // Anexo técnico — NÃO entra na carta
} as const;

export type ContentClassification = typeof ContentClassification[keyof typeof ContentClassification];
