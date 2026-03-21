/**
 * ══════════════════════════════════════════════════════════════════
 *  Declaration Module — Barrel Export
 * ══════════════════════════════════════════════════════════════════
 */

// Types & Constants
export type {
    DeclarationFamily,
    DeclarationStyle,
    DeclarationIssuerType,
    AuthoritativeFacts,
    DeclarationValidationIssue,
    DeclarationQualityReport,
    GenerateDeclarationRequest,
    GenerateDeclarationResponse,
    DeclarationOutputV3,
    ValidationCode,
    SemanticMapping,
} from './declarationTypes';

export {
    DECLARATION_MODULE_NAME,
    DECLARATION_PROMPT_VERSION,
    VALIDATION_CODES,
    SEVERITY_PENALTIES,
    FAMILY_LENGTH_CONSTRAINTS,
    DECLARATION_SEMANTIC_MAP,
    ANTI_GENERIC_PHRASES,
    TITLE_FALLBACK_MAP,
    TITLE_TRAILING_PREPOSITIONS,
} from './declarationTypes';

// Parser
export { parseAndSanitize } from './declarationParser';
export type { ParsedDeclaration } from './declarationParser';

// Validator
export {
    validateDeclaration,
    calculateQualityReport,
    hasCriticalIssues,
    computeCorrections,
    summarizeReport,
    validateAndFixTitle,
} from './declarationValidator';
export type { TitleValidationResult } from './declarationValidator';

// Repair
export {
    repairDeclaration,
    createGeminiRepairFn,
} from './declarationRepair';
export type { AiCallFn, RepairResult } from './declarationRepair';
