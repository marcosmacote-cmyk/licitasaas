"use strict";
/**
 * ══════════════════════════════════════════════════════════════════
 *  Declaration Module — Barrel Export
 * ══════════════════════════════════════════════════════════════════
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGeminiRepairFn = exports.repairDeclaration = exports.validateAndFixTitle = exports.summarizeReport = exports.computeCorrections = exports.hasCriticalIssues = exports.calculateQualityReport = exports.validateDeclaration = exports.parseAndSanitize = exports.TITLE_TRAILING_PREPOSITIONS = exports.TITLE_FALLBACK_MAP = exports.ANTI_GENERIC_PHRASES = exports.DECLARATION_SEMANTIC_MAP = exports.FAMILY_LENGTH_CONSTRAINTS = exports.SEVERITY_PENALTIES = exports.VALIDATION_CODES = exports.DECLARATION_PROMPT_VERSION = exports.DECLARATION_MODULE_NAME = void 0;
var declarationTypes_1 = require("./declarationTypes");
Object.defineProperty(exports, "DECLARATION_MODULE_NAME", { enumerable: true, get: function () { return declarationTypes_1.DECLARATION_MODULE_NAME; } });
Object.defineProperty(exports, "DECLARATION_PROMPT_VERSION", { enumerable: true, get: function () { return declarationTypes_1.DECLARATION_PROMPT_VERSION; } });
Object.defineProperty(exports, "VALIDATION_CODES", { enumerable: true, get: function () { return declarationTypes_1.VALIDATION_CODES; } });
Object.defineProperty(exports, "SEVERITY_PENALTIES", { enumerable: true, get: function () { return declarationTypes_1.SEVERITY_PENALTIES; } });
Object.defineProperty(exports, "FAMILY_LENGTH_CONSTRAINTS", { enumerable: true, get: function () { return declarationTypes_1.FAMILY_LENGTH_CONSTRAINTS; } });
Object.defineProperty(exports, "DECLARATION_SEMANTIC_MAP", { enumerable: true, get: function () { return declarationTypes_1.DECLARATION_SEMANTIC_MAP; } });
Object.defineProperty(exports, "ANTI_GENERIC_PHRASES", { enumerable: true, get: function () { return declarationTypes_1.ANTI_GENERIC_PHRASES; } });
Object.defineProperty(exports, "TITLE_FALLBACK_MAP", { enumerable: true, get: function () { return declarationTypes_1.TITLE_FALLBACK_MAP; } });
Object.defineProperty(exports, "TITLE_TRAILING_PREPOSITIONS", { enumerable: true, get: function () { return declarationTypes_1.TITLE_TRAILING_PREPOSITIONS; } });
// Parser
var declarationParser_1 = require("./declarationParser");
Object.defineProperty(exports, "parseAndSanitize", { enumerable: true, get: function () { return declarationParser_1.parseAndSanitize; } });
// Validator
var declarationValidator_1 = require("./declarationValidator");
Object.defineProperty(exports, "validateDeclaration", { enumerable: true, get: function () { return declarationValidator_1.validateDeclaration; } });
Object.defineProperty(exports, "calculateQualityReport", { enumerable: true, get: function () { return declarationValidator_1.calculateQualityReport; } });
Object.defineProperty(exports, "hasCriticalIssues", { enumerable: true, get: function () { return declarationValidator_1.hasCriticalIssues; } });
Object.defineProperty(exports, "computeCorrections", { enumerable: true, get: function () { return declarationValidator_1.computeCorrections; } });
Object.defineProperty(exports, "summarizeReport", { enumerable: true, get: function () { return declarationValidator_1.summarizeReport; } });
Object.defineProperty(exports, "validateAndFixTitle", { enumerable: true, get: function () { return declarationValidator_1.validateAndFixTitle; } });
// Repair
var declarationRepair_1 = require("./declarationRepair");
Object.defineProperty(exports, "repairDeclaration", { enumerable: true, get: function () { return declarationRepair_1.repairDeclaration; } });
Object.defineProperty(exports, "createGeminiRepairFn", { enumerable: true, get: function () { return declarationRepair_1.createGeminiRepairFn; } });
