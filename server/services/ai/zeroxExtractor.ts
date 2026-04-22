/**
 * ═══════════════════════════════════════════════════════════════════════
 * Zerox PDF Extractor Service — V3 Pipeline Pre-Processor
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Converts PDF files to clean structured Markdown using vision-capable LLMs
 * (Gemini 2.5 Flash) via the Zerox library. This produces significantly
 * higher quality text than sending raw PDF base64 directly to the LLM.
 *
 * Benefits over raw PDF inline:
 *   - 60-70% fewer input tokens (text vs base64 PDF)
 *   - Better table preservation (page-by-page vision)
 *   - Parallel page processing (configurable concurrency)
 *   - Clean text = better extraction accuracy
 *   - Hash-based caching eliminates re-processing
 *
 * Architecture:
 *   PDF Buffer → Zerox (Gemini Vision per page) → Markdown → Cache
 *                                                     ↓
 *                                         Gemini Flash (Schema Extraction)
 *
 * Fallback: If Zerox fails, returns null so the caller can use the
 * legacy inlineData approach.
 *
 * @module zeroxExtractor
 * @version 1.0.0
 */

import { logger } from '../../lib/logger';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// ── Zerox import (eager at module load for diagnostics) ──
// We try require() first (CommonJS), then dynamic import (ESM fallback).
let zeroxFn: ((args: any) => Promise<any>) | null = null;
let zeroxLoadError: string | null = null;

// Attempt to load immediately at module init for early diagnostics
try {
    const mod = require('zerox');
    zeroxFn = mod.zerox;
    if (zeroxFn) {
        logger.info('[ZeroxExtractor] ✅ Zerox library loaded successfully (require)');
    } else {
        zeroxLoadError = 'zerox module loaded but .zerox function not found';
        logger.warn(`[ZeroxExtractor] ⚠️ ${zeroxLoadError}`);
    }
} catch (err: any) {
    zeroxLoadError = err.message;
    logger.warn(`[ZeroxExtractor] ⚠️ Zerox not available: ${err.message}. V3 pipeline disabled.`);
}

function isZeroxLoaded(): boolean {
    return zeroxFn !== null;
}

// ── In-Memory Markdown Cache (keyed by PDF content hash) ──
interface CacheEntry {
    markdown: string;
    pageCount: number;
    extractedAt: string;
    durationMs: number;
}

const markdownCache = new Map<string, CacheEntry>();
const CACHE_MAX_SIZE = 50; // Keep at most 50 documents cached
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function getCacheKey(pdfBuffer: Buffer): string {
    return crypto.createHash('sha256').update(pdfBuffer).digest('hex').substring(0, 16);
}

function getCachedMarkdown(pdfBuffer: Buffer): CacheEntry | null {
    const key = getCacheKey(pdfBuffer);
    const entry = markdownCache.get(key);
    if (!entry) return null;

    // Check TTL
    const age = Date.now() - new Date(entry.extractedAt).getTime();
    if (age > CACHE_TTL_MS) {
        markdownCache.delete(key);
        return null;
    }

    logger.info(`[ZeroxExtractor] ⚡ Cache hit: ${key} (${entry.pageCount} pages, cached ${Math.round(age / 1000)}s ago)`);
    return entry;
}

function setCachedMarkdown(pdfBuffer: Buffer, entry: CacheEntry): void {
    // Evict oldest entries if cache is full
    if (markdownCache.size >= CACHE_MAX_SIZE) {
        const oldestKey = markdownCache.keys().next().value;
        if (oldestKey) markdownCache.delete(oldestKey);
    }
    markdownCache.set(getCacheKey(pdfBuffer), entry);
}

// ── Temporary file management ──
function getTempDir(): string {
    const uploadDir = process.env.NODE_ENV === 'production' ? '/app/uploads' : path.join(__dirname, '../../uploads');
    const tempDir = path.join(uploadDir, '.zerox-temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    return tempDir;
}

function cleanupTempFile(filePath: string): void {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (err: any) {
        logger.warn(`[ZeroxExtractor] Failed to cleanup temp file: ${filePath} — ${err.message}`);
    }
}

// ══════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ══════════════════════════════════════════════════════════════════════

export interface ZeroxExtractionResult {
    /** Full markdown text (all pages concatenated) */
    markdown: string;
    /** Number of pages processed */
    pageCount: number;
    /** Per-page markdown content */
    pages: Array<{ page: number; content: string }>;
    /** Time taken for extraction in ms */
    durationMs: number;
    /** Whether result came from cache */
    fromCache: boolean;
    /** Model used for vision OCR */
    model: string;
}

export interface ZeroxConfig {
    /** Gemini API key (defaults to env GEMINI_API_KEY) */
    apiKey?: string;
    /** Number of pages to process in parallel (default: 5) */
    concurrency?: number;
    /** Vision model to use (default: gemini-2.5-flash) */
    model?: string;
    /** Whether to maintain format consistency across pages (default: false — faster) */
    maintainFormat?: boolean;
    /** Specific pages to process (default: all) */
    pagesToConvert?: number | number[];
    /** Temperature for the vision model (default: 0.1) */
    temperature?: number;
}

/**
 * Check if Zerox is available and properly configured.
 * Call this before attempting extraction to provide graceful degradation.
 */
export async function isZeroxAvailable(): Promise<boolean> {
    if (!isZeroxLoaded()) {
        logger.info(`[ZeroxExtractor] ❌ Zerox NOT available (load error: ${zeroxLoadError || 'unknown'})`);
        return false;
    }

    const hasApiKey = !!(process.env.GEMINI_API_KEY);
    if (!hasApiKey) {
        logger.warn('[ZeroxExtractor] No GEMINI_API_KEY — Zerox cannot use Gemini Vision');
        return false;
    }
    return true;
}

/**
 * Extract structured Markdown from a PDF buffer using Zerox + Gemini Vision.
 *
 * This is the core function of the V3 pipeline. It:
 * 1. Checks the cache for a previous extraction
 * 2. Writes the PDF to a temp file (Zerox requires file path)
 * 3. Calls Zerox with Gemini Vision (parallel page processing)
 * 4. Returns clean Markdown that can be sent to the LLM for schema extraction
 *
 * @returns ZeroxExtractionResult or null if extraction fails
 */
export async function extractMarkdownFromPdf(
    pdfBuffer: Buffer,
    fileName: string,
    config?: ZeroxConfig
): Promise<ZeroxExtractionResult | null> {
    // 1. Check cache first
    const cached = getCachedMarkdown(pdfBuffer);
    if (cached) {
        return {
            markdown: cached.markdown,
            pageCount: cached.pageCount,
            pages: [], // Don't store per-page in cache to save memory
            durationMs: 0,
            fromCache: true,
            model: 'cached',
        };
    }

    // 2. Ensure Zerox is loaded
    if (!isZeroxLoaded()) {
        logger.warn(`[ZeroxExtractor] Zerox not available for "${fileName}" — returning null for fallback`);
        return null;
    }

    const apiKey = config?.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        logger.error('[ZeroxExtractor] No API key available');
        return null;
    }

    // 3. Write PDF to temp file (Zerox requires file path, not buffer)
    const tempDir = getTempDir();
    const safeName = fileName.replace(/[^a-z0-9._-]/gi, '_');
    // Zerox requires .pdf extension — PNCP filenames like "EDITAL" have no extension
    const ensuredName = safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`;
    const tempPath = path.join(tempDir, `zerox_${Date.now()}_${ensuredName}`);

    try {
        fs.writeFileSync(tempPath, pdfBuffer);
        logger.info(`[ZeroxExtractor] 📄 Processing "${fileName}" (${Math.round(pdfBuffer.length / 1024)}KB) via Zerox...`);

        const startTime = Date.now();

        // 4. Call Zerox with Gemini Vision
        const zeroxResult = await zeroxFn!({
            filePath: tempPath,
            modelProvider: 'GOOGLE',
            model: config?.model || 'gemini-2.5-flash',
            credentials: {
                apiKey,
            },
            concurrency: config?.concurrency || 5,
            maintainFormat: config?.maintainFormat || false,
            cleanup: true,
            llmParams: {
                temperature: config?.temperature || 0.1,
            },
            ...(config?.pagesToConvert !== undefined ? { pagesToConvertAsImages: config.pagesToConvert } : {}),
        });

        const durationMs = Date.now() - startTime;

        // 5. Process result
        if (!zeroxResult || !zeroxResult.pages || zeroxResult.pages.length === 0) {
            logger.warn(`[ZeroxExtractor] ⚠️ Zerox returned empty result for "${fileName}"`);
            return null;
        }

        const pages = zeroxResult.pages.map((p: any, idx: number) => ({
            page: p.page || idx + 1,
            content: p.content || '',
        }));

        // Concatenate all pages with structural separators
        // V5.0: Include section hints so the extraction model can produce granular source_ref
        const fullMarkdown = pages
            .map((p: any) => {
                const content = p.content || '';
                // Extract first heading or first meaningful line as structural hint
                const headingMatch = content.match(/^#{1,3}\s+(.{5,80})/m);
                const firstLine = content.split('\n').find((l: string) => l.trim().length > 10)?.trim().substring(0, 80) || '';
                const sectionHint = headingMatch ? headingMatch[1].trim() : firstLine;
                return `\n══ Página ${p.page}${sectionHint ? ` — ${sectionHint}` : ''} ══\n\n${content}`;
            })
            .join('\n');

        const result: ZeroxExtractionResult = {
            markdown: fullMarkdown,
            pageCount: pages.length,
            pages,
            durationMs,
            fromCache: false,
            model: config?.model || 'gemini-2.5-flash',
        };

        // 6. Cache the result
        setCachedMarkdown(pdfBuffer, {
            markdown: fullMarkdown,
            pageCount: pages.length,
            extractedAt: new Date().toISOString(),
            durationMs,
        });

        logger.info(`[ZeroxExtractor] ✅ "${fileName}" → ${pages.length} pages, ${fullMarkdown.length} chars in ${(durationMs / 1000).toFixed(1)}s`);

        return result;

    } catch (err: any) {
        const errMsg = err?.message || String(err);

        // Classify error for diagnostics
        if (errMsg.includes('ghostscript') || errMsg.includes('gm') || errMsg.includes('GraphicsMagick')) {
            logger.error(`[ZeroxExtractor] ❌ System dependency missing: ${errMsg}. Install ghostscript + graphicsmagick.`);
        } else if (errMsg.includes('429') || errMsg.includes('rate limit')) {
            logger.warn(`[ZeroxExtractor] ⚠️ Rate limit hit during vision processing: ${errMsg}`);
        } else if (errMsg.includes('503') || errMsg.includes('UNAVAILABLE')) {
            logger.warn(`[ZeroxExtractor] ⚠️ Gemini Vision unavailable: ${errMsg}`);
        } else {
            logger.error(`[ZeroxExtractor] ❌ Extraction failed for "${fileName}": ${errMsg}`);
        }

        return null;
    } finally {
        // Always cleanup temp file
        cleanupTempFile(tempPath);
    }
}

/**
 * Extract Markdown from multiple PDF buffers in sequence.
 * Returns a single concatenated Markdown string with document separators.
 *
 * @returns Combined markdown + metadata, or null if all extractions fail
 */
export async function extractMarkdownFromMultiplePdfs(
    pdfs: Array<{ buffer: Buffer; fileName: string }>,
    config?: ZeroxConfig
): Promise<{
    markdown: string;
    totalPages: number;
    documentsProcessed: number;
    documentsFailed: number;
    totalDurationMs: number;
    perDocumentResults: Array<{
        fileName: string;
        success: boolean;
        pageCount: number;
        durationMs: number;
        fromCache: boolean;
    }>;
} | null> {
    const totalStart = Date.now();
    logger.info(`[ZeroxExtractor] 🚀 Processing ${pdfs.length} PDF(s) in PARALLEL...`);

    // V5.0: Parallel processing — all PDFs processed simultaneously
    // Previously sequential (for...of await), which was 3×15s=45s → now ~15s
    const settled = await Promise.allSettled(
        pdfs.map(pdf => extractMarkdownFromPdf(pdf.buffer, pdf.fileName, config))
    );

    const results: Array<{
        fileName: string;
        success: boolean;
        pageCount: number;
        durationMs: number;
        fromCache: boolean;
        markdown: string;
    }> = settled.map((outcome, idx) => {
        const pdf = pdfs[idx];
        if (outcome.status === 'fulfilled' && outcome.value) {
            return {
                fileName: pdf.fileName,
                success: true,
                pageCount: outcome.value.pageCount,
                durationMs: outcome.value.durationMs,
                fromCache: outcome.value.fromCache,
                markdown: outcome.value.markdown,
            };
        } else {
            if (outcome.status === 'rejected') {
                logger.warn(`[ZeroxExtractor] ⚠️ Parallel extraction failed for "${pdf.fileName}": ${outcome.reason?.message || 'unknown'}`);
            }
            return {
                fileName: pdf.fileName,
                success: false,
                pageCount: 0,
                durationMs: 0,
                fromCache: false,
                markdown: '',
            };
        }
    });

    const successResults = results.filter(r => r.success);
    if (successResults.length === 0) {
        logger.warn('[ZeroxExtractor] All PDF extractions failed — returning null for legacy fallback');
        return null;
    }

    // Combine all successful extractions into one markdown
    const combinedMarkdown = successResults
        .map((r, idx) => `\n${'═'.repeat(60)}\n📄 DOCUMENTO ${idx + 1}: ${r.fileName}\n${'═'.repeat(60)}\n${r.markdown}`)
        .join('\n\n');

    return {
        markdown: combinedMarkdown,
        totalPages: results.reduce((sum, r) => sum + r.pageCount, 0),
        documentsProcessed: successResults.length,
        documentsFailed: results.length - successResults.length,
        totalDurationMs: Date.now() - totalStart,
        perDocumentResults: results.map(r => ({
            fileName: r.fileName,
            success: r.success,
            pageCount: r.pageCount,
            durationMs: r.durationMs,
            fromCache: r.fromCache,
        })),
    };
}

/**
 * Get cache statistics (for diagnostics/monitoring endpoints)
 */
export function getZeroxCacheStats(): {
    size: number;
    maxSize: number;
    ttlMinutes: number;
    entries: Array<{ key: string; pageCount: number; ageSec: number }>;
} {
    const entries = Array.from(markdownCache.entries()).map(([key, entry]) => ({
        key,
        pageCount: entry.pageCount,
        ageSec: Math.round((Date.now() - new Date(entry.extractedAt).getTime()) / 1000),
    }));

    return {
        size: markdownCache.size,
        maxSize: CACHE_MAX_SIZE,
        ttlMinutes: CACHE_TTL_MS / 60000,
        entries,
    };
}

/**
 * Clear the markdown cache (for testing/maintenance)
 */
export function clearZeroxCache(): void {
    const cleared = markdownCache.size;
    markdownCache.clear();
    logger.info(`[ZeroxExtractor] 🗑️ Cache cleared (${cleared} entries removed)`);
}
