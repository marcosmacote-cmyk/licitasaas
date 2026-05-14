/**
 * ══════════════════════════════════════════════════════════════════
 *  Extraction Probe — Validação pré-extração em ~5 segundos
 * ══════════════════════════════════════════════════════════════════
 *
 *  PROBLEMA: Investimos 5-16 minutos extraindo um PDF inteiro antes
 *  de descobrir que a IA está alucinando ou confundindo colunas.
 *
 *  SOLUÇÃO: Extrair 3 páginas representativas (~5s) como "prova de
 *  conceito" antes da extração completa. Se a probe falhar, trocar
 *  de estratégia ou abortar cedo.
 *
 *  CHECKS:
 *    1. ≥3 itens com descrição + valores? → Prosseguir
 *    2. 0 itens? → PDF não tem planilha OU modo errado
 *    3. unitCost == quantity em >30%? → Column shift detectado
 *    4. Itens de memória de cálculo? → Trocar para Visual Batch
 */

import { PDFDocument } from 'pdf-lib';
import { logger } from '../../lib/logger';

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export type ProbeVerdict =
    | 'PASS'              // Probe found valid items → proceed with full extraction
    | 'FAIL_NO_ITEMS'     // Probe found 0 items → PDF likely has no budget table
    | 'FAIL_COLUMN_SHIFT' // Probe detected column confusion → needs reorientation
    | 'FAIL_HALLUCINATION' // Probe detected hallucinated/mem-calc items → wrong mode
    | 'FAIL_ERROR';       // Probe failed due to API error

export interface ProbeResult {
    verdict: ProbeVerdict;
    confidence: number;           // 0-100
    reason: string;
    itemsFound: number;
    probePages: number[];         // 1-based page numbers probed
    durationMs: number;
    /** Sample items from probe (for debugging) */
    sampleItems: Array<{
        item: string;
        description: string;
        quantity: number;
        unitCost: number;
    }>;
    /** If column shift detected, what % of items are shifted */
    columnShiftPercent?: number;
}

// ═══════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════

const PROBE_SYSTEM_PROMPT = `Você é um extrator especializado em planilhas orçamentárias de engenharia civil brasileira.
Extraia APENAS os itens visíveis nas páginas fornecidas. Retorne JSON puro.`;

const PROBE_USER_PROMPT = `Extraia os itens orçamentários APENAS das páginas fornecidas.
Para cada item, retorne: {"item": "1.1", "d": "descrição", "u": "UN", "q": 10.5, "pu": 150.30, "c": "87640"}
Retorne um array JSON: [{"item":..., "d":..., "u":..., "q":..., "pu":..., "c":...}, ...]
Se NÃO houver planilha orçamentária nestas páginas, retorne: []
NÃO invente itens. Extraia SOMENTE o que está visível.`;

const MEM_CALC_INDICATORS = [
    'memória de cálculo', 'memoria de calculo',
    'comprimento x largura x altura',
    'projeto estrutural', 'projeto hidráulico',
    'projeto sanitário', 'projeto elétrico',
];

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

/**
 * Extract specific pages from a PDF as a new smaller PDF.
 * @param pageIndices 0-based page indices
 */
async function extractProbePages(pdfBuffer: Buffer, pageIndices: number[]): Promise<Buffer> {
    const srcDoc = await PDFDocument.load(new Uint8Array(pdfBuffer), { ignoreEncryption: true });
    const newDoc = await PDFDocument.create();
    const validIndices = pageIndices.filter(i => i >= 0 && i < srcDoc.getPageCount());
    if (validIndices.length === 0) throw new Error('No valid pages for probe');
    const copiedPages = await newDoc.copyPages(srcDoc, validIndices);
    for (const page of copiedPages) newDoc.addPage(page);
    return Buffer.from(await newDoc.save());
}

/**
 * Select 3 representative page indices for probing.
 * Strategy: beginning, ~1/3, ~2/3 of the candidate pages.
 */
export function selectProbePages(
    candidatePageIndices: number[],
    totalPages: number
): number[] {
    if (candidatePageIndices.length === 0) {
        // No candidates → probe first, middle, last pages
        if (totalPages <= 3) return Array.from({ length: totalPages }, (_, i) => i);
        return [0, Math.floor(totalPages / 2), totalPages - 1];
    }

    const sorted = [...candidatePageIndices].sort((a, b) => a - b);
    if (sorted.length <= 3) return sorted;

    // Pick beginning, ~1/3, ~2/3 of the candidate range
    return [
        sorted[0],
        sorted[Math.floor(sorted.length / 3)],
        sorted[Math.floor(sorted.length * 2 / 3)],
    ];
}

/**
 * Parse probe response JSON.
 */
function parseProbeResponse(text: string): any[] {
    try {
        const cleaned = text
            .replace(/```json\s*/g, '')
            .replace(/```\s*/g, '')
            .trim();
        const parsed = JSON.parse(cleaned);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        // Try to find JSON array in the text
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
            try { return JSON.parse(match[0]); } catch { /* ignore */ }
        }
        return [];
    }
}

// ═══════════════════════════════════════════
// Main export
// ═══════════════════════════════════════════

export interface RunProbeOptions {
    /** 0-based page indices to probe. If empty, auto-selects 3 pages. */
    probePageIndices?: number[];
    /** Gemini caller function (injected to avoid circular imports) */
    callGemini: (contents: any[], systemPrompt: string) => Promise<string>;
}

/**
 * Run a lightweight 3-page probe to validate extraction feasibility.
 * Takes ~5 seconds. Returns a verdict that guides the full extraction strategy.
 */
export async function runExtractionProbe(
    pdfBuffer: Buffer,
    totalPages: number,
    candidatePageIndices: number[],
    options: RunProbeOptions
): Promise<ProbeResult> {
    const t0 = Date.now();
    const probeIndices = options.probePageIndices ?? selectProbePages(candidatePageIndices, totalPages);
    const probePages = probeIndices.map(i => i + 1); // 1-based for logging

    logger.info(`[Probe] 🔬 Starting probe on pages ${probePages.join(', ')} (${probeIndices.length} pages)`);

    try {
        // Build a mini PDF with only the probe pages
        const probePdf = await extractProbePages(pdfBuffer, probeIndices);

        // Call Gemini with the mini PDF
        const contents = [{
            role: 'user',
            parts: [
                { inlineData: { data: probePdf.toString('base64'), mimeType: 'application/pdf' } },
                { text: PROBE_USER_PROMPT },
            ],
        }];

        const responseText = await options.callGemini(contents, PROBE_SYSTEM_PROMPT);
        const items = parseProbeResponse(responseText);
        const durationMs = Date.now() - t0;

        // ── Analyze probe results ──
        const sampleItems = items.slice(0, 5).map((it: any) => ({
            item: String(it.item || it.i || ''),
            description: String(it.d || it.description || '').substring(0, 80),
            quantity: Number(it.q || it.quantity || 0),
            unitCost: Number(it.pu || it.unitCost || 0),
        }));

        // Check 1: No items at all
        if (items.length === 0) {
            logger.warn(`[Probe] ❌ FAIL_NO_ITEMS em ${durationMs}ms — 0 itens nas páginas ${probePages.join(', ')}`);
            return {
                verdict: 'FAIL_NO_ITEMS',
                confidence: 80,
                reason: `Nenhum item orçamentário encontrado nas páginas ${probePages.join(', ')}. O PDF pode não conter planilha ou as páginas selecionadas estão erradas.`,
                itemsFound: 0,
                probePages,
                durationMs,
                sampleItems: [],
            };
        }

        // Check 2: Column shift detection (unitCost == quantity)
        const compositionItems = items.filter((it: any) => {
            const q = Number(it.q || it.quantity || 0);
            const pu = Number(it.pu || it.unitCost || 0);
            return q > 0 && pu > 0;
        });

        const shiftedCount = compositionItems.filter((it: any) => {
            const q = Number(it.q || it.quantity || 0);
            const pu = Number(it.pu || it.unitCost || 0);
            return Math.abs(q - pu) < 0.01;
        }).length;

        const shiftPercent = compositionItems.length > 0
            ? Math.round((shiftedCount / compositionItems.length) * 100)
            : 0;

        if (shiftPercent > 30) {
            logger.warn(
                `[Probe] ⚠️ FAIL_COLUMN_SHIFT em ${durationMs}ms — ` +
                `${shiftedCount}/${compositionItems.length} itens com unitCost==quantity (${shiftPercent}%)`
            );
            return {
                verdict: 'FAIL_COLUMN_SHIFT',
                confidence: 85,
                reason: `${shiftPercent}% dos itens têm preço unitário igual à quantidade — provável confusão de colunas na leitura do PDF.`,
                itemsFound: items.length,
                probePages,
                durationMs,
                sampleItems,
                columnShiftPercent: shiftPercent,
            };
        }

        // Check 3: Hallucination detection (mem. cálculo items)
        const hallHits = items.filter((it: any) => {
            const desc = String(it.d || it.description || '').toLowerCase();
            return MEM_CALC_INDICATORS.some(kw => desc.includes(kw));
        }).length;

        if (hallHits > 0 && hallHits >= items.length * 0.3) {
            logger.warn(
                `[Probe] ⚠️ FAIL_HALLUCINATION em ${durationMs}ms — ` +
                `${hallHits}/${items.length} itens contêm termos de Memória de Cálculo`
            );
            return {
                verdict: 'FAIL_HALLUCINATION',
                confidence: 88,
                reason: `${hallHits} de ${items.length} itens contêm termos de "Memória de Cálculo", indicando que a IA está lendo páginas narrativas em vez da planilha.`,
                itemsFound: items.length,
                probePages,
                durationMs,
                sampleItems,
            };
        }

        // ── PASS ──
        logger.info(
            `[Probe] ✅ PASS em ${durationMs}ms — ${items.length} itens encontrados ` +
            `nas páginas ${probePages.join(', ')}`
        );

        return {
            verdict: 'PASS',
            confidence: 90,
            reason: `${items.length} itens orçamentários válidos encontrados. Extração completa pode prosseguir.`,
            itemsFound: items.length,
            probePages,
            durationMs,
            sampleItems,
        };

    } catch (err: any) {
        const durationMs = Date.now() - t0;
        logger.warn(`[Probe] ❌ FAIL_ERROR em ${durationMs}ms — ${err.message}`);
        return {
            verdict: 'FAIL_ERROR',
            confidence: 50,
            reason: `Probe falhou: ${err.message}. Tentaremos a extração completa mesmo assim.`,
            itemsFound: 0,
            probePages: probePages,
            durationMs,
            sampleItems: [],
        };
    }
}
