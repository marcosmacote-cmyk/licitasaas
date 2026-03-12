/**
 * ══════════════════════════════════════════════════════════════════
 *  Module Output Schemas — Schemas de Saída por Módulo
 * ══════════════════════════════════════════════════════════════════
 */

export interface ChatAnswerSchema {
    answer: string;
    editalBasis: string[];
    riskAlerts: string[];
    recommendedAction?: string;
    confidence: 'low' | 'medium' | 'high';
    sourceType: 'fact' | 'inference' | 'recommendation';
}

export interface PetitionSchema {
    thesis: string;
    relevantFacts: string[];
    editalGrounds: string[];
    legalGrounds: string[];
    requestedMeasures: string[];
    limitations: string[];
    confidence: 'low' | 'medium' | 'high';
}

export interface OracleMatchSchema {
    requirementSummary: string;
    documentSummary: string;
    adherenceLevel: 'full' | 'partial' | 'none';
    matchedPoints: string[];
    gaps: string[];
    riskLevel: 'low' | 'medium' | 'high';
    recommendation: string;
    isOperational: boolean;
    isProfessional: boolean;
}

export interface DossierSchema {
    requiredDocuments: Array<{ name: string; category: string; priority: string; responsibleArea: string }>;
    missingDocuments: string[];
    criticalItems: string[];
    responsibleAreas: Record<string, string[]>;
    priorityActions: string[];
}

export interface DeclarationSchema {
    documentType: string;
    generatedText: string;
    requiredInputs: string[];
    warnings: string[];
    confidence: 'low' | 'medium' | 'high';
}

export interface ProposalSchema {
    proposalRequirements: Array<{ item: string; description: string; mandatory: boolean }>;
    technicalAttachmentsNeeded: string[];
    commercialRisks: string[];
    disqualificationRisks: string[];
    priorityChecklist: string[];
}

export type ModuleOutputSchema =
    | { module: 'chat'; output: ChatAnswerSchema }
    | { module: 'petition'; output: PetitionSchema }
    | { module: 'oracle'; output: OracleMatchSchema }
    | { module: 'dossier'; output: DossierSchema }
    | { module: 'declaration'; output: DeclarationSchema }
    | { module: 'proposal'; output: ProposalSchema };
