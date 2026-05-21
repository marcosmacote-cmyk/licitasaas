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
            // digits or digits/ORSE
            const orseMatch = code.match(/^0*(\d{1,6})(?:\/ORSE)?$/i);
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
        const orseMatch = code.match(/^0*(\d{1,6})(?:\/ORSE)?$/i);
        if (orseMatch) {
            variants.add(`${orseMatch[1]}/ORSE`);
            variants.add(orseMatch[1]);
            variants.add(`${orseMatch[1].padStart(4, '0')}/ORSE`);
            variants.add(`${orseMatch[1].padStart(5, '0')}/ORSE`);
        }
    }

    // SEINFRA-specific variants
    if (source?.toUpperCase() === 'SEINFRA' || /^C?\d{3,6}$/i.test(code) || /^[I1]\d{3,6}$/i.test(code)) {
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
