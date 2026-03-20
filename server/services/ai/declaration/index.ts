/**
 * ══════════════════════════════════════════════════════════════════
 *  Declaration Module — Barrel Export
 * ══════════════════════════════════════════════════════════════════
 */

// Types & Constants
export type {
    DeclarationFamily,
    DeclarationIssuerType,
    AuthoritativeFacts,
    DeclarationValidationIssue,
    DeclarationQualityReport,
    GenerateDeclarationRequest,
    GenerateDeclarationResponse,
    DeclarationOutputV3,
    ValidationCode,
} from './declarationTypes';

export {
    DECLARATION_MODULE_NAME,
    DECLARATION_PROMPT_VERSION,
    VALIDATION_CODES,
    SEVERITY_PENALTIES,
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
} from './declarationValidator';

// Repair
export {
    repairDeclaration,
    createGeminiRepairFn,
} from './declarationRepair';
export type { AiCallFn, RepairResult } from './declarationRepair';
