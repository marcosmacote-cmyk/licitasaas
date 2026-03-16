/**
 * ══════════════════════════════════════════════════════════════
 * Carta Proposta Redigida — Public API
 * ══════════════════════════════════════════════════════════════
 */

// Types
export type {
    LetterBlock,
    ProposalLetterData,
    ProposalItemSummary,
    ValidationResult,
    ValidationIssue,
    ProposalLetterResult,
    AiLetterBlocksRequest,
    AiLetterBlocksResponse,
    LetterExportMode,
} from './types';

export { LetterBlockType } from './types';

// Builder
export { ProposalLetterBuilder } from './ProposalLetterBuilder';

// Validator
export { ProposalLetterValidator } from './ProposalLetterValidator';

// Normalizer
export { LetterDataNormalizer } from './LetterDataNormalizer';

// Utils
export { numberToWords, currencyToWords } from './utils/numberToWords';
