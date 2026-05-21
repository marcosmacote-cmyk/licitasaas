/**
 * ══════════════════════════════════════════════════════════════════
 *  Engineering Code Normalizer — Normalização centralizada de códigos
 * ══════════════════════════════════════════════════════════════════
 *
 *  Single source of truth for cleaning and normalizing official
 *  engineering database codes (SINAPI, SEINFRA, ORSE, etc).
 *
 *  Used by: resultNormalizer, priceEnricher, composition lookup
 */

/**
 * Normalize an official engineering code for a given source base.
 * 
 * Rules:
 * - SINAPI: 5-6 digit numbers, strip leading zeros
 * - SEINFRA: C + digits or just digits, uppercase
 * - ORSE: digits or digits/ORSE, normalize padding
 * - SICRO: alphanumeric, uppercase
 * - Default: trim and uppercase
 */
export function normalizeCode(raw: string, source?: string): string {
    const code = String(raw || '').trim().replace(/\.$/, '').replace(/\s+/g, '');
    if (!code || code === 'N/A') return code;

    const src = String(source || '').toUpperCase();

    switch (src) {
        case 'SINAPI': {
            // Strip leading zeros, keep 4-7 digit format
            const stripped = code.replace(/^0+/, '');
            if (/^\d{4,7}$/.test(stripped)) return stripped;
            return code;
        }

        case 'SEINFRA': {
            const codeClean = code.toUpperCase();
            // If it starts with I or 1 followed by digits: insumo
            if (/^[I1]\d{3,6}$/.test(codeClean)) {
                return 'I' + codeClean.slice(1);
            }
            // If starts with C followed by digits: composition
            if (/^C\d{3,6}$/.test(codeClean)) {
                return codeClean;
            }
            // Digits only
            const digitsMatch = codeClean.match(/^(\d{3,6})$/);
            if (digitsMatch) {
                // Default to C + digits
                return `C${digitsMatch[1]}`;
            }
            return codeClean;
        }

        case 'ORSE': {
            // Strip I prefix if present (PDF formatting: I09783 means insumo 09783)
            let orseCode = code;
            if (/^I\d/i.test(orseCode) && !/\/ORSE$/i.test(orseCode)) orseCode = orseCode.slice(1);
            // Strip trailing letter suffix only when no /ORSE suffix (e.g., 04342S → 04342)
            if (!/\/ORSE$/i.test(orseCode)) orseCode = orseCode.replace(/[A-Z]$/i, '');
            const orseMatch = orseCode.match(/^0*(\d{1,6})(?:\/ORSE)?$/i);
            if (orseMatch) return `${orseMatch[1]}/ORSE`;
            return code.toUpperCase();
        }

        case 'SICRO':
        case 'SICRO3': {
            return code.toUpperCase();
        }

        default:
            return code;
    }
}

/**
 * Build all plausible code variants for fuzzy matching.
 * Used by composition lookup to find matches across different
 * databases that may store codes with different padding.
 */
export function buildCodeVariants(code: string, source?: string): string[] {
    const normalized = normalizeCode(code, source);
    const variants = new Set<string>([code.trim(), normalized]);

    // Add padded/unpadded variants for numeric codes
    const numericMatch = normalized.match(/^0*(\d{4,7})$/);
    if (numericMatch) {
        const stripped = numericMatch[1];
        variants.add(stripped);
        variants.add(stripped.padStart(5, '0'));
        variants.add(stripped.padStart(6, '0'));
        variants.add(stripped.padStart(7, '0'));
    }

    // ORSE-specific variants
    if (source?.toUpperCase() === 'ORSE' || /\/ORSE$/i.test(code)) {
        // Strip I prefix if present (PDF formatting: I09783 = insumo 09783 in ORSE)
        let orseClean = code;
        if (/^I\d/i.test(orseClean) && !/\/ORSE$/i.test(orseClean)) orseClean = orseClean.slice(1);
        // Strip trailing letter suffix only when no /ORSE suffix (e.g., 04342S → 04342)
        if (!/\/ORSE$/i.test(orseClean)) orseClean = orseClean.replace(/[A-Z]$/i, '');
        const orseMatch = orseClean.match(/^0*(\d{1,6})(?:\/ORSE)?$/i);
        if (orseMatch) {
            variants.add(`${orseMatch[1]}/ORSE`);
            variants.add(orseMatch[1]);
            variants.add(`${orseMatch[1].padStart(4, '0')}/ORSE`);
            variants.add(`${orseMatch[1].padStart(5, '0')}/ORSE`);
            variants.add(orseMatch[1].padStart(4, '0'));
            variants.add(orseMatch[1].padStart(5, '0'));
        }
    }

    // SEINFRA-specific variants — only generate when source is explicitly SEINFRA
    // or code clearly looks like a SEINFRA code (C/I prefix + 3-5 digits).
    // Guard: do NOT generate for SINAPI (5-6 digit numbers) or ORSE codes.
    const srcUpper = source?.toUpperCase() || '';
    const isExplicitlySeinfra = srcUpper === 'SEINFRA';
    const looksLikeSeinfra = /^C\d{3,5}$/i.test(code) || (/^I\d{3,5}$/i.test(code) && srcUpper !== 'ORSE');
    const isOtherKnownBase = ['SINAPI', 'ORSE', 'SICRO', 'SICRO3', 'SICOR', 'CAERN', 'SBC'].includes(srcUpper);
    if (isExplicitlySeinfra || (looksLikeSeinfra && !isOtherKnownBase)) {
        const clean = code.replace(/\s+/g, '').toUpperCase();
        let digits = clean;
        if (clean.startsWith('C') || clean.startsWith('I')) {
            digits = clean.slice(1);
        }
        if (/^\d{3,6}$/.test(digits)) {
            variants.add(`C${digits}`);
            variants.add(`I${digits}`);
            variants.add(digits);
            if (digits.startsWith('1')) {
                const rest = digits.slice(1);
                variants.add(`I${rest}`);
                variants.add(`C${rest}`);
                variants.add(rest);
            }
        }
    }

    return Array.from(variants).filter(Boolean);
}

/**
 * Validate that a code matches the expected format for a given source.
 * Returns null if valid, or an error message if invalid.
 */
export function validateCodeFormat(code: string, source: string): string | null {
    const trimmed = String(code || '').trim();
    if (!trimmed || trimmed === 'N/A') return null; // Empty codes are valid (will be flagged elsewhere)

    const src = source.toUpperCase();

    switch (src) {
        case 'SINAPI': {
            const stripped = trimmed.replace(/^0+/, '');
            if (!/^\d{4,7}$/.test(stripped)) {
                return `Código SINAPI inválido: "${trimmed}" — esperado 4-7 dígitos`;
            }
            return null;
        }

        case 'SEINFRA': {
            if (!/^C?\d{3,6}$/i.test(trimmed)) {
                return `Código SEINFRA inválido: "${trimmed}" — esperado C + 3-6 dígitos`;
            }
            return null;
        }

        case 'ORSE': {
            if (!/^\d{1,6}(\/ORSE)?$/i.test(trimmed)) {
                return `Código ORSE inválido: "${trimmed}" — esperado 1-6 dígitos (/ORSE opcional)`;
            }
            return null;
        }

        default:
            return null; // Unknown bases: no format validation
    }
}

/**
 * Generate "neighbor" codes for fuzzy matching when AI/OCR gets a digit wrong.
 * For a code like "100862", generates: 100861, 100863, 100860, 100864.
 * For "I7396" → I7395, I7397, I7394, I7398.
 * For "C2667" → C2666, C2668, C2665, C2669.
 * 
 * Used by Strategy 1.5: fuzzy code + description confirmation.
 */
export function buildFuzzyCodeNeighbors(code: string, source?: string): string[] {
    const clean = String(code || '').trim().replace(/\s+/g, '').toUpperCase();
    if (!clean || clean === 'N/A') return [];

    const neighbors: Set<string> = new Set();
    
    // Extract prefix and numeric part
    const match = clean.match(/^([A-Z]?)(\d{3,7})(.*)$/i);
    if (!match) return [];
    
    const prefix = match[1] || '';
    const digits = match[2];
    const suffix = match[3] || '';
    const num = parseInt(digits, 10);
    
    if (isNaN(num)) return [];
    
    // Strategy A: Generate ±1 and ±2 neighbors
    for (const offset of [-2, -1, 1, 2]) {
        const neighbor = num + offset;
        if (neighbor < 0) continue;
        const padded = String(neighbor).padStart(digits.length, '0');
        const full = `${prefix}${padded}${suffix}`;
        neighbors.add(full);
        
        // Also add variants for this neighbor using buildCodeVariants
        for (const variant of buildCodeVariants(full, source)) {
            neighbors.add(variant);
        }
    }
    
    // Strategy B: I↔1 prefix swap (critical for OCR confusion: I00862 ↔ 100862)
    if (prefix === 'I') {
        // I00862 → 100862 (replace I with 1)
        const withOne = `1${digits}${suffix}`;
        neighbors.add(withOne);
        for (const variant of buildCodeVariants(withOne, source)) {
            neighbors.add(variant);
        }
        // Also try cross-base variants (the real code might be SINAPI 100862)
        const knownBases = ['SINAPI', 'SEINFRA', 'ORSE', 'SICRO'];
        for (const base of knownBases) {
            for (const variant of buildCodeVariants(withOne, base)) {
                neighbors.add(variant);
            }
        }
    } else if (prefix === '' && digits.startsWith('1')) {
        // 100862 → I00862 (replace leading 1 with I)
        const withI = `I${digits.slice(1)}${suffix}`;
        neighbors.add(withI);
        for (const variant of buildCodeVariants(withI, source)) {
            neighbors.add(variant);
        }
    }
    
    // Strategy C: Similar digit substitution for each position
    // Handles OCR confusion like 6↔8, 1↔7, 0↔8, 5↔6, 3↔8
    const similarDigits: Record<string, string[]> = {
        '0': ['8', '6'],
        '1': ['7'],
        '3': ['8'],
        '5': ['6'],
        '6': ['8', '5', '0'],
        '7': ['1'],
        '8': ['6', '3', '0'],
    };
    const digitArr = digits.split('');
    for (let i = 0; i < digitArr.length; i++) {
        const swaps = similarDigits[digitArr[i]];
        if (!swaps) continue;
        for (const swap of swaps) {
            const newDigits = [...digitArr];
            newDigits[i] = swap;
            const full = `${prefix}${newDigits.join('')}${suffix}`;
            neighbors.add(full);
            for (const variant of buildCodeVariants(full, source)) {
                neighbors.add(variant);
            }
        }
    }
    
    // Remove the original code itself and its direct variants
    neighbors.delete(clean);
    
    return Array.from(neighbors).filter(Boolean);
}
