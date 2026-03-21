/**
 * ══════════════════════════════════════════════════════════════════
 * KeywordDetector — Serviço centralizado de detecção de alertas
 * ══════════════════════════════════════════════════════════════════
 * 
 * Substitui a lógica duplicada de `content.includes(keyword)` nos
 * endpoints /internal/ingest e /local-watcher/messages.
 * 
 * Fluxo:
 * 1. Tenta match por categorias habilitadas (regex → keyword exato)
 * 2. Tenta match por custom keywords do tenant
 * 3. Retorna resultado com severity e flag shouldNotify
 */

import { ALERT_TAXONOMY, DEFAULT_ENABLED_CATEGORIES, type AlertCategory, type AlertSeverity } from './alertTaxonomy';

export interface DetectionResult {
  detectedKeyword: string | null;
  categoryId: string | null;
  severity: AlertSeverity | null;
  shouldNotify: boolean;
}

export class KeywordDetector {
  private enabledCategories: AlertCategory[];
  private customKeywords: string[];

  constructor(
    enabledCategoryIds: string[] | null,
    customKeywords: string[] | null,
    /** Legacy: keywords string separada por vírgula (retrocompatibilidade) */
    legacyKeywords?: string | null,
  ) {
    // Resolve enabled categories
    const categoryIds = enabledCategoryIds && enabledCategoryIds.length > 0
      ? enabledCategoryIds
      : DEFAULT_ENABLED_CATEGORIES;

    this.enabledCategories = ALERT_TAXONOMY.filter(
      cat => categoryIds.includes(cat.id)
    );

    // Resolve custom keywords: usa customKeywords se disponível, senão converte legacy
    if (customKeywords && customKeywords.length > 0) {
      this.customKeywords = customKeywords.map(k => k.trim().toLowerCase()).filter(Boolean);
    } else if (legacyKeywords) {
      // Retrocompatibilidade: campo antigo "keywords" separado por vírgula
      // Filtra keywords que já são cobertas pela taxonomia para evitar duplicata
      const taxonomyKeywords = new Set(
        ALERT_TAXONOMY.flatMap(cat => cat.keywords.map(k => k.toLowerCase()))
      );
      this.customKeywords = legacyKeywords
        .split(',')
        .map(k => k.trim().toLowerCase())
        .filter(k => k.length > 0 && !taxonomyKeywords.has(k));
    } else {
      this.customKeywords = [];
    }
  }

  /**
   * Detecta alertas no conteúdo de uma mensagem.
   * Prioridade: categorias (regex → keyword) > custom keywords.
   */
  detect(content: string): DetectionResult {
    if (!content || content.length === 0) {
      return { detectedKeyword: null, categoryId: null, severity: null, shouldNotify: false };
    }

    const normalized = this.normalize(content.toLowerCase());

    // 1. Match por categorias habilitadas
    for (const cat of this.enabledCategories) {
      // Regex patterns primeiro (mais precisos, lidam com acentos)
      for (const pattern of cat.patterns) {
        if (pattern.test(content)) {
          return {
            detectedKeyword: cat.label,
            categoryId: cat.id,
            severity: cat.severity,
            shouldNotify: cat.severity === 'critical' || cat.severity === 'warning',
          };
        }
      }

      // Keyword exato com normalização de acentos
      for (const kw of cat.keywords) {
        const normalizedKw = this.normalize(kw.toLowerCase());
        if (normalized.includes(normalizedKw)) {
          return {
            detectedKeyword: kw,
            categoryId: cat.id,
            severity: cat.severity,
            shouldNotify: cat.severity === 'critical' || cat.severity === 'warning',
          };
        }
      }
    }

    // 2. Custom keywords do tenant
    for (const kw of this.customKeywords) {
      const normalizedKw = this.normalize(kw);
      if (normalized.includes(normalizedKw)) {
        return {
          detectedKeyword: kw,
          categoryId: 'custom',
          severity: 'warning',
          shouldNotify: true,
        };
      }
    }

    return { detectedKeyword: null, categoryId: null, severity: null, shouldNotify: false };
  }

  /**
   * Remove acentos para matching robusto.
   * "suspensão" → "suspensao", "convocação" → "convocacao"
   */
  private normalize(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /** Retorna as categorias habilitadas (útil para debug/logs) */
  getEnabledCategories(): string[] {
    return this.enabledCategories.map(c => c.id);
  }

  /** Retorna as custom keywords ativas */
  getCustomKeywords(): string[] {
    return [...this.customKeywords];
  }
}

/**
 * Factory: cria KeywordDetector a partir de um ChatMonitorConfig do Prisma.
 * Lida com migração suave (configs antigos sem os novos campos).
 */
export function createDetectorFromConfig(config: any): KeywordDetector {
  let enabledCategories: string[] | null = null;
  let customKeywords: string[] | null = null;

  // Tenta ler novos campos (pós-migration)
  if (config?.enabledCategories) {
    try {
      enabledCategories = typeof config.enabledCategories === 'string'
        ? JSON.parse(config.enabledCategories)
        : config.enabledCategories;
    } catch { /* usa defaults */ }
  }

  if (config?.customKeywords) {
    try {
      customKeywords = typeof config.customKeywords === 'string'
        ? JSON.parse(config.customKeywords)
        : config.customKeywords;
    } catch { /* usa vazio */ }
  }

  return new KeywordDetector(
    enabledCategories,
    customKeywords,
    config?.keywords || null, // legacy fallback
  );
}
