"use strict";
/**
 * ══════════════════════════════════════════════════════════════════
 *  Declaration Parser — Parse + Sanitize da Resposta da IA
 * ══════════════════════════════════════════════════════════════════
 *
 *  Responsável por extrair JSON { title, text } da resposta bruta
 *  da IA e sanitizar o conteúdo (remover markdown, negritos, etc.).
 *
 *  3 estratégias de parse em cascata:
 *    1. JSON.parse direto
 *    2. Strip de code fences + JSON.parse
 *    3. Regex para extrair primeiro { ... } + JSON.parse
 *    4. Fallback: texto bruto sanitizado
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAndSanitize = parseAndSanitize;
// ═══════════════════════════════════════════════════════════════
// SANITIZER
// ═══════════════════════════════════════════════════════════════
/** Remove artefatos de markdown/formatação do texto */
function sanitize(s) {
    return s
        .replace(/\*\*/g, '') // Remove negritos
        .replace(/^#+\s*/gm, '') // Remove headers markdown
        .replace(/```[\s\S]*?```/g, '') // Remove code blocks
        .replace(/\n{3,}/g, '\n\n') // Colapsa linhas em branco
        .trim();
}
/**
 * Tenta extrair { title, text } da resposta bruta da IA.
 *
 * Retorna null APENAS se o rawResponse estiver completamente vazio.
 * Caso contrário, retorna pelo menos o texto bruto sanitizado.
 */
function parseAndSanitize(rawResponse) {
    if (!rawResponse || rawResponse.trim().length === 0)
        return null;
    let parsed = null;
    // Estratégia 1: JSON.parse direto
    try {
        parsed = JSON.parse(rawResponse);
    }
    catch { /* noop */ }
    // Estratégia 2: Strip de code fences
    if (!parsed) {
        const cleaned = rawResponse
            .replace(/^```json?\s*\n?/i, '')
            .replace(/\n?```\s*$/i, '')
            .trim();
        try {
            parsed = JSON.parse(cleaned);
        }
        catch { /* noop */ }
    }
    // Estratégia 3: Regex para primeiro { ... }
    if (!parsed) {
        const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                parsed = JSON.parse(jsonMatch[0]);
            }
            catch { /* noop */ }
        }
    }
    // Se conseguiu parsear e tem campo text
    if (parsed?.text) {
        return {
            title: sanitize(parsed.title || '').substring(0, 80),
            text: sanitize(parsed.text),
        };
    }
    // Fallback: texto bruto sanitizado
    return { title: '', text: sanitize(rawResponse) };
}
