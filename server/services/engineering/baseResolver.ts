/**
 * baseResolver.ts — Resolução de base oficial para insumos/composições
 * 
 * Quando o motor salva tudo em PROPRIA, esta função detecta
 * a base oficial original a partir do padrão do código.
 * 
 * Compartilhada entre:
 * - engineering.ts (rotas)
 * - compositionFlattener.ts (relatório analítico)
 * - insumos-hub (resolução de base)
 */

/**
 * Resolve the DISPLAY base name for a composition/insumo.
 * When the motor stores everything in PROPRIA, this function detects the
 * original official base from the composition code pattern.
 * 
 * Priority: dbName (if official) > sourceName (if official) > code heuristic > fallback
 */
export function resolveDisplayBase(
    dbName: string | undefined,
    sourceName: string | undefined,
    compositionCode: string | undefined
): string {
    // 1. If dbName is an official base (not PROPRIA), use it directly
    const db = (dbName || '').trim();
    if (db && db !== 'PROPRIA' && !db.startsWith('PROPRIA_')) {
        return db;
    }

    // 2. If sourceName is an official base, use it
    const src = (sourceName || '').trim().toUpperCase();
    if (src && src !== 'PROPRIA' && !src.startsWith('PROPRIA')) {
        return src;
    }

    // 3. Detect base from composition code patterns
    let code = (compositionCode || '').trim().toUpperCase();
    if (code) {
        // Clear common collision/variant prefix and suffixes (ex: INS-, -C1, -H-AJ)
        code = code.replace(/-C\d+$/, '');
        code = code.replace(/-(H|M)-(AJ|EL)$/, '');
        if (code.startsWith('INS-')) {
            code = code.replace(/^INS-/, '').replace(/-\d+$/, '');
        }

        // SEINFRA patterns: CPMH06, CPEL03, CPTO01, C0054, C1614, I0001, PMH07
        if (/^[A-Z]{1,4}\d{2,5}$/.test(code) || /^I\d{3,5}$/.test(code)) return 'SEINFRA';
        // SINAPI: 3-6 digit numbers (247, 2436, 6110 = MO básica; 88316, 93566 = composições; 74209/1)
        if (/^\d{3,6}(\/\d+)?$/.test(code)) return 'SINAPI';
        // ORSE: numeric with possible /ORSE suffix
        if (/^\d{3,6}\/ORSE$/.test(code) || (/^\d{3,6}$/.test(code) && src === 'ORSE')) return 'ORSE';
        // SICRO: pattern like EC-05-013-00
        if (/^[A-Z]{2}-\d{2}-\d{3}/.test(code)) return 'SICRO';
        // SBC: starts with SBC
        if (/^SBC/i.test(code)) return 'SBC';
        // CAERN: starts with CAERN
        if (/^CAERN/i.test(code)) return 'CAERN';
        // SICOR: starts with SICOR
        if (/^SICOR/i.test(code)) return 'SICOR';
    }

    // 4. Fallback
    return 'PRÓPRIA';
}

/**
 * Derive groupKey from item type when groupKey is null/undefined.
 * This ensures items always have a group for rendering in reports.
 */
export function deriveGroupKey(type: string | null | undefined, groupKey: string | null | undefined): string {
    if (groupKey) return groupKey;
    
    const t = (type || '').toUpperCase();
    switch (t) {
        case 'MAO_DE_OBRA': return 'MAO_DE_OBRA';
        case 'MATERIAL': return 'MATERIAL';
        case 'EQUIPAMENTO': return 'EQUIPAMENTO';
        case 'SERVICO': return 'SERVICO';
        case 'COMPOSICAO_AUXILIAR': return 'AUXILIAR';
        case 'AUXILIAR': return 'AUXILIAR';
        case 'OBSERVACAO': return 'OBSERVACAO';
        default: return 'MATERIAL'; // Safe fallback
    }
}
