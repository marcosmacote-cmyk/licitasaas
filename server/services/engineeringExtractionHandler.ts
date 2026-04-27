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

import { PrismaClient } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import { updateJobProgress } from './backgroundJobService';
import { logger } from '../lib/logger';

const prisma = new PrismaClient();

// Import the engineering prompt (same used by the old E1.5-A)
import { ENGINEERING_PROPOSAL_SYSTEM_PROMPT, ENGINEERING_PROPOSAL_USER_INSTRUCTION } from './ai/modules/prompts/engineeringPromptV1';

// Import shared utilities from the engineering routes
// We import the callGeminiWithRetry from gemini service
import { callGeminiWithRetry } from './ai/gemini.service';

/**
 * Main handler — registered as 'engineering_extraction' in the job worker.
 */
export async function engineeringExtractionHandler(job: any): Promise<any> {
    const { biddingId, pdfUrls } = job.input;
    const tenantId = job.tenantId;

    logger.info(`[Engineering-BG] 🏗️ Starting extraction for bidding ${biddingId} (${pdfUrls?.length || 0} PDF URLs)`);

    await updateJobProgress(job.id, tenantId, {
        progress: 10,
        progressMsg: 'Baixando planilha orçamentária do PNCP...'
    });

    // ── Step 1: Download PDFs ──
    const pdfParts: any[] = [];
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
            pdfParts.push({
                inlineData: { data: buf.toString('base64'), mimeType: 'application/pdf' }
            });
            logger.info(`[Engineering-BG] 📄 PDF downloaded (${(buf.length / 1024).toFixed(0)} KB) from ${url.substring(0, 80)}...`);
        } catch (err: any) {
            logger.warn(`[Engineering-BG] ⚠️ Failed to download PDF: ${err.message}`);
        }
    }

    // Fallback: if no PDFs from URLs, try to get from the bidding's PNCP attachments
    if (pdfParts.length === 0) {
        logger.info(`[Engineering-BG] 📄 No PDFs from URLs, trying PNCP attachments from DB...`);
        try {
            const bidding = await prisma.biddingProcess.findUnique({
                where: { id: biddingId },
                include: { aiAnalysis: true }
            });
            const schemaV2 = bidding?.aiAnalysis?.schemaV2 as any;
            const attachments = schemaV2?.pncp_source?.attachments || [];
            const planilhas = attachments.filter((a: any) =>
                a.ativo && a.url && (
                    a.purpose === 'planilha_orcamentaria' ||
                    a.purpose === 'composicao_custos' ||
                    a.purpose === 'anexo_geral'
                )
            );

            for (const att of planilhas.slice(0, 3)) { // Max 3 PDFs
                try {
                    const resp = await axios.get(att.url, {
                        responseType: 'arraybuffer',
                        httpsAgent: agent,
                        timeout: 60000,
                        maxContentLength: 50 * 1024 * 1024
                    } as any);
                    const buf = Buffer.from(resp.data as ArrayBuffer);
                    pdfParts.push({
                        inlineData: { data: buf.toString('base64'), mimeType: 'application/pdf' }
                    });
                    logger.info(`[Engineering-BG] 📄 PDF from attachments: "${att.titulo}" (${(buf.length / 1024).toFixed(0)} KB)`);
                } catch (err: any) {
                    logger.warn(`[Engineering-BG] ⚠️ Failed: ${err.message}`);
                }
            }
        } catch (err: any) {
            logger.warn(`[Engineering-BG] ⚠️ DB lookup failed: ${err.message}`);
        }
    }

    if (pdfParts.length === 0) {
        throw new Error('Nenhum PDF de planilha orçamentária disponível para extração');
    }

    await updateJobProgress(job.id, tenantId, {
        progress: 30,
        progressMsg: `Extraindo itens de ${pdfParts.length} PDF(s) via IA... (pode levar 3-5 min)`
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

    try {
        const result = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [...pdfParts, { text: ENGINEERING_PROPOSAL_USER_INSTRUCTION }] }],
            config: {
                systemInstruction: ENGINEERING_PROPOSAL_SYSTEM_PROMPT,
                temperature: 0.1,
                maxOutputTokens: 65536,
                responseMimeType: 'application/json'
            }
        }, 2, { tenantId, operation: 'analysis', metadata: { stage: 'engineering_bg_extraction' } });
        // 2 retries — this is a dedicated background job, can afford more retries

        clearInterval(progressTimer);

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const text = result.text || '';

        // Parse JSON
        let parsed: any;
        try {
            parsed = JSON.parse(text);
        } catch {
            // Try to extract JSON from markdown code blocks
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                parsed = JSON.parse(match[0]);
            } else {
                throw new Error('Resposta do Gemini não é JSON válido');
            }
        }

        engItems = parsed?.engineeringItems || [];
        const withCodes = engItems.filter((it: any) => it.code && it.sourceName && it.sourceName !== 'PROPRIA').length;
        const etapas = engItems.filter((it: any) => it.type === 'ETAPA').length;
        const composicoes = engItems.filter((it: any) => it.type === 'COMPOSICAO').length;

        logger.info(`[Engineering-BG] ✅ Extração em ${elapsed}s — ${engItems.length} itens (${etapas} etapas, ${composicoes} composições, ${withCodes} com código oficial)`);
    } catch (err: any) {
        clearInterval(progressTimer);
        logger.error(`[Engineering-BG] ❌ Gemini failed: ${err.message}`);
        throw new Error(`Extração de engenharia falhou: ${err.message}`);
    }

    if (engItems.length === 0) {
        throw new Error('Gemini não extraiu nenhum item da planilha');
    }

    await updateJobProgress(job.id, tenantId, {
        progress: 85,
        progressMsg: `Enriquecendo ${engItems.length} itens com preços oficiais...`
    });

    // ── Step 3: Enrich with official prices ──
    try {
        await enrichWithOfficialPricesLocal(engItems);
    } catch (err: any) {
        logger.warn(`[Engineering-BG] ⚠️ Enrichment partial: ${err.message}`);
    }

    await updateJobProgress(job.id, tenantId, {
        progress: 90,
        progressMsg: 'Salvando resultados na análise...'
    });

    // ── Step 4: Merge into schemaV2 ──
    await mergeEngineeringResults(biddingId, engItems);

    await updateJobProgress(job.id, tenantId, {
        progress: 100,
        progressMsg: `✅ ${engItems.length} itens extraídos com sucesso`
    });

    const withCodes = engItems.filter((it: any) => it.code && it.sourceName && it.sourceName !== 'PROPRIA').length;
    return {
        itemCount: engItems.length,
        withCodes,
        elapsed: ((Date.now() - t0) / 1000).toFixed(1),
        source: 'engineering_bg_extraction'
    };
}

/**
 * Merge engineering items into the saved schemaV2.
 */
async function mergeEngineeringResults(biddingId: string, engItems: any[]): Promise<void> {
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
    await prisma.aiAnalysisReport.update({
        where: { id: bidding.aiAnalysis.id },
        data: {
            schemaV2,
            biddingItems: biddingItemsText || bidding.aiAnalysis.biddingItems,
        }
    });

    const withCodes = engItems.filter((it: any) => it.code && it.sourceName !== 'PROPRIA').length;
    logger.info(`[Engineering-BG] ✅ Merge: ${engItems.length} itens salvos no schemaV2 (${withCodes} com código oficial)`);
}

/**
 * Local enrichment — same logic as engineering.ts enrichWithOfficialPrices
 * but self-contained to avoid circular imports.
 */
async function enrichWithOfficialPricesLocal(items: any[]): Promise<void> {
    const enrichable = items.filter(it =>
        it.type !== 'ETAPA' && it.type !== 'SUBETAPA' && it.code && it.code !== 'N/A'
    );
    if (enrichable.length === 0) return;

    const codes = enrichable.map(it => it.code);

    const [dbItems, dbComps] = await Promise.all([
        prisma.engineeringItem.findMany({
            where: { code: { in: codes, mode: 'insensitive' } },
            include: { database: { select: { name: true } } },
        }),
        prisma.engineeringComposition.findMany({
            where: { code: { in: codes, mode: 'insensitive' } },
            include: { database: { select: { name: true } } },
        }),
    ]);

    const itemMap = new Map(dbItems.map(di => [di.code.toLowerCase(), di]));
    const compMap = new Map(dbComps.map(dc => [dc.code.toLowerCase(), dc]));

    let matched = 0;
    for (const item of enrichable) {
        const codeLower = item.code.toLowerCase();
        const dbItem = itemMap.get(codeLower);
        if (dbItem) {
            item.unitCost = Number(dbItem.price) || item.unitCost || 0;
            item.sourceName = dbItem.database?.name || item.sourceName || 'OFICIAL';
            if (!item.unit || item.unit === 'UN') item.unit = dbItem.unit || item.unit;
            matched++;
            continue;
        }
        const dbComp = compMap.get(codeLower);
        if (dbComp) {
            item.unitCost = Number(dbComp.totalPrice) || item.unitCost || 0;
            item.sourceName = dbComp.database?.name || item.sourceName || 'OFICIAL';
            if (!item.unit || item.unit === 'UN') item.unit = dbComp.unit || item.unit;
            item.type = 'COMPOSICAO';
            matched++;
            continue;
        }
    }

    logger.info(`[Engineering-BG] 🔍 Enrichment: ${matched}/${enrichable.length} itens matched against official DB`);
}
