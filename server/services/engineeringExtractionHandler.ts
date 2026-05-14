/**
 * engineeringExtractionHandler — Background job handler for async engineering extraction.
 * 
 * Decoupled from the main PNCP pipeline to avoid blocking the user.
 * Runs WITHOUT a race timeout — completes when Gemini finishes or fails.
 * 
 * Input:
 *   - biddingId: string (the saved bidding process ID)
 *   - pdfUrls: string[] (PNCP attachment URLs for planilha/composição PDFs)
 *   - tenantId: string (from job metadata)
 * 
 * Flow:
 *   1. Download planilha PDFs from PNCP
 *   2. Call Gemini with engineeringPromptV1 (no timeout race)
 *   3. Parse + validate JSON response
 *   4. enrichWithOfficialPrices() — match codes against SINAPI/SEINFRA DB
 *   5. Merge results into the existing schemaV2 (aiAnalysis)
 *   6. Emit SSE notification to connected clients
 */

import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import { updateJobProgress } from './backgroundJobService';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { fallbackToOpenAiV2 } from './ai/openai.service';
import { extractMarkdownFromMultiplePdfs, isZeroxAvailable } from './ai/zeroxExtractor';
import { targetBudgetPages } from './engineering/pageTargeting';
import { fingerprintPdf, type PdfFingerprint } from './engineering/pdfFingerprinter';
import { classifyEngineeringAttachments, urlsToEngineeringAttachments } from './engineering/documentClassifier';
import { parseAndNormalizeEngineeringExtraction } from './engineering/resultNormalizer';
import {
    screenEngineeringItems,
    validateEngineeringExtraction,
    type EngineeringItemScreeningResult,
    type EngineeringValidationReport,
} from './engineering/extractionValidator';
import { autoEvaluateIfBenchmarkCase } from './ai/benchmark/engineeringBenchmarkRunner';
import { enrichWithOfficialPrices } from './engineering/priceEnricher';

import {
    buildBudgetRowCandidateBatches,
    extractBudgetRowCandidatesFromMarkdown,
    formatBudgetRowCandidatesForPrompt,
} from './engineering/budgetRowCandidateExtractor';
import { buildScannedPdfVisualBatches, type ScannedPdfVisualBatch } from './engineering/scannedPdfVisualFallback';
// Import the engineering prompt (same used by the old E1.5-A)
import { ENGINEERING_PROPOSAL_SYSTEM_PROMPT, ENGINEERING_PROPOSAL_USER_INSTRUCTION } from './ai/modules/prompts/engineeringPromptV1';

// Import shared utilities from the engineering routes
// We import the callGeminiWithRetry from gemini service
import { callGeminiWithRetry } from './ai/gemini.service';

function collectSourceRowIdsFromItems(items: any[]): Set<string> {
    const rowIds = new Set<string>();
    const addValue = (value: unknown) => {
        if (!value) return;
        if (Array.isArray(value)) {
            value.forEach(addValue);
            return;
        }
        const raw = String(value);
        const matches = raw.match(/ocr-p\d+-r\d+/g) || [];
        matches.forEach(id => rowIds.add(id));
    };

    for (const item of items) {
        addValue(item.sourceRowId);
        addValue(item.sourceRowIds);
        addValue(item.source_row_id);
        addValue(item.source_row_ids);
    }
    return rowIds;
}

/**
 * Main handler — registered as 'engineering_extraction' in the job worker.
 */
export async function engineeringExtractionHandler(job: any): Promise<any> {
    const { biddingId, pdfUrls, documentSelection, proposalId } = job.input;
    const tenantId = job.tenantId;

    logger.info(`[Engineering-BG] 🏗️ Starting extraction for bidding ${biddingId} (${pdfUrls?.length || 0} PDF URLs)`);
    if (documentSelection) {
        logger.info(
            `[Engineering-BG] 📎 Document classifier selected ${documentSelection.selected || 0}/${documentSelection.total || 0} attachment(s): ` +
            `${(documentSelection.titles || []).join(' | ')}`
        );
    }

    await updateJobProgress(job.id, tenantId, {
        progress: 5,
        progressMsg: 'Baixando planilha orçamentária do PNCP...'
    });

    // ── Step 1: Download PDFs (keep raw buffers for page targeting) ──
    const rawPdfBuffers: Array<{ buffer: Buffer; source: string }> = [];
    const agent = new (require('https').Agent)({ rejectUnauthorized: false });

    for (const url of (pdfUrls || [])) {
        try {
            const resp = await axios.get(url, {
                responseType: 'arraybuffer',
                httpsAgent: agent,
                timeout: 60000, // 60s per PDF
                maxContentLength: 50 * 1024 * 1024 // 50MB
            } as any);
            const buf = Buffer.from(resp.data as ArrayBuffer);
            rawPdfBuffers.push({ buffer: buf, source: url.substring(0, 80) });
            logger.info(`[Engineering-BG] 📄 PDF downloaded (${(buf.length / 1024).toFixed(0)} KB) from ${url.substring(0, 80)}...`);
        } catch (err: any) {
            logger.warn(`[Engineering-BG] ⚠️ Failed to download PDF: ${err.message}`);
        }
    }

    // Fallback: if no PDFs from URLs, try to get from the bidding's PNCP attachments
    if (rawPdfBuffers.length === 0) {
        logger.info(`[Engineering-BG] 📄 No PDFs from URLs, trying PNCP attachments from DB...`);
        try {
            const bidding = await prisma.biddingProcess.findUnique({
                where: { id: biddingId },
                include: { aiAnalysis: true }
            });
            const schemaV2 = bidding?.aiAnalysis?.schemaV2 as any;
            const attachments = schemaV2?.pncp_source?.attachments || [];
            const classified = classifyEngineeringAttachments(attachments, { maxDocuments: 4 });
            const selectedAttachments: Array<{ url: string; titulo: string }> = classified.selected.length > 0
                ? classified.selected.map(doc => ({ url: doc.url, titulo: doc.title }))
                : urlsToEngineeringAttachments(pdfUrls)
                    .filter((att): att is { url: string; titulo: string } => Boolean(att.url && att.titulo))
                    .slice(0, 3);

            logger.info(
                `[Engineering-BG] 📎 Fallback classifier selected ${selectedAttachments.length}/${classified.summary.total} attachment(s): ` +
                `${selectedAttachments.map((att: any) => att.titulo || att.url).join(' | ')}`
            );

            for (const att of selectedAttachments.slice(0, 4)) { // Max 4 PDFs
                try {
                    const resp = await axios.get(att.url, {
                        responseType: 'arraybuffer',
                        httpsAgent: agent,
                        timeout: 60000,
                        maxContentLength: 50 * 1024 * 1024
                    } as any);
                    const buf = Buffer.from(resp.data as ArrayBuffer);
                    rawPdfBuffers.push({ buffer: buf, source: att.titulo || att.url });
                    logger.info(`[Engineering-BG] 📄 PDF from attachments: "${att.titulo}" (${(buf.length / 1024).toFixed(0)} KB)`);
                } catch (err: any) {
                    logger.warn(`[Engineering-BG] ⚠️ Failed: ${err.message}`);
                }
            }

            // ═══════════════════════════════════════════════════════
            // FALLBACK 3: Se schemaV2.attachments está vazio, buscar
            // diretamente na API PNCP usando o pncpLink do processo.
            // (Mesmo approach que downloadPncpPdfsForEngineering)
            // ═══════════════════════════════════════════════════════
            if (rawPdfBuffers.length === 0 && bidding?.pncpLink) {
                logger.info(`[Engineering-BG] 📄 Fallback 3: Buscando anexos diretamente da API PNCP via pncpLink...`);
                const linkMatch = bidding.pncpLink.match(/(\d{14})\/(\d{4})\/(\d+)/);
                if (linkMatch) {
                    const [, cnpj, ano, seq] = linkMatch;
                    const arquivosUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}/arquivos`;
                    try {
                        const apiRes = await axios.get(arquivosUrl, { httpsAgent: agent, timeout: 20000 } as any);
                        const arquivos = Array.isArray(apiRes.data) ? apiRes.data : [];
                        logger.info(`[Engineering-BG] 📎 API PNCP retornou ${arquivos.length} anexo(s)`);

                        if (arquivos.length > 0) {
                            const apiClassified = classifyEngineeringAttachments(arquivos, { maxDocuments: 4 });
                            const apiSelected = apiClassified.selected.length > 0
                                ? apiClassified.selected
                                : apiClassified.all.filter(doc => doc.score > (arquivos.length <= 1 ? -999 : -20)).slice(0, 4);

                            logger.info(
                                `[Engineering-BG] 📎 API classifier selected ${apiSelected.length}/${apiClassified.summary.total}: ` +
                                apiSelected.map(doc => `"${doc.title}" (${doc.score})`).join(', ')
                            );

                            for (const doc of apiSelected.slice(0, 4)) {
                                try {
                                    let fileUrl = doc.url || '';
                                    if (fileUrl.includes('pncp-api/v1')) fileUrl = fileUrl.replace('pncp-api/v1', 'api/pncp/v1');
                                    if (!fileUrl) continue;

                                    const fileRes = await axios.get(fileUrl, {
                                        responseType: 'arraybuffer',
                                        httpsAgent: agent,
                                        timeout: 60000,
                                        maxRedirects: 5,
                                        maxContentLength: 50 * 1024 * 1024,
                                    } as any);
                                    const buf = Buffer.from(fileRes.data as ArrayBuffer);

                                    // Verify it's a PDF (magic bytes %P)
                                    if (buf[0] === 0x25 && buf[1] === 0x50) {
                                        rawPdfBuffers.push({ buffer: buf, source: doc.title || 'PNCP PDF' });
                                        logger.info(`[Engineering-BG] ✅ API PDF: "${doc.title}" (${(buf.length / 1024).toFixed(0)} KB)`);
                                    } else {
                                        logger.info(`[Engineering-BG] ⏭️ "${doc.title}" não é PDF, ignorando`);
                                    }
                                } catch (dlErr: any) {
                                    logger.warn(`[Engineering-BG] ⚠️ Download falhou para "${doc.title}": ${dlErr.message}`);
                                }
                            }
                        }
                    } catch (apiErr: any) {
                        logger.warn(`[Engineering-BG] ⚠️ API PNCP falhou: ${apiErr.message}`);
                    }
                }
            }
        } catch (err: any) {
            logger.warn(`[Engineering-BG] ⚠️ DB lookup failed: ${err.message}`);
        }
    }

    if (rawPdfBuffers.length === 0) {
        throw new Error('Nenhum PDF de planilha orçamentária disponível para extração');
    }

    // ══════════════════════════════════════════════════════════════
    // Step 1.4: PDF FINGERPRINTING — classify each PDF's scenario
    // Runs in ~2-3s per PDF. Determines the optimal extraction mode.
    // ══════════════════════════════════════════════════════════════
    await updateJobProgress(job.id, tenantId, {
        progress: 12,
        progressMsg: 'Analisando tipo de documento...'
    });

    const fingerprints: PdfFingerprint[] = [];
    for (const { buffer, source } of rawPdfBuffers) {
        try {
            const fp = await fingerprintPdf(buffer);
            fingerprints.push(fp);

            // Early abort for ENCRYPTED PDFs
            if (fp.scenario === 'ENCRYPTED') {
                throw new Error(
                    `PDF "${source}" está protegido por senha. ` +
                    `Envie uma versão não protegida da planilha orçamentária.`
                );
            }
        } catch (err: any) {
            if (err.message.includes('protegido por senha')) throw err;
            logger.warn(`[Engineering-BG] ⚠️ Fingerprint failed for "${source}": ${err.message}`);
            fingerprints.push({
                totalPages: 0, textPagesCount: 0, imagePagesCount: 0,
                garbageTextPagesCount: 0, memCalcPagesCount: 0, cpuPagesCount: 0,
                chronogramPagesCount: 0, budgetKeywordScore: 0, estimatedItemCount: 0,
                isEncrypted: false, dominantOrientation: 'portrait',
                scenario: 'UNKNOWN', scenarioConfidence: 0,
                scenarioReason: `Fingerprint failed: ${err.message}`,
                scannedPageIndices: [], memCalcPageIndices: [],
                durationMs: 0,
            });
        }
    }

    // Check if ALL PDFs are NO_BUDGET_TABLE → abort early
    const allNoBudget = fingerprints.length > 0 && fingerprints.every(fp => fp.scenario === 'NO_BUDGET_TABLE');
    if (allNoBudget) {
        logger.warn(
            `[Engineering-BG] 🚫 Nenhum dos ${rawPdfBuffers.length} PDF(s) contém planilha orçamentária. ` +
            `Fingerprints: ${fingerprints.map(fp => fp.scenarioReason).join(' | ')}`
        );
        // Don't throw — let the pipeline continue with 0 items, which will be caught by diagnostics
    }

    // ══════════════════════════════════════════════════════════════
    // Step 1.5: PAGE TARGETING — reduce PDF to budget-relevant pages
    // Instead of sending 200 pages / 22MB to Gemini, we identify
    // the ~20-30 pages that contain the actual budget table and
    // create a trimmed PDF. This cuts tokens by ~85%.
    // ══════════════════════════════════════════════════════════════
    await updateJobProgress(job.id, tenantId, {
        progress: 15,
        progressMsg: 'Localizando páginas da planilha orçamentária...'
    });

    const pdfParts: any[] = [];
    const zeroxFallbackCandidates: Array<{ buffer: Buffer; fileName: string; reason: string }> = [];
    let totalOriginalKB = 0;
    let totalTrimmedKB = 0;
    let targetingUsed = false;
    let zeroxFallbackUsed = false;
    let zeroxFallbackMeta: any = null;
    let scannedPdfVisualBatches: ScannedPdfVisualBatch[] = [];
    let scannedPdfOcrFailureWithoutSafeFallback = false;

    for (const { buffer, source } of rawPdfBuffers) {
        totalOriginalKB += buffer.length / 1024;
        
        try {
            const targeting = await targetBudgetPages(buffer, {
                minScore: 8,
                maxPages: 120, // INCREASED from 60 to 120 to avoid truncating long budgets
                contextPages: 4, // INCREASED from 2 to 4 to bridge larger gaps without high-weight keywords
                minPagesForTargeting: 15,
            });

            if (targeting.strategy === 'targeted' && targeting.trimmedPdfBuffer) {
                // FIX HYBRID-01: If this is a hybrid PDF with mem. cálculo detected,
                // DON'T use the trimmed PDF (which includes text pages that confuse the AI).
                // Instead, force it to the scanned path for visual batch extraction.
                if (targeting.isHybridPdf) {
                    zeroxFallbackCandidates.push({
                        buffer,
                        fileName: source,
                        reason: 'scanned_pdf_no_text_layer',
                    });
                    logger.warn(
                        `[Engineering-BG] 📸 HYBRID PDF detected: "${source}" — ` +
                        `${targeting.scannedPageIndices?.length || 0} scanned pages contain the budget table, ` +
                        `${targeting.totalPages - (targeting.scannedPageIndices?.length || 0)} text pages are Memória de Cálculo. ` +
                        `Routing to visual batch for scanned-page extraction.`
                    );
                } else {
                    // Use the trimmed PDF (normal targeted path)
                    const trimmedBuf = targeting.trimmedPdfBuffer;
                    totalTrimmedKB += trimmedBuf.length / 1024;
                    pdfParts.push({
                        inlineData: { data: trimmedBuf.toString('base64'), mimeType: 'application/pdf' }
                    });
                    targetingUsed = true;
                    logger.info(
                        `[Engineering-BG] 🎯 Page Targeting: "${source}" — ` +
                        `${targeting.totalPages} pgs → ${targeting.selectedPageIndices.length} pgs ` +
                        `(${targeting.reductionPercent}% redução, ${(buffer.length / 1024).toFixed(0)}KB → ${(trimmedBuf.length / 1024).toFixed(0)}KB)`
                    );
                }
            } else {
                // Targeting not applicable or failed — use full PDF

                // Detect scanned PDFs — these ALWAYS need OCR
                if (targeting.isScannedPdf) {
                    // For scanned PDFs, DON'T add the raw PDF to pdfParts yet.
                    // Image-heavy PDFs (10MB+) overwhelm Gemini and cause it to skip items.
                    // Instead, we'll rely on Zerox OCR as the PRIMARY source.
                    // The raw PDF is added as visual backup ONLY if OCR fails.
                    zeroxFallbackCandidates.push({
                        buffer,
                        fileName: source,
                        reason: 'scanned_pdf_no_text_layer',
                    });
                    logger.warn(
                        `[Engineering-BG] 📸 PDF escaneado detectado: "${source}" ` +
                        `(${targeting.totalPages} pgs, ${targeting.scannedPagesPercent}% sem texto` +
                        `${targeting.isHybridPdf ? ', HYBRID com Memória de Cálculo' : ''}). ` +
                        `OCR será fonte primária — PDF bruto NÃO enviado ao Gemini (${(buffer.length / 1024).toFixed(0)} KB muito pesado).`
                    );
                    // Don't add to pdfParts — will be handled by OCR path below
                } else {
                    totalTrimmedKB += buffer.length / 1024;
                    pdfParts.push({
                        inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' }
                    });
                    if (targeting.totalPages >= 15 && targeting.strategy === 'full' && !targeting.trimmedPdfBuffer) {
                        zeroxFallbackCandidates.push({
                            buffer,
                            fileName: source,
                            reason: 'page_targeting_full_document',
                        });
                    }
                }
                logger.info(`[Engineering-BG] 📄 Using full PDF: "${source}" (${(buffer.length / 1024).toFixed(0)} KB, ${targeting.totalPages} pages${targeting.isScannedPdf ? ', SCANNED — deferred to OCR' : ''}${targeting.isHybridPdf ? ', HYBRID — deferred to visual batch' : ''})`);
            }
        } catch (err: any) {
            // Page targeting failed — fall back to full PDF
            logger.warn(`[Engineering-BG] ⚠️ Page targeting failed for "${source}": ${err.message}. Using full PDF.`);
            totalTrimmedKB += buffer.length / 1024;
            pdfParts.push({
                inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' }
            });
            zeroxFallbackCandidates.push({
                buffer,
                fileName: source,
                reason: 'page_targeting_error',
            });
        }
    }

    if (targetingUsed) {
        const overallReduction = Math.round((1 - totalTrimmedKB / totalOriginalKB) * 100);
        logger.info(`[Engineering-BG] 🎯 Overall: ${totalOriginalKB.toFixed(0)}KB → ${totalTrimmedKB.toFixed(0)}KB (${overallReduction}% reduction)`);
    }

    let ocrContext = '';
    if (zeroxFallbackCandidates.length > 0 && process.env.ENGINEERING_ZEROX_FALLBACK !== 'false') {
        await updateJobProgress(job.id, tenantId, {
            progress: 22,
            progressMsg: 'PDF sem texto tabular claro — tentando OCR estruturado como apoio...'
        });

        try {
            const available = await isZeroxAvailable();
            if (available) {
                const hasScannedPdfs = zeroxFallbackCandidates.some(c => c.reason === 'scanned_pdf_no_text_layer');
                const zeroxResult = await extractMarkdownFromMultiplePdfs(
                    zeroxFallbackCandidates.map(candidate => ({
                        buffer: candidate.buffer,
                        fileName: candidate.fileName,
                    })),
                    {
                        // PERF-08: Increased concurrency from 2 to 3 for scanned PDFs.
                        // Flash handles 3 concurrent vision requests well without 503 cascades.
                        concurrency: 3,
                        maintainFormat: true,
                        temperature: 0.1,
                        // FIX OCR-01: Increased timeout for scanned PDFs from 180s to 300s.
                        // Real-world 10MB scanned PDFs with 18-20 pages consistently exceed 180s
                        // due to per-page vision OCR overhead (Gemini Vision ~8-15s/page × 20 pages).
                        timeoutMs: hasScannedPdfs ? 300_000 : 30_000, // 5min for scanned, 30s for text
                    }
                );

                if (zeroxResult && zeroxResult.markdown.trim().length > 500) {
                    zeroxFallbackUsed = true;
                    zeroxFallbackMeta = {
                        totalPages: zeroxResult.totalPages,
                        documentsProcessed: zeroxResult.documentsProcessed,
                        documentsFailed: zeroxResult.documentsFailed,
                        totalDurationMs: zeroxResult.totalDurationMs,
                        reasons: zeroxFallbackCandidates.map(candidate => ({
                            fileName: candidate.fileName,
                            reason: candidate.reason,
                        })),
                    };
                    ocrContext =
                        '\n\n── OCR ESTRUTURADO DE APOIO (Zerox) ──\n' +
                        'Use este conteúdo para reconstruir tabelas quando o PDF inline estiver escaneado, distorcido ou sem texto pesquisável. ' +
                        'Continue extraindo APENAS linhas de planilha orçamentária real.\n\n' +
                        zeroxResult.markdown;
                    logger.info(
                        `[Engineering-BG] ✅ Zerox fallback: ${zeroxResult.documentsProcessed}/${zeroxFallbackCandidates.length} doc(s), ` +
                        `${zeroxResult.totalPages} páginas, ${zeroxResult.markdown.length} chars`
                    );
                } else {
                    logger.info('[Engineering-BG] Zerox fallback não gerou markdown suficiente; preparando fallback visual para PDFs escaneados.');
                }
            } else {
                logger.info('[Engineering-BG] Zerox fallback indisponível; preparando fallback visual para PDFs escaneados.');
            }
        } catch (err: any) {
            logger.warn(`[Engineering-BG] ⚠️ Zerox fallback falhou: ${err.message}. Preparando fallback visual para PDFs escaneados.`);
        }
    }

    // ── SCANNED PDF RECOVERY ──
    const hasOcrText = ocrContext.length > 500;
    const scannedPdfCandidates = zeroxFallbackCandidates.filter(candidate => candidate.reason === 'scanned_pdf_no_text_layer');
    const scannedPdfVisualFallbackEnabled = process.env.ENGINEERING_SCANNED_VISUAL_FALLBACK === 'true';

    if (!hasOcrText && scannedPdfCandidates.length > 0) {
        // FIX OCR-02: Auto-enable visual fallback when OCR fails for scanned PDFs.
        // Previously gated behind ENGINEERING_SCANNED_VISUAL_FALLBACK env var (never set in production),
        // causing 100% failure on scanned-only extractions. The visual fallback sends small batches
        // (6 pages at a time) to Gemini 2.5 Pro, which is safe and effective for budget tables.
        const shouldUseVisualFallback = scannedPdfVisualFallbackEnabled || scannedPdfCandidates.length > 0;
        if (shouldUseVisualFallback) {
            try {
                scannedPdfVisualBatches = await buildScannedPdfVisualBatches(
                    scannedPdfCandidates.map(candidate => ({
                        buffer: candidate.buffer,
                        fileName: candidate.fileName,
                    })),
                    { pagesPerBatch: 6 }
                );
                logger.warn(
                    `[Engineering-BG] 📸 OCR indisponível/insuficiente para ${scannedPdfCandidates.length} PDF(s) escaneado(s). ` +
                    `Fallback visual AUTO-ATIVADO — ${scannedPdfVisualBatches.length} lote(s) de até 6 página(s).`
                );
            } catch (err: any) {
                scannedPdfOcrFailureWithoutSafeFallback = true;
                logger.warn(`[Engineering-BG] ⚠️ Falha ao preparar fallback visual de PDF escaneado: ${err.message}.`);
            }
        } else {
            scannedPdfOcrFailureWithoutSafeFallback = true;
            logger.warn(
                `[Engineering-BG] 🛑 OCR indisponível/insuficiente para ${scannedPdfCandidates.length} PDF(s) escaneado(s). ` +
                `Fallback visual está desativado por segurança (ENGINEERING_SCANNED_VISUAL_FALLBACK!=true); ` +
                `o resultado será bloqueado/quarentenado em vez de arriscar alucinação.`
            );
        }
    }

    if (pdfParts.length === 0 && rawPdfBuffers.length > 0) {
        if (hasOcrText) {
            logger.info(
                `[Engineering-BG] 📸 Todos os PDFs são escaneados. ` +
                `OCR disponível (${ocrContext.length} chars) — MODO TEXTO PURO (PDFs visuais NÃO serão enviados para evitar sobrecarga).`
            );
            // We DO NOT add the raw PDFs to pdfParts. We rely purely on the OCR text.
        } else if (scannedPdfVisualBatches.length > 0) {
            logger.info(
                `[Engineering-BG] 📸 Todos os PDFs são escaneados e OCR falhou. ` +
                `Usando fallback visual em lotes pequenos (PDF bruto inteiro NÃO será enviado de uma vez).`
            );
        } else {
            logger.warn(
                `[Engineering-BG] 📸 Todos os PDFs são escaneados, MAS OCR FALHOU. ` +
                `Extração visual bruta bloqueada por segurança; não enviaremos PDF escaneado inteiro ao Gemini.`
            );
            scannedPdfOcrFailureWithoutSafeFallback = true;
        }
    }

    await updateJobProgress(job.id, tenantId, {
        progress: 25,
        progressMsg: `Extraindo itens de ${pdfParts.length} PDF(s) via IA...${targetingUsed ? ' (otimizado por Page Targeting)' : ''}${zeroxFallbackUsed ? ' (com OCR de apoio)' : ''}${ocrContext.length > 500 && !zeroxFallbackUsed ? ' (OCR texto)' : ''}${scannedPdfVisualBatches.length > 0 ? ' (fallback visual escaneado)' : ''}`
    });

    // ── Step 2: Call Gemini with engineering prompt — NO TIMEOUT RACE ──
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const t0 = Date.now();
    // DIAG-01: Phase timing for detailed performance analysis
    const phaseTiming: Record<string, number> = {};

    // Progress ticker (update every 30s while Gemini works)
    let progressPercent = 30;
    const progressTimer = setInterval(async () => {
        progressPercent = Math.min(progressPercent + 3, 85);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
        await updateJobProgress(job.id, tenantId, {
            progress: progressPercent,
            progressMsg: `Extraindo planilha orçamentária... (${elapsed}s)`
        }).catch(() => {});
    }, 30000);

    let engItems: any[] = [];
    let screening: EngineeringItemScreeningResult | null = null;
    let modelUsed = 'gemini-2.5-flash';
    let ocrRowCoverageMeta: any = null;

    try {
        const userInstruction = `${ENGINEERING_PROPOSAL_USER_INSTRUCTION}`;
        let totalRepairs: string[] = [];
        const seenItemKeys = new Set<string>();

        // Helper function for the extraction loop (handles MAX_TOKENS continuation)
        const extractChunk = async (contents: any[], batchLabel: string, batchInstruction: string, modelToUse: string, isTextOnly: boolean) => {
            let loopCount = 0;
            try {
                while (loopCount < 8) {
                    const result = await callGeminiWithRetry(ai.models, {
                        model: modelToUse,
                        contents,
                        config: {
                            systemInstruction: ENGINEERING_PROPOSAL_SYSTEM_PROMPT,
                            temperature: 0.1,
                            maxOutputTokens: 65536,
                            responseMimeType: 'application/json'
                        }
                    }, 2, { tenantId, operation: 'analysis', metadata: { stage: 'engineering_bg_extraction' } });
                        
                    const chunkText = result.text || '';
                    // @ts-ignore — finishReason accessed early for enriched logging
                    const finishReason = result.candidates?.[0]?.finishReason || 'UNKNOWN';
                    logger.info(
                        `[Engineering-BG] ✅ Gemini respondeu (${batchLabel} - Loop ${loopCount + 1}, ` +
                        `${chunkText.length} chars, finishReason=${finishReason}, model=${modelToUse})`
                    );

                    const normalizedChunk = parseAndNormalizeEngineeringExtraction(chunkText);
                    
                    let newItemsInChunk = 0;
                    for (const item of normalizedChunk.engineeringItems) {
                        const key = `${item.item}::${String(item.description || '').substring(0, 40).toUpperCase()}`;
                        if (!seenItemKeys.has(key)) {
                            seenItemKeys.add(key);
                            engItems.push(item);
                            newItemsInChunk++;
                        }
                    }
                    
                    if (normalizedChunk.repaired) totalRepairs.push(...normalizedChunk.repairs);
                    
                    if (finishReason === 'MAX_TOKENS') {
                        const lastItems = engItems.slice(-3);
                        const lastItemsSummary = lastItems.map(it => `${it.item}: ${String(it.description || '').substring(0, 50)}`).join(', ');
                        
                        logger.warn(`[Engineering-BG] ⚠️ MAX_TOKENS atingido. Continuando a partir de "${lastItems[lastItems.length - 1]?.item || '?'}"...`);

                        contents.push({ role: 'model', parts: [{ text: chunkText }] });
                        contents.push({ 
                            role: 'user', 
                            parts: [{ text: 
                                `🚨 Limite atingido. Você já extraiu ${engItems.length} itens. Últimos itens: [${lastItemsSummary}].\n` +
                                `CONTINUE a extração a partir do PRÓXIMO item APÓS "${lastItems[lastItems.length - 1]?.item || '?'}". NÃO repita itens.`
                            }] 
                        });
                        loopCount++;
                    } else {
                        // ── LAZY STOP DETECTION ──
                        // If the model stopped voluntarily (STOP) but extracted suspiciously
                        // few items relative to the input size, it may have "given up" early.
                        const inputCharCount = contents[0]?.parts
                            ?.reduce((sum: number, p: any) => sum + (p.text?.length || 0), 0) || 0;
                        const expectedMinItems = Math.max(5, Math.floor(inputCharCount / 800));
                        
                        if (loopCount === 0 && newItemsInChunk < expectedMinItems && newItemsInChunk < 20 && inputCharCount > 5000) {
                            logger.warn(
                                `[Engineering-BG] ⚠️ LAZY STOP detectado no ${batchLabel}: ` +
                                `apenas ${newItemsInChunk} itens extraídos para ${inputCharCount} chars de input ` +
                                `(esperado mínimo ~${expectedMinItems}). Re-enviando com instrução reforçada...`
                            );
                            
                            contents.push({ role: 'model', parts: [{ text: chunkText }] });
                            contents.push({
                                role: 'user',
                                parts: [{ text:
                                    `🚨 ATENÇÃO: Você extraiu apenas ${newItemsInChunk} itens, mas o trecho fornecido ` +
                                    `contém muito mais linhas orçamentárias. CONTINUE extraindo TODOS os itens restantes ` +
                                    `deste mesmo trecho. NÃO repita os ${newItemsInChunk} já extraídos. ` +
                                    `Retorne apenas os itens faltantes em JSON.`
                                }]
                            });
                            loopCount++;
                            continue;
                        }
                        
                        break;
                    }
                }
            } catch (geminiErr: any) {
                logger.warn(`[Engineering-BG] ⚠️ Gemini falhou no ${batchLabel}: ${geminiErr.message}. Tentando fallback...`);
                const fallbackResult = await fallbackToOpenAiV2({
                    systemPrompt: ENGINEERING_PROPOSAL_SYSTEM_PROMPT,
                    userPrompt: batchInstruction,
                    pdfParts: isTextOnly ? undefined : pdfParts,
                    temperature: 0.1,
                    maxTokens: 16384,
                    stageName: 'Engineering BG Extraction'
                });
                const normalizedChunk = parseAndNormalizeEngineeringExtraction(fallbackResult.text);
                engItems.push(...normalizedChunk.engineeringItems);
                if (normalizedChunk.repaired) totalRepairs.push(...normalizedChunk.repairs);
                modelUsed = fallbackResult.model;
            }
        };

        let ocrPhaseStart = Date.now();
        if (hasOcrText) {
            ocrPhaseStart = Date.now();
            // ── TEXT-BATCH MODE: Split OCR context by pages ──
            const rowCandidateExtraction = extractBudgetRowCandidatesFromMarkdown(ocrContext);
            // PERF-06: Increased batch size from 25→50 rows. Zerox produces clean structured
            // text that fits well within Flash's context window, and larger batches mean fewer
            // API calls (halves total calls from ~30 to ~15 for a 758-item document).
            const rowBatches = buildBudgetRowCandidateBatches(rowCandidateExtraction.candidates, 50);

            if (rowCandidateExtraction.candidates.length >= 10 && rowBatches.length > 0) {
                const consumedRowIds = new Set<string>();
                let retryBatchCount = 0;

                logger.info(
                    `[Engineering-BG] 📦 OCR ROW MODE: ${rowCandidateExtraction.candidates.length} row candidates ` +
                    `across ${rowCandidateExtraction.pageCount} page(s), ${rowBatches.length} batch(es).`
                );

                // PERF-06: Use Flash for OCR row mode — text is already pre-structured by Zerox.
                // Pro is 2-3x slower and unnecessary for clean text input. Pro is reserved for
                // visual batch mode where the model must read images directly.
                const ocrRowModel = 'gemini-2.5-flash';

                // PERF-06: Process batches in parallel groups of 3 for ~3x throughput.
                // Sequential processing took ~30min for 30 batches. Parallel groups of 3
                // reduce to ~10min while staying within API rate limits.
                const PARALLEL_GROUP_SIZE = 3;
                for (let groupStart = 0; groupStart < rowBatches.length; groupStart += PARALLEL_GROUP_SIZE) {
                    const groupBatches = rowBatches.slice(groupStart, groupStart + PARALLEL_GROUP_SIZE);
                    
                    await updateJobProgress(job.id, tenantId, {
                        progress: Math.min(30 + Math.round(((groupStart + groupBatches.length) / rowBatches.length) * 50), 80),
                        progressMsg: `Extraindo linhas OCR (lotes ${groupStart + 1}-${groupStart + groupBatches.length}/${rowBatches.length}) — ${engItems.length} itens extraídos...`
                    }).catch(() => {});

                    // Build extraction promises for the parallel group
                    const groupPromises = groupBatches.map(async (batch) => {
                        const batchLabel = `Lote OCR Linhas ${batch.index}/${batch.total}`;
                        const formattedRows = formatBudgetRowCandidatesForPrompt(batch.candidates);
                        const headerContext = rowCandidateExtraction.tableHeader
                            ? `CABEÇALHO DA TABELA ORIGINAL (ordem das colunas):\n${rowCandidateExtraction.tableHeader}\n\n`
                            : '';
                        const batchInstruction = `${userInstruction}\n\n` +
                            `${headerContext}` +
                            `CONTROLE DE COBERTURA POR LINHA OCR:\n` +
                            `Abaixo ha linhas candidatas da planilha. Cada linha tem um rowId estavel (ex: ocr-p7-r12).\n` +
                            `Avalie TODAS as linhas listadas neste lote. Para cada item/etapa/subetapa extraido, inclua "sourceRowId" ` +
                            `com o rowId usado. Se uma linha nao for item orcamentario real, ignore-a.\n` +
                            `Nao extraia conteudo fora das linhas listadas. Nao invente linhas faltantes.\n\n` +
                            `${formattedRows}`;

                        const beforeCount = engItems.length;
                        await extractChunk([{ role: 'user', parts: [{ text: batchInstruction }] }], batchLabel, batchInstruction, ocrRowModel, true);
                        return { batch, beforeCount };
                    });

                    // Execute group in parallel
                    const results = await Promise.allSettled(groupPromises);
                    
                    // Collect sourceRowIds from all group results
                    for (const result of results) {
                        if (result.status === 'fulfilled') {
                            const { batch, beforeCount } = result.value;
                            for (const rowId of collectSourceRowIdsFromItems(engItems.slice(beforeCount))) {
                                consumedRowIds.add(rowId);
                            }
                        }
                    }
                }

                // Single retry pass for any missing rows (after all batches complete)
                const missingRowsForRetry = rowCandidateExtraction.candidates
                    .filter(candidate => !consumedRowIds.has(candidate.rowId));
                const missingRatio = missingRowsForRetry.length / rowCandidateExtraction.candidates.length;
                
                if (missingRowsForRetry.length > 3 && missingRatio > 0.05) {
                    retryBatchCount = 1;
                    const retryLabel = `Retry cobertura global (${missingRowsForRetry.length} linhas)`;
                    logger.warn(
                        `[Engineering-BG] ⚠️ OCR row coverage retry: ` +
                        `${missingRowsForRetry.length}/${rowCandidateExtraction.candidates.length} row(s) missing sourceRowId.`
                    );
                    
                    // Retry in batches of 50 as well, but parallel
                    const retryBatches = buildBudgetRowCandidateBatches(missingRowsForRetry, 50);
                    const retryPromises = retryBatches.map(async (batch) => {
                        const retryInstruction = `${userInstruction}\n\n` +
                            `REPROCESSAMENTO POR COBERTURA:\n` +
                            `O lote anterior nao retornou sourceRowId para ${batch.candidates.length} linha(s). ` +
                            `Reavalie APENAS as linhas abaixo. Inclua "sourceRowId" em cada item extraido. ` +
                            `Se uma linha for subtotal/cabecalho de tabela/ruido, ignore-a.\n\n` +
                            `${formatBudgetRowCandidatesForPrompt(batch.candidates)}`;
                        const beforeRetryCount = engItems.length;
                        await extractChunk([{ role: 'user', parts: [{ text: retryInstruction }] }], retryLabel, retryInstruction, ocrRowModel, true);
                        return { beforeRetryCount };
                    });

                    const retryResults = await Promise.allSettled(retryPromises);
                    for (const result of retryResults) {
                        if (result.status === 'fulfilled') {
                            for (const rowId of collectSourceRowIdsFromItems(engItems.slice(result.value.beforeRetryCount))) {
                                consumedRowIds.add(rowId);
                            }
                        }
                    }
                }

                const missingRowIds = rowCandidateExtraction.candidates
                    .map(candidate => candidate.rowId)
                    .filter(rowId => !consumedRowIds.has(rowId));
                const coveragePercent = rowCandidateExtraction.candidates.length > 0
                    ? Math.round((consumedRowIds.size / rowCandidateExtraction.candidates.length) * 100)
                    : 0;

                ocrRowCoverageMeta = {
                    provider: 'zerox_markdown_row_candidates',
                    candidateCount: rowCandidateExtraction.candidates.length,
                    pageCount: rowCandidateExtraction.pageCount,
                    batchCount: rowBatches.length,
                    retryBatchCount,
                    consumedRowCount: consumedRowIds.size,
                    missingRowCount: missingRowIds.length,
                    coveragePercent,
                    missingRowIds: missingRowIds.slice(0, 80),
                    missingRowIdsTruncated: missingRowIds.length > 80,
                };

                const coverageMessage =
                    `[Engineering-BG] OCR row coverage: ${coveragePercent}% ` +
                    `(${consumedRowIds.size}/${rowCandidateExtraction.candidates.length} row candidates consumed, ` +
                    `${missingRowIds.length} missing).`;

                if (coveragePercent >= 80) {
                    logger.info(coverageMessage);
                } else {
                    logger.warn(coverageMessage);
                }
            } else {
                const pagesTokens = ocrContext.split('\n══ Página ');
                const header = pagesTokens[0];
                const actualPages = pagesTokens.slice(1).map(p => '══ Página ' + p);
                const PAGES_PER_BATCH = 8;
                const totalBatches = Math.ceil(actualPages.length / PAGES_PER_BATCH);

                // PERF-07: Use Flash + parallel groups for text batch mode too
                logger.info(`[Engineering-BG] 📦 TEXT BATCH MODE: ${actualPages.length} páginas detectadas. Dividindo em ${totalBatches} lotes usando gemini-2.5-flash (paralelo 3).`);

                const TEXT_PARALLEL = 3;
                for (let g = 0; g < totalBatches; g += TEXT_PARALLEL) {
                    const group = [];
                    for (let i = g; i < Math.min(g + TEXT_PARALLEL, totalBatches); i++) {
                        const batchPages = actualPages.slice(i * PAGES_PER_BATCH, (i + 1) * PAGES_PER_BATCH);
                        const batchOcr = header + '\n' + batchPages.join('\n');
                        const batchLabel = `Lote OCR ${i + 1}/${totalBatches}`;
                        const batchInstruction = `${userInstruction}\n\n🚨 ATENÇÃO: Extraia TODOS os itens deste trecho da planilha (${batchLabel}). NÃO pule linhas.\n\n${batchOcr}`;
                        group.push(extractChunk([{ role: 'user', parts: [{ text: batchInstruction }] }], batchLabel, batchInstruction, 'gemini-2.5-flash', true));
                    }
                    await updateJobProgress(job.id, tenantId, {
                        progress: Math.min(30 + Math.round(((g + group.length) / totalBatches) * 50), 80),
                        progressMsg: `Extraindo itens escaneados (lotes ${g + 1}-${g + group.length}/${totalBatches}) — ${engItems.length} itens extraídos...`
                    }).catch(() => {});
                    await Promise.allSettled(group);
                }
            }
        }

        if (hasOcrText) {
            phaseTiming['ocrExtraction'] = Date.now() - ocrPhaseStart;
        }

        if (scannedPdfVisualBatches.length > 0) {
            const visualPhaseStart = Date.now();
            logger.warn(
                `[Engineering-BG] 📸 SCANNED VISUAL BATCH MODE: processando ` +
                `${scannedPdfVisualBatches.length} lote(s) de páginas escaneadas via gemini-2.5-pro (paralelo 2).`
            );

            // PERF-07: Process visual batches in parallel groups of 2.
            // Previously sequential — each 6-page batch (~3min) waited for the previous one.
            // For 10 batches: 30min sequential → ~15min with parallelism of 2.
            // Using 2 (not 3) because visual batches send large base64 PDFs that are heavier
            // on the API than text-only requests.
            const VISUAL_PARALLEL = 2;
            for (let groupStart = 0; groupStart < scannedPdfVisualBatches.length; groupStart += VISUAL_PARALLEL) {
                const groupBatches = scannedPdfVisualBatches.slice(groupStart, groupStart + VISUAL_PARALLEL);

                await updateJobProgress(job.id, tenantId, {
                    progress: Math.min(30 + Math.round(((groupStart + groupBatches.length) / scannedPdfVisualBatches.length) * 45), 78),
                    progressMsg: `Extraindo páginas escaneadas (lotes ${groupStart + 1}-${groupStart + groupBatches.length}/${scannedPdfVisualBatches.length}) — ${engItems.length} itens extraídos...`
                }).catch(() => {});

                const groupPromises = groupBatches.map(async (batch) => {
                    const batchLabel =
                        `Lote Visual Escaneado ${batch.globalBatchIndex}/${batch.totalGlobalBatches} ` +
                        `(${batch.fileName} p.${batch.startPage}-${batch.endPage})`;

                    const batchInstruction = `${userInstruction}\n\n` +
                        `FALLBACK VISUAL PARA PDF ESCANEADO:\n` +
                        `Você está recebendo APENAS as páginas ${batch.startPage}-${batch.endPage} do arquivo "${batch.fileName}". ` +
                        `O OCR estruturado falhou ou veio insuficiente, então leia visualmente a imagem/PDF.\n\n` +
                        `INSTRUÇÕES PARA LEITURA VISUAL DE TABELAS ESCANEADAS:\n` +
                        `1. IDENTIFIQUE O CABEÇALHO: Localize as colunas ITEM | CÓDIGO | DESCRIÇÃO | UNID | QTD | P.UNIT S/BDI | P.UNIT C/BDI | TOTAL.\n` +
                        `2. LEIA DA DIREITA PARA ESQUERDA: Em tabelas escaneadas, comece pela coluna TOTAL (última coluna numérica, valores maiores), depois PREÇO UNITÁRIO (coluna anterior), depois QUANTIDADE.\n` +
                        `3. CADA COMPOSIÇÃO DEVE TER VALORES: Se um item tem código (ex: C1937, 87640) e unidade (ex: M2, M3, UN), ele OBRIGATORIAMENTE tem valores numéricos nas colunas de QTD, PREÇO e TOTAL. Se você não conseguir ler, faça o melhor esforço — NÃO retorne 0.\n` +
                        `4. DESCRIÇÃO OBRIGATÓRIA: Cada item deve ter a descrição completa. NÃO deixe o campo "d" vazio.\n` +
                        `5. Extraia TODOS os itens orçamentários visíveis neste lote, incluindo etapas, subetapas e composições.\n` +
                        `6. Não pare na primeira tabela. Não use dados de outros lotes.\n` +
                        `7. Se uma linha estiver cortada por continuação de página, extraia apenas quando houver descrição e valores suficientes.\n`;

                    await extractChunk(
                        [{
                            role: 'user',
                            parts: [
                                {
                                    inlineData: {
                                        data: batch.pdfBuffer.toString('base64'),
                                        mimeType: 'application/pdf',
                                    },
                                },
                                { text: batchInstruction },
                            ],
                        }],
                        batchLabel,
                        batchInstruction,
                        'gemini-2.5-pro',
                        false
                    );
                });

                await Promise.allSettled(groupPromises);
            }
            phaseTiming['visualBatch'] = Date.now() - visualPhaseStart;
        }

        if (pdfParts.length > 0) {
            // ── STANDARD MODE: Native PDFs ──
            logger.info(`[Engineering-BG] 🤖 STANDARD MODE: Extração unificada para PDFs não escaneados (gemini-2.5-flash).`);
            const batchInstruction = `${userInstruction}\n\n🚨 ATENÇÃO: Extraia TODOS os itens orçamentários das páginas visuais fornecidas.\nCOMECE OBRIGATORIAMENTE do Item 1.0 (primeiro item/etapa) e vá sequencialmente até o final.\nNÃO pule o início do documento. NÃO comece do meio.`;
            await extractChunk([{ role: 'user', parts: [...pdfParts, { text: batchInstruction }] }], 'Lote PDF Nativo', batchInstruction, 'gemini-2.5-flash', false);

            // ── GAP DETECTION: Check if early etapas were skipped ──
            // When Gemini hits MAX_TOKENS on large PDFs, it may start mid-document
            // (e.g., from Etapa 10) and continue forward, never covering Etapas 1-9.
            const sortedForGap = [...engItems].sort((a: any, b: any) => {
                const pa = String(a.item || '0').split('.').map(Number);
                const pb = String(b.item || '0').split('.').map(Number);
                for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
                    const diff = (pa[i] || 0) - (pb[i] || 0);
                    if (diff !== 0) return diff;
                }
                return 0;
            });
            const firstItemNum = sortedForGap.length > 0 ? String(sortedForGap[0]?.item || '1') : '1';
            const firstTopLevel = parseInt(firstItemNum.split('.')[0]) || 1;
            const lastItemNum = sortedForGap.length > 0 ? String(sortedForGap[sortedForGap.length - 1]?.item || '1') : '1';
            const lastTopLevel = parseInt(lastItemNum.split('.')[0]) || 1;

            if (firstTopLevel > 2 && engItems.length > 10) {
                // Gap detected: extraction skipped Etapas 1 through (firstTopLevel - 1)
                logger.warn(
                    `[Engineering-BG] ⚠️ GAP DETECTED: Extraction starts at Etapa ${firstTopLevel} (item "${firstItemNum}"). ` +
                    `Etapas 1-${firstTopLevel - 1} are MISSING. Launching recovery pass...`
                );

                await updateJobProgress(job.id, tenantId, {
                    progress: 75,
                    progressMsg: `Recuperando itens faltantes (Etapas 1-${firstTopLevel - 1})... ${engItems.length} itens extraídos`
                }).catch(() => {});

                const gapInstruction = `${userInstruction}\n\n` +
                    `🚨 RECUPERAÇÃO DE ITENS FALTANTES:\n` +
                    `Uma extração anterior cobriu apenas as Etapas ${firstTopLevel} até ${lastTopLevel} (${engItems.length} itens).\n` +
                    `Agora, extraia APENAS os itens das Etapas 1 até ${firstTopLevel - 1} (inclusive todas as subetapas e composições).\n` +
                    `NÃO repita itens das Etapas ${firstTopLevel}+. Comece do INÍCIO do documento.\n` +
                    `Retorne em JSON com o mesmo schema.`;

                await extractChunk(
                    [{ role: 'user', parts: [...pdfParts, { text: gapInstruction }] }],
                    `Gap Recovery (Etapas 1-${firstTopLevel - 1})`,
                    gapInstruction,
                    'gemini-2.5-flash',
                    false
                );

                logger.info(
                    `[Engineering-BG] ✅ Gap recovery complete. Total items now: ${engItems.length}`
                );
            }
        }

        clearInterval(progressTimer);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

        // DIAG-01: Log phase timing breakdown
        const phaseTimingLog = Object.entries(phaseTiming)
            .map(([phase, ms]) => `${phase}=${(ms / 1000).toFixed(1)}s`)
            .join(', ');
        if (phaseTimingLog) {
            logger.info(`[Engineering-BG] ⏱️ Timing breakdown: ${phaseTimingLog}, total=${elapsed}s`);
        }

        // FIX-ORDER-01: Sort items by hierarchical item number.
        // Parallel batch extraction (PERF-06/07) causes items to arrive out-of-order
        // (e.g., batch 3 finishes before batch 2, so item 1.8 appears after 2.0).
        // Sort using numeric comparison of each segment: "1.8" < "2.0" < "2.1" < "10.1"
        engItems.sort((a: any, b: any) => {
            const pa = String(a.item || '0').split('.').map(Number);
            const pb = String(b.item || '0').split('.').map(Number);
            for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
                const diff = (pa[i] || 0) - (pb[i] || 0);
                if (diff !== 0) return diff;
            }
            return 0;
        });
        logger.info(`[Engineering-BG] 🔄 Itens reordenados por numeração hierárquica (${engItems.length} itens).`);

        if (totalRepairs.length > 0) {
            logger.info(
                `[Engineering-BG] 🛠️ Normalização aplicou ${totalRepairs.length} reparo(s): ` +
                totalRepairs.slice(0, 12).join(', ')
            );
        }
        const rawItemCount = engItems.length;
        screening = screenEngineeringItems(engItems);
        engItems = screening.acceptedItems;

        if (screening.rejectedItems.length > 0) {
            logger.warn(
                `[Engineering-BG] 🧹 Domain screening removed ${screening.rejectedItems.length}/${rawItemCount} row(s) ` +
                `before enrichment/persistence.`
            );
        }

        const withCodes = engItems.filter((it: any) => it.code && it.sourceName && it.sourceName !== 'PROPRIA').length;
        const etapas = engItems.filter((it: any) => it.type === 'ETAPA').length;
        const composicoes = engItems.filter((it: any) => it.type === 'COMPOSICAO').length;

        // ── COLUMN SHIFT DETECTION ──
        // If >30% of composition items have unitCost == quantity, the AI confused columns.
        const compositionItems = engItems.filter((it: any) => it.type === 'COMPOSICAO' || it.type === 'INSUMO');
        const shiftedCount = compositionItems.filter((it: any) => {
            const qty = Number(it.quantity) || 0;
            const cost = Number(it.unitCost) || 0;
            return qty > 0 && cost > 0 && Math.abs(qty - cost) < 0.01;
        }).length;
        const shiftRatio = compositionItems.length > 0 ? shiftedCount / compositionItems.length : 0;

        if (shiftRatio > 0.30) {
            logger.error(
                `[Engineering-BG] 🚨 COLUMN SHIFT DETECTED! ${shiftedCount}/${compositionItems.length} items (${(shiftRatio * 100).toFixed(0)}%) ` +
                `have unitCost == quantity. The AI is reading the wrong PDF column. ` +
                `Flagging all shifted items for manual review.`
            );
            // Flag shifted items so the UI can warn the user
            for (const item of compositionItems) {
                const qty = Number(item.quantity) || 0;
                const cost = Number(item.unitCost) || 0;
                if (qty > 0 && cost > 0 && Math.abs(qty - cost) < 0.01) {
                    item._columnShiftSuspect = true;
                }
            }
        }

        // Also detect absurd total (> R$ 1 billion for items suggests column shift)
        const globalTotal = compositionItems.reduce((sum: number, it: any) => {
            return sum + (Number(it.quantity) || 0) * (Number(it.unitCost) || 0);
        }, 0);
        if (globalTotal > 1_000_000_000 && compositionItems.length < 1000) {
            logger.error(
                `[Engineering-BG] 🚨 ABSURD TOTAL DETECTED! Global total = R$ ${globalTotal.toLocaleString('pt-BR')} ` +
                `for ${compositionItems.length} items. This strongly suggests column shift in the PDF extraction.`
            );
        }

        logger.info(`[Engineering-BG] ✅ Extração em ${elapsed}s via ${modelUsed} — ${engItems.length}/${rawItemCount} itens aceitos (${etapas} etapas, ${composicoes} composições, ${withCodes} com código oficial)`);
    } catch (err: any) {
        clearInterval(progressTimer);
        logger.error(`[Engineering-BG] ❌ Extração falhou (todos modelos): ${err.message}`);
        throw new Error(`Extração de engenharia falhou: ${err.message}`);
    }

    // ── RETRY WITHOUT PAGE TARGETING ──
    // If targeting was used but 0 items found, the targeting may have excluded budget pages.
    // Retry with the FULL PDF (no trimming) before giving up.
    if (engItems.length === 0 && targetingUsed && rawPdfBuffers.length > 0 && !scannedPdfOcrFailureWithoutSafeFallback) {
        logger.info(`[Engineering-BG] 🔄 Page targeting produziu 0 itens — retentando com PDF COMPLETO (sem targeting)...`);
        
        await updateJobProgress(job.id, tenantId, {
            progress: 50,
            progressMsg: 'Retentando extração com documento completo...'
        }).catch(() => {});

        try {
            const fullPdfParts = rawPdfBuffers.map(({ buffer }) => ({
                inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' }
            }));

            const retryResult = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: [...fullPdfParts, { text: `${ENGINEERING_PROPOSAL_USER_INSTRUCTION}${ocrContext}` }] }],
                config: {
                    systemInstruction: ENGINEERING_PROPOSAL_SYSTEM_PROMPT,
                    temperature: 0.1,
                    maxOutputTokens: 65536,
                    responseMimeType: 'application/json'
                }
            }, 2, { tenantId, operation: 'analysis', metadata: { stage: 'engineering_bg_extraction_full_retry' } });

            const retryText = retryResult.text || '';
            logger.info(`[Engineering-BG] ✅ Retry (full PDF) respondeu (${retryText.length} chars)`);

            const retryNormalized = parseAndNormalizeEngineeringExtraction(retryText);
            const retryScreening = screenEngineeringItems(retryNormalized.engineeringItems);
            
            if (retryScreening.acceptedItems.length > 0) {
                engItems = retryScreening.acceptedItems;
                screening = retryScreening;
                targetingUsed = false; // Mark that full PDF was used
                const withCodes = engItems.filter((it: any) => it.code && it.sourceName && it.sourceName !== 'PROPRIA').length;
                logger.info(
                    `[Engineering-BG] ✅ Retry (full PDF) bem-sucedido — ${engItems.length} itens extraídos (${withCodes} com código oficial). ` +
                    `Page targeting havia falhado silenciosamente.`
                );
            } else {
                logger.warn(`[Engineering-BG] ⚠️ Retry (full PDF) também retornou 0 itens.`);
            }
        } catch (retryErr: any) {
            logger.warn(`[Engineering-BG] ⚠️ Retry (full PDF) falhou: ${retryErr.message}`);
        }
    }

    // TASK-05: Diagnóstico detalhado quando extração retorna 0 itens
    if (engItems.length === 0) {
        const diagnostics = {
            pdfsProcessed: rawPdfBuffers.length,
            pdfSources: rawPdfBuffers.map(p => ({
                source: p.source,
                sizeKB: Math.round(p.buffer.length / 1024),
            })),
            pageTargetingUsed: targetingUsed,
            zeroxFallbackUsed,
            modelUsed,
            possibleCauses: [] as string[],
            recommendation: '',
        };

        // Detectar causas prováveis — ordenadas por probabilidade
        const hasScannedPdf = zeroxFallbackCandidates.some(c => c.reason === 'scanned_pdf_no_text_layer');

        // Causa 1: Nenhum PDF disponível
        if (rawPdfBuffers.length === 0) {
            diagnostics.possibleCauses.push('Nenhum PDF disponível para extração');
            diagnostics.recommendation = 'Envie a planilha orçamentária manualmente usando o botão "Salvar Planilha".';
        }
        // Causa 2: PDFs muito pequenos
        else if (rawPdfBuffers.every(p => p.buffer.length < 50 * 1024)) {
            diagnostics.possibleCauses.push('Todos os PDFs são muito pequenos (<50KB) — podem não conter planilha orçamentária');
            diagnostics.recommendation = 'Envie a planilha orçamentária manualmente.';
        }
        // Causa 3: PDF escaneado (imagem)
        else if (hasScannedPdf) {
            diagnostics.possibleCauses.push(
                'PDF é escaneado (imagem sem texto pesquisável). ' +
                (zeroxFallbackUsed
                    ? 'OCR foi tentado mas não conseguiu extrair itens orçamentários'
                    : 'OCR não conseguiu processar o documento')
            );
            diagnostics.recommendation = 'Envie a planilha orçamentária em formato digital (não escaneado).';
        }
        // Causa 4: O documento principal é só o edital (sem anexo de planilha)
        // Detectar quando o único PDF disponível não contém dados orçamentários
        // FIX DOC-02: Só aciona este diagnóstico para PDFs pequenos (<500KB).
        // PDFs grandes (ex: 98 pgs) quase sempre têm a planilha embutida — o nome do arquivo é irrelevante.
        else if (rawPdfBuffers.length === 1) {
            const singleSource = rawPdfBuffers[0].source.toLowerCase();
            const singleSize = rawPdfBuffers[0].buffer.length;
            const isSmallEditalOnly = singleSize < 500 * 1024 && 
                /edital|minuta|licitac|aviso/i.test(singleSource) &&
                !/planilh|or[cç]ament|quantitat|composi[cç]/i.test(singleSource);
            if (isSmallEditalOnly) {
                diagnostics.possibleCauses.push(
                    `O único documento disponível é o edital (texto jurídico), sem planilha orçamentária anexa [Size: ${singleSize} bytes]. ` +
                    'O órgão não publicou os anexos de engenharia no PNCP.'
                );
            } else {
                diagnostics.possibleCauses.push(
                    'O documento analisado não contém planilha orçamentária com itens de engenharia.'
                );
            }
            diagnostics.recommendation = 'Envie a planilha orçamentária manualmente. Verifique se os anexos estão disponíveis no portal BLL/ComprasNet do órgão.';
        }
        // Causa 5: Múltiplos PDFs mas nenhum tem dados orçamentários
        else {
            if (targetingUsed && !zeroxFallbackUsed) {
                diagnostics.possibleCauses.push('Page targeting pode ter excluído páginas com a planilha');
            }
            if (!zeroxFallbackUsed && zeroxFallbackCandidates.length > 0 && !hasScannedPdf) {
                diagnostics.possibleCauses.push('PDF pode ser escaneado (imagem) — OCR Zerox não foi acionado');
            }
            diagnostics.recommendation = 'Envie a planilha orçamentária manualmente.';
        }

        // Fallback
        if (diagnostics.possibleCauses.length === 0) {
            diagnostics.possibleCauses.push(
                'Nenhum dos PDFs analisados contém planilha orçamentária estruturada com itens de engenharia.'
            );
            diagnostics.recommendation = 'Envie a planilha orçamentária manualmente usando o botão "Salvar Planilha".';
        }

        // Persistir diagnóstico no schemaV2 para o frontend ler
        try {
            await mergeEngineeringResults(biddingId, [], undefined, {
                ...diagnostics,
                status: 'empty_extraction',
                extractedAt: new Date().toISOString(),
            });
        } catch (persistErr: any) {
            logger.warn(`[Engineering-BG] ⚠️ Falha ao persistir diagnóstico: ${persistErr.message}`);
        }

        const causeText = diagnostics.possibleCauses.join('; ');
        const recText = diagnostics.recommendation || 'Tente enviar a planilha orçamentária manualmente.';
        throw new Error(
            `Nenhum item orçamentário encontrado em ${rawPdfBuffers.length} PDF(s). ` +
            `Diagnóstico: ${causeText}. ` +
            recText
        );
    }

    await updateJobProgress(job.id, tenantId, {
        progress: 80,
        progressMsg: `Enriquecendo ${engItems.length} itens com preços oficiais...`
    });

    // ── Step 3: Enrich with official prices (FIX-01: uses centralized priceEnricher with regime/date-base scoring) ──
    try {
        // Fetch engineeringConfig from the proposal (if exists) to respect regime/data-base
        let engineeringConfig: any = undefined;
        try {
            const proposal = proposalId
                ? await prisma.priceProposal.findFirst({
                    where: { id: proposalId, biddingProcessId: biddingId },
                    select: { engineeringConfig: true },
                })
                : await prisma.priceProposal.findFirst({
                    where: { biddingProcessId: biddingId },
                    select: { engineeringConfig: true },
                    orderBy: { updatedAt: 'desc' },
                });
            if (proposal?.engineeringConfig) {
                engineeringConfig = proposal.engineeringConfig;
            }
        } catch { /* no proposal yet — enrich without config */ }

        const enrichResult = await enrichWithOfficialPrices(engItems, engineeringConfig, { tenantId });
        logger.info(`[Engineering-BG] 🔍 Price audit: ${enrichResult.matched}/${enrichResult.total} itens matched against official DB`);
    } catch (err: any) {
        logger.warn(`[Engineering-BG] ⚠️ Enrichment partial: ${err.message}`);
    }

    // ── Step 3.5: Validate extraction quality ──
    await updateJobProgress(job.id, tenantId, {
        progress: 85,
        progressMsg: 'Validando qualidade da extração...'
    });

    // Fetch the estimated value from the bidding for reconciliation
    let estimatedValue: number | null = null;
    try {
        const biddingForValue = await prisma.biddingProcess.findUnique({
            where: { id: biddingId },
            select: { estimatedValue: true },
        });
        estimatedValue = biddingForValue?.estimatedValue || null;
    } catch { /* ignore */ }

    const validationReport = validateEngineeringExtraction(engItems, estimatedValue, screening || undefined, ocrRowCoverageMeta);

    if (scannedPdfOcrFailureWithoutSafeFallback) {
        validationReport.publishable = false;
        validationReport.qualityScore = Math.min(validationReport.qualityScore, 30);
        validationReport.issues.push({
            code: 'EV15',
            severity: 'error',
            message:
                `${scannedPdfCandidates.length} PDF(s) escaneado(s) ficaram sem OCR confiável. ` +
                `Publicação bloqueada para evitar extração parcial ou alucinada; envie planilha digital/Excel ou reative fallback visual apenas para teste controlado.`,
            affectedItems: scannedPdfCandidates.map(candidate => candidate.fileName),
        });
    }

    await updateJobProgress(job.id, tenantId, {
        progress: 90,
        progressMsg: validationReport.publishable
            ? `Validação OK (${validationReport.qualityScore}%) — Salvando resultados...`
            : `⚠️ Qualidade baixa (${validationReport.qualityScore}%) — Enviando para quarentena...`
    });

    // ── Step 4: Merge into schemaV2 (include validation report) ──
    await mergeEngineeringResults(biddingId, engItems, validationReport, {
        pageTargetingUsed: targetingUsed,
        zeroxFallbackUsed,
        zeroxFallback: zeroxFallbackMeta,
        pdfFingerprints: fingerprints.map(fp => ({
            scenario: fp.scenario,
            scenarioConfidence: fp.scenarioConfidence,
            scenarioReason: fp.scenarioReason,
            totalPages: fp.totalPages,
            textPages: fp.textPagesCount,
            scannedPages: fp.imagePagesCount,
            memCalcPages: fp.memCalcPagesCount,
            budgetScore: fp.budgetKeywordScore,
            estimatedItems: fp.estimatedItemCount,
            orientation: fp.dominantOrientation,
            durationMs: fp.durationMs,
        })),
        scannedVisualFallback: scannedPdfVisualBatches.length > 0 ? {
            batchCount: scannedPdfVisualBatches.length,
            pagesProcessed: scannedPdfVisualBatches.reduce((sum, batch) => sum + batch.pageCount, 0),
            files: Array.from(new Set(scannedPdfVisualBatches.map(batch => batch.fileName))).map(fileName => ({
                fileName,
                batchCount: scannedPdfVisualBatches.filter(batch => batch.fileName === fileName).length,
                pagesProcessed: scannedPdfVisualBatches
                    .filter(batch => batch.fileName === fileName)
                    .reduce((sum, batch) => sum + batch.pageCount, 0),
            })),
        } : null,
        scannedPdfOcrFailureWithoutSafeFallback,
        scannedPdfVisualFallbackEnabled,
        originalSizeKB: Math.round(totalOriginalKB),
        submittedSizeKB: Math.round(totalTrimmedKB),
        ocrRowCoverage: ocrRowCoverageMeta,
        status: validationReport.publishable ? 'published' : 'quality_quarantine',
    });

    const warningCount = validationReport.issues.filter(i => i.severity === 'warning' || i.severity === 'error').length;
    await updateJobProgress(job.id, tenantId, {
        progress: 100,
        progressMsg: validationReport.publishable
            ? `✅ ${engItems.length} itens extraídos (qualidade: ${validationReport.qualityScore}%${warningCount > 0 ? `, ${warningCount} alertas` : ''})`
            : `⚠️ ${engItems.length} itens extraídos, mas mantidos em quarentena (qualidade: ${validationReport.qualityScore}%${warningCount > 0 ? `, ${warningCount} alertas` : ''})`
    });

    // ── Step 5: Auto-benchmark (if this bidding matches a known case) ──
    let benchmarkResult: any = null;
    try {
        const biddingMeta = await prisma.biddingProcess.findUnique({
            where: { id: biddingId },
            include: { aiAnalysis: true },
        });
        const schemaV2 = biddingMeta?.aiAnalysis?.schemaV2 as any;
        const pncpRef = schemaV2?.pncp_source?.pncp_ref || null;
        if (pncpRef) {
            benchmarkResult = autoEvaluateIfBenchmarkCase(pncpRef, engItems, estimatedValue || undefined);
        }
    } catch { /* benchmark is optional, never blocks */ }

    const finalWithCodes = engItems.filter((it: any) => it.code && it.sourceName && it.sourceName !== 'PROPRIA').length;
    return {
        itemCount: engItems.length,
        withCodes: finalWithCodes,
        elapsed: ((Date.now() - t0) / 1000).toFixed(1),
        source: 'engineering_bg_extraction',
        published: validationReport.publishable,
        model: modelUsed,
        pageTargeting: targetingUsed,
        zeroxFallback: zeroxFallbackUsed ? zeroxFallbackMeta : null,
        scannedVisualFallback: scannedPdfVisualBatches.length > 0 ? {
            batchCount: scannedPdfVisualBatches.length,
            pagesProcessed: scannedPdfVisualBatches.reduce((sum, batch) => sum + batch.pageCount, 0),
        } : null,
        validation: {
            qualityScore: validationReport.qualityScore,
            publishable: validationReport.publishable,
            codeCoveragePercent: validationReport.codeCoveragePercent,
            totalDivergencePercent: validationReport.totalDivergencePercent,
            issueCount: validationReport.issues.length,
            rejectedItems: validationReport.rejectedItems?.length || 0,
        },
        ocrRowCoverage: ocrRowCoverageMeta ? {
            candidateCount: ocrRowCoverageMeta.candidateCount,
            consumedRowCount: ocrRowCoverageMeta.consumedRowCount,
            missingRowCount: ocrRowCoverageMeta.missingRowCount,
            coveragePercent: ocrRowCoverageMeta.coveragePercent,
            retryBatchCount: ocrRowCoverageMeta.retryBatchCount,
        } : null,
        benchmark: benchmarkResult ? {
            caseId: benchmarkResult.caseId,
            score: benchmarkResult.totalScore,
            details: benchmarkResult.details,
        } : null,
    };
}

/**
 * Merge engineering items into the saved schemaV2.
 */
async function mergeEngineeringResults(
    biddingId: string,
    engItems: any[],
    validationReport?: EngineeringValidationReport,
    extractionMeta?: Record<string, any>
): Promise<void> {
    const bidding = await prisma.biddingProcess.findUnique({
        where: { id: biddingId },
        include: { aiAnalysis: true }
    });

    if (!bidding?.aiAnalysis) {
        logger.warn(`[Engineering-BG] ⚠️ No aiAnalysis found for bidding ${biddingId}`);
        return;
    }

    const schemaV2 = (bidding.aiAnalysis.schemaV2 as any) || {};

    // 1. Store only publishable items for ai-populate. Low-quality extraction stays in quarantine.
    const publishable = validationReport ? validationReport.publishable : true;
    if (publishable) {
        schemaV2._engineeringBudgetItems = engItems;
        delete schemaV2._engineeringBudgetItemsQuarantine;
    } else {
        schemaV2._engineeringBudgetItems = [];
        schemaV2._engineeringBudgetItemsQuarantine = engItems;
    }

    // 1.5. Store validation report
    if (validationReport) {
        schemaV2._engineeringValidation = {
            qualityScore: validationReport.qualityScore,
            publishable: validationReport.publishable,
            codeCoveragePercent: validationReport.codeCoveragePercent,
            calculatedTotal: validationReport.calculatedTotal,
            totalDivergencePercent: validationReport.totalDivergencePercent,
            typeCounts: validationReport.typeCounts,
            issues: validationReport.issues,
            itemQuality: validationReport.itemQuality,
            rejectedItems: validationReport.rejectedItems,
            rowCoverage: validationReport.rowCoverage || null,
            validatedAt: new Date().toISOString(),
        };
    }

    if (extractionMeta) {
        schemaV2._engineeringExtractionMeta = {
            ...extractionMeta,
            extractedAt: new Date().toISOString(),
        };
    }

    if (!publishable) {
        if (extractionMeta) {
            schemaV2._engineeringExtractionMeta = {
                ...schemaV2._engineeringExtractionMeta,
                ...extractionMeta,
                status: 'quality_quarantine',
                extractedAt: new Date().toISOString(),
            };
        }

        await prisma.aiAnalysis.update({
            where: { id: bidding.aiAnalysis.id },
            data: { schemaV2 },
        });

        logger.warn(
            `[Engineering-BG] ⚠️ Quarantine: ${engItems.length} itens não publicados no schemaV2 ` +
            `(quality=${validationReport?.qualityScore ?? 'N/I'}%).`
        );
        return;
    }

    // 2. Convert to itens_licitados format (for the UI report)
    const itensLicitados = engItems.map((it: any) => ({
        itemNumber: it.item || '',
        sourceCode: (it.type === 'ETAPA' || it.type === 'SUBETAPA') ? '' : (it.code || ''),
        sourceBase: (it.type === 'ETAPA' || it.type === 'SUBETAPA') ? '' : (it.sourceName || ''),
        description: it.description || '',
        unit: (it.type === 'ETAPA' || it.type === 'SUBETAPA') ? '' : (it.unit || 'UN'),
        quantity: (it.type === 'ETAPA' || it.type === 'SUBETAPA') ? 0 : (Number(it.quantity) || 1),
        referencePrice: (it.type === 'ETAPA' || it.type === 'SUBETAPA') ? 0 : (Number(it.unitCost) || 0),
        unitPriceWithBdi: (it.type === 'ETAPA' || it.type === 'SUBETAPA') ? 0 : (Number(it.unitPrice) || 0),
        totalPrice: (it.type === 'ETAPA' || it.type === 'SUBETAPA') ? 0 : (Number(it.totalPrice) || 0),
        multiplier: 1,
        multiplierLabel: '',
        _engineeringType: it.type,
    }));

    if (!schemaV2.proposal_analysis) {
        schemaV2.proposal_analysis = {};
    }
    schemaV2.proposal_analysis.itens_licitados = itensLicitados;

    // 3. Also update the legacy biddingItems text field
    const biddingItemsText = itensLicitados
        .filter((it: any) => it.description)
        .map((it: any) =>
            `Item ${it.itemNumber || '?'}: ${it.description} | Unid: ${it.unit || 'UN'} | Qtd: ${it.quantity || 1} | Ref: R$ ${it.referencePrice || 0}`
        ).join('\n');

    // 4. Persist to database
    await prisma.aiAnalysis.update({
        where: { id: bidding.aiAnalysis.id },
        data: {
            schemaV2,
            biddingItems: biddingItemsText || bidding.aiAnalysis.biddingItems,
        }
    });

    const withCodes = engItems.filter((it: any) => it.code && it.sourceName !== 'PROPRIA').length;
    logger.info(
        `[Engineering-BG] ✅ Merge: ${engItems.length} itens salvos no schemaV2 (${withCodes} com código oficial)` +
        (validationReport ? ` | Quality: ${validationReport.qualityScore}%` : '')
    );
}

// enrichWithOfficialPricesLocal removed — FIX-01: now uses centralized priceEnricher.ts
