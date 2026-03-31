"use strict";
/**
 * ══════════════════════════════════════════════════════════════════
 * KeywordDetector — Serviço centralizado de detecção de alertas
 * ══════════════════════════════════════════════════════════════════
 *
 * Substitui a lógica duplicada de `content.includes(keyword)` nos
 * endpoints /internal/ingest e /local-watcher/messages.
 *
 * Fluxo:
 * 1. Tenta match por categorias habilitadas (regex → keyword built-in → keyword custom)
 * 2. Tenta match por custom keywords avulsos do tenant
 * 3. Retorna resultado com severity e flag shouldNotify
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeywordDetector = void 0;
exports.createDetectorFromConfig = createDetectorFromConfig;
const alertTaxonomy_1 = require("./alertTaxonomy");
class KeywordDetector {
    constructor(enabledCategoryIds, customKeywords, 
    /** Legacy: keywords string separada por vírgula (retrocompatibilidade) */
    legacyKeywords, 
    /** Keywords custom por categoria */
    categoryCustomKeywords) {
        // Resolve enabled categories
        const categoryIds = enabledCategoryIds && enabledCategoryIds.length > 0
            ? enabledCategoryIds
            : alertTaxonomy_1.DEFAULT_ENABLED_CATEGORIES;
        this.enabledCategories = alertTaxonomy_1.ALERT_TAXONOMY.filter(cat => categoryIds.includes(cat.id));
        // Store category custom keywords
        this.categoryCustomKeywords = categoryCustomKeywords || {};
        // Resolve custom keywords: usa customKeywords se disponível, senão converte legacy
        if (customKeywords && customKeywords.length > 0) {
            this.customKeywords = customKeywords.map(k => k.trim().toLowerCase()).filter(Boolean);
        }
        else if (legacyKeywords) {
            // Retrocompatibilidade: campo antigo "keywords" separado por vírgula
            // Filtra keywords que já são cobertas pela taxonomia para evitar duplicata
            const taxonomyKeywords = new Set(alertTaxonomy_1.ALERT_TAXONOMY.flatMap(cat => cat.keywords.map(k => k.toLowerCase())));
            this.customKeywords = legacyKeywords
                .split(',')
                .map(k => k.trim().toLowerCase())
                .filter(k => k.length > 0 && !taxonomyKeywords.has(k));
        }
        else {
            this.customKeywords = [];
        }
    }
    /**
     * Detecta alertas no conteúdo de uma mensagem.
     * Prioridade: categorias (regex → keyword built-in → keyword custom) > custom keywords avulsos.
     */
    detect(content) {
        if (!content || content.length === 0) {
            return { detectedKeyword: null, categoryId: null, severity: null, shouldNotify: false, isClosureEvent: false };
        }
        const normalized = this.normalize(content.toLowerCase());
        // 1. Match por categorias habilitadas
        for (const cat of this.enabledCategories) {
            // 1a. Regex patterns (mais precisos, lidam com acentos)
            for (const pattern of cat.patterns) {
                if (pattern.test(content)) {
                    return {
                        detectedKeyword: cat.label,
                        categoryId: cat.id,
                        severity: cat.severity,
                        shouldNotify: cat.severity === 'critical' || cat.severity === 'warning' || cat.severity === 'closure',
                        isClosureEvent: !!cat.isClosureCategory,
                    };
                }
            }
            // 1b. Keywords built-in com normalização de acentos
            for (const kw of cat.keywords) {
                const normalizedKw = this.normalize(kw.toLowerCase());
                if (normalized.includes(normalizedKw)) {
                    return {
                        detectedKeyword: kw,
                        categoryId: cat.id,
                        severity: cat.severity,
                        shouldNotify: cat.severity === 'critical' || cat.severity === 'warning' || cat.severity === 'closure',
                        isClosureEvent: !!cat.isClosureCategory,
                    };
                }
            }
            // 1c. Keywords custom POR CATEGORIA (adicionadas pelo usuário)
            const catCustomKws = this.categoryCustomKeywords[cat.id];
            if (catCustomKws && catCustomKws.length > 0) {
                for (const kw of catCustomKws) {
                    const normalizedKw = this.normalize(kw.toLowerCase());
                    if (normalized.includes(normalizedKw)) {
                        return {
                            detectedKeyword: kw,
                            categoryId: cat.id,
                            severity: cat.severity,
                            shouldNotify: cat.severity === 'critical' || cat.severity === 'warning' || cat.severity === 'closure',
                            isClosureEvent: !!cat.isClosureCategory,
                        };
                    }
                }
            }
        }
        // 2. Custom keywords avulsos do tenant (sem categoria)
        for (const kw of this.customKeywords) {
            const normalizedKw = this.normalize(kw);
            if (normalized.includes(normalizedKw)) {
                return {
                    detectedKeyword: kw,
                    categoryId: 'custom',
                    severity: 'warning',
                    shouldNotify: true,
                    isClosureEvent: false,
                };
            }
        }
        return { detectedKeyword: null, categoryId: null, severity: null, shouldNotify: false, isClosureEvent: false };
    }
    /**
     * Remove acentos para matching robusto.
     * "suspensão" → "suspensao", "convocação" → "convocacao"
     */
    normalize(text) {
        return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    /** Retorna as categorias habilitadas (útil para debug/logs) */
    getEnabledCategories() {
        return this.enabledCategories.map(c => c.id);
    }
    /** Retorna as custom keywords ativas */
    getCustomKeywords() {
        return [...this.customKeywords];
    }
}
exports.KeywordDetector = KeywordDetector;
/**
 * Factory: cria KeywordDetector a partir de um ChatMonitorConfig do Prisma.
 * Lida com migração suave (configs antigos sem os novos campos).
 */
function createDetectorFromConfig(config) {
    let enabledCategories = null;
    let customKeywords = null;
    let categoryCustomKeywords = null;
    // Tenta ler novos campos (pós-migration)
    if (config?.enabledCategories) {
        try {
            enabledCategories = typeof config.enabledCategories === 'string'
                ? JSON.parse(config.enabledCategories)
                : config.enabledCategories;
        }
        catch { /* usa defaults */ }
    }
    if (config?.customKeywords) {
        try {
            customKeywords = typeof config.customKeywords === 'string'
                ? JSON.parse(config.customKeywords)
                : config.customKeywords;
        }
        catch { /* usa vazio */ }
    }
    if (config?.categoryCustomKeywords) {
        try {
            categoryCustomKeywords = typeof config.categoryCustomKeywords === 'string'
                ? JSON.parse(config.categoryCustomKeywords)
                : config.categoryCustomKeywords;
        }
        catch { /* usa vazio */ }
    }
    return new KeywordDetector(enabledCategories, customKeywords, config?.keywords || null, // legacy fallback
    categoryCustomKeywords);
}
