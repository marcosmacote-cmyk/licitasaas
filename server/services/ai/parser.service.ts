import { logger } from '../../lib/logger';
export interface ParseResult {
    data: any;
    repaired: boolean;
    strategy: 'direct' | 'depth_truncation' | 'lastBrace_truncation' | 'string_sanitize' | 'stack_repair';
}

export function robustJsonParse(rawText: string, label = 'AI'): any {
    const result = robustJsonParseDetailed(rawText, label);
    return result.data;
}

export function robustJsonParseDetailed(rawText: string, label = 'AI'): ParseResult {
    // Step 1: Clean markdown wrappers and control chars
    let cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const firstBrace = cleaned.indexOf('{');
    if (firstBrace === -1) throw new Error('JSON inválido retornado pela IA (no opening brace)');
    cleaned = cleaned.substring(firstBrace);
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');

    // Step 2: Try direct parse first (fastest path)
    try {
        return { data: JSON.parse(cleaned), repaired: false, strategy: 'direct' };
    } catch (directErr) {
        logger.info(`[${label}] Direct JSON.parse failed: ${(directErr as Error).message}. Attempting repair...`);
    }

    // Step 3: Depth-tracked truncation — find where the outermost {} closes
    let depth = 0, inString = false, escape = false;
    let lastValidClose = -1;
    for (let i = 0; i < cleaned.length; i++) {
        const c = cleaned[i];
        if (escape) { escape = false; continue; }
        if (c === '\\') { escape = true; continue; }
        if (c === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (c === '{' || c === '[') depth++;
        if (c === '}' || c === ']') { depth--; if (depth === 0) lastValidClose = i; }
    }

    if (depth === 0 && lastValidClose !== -1) {
        const truncated = cleaned.substring(0, lastValidClose + 1);
        try {
            const result = JSON.parse(truncated);
            logger.info(`[${label}] ✅ JSON parsed after depth-tracked truncation at position ${lastValidClose}`);
            return { data: result, repaired: true, strategy: 'depth_truncation' };
        } catch (truncErr) {
            logger.info(`[${label}] Depth-tracked truncation failed: ${(truncErr as Error).message}`);
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
                logger.info(`[${label}] ✅ JSON parsed after lastBrace truncation at position ${lastBrace}`);
                return { data: result, repaired: true, strategy: 'lastBrace_truncation' };
            } catch { /* continue */ }
        }
    } catch { /* continue */ }

    // Step 4.5: String sanitization — fix unescaped quotes inside JSON string values
    // This handles the common case where Gemini embeds raw edital text containing " into JSON strings
    // Strategy: scan char-by-char and escape quotes that appear inside string values
    logger.info(`[${label}] Attempting string sanitization repair...`);
    try {
        const sanitized = sanitizeJsonStrings(cleaned);
        try {
            const result = JSON.parse(sanitized);
            logger.info(`[${label}] ✅ JSON parsed after string sanitization`);
            return { data: result, repaired: true, strategy: 'string_sanitize' };
        } catch { /* continue to next strategy */ }
    } catch { /* continue */ }

    // Step 5: Stack-based bracket repair
    logger.info(`[${label}] Attempting stack-based bracket repair...`);
    let repaired = cleaned;
    repaired = repaired.replace(/,\s*$/, '');
    depth = 0; inString = false; escape = false;
    let stack: string[] = [];
    for (let i = 0; i < repaired.length; i++) {
        const c = repaired[i];
        if (escape) { escape = false; continue; }
        if (c === '\\') { escape = true; continue; }
        if (c === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (c === '{') stack.push('}');
        if (c === '[') stack.push(']');
        if (c === '}' || c === ']') stack.pop();
    }
    if (inString) repaired += '"';
    while (stack.length > 0) repaired += stack.pop();

    try {
        const result = JSON.parse(repaired);
        logger.info(`[${label}] ✅ JSON parsed after stack-based repair (added ${stack.length} closers)`);
        return { data: result, repaired: true, strategy: 'stack_repair' };
    } catch (finalErr) {
        logger.error(`[${label}] ❌ ALL JSON repair strategies failed. Raw length: ${rawText.length}, Error: ${(finalErr as Error).message}`);
        logger.error(`[${label}] First 200 chars: ${cleaned.substring(0, 200)}`);
        logger.error(`[${label}] Last 200 chars: ${cleaned.substring(cleaned.length - 200)}`);
        throw new Error(`Falha ao interpretar resposta da IA (JSON inválido após múltiplas tentativas de reparo)`);
    }
}

/**
 * Sanitizes unescaped quotes inside JSON string values.
 * 
 * Approach: We parse the JSON character-by-character, tracking whether we're
 * inside a string. When inside a string, we check if a quote character is
 * actually the end of the string (next non-whitespace is : , ] } ) or a
 * rogue unescaped quote (should be escaped).
 */
function sanitizeJsonStrings(json: string): string {
    const chars = [...json];
    const result: string[] = [];
    let i = 0;
    let inStr = false;
    
    while (i < chars.length) {
        const c = chars[i];
        
        if (!inStr) {
            result.push(c);
            if (c === '"') inStr = true;
            i++;
            continue;
        }
        
        // Inside a string
        if (c === '\\') {
            // Escaped character — push both
            result.push(c);
            if (i + 1 < chars.length) {
                result.push(chars[i + 1]);
                i += 2;
            } else {
                i++;
            }
            continue;
        }
        
        if (c === '"') {
            // Is this the real end of the string or an unescaped quote?
            // Look ahead: skip whitespace, then check the next char.
            // If it's : , } ] or end-of-string, it's a real string terminator.
            // Otherwise, it's an unescaped quote inside the value.
            let j = i + 1;
            while (j < chars.length && (chars[j] === ' ' || chars[j] === '\t' || chars[j] === '\n' || chars[j] === '\r')) j++;
            const nextChar = j < chars.length ? chars[j] : '';
            
            if (nextChar === ':' || nextChar === ',' || nextChar === '}' || nextChar === ']' || nextChar === '"' || nextChar === '') {
                // This is a real string terminator
                result.push(c);
                inStr = false;
            } else {
                // This is an unescaped quote inside a string — escape it
                result.push('\\', '"');
            }
            i++;
            continue;
        }
        
        // Regular character inside string
        result.push(c);
        i++;
    }
    
    return result.join('');
}
