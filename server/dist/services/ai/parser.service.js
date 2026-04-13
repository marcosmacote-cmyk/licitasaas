"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.robustJsonParse = robustJsonParse;
exports.robustJsonParseDetailed = robustJsonParseDetailed;
const logger_1 = require("../../lib/logger");
function robustJsonParse(rawText, label = 'AI') {
    const result = robustJsonParseDetailed(rawText, label);
    return result.data;
}
function robustJsonParseDetailed(rawText, label = 'AI') {
    // Step 1: Clean markdown wrappers and control chars
    let cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const firstBrace = cleaned.indexOf('{');
    if (firstBrace === -1)
        throw new Error('JSON inválido retornado pela IA (no opening brace)');
    cleaned = cleaned.substring(firstBrace);
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');
    // Step 2: Try direct parse first (fastest path)
    try {
        return { data: JSON.parse(cleaned), repaired: false, strategy: 'direct' };
    }
    catch (directErr) {
        logger_1.logger.info(`[${label}] Direct JSON.parse failed: ${directErr.message}. Attempting repair...`);
    }
    // Step 3: Depth-tracked truncation — find where the outermost {} closes
    let depth = 0, inString = false, escape = false;
    let lastValidClose = -1;
    for (let i = 0; i < cleaned.length; i++) {
        const c = cleaned[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (c === '\\') {
            escape = true;
            continue;
        }
        if (c === '"') {
            inString = !inString;
            continue;
        }
        if (inString)
            continue;
        if (c === '{' || c === '[')
            depth++;
        if (c === '}' || c === ']') {
            depth--;
            if (depth === 0)
                lastValidClose = i;
        }
    }
    if (depth === 0 && lastValidClose !== -1) {
        const truncated = cleaned.substring(0, lastValidClose + 1);
        try {
            const result = JSON.parse(truncated);
            logger_1.logger.info(`[${label}] ✅ JSON parsed after depth-tracked truncation at position ${lastValidClose}`);
            return { data: result, repaired: true, strategy: 'depth_truncation' };
        }
        catch (truncErr) {
            logger_1.logger.info(`[${label}] Depth-tracked truncation failed: ${truncErr.message}`);
        }
    }
    // Step 4: Error-position-based truncation
    try {
        const lastBrace = cleaned.lastIndexOf('}');
        if (lastBrace > 0) {
            let attempt = cleaned.substring(0, lastBrace + 1);
            attempt = attempt.replace(/,\s*([}\]])/, '$1');
            try {
                const result = JSON.parse(attempt);
                logger_1.logger.info(`[${label}] ✅ JSON parsed after lastBrace truncation at position ${lastBrace}`);
                return { data: result, repaired: true, strategy: 'lastBrace_truncation' };
            }
            catch { /* continue */ }
        }
    }
    catch { /* continue */ }
    // Step 5: Stack-based bracket repair
    logger_1.logger.info(`[${label}] Attempting stack-based bracket repair...`);
    let repaired = cleaned;
    repaired = repaired.replace(/,\s*$/, '');
    depth = 0;
    inString = false;
    escape = false;
    let stack = [];
    for (let i = 0; i < repaired.length; i++) {
        const c = repaired[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (c === '\\') {
            escape = true;
            continue;
        }
        if (c === '"') {
            inString = !inString;
            continue;
        }
        if (inString)
            continue;
        if (c === '{')
            stack.push('}');
        if (c === '[')
            stack.push(']');
        if (c === '}' || c === ']')
            stack.pop();
    }
    if (inString)
        repaired += '"';
    while (stack.length > 0)
        repaired += stack.pop();
    try {
        const result = JSON.parse(repaired);
        logger_1.logger.info(`[${label}] ✅ JSON parsed after stack-based repair (added ${stack.length} closers)`);
        return { data: result, repaired: true, strategy: 'stack_repair' };
    }
    catch (finalErr) {
        logger_1.logger.error(`[${label}] ❌ ALL JSON repair strategies failed. Raw length: ${rawText.length}, Error: ${finalErr.message}`);
        logger_1.logger.error(`[${label}] First 200 chars: ${cleaned.substring(0, 200)}`);
        logger_1.logger.error(`[${label}] Last 200 chars: ${cleaned.substring(cleaned.length - 200)}`);
        throw new Error(`Falha ao interpretar resposta da IA (JSON inválido após múltiplas tentativas de reparo)`);
    }
}
