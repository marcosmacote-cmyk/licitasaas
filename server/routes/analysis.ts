// Type-safe extracted route module
/**
 * Auto-extracted route module from server/index.ts
 * Generated: 2026-04-13T00:46:29.485Z
 */
import express from 'express';
import { authenticateToken, requireAdmin, requireSuperAdmin } from '../middlewares/auth';
import { aiLimiter } from '../lib/security';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { handleApiError } from '../middlewares/errorHandler';

const router = express.Router();

import fs from 'fs';
import { createExtractorFromData } from 'node-unrar-js';
import { normalizeModality } from '../lib/biddingHelpers';
import path from 'path';
import { GoogleGenAI, createPartFromUri } from '@google/genai';
import { robustJsonParse, robustJsonParseDetailed } from '../services/ai/parser.service';
import { callGeminiWithRetry } from '../services/ai/gemini.service';
import { AnalysisSchemaV1, createEmptyAnalysisSchema } from '../services/ai/analysis-schema-v1';
import { fallbackToOpenAi, fallbackToOpenAiV2 } from '../services/ai/openai.service';
import { enforceSchema } from '../services/ai/schemaEnforcer';
import { executeRiskRules } from '../services/ai/riskRulesEngine';
import { evaluateAnalysisQuality, validateAnalysisCompleteness } from '../services/ai/analysisQualityEvaluator';
import { buildModuleContext, ModuleName } from '../services/ai/modules/moduleContextContracts';
import { CHAT_SYSTEM_PROMPT, CHAT_USER_INSTRUCTION } from '../services/ai/modules/prompts/chatPromptV2';
import { PETITION_SYSTEM_PROMPT, PETITION_USER_INSTRUCTION as PETITION_V2_USER_INSTRUCTION } from '../services/ai/modules/prompts/petitionPromptV2';
import { uploadDir } from '../services/files.service';
import { indexDocumentChunks, searchSimilarChunks } from '../services/ai/rag.service';
import { ANALYZE_EDITAL_SYSTEM_PROMPT, USER_ANALYSIS_INSTRUCTION, V2_EXTRACTION_PROMPT, V2_NORMALIZATION_PROMPT, V2_RISK_REVIEW_PROMPT, V2_EXTRACTION_USER_INSTRUCTION, V2_NORMALIZATION_USER_INSTRUCTION, V2_RISK_REVIEW_USER_INSTRUCTION, V2_PROMPT_VERSION, getDomainRoutingInstruction, NORM_CATEGORIES, buildCategoryNormPrompt, buildCategoryNormUser, MANUAL_EXTRACTION_ADDON } from '../services/ai/prompt.service';
import { MASTER_PETITION_SYSTEM_PROMPT, PETITION_USER_INSTRUCTION } from '../services/ai/prompt.service';

// Bridge: Functions still in index.ts — will be extracted to services in next phase
// These are injected when the router is mounted
let getFileBufferSafe: (fileNameOrUrl: string, tenantId?: string) => Promise<Buffer | null>;
let fetchPdfPartsForProcess: (biddingProcessId: string | null, fileNamesRaw: string[], tenantId: string) => Promise<any[]>;
let registerSSEClient: any;
let removeSSEClient: any;
let submitJob: any;
let getJob: any;
let listJobs: any;
let recordAnalysisTelemetry: any;
let classifySafetyNets: any;
let formatAnalysisSummary: any;
let genAI: any;
let sseClients: Map<string, any>;

export function injectAnalysisDeps(deps: any) {
    getFileBufferSafe = deps.getFileBufferSafe;
    fetchPdfPartsForProcess = deps.fetchPdfPartsForProcess;
    registerSSEClient = deps.registerSSEClient;
    removeSSEClient = deps.removeSSEClient;
    submitJob = deps.submitJob;
    getJob = deps.getJob;
    listJobs = deps.listJobs;
    recordAnalysisTelemetry = deps.recordAnalysisTelemetry;
    classifySafetyNets = deps.classifySafetyNets;
    formatAnalysisSummary = deps.formatAnalysisSummary;
    genAI = deps.genAI;
    sseClients = deps.sseClients;
}

// AI Analysis Endpoint
router.post('/', authenticateToken, aiLimiter, async (req: any, res) => {
    try {
        const { fileNames } = req.body;
        if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
            return res.status(400).json({ error: 'fileNames array is required' });
        }

        let fullText = "";
        const pdfParts: any[] = [];

        // 1. Prepare files for Gemini (and verify tenant ownership)
        for (let fileNameSource of fileNames) {
            const fileName = decodeURIComponent(fileNameSource).split('?')[0];

            // Security: Verify if file belongs to tenant
            const doc = await prisma.document.findFirst({
                where: {
                    fileUrl: { contains: fileName },
                    tenantId: req.user.tenantId
                }
            });

            const belongsToTenant = doc || fileName.startsWith(`${req.user.tenantId}_`) || fileName.includes(`${req.user.tenantId}/`);

            if (!belongsToTenant) {
                logger.warn(`[AI] Unauthorized access attempt to file: ${fileName} by tenant: ${req.user.tenantId}`);
                continue;
            }

            const fileToFetch = doc ? doc.fileUrl : fileName;
            const pdfBuffer = await getFileBufferSafe(fileToFetch, req.user.tenantId);

            if (pdfBuffer) {
                logger.info(`[AI] Read file ${fileName} (${pdfBuffer.length} bytes)`);
                pdfParts.push({
                    inlineData: {
                        data: pdfBuffer.toString('base64'),
                        mimeType: 'application/pdf'
                    }
                });
            } else {
                logger.error(`[AI] Could not find file anywhere: ${fileName}`);
            }
        }

        if (pdfParts.length === 0) {
            logger.warn(`[AI] No valid files found for analysis among: ${fileNames.join(', ')}`);
            return res.status(400).json({
                error: 'Nenhum arquivo válido encontrado para análise no servidor.',
                details: `Foram processados ${fileNames.length} arquivos, mas nenhum pôde ser resgatado do armazenamento. Verifique se o bucket do Supabase está correto.`
            });
        }

        // 2. Setup Gemini AI
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            logger.error(`[AI] GEMINI_API_KEY is missing!`);
            return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in the backend' });
        }
        const ai = new GoogleGenAI({ apiKey });

        // 3. System Prompt & Strict JSON Schema Definition (Enhanced with precision rules)
        const systemInstruction = ANALYZE_EDITAL_SYSTEM_PROMPT;

        logger.info(`[AI] Calling Gemini API(${pdfParts.length} PDF parts)...`);
        let response: any;
        const startTime = Date.now();

        try {
            response = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [
                    {
                        role: 'user',
                        parts: [
                            ...pdfParts,
                            { text: USER_ANALYSIS_INSTRUCTION }
                        ]
                    }
                ],
                config: {
                    systemInstruction,
                    temperature: 0.1,
                    maxOutputTokens: 32768,
                    responseMimeType: 'application/json'
                }
            }, 3, { tenantId: req.user.tenantId, operation: 'oracle_analysis' });
        } catch (geminiError: any) {
            logger.warn(`[AI] Gemini falhou: ${geminiError.message}. Realizando Fallback automático para OpenAI (gpt-4o-mini)...`);
            try {
                response = await fallbackToOpenAi(pdfParts, systemInstruction, USER_ANALYSIS_INSTRUCTION);
            } catch (openAiError: any) {
                logger.error(`[AI] Fallback via OpenAI também falhou: ${openAiError.message}`);
                throw new Error(`As duas IAs falharam. Gemini: ${geminiError.message} | OpenAI: ${openAiError.message}`);
            }
        }
        const duration = (Date.now() - startTime) / 1000;
        logger.info(`[AI] Gemini responded in ${duration.toFixed(1)} s`);

        const rawText = response.text;
        if (!rawText) {
            logger.error(`[AI] Empty response text from Gemini.`);
            throw new Error("A IA não retornou nenhum texto.");
        }

        logger.info(`[AI] Raw response length: ${rawText.length} `);

        // ---- Robust JSON extraction and repair ----
        const finalPayload = robustJsonParse(rawText, 'AI-Edital');

        logger.info(`[AI] Successfully parsed JSON. Top-level keys: ${Object.keys(finalPayload).join(', ')}`);
        if (finalPayload.process) {
            logger.info(`[AI] process keys: ${Object.keys(finalPayload.process).join(', ')}`);
        }
        if (finalPayload.analysis) {
            logger.info(`[AI] analysis keys: ${Object.keys(finalPayload.analysis).join(', ')}`);
        }
        res.json(finalPayload);

    } catch (error: any) {
        logger.error("AI Analysis Error (FULL):", JSON.stringify({ message: error?.message, status: error?.status, code: error?.code, stack: error?.stack?.substring(0, 500) }));
        const logMsg = `[${new Date().toISOString()}] AI Error: ${error?.message || String(error)}\nStatus: ${error?.status}\nCode: ${error?.code}\nStack: ${error?.stack || 'No stack'}\n\n`;
        fs.appendFileSync(path.join(uploadDir, 'debug-analysis.log'), logMsg);

        // Return the REAL error message for debugging
        const realError = error?.message || String(error);
        res.status(500).json({ error: `Erro na IA: ${realError}` });
    }
});

// ══════════════════════════════════════════════════════════════════════════
// V2 — Análise de Edital em Pipeline (3 Etapas)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Gera contexto textual estruturado a partir do schemaV2 para consumo
 * por módulos downstream (Chat, Petições, Oráculo, Dossiê, Declarações, Proposta).
 * 
 * @param schema - O objeto AnalysisSchemaV1 (ou JSON equivalente)
 * @param focus  - Opcional: foco do contexto para reduzir tokens
 */
function buildSchemaV2Context(schema: any, focus?: 'full' | 'chat' | 'petition' | 'oracle' | 'dossier' | 'proposal' | 'declaration'): string {
    if (!schema) return '';
    const f = focus || 'full';
    const sections: string[] = [];

    // ── Identificação (sempre incluso) ──
    const pid = schema.process_identification || {};
    sections.push(`══ IDENTIFICAÇÃO DO PROCESSO ══
Órgão: ${pid.orgao || 'N/A'}
Edital: ${pid.numero_edital || 'N/A'} | Processo: ${pid.numero_processo || 'N/A'}
Modalidade: ${pid.modalidade || 'N/A'} | Critério: ${pid.criterio_julgamento || 'N/A'}
Objeto: ${pid.objeto_completo || pid.objeto_resumido || 'N/A'}
Tipo: ${pid.tipo_objeto || 'N/A'} | Município/UF: ${pid.municipio_uf || 'N/A'}`);

    // ── Timeline (chat, petition, full) ──
    if (['full', 'chat', 'petition'].includes(f)) {
        const tl = schema.timeline || {};
        sections.push(`══ PRAZOS E DATAS ══
Sessão: ${tl.data_sessao || 'N/A'}
Publicação: ${tl.data_publicacao || 'N/A'}
Impugnação: ${tl.prazo_impugnacao || 'N/A'}
Esclarecimento: ${tl.prazo_esclarecimento || 'N/A'}
Proposta: ${tl.prazo_envio_proposta || 'N/A'}
Recurso: ${tl.prazo_recurso || 'N/A'}`);
    }

    // ── Condições de Participação (chat, petition, declaration, full) ──
    if (['full', 'chat', 'petition', 'declaration'].includes(f)) {
        const pc = schema.participation_conditions || {};
        sections.push(`══ CONDIÇÕES DE PARTICIPAÇÃO ══
Consórcio: ${pc.permite_consorcio === null ? 'Não informado' : pc.permite_consorcio ? 'SIM' : 'NÃO'}
Subcontratação: ${pc.permite_subcontratacao === null ? 'Não informado' : pc.permite_subcontratacao ? 'SIM' : 'NÃO'}
Visita Técnica: ${pc.exige_visita_tecnica === null ? 'Não informado' : pc.exige_visita_tecnica ? 'SIM' : 'NÃO'}${pc.visita_tecnica_detalhes ? ' — ' + pc.visita_tecnica_detalhes : ''}
Garantia Proposta: ${pc.exige_garantia_proposta ? 'SIM — ' + pc.garantia_proposta_detalhes : 'NÃO'}
Garantia Contratual: ${pc.exige_garantia_contratual ? 'SIM — ' + pc.garantia_contratual_detalhes : 'NÃO'}
Tratamento ME/EPP: ${pc.tratamento_me_epp || 'N/A'}`);
    }

    // ── Exigências de Habilitação (chat, dossier, oracle, declaration, full) ──
    if (['full', 'chat', 'dossier', 'oracle', 'declaration'].includes(f)) {
        const reqs = schema.requirements || {};
        const reqSections = [
            ['Habilitação Jurídica', reqs.habilitacao_juridica],
            ['Regularidade Fiscal/Trabalhista', reqs.regularidade_fiscal_trabalhista],
            ['Qualificação Econômico-Financeira', reqs.qualificacao_economico_financeira],
            ['Qualificação Técnica Operacional', reqs.qualificacao_tecnica_operacional],
            ['Qualificação Técnica Profissional', reqs.qualificacao_tecnica_profissional],
            ['Proposta Comercial', reqs.proposta_comercial],
            ['Documentos Complementares', reqs.documentos_complementares],
        ];
        let reqText = '══ EXIGÊNCIAS DE HABILITAÇÃO ══\n';
        for (const [cat, items] of reqSections) {
            if (Array.isArray(items) && items.length > 0) {
                reqText += `\n▸ ${cat}:\n`;
                for (const r of items) {
                    const oblLabel = r.obligation_type || (r.mandatory ? 'obrigatória' : 'opcional');
                    const srcLabel = r.source_ref ? ` — 📄 ${r.source_ref}` : '';
                    reqText += `  [${r.requirement_id}] ${r.title}: ${r.description} (${oblLabel})${srcLabel}\n`;
                }
            }
        }
        sections.push(reqText);
    }

    // ── Análise Técnica (oracle, dossier, full) ──
    if (['full', 'oracle', 'dossier', 'chat'].includes(f)) {
        const ta = schema.technical_analysis || {};
        let taText = '══ ANÁLISE TÉCNICA ══\n';
        taText += `Atestado Capacidade Técnica: ${ta.exige_atestado_capacidade_tecnica ? 'SIM' : 'NÃO/N.I.'}\n`;
        if (ta.parcelas_relevantes?.length > 0) {
            taText += 'Parcelas Relevantes:\n';
            for (const p of ta.parcelas_relevantes) {
                taText += `  • ${p.item}: ${p.descricao} (mín: ${p.quantitativo_minimo} ${p.unidade})\n`;
            }
        }
        sections.push(taText);
    }

    // ── Econômico-Financeira (chat, proposal, full) ──
    if (['full', 'chat', 'proposal'].includes(f)) {
        const ef = schema.economic_financial_analysis || {};
        let efText = '══ ANÁLISE ECONÔMICO-FINANCEIRA ══\n';
        if (ef.indices_exigidos?.length > 0) {
            for (const idx of ef.indices_exigidos) {
                efText += `  • ${idx.indice}: ${idx.formula_ou_descricao} (mín: ${idx.valor_minimo})\n`;
            }
        }
        if (ef.patrimonio_liquido_minimo) efText += `Patrimônio Líquido Mínimo: ${ef.patrimonio_liquido_minimo}\n`;
        if (ef.capital_social_minimo) efText += `Capital Social Mínimo: ${ef.capital_social_minimo}\n`;
        sections.push(efText);
    }

    // ── Proposta (proposal, chat, full) ──
    if (['full', 'chat', 'proposal'].includes(f)) {
        const pa = schema.proposal_analysis || {};
        let paText = '══ ANÁLISE DA PROPOSTA ══\n';
        paText += `Planilha Orçamentária: ${pa.exige_planilha_orcamentaria ? 'SIM' : 'NÃO/N.I.'}\n`;
        paText += `Carta Proposta: ${pa.exige_carta_proposta ? 'SIM' : 'NÃO/N.I.'}\n`;
        paText += `Composição BDI: ${pa.exige_composicao_bdi ? 'SIM' : 'NÃO/N.I.'}\n`;
        if (pa.criterios_desclassificacao_proposta?.length > 0) {
            paText += 'Critérios de Desclassificação:\n';
            pa.criterios_desclassificacao_proposta.forEach((c: string) => paText += `  ⚠️ ${c}\n`);
        }
        sections.push(paText);
    }

    // ── Riscos Críticos (petition, chat, full) ──
    if (['full', 'chat', 'petition'].includes(f)) {
        const rr = schema.legal_risk_review || {};
        if (rr.critical_points?.length > 0) {
            let rrText = '══ PONTOS CRÍTICOS E RISCOS ══\n';
            for (const cp of rr.critical_points) {
                rrText += `  🔴 [${cp.severity?.toUpperCase()}] ${cp.title}\n`;
                rrText += `     ${cp.description}\n`;
                rrText += `     ➜ Ação: ${cp.recommended_action}\n`;
            }
            sections.push(rrText);
        }
        if (rr.ambiguities?.length > 0) {
            sections.push('Ambiguidades:\n' + rr.ambiguities.map((a: string) => `  ⚠️ ${a}`).join('\n'));
        }
        if (rr.points_for_impugnation_or_clarification?.length > 0) {
            sections.push('Pontos para Impugnação/Esclarecimento:\n' +
                rr.points_for_impugnation_or_clarification.map((p: string) => `  📌 ${p}`).join('\n'));
        }
    }

    // ── Outputs Operacionais (dossier, declaration, full) ──
    if (['full', 'dossier', 'declaration'].includes(f)) {
        const oo = schema.operational_outputs || {};
        if (oo.documents_to_prepare?.length > 0) {
            let ooText = '══ DOCUMENTOS A PREPARAR ══\n';
            for (const doc of oo.documents_to_prepare) {
                ooText += `  📋 ${doc.document_name} [${doc.priority?.toUpperCase()}] — ${doc.responsible_area}\n`;
            }
            sections.push(ooText);
        }
    }

    // ── Confiança (sempre) ──
    const conf = schema.confidence || {};
    sections.push(`══ CONFIANÇA DA ANÁLISE ══
Nível: ${conf.overall_confidence || 'N/A'}${conf.score_percentage ? ` (${conf.score_percentage}%)` : ''}
Modelo: ${schema.analysis_meta?.model_used || 'N/A'}
Prompt: ${(schema.analysis_meta as any)?.prompt_version || 'N/A'}`);

    return sections.join('\n\n');
}


// ═══════════════════════════════════════════════════════════════════════════
// BACKGROUND JOBS API — Async AI operations with real-time notifications
// ═══════════════════════════════════════════════════════════════════════════

// ── SSE: Server-Sent Events stream for real-time notifications ──
router.get('/events/stream', authenticateToken, (req: any, res) => {
    const clientId = `sse_${req.user.id}_${Date.now()}`;

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx/Railway buffering
    });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId, timestamp: new Date().toISOString() })}\n\n`);

    // Register client
    registerSSEClient(clientId, req.user.id, req.user.tenantId, res);

    // Keep-alive ping every 30s
    const keepAlive = setInterval(() => {
        try {
            res.write(`: keepalive\n\n`);
        } catch {
            clearInterval(keepAlive);
        }
    }, 30000);

    // Cleanup on disconnect
    req.on('close', () => {
        clearInterval(keepAlive);
        removeSSEClient(clientId);
    });
});

// ── Submit a background job ──
router.post('/jobs/submit', authenticateToken, aiLimiter, async (req: any, res) => {
    try {
        const { type, input, targetId, targetTitle } = req.body;

        if (!type || !input) {
            return res.status(400).json({ error: 'type and input are required' });
        }

        const validTypes = ['edital_analysis', 'pncp_analysis', 'oracle', 'proposal_populate', 'petition', 'declaration'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
        }

        const result = await submitJob({
            tenantId: req.user.tenantId,
            userId: req.user.userId,
            type,
            input,
            targetId,
            targetTitle,
        });

        res.status(202).json({
            ok: true,
            jobId: result.jobId,
            message: 'Tarefa enviada para processamento em segundo plano.',
        });
    } catch (err: any) {
        handleApiError(res, err, 'job-submit');
    }
});

// ── Get job status ──
router.get('/jobs/:jobId', authenticateToken, async (req: any, res) => {
    try {
        const job = await getJob(req.params.jobId, req.user.tenantId);
        if (!job) return res.status(404).json({ error: 'Job not found' });

        res.json({
            id: job.id,
            type: job.type,
            status: job.status,
            progress: job.progress,
            progressMsg: job.progressMsg,
            error: job.error,
            input: job.input,
            targetId: job.targetId,
            targetTitle: job.targetTitle,
            createdAt: job.createdAt,
            completedAt: job.completedAt,
        });
    } catch (err: any) {
        res.status(500).json({ error: (err as Error)?.message || 'Erro interno' });
    }
});

// ── Get job result (only when COMPLETED) ──
router.get('/jobs/:jobId/result', authenticateToken, async (req: any, res) => {
    try {
        const job = await getJob(req.params.jobId, req.user.tenantId);
        if (!job) return res.status(404).json({ error: 'Job not found' });
        if (job.status !== 'COMPLETED') {
            return res.status(409).json({
                error: 'Job not completed yet',
                status: job.status,
                progress: job.progress,
            });
        }
        res.json({ ok: true, result: job.result });
    } catch (err: any) {
        res.status(500).json({ error: (err as Error)?.message || 'Erro interno' });
    }
});

// ── List recent jobs for current user ──
router.get('/jobs/', authenticateToken, async (req: any, res) => {
    try {
        const jobs = await listJobs(req.user.tenantId, req.user.id, 30);
        res.json(jobs);
    } catch (err: any) {
        res.status(500).json({ error: (err as Error)?.message || 'Erro interno' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY: Synchronous V2 Pipeline (preserved as fallback)
// ═══════════════════════════════════════════════════════════════════════════

router.post('/v2', authenticateToken, aiLimiter, async (req: any, res) => {
    const analysisStartTime = Date.now();
    const result = createEmptyAnalysisSchema();
    result.analysis_meta.analysis_id = `analysis_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    result.analysis_meta.generated_at = new Date().toISOString();

    try {
        const { fileNames, biddingProcessId } = req.body;
        if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
            return res.status(400).json({ error: 'fileNames array is required' });
        }

        // ── 1. Ingestão Documental (Etapa 0) ──
        const pdfParts: any[] = [];
        const sourceFiles: string[] = [];

        for (let fileNameSource of fileNames) {
            const fileName = decodeURIComponent(fileNameSource).split('?')[0];

            const doc = await prisma.document.findFirst({
                where: {
                    fileUrl: { contains: fileName },
                    tenantId: req.user.tenantId
                }
            });

            const belongsToTenant = doc || fileName.startsWith(`${req.user.tenantId}_`) || fileName.includes(`${req.user.tenantId}/`);
            if (!belongsToTenant) {
                logger.warn(`[AI-V2] Unauthorized access attempt to file: ${fileName}`);
                continue;
            }

            const fileToFetch = doc ? doc.fileUrl : fileName;
            const pdfBuffer = await getFileBufferSafe(fileToFetch, req.user.tenantId);

            if (pdfBuffer) {
                const magic = pdfBuffer.length >= 4 ? pdfBuffer.toString('hex', 0, 4) : '';
                const isPdf = fileName.toLowerCase().endsWith('.pdf') || magic.startsWith('25504446');
                const isZip = fileName.toLowerCase().endsWith('.zip') || magic.startsWith('504b0304');
                const isRar = fileName.toLowerCase().endsWith('.rar') || magic.startsWith('52617221');
                const MAX_PDF_PARTS = 15;

                if (isPdf) {
                    logger.info(`[AI-V2] Read PDF file ${fileName} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);
                    pdfParts.push({ inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' } });
                    sourceFiles.push(fileName);
                } else if (isZip) {
                    logger.info(`[AI-V2] 📦 ZIP detected: ${fileName} (${(pdfBuffer.length / 1024).toFixed(0)} KB) — extracting PDFs...`);
                    try {
                        const JSZip = require('jszip');
                        const zip = await JSZip.loadAsync(pdfBuffer);
                        let zipEntries = Object.keys(zip.files).filter((name: string) => !name.toLowerCase().endsWith('.pdf') || zip.files[name].dir ? false : !['comprovante','resumo'].some(pat => name.toLowerCase().includes(pat)));
                        for (const entryName of zipEntries) {
                            if (pdfParts.length >= MAX_PDF_PARTS) break;
                            const entryBuffer = await zip.files[entryName].async('nodebuffer');
                            if (entryBuffer.length > 0) {
                                pdfParts.push({ inlineData: { data: entryBuffer.toString('base64'), mimeType: 'application/pdf' } });
                                sourceFiles.push(`${fileName}/${entryName}`);
                                logger.info(`[AI-V2] ✅ Extracted PDF from ZIP: ${entryName} (${(entryBuffer.length / 1024).toFixed(0)} KB)`);
                            }
                        }
                    } catch (e: any) { logger.warn(`[AI-V2] Failed to extract ZIP ${fileName}: ${e.message}`); }
                } else if (isRar) {
                    logger.info(`[AI-V2] 📦 RAR detected: ${fileName} (${(pdfBuffer.length / 1024).toFixed(0)} KB) — extracting PDFs...`);
                    try {
                        const extractor = await createExtractorFromData({ data: new Uint8Array(pdfBuffer).buffer });
                        const extracted = extractor.extract({});
                        const files = [...extracted.files].filter(f => f.fileHeader.name.toLowerCase().endsWith('.pdf') && !f.fileHeader.flags.directory && f.extraction);
                        for (const rarFile of files) {
                            if (pdfParts.length >= MAX_PDF_PARTS) break;
                            if (rarFile.extraction && rarFile.extraction.length > 0) {
                                const entryBuffer = Buffer.from(rarFile.extraction);
                                pdfParts.push({ inlineData: { data: entryBuffer.toString('base64'), mimeType: 'application/pdf' } });
                                sourceFiles.push(`${fileName}/${rarFile.fileHeader.name}`);
                                logger.info(`[AI-V2] ✅ Extracted PDF from RAR: ${rarFile.fileHeader.name} (${(entryBuffer.length / 1024).toFixed(0)} KB)`);
                            }
                        }
                    } catch (e: any) { logger.warn(`[AI-V2] Failed to extract RAR ${fileName}: ${e.message}`); }
                } else {
                    logger.warn(`[AI-V2] ⏭️ Skipped non-PDF/ZIP/RAR: ${fileName} (magic: ${magic})`);
                }
            } else {
                logger.error(`[AI-V2] Could not find file: ${fileName}`);
            }
        }

        if (pdfParts.length === 0) {
            return res.status(400).json({ error: 'Nenhum arquivo válido encontrado para análise.' });
        }

        result.analysis_meta.source_files = sourceFiles;
        result.analysis_meta.source_type = 'upload_manual';

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' });
        }
        const ai = new GoogleGenAI({ apiKey });

        logger.info(`[AI-V2] ═══ PIPELINE INICIADO ═══ (${pdfParts.length} PDFs, ${sourceFiles.join(', ')})`);

        // ── 2. Etapa 1: Extração Factual ──
        logger.info(`[AI-V2] ── Etapa 1/3: Extração Factual...`);
        let extractionJson: any;
        const t1Start = Date.now();

        let modelsUsed: string[] = [];
        // Append manual-only extraction rules (valor, portal, data+hora) — NOT used by PNCP
        const manualUserInstruction = V2_EXTRACTION_USER_INSTRUCTION.replace('{domainReinforcement}', '') + MANUAL_EXTRACTION_ADDON;

        try {
            const extractionResponse = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{
                    role: 'user',
                    parts: [
                        ...pdfParts,
                        { text: manualUserInstruction }
                    ]
                }],
                config: {
                    systemInstruction: V2_EXTRACTION_PROMPT,
                    temperature: 0.05,
                    maxOutputTokens: 32768,
                    responseMimeType: 'application/json'
                }
            }, 5, { tenantId: req.user.tenantId, operation: 'analysis', metadata: { stage: 'raw_extraction' } });

            const extractionText = extractionResponse.text;
            if (!extractionText) throw new Error('Etapa 1 retornou vazio');

            extractionJson = robustJsonParse(extractionText, 'V2-Extraction');
            result.analysis_meta.workflow_stage_status.extraction = 'done';
            modelsUsed.push('gemini-2.5-flash');
            logger.info(`[AI-V2] ✅ Etapa 1 concluída em ${((Date.now() - t1Start) / 1000).toFixed(1)}s — ` +
                `${(extractionJson.evidence_registry || []).length} evidências, ` +
                `${Object.values(extractionJson.requirements || {}).flat().length} exigências`);

        } catch (err: any) {
            logger.warn(`[AI-V2] ⚠️ Etapa 1 Gemini falhou: ${err.message}. Tentando OpenAI...`);

            try {
                const openAiResult = await fallbackToOpenAiV2({
                    systemPrompt: V2_EXTRACTION_PROMPT,
                    userPrompt: manualUserInstruction,
                    pdfParts,
                    temperature: 0.05,
                    stageName: 'Etapa 1 (Extração)'
                });

                if (!openAiResult.text) throw new Error('OpenAI retornou vazio');

                extractionJson = robustJsonParse(openAiResult.text, 'V2-Extraction-OpenAI');
                result.analysis_meta.workflow_stage_status.extraction = 'done';
                modelsUsed.push(openAiResult.model);
                logger.info(`[AI-V2] ✅ Etapa 1 concluída via OpenAI em ${((Date.now() - t1Start) / 1000).toFixed(1)}s`);

            } catch (openAiErr: any) {
                logger.error(`[AI-V2] ❌ Etapa 1 falhou (Gemini + OpenAI): ${openAiErr.message}`);
                result.analysis_meta.workflow_stage_status.extraction = 'failed';
                result.confidence.warnings.push(`Etapa 1 (Extração) falhou em ambos os modelos: Gemini: ${err.message} | OpenAI: ${openAiErr.message}`);
                result.confidence.overall_confidence = 'baixa';
                result.analysis_meta.model_used = 'gemini-2.5-flash+openai-failed';
                return res.json({ schemaV2: result, partial: true, error: `Etapa 1 falhou` });
            }
        }

        // Merge extraction into result
        if (extractionJson.process_identification) result.process_identification = extractionJson.process_identification;
        if (extractionJson.timeline) result.timeline = extractionJson.timeline;
        if (extractionJson.participation_conditions) result.participation_conditions = extractionJson.participation_conditions;
        if (extractionJson.requirements) result.requirements = extractionJson.requirements;
        if (extractionJson.technical_analysis) result.technical_analysis = extractionJson.technical_analysis;
        if (extractionJson.economic_financial_analysis) result.economic_financial_analysis = extractionJson.economic_financial_analysis;
        if (extractionJson.proposal_analysis) result.proposal_analysis = extractionJson.proposal_analysis;
        if (extractionJson.contractual_analysis) result.contractual_analysis = extractionJson.contractual_analysis;
        if (extractionJson.evidence_registry) result.evidence_registry = extractionJson.evidence_registry;

        // ── 2.5. Domain Routing — Reforço por Tipo de Objeto ──
        const detectedObjectType = result.process_identification?.tipo_objeto || 'outro';
        const domainReinforcement = getDomainRoutingInstruction(detectedObjectType);
        if (domainReinforcement) {
            logger.info(`[AI-V2] 🎯 Roteamento por tipo: ${detectedObjectType} — reforço aplicado nas Etapas 2 e 3`);
        }

        // ── 3. Etapa 2: Normalização por Categoria (paralela) ──
        logger.info(`[AI-V2] ── Etapa 2/3: Normalização por Categoria...`);
        let normalizationJson: any = {};
        const t2Start = Date.now();

        try {
            const mergedRequirements: Record<string, any[]> = {};
            const mergedDocs: any[] = [];
            let totalNormalized = 0;
            let categoriesFailed = 0;

            const categoryTasks = NORM_CATEGORIES.map(cat => {
                const items = Array.isArray((extractionJson.requirements as any)?.[cat.key])
                    ? (extractionJson.requirements as any)[cat.key]
                    : [];

                if (items.length === 0) {
                    mergedRequirements[cat.key] = [];
                    return null;
                }

                // ── FAST-PATH: HJ, RFT, QEF — server-side normalization ──
                const FAST_NORM_CATS = ['habilitacao_juridica', 'regularidade_fiscal_trabalhista', 'qualificacao_economico_financeira'];
                if (FAST_NORM_CATS.includes(cat.key)) {
                    const normalized = items.map((item: any, idx: number) => ({
                        ...item,
                        requirement_id: item.requirement_id || `${cat.prefix}-${String(idx + 1).padStart(2, '0')}`,
                        entry_type: item.entry_type || 'exigencia_principal',
                        risk_if_missing: item.risk_if_missing || 'inabilitacao',
                        applies_to: item.applies_to || 'licitante',
                        obligation_type: item.obligation_type || 'obrigatoria_universal',
                        phase: item.phase || 'habilitacao',
                        source_ref: item.source_ref || 'referência não localizada',
                    }));
                    mergedRequirements[cat.key] = normalized;
                    totalNormalized += normalized.length;
                    normalized.filter((n: any) => n.entry_type === 'exigencia_principal').forEach((n: any) => {
                        mergedDocs.push({
                            document_name: n.title || n.requirement_id,
                            category: cat.key,
                            priority: 'critica',
                            responsible_area: cat.key === 'habilitacao_juridica' ? 'juridico' : 'contabil',
                            notes: ''
                        });
                    });
                    logger.info(`[AI-V2] ⚡ FastNorm ${cat.prefix}: ${normalized.length} itens (server-side)`);
                    return { success: true, fastPath: true };
                }

                // ── AI normalization for QTO, QTP, PC, DC ──
                return (async () => {
                    const systemPrompt = buildCategoryNormPrompt(cat);
                    const userPrompt = buildCategoryNormUser(cat, items);

                    try {
                        const resp = await callGeminiWithRetry(ai.models, {
                            model: 'gemini-2.5-flash',
                            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                            config: {
                                systemInstruction: systemPrompt,
                                temperature: 0.1,
                                maxOutputTokens: 16384,
                                responseMimeType: 'application/json'
                            }
                        }, 1, { tenantId: req.user.tenantId, operation: 'analysis', metadata: { stage: `normalization-${cat.key}` } });
                        const text = resp.text;
                        if (!text) throw new Error(`${cat.prefix} vazio`);
                        const data = robustJsonParse(text, `Norm-${cat.prefix}`);
                        if (Array.isArray(data.items) && data.items.length > 0) {
                            mergedRequirements[cat.key] = data.items;
                            totalNormalized += data.items.length;
                        } else {
                            mergedRequirements[cat.key] = items;
                            totalNormalized += items.length;
                        }
                        if (Array.isArray(data.documents_to_prepare)) mergedDocs.push(...data.documents_to_prepare);
                        return { success: true };
                    } catch (gErr: any) {
                        logger.warn(`[AI-V2] ⚠️ Norm ${cat.prefix} Gemini falhou. Fallback OpenAI...`);
                        try {
                            const oai = await fallbackToOpenAiV2({ systemPrompt, userPrompt, temperature: 0.1, stageName: `Norm-${cat.prefix}` });
                            if (!oai.text) throw new Error('OpenAI vazio');
                            const data = robustJsonParse(oai.text, `Norm-${cat.prefix}-OAI`);
                            if (Array.isArray(data.items) && data.items.length > 0) {
                                mergedRequirements[cat.key] = data.items;
                                totalNormalized += data.items.length;
                            } else {
                                mergedRequirements[cat.key] = items;
                                totalNormalized += items.length;
                            }
                            if (Array.isArray(data.documents_to_prepare)) mergedDocs.push(...data.documents_to_prepare);
                            modelsUsed.push('gpt-4o-mini');
                            return { success: true };
                        } catch {
                            mergedRequirements[cat.key] = items;
                            totalNormalized += items.length;
                            categoriesFailed++;
                            return { success: false };
                        }
                    }
                })();
            }).filter(Boolean);

            await Promise.allSettled(categoryTasks as Promise<any>[]);

            normalizationJson = {
                requirements_normalized: mergedRequirements,
                operational_outputs: { documents_to_prepare: mergedDocs },
            };
            result.analysis_meta.workflow_stage_status.normalization = 'done';
            modelsUsed.push('gemini-2.5-flash');
            logger.info(`[AI-V2] ✅ Etapa 2 em ${((Date.now() - t2Start) / 1000).toFixed(1)}s — ${totalNormalized} itens, ${categoriesFailed} falhas`);

            if (categoriesFailed > 0) {
                result.confidence.warnings.push(`${categoriesFailed} categoria(s) não normalizada(s)`);
            }
        } catch (err: any) {
            logger.error(`[AI-V2] ❌ Etapa 2 falhou: ${err.message}`);
            result.analysis_meta.workflow_stage_status.normalization = 'failed';
            result.confidence.warnings.push(`Etapa 2 falhou: ${err.message}`);
        }

        // Merge normalization — requirements normalizados sobrescrevem os da extração
        if (normalizationJson.requirements_normalized) {
            result.requirements = normalizationJson.requirements_normalized;
        }
        if (normalizationJson.operational_outputs) {
            result.operational_outputs = { ...result.operational_outputs, ...normalizationJson.operational_outputs };
        }
        if (normalizationJson.confidence) {
            result.confidence = { ...result.confidence, ...normalizationJson.confidence };
        }

        // ── 4. Etapa 3: Revisão de Risco ──
        logger.info(`[AI-V2] ── Etapa 3/3: Revisão de Risco...`);
        const t3Start = Date.now();

        try {
            const riskUserInstruction = V2_RISK_REVIEW_USER_INSTRUCTION
                .replace('{extractionJson}', JSON.stringify(extractionJson, null, 2))
                .replace('{normalizationJson}', JSON.stringify(normalizationJson, null, 2))
                + (domainReinforcement ? `\n\n${domainReinforcement}` : '');

            const riskResponse = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{
                    role: 'user',
                    parts: [{ text: riskUserInstruction }]
                }],
                config: {
                    systemInstruction: V2_RISK_REVIEW_PROMPT,
                    temperature: 0.2,
                    maxOutputTokens: 16384,
                    responseMimeType: 'application/json'
                }
            }, 4, { tenantId: req.user.tenantId, operation: 'analysis', metadata: { stage: 'raw_risk_review' } });

            const riskText = riskResponse.text;
            if (!riskText) throw new Error('Etapa 3 retornou vazio');

            const riskJson = robustJsonParse(riskText, 'V2-RiskReview');
            result.analysis_meta.workflow_stage_status.risk_review = 'done';
            modelsUsed.push('gemini-2.5-flash');
            logger.info(`[AI-V2] ✅ Etapa 3 concluída em ${((Date.now() - t3Start) / 1000).toFixed(1)}s — ` +
                `${(riskJson.legal_risk_review?.critical_points || []).length} pontos críticos`);

            // Merge risk review
            if (riskJson.legal_risk_review) {
                result.legal_risk_review = riskJson.legal_risk_review;
            }
            if (riskJson.operational_outputs_risk) {
                if (riskJson.operational_outputs_risk.questions_for_consultor_chat) {
                    result.operational_outputs.questions_for_consultor_chat = riskJson.operational_outputs_risk.questions_for_consultor_chat;
                }
                if (riskJson.operational_outputs_risk.possible_petition_routes) {
                    result.operational_outputs.possible_petition_routes = riskJson.operational_outputs_risk.possible_petition_routes;
                }
            }
            if (riskJson.confidence_update) {
                result.confidence.section_confidence.risk_review = riskJson.confidence_update.risk_review || 'media';
            }

        } catch (err: any) {
            logger.warn(`[AI-V2] ⚠️ Etapa 3 Gemini falhou: ${err.message}. Tentando OpenAI...`);

            try {
                const riskUserInstruction = V2_RISK_REVIEW_USER_INSTRUCTION
                    .replace('{extractionJson}', JSON.stringify(extractionJson, null, 2))
                    .replace('{normalizationJson}', JSON.stringify(normalizationJson, null, 2))
                    + (domainReinforcement ? `\n\n${domainReinforcement}` : '');

                const openAiResult = await fallbackToOpenAiV2({
                    systemPrompt: V2_RISK_REVIEW_PROMPT,
                    userPrompt: riskUserInstruction,
                    temperature: 0.2,
                    stageName: 'Etapa 3 (Risco)'
                });

                if (!openAiResult.text) throw new Error('OpenAI retornou vazio');

                const riskJson = robustJsonParse(openAiResult.text, 'V2-RiskReview-OpenAI');
                result.analysis_meta.workflow_stage_status.risk_review = 'done';
                modelsUsed.push(openAiResult.model);
                logger.info(`[AI-V2] ✅ Etapa 3 concluída via OpenAI em ${((Date.now() - t3Start) / 1000).toFixed(1)}s`);

                if (riskJson.legal_risk_review) result.legal_risk_review = riskJson.legal_risk_review;
                if (riskJson.operational_outputs_risk) {
                    if (riskJson.operational_outputs_risk.questions_for_consultor_chat) {
                        result.operational_outputs.questions_for_consultor_chat = riskJson.operational_outputs_risk.questions_for_consultor_chat;
                    }
                    if (riskJson.operational_outputs_risk.possible_petition_routes) {
                        result.operational_outputs.possible_petition_routes = riskJson.operational_outputs_risk.possible_petition_routes;
                    }
                }
                if (riskJson.confidence_update) {
                    result.confidence.section_confidence.risk_review = riskJson.confidence_update.risk_review || 'media';
                }

            } catch (openAiErr: any) {
                logger.error(`[AI-V2] ❌ Etapa 3 falhou (Gemini + OpenAI): ${openAiErr.message}`);
                result.analysis_meta.workflow_stage_status.risk_review = 'failed';
                result.confidence.warnings.push(`Etapa 3 (Risco) falhou: Gemini: ${err.message} | OpenAI: ${openAiErr.message}`);
            }
        }

        // ── Schema Enforcement (Level 1, 2, 3) ──
        const enforceResult = enforceSchema(result);
        if (enforceResult.corrections > 0) {
            result.confidence.warnings.push(
                `SchemaEnforcer: ${enforceResult.corrections} campo(s) padronizado(s) automaticamente`
            );
            (result.analysis_meta as any).schema_enforcer = {
                corrections: enforceResult.corrections,
                details: enforceResult.details.slice(0, 20),
            };
        }

        // ── 5. Validação Automática (sem IA) ──
        const validation = validateAnalysisCompleteness(result);
        result.analysis_meta.workflow_stage_status.validation = validation.valid ? 'done' : 'failed';
        if (validation.issues.length > 0) {
            result.confidence.warnings.push(...validation.issues);
            logger.info(`[AI-V2] ⚠️ Validação: ${validation.confidence_score}% (${validation.issues.length} problemas: ${validation.issues.join('; ')})`);
        } else {
            logger.info(`[AI-V2] ✅ Validação: ${validation.confidence_score}% — todas as checagens passaram`);
        }

        // ── 5.5. Motor de Regras de Domínio ──
        let ruleFindings: any[] = [];
        try {
            ruleFindings = executeRiskRules(result);
            if (ruleFindings.length > 0) {
                (result.analysis_meta as any).rule_findings = ruleFindings;
                const criticalFindings = ruleFindings.filter(f => f.severity === 'critical' || f.severity === 'high');
                if (criticalFindings.length > 0) {
                    result.confidence.warnings.push(`Motor de regras: ${criticalFindings.length} findings críticos/altos`);
                }
            }
            logger.info(`[AI-V2] 🔧 Motor de Regras: ${ruleFindings.length} findings`);
        } catch (ruleErr: any) {
            logger.warn(`[AI-V2] ⚠️ Motor de regras falhou: ${ruleErr.message}`);
        }

        // ── 5.6. Avaliador de Qualidade ──
        let qualityReport: any = null;
        try {
            qualityReport = evaluateAnalysisQuality(result, ruleFindings, result.analysis_meta.analysis_id);
            (result.analysis_meta as any).quality_report = {
                overallScore: qualityReport.overallScore,
                categoryScores: qualityReport.categoryScores,
                issueCount: qualityReport.issues.length,
                summary: qualityReport.summary
            };
            logger.info(`[AI-V2] 📊 Qualidade: ${qualityReport.overallScore}% | ${qualityReport.summary}`);
        } catch (qualErr: any) {
            logger.warn(`[AI-V2] ⚠️ Avaliador de qualidade falhou: ${qualErr.message}`);
        }

        // ── 6. Confidence Score Final V2.5 (calibrado para refletir precisão real) ──
        // Rebalanceado: stages 30% + validation 25% + quality 25% + bônus excelência 20%
        const stagesDone = Object.values(result.analysis_meta.workflow_stage_status).filter(s => s === 'done').length;
        const stagesTotal = 4;
        const stageScore = (stagesDone / stagesTotal) * 100;
        const qualityScore = qualityReport?.overallScore || 50;
        let combinedScore = Math.round((stageScore * 0.30) + (validation.confidence_score * 0.25) + (qualityScore * 0.25));

        // Traceability assessment
        const allReqArrays = Object.values(result.requirements || {}).flat() as any[];
        const principalReqs = allReqArrays.filter((r: any) => !r.entry_type || r.entry_type === 'exigencia_principal');
        const reqCount = principalReqs.length;
        const tracedCount = principalReqs.filter((r: any) => r.source_ref && r.source_ref !== 'referência não localizada' && r.source_ref.trim() !== '').length;
        const traceabilityRatio = reqCount > 0 ? tracedCount / reqCount : 0;

        // Bônus de excelência: análises ricas recebem até 20% extra
        if (reqCount >= 20 && traceabilityRatio >= 0.7) {
            combinedScore += 20;
        } else if (reqCount >= 10 && traceabilityRatio >= 0.5) {
            combinedScore += 15;
        } else if (reqCount >= 5) {
            combinedScore += 10;
        }

        // Traceability penalty (suavizada)
        if (traceabilityRatio < 0.3 && reqCount > 5) {
            combinedScore -= 5;
        }

        // Floor: análises com todas as stages concluídas nunca ficam abaixo de 80%
        const stagesFailed = Object.values(result.analysis_meta.workflow_stage_status).filter(s => s === 'failed').length;
        const allStagesOk = stagesFailed === 0 && stagesDone === stagesTotal;
        const scoreFloor = allStagesOk ? 80 : 5;
        combinedScore = Math.max(scoreFloor, Math.min(100, combinedScore));

        // Confidence level V2.5 (flexibilizado)
        if (combinedScore >= 85 && traceabilityRatio >= 0.5) {
            result.confidence.overall_confidence = 'alta';
        } else if (combinedScore >= 70) {
            result.confidence.overall_confidence = 'alta';
        } else if (combinedScore >= 50) {
            result.confidence.overall_confidence = 'media';
        } else {
            result.confidence.overall_confidence = 'baixa';
        }
        (result.confidence as any).score_percentage = combinedScore;
        (result.confidence as any).traceability = {
            total_requirements: reqCount,
            traced_requirements: tracedCount,
            traceability_percentage: Math.round(traceabilityRatio * 100),
            evidence_registry_count: result.evidence_registry?.length || 0,
        };

        // Track all models used (deduped)
        const uniqueModels = [...new Set(modelsUsed)];
        result.analysis_meta.model_used = uniqueModels.join('+');
        (result.analysis_meta as any).prompt_version = V2_PROMPT_VERSION;
        (result.analysis_meta as any).models_per_stage = {
            extraction: modelsUsed[0] || 'failed',
            normalization: modelsUsed[1] || 'failed',
            risk_review: modelsUsed[2] || 'failed'
        };

        // ── 7. Indexação RAG ──
        if (biddingProcessId && pdfParts.length > 0) {
            try {
                await indexDocumentChunks(biddingProcessId, pdfParts);
                logger.info(`[AI-V2] 🔗 RAG indexado para processo ${biddingProcessId}`);
            } catch (ragErr: any) {
                logger.warn(`[AI-V2] RAG indexação falhou: ${ragErr.message}`);
            }
        }

        const totalDuration = ((Date.now() - analysisStartTime) / 1000).toFixed(1);
        const totalReqs = Object.values(result.requirements).reduce((sum, arr) => sum + arr.length, 0);
        logger.info(`[AI-V2] ═══ PIPELINE CONCLUÍDO ═══ ${totalDuration}s total | ` +
            `Modelos: ${uniqueModels.join('+')} | ` +
            `${totalReqs} exigências | ${result.legal_risk_review.critical_points.length} riscos | ` +
            `${result.evidence_registry.length} evidências | Score: ${combinedScore}% (${result.confidence.overall_confidence})`);

        // ── 8. Compatibilidade V1 ──
        // Gera campos legacy para consumo pelos módulos que ainda usam o formato antigo

        // ── Helper: Parse date in PT-BR or ISO format ──
        const parsePtBrDate = (dateStr: string): string => {
            if (!dateStr) return '';
            // Already ISO
            if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr;
            // PT-BR: "27/05/2025 às 09:00" (SchemaEnforcer normalized format)
            const mAux = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+às\s+(\d{2}):(\d{2})/);
            if (mAux) return `${mAux[3]}-${mAux[2]}-${mAux[1]}T${mAux[4]}:${mAux[5]}:00`;
            // PT-BR: "27/05/2025 09:00" or "27/05/2025"
            const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*(\d{2}:\d{2})?/);
            if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00:00'}:00`;
            return dateStr;
        };

        // ── Helper: Calculate estimated value from itens or schema ──
        const calcEstimatedValue = (): number => {
            // Strategy 1: Sum from itens_licitados
            const itens = result.proposal_analysis?.itens_licitados || [];
            if (Array.isArray(itens) && itens.length > 0) {
                const total = itens.reduce((sum: number, it: any) => {
                    const price = parseFloat(String(it.referencePrice || 0)) || 0;
                    const qty = parseFloat(String(it.quantity || 1)) || 1;
                    const mult = parseFloat(String(it.multiplier || 1)) || 1;
                    return sum + (price * qty * mult);
                }, 0);
                if (total > 0) return Math.round(total * 100) / 100;
            }

            // Strategy 2: Parse R$ value from ALL text fields in the result
            const textsToSearch = [
                result.process_identification?.objeto_completo || '',
                result.process_identification?.objeto_resumido || '',
                ...(result.contractual_analysis?.obrigacoes_contratada || []),
                ...(result.contractual_analysis?.obrigacoes_contratante || []),
                ...(result.contractual_analysis?.penalidades || []),
                ...(result.contractual_analysis?.matriz_risco_contratual || []),
                result.contractual_analysis?.medicao_pagamento || '',
                ...(result.proposal_analysis?.observacoes_proposta || []),
                ...(result.proposal_analysis?.criterios_exequibilidade || []),
                result.participation_conditions?.garantia_contratual_detalhes || '',
                result.participation_conditions?.garantia_proposta_detalhes || '',
                ...(result.evidence_registry || []).map((e: any) => e.excerpt || ''),
                ...(result.legal_risk_review?.critical_points || []).map((cp: any) => `${cp.description} ${cp.reason}`),
                ...(result.confidence?.warnings || []),
            ].join(' ');
            // Match: R$ 1.234.567,89 or R$1234567.89
            const allRValues = textsToSearch.matchAll(/R\$\s*([\d.]+,\d{2})/gi);
            let maxValue = 0;
            for (const m of allRValues) {
                const cleaned = m[1].replace(/\./g, '').replace(',', '.');
                const val = parseFloat(cleaned);
                if (val > maxValue) maxValue = val;
            }
            if (maxValue > 0) return Math.round(maxValue * 100) / 100;
            // Also try: "valor estimado de 1.234.567,89" (without R$)
            const altMatch = textsToSearch.match(/valor\s*(?:estimado|global|total|máximo|contrat)\w*\s*(?:de|:)?\s*(?:R\$\s*)?([\d.]+,\d{2})/i);
            if (altMatch) {
                const cleaned = altMatch[1].replace(/\./g, '').replace(',', '.');
                const val = parseFloat(cleaned);
                if (val > 0) return Math.round(val * 100) / 100;
            }

            // Strategy 3: Derive from capital_social_minimo (≈10% do valor)
            const csm = result.economic_financial_analysis?.capital_social_minimo;
            if (csm) {
                const v = parseFloat(String(csm).replace(/[^\d.,]/g, '').replace(',', '.'));
                if (v > 0) return Math.round(v * 10 * 100) / 100;
            }

            // Strategy 4: patrimonio_liquido_minimo (≈10% do valor)
            const plm = result.economic_financial_analysis?.patrimonio_liquido_minimo;
            if (plm) {
                const v = parseFloat(String(plm).replace(/[^\d.,]/g, '').replace(',', '.'));
                if (v > 0) return Math.round(v * 10 * 100) / 100;
            }

            return 0;
        };

        // ── Helper: Detect portal from schema ──
        const detectPortal = (): string => {
            const orgao = (result.process_identification?.orgao || '').toLowerCase();
            const fonte = (result.process_identification?.fonte_oficial || '').toLowerCase();
            const edital = (result.process_identification?.numero_edital || '').toLowerCase();
            const allText = `${orgao} ${fonte} ${edital}`;
            if (/compras\.gov|comprasnet|cnetmobile|pncp|uasg/i.test(allText)) return 'Compras.gov.br';
            if (/bnc\b|bolsa\s*nacional/i.test(allText)) return 'BNC';
            if (/bll\b|bolsadedigital/i.test(allText)) return 'BLL';
            if (/licitanet/i.test(allText)) return 'Licitanet';
            if (/bbmnet/i.test(allText)) return 'BBMNet';
            if (/licita\s*mais|licita\s*mais\s*brasil|licitamaisbrasil/i.test(allText)) return 'Licita Mais Brasil';
            if (/portaldecompras|portal\s*de\s*compras|portaldecompraspublicas/i.test(allText)) return 'Portal de Compras Públicas';
            if (/licita[çc][õo]es[\s-]*e|banco\s*do\s*brasil|bb\b/i.test(allText)) return 'Licitações-e (BB)';
            if (/bec[\s/]*sp|bolsa\s*eletr[ôo]nica/i.test(allText)) return 'BEC/SP';
            if (/m2a/i.test(allText)) return 'M2A Tecnologia';
            // Detect by orgao type — federal organs use Compras.gov.br
            if (/federal|ministério|minist[eé]rio|uni[aã]o|autarquia federal|ibama|inss|inpe|icmbio/i.test(orgao)) return 'Compras.gov.br';
            // Municipal/state organs — don't force a portal, leave empty for user to select
            return '';
        };

        // ── Helper: Auto-calculate risk from critical points ──
        const autoRisk = (): string => {
            const cps = result.legal_risk_review?.critical_points || [];
            const criticals = cps.filter(cp => cp.severity === 'critica' || cp.severity === 'alta');
            const medias = cps.filter(cp => cp.severity === 'media');
            if (criticals.length >= 2) return 'Crítico';
            if (criticals.length >= 1) return 'Alto';
            if (medias.length >= 2) return 'Médio';
            return 'Baixo';
        };

        const estimatedValueCalc = calcEstimatedValue();

        // Prefer AI-extracted value, fall back to regex-based extraction
        const finalEstimatedValue = result.process_identification.valor_estimado_global || estimatedValueCalc;
        // Prefer AI-extracted portal, fall back to regex-based detection
        const finalPortal = result.process_identification.portal_licitacao && result.process_identification.portal_licitacao !== 'outro'
            ? result.process_identification.portal_licitacao
            : detectPortal() || result.process_identification.portal_licitacao || '';

        const legacyCompat = {
            process: {
                title: (() => {
                    const mod = result.process_identification.modalidade || '';
                    const numProc = result.process_identification.numero_processo || '';
                    const numEdit = result.process_identification.numero_edital || '';
                    const orgao = (result.process_identification.orgao || '').toUpperCase();
                    const numero = numProc || numEdit;
                    // Format: "Pregão Eletrônico 2613030301-PE - PREFEITURA MUNICIPAL DE X"
                    if (mod && numero && orgao) return `${mod} ${numero} - ${orgao}`;
                    if (mod && numero) return `${mod} ${numero}`;
                    if (numero && orgao) return `${numero} - ${orgao}`;
                    return result.process_identification.objeto_resumido || numero || 'Sem título';
                })(),
                summary: result.process_identification.objeto_completo || result.process_identification.objeto_resumido,
                modality: normalizeModality(result.process_identification.modalidade),
                object: result.process_identification.objeto_completo,
                agency: result.process_identification.orgao,
                portal: finalPortal,
                estimatedValue: finalEstimatedValue,
                sessionDate: parsePtBrDate(result.timeline.data_sessao),
                risk: autoRisk(),
                link: result.process_identification.link_sistema || undefined,
            },
            analysis: {
                fullSummary: `ANÁLISE V2 — ${result.process_identification.objeto_resumido}\n\n` +
                    `Modalidade: ${result.process_identification.modalidade}\n` +
                    `Órgão: ${result.process_identification.orgao}\n` +
                    `Sessão: ${result.timeline.data_sessao}\n\n` +
                    `Objeto: ${result.process_identification.objeto_completo}\n\n` +
                    `--- CONDIÇÕES ---\n` +
                    `Consórcio: ${result.participation_conditions.permite_consorcio ?? 'Não informado'}\n` +
                    `Subcontratação: ${result.participation_conditions.permite_subcontratacao ?? 'Não informado'}\n` +
                    `Visita Técnica: ${result.participation_conditions.exige_visita_tecnica ?? 'Não informado'}\n\n` +
                    `--- RISCOS CRÍTICOS (${result.legal_risk_review.critical_points.length}) ---\n` +
                    result.legal_risk_review.critical_points.map(cp =>
                        `[${cp.severity.toUpperCase()}] ${cp.title}: ${cp.description} → ${cp.recommended_action}`
                    ).join('\n'),
                qualificationRequirements: Object.values(result.requirements)
                    .flat()
                    .map(r => `[${r.requirement_id}] ${r.title}: ${r.description}`)
                    .join('\n'),
                biddingItems: (() => {
                    const itens = result.proposal_analysis?.itens_licitados || [];
                    if (Array.isArray(itens) && itens.length > 0) {
                        return itens.map((it: any) => 
                            `Item ${it.itemNumber || '?'}: ${it.description || ''} | Unid: ${it.unit || 'UN'} | Qtd: ${it.quantity || 1}${it.multiplier && it.multiplier > 1 ? ` × ${it.multiplier} ${it.multiplierLabel || ''}` : ''} | Ref: R$ ${it.referencePrice || 0}`
                        ).join('\n');
                    }
                    return (result.proposal_analysis.observacoes_proposta || []).join('\n');
                })(),
                pricingConsiderations: result.economic_financial_analysis.indices_exigidos
                    .map(i => `${i.indice}: ${i.formula_ou_descricao} (mín: ${i.valor_minimo})`)
                    .join('\n'),
            }
        };

        res.json({
            ...legacyCompat,          // Campos V1 para compatibilidade
            schemaV2: result,          // Schema completo V2
            _version: '2.0',
            _pipeline_duration_s: parseFloat(totalDuration),
            _prompt_version: V2_PROMPT_VERSION,
            _model_used: uniqueModels.join('+'),
            _overall_confidence: result.confidence.overall_confidence
        });

    } catch (error: any) {
        logger.error(`[AI-V2] ERRO FATAL:`, error?.message || error);
        const logMsg = `[${new Date().toISOString()}] V2 Pipeline Error: ${error?.message || String(error)}\n${error?.stack || ''}\n\n`;
        fs.appendFileSync(path.join(uploadDir, 'debug-analysis.log'), logMsg);
        res.status(500).json({
            error: `Erro no pipeline V2: ${error?.message || 'Erro desconhecido'}`,
            schemaV2: result  // Retorna o que conseguiu mesmo em erro
        });
    }
});

// Petition Generation Endpoint
router.post('/petitions/generate', authenticateToken, async (req: any, res) => {
    try {
        const { biddingProcessId, companyId, templateType, userContext, attachments } = req.body;
        const tenantId = req.user.tenantId;

        logger.info(`[Petition] Generating ${templateType} for process ${biddingProcessId} with ${attachments?.length || 0} attachments`);
        const bidding = await prisma.biddingProcess.findUnique({
            where: { id: biddingProcessId, tenantId },
            include: { aiAnalysis: true }
        });

        const company = await prisma.companyProfile.findUnique({
            where: { id: companyId, tenantId }
        });

        if (!bidding || !company) {
            return res.status(404).json({ error: 'Processo ou Empresa não encontrados.' });
        }

        if (!biddingProcessId || !companyId || (!userContext && (attachments?.length || 0) === 0)) {
            return res.status(400).json({ error: 'Por favor, selecione o processo, a empresa e descreva os fatos ou anexe documentos.' });
        }
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });

        const ai = new GoogleGenAI({ apiKey });
        const aiAnalysis = bidding.aiAnalysis;

        let biddingAnalysisText = 'Nenhuma análise detalhada disponível.';
        if (aiAnalysis) {
            // Prefer V2 structured context for petitions (risk + impugnation focus)
            if (aiAnalysis.schemaV2) {
                biddingAnalysisText = `
${buildModuleContext(aiAnalysis.schemaV2, 'petition')}

Resumo Executivo: ${aiAnalysis.fullSummary || 'N/A'}
`.trim();
                logger.info(`[Petition] Using buildModuleContext('petition') for generation`);
            } else {
                biddingAnalysisText = `
Resumo do Edital (Card): ${bidding.summary || 'Não disponível'}
Parecer Técnico-Jurídico Profundo: ${aiAnalysis.fullSummary || 'Não disponível'}
Documentos Exigidos: ${typeof aiAnalysis.requiredDocuments === 'string' ? aiAnalysis.requiredDocuments : JSON.stringify(aiAnalysis.requiredDocuments)}
Itens e Lotes: ${aiAnalysis.biddingItems || 'Não disponível'}
Exigências de Qualificação Técnica (LITERAL): ${aiAnalysis.qualificationRequirements || 'Não disponível'}
Prazos e Datas Críticas: ${typeof aiAnalysis.deadlines === 'string' ? aiAnalysis.deadlines : JSON.stringify(aiAnalysis.deadlines)}
Considerações de Preço: ${aiAnalysis.pricingConsiderations || 'Não disponível'}
Alertas e Irregularidades: ${typeof aiAnalysis.irregularitiesFlags === 'string' ? aiAnalysis.irregularitiesFlags : JSON.stringify(aiAnalysis.irregularitiesFlags)}
Penalidades: ${aiAnalysis.penalties || 'Não disponível'}
`.trim();
            }
        }

        const currentDateStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        const repName = company.contactName || '[Nome do Representante]';
        const repCpf = company.contactCpf || '[CPF]';

        let cleanCity = (company.city || '[Cidade]').split('/')[0].trim();
        const companyState = (company.state || '[UF]').toUpperCase().trim();

        const systemInstruction = MASTER_PETITION_SYSTEM_PROMPT
            .replace(/{currentDate}/g, currentDateStr)
            .replace(/{legalRepresentativeName}/g, repName)
            .replace(/{legalRepresentativeCpf}/g, repCpf)
            .replace(/{companyCity}/g, cleanCity)
            .replace(/{companyState}/g, companyState)
            .replace(/{companyName}/g, company.razaoSocial)
            .replace(/{companyCnpj}/g, company.cnpj);

        const fullBiddingObject = bidding.summary || bidding.title;

        const userInstruction = PETITION_USER_INSTRUCTION
            .replace('{petitionType}', templateType.toUpperCase())
            .replace(/{fullBiddingObject}/g, fullBiddingObject)
            .replace('{issuer}', bidding.portal)
            .replace('{modality}', bidding.modality)
            .replace('{portal}', bidding.portal)
            .replace('{biddingAnalysis}', biddingAnalysisText)
            .replace('{companyName}', company.razaoSocial)
            .replace('{companyCnpj}', company.cnpj)
            .replace('{companyQualification}', company.qualification || 'Não informada')
            .replace(/{legalRepresentativeName}/g, repName)
            .replace(/{legalRepresentativeCpf}/g, repCpf)
            .replace(/{companyCity}/g, cleanCity)
            .replace(/{companyState}/g, companyState)
            .replace(/{currentDate}/g, currentDateStr)
            .replace('{userContext}', userContext);

        // Preparar partes para o Gemini (Texto + Arquivos PDF/Imagens)
        const parts: any[] = [{ text: userInstruction }];

        if (attachments && Array.isArray(attachments)) {
            attachments.forEach((att: any) => {
                if (att.data && att.mimeType) {
                    parts.push({
                        inlineData: {
                            data: att.data,
                            mimeType: att.mimeType
                        }
                    });
                }
            });
        }

        const result = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.0-flash',
            contents: [
                {
                    role: 'user',
                    parts: parts
                }
            ],
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.2,
                maxOutputTokens: 8192
            }
        }, 3, { tenantId: req.user.tenantId, operation: 'petition' });

        res.json({ text: result.text });
    } catch (error: any) {
        logger.error('[Petition] Error:', error.message);
        res.status(500).json({ error: 'Erro ao gerar petição: ' + (error.message || 'Unknown error') });
    }
});

// AI Chat Endpoint
router.post('/chat', authenticateToken, aiLimiter, async (req: any, res) => {
    try {
        const traceLog = (msg: string) => {
            const timestamp = new Date().toISOString();
            fs.appendFileSync(path.join(uploadDir, 'chat-trace.log'), `[${timestamp}] ${msg}\n`);
            logger.info(msg);
        };

        let { fileNames, biddingProcessId, messages } = req.body;
        traceLog(`Chat Request Received. processId: ${biddingProcessId}, messages: ${messages?.length}`);

        // Fetch analysis data for context AND source file names
        let analysisContext = "";
        let sourceFileNamesFromAnalysis: string[] = [];
        if (biddingProcessId) {
            const analysis = await prisma.aiAnalysis.findUnique({
                where: { biddingProcessId }
            });
            if (analysis) {
                // Prefer V2 structured context when available
                if (analysis.schemaV2) {
                    analysisContext = `
ANÁLISE ESTRUTURADA V2 DO EDITAL (confiança: ${(analysis.schemaV2 as any)?.confidence?.overall_confidence || 'N/A'}):

${buildModuleContext(analysis.schemaV2, 'chat')}
`;
                    traceLog(`[V2] Chat context loaded via buildModuleContext (${analysisContext.length} chars). Confidence: ${(analysis.schemaV2 as any)?.confidence?.overall_confidence}`);
                } else {
                    // Fallback to legacy V1 fields
                    analysisContext = `
CONTEÚDO DO RELATÓRIO ANALÍTICO EXISTENTE:
Resumo Executivo: ${analysis.fullSummary || 'N/A'}
Itens Licitados: ${analysis.biddingItems || 'N/A'}
Requisitos de Qualificação Técnica: ${analysis.qualificationRequirements || 'N/A'}
Considerações de Preço: ${analysis.pricingConsiderations || 'N/A'}
Penalidades: ${analysis.penalties || 'N/A'}
Documentos Exigidos: ${analysis.requiredDocuments || '[]'}
Prazos: ${analysis.deadlines || '[]'}
Riscos e Irregularidades: ${analysis.irregularitiesFlags || '[]'}
`;
                    traceLog("Legacy V1 analysis context loaded.");
                }

                // Retrieve the original PDF file names used during analysis
                if (analysis.sourceFileNames) {
                    try {
                        sourceFileNamesFromAnalysis = JSON.parse(analysis.sourceFileNames);
                        traceLog(`Source file names from analysis: ${JSON.stringify(sourceFileNamesFromAnalysis)}`);
                    } catch (e) {
                        traceLog(`Failed to parse sourceFileNames: ${analysis.sourceFileNames}`);
                    }
                }
            }
        }

        // If processId is provided, lookup fileNames in DB (more robust)
        if (biddingProcessId) {
            const process = await prisma.biddingProcess.findUnique({
                where: { id: biddingProcessId, tenantId: req.user.tenantId }
            });
            traceLog(`Process lookup: ${process ? 'FOUND' : 'NOT FOUND'} for tenant ${req.user.tenantId}`);
            if (process && process.link) {
                traceLog(`Process links found: ${process.link}`);
                const urls = process.link.split(',').map(u => u.trim());
                const dbFileNames = urls.map(url => {
                    // Only process URLs that look like local uploads
                    if (!url.includes('/uploads/') && !url.includes(req.user.tenantId)) {
                        traceLog(`Skipping external/non-pdf link: ${url}`);
                        return null;
                    }
                    try {
                        const urlObj = new URL(url);
                        const pathname = urlObj.pathname;
                        return path.basename(pathname).split('?')[0];
                    } catch (e) {
                        // Fallback for malformed URLs or non-URL strings
                        return url.split('/').pop()?.split('?')[0] || '';
                    }
                }).filter(Boolean);
                traceLog(`Derived valid dbFileNames: ${JSON.stringify(dbFileNames)}`);
                // Merge or override
                fileNames = [...new Set([...(fileNames || []), ...dbFileNames])];
            }
        }

        // Merge sourceFileNames from analysis (most reliable source of uploaded PDFs)
        if (sourceFileNamesFromAnalysis.length > 0) {
            fileNames = [...new Set([...(fileNames || []), ...sourceFileNamesFromAnalysis])];
            traceLog(`Merged sourceFileNames from analysis. Final fileNames: ${JSON.stringify(fileNames)}`);
        }

        if ((!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) && !analysisContext) {
            traceLog(`ERROR: No fileNames found and no analysis context.`);
            return res.status(400).json({ error: 'Nenhum contexto de documento (fileNames ou biddingProcessId) foi fornecido.' });
        }
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'messages array is required' });
        }

        // Busca Vetorial RAG
        let ragContext = "";
        try {
            const queryText = messages[messages.length - 1]?.text;
            if (queryText && biddingProcessId) {
                const similarChunks = await searchSimilarChunks(biddingProcessId, queryText, 5);
                if (similarChunks && similarChunks.length > 0) {
                    ragContext = "\n\nTRECHOS DO EDITAL MAIS RELEVANTES PARA A PERGUNTA:\n" + similarChunks.map((c: any) => c.content).join("\n\n---\n\n");
                    traceLog(`[RAG] Encontrados ${similarChunks.length} trechos vetorizados com sucesso para: "${queryText.substring(0, 30)}..."`);
                    analysisContext += ragContext;
                }
            }
        } catch (ragErr: any) {
            traceLog(`[RAG] Erro ao buscar vetores: ${ragErr.message}`);
        }

        const pdfParts: any[] = [];
        traceLog(`Final fileNames for Gemini: ${JSON.stringify(fileNames)}`);

        // DYNAMIC DECISION: Só enviamos o pesado PDF inteiro (multimodal) se o banco de vetor falhar ou não achar contexto.
        if (!ragContext || ragContext.trim() === "") {
            traceLog(`[RAG] Sem trechos vetorizados. Realizando fallback doloroso para envio completo do(s) PDF(s) para a IA...`);
            const fetched = await fetchPdfPartsForProcess(biddingProcessId, fileNames || [], req.user.tenantId);
            pdfParts.push(...fetched);
        } else {
            traceLog(`[RAG] Trechos fornecidos pela busca vetorial! Omitindo Buffer PDF da payload (Economia de tokens ativada 🚀).`);
        }

        if (pdfParts.length === 0 && !analysisContext) {
            traceLog(`CRITICAL: No PDF parts and no analysis context found.`);
            return res.status(400).json({ error: 'Nenhum contexto de documento ou análise encontrado para este chat.' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in the backend' });
        }
        const ai = new GoogleGenAI({ apiKey });

        const systemInstruction = `${CHAT_SYSTEM_PROMPT}

CONDIÇÕES DE CONTEXTO DESTE EDITAL:
${pdfParts.length > 0 ? "- Documentos PDF originais do edital estão disponíveis para consulta direta." : "- Documentos PDF originais AUSENTES. Use exclusivamente os dados do relatório analítico abaixo como fonte."}

${analysisContext}
`;

        // Using standard format {role, parts:[{text}]} mandated by the new genai SDK
        const formattedHistory = messages.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
        }));

        // Prepend the PDF parts to the first user message or as a context message
        // Better: In Gemini 2.0+, we can just include them in the contents.
        const historyWithContext = [...formattedHistory];
        if (historyWithContext.length > 0 && historyWithContext[0].role === 'user') {
            // Add PDF context to the very first user message to establish base knowledge
            historyWithContext[0].parts = [...pdfParts, ...historyWithContext[0].parts];
        } else {
            // Fallback: add as a separate user message if history is empty (shouldn't happen)
            historyWithContext.unshift({
                role: 'user',
                parts: [...pdfParts, { text: "Estes são os documentos para nossa conversa." }]
            });
        }

        const chatResult = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: historyWithContext,
            config: {
                systemInstruction,
                temperature: 0.35,
                maxOutputTokens: 32768
            }
        }, 3, { tenantId: req.user.tenantId, operation: 'ai_chat' });

        res.json({ text: chatResult.text });
    } catch (error: any) {
        logger.error("AI Chat Error:", error?.message || error);
        res.status(500).json({ error: 'Failed to answer via AI chat' });
    }
});

// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════
// Analysis Save/Get (extracted from index.ts)
// ═══════════════════════════════════════════
router.post('/analysis', authenticateToken, async (req: any, res) => {
    try {
        const payload = { ...req.body };

        // Verify if biddingProcess belongs to the tenant
        const bidding = await prisma.biddingProcess.findUnique({
            where: { id: payload.biddingProcessId }
        });

        if (!bidding || bidding.tenantId !== req.user.tenantId) {
            return res.status(403).json({ error: 'Unauthorized to add analysis to this process' });
        }

        if (typeof payload.requiredDocuments === 'object') {
            payload.requiredDocuments = JSON.stringify(payload.requiredDocuments);
        }
        if (typeof payload.deadlines === 'object') {
            payload.deadlines = JSON.stringify(payload.deadlines);
        }
        if (typeof payload.chatHistory === 'object') {
            payload.chatHistory = JSON.stringify(payload.chatHistory);
        }

        const stringifyIfObject = (field: string) => {
            if (payload[field] && typeof payload[field] === 'object') {
                payload[field] = JSON.stringify(payload[field]);
            }
        };

        ['biddingItems', 'pricingConsiderations', 'fullSummary', 'penalties', 'qualificationRequirements', 'irregularitiesFlags', 'sourceFileNames'].forEach(stringifyIfObject);

        // V2 fields — persist structured schema and metadata
        const v2Fields: any = {};
        if (payload.schemaV2 && typeof payload.schemaV2 === 'object') {
            v2Fields.schemaV2 = payload.schemaV2;
        }
        if (payload.promptVersion) v2Fields.promptVersion = payload.promptVersion;
        if (payload.modelUsed) v2Fields.modelUsed = payload.modelUsed;
        if (payload.pipelineDurationS !== undefined) v2Fields.pipelineDurationS = parseFloat(payload.pipelineDurationS);
        if (payload.overallConfidence) v2Fields.overallConfidence = payload.overallConfidence;
        if (payload.requiresHumanAudit !== undefined) v2Fields.requiresHumanAudit = payload.requiresHumanAudit;

        // Remove V2 fields from payload to avoid Prisma unknown field error
        delete payload.schemaV2;
        delete payload.promptVersion;
        delete payload.modelUsed;
        delete payload.pipelineDurationS;
        delete payload.overallConfidence;
        delete payload.requiresHumanAudit;

        const mergedPayload = { ...payload, ...v2Fields };

        logger.info(`[Analysis] Upserting analysis for process ${mergedPayload.biddingProcessId}. Payload summary length: ${mergedPayload.fullSummary?.length || 0}. Files: ${mergedPayload.sourceFileNames}. V2: ${!!v2Fields.schemaV2}`);

        const analysis = await prisma.aiAnalysis.upsert({
            where: {
                biddingProcessId: mergedPayload.biddingProcessId
            },
            create: mergedPayload,
            update: mergedPayload
        });

        // Debug log to confirm what was actually saved
        logger.info(`[Analysis] SUCCESS for ${payload.biddingProcessId}. Saved sourceFiles: ${analysis.sourceFileNames?.substring(0, 100)}`);

        // Fire & Forget Indexing -> Vector Database para RAG
        if (payload.biddingProcessId && payload.sourceFileNames) {
            try {
                const parsedFileNames = JSON.parse(payload.sourceFileNames);
                if (Array.isArray(parsedFileNames) && parsedFileNames.length > 0) {
                    logger.info(`[Background RAG] Disparando indexação assíncrona para ${payload.biddingProcessId}...`);
                    fetchPdfPartsForProcess(payload.biddingProcessId, parsedFileNames, req.user.tenantId)
                        .then(pdfParts => {
                            if (pdfParts && pdfParts.length > 0) {
                                return indexDocumentChunks(payload.biddingProcessId, pdfParts);
                            }
                        })
                        .catch(err => logger.error(`[Background RAG] Erro interno: ${err.message}`));
                }
            } catch (e) {
                logger.warn(`[Background RAG] Não foi possível mapear sourceFileNames para o processo ${payload.biddingProcessId}`);
            }
        }

        res.json(analysis);
    } catch (error) {
        logger.error("Create analysis error:", error);
        res.status(500).json({ error: 'Failed to save AI analysis' });
    }
});

// GET structured analysis for a process (frontend consumption)
router.get('/analysis/:processId', authenticateToken, async (req: any, res) => {
    try {
        const { processId } = req.params;
        const tenantId = req.user.tenantId;

        // Verify process ownership
        const process = await prisma.biddingProcess.findUnique({
            where: { id: processId, tenantId }
        });
        if (!process) {
            return res.status(404).json({ error: 'Processo não encontrado' });
        }

        const analysis = await prisma.aiAnalysis.findUnique({
            where: { biddingProcessId: processId }
        });

        if (!analysis) {
            return res.status(404).json({ error: 'Análise não encontrada para este processo' });
        }

        res.json({
            id: analysis.id,
            biddingProcessId: analysis.biddingProcessId,
            schemaV2: analysis.schemaV2 || null,
            promptVersion: analysis.promptVersion || null,
            modelUsed: analysis.modelUsed || null,
            pipelineDurationS: analysis.pipelineDurationS || null,
            overallConfidence: analysis.overallConfidence || null,
            analyzedAt: analysis.analyzedAt,
            hasV2: !!analysis.schemaV2,
            // Legacy fields for backward compatibility
            fullSummary: analysis.fullSummary,
            qualificationRequirements: analysis.qualificationRequirements,
            biddingItems: analysis.biddingItems,
        });
    } catch (error: any) {
        logger.error("Get analysis error:", error);
        res.status(500).json({ error: 'Failed to fetch analysis' });
    }
});

// Basic Documents Fetch (Scoped)

export default router;
