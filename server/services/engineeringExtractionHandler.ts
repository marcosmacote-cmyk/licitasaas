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

// Import the engineering prompt (same used by the old E1.5-A)
import { ENGINEERING_PROPOSAL_SYSTEM_PROMPT, ENGINEERING_PROPOSAL_USER_INSTRUCTION } from './ai/modules/prompts/engineeringPromptV1';

// Import shared utilities from the engineering routes
// We import the callGeminiWithRetry from gemini service
import { callGeminiWithRetry } from './ai/gemini.service';

/**
 * Main handler — registered as 'engineering_extraction' in the job worker.
 */
export async function engineeringExtractionHandler(job: any): Promise<any> {
    const { biddingId, pdfUrls, documentSelection } = job.input;
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
                                : apiClassified.all.filter(doc => doc.score > -20).slice(0, 4);

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

    for (const { buffer, source } of rawPdfBuffers) {
        totalOriginalKB += buffer.length / 1024;
        
        try {
            const targeting = await targetBudgetPages(buffer, {
                minScore: 8,
                maxPages: 40,
                contextPages: 1,
                minPagesForTargeting: 15,
            });

            if (targeting.strategy === 'targeted' && targeting.trimmedPdfBuffer) {
                // Use the trimmed PDF
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
            } else {
                // Targeting not applicable or failed — use full PDF
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
                logger.info(`[Engineering-BG] 📄 Using full PDF: "${source}" (${(buffer.length / 1024).toFixed(0)} KB, ${targeting.totalPages} pages)`);
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
                const zeroxResult = await extractMarkdownFromMultiplePdfs(
                    zeroxFallbackCandidates.map(candidate => ({
                        buffer: candidate.buffer,
                        fileName: candidate.fileName,
                    })),
                    {
                        concurrency: 2,
                        maintainFormat: true,
                        temperature: 0.1,
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
                    logger.info('[Engineering-BG] Zerox fallback não gerou markdown suficiente; mantendo apenas PDF inline.');
                }
            } else {
                logger.info('[Engineering-BG] Zerox fallback indisponível; mantendo apenas PDF inline.');
            }
        } catch (err: any) {
            logger.warn(`[Engineering-BG] ⚠️ Zerox fallback falhou: ${err.message}. Mantendo PDF inline.`);
        }
    }

    await updateJobProgress(job.id, tenantId, {
        progress: 25,
        progressMsg: `Extraindo itens de ${pdfParts.length} PDF(s) via IA...${targetingUsed ? ' (otimizado por Page Targeting)' : ''}${zeroxFallbackUsed ? ' (OCR de apoio)' : ''}`
    });

    // ── Step 2: Call Gemini with engineering prompt — NO TIMEOUT RACE ──
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const t0 = Date.now();

    // Progress ticker (update every 30s while Gemini works)
    let progressPercent = 30;
    const progressTimer = setInterval(async () => {
        progressPercent = Math.min(progressPercent + 5, 85);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
        await updateJobProgress(job.id, tenantId, {
            progress: progressPercent,
            progressMsg: `Extraindo planilha orçamentária... (${elapsed}s)`
        }).catch(() => {});
    }, 30000);

    let engItems: any[] = [];
    let screening: EngineeringItemScreeningResult | null = null;
    let modelUsed = 'gemini-2.5-flash';

    try {
        let text = '';
        const userInstruction = `${ENGINEERING_PROPOSAL_USER_INSTRUCTION}${ocrContext}`;

        // ── PRIMARY: Gemini 2.5 Flash (multimodal, reads PDF natively) ──
        try {
            const result = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: [...pdfParts, { text: userInstruction }] }],
                config: {
                    systemInstruction: ENGINEERING_PROPOSAL_SYSTEM_PROMPT,
                    temperature: 0.1,
                    maxOutputTokens: 65536,
                    responseMimeType: 'application/json'
                }
            }, 2, { tenantId, operation: 'analysis', metadata: { stage: 'engineering_bg_extraction' } });
            text = result.text || '';
            logger.info(`[Engineering-BG] ✅ Gemini respondeu (${text.length} chars)`);
        } catch (geminiErr: any) {
            // ── FALLBACK: DeepSeek V4 → gpt-4o-mini → gpt-4o ──
            logger.warn(`[Engineering-BG] ⚠️ Gemini falhou: ${geminiErr.message}. Tentando fallback DeepSeek/OpenAI...`);
            await updateJobProgress(job.id, tenantId, {
                progress: progressPercent,
                progressMsg: 'Gemini indisponível — usando modelo alternativo...'
            }).catch(() => {});

            const fallbackResult = await fallbackToOpenAiV2({
                systemPrompt: ENGINEERING_PROPOSAL_SYSTEM_PROMPT,
                userPrompt: userInstruction,
                pdfParts: ocrContext ? undefined : pdfParts,
                temperature: 0.1,
                maxTokens: 65536,
                stageName: 'Engineering BG Extraction'
            });
            text = fallbackResult.text;
            modelUsed = fallbackResult.model;
            logger.info(`[Engineering-BG] ✅ Fallback ${modelUsed} respondeu (${text.length} chars)`);
        }

        clearInterval(progressTimer);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

        const normalizedExtraction = parseAndNormalizeEngineeringExtraction(text);
        engItems = normalizedExtraction.engineeringItems;
        if (normalizedExtraction.repaired) {
            logger.info(
                `[Engineering-BG] 🛠️ Normalização da resposta aplicou ${normalizedExtraction.repairs.length} reparo(s): ` +
                normalizedExtraction.repairs.slice(0, 12).join(', ')
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

        logger.info(`[Engineering-BG] ✅ Extração em ${elapsed}s via ${modelUsed} — ${engItems.length}/${rawItemCount} itens aceitos (${etapas} etapas, ${composicoes} composições, ${withCodes} com código oficial)`);
    } catch (err: any) {
        clearInterval(progressTimer);
        logger.error(`[Engineering-BG] ❌ Extração falhou (todos modelos): ${err.message}`);
        throw new Error(`Extração de engenharia falhou: ${err.message}`);
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
        };

        // Detectar causas prováveis
        if (rawPdfBuffers.length === 0) {
            diagnostics.possibleCauses.push('Nenhum PDF disponível para extração');
        } else if (rawPdfBuffers.every(p => p.buffer.length < 50 * 1024)) {
            diagnostics.possibleCauses.push('Todos os PDFs são muito pequenos (<50KB) — podem não conter planilha orçamentária');
        }
        if (targetingUsed && !zeroxFallbackUsed) {
            diagnostics.possibleCauses.push('Page targeting pode ter excluído páginas com a planilha');
        }
        if (!zeroxFallbackUsed && zeroxFallbackCandidates.length > 0) {
            diagnostics.possibleCauses.push('PDF pode ser escaneado (imagem) — OCR Zerox não foi acionado');
        }
        if (diagnostics.possibleCauses.length === 0) {
            diagnostics.possibleCauses.push('PDFs analisados não parecem conter planilha orçamentária estruturada');
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
        throw new Error(
            `Nenhum item orçamentário encontrado em ${rawPdfBuffers.length} PDF(s). ` +
            `Diagnóstico: ${causeText}. ` +
            `Tente enviar a planilha orçamentária manualmente.`
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
            const proposal = await prisma.priceProposal.findFirst({
                where: { biddingProcessId: biddingId },
                select: { engineeringConfig: true },
                orderBy: { updatedAt: 'desc' },
            });
            if (proposal?.engineeringConfig) {
                engineeringConfig = proposal.engineeringConfig;
            }
        } catch { /* no proposal yet — enrich without config */ }

        const enrichResult = await enrichWithOfficialPrices(engItems, engineeringConfig);
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

    const validationReport = validateEngineeringExtraction(engItems, estimatedValue, screening || undefined);

    await updateJobProgress(job.id, tenantId, {
        progress: 90,
        progressMsg: validationReport.publishable
            ? `Validação OK (${validationReport.qualityScore}%) — Salvando resultados...`
            : `⚠️ Qualidade baixa (${validationReport.qualityScore}%) — Salvando com ressalvas...`
    });

    // ── Step 4: Merge into schemaV2 (include validation report) ──
    await mergeEngineeringResults(biddingId, engItems, validationReport, {
        pageTargetingUsed: targetingUsed,
        zeroxFallbackUsed,
        zeroxFallback: zeroxFallbackMeta,
        originalSizeKB: Math.round(totalOriginalKB),
        submittedSizeKB: Math.round(totalTrimmedKB),
    });

    const warningCount = validationReport.issues.filter(i => i.severity === 'warning' || i.severity === 'error').length;
    await updateJobProgress(job.id, tenantId, {
        progress: 100,
        progressMsg: `✅ ${engItems.length} itens extraídos (qualidade: ${validationReport.qualityScore}%${warningCount > 0 ? `, ${warningCount} alertas` : ''})`
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
        model: modelUsed,
        pageTargeting: targetingUsed,
        zeroxFallback: zeroxFallbackUsed ? zeroxFallbackMeta : null,
        validation: {
            qualityScore: validationReport.qualityScore,
            publishable: validationReport.publishable,
            codeCoveragePercent: validationReport.codeCoveragePercent,
            totalDivergencePercent: validationReport.totalDivergencePercent,
            issueCount: validationReport.issues.length,
            rejectedItems: validationReport.rejectedItems?.length || 0,
        },
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

    // 1. Store raw engineering items for ai-populate to use directly
    schemaV2._engineeringBudgetItems = engItems;

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
            validatedAt: new Date().toISOString(),
        };
    }

    if (extractionMeta) {
        schemaV2._engineeringExtractionMeta = {
            ...extractionMeta,
            extractedAt: new Date().toISOString(),
        };
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
