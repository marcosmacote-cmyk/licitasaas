/**
 * ══════════════════════════════════════════════════════════════════
 *  PDF Fingerprinter — Classifica PDFs em cenários ANTES da extração
 * ══════════════════════════════════════════════════════════════════
 *
 *  PROBLEMA: O pipeline atual decide o modo de extração de forma
 *  reativa (scanned vs digital). PDFs híbridos, com garbage OCR,
 *  landscape, ou sem planilha causam alucinações caras.
 *
 *  SOLUÇÃO: Analisar o PDF em ~2-3s e classificar em um cenário
 *  que determina a estratégia ideal de extração.
 *
 *  CENÁRIOS:
 *    C1  DIGITAL_STANDARD   — PDF editável, texto limpo
 *    C2  SCANNED_PURE       — PDF escaneado, ≥70% sem texto
 *    C3  HYBRID_MEMCALC     — Mix escaneado + memória de cálculo
 *    C4  DIGITAL_LONG       — PDF digital com 100+ itens estimados
 *    C6  NO_BUDGET_TABLE    — Sem palavras-chave orçamentárias
 *    C8  SCANNED_GARBAGE    — Texto extraído é garbage OCR
 *    C9  ENCRYPTED          — PDF protegido/criptografado
 *    C10 LANDSCAPE_TABLE    — Tabelas em formato paisagem
 */

import { logger } from '../../lib/logger';

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export type PdfScenario =
    | 'DIGITAL_STANDARD'
    | 'SCANNED_PURE'
    | 'HYBRID_MEMCALC'
    | 'DIGITAL_LONG'
    | 'SCANNED_GARBAGE'
    | 'ENCRYPTED'
    | 'LANDSCAPE_TABLE'
    | 'NO_BUDGET_TABLE'
    | 'UNKNOWN';

export interface PdfFingerprint {
    totalPages: number;
    textPagesCount: number;
    imagePagesCount: number;          // pages with <10 chars
    garbageTextPagesCount: number;    // pages with text but unrecognizable
    memCalcPagesCount: number;
    cpuPagesCount: number;            // Composição de Preços Unitários
    chronogramPagesCount: number;
    budgetKeywordScore: number;       // 0-100
    estimatedItemCount: number;       // heuristic from item numbering patterns
    isEncrypted: boolean;
    dominantOrientation: 'portrait' | 'landscape' | 'mixed';
    scenario: PdfScenario;
    scenarioConfidence: number;       // 0-100
    scenarioReason: string;
    /** 0-based indices of pages detected as scanned (empty/garbage text) */
    scannedPageIndices: number[];
    /** 0-based indices of pages detected as memória de cálculo */
    memCalcPageIndices: number[];
    /** Timing in ms */
    durationMs: number;
}

// ═══════════════════════════════════════════
// Keywords
// ═══════════════════════════════════════════

const BUDGET_KEYWORDS_HIGH = [
    'planilha orçamentária', 'planilha orcamentaria',
    'orçamento estimado', 'orcamento estimado',
    'planilha de custos', 'planilha de preços',
    'planilha sintética', 'planilha sintetica',
    'planilha analítica', 'planilha analitica',
    'custo unitário sem bdi', 'custo unit. s/ bdi',
    'preço unitário sem bdi', 'preço com bdi',
];

const BUDGET_KEYWORDS_MED = [
    'sinapi', 'seinfra', 'siproce', 'sicro', 'orse',
    'composição', 'composicao', 'bdi', 'encargos sociais',
    'valor global', 'valor total', 'subtotal', 'total geral',
];

const MEM_CALC_PATTERNS = [
    'memória de cálculo', 'memoria de calculo',
    'memória de calculo', 'memoria de cálculo',
    'comprimento   x   largura   x   altura',
    'comprimento x largura x altura',
];

const CPU_PATTERNS = [
    'composição de preços unitários', 'composicao de precos unitarios',
    'composição de custo', 'composicao de custo',
    'composição analítica', 'composicao analitica',
    'cpu - composição', 'cpu - composicao',
    'insumo', 'coeficiente',
];

const CHRONOGRAM_PATTERNS = [
    'cronograma físico', 'cronograma fisico',
    'cronograma financeiro', 'cronograma físico-financeiro',
    'cronograma fisico-financeiro',
    '1º mês', '2º mês', '3º mês', '1o mes', '2o mes',
];

/** Words that indicate real extractable content (not garbage OCR) */
const QUALITY_WORDS = new Set([
    'total', 'item', 'unidade', 'quantidade', 'preco', 'preço',
    'servico', 'serviço', 'etapa', 'obra', 'material', 'sinapi',
    'seinfra', 'composicao', 'composição', 'valor', 'unitario',
    'unitário', 'planilha', 'orçamento', 'orcamento', 'bdi',
    'custo', 'revestimento', 'alvenaria', 'pintura', 'cobertura',
    'instalações', 'instalacoes', 'descrição', 'descricao',
    'demolição', 'demolicao', 'escavação', 'escavacao',
]);

// ═══════════════════════════════════════════
// Core
// ═══════════════════════════════════════════

function normalize(text: string): string {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function matchPatterns(text: string, patterns: string[]): number {
    const norm = normalize(text);
    return patterns.filter(p => norm.includes(normalize(p))).length;
}

function isEmptyPage(text: string): boolean {
    return text.trim().length < 10;
}

function isGarbagePage(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length < 10) return false; // empty, not garbage
    if (trimmed.length <= 100) return false;
    const words = normalize(trimmed).split(/\s+/).filter(w => w.length >= 3);
    const recognizable = words.filter(w => QUALITY_WORDS.has(w)).length;
    if (words.length >= 50 && recognizable === 0) return true;
    if (words.length >= 20 && (recognizable / words.length) < 0.01) return true;
    return false;
}

/**
 * Extract text per page using pdfjs-dist bundled with pdf-parse.
 */
async function extractPageTexts(pdfBuffer: Buffer): Promise<string[]> {
    const pdfjsLib = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
    const doc = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        try {
            const page = await doc.getPage(i);
            const tc = await page.getTextContent();
            pages.push(tc.items.map((item: any) => item.str).join(' '));
        } catch {
            pages.push('');
        }
    }
    return pages;
}

/**
 * Detect dominant page orientation from PDF dimensions.
 */
async function detectOrientation(pdfBuffer: Buffer): Promise<'portrait' | 'landscape' | 'mixed'> {
    try {
        const { PDFDocument } = require('pdf-lib');
        const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
        let portrait = 0, landscape = 0;
        for (let i = 0; i < doc.getPageCount(); i++) {
            const page = doc.getPage(i);
            const { width, height } = page.getSize();
            if (width > height * 1.1) landscape++;
            else portrait++;
        }
        if (landscape === 0) return 'portrait';
        if (portrait === 0) return 'landscape';
        if (landscape / (portrait + landscape) > 0.3) return 'mixed';
        return 'portrait';
    } catch {
        return 'portrait';
    }
}

/**
 * Estimate the number of budget items from item numbering patterns.
 * Looks for patterns like "1.0", "1.1", "2.3.1" in text pages.
 */
function estimateItemCount(pageTexts: string[]): number {
    const allItems = new Set<string>();
    for (const text of pageTexts) {
        const matches = text.match(/\b\d{1,2}\.\d{1,2}(?:\.\d{1,2})?(?:\.\d{1,2})?\b/g);
        if (matches) {
            for (const m of matches) {
                // Filter out dates (dd.mm), times, and other noise
                const parts = m.split('.');
                if (parts.length >= 2 && parseInt(parts[0]) <= 30) {
                    allItems.add(m);
                }
            }
        }
    }
    return allItems.size;
}

// ═══════════════════════════════════════════
// Main export
// ═══════════════════════════════════════════

/**
 * Fingerprint a PDF buffer to determine the optimal extraction scenario.
 * Runs in ~2-3 seconds. Should be called BEFORE pageTargeting.
 */
export async function fingerprintPdf(pdfBuffer: Buffer): Promise<PdfFingerprint> {
    const t0 = Date.now();

    // ── Check encryption ──
    let isEncrypted = false;
    try {
        const { PDFDocument } = require('pdf-lib');
        await PDFDocument.load(pdfBuffer, { ignoreEncryption: false });
    } catch (err: any) {
        if (/encrypt/i.test(err.message) || /password/i.test(err.message)) {
            isEncrypted = true;
        }
    }

    if (isEncrypted) {
        return {
            totalPages: 0, textPagesCount: 0, imagePagesCount: 0,
            garbageTextPagesCount: 0, memCalcPagesCount: 0, cpuPagesCount: 0,
            chronogramPagesCount: 0, budgetKeywordScore: 0, estimatedItemCount: 0,
            isEncrypted: true, dominantOrientation: 'portrait',
            scenario: 'ENCRYPTED', scenarioConfidence: 99,
            scenarioReason: 'PDF protegido por senha — impossível extrair texto.',
            scannedPageIndices: [], memCalcPageIndices: [],
            durationMs: Date.now() - t0,
        };
    }

    // ── Extract text per page ──
    let pageTexts: string[];
    try {
        pageTexts = await extractPageTexts(pdfBuffer);
    } catch (err: any) {
        logger.warn(`[Fingerprinter] Text extraction failed: ${err.message}`);
        return {
            totalPages: 0, textPagesCount: 0, imagePagesCount: 0,
            garbageTextPagesCount: 0, memCalcPagesCount: 0, cpuPagesCount: 0,
            chronogramPagesCount: 0, budgetKeywordScore: 0, estimatedItemCount: 0,
            isEncrypted: false, dominantOrientation: 'portrait',
            scenario: 'UNKNOWN', scenarioConfidence: 0,
            scenarioReason: `Falha ao ler PDF: ${err.message}`,
            scannedPageIndices: [], memCalcPageIndices: [],
            durationMs: Date.now() - t0,
        };
    }

    const totalPages = pageTexts.length;

    // ── Classify each page ──
    const scannedPageIndices: number[] = [];
    const garbagePageIndices: number[] = [];
    const memCalcPageIndices: number[] = [];
    const cpuPageIndices: number[] = [];
    const chronogramPageIndices: number[] = [];
    let textPagesCount = 0;

    for (let i = 0; i < totalPages; i++) {
        const text = pageTexts[i];
        if (isEmptyPage(text)) {
            scannedPageIndices.push(i);
        } else if (isGarbagePage(text)) {
            garbagePageIndices.push(i);
            scannedPageIndices.push(i); // garbage = effectively scanned
        } else {
            textPagesCount++;
            if (matchPatterns(text, MEM_CALC_PATTERNS) >= 1) memCalcPageIndices.push(i);
            if (matchPatterns(text, CPU_PATTERNS) >= 2) cpuPageIndices.push(i);
            if (matchPatterns(text, CHRONOGRAM_PATTERNS) >= 2) chronogramPageIndices.push(i);
        }
    }

    // ── Budget keyword score (across ALL text pages) ──
    const allText = pageTexts.join(' ');
    const highHits = matchPatterns(allText, BUDGET_KEYWORDS_HIGH);
    const medHits = matchPatterns(allText, BUDGET_KEYWORDS_MED);
    const budgetKeywordScore = Math.min(100, highHits * 12 + medHits * 5);

    const estimatedItemCount = estimateItemCount(pageTexts.filter((_, i) => !scannedPageIndices.includes(i)));
    const orientation = await detectOrientation(pdfBuffer);

    // ── Determine scenario ──
    const imagePagesCount = scannedPageIndices.length;
    const scannedPercent = totalPages > 0 ? (imagePagesCount / totalPages) * 100 : 0;
    const textPercent = totalPages > 0 ? (textPagesCount / totalPages) * 100 : 0;
    const memCalcPercent = totalPages > 0 ? (memCalcPageIndices.length / totalPages) * 100 : 0;

    let scenario: PdfScenario = 'UNKNOWN';
    let scenarioConfidence = 0;
    let scenarioReason = '';

    // C9: Encrypted (already handled above)
    // C6: No budget table
    if (budgetKeywordScore < 5 && textPercent > 50 && estimatedItemCount < 5) {
        scenario = 'NO_BUDGET_TABLE';
        scenarioConfidence = 85;
        scenarioReason = `Budget keyword score = ${budgetKeywordScore}, estimated items = ${estimatedItemCount}. PDF provavelmente não contém planilha orçamentária.`;
    }
    // C2: Scanned pure (≥70% pages are image/garbage)
    else if (scannedPercent >= 70) {
        scenario = 'SCANNED_PURE';
        scenarioConfidence = 90;
        scenarioReason = `${imagePagesCount}/${totalPages} páginas sem texto (${Math.round(scannedPercent)}%). PDF escaneado puro.`;
    }
    // C3: Hybrid with memória de cálculo
    else if (imagePagesCount >= 3 && memCalcPageIndices.length >= 3 && scannedPercent < 70) {
        scenario = 'HYBRID_MEMCALC';
        scenarioConfidence = 92;
        scenarioReason = `${imagePagesCount} pgs escaneadas + ${memCalcPageIndices.length} pgs de Memória de Cálculo. ` +
            `Planilha provavelmente nas páginas escaneadas. Texto = noise.`;
    }
    // C8: Garbage OCR (some text but unrecognizable)
    else if (garbagePageIndices.length >= 3 && garbagePageIndices.length > textPagesCount * 0.5) {
        scenario = 'SCANNED_GARBAGE';
        scenarioConfidence = 80;
        scenarioReason = `${garbagePageIndices.length} pgs com garbage OCR. Texto extraído é ilegível.`;
    }
    // C10: Landscape table
    else if (orientation === 'landscape' || orientation === 'mixed') {
        scenario = 'LANDSCAPE_TABLE';
        scenarioConfidence = 75;
        scenarioReason = `Orientação ${orientation} detectada. Tabelas horizontais requerem visual batch.`;
    }
    // C4: Digital long (100+ estimated items)
    else if (textPercent >= 80 && estimatedItemCount >= 80) {
        scenario = 'DIGITAL_LONG';
        scenarioConfidence = 85;
        scenarioReason = `PDF digital com ~${estimatedItemCount} itens estimados. Requer extração em chunks com gap detection.`;
    }
    // C1: Digital standard
    else if (textPercent >= 80 && budgetKeywordScore >= 10) {
        scenario = 'DIGITAL_STANDARD';
        scenarioConfidence = 90;
        scenarioReason = `PDF digital padrão. ${Math.round(textPercent)}% texto, budget score = ${budgetKeywordScore}.`;
    }
    // Fallback
    else {
        scenario = 'UNKNOWN';
        scenarioConfidence = 30;
        scenarioReason = `Cenário não reconhecido. text=${Math.round(textPercent)}%, scanned=${Math.round(scannedPercent)}%, ` +
            `budget=${budgetKeywordScore}, items≈${estimatedItemCount}. Usando fallback STANDARD.`;
    }

    const durationMs = Date.now() - t0;

    const fp: PdfFingerprint = {
        totalPages,
        textPagesCount,
        imagePagesCount,
        garbageTextPagesCount: garbagePageIndices.length,
        memCalcPagesCount: memCalcPageIndices.length,
        cpuPagesCount: cpuPageIndices.length,
        chronogramPagesCount: chronogramPageIndices.length,
        budgetKeywordScore,
        estimatedItemCount,
        isEncrypted,
        dominantOrientation: orientation,
        scenario,
        scenarioConfidence,
        scenarioReason,
        scannedPageIndices,
        memCalcPageIndices,
        durationMs,
    };

    logger.info(
        `[Fingerprinter] 🔍 ${totalPages} pgs → ${scenario} (${scenarioConfidence}%) em ${durationMs}ms. ` +
        `text=${textPagesCount}, scanned=${imagePagesCount}, memCalc=${memCalcPageIndices.length}, ` +
        `garbage=${garbagePageIndices.length}, budget=${budgetKeywordScore}, items≈${estimatedItemCount}. ` +
        `${scenarioReason}`
    );

    return fp;
}
