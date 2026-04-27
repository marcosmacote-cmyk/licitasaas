/**
 * ══════════════════════════════════════════════════════════════════
 *  Page Targeting — Localiza páginas de planilha orçamentária em PDFs
 * ══════════════════════════════════════════════════════════════════
 *
 *  PROBLEMA: PDFs de engenharia têm 100-300 páginas, mas a planilha
 *  orçamentária ocupa apenas 10-30 delas. Enviar o PDF inteiro ao
 *  Gemini gera tokens desnecessários ($$) e latência excessiva.
 *
 *  SOLUÇÃO: Extrair texto de cada página, pontuar por densidade de
 *  palavras-chave orçamentárias, e recortar apenas as páginas
 *  candidatas em um novo PDF menor.
 *
 *  RESULTADO: 200 pgs / 22MB → ~30 pgs / 3MB → ~85% menos tokens
 */

import { PDFDocument } from 'pdf-lib';
import { logger } from '../../lib/logger';

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface PageScore {
    pageIndex: number;   // 0-based
    pageNumber: number;  // 1-based (human readable)
    score: number;       // 0-100
    keywords: string[];  // matched keywords
    numericDensity: number; // ratio of numeric tokens to total tokens
}

export interface PageTargetingResult {
    totalPages: number;
    candidatePages: PageScore[];
    selectedPageIndices: number[];     // 0-based indices of selected pages
    reductionPercent: number;          // e.g. 85 means 85% fewer pages
    trimmedPdfBuffer: Buffer | null;   // The PDF with only candidate pages
    strategy: 'targeted' | 'full';     // 'full' if all pages passed or targeting failed
}

// ═══════════════════════════════════════════
// Keywords and scoring
// ═══════════════════════════════════════════

/** Keywords that strongly indicate budget/cost table pages */
const HIGH_WEIGHT_KEYWORDS = [
    'planilha orçamentária', 'planilha orcamentaria',
    'orçamento estimado', 'orcamento estimado',
    'orçamento base', 'orcamento base',
    'planilha de custos', 'planilha de preços', 'planilha de precos',
    'planilha sintética', 'planilha sintetica',
    'planilha analítica', 'planilha analitica',
    'estimativa de custos', 'custo unitário sem bdi',
    'custo unitário s/ bdi', 'preço unitário sem bdi',
    'custo unit. s/ bdi', 'preco unit. s/ bdi',
    'preço unit. s/ bdi',
    'custo direto', 'preço com bdi', 'preco com bdi',
];

/** Keywords that indicate budget content (medium weight) */
const MEDIUM_WEIGHT_KEYWORDS = [
    'sinapi', 'seinfra', 'siproce', 'sicro', 'orse',
    'composição', 'composicao', 'composição de custos',
    'bdi', 'encargos sociais', 'leis sociais',
    'cronograma físico', 'cronograma fisico',
    'quantitativo', 'quantitativos',
    'empreitada', 'medição', 'medicao',
    'valor global', 'valor total',
    'subtotal', 'sub-total', 'total geral',
];

/** Keywords that indicate budget items (lower weight but useful) */
const LOW_WEIGHT_KEYWORDS = [
    'serviços preliminares', 'servicos preliminares',
    'infraestrutura', 'superestrutura', 'supraestrutura',
    'alvenaria', 'revestimento', 'cobertura',
    'instalações elétricas', 'instalacoes eletricas',
    'instalações hidráulicas', 'instalacoes hidraulicas',
    'esquadrias', 'pintura', 'pavimentação', 'pavimentacao',
    'drenagem', 'terraplenagem',
    'mobilização', 'mobilizacao', 'desmobilização', 'desmobilizacao',
    'administração local', 'administracao local',
];

/** Patterns indicating tabular numeric data (regex) */
const NUMERIC_PATTERNS = [
    /\d{1,3}(?:\.\d{3})*,\d{2}/g,     // Brazilian numbers: 1.234,56
    /C\d{4}/g,                          // SEINFRA codes: C0054
    /\b\d{5,6}\b/g,                     // SINAPI codes: 87640
    /\d+\/ORSE/g,                       // ORSE codes: 14025/ORSE
    /CP-\d+/g,                          // Própria: CP-01
];

// ═══════════════════════════════════════════
// Core functions
// ═══════════════════════════════════════════

/**
 * Extract text per page from a PDF buffer using pdf-parse.
 * Returns an array where index = page number (0-based), value = text.
 */
async function extractTextPerPage(pdfBuffer: Buffer): Promise<string[]> {
    const pdfParse = require('pdf-parse');
    const pageTexts: string[] = [];
    
    // pdf-parse doesn't natively give per-page text, but we can use
    // the render callback to capture text page by page
    const options = {
        // Custom page renderer that captures text per page
        pagerender: function(pageData: any) {
            return pageData.getTextContent().then(function(textContent: any) {
                let text = '';
                for (const item of textContent.items) {
                    text += item.str + ' ';
                }
                return text;
            });
        }
    };

    try {
        const data = await pdfParse(pdfBuffer, options);
        
        // pdf-parse concatenates all pages. We need per-page text.
        // The numpages property tells us how many pages exist.
        // Let's use a different approach: parse with page tracking
        const totalPages = data.numpages || 1;
        
        // Re-parse with per-page tracking using pdfjs directly
        const pageTextsArray = await extractPagesViaRenderer(pdfBuffer, totalPages);
        return pageTextsArray;
    } catch (err: any) {
        logger.warn(`[PageTargeting] pdf-parse fallback: ${err.message}`);
        return [];
    }
}

/**
 * Use pdfjs (bundled with pdf-parse) to extract text page by page.
 */
async function extractPagesViaRenderer(pdfBuffer: Buffer, expectedPages: number): Promise<string[]> {
    // pdf-parse bundles pdfjs-dist internally
    const pdfjsLib = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
    
    const doc = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
    const numPages = doc.numPages;
    const pages: string[] = [];

    for (let i = 1; i <= numPages; i++) {
        try {
            const page = await doc.getPage(i);
            const textContent = await page.getTextContent();
            const text = textContent.items.map((item: any) => item.str).join(' ');
            pages.push(text);
        } catch (err: any) {
            pages.push(''); // Failed page = empty
        }
    }

    return pages;
}

/**
 * Score a page for budget/cost table likelihood.
 */
function scorePage(text: string, pageIndex: number): PageScore {
    const normalized = text.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    let score = 0;
    const matchedKeywords: string[] = [];

    // High-weight keywords (8 points each)
    for (const kw of HIGH_WEIGHT_KEYWORDS) {
        const kwNorm = kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (normalized.includes(kwNorm)) {
            score += 8;
            matchedKeywords.push(kw);
        }
    }

    // Medium-weight keywords (4 points each)
    for (const kw of MEDIUM_WEIGHT_KEYWORDS) {
        const kwNorm = kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (normalized.includes(kwNorm)) {
            score += 4;
            matchedKeywords.push(kw);
        }
    }

    // Low-weight keywords (2 points each)
    for (const kw of LOW_WEIGHT_KEYWORDS) {
        const kwNorm = kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (normalized.includes(kwNorm)) {
            score += 2;
            matchedKeywords.push(kw);
        }
    }

    // Numeric density — high density of Brazilian-format numbers = likely table
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const totalWords = words.length || 1;
    
    let numericMatches = 0;
    for (const pattern of NUMERIC_PATTERNS) {
        const matches = text.match(new RegExp(pattern.source, pattern.flags));
        numericMatches += (matches?.length || 0);
    }
    const numericDensity = numericMatches / totalWords;

    // High numeric density bonus (tables have lots of numbers)
    if (numericDensity > 0.15) score += 10;
    else if (numericDensity > 0.08) score += 6;
    else if (numericDensity > 0.04) score += 3;

    // Item numbering pattern bonus (1.0, 1.1, 1.1.1, 2.0, etc.)
    const itemNumbers = text.match(/\b\d+\.\d+(?:\.\d+)?\b/g);
    if (itemNumbers && itemNumbers.length >= 5) score += 8;
    else if (itemNumbers && itemNumbers.length >= 2) score += 4;

    // Cap at 100
    score = Math.min(100, score);

    return {
        pageIndex,
        pageNumber: pageIndex + 1,
        score,
        keywords: matchedKeywords,
        numericDensity: Math.round(numericDensity * 1000) / 1000,
    };
}

/**
 * Create a new PDF containing only the specified pages from the original.
 */
async function extractPages(originalPdfBuffer: Buffer, pageIndices: number[]): Promise<Buffer> {
    const srcDoc = await PDFDocument.load(originalPdfBuffer, { ignoreEncryption: true });
    const newDoc = await PDFDocument.create();

    const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
    for (const page of copiedPages) {
        newDoc.addPage(page);
    }

    const newPdfBytes = await newDoc.save();
    return Buffer.from(newPdfBytes);
}

// ═══════════════════════════════════════════
// Main API
// ═══════════════════════════════════════════

/** Configuration for page targeting */
interface PageTargetingOptions {
    /** Minimum score for a page to be considered a candidate (default: 8) */
    minScore?: number;
    /** Maximum number of pages to select (default: 40) */
    maxPages?: number;
    /** Include N pages of context around each candidate (default: 1) */
    contextPages?: number;
    /** Minimum total pages before targeting kicks in (default: 15) */
    minPagesForTargeting?: number;
}

/**
 * Analyze a PDF buffer and extract only the pages likely to contain
 * budget/cost tables. Returns a trimmed PDF buffer and metadata.
 */
export async function targetBudgetPages(
    pdfBuffer: Buffer,
    options: PageTargetingOptions = {}
): Promise<PageTargetingResult> {
    const {
        minScore = 8,
        maxPages = 40,
        contextPages = 1,
        minPagesForTargeting = 15,
    } = options;

    const t0 = Date.now();

    // Step 1: Extract text per page
    let pageTexts: string[];
    try {
        pageTexts = await extractTextPerPage(pdfBuffer);
    } catch (err: any) {
        logger.warn(`[PageTargeting] Text extraction failed: ${err.message}. Using full PDF.`);
        return {
            totalPages: 0,
            candidatePages: [],
            selectedPageIndices: [],
            reductionPercent: 0,
            trimmedPdfBuffer: null,
            strategy: 'full',
        };
    }

    const totalPages = pageTexts.length;

    // Don't bother targeting small PDFs
    if (totalPages < minPagesForTargeting) {
        logger.info(`[PageTargeting] PDF has only ${totalPages} pages (< ${minPagesForTargeting}). Using full PDF.`);
        return {
            totalPages,
            candidatePages: [],
            selectedPageIndices: Array.from({ length: totalPages }, (_, i) => i),
            reductionPercent: 0,
            trimmedPdfBuffer: null,
            strategy: 'full',
        };
    }

    // Step 2: Score each page
    const scores = pageTexts.map((text, idx) => scorePage(text, idx));
    const candidates = scores.filter(s => s.score >= minScore);

    if (candidates.length === 0) {
        logger.warn(`[PageTargeting] No pages scored ≥ ${minScore}. Using full PDF.`);
        return {
            totalPages,
            candidatePages: scores.sort((a, b) => b.score - a.score).slice(0, 10),
            selectedPageIndices: Array.from({ length: totalPages }, (_, i) => i),
            reductionPercent: 0,
            trimmedPdfBuffer: null,
            strategy: 'full',
        };
    }

    // Step 3: Sort by score and select top pages
    candidates.sort((a, b) => b.score - a.score);
    const topCandidates = candidates.slice(0, maxPages);

    // Step 4: Add context pages (pages before/after candidates for continuity)
    const selectedSet = new Set<number>();
    for (const c of topCandidates) {
        for (let offset = -contextPages; offset <= contextPages; offset++) {
            const idx = c.pageIndex + offset;
            if (idx >= 0 && idx < totalPages) {
                selectedSet.add(idx);
            }
        }
    }

    // Sort page indices for sequential reading
    const selectedPageIndices = Array.from(selectedSet).sort((a, b) => a - b);

    // Cap at maxPages (context might have pushed us over)
    const finalIndices = selectedPageIndices.slice(0, maxPages);

    // Step 5: Extract selected pages into a new PDF
    let trimmedPdfBuffer: Buffer | null = null;
    try {
        trimmedPdfBuffer = await extractPages(pdfBuffer, finalIndices);
    } catch (err: any) {
        logger.warn(`[PageTargeting] PDF page extraction failed: ${err.message}. Using full PDF.`);
        return {
            totalPages,
            candidatePages: topCandidates,
            selectedPageIndices: Array.from({ length: totalPages }, (_, i) => i),
            reductionPercent: 0,
            trimmedPdfBuffer: null,
            strategy: 'full',
        };
    }

    const reductionPercent = Math.round((1 - finalIndices.length / totalPages) * 100);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    logger.info(
        `[PageTargeting] ✅ ${totalPages} páginas → ${finalIndices.length} candidatas ` +
        `(${reductionPercent}% redução) em ${elapsed}s. ` +
        `Original: ${(pdfBuffer.length / 1024).toFixed(0)}KB → ` +
        `Trimmed: ${(trimmedPdfBuffer.length / 1024).toFixed(0)}KB. ` +
        `Top scores: ${topCandidates.slice(0, 5).map(c => `p${c.pageNumber}:${c.score}`).join(', ')}`
    );

    return {
        totalPages,
        candidatePages: topCandidates,
        selectedPageIndices: finalIndices,
        reductionPercent,
        trimmedPdfBuffer,
        strategy: 'targeted',
    };
}
