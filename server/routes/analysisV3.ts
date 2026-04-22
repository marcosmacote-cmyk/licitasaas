/**
 * ═══════════════════════════════════════════════════════════════════════
 * V3 Pipeline — Zerox-Enhanced Edital Analysis
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Identical to V2 except Stage 1: PDFs are pre-processed by Zerox
 * into clean Markdown BEFORE being sent to Gemini for schema extraction.
 * 
 * V2: PDF(base64) ──────────────────→ Gemini Flash → JSON → Enforcer
 * V3: PDF(base64) → Zerox(Vision) → Markdown → Gemini Flash → JSON → Enforcer
 * 
 * If Zerox fails, automatically falls back to V2 inline approach.
 * Stages 2, 3, and post-processing are 100% identical to V2.
 */
import express from 'express';
import { authenticateToken } from '../middlewares/auth';
import { aiLimiter } from '../lib/security';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { handleApiError } from '../middlewares/errorHandler';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { robustJsonParse, robustJsonParseDetailed } from '../services/ai/parser.service';
import { callGeminiWithRetry } from '../services/ai/gemini.service';
import { createEmptyAnalysisSchema } from '../services/ai/analysis-schema-v1';
import { fallbackToOpenAiV2 } from '../services/ai/openai.service';
import { enforceSchema } from '../services/ai/schemaEnforcer';
import { executeRiskRules } from '../services/ai/riskRulesEngine';
import { evaluateAnalysisQuality, validateAnalysisCompleteness } from '../services/ai/analysisQualityEvaluator';
import { V2_EXTRACTION_PROMPT, V2_EXTRACTION_USER_INSTRUCTION, V2_RISK_REVIEW_PROMPT, V2_RISK_REVIEW_USER_INSTRUCTION, V2_PROMPT_VERSION, getDomainRoutingInstruction, NORM_CATEGORIES, buildCategoryNormPrompt, buildCategoryNormUser, MANUAL_EXTRACTION_ADDON } from '../services/ai/prompt.service';
import { uploadDir } from '../services/files.service';
import { indexDocumentChunks } from '../services/ai/rag.service';
import { normalizeModality } from '../lib/biddingHelpers';
import { extractMarkdownFromMultiplePdfs, isZeroxAvailable, getZeroxCacheStats } from '../services/ai/zeroxExtractor';

const router = express.Router();

// ── Bridge: injected from index.ts ──
let getFileBufferSafe: (f: string, t?: string) => Promise<Buffer | null>;
export function injectV3Deps(deps: { getFileBufferSafe: typeof getFileBufferSafe }) {
    getFileBufferSafe = deps.getFileBufferSafe;
}

// ── Diagnostic: Zerox status ──
router.get('/v3/status', authenticateToken, async (_req: any, res) => {
    const available = await isZeroxAvailable();
    res.json({
        zeroxAvailable: available,
        cache: getZeroxCacheStats(),
        version: 'v3.0.0-zerox',
    });
});

// ═══════════════════════════════════════════════════════════════════════
// V3 — Zerox-Enhanced Analysis Pipeline
// ═══════════════════════════════════════════════════════════════════════
router.post('/v3', authenticateToken, aiLimiter, async (req: any, res) => {
    const analysisStartTime = Date.now();
    const result = createEmptyAnalysisSchema();
    result.analysis_meta.analysis_id = `v3_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    result.analysis_meta.generated_at = new Date().toISOString();

    try {
        const { fileNames, biddingProcessId } = req.body;
        if (!fileNames?.length) {
            return res.status(400).json({ error: 'fileNames array is required' });
        }

        // ── Stage 0: Ingest Documents ──
        const pdfBuffers: Array<{ buffer: Buffer; fileName: string }> = [];
        const pdfPartsLegacy: any[] = []; // Fallback for V2-style inline
        const sourceFiles: string[] = [];

        for (let raw of fileNames) {
            const fileName = decodeURIComponent(raw).split('?')[0];
            const doc = await prisma.document.findFirst({
                where: { fileUrl: { contains: fileName }, tenantId: req.user.tenantId }
            });
            const ok = doc || fileName.startsWith(`${req.user.tenantId}_`) || fileName.includes(`${req.user.tenantId}/`);
            if (!ok) continue;

            const buf = await getFileBufferSafe(doc ? doc.fileUrl : fileName, req.user.tenantId);
            if (!buf) continue;

            const magic = buf.length >= 4 ? buf.toString('hex', 0, 4) : '';
            if (fileName.toLowerCase().endsWith('.pdf') || magic.startsWith('25504446')) {
                pdfBuffers.push({ buffer: buf, fileName });
                pdfPartsLegacy.push({ inlineData: { data: buf.toString('base64'), mimeType: 'application/pdf' } });
                sourceFiles.push(fileName);
                logger.info(`[AI-V3] 📄 ${fileName} (${Math.round(buf.length / 1024)}KB)`);
            }
        }

        if (pdfBuffers.length === 0) {
            return res.status(400).json({ error: 'Nenhum arquivo válido encontrado.' });
        }

        result.analysis_meta.source_files = sourceFiles;
        result.analysis_meta.source_type = 'upload_manual';

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' });
        const ai = new GoogleGenAI({ apiKey });

        let modelsUsed: string[] = [];
        logger.info(`[AI-V3] ═══ PIPELINE V3 INICIADO ═══ (${pdfBuffers.length} PDFs)`);

        // ═══════════════════════════════════════════════════════════════
        // STAGE 1: ZEROX PRE-PROCESSING + GEMINI TEXT EXTRACTION
        // This is the ONLY difference from V2
        // ═══════════════════════════════════════════════════════════════
        let extractionJson: any;
        const t1Start = Date.now();
        let usedZerox = false;
        const manualUserInstruction = V2_EXTRACTION_USER_INSTRUCTION.replace('{domainReinforcement}', '') + MANUAL_EXTRACTION_ADDON;

        // Try Zerox first
        const zeroxAvailable = await isZeroxAvailable();
        if (zeroxAvailable) {
            logger.info(`[AI-V3] 🔬 Zerox disponível — convertendo PDFs para Markdown...`);
            try {
                const zeroxResult = await extractMarkdownFromMultiplePdfs(pdfBuffers, {
                    concurrency: 5,
                    temperature: 0.1,
                });

                if (zeroxResult && zeroxResult.markdown.length > 100) {
                    usedZerox = true;
                    logger.info(`[AI-V3] ✅ Zerox: ${zeroxResult.totalPages} páginas, ${zeroxResult.markdown.length} chars em ${(zeroxResult.totalDurationMs / 1000).toFixed(1)}s`);

                    // Send CLEAN TEXT (not PDF) to Gemini for structured extraction
                    const textExtractionResponse = await callGeminiWithRetry(ai.models, {
                        model: 'gemini-2.5-flash',
                        contents: [{
                            role: 'user',
                            parts: [{ text: `${manualUserInstruction}\n\n── CONTEÚDO DO EDITAL (extraído via OCR) ──\n\n${zeroxResult.markdown}` }]
                        }],
                        config: {
                            systemInstruction: V2_EXTRACTION_PROMPT,
                            temperature: 0.05,
                            maxOutputTokens: 65536,
                            responseMimeType: 'application/json'
                        }
                    }, 3, { tenantId: req.user.tenantId, operation: 'analysis_v3', metadata: { stage: 'zerox_extraction' } });

                    const text = textExtractionResponse.text;
                    if (!text) throw new Error('Gemini retornou vazio após Zerox');
                    extractionJson = robustJsonParse(text, 'V3-ZeroxExtraction');
                    modelsUsed.push('gemini-2.5-flash(zerox)');
                    logger.info(`[AI-V3] ✅ Etapa 1 (Zerox+Gemini) em ${((Date.now() - t1Start) / 1000).toFixed(1)}s`);
                } else {
                    logger.warn(`[AI-V3] ⚠️ Zerox retornou conteúdo insuficiente — fallback para inline`);
                }
            } catch (zeroxErr: any) {
                logger.warn(`[AI-V3] ⚠️ Zerox falhou: ${zeroxErr.message} — fallback para V2 inline`);
            }
        }

        // Fallback: V2-style inline PDF (if Zerox failed or unavailable)
        if (!extractionJson) {
            logger.info(`[AI-V3] 📎 Usando fallback V2 (PDF inline)...`);
            try {
                const resp = await callGeminiWithRetry(ai.models, {
                    model: 'gemini-2.5-flash',
                    contents: [{
                        role: 'user',
                        parts: [...pdfPartsLegacy, { text: manualUserInstruction }]
                    }],
                    config: {
                        systemInstruction: V2_EXTRACTION_PROMPT,
                        temperature: 0.05,
                        maxOutputTokens: 65536,
                        responseMimeType: 'application/json'
                    }
                }, 5, { tenantId: req.user.tenantId, operation: 'analysis_v3', metadata: { stage: 'inline_fallback' } });

                if (!resp.text) throw new Error('Vazio');
                extractionJson = robustJsonParse(resp.text, 'V3-InlineFallback');
                modelsUsed.push('gemini-2.5-flash(inline)');
            } catch (gemErr: any) {
                // Final fallback: OpenAI
                logger.warn(`[AI-V3] ⚠️ Gemini inline falhou: ${gemErr.message}. Tentando OpenAI...`);
                const oai = await fallbackToOpenAiV2({
                    systemPrompt: V2_EXTRACTION_PROMPT,
                    userPrompt: manualUserInstruction,
                    pdfParts: pdfPartsLegacy,
                    temperature: 0.05,
                    stageName: 'V3 Etapa 1'
                });
                if (!oai.text) throw new Error('Todas as IAs falharam na Etapa 1');
                extractionJson = robustJsonParse(oai.text, 'V3-OpenAI');
                modelsUsed.push(oai.model);
            }
        }

        result.analysis_meta.workflow_stage_status.extraction = 'done';
        (result.analysis_meta as any).zerox_used = usedZerox;
        const t1Duration = ((Date.now() - t1Start) / 1000).toFixed(1);
        logger.info(`[AI-V3] ✅ Etapa 1 completa em ${t1Duration}s (zerox=${usedZerox})`);

        // Merge extraction
        for (const key of ['process_identification', 'timeline', 'participation_conditions', 'requirements', 'technical_analysis', 'economic_financial_analysis', 'proposal_analysis', 'contractual_analysis', 'evidence_registry'] as const) {
            if (extractionJson[key]) (result as any)[key] = extractionJson[key];
        }

        // ═══════════════════════════════════════════════════════════════
        // STAGES 2 & 3: IDENTICAL TO V2 (normalization + risk review)
        // ═══════════════════════════════════════════════════════════════
        const detectedObjectType = result.process_identification?.tipo_objeto || 'outro';
        const domainReinforcement = getDomainRoutingInstruction(detectedObjectType);

        // ── Stage 2: Category Normalization ──
        const t2Start = Date.now();
        let normalizationJson: any = {};
        try {
            const mergedReqs: Record<string, any[]> = {};
            const mergedDocs: any[] = [];
            let totalNorm = 0;
            const FAST_CATS = ['habilitacao_juridica', 'regularidade_fiscal_trabalhista', 'qualificacao_economico_financeira'];

            const tasks = NORM_CATEGORIES.map(cat => {
                const items = Array.isArray((extractionJson.requirements as any)?.[cat.key]) ? (extractionJson.requirements as any)[cat.key] : [];
                if (items.length === 0) { mergedReqs[cat.key] = []; return null; }

                if (FAST_CATS.includes(cat.key)) {
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
                    mergedReqs[cat.key] = normalized;
                    totalNorm += normalized.length;
                    return { success: true, fastPath: true };
                }

                return (async () => {
                    try {
                        const resp = await callGeminiWithRetry(ai.models, {
                            model: 'gemini-2.5-flash',
                            contents: [{ role: 'user', parts: [{ text: buildCategoryNormUser(cat, items) }] }],
                            config: { systemInstruction: buildCategoryNormPrompt(cat), temperature: 0.1, maxOutputTokens: 16384, responseMimeType: 'application/json' }
                        }, 1, { tenantId: req.user.tenantId, operation: 'analysis_v3', metadata: { stage: `norm-${cat.key}` } });
                        const data = robustJsonParse(resp.text, `Norm-${cat.prefix}`);
                        mergedReqs[cat.key] = Array.isArray(data.items) && data.items.length > 0 ? data.items : items;
                        totalNorm += mergedReqs[cat.key].length;
                        if (Array.isArray(data.documents_to_prepare)) mergedDocs.push(...data.documents_to_prepare);
                        return { success: true };
                    } catch {
                        mergedReqs[cat.key] = items;
                        totalNorm += items.length;
                        return { success: false };
                    }
                })();
            }).filter(Boolean);

            await Promise.allSettled(tasks as Promise<any>[]);
            normalizationJson = { requirements_normalized: mergedReqs, operational_outputs: { documents_to_prepare: mergedDocs } };
            result.analysis_meta.workflow_stage_status.normalization = 'done';
            modelsUsed.push('gemini-2.5-flash');
            logger.info(`[AI-V3] ✅ Etapa 2 em ${((Date.now() - t2Start) / 1000).toFixed(1)}s — ${totalNorm} itens`);
        } catch (err: any) {
            result.analysis_meta.workflow_stage_status.normalization = 'failed';
            result.confidence.warnings.push(`Etapa 2 falhou: ${err.message}`);
        }

        if (normalizationJson.requirements_normalized) result.requirements = normalizationJson.requirements_normalized;
        if (normalizationJson.operational_outputs) result.operational_outputs = { ...result.operational_outputs, ...normalizationJson.operational_outputs };

        // ── Stage 3: Risk Review ──
        const t3Start = Date.now();
        try {
            const riskUser = V2_RISK_REVIEW_USER_INSTRUCTION
                .replace('{extractionJson}', JSON.stringify(extractionJson, null, 2))
                .replace('{normalizationJson}', JSON.stringify(normalizationJson, null, 2))
                + (domainReinforcement ? `\n\n${domainReinforcement}` : '');

            const riskResp = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: [{ text: riskUser }] }],
                config: { systemInstruction: V2_RISK_REVIEW_PROMPT, temperature: 0.2, maxOutputTokens: 16384, responseMimeType: 'application/json' }
            }, 4, { tenantId: req.user.tenantId, operation: 'analysis_v3', metadata: { stage: 'risk_review' } });

            const riskJson = robustJsonParse(riskResp.text, 'V3-Risk');
            result.analysis_meta.workflow_stage_status.risk_review = 'done';
            modelsUsed.push('gemini-2.5-flash');
            if (riskJson.legal_risk_review) result.legal_risk_review = riskJson.legal_risk_review;
            if (riskJson.operational_outputs_risk) {
                if (riskJson.operational_outputs_risk.questions_for_consultor_chat) result.operational_outputs.questions_for_consultor_chat = riskJson.operational_outputs_risk.questions_for_consultor_chat;
                if (riskJson.operational_outputs_risk.possible_petition_routes) result.operational_outputs.possible_petition_routes = riskJson.operational_outputs_risk.possible_petition_routes;
            }
            logger.info(`[AI-V3] ✅ Etapa 3 em ${((Date.now() - t3Start) / 1000).toFixed(1)}s — ${(riskJson.legal_risk_review?.critical_points || []).length} riscos`);
        } catch (err: any) {
            result.analysis_meta.workflow_stage_status.risk_review = 'failed';
            result.confidence.warnings.push(`Etapa 3 falhou: ${err.message}`);
        }

        // ── Post-processing (identical to V2) ──
        const enforceResult = enforceSchema(result);
        if (enforceResult.corrections > 0) {
            result.confidence.warnings.push(`SchemaEnforcer: ${enforceResult.corrections} campo(s) padronizado(s)`);
            (result.analysis_meta as any).schema_enforcer = { corrections: enforceResult.corrections, details: enforceResult.details.slice(0, 20) };
        }

        const validation = validateAnalysisCompleteness(result);
        result.analysis_meta.workflow_stage_status.validation = validation.valid ? 'done' : 'failed';
        if (validation.issues.length > 0) result.confidence.warnings.push(...validation.issues);

        let ruleFindings: any[] = [];
        try { ruleFindings = executeRiskRules(result); } catch {}

        let qualityReport: any = null;
        try {
            qualityReport = evaluateAnalysisQuality(result, ruleFindings, result.analysis_meta.analysis_id);
            (result.analysis_meta as any).quality_report = { overallScore: qualityReport.overallScore, summary: qualityReport.summary };
        } catch {}

        // Confidence scoring (same as V2)
        const stagesDone = Object.values(result.analysis_meta.workflow_stage_status).filter(s => s === 'done').length;
        const qualityScore = qualityReport?.overallScore || 50;
        let combinedScore = Math.round(((stagesDone / 4) * 100 * 0.30) + (validation.confidence_score * 0.25) + (qualityScore * 0.25));
        const allReqArrays = Object.values(result.requirements || {}).flat() as any[];
        const principalReqs = allReqArrays.filter((r: any) => !r.entry_type || r.entry_type === 'exigencia_principal');
        const reqCount = principalReqs.length;
        const tracedCount = principalReqs.filter((r: any) => r.source_ref && r.source_ref !== 'referência não localizada').length;
        const traceRatio = reqCount > 0 ? tracedCount / reqCount : 0;
        if (reqCount >= 20 && traceRatio >= 0.7) combinedScore += 20;
        else if (reqCount >= 10 && traceRatio >= 0.5) combinedScore += 15;
        else if (reqCount >= 5) combinedScore += 10;
        const stagesFailed = Object.values(result.analysis_meta.workflow_stage_status).filter(s => s === 'failed').length;
        combinedScore = Math.max(stagesFailed === 0 ? 80 : 5, Math.min(100, combinedScore));
        result.confidence.overall_confidence = combinedScore >= 70 ? 'alta' : combinedScore >= 50 ? 'media' : 'baixa';
        (result.confidence as any).score_percentage = combinedScore;
        (result.confidence as any).traceability = { total_requirements: reqCount, traced_requirements: tracedCount, traceability_percentage: Math.round(traceRatio * 100) };

        const uniqueModels = [...new Set(modelsUsed)];
        result.analysis_meta.model_used = uniqueModels.join('+');
        (result.analysis_meta as any).prompt_version = V2_PROMPT_VERSION;
        (result.analysis_meta as any).pipeline_version = 'v3.0.0-zerox';

        // Legacy compat
        const parsePtBrDate = (d: string): string => {
            if (!d) return '';
            if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d;
            const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*(?:às\s+)?(\d{2}:\d{2})?/);
            return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00:00'}:00` : d;
        };

        const totalDuration = ((Date.now() - analysisStartTime) / 1000).toFixed(1);
        const totalReqs = Object.values(result.requirements).reduce((s, a) => s + a.length, 0);
        logger.info(`[AI-V3] ═══ PIPELINE V3 CONCLUÍDO ═══ ${totalDuration}s | zerox=${usedZerox} | ${totalReqs} exigências | Score: ${combinedScore}%`);

        const legacyCompat = {
            process: {
                title: (() => {
                    const mod = result.process_identification.modalidade || '';
                    const num = result.process_identification.numero_processo || result.process_identification.numero_edital || '';
                    const org = (result.process_identification.orgao || '').toUpperCase();
                    if (mod && num && org) return `${mod} ${num} - ${org}`;
                    return result.process_identification.objeto_resumido || num || 'Sem título';
                })(),
                summary: result.process_identification.objeto_completo || result.process_identification.objeto_resumido,
                modality: normalizeModality(result.process_identification.modalidade),
                object: result.process_identification.objeto_completo,
                agency: result.process_identification.orgao,
                portal: result.process_identification.portal_licitacao || '',
                estimatedValue: result.process_identification.valor_estimado_global || 0,
                sessionDate: parsePtBrDate(result.timeline.data_sessao),
                risk: (() => {
                    const cps = result.legal_risk_review?.critical_points || [];
                    if (cps.filter(cp => cp.severity === 'critica' || cp.severity === 'alta').length >= 2) return 'Crítico';
                    if (cps.filter(cp => cp.severity === 'critica' || cp.severity === 'alta').length >= 1) return 'Alto';
                    if (cps.filter(cp => cp.severity === 'media').length >= 2) return 'Médio';
                    return 'Baixo';
                })(),
                link: result.process_identification.link_sistema || undefined,
            },
            analysis: {
                fullSummary: `ANÁLISE V3 (Zerox) — ${result.process_identification.objeto_resumido}\nModelo: ${uniqueModels.join('+')}\nScore: ${combinedScore}%`,
                qualificationRequirements: Object.values(result.requirements).flat().map(r => `[${r.requirement_id}] ${r.title}: ${r.description}`).join('\n'),
            }
        };

        res.json({
            ...legacyCompat,
            schemaV2: result,
            _version: '3.0',
            _pipeline: 'zerox',
            _zerox_used: usedZerox,
            _pipeline_duration_s: parseFloat(totalDuration),
            _prompt_version: V2_PROMPT_VERSION,
            _model_used: uniqueModels.join('+'),
            _overall_confidence: result.confidence.overall_confidence
        });

    } catch (error: any) {
        logger.error(`[AI-V3] ERRO FATAL:`, error?.message || error);
        fs.appendFileSync(path.join(uploadDir, 'debug-analysis.log'), `[${new Date().toISOString()}] V3 Error: ${error?.message}\n`);
        res.status(500).json({ error: `Erro no pipeline V3: ${error?.message || 'Erro desconhecido'}`, schemaV2: result });
    }
});

export default router;
