/**
 * ══════════════════════════════════════════════════════════════════
 *  Module Output Schemas — Schemas de Saída por Módulo (v2.1)
 * ══════════════════════════════════════════════════════════════════
 *
 *  Refino: adicionados campos de auditoria, rationale, evidenceBasis,
 *  limitations, riskLevel e recommendedAction a todos os schemas.
 */

export interface ChatAnswerSchema {
    answer: string;
    editalBasis: string[];
    riskAlerts: string[];
    recommendedAction?: string;
    confidence: 'low' | 'medium' | 'high';
    sourceType: 'fact' | 'inference' | 'recommendation';
    limitations?: string[];
}

export interface PetitionSchema {
    thesis: string;
    thesisStrength: 'strong' | 'moderate' | 'weak';
    relevantFacts: string[];
    editalGrounds: string[];
    legalGrounds: string[];
    requestedMeasures: string[];
    limitations: string[];
    riskOfOverreach: 'low' | 'medium' | 'high';
    confidence: 'low' | 'medium' | 'high';
    evidenceBasis: Array<{ claim: string; evidence: string; strength: 'strong' | 'moderate' | 'weak' }>;
}

export interface OracleMatchSchema {
    requirementSummary: string;
    documentSummary: string;
    adherenceLevel: 'full' | 'partial' | 'none';
    matchedPoints: string[];
    gaps: Array<{ gap: string; quantitativeShortfall?: string; severity: 'low' | 'medium' | 'high' | 'critical' }>;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    riskJustification: string;
    recommendation: string;
    isOperational: boolean;
    isProfessional: boolean;
    falsePositiveFlag: boolean;
    falsePositiveReason?: string;
    quantitativeComparison?: { required: string; provided: string; deficit: string };
    rationale: string;
}

export interface DossierSchema {
    requiredDocuments: Array<{
        name: string;
        category: string;
        priority: 'critical' | 'high' | 'medium' | 'low';
        responsibleArea: string;
        status?: 'present' | 'expired' | 'missing' | 'uncertain';
        disqualificationRisk: boolean;
    }>;
    missingDocuments: string[];
    expiredDocuments: string[];
    criticalItems: string[];
    responsibleAreas: Record<string, string[]>;
    priorityActions: string[];
    disqualificationRisks: string[];
}

export interface DeclarationSchema {
    documentType: string;
    generatedText: string;
    requiredInputs: string[];
    warnings: string[];
    confidence: 'low' | 'medium' | 'high';
    legalBasis?: string;
}

export interface ProposalSchema {
    proposalRequirements: Array<{
        item: string;
        description: string;
        mandatory: boolean;
        classification: 'obrigatorio' | 'mediante_convocacao' | 'eventual';
        source: string;
        riskIfMissing?: string;
    }>;
    technicalAttachmentsNeeded: string[];
    commercialRisks: string[];
    disqualificationRisks: Array<{ risk: string; editalClause: string; preventiveAction: string }>;
    feasibilityCriteria: string[];
    mandatoryTemplate?: string;
    editalConflicts: string[];
    priorityChecklist: string[];
}

export type ModuleOutputSchema =
    | { module: 'chat'; output: ChatAnswerSchema }
    | { module: 'petition'; output: PetitionSchema }
    | { module: 'oracle'; output: OracleMatchSchema }
    | { module: 'dossier'; output: DossierSchema }
    | { module: 'declaration'; output: DeclarationSchema }
    | { module: 'proposal'; output: ProposalSchema };
