// ── Sentry MUST be imported first for proper instrumentation ──
import { Sentry, sentryErrorHandler, captureError, setSentryUser } from '../lib/sentry';

import { robustJsonParse, robustJsonParseDetailed } from "../services/ai/parser.service";
import { callGeminiWithRetry } from "../services/ai/gemini.service";
import { ANALYZE_EDITAL_SYSTEM_PROMPT, USER_ANALYSIS_INSTRUCTION, EXTRACT_CERTIFICATE_SYSTEM_PROMPT, COMPARE_CERTIFICATE_SYSTEM_PROMPT, MASTER_PETITION_SYSTEM_PROMPT, PETITION_USER_INSTRUCTION, V2_EXTRACTION_PROMPT, V2_RISK_REVIEW_PROMPT, V2_EXTRACTION_USER_INSTRUCTION, V2_RISK_REVIEW_USER_INSTRUCTION, V2_PROMPT_VERSION, getDomainRoutingInstruction, NORM_CATEGORIES, MANUAL_EXTRACTION_ADDON } from "../services/ai/prompt.service";
import { ENGINEERING_PROPOSAL_SYSTEM_PROMPT, ENGINEERING_PROPOSAL_USER_INSTRUCTION } from "../services/ai/modules/prompts/engineeringPromptV1";
import { AnalysisSchemaV1, createEmptyAnalysisSchema } from "../services/ai/analysis-schema-v1";
import { fallbackToOpenAi, fallbackToOpenAiV2 } from "../services/ai/openai.service";
import { indexDocumentChunks, searchSimilarChunks } from "../services/ai/rag.service";
import { executeRiskRules } from "../services/ai/riskRulesEngine";
import { evaluateAnalysisQuality, validateAnalysisCompleteness } from "../services/ai/analysisQualityEvaluator";
import { enforceSchema } from "../services/ai/schemaEnforcer";
import { validateExtraction, getSurgicalPrompt } from "../services/ai/extractionValidator";
import { buildModuleContext, ModuleName } from "../services/ai/modules/moduleContextContracts";
import { CHAT_SYSTEM_PROMPT, CHAT_USER_INSTRUCTION } from "../services/ai/modules/prompts/chatPromptV2";
import { PETITION_SYSTEM_PROMPT, PETITION_USER_INSTRUCTION as PETITION_V2_USER_INSTRUCTION } from "../services/ai/modules/prompts/petitionPromptV2";
import { ORACLE_SYSTEM_PROMPT } from "../services/ai/modules/prompts/oraclePromptV2";
import { DECLARATION_SYSTEM_PROMPT } from "../services/ai/modules/prompts/declarationPromptV2";
import {
    parseAndSanitize as parseDeclaration,
    validateDeclaration,
    calculateQualityReport,
    hasCriticalIssues,
    summarizeReport,
    repairDeclaration,
    createGeminiRepairFn,
    FAMILY_LENGTH_CONSTRAINTS,
    DECLARATION_SEMANTIC_MAP,
    ANTI_GENERIC_PHRASES,
    validateAndFixTitle,
} from "../services/ai/declaration";
import type { AuthoritativeFacts, DeclarationFamily, DeclarationStyle } from "../services/ai/declaration";
import { evaluateModuleQuality } from "../services/ai/modules/moduleQualityEvaluator";
import { evaluateHumanReview } from "../services/ai/modules/humanReviewPolicy";
import { submitFeedback, getFeedbackByModule, getFeedbackStats, AIExecutionFeedback } from "../services/ai/governance/feedbackService";
import { generateSystemReport, recordExecution } from "../services/ai/governance/operationalMetrics";
import { registerInitialVersions, getAllVersions, getPromotionHistory } from "../services/ai/governance/versionGovernance";
import { generateImprovementInsights, convertFeedbackToGoldenCases } from "../services/ai/governance/improvementInsights";
import { createOrUpdateProfile, getProfile, getAllProfiles, createEmptyProfile, CompanyLicitationProfile } from "../services/ai/company/companyProfileService";
import { matchCompanyToEdital, calculateParticipationScore, generateActionPlan } from "../services/ai/strategy/participationEngine";
import { buildHybridContext } from "../services/ai/strategy/companyAwareContext";
import { generateCompanyInsights, recordMatchHistory } from "../services/ai/strategy/companyLearningInsights";
import { recordAnalysisTelemetry, getPipelineHealth, classifySafetyNets } from "../services/ai/telemetry/analysisTelemetry";
import { extractMarkdownFromMultiplePdfs, isZeroxAvailable } from "../services/ai/zeroxExtractor";
import { ALERT_TAXONOMY, getCategoriesBySeverity, DEFAULT_ENABLED_CATEGORIES } from "../services/monitoring/alertTaxonomy";
import { NotificationService } from "../services/monitoring/notification.service";
import { submitJob, getJob, listJobs, registerSSEClient, removeSSEClient, updateJobProgress, completeJob, failJob } from "../services/backgroundJobService";
import { registerJobHandler, startJobWorker } from "../services/backgroundJobWorker";
import { handleApiError } from "../middlewares/errorHandler";
import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import https from 'https';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import { GoogleGenAI, createPartFromUri } from '@google/genai';
import { uploadDir, initStoragePaths } from '../services/files.service';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { storageService } from '../storage';
import { createExtractorFromData } from 'node-unrar-js';
import { applySecurityMiddleware, authLimiter, aiLimiter, globalErrorHandler } from '../lib/security';
import { encryptCredential, decryptCredential, isEncrypted, isEncryptionConfigured } from '../lib/crypto';
import { requestLogger } from '../lib/requestLogger';
import { logger } from '../lib/logger';
import { getUsageSummary, getSystemUsageSummary } from '../lib/aiUsageTracker';
import { authenticateToken, requireAdmin, requireSuperAdmin } from '../middlewares/auth';
import authRoutes from '../routes/auth';
import adminRoutes from '../routes/admin';
import teamRoutes from '../routes/team';
import companiesRoutes from '../routes/companies';
import documentsRoutes from '../routes/documents';
import biddingsRoutes from '../routes/biddings';
import pncpRoutes from '../routes/pncp';
import {
    normalizeModality, normalizePortal, hasMonitorableDomain,
    detectPlatformFromLink, sanitizeBiddingData,
    MONITORABLE_DOMAINS, PLATFORM_DOMAINS
} from '../lib/biddingHelpers';

const router = express.Router();
router.post('/analyze', authenticateToken, aiLimiter, async (req: any, res) => {
    // ── SSE Setup ──
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
    });
    res.flushHeaders();

    const TOTAL_STEPS = 8;
    const sendProgress = (step: number, message: string, detail?: string) => {
        try {
            if (res.writableEnded || res.destroyed) return;
            res.write(`data: ${JSON.stringify({
                type: 'progress', step, total: TOTAL_STEPS, message, detail,
                percent: Math.round((step / TOTAL_STEPS) * 100)
            })}\n\n`);
        } catch (_) { /* connection closed */ }
    };
    const sendError = (error: string, details?: string) => {
        try {
            clearInterval(sseKeepAlive);
            if (res.writableEnded || res.destroyed) return;
            res.write(`data: ${JSON.stringify({ type: 'error', error, details })}\n\n`);
            res.end();
        } catch (_) { /* connection closed */ }
    };
    const sendResult = (payload: any) => {
        try {
            clearInterval(sseKeepAlive);
            if (res.writableEnded || res.destroyed) return;
            res.write(`data: ${JSON.stringify({ type: 'result', payload })}\n\n`);
            res.end();
        } catch (_) { /* connection closed */ }
    };

    // SSE keepalive: send a comment every 15s to prevent Railway/Nginx/browser from killing the connection
    const sseKeepAlive = setInterval(() => {
        try {
            if (res.writableEnded || res.destroyed) {
                clearInterval(sseKeepAlive);
                return;
            }
            res.write(`: keepalive ${new Date().toISOString()}\n\n`);
        } catch (_) {
            clearInterval(sseKeepAlive);
        }
    }, 15000);
    // Clean up on connection close
    res.on('close', () => clearInterval(sseKeepAlive));
    res.on('finish', () => clearInterval(sseKeepAlive));

    try {
        const { orgao_cnpj, ano, numero_sequencial, link_sistema } = req.body;
        if (!orgao_cnpj || !ano || !numero_sequencial) {
            return sendError('orgao_cnpj, ano e numero_sequencial são obrigatórios');
        }

        const agent = new https.Agent({ rejectUnauthorized: false });
        const JSZip = require('jszip');

        // 1. Fetch edital attachments from PNCP API (correct endpoint: /api/pncp/v1/)
        sendProgress(1, 'Buscando documentos no PNCP...', 'Consultando lista de anexos do edital');
        const arquivosUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${orgao_cnpj}/compras/${ano}/${numero_sequencial}/arquivos`;
        logger.info(`[PNCP-AI] Fetching attachments: ${arquivosUrl}`);

        let arquivos: any[] = [];
        let fetchError: string | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const arquivosRes = await axios.get(arquivosUrl, { httpsAgent: agent, timeout: 25000 } as any);
                arquivos = Array.isArray(arquivosRes.data) ? arquivosRes.data : [];
                logger.info(`[PNCP-AI] Found ${arquivos.length} attachments (attempt ${attempt + 1})`);
                fetchError = null;
                break;
            } catch (e: any) {
                fetchError = e.message || 'Erro desconhecido';
                const status = e?.response?.status;
                logger.warn(`[PNCP-AI] Attempt ${attempt + 1}/3 failed to fetch attachments (HTTP ${status || 'N/A'}): ${fetchError}`);
                // Don't retry on 404 (edital doesn't exist) or 400 (bad params)
                if (status === 404 || status === 400) break;
                if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt)));
            }
        }
        if (arquivos.length === 0 && fetchError) {
            return sendError(
                'Não foi possível acessar os documentos deste edital no PNCP.',
                `A API do PNCP retornou erro: ${fetchError}. URL: ${arquivosUrl}`
            );
        }

        // 2. Sort to prioritize: Edital (tipoDocumentoId=2) > Termo de Referência (4) > Others
        // Sort by legal/technical priority: Edital > TR > Projeto Básico > Planilhas > Proposta > Minuta > outros
        arquivos.sort((a: any, b: any) => {
            const nameScore = (name: string): number => {
                const n = (name || '').toLowerCase();
                if (n.includes('edital') && !n.includes('anexo')) return 0;
                if (n.includes('termo_referencia') || n.includes('termo de referencia') || n.includes('tr_') || (a.tipoDocumentoId === 4)) return 1;
                if (n.includes('projeto_basico') || n.includes('projeto basico')) return 2;
                if (n.includes('planilha') || n.includes('orcamento')) return 3;
                if (n.includes('proposta') || n.includes('modelo_proposta')) return 4;
                if (n.includes('etp') || n.includes('estudo_tecnico')) return 5;
                if (n.includes('minuta') || n.includes('contrato')) return 8;
                if (n.includes('anexo')) return 6;
                return 7;
            };
            const pa = (a.tipoDocumentoId === 2) ? -1 : nameScore(a.titulo || a.nomeArquivo || '');
            const pb = (b.tipoDocumentoId === 2) ? -1 : nameScore(b.titulo || b.nomeArquivo || '');
            return pa - pb;
        });

        // 3. Download and process files — SMART PDF FILTER
        // Only download PDFs that contribute to habilitação extraction
        const MAX_PDF_PARTS = 8; // Send top 8 most important docs to Stage 1 (Edital + TR + Planilha + Projeto Básico + etc)
        const MAX_TOTAL_PDF_SIZE_KB = 15000; // 15MB inline budget — base64 expands to ~20MB which is the REST limit
        let totalPdfSizeAccum = 0;
        const pdfParts: any[] = [];
        const rawPdfBuffers: Array<{ buffer: Buffer; fileName: string }> = []; // Raw buffers for Zerox (independent of inline/FilesAPI)
        const downloadedFiles: string[] = [];
        const discardedFiles: string[] = [];

        // Pre-filter: exclude templates, project drawings, and irrelevant attachments BEFORE download
        const EXCLUDE_PATTERNS = [
            // Templates / Modelos
            'modelo_proposta', 'modelo_de_proposta', 'modelo proposta',
            'modelo_recibo', 'modelo recibo', 'modelo_declarac', 'modelo declarac',
            'modelo_ata', 'modelo ata', 'modelo_contrato', 'modelo_carta',
            'carta_fian', 'carta fian',
            // Publicações / Atas / Avisos
            'aviso_publicac', 'aviso publicac', 'aviso_licitac',
            'aviso_de_licit', 'aviso de licit', 'aviso_licit',
            'aviso_de_publicac', 'aviso de publicac',
            'quadro_de_aviso', 'quadro de aviso',
            'd.o.u', 'diario_oficial', 'diario oficial',
            'retificac', 'errata', 'ata_sessao', 'ata_da_sessao',
            'comprovante', 'recibo_garantia', 'modelo_recibo_garantia',
            'minuta_contrato', 'minuta contrato', 'minuta_de_contrato',
            // Projetos de engenharia / plantas / memoriais / peças gráficas
            'projeto_arq', 'projeto arq', 'planta_', 'planta ',
            'memorial_descritivo', 'memorial descritivo',
            'croqui', 'layout_', 'layout ',
            'detalhamento_', 'det_arq', 'det arq',
            'pecas_graficas', 'pecas graficas', 'peas_grficas', 'peas_graficas',
            'desenho_tecnico', 'desenho tecnico', 'peca_grafica',
        ];

        // ── Smart-Sort: priorizar PDFs dentro de RAR/ZIP por relevância ──
        const ARCHIVE_EXCLUDE_PATTERNS = [
            'relatorio_fot', 'relatorio fot', 'relatório fot',
            'licenca_ambiental', 'licença ambiental', 'licenca ambiental',
            'art_de_projeto', 'art de projeto', 'anotacao_responsabilidade',
            'marco_zero', 'marco zero',
        ];

        const archivePriorityScore = (name: string): number => {
            const n = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            // Máxima prioridade: edital principal
            if ((n.includes('edital') || n.includes('edital_bll') || n.includes('edital bll')) && !n.includes('modelo')) return 0;
            if (n.includes('termo_referencia') || n.includes('termo de referencia') || n.includes('tr_')) return 1;
            if (n.includes('planilha') || n.includes('orcamento') || n.includes('orcamentaria')) return 2;
            if (n.includes('cronograma')) return 3;
            if (n.includes('bdi') || n.includes('encargos')) return 4;
            if (n.includes('composic')) return 5;
            if (n.includes('memoria') || n.includes('calculo')) return 6;
            if (n.includes('projeto_basico') || n.includes('projeto basico')) return 7;
            if (n.includes('etp') || n.includes('estudo_tecnico') || n.includes('estudo tecnico')) return 8;
            // Prioridade média: documentos complementares
            if (n.includes('memorial')) return 50;
            if (n.includes('projeto') || n.includes('pavimentac')) return 55;
            // Baixa prioridade: fotos, licenças, ARTs
            if (n.includes('relatorio_fot') || n.includes('relatorio fot') || n.includes('foto') || n.includes('marco_zero') || n.includes('marco zero')) return 90;
            if (n.includes('licenca') || n.includes('licença')) return 91;
            if (n.includes('art_') || n.includes('art ') || n.includes('anotacao')) return 92;
            return 40; // Default
        };

        // Keywords that indicate edital/TR content (should NOT be excluded even if "Outros Documentos")
        const ESSENTIAL_KEYWORDS = [
            'edital', 'termo_referencia', 'termo de referencia', 'tr_',
            'projeto_basico', 'projeto basico', 'projeto básico', 'planilha', 'orcamento', 'orçamento',
            'cronograma', 'bdi', 'etp', 'estudo_tecnico', 'estudo tecnico',
            'orcamentaria', 'orçamentária', 'quantitativo', 'sinapi', 'seinfra', 'composicao', 'composição',
        ];

        const filteredArquivos = arquivos.filter((arq: any) => {
            const name = (arq.titulo || arq.nomeArquivo || arq.nome || '').toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const tipoDesc = (arq.tipoDocumentoDescricao || '').toLowerCase();
            const tipoId = arq.tipoDocumentoId;

            // Rule 1: Exclude by explicit pattern match
            const isExcludedByPattern = EXCLUDE_PATTERNS.some(pat => name.includes(pat));
            if (isExcludedByPattern) {
                logger.info(`[PNCP-AI] 🚫 Excluído (template/padrão): "${arq.titulo}" (tipo: ${tipoDesc || tipoId})`);
                discardedFiles.push(`${arq.titulo} (excluído: template/padrão)`);
                return false;
            }


            // Rule 2: DISABLED — Generic "ANEXO I/II/III" files frequently ARE the
            // Projeto Básico / Planilha Orçamentária in engineering processes.
            // The priority sorting + MAX_PDF_PARTS limit already controls which docs
            // reach the AI. We only exclude by explicit EXCLUDE_PATTERNS (Rule 1).
            // Previously this discarded critical engineering documents.

            return true;
        });

        // ── BUILD FULL ATTACHMENT CATALOG (for Proposal module) ──
        // Classifies ALL files by purpose so they can be downloaded on demand later
        const classifyAttachment = (arq: any): string => {
            const n = (arq.titulo || arq.nomeArquivo || '').toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const tipoId = arq.tipoDocumentoId;
            if (tipoId === 2 || (n.includes('edital') && !n.includes('anexo'))) return 'edital';
            if (tipoId === 4 || n.includes('termo_referencia') || n.includes('tr_')) return 'termo_referencia';
            if (n.includes('planilha') || n.includes('orcamento') || n.includes('orçamento')) return 'planilha_orcamentaria';
            if (n.includes('cronograma')) return 'cronograma';
            if (n.includes('bdi') || n.includes('encargos')) return 'bdi_encargos';
            if (n.includes('modelo_proposta') || n.includes('modelo de proposta') || n.includes('modelo_carta')) return 'modelo_proposta';
            if (n.includes('modelo_recibo') || n.includes('modelo_garantia')) return 'modelo_documento';
            if (n.includes('minuta') || n.includes('contrato')) return 'minuta_contrato';
            if (n.includes('projeto') || n.includes('planta') || n.includes('memorial')) return 'projeto_engenharia';
            if (n.includes('aviso')) return 'aviso_publicacao';
            if (n.includes('composic') || n.includes('custo')) return 'composicao_custos';
            return 'anexo_geral';
        };

        const pncpAttachments = arquivos.map((arq: any) => {
            const name = arq.titulo || arq.nomeArquivo || arq.nome || 'arquivo';
            const purpose = classifyAttachment(arq);
            const isDownloaded = filteredArquivos.includes(arq);
            return {
                titulo: name,
                url: arq.url || arq.uri || '',
                tipoDocumentoId: arq.tipoDocumentoId,
                tipoDocumentoDescricao: arq.tipoDocumentoDescricao || '',
                purpose,
                downloaded: isDownloaded,
                sequencial: arq.sequencialDocumento || arq.sequencial || null,
                ativo: arq.statusAtivo ?? true,
            };
        });

        const purposeCounts = pncpAttachments.reduce((acc: Record<string, number>, a: any) => {
            acc[a.purpose] = (acc[a.purpose] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        logger.info(`[PNCP-AI] 📋 Catálogo completo: ${pncpAttachments.length} arquivos — ${JSON.stringify(purposeCounts)}`);

        logger.info(`[PNCP-AI] 📊 Filtro inteligente: ${arquivos.length} anexos → ${filteredArquivos.length} relevantes (${arquivos.length - filteredArquivos.length} excluídos)`);
        sendProgress(2, 'Baixando documentos...', `${filteredArquivos.length} arquivos relevantes de ${arquivos.length} total`);

        // Sort by priority: Edital > TR > Orçamento > Cronograma > rest
        filteredArquivos.sort((a: any, b: any) => {
            const nameA = a.titulo || a.nomeArquivo || a.nome || '';
            const nameB = b.titulo || b.nomeArquivo || b.nome || '';
            // Edital tipo always first
            const aIsEdital = ([1, 2].includes(a.tipoDocumentoId) || /edital/i.test(a.tipoDocumentoDescricao));
            const bIsEdital = ([1, 2].includes(b.tipoDocumentoId) || /edital/i.test(b.tipoDocumentoDescricao));
            if (aIsEdital && !bIsEdital) return -1;
            if (!aIsEdital && bIsEdital) return 1;
            return archivePriorityScore(nameA) - archivePriorityScore(nameB);
        });

        const downloadErrors: string[] = [];
        let dlIndex = 0;
        for (const arq of filteredArquivos) {
            const pdfPartsFull = pdfParts.length >= MAX_PDF_PARTS;
            let fileUrl = arq.url || arq.uri || '';
            if (fileUrl.includes('pncp-api/v1')) {
                fileUrl = fileUrl.replace('pncp-api/v1', 'api/pncp/v1');
            }
            const fileName = arq.titulo || arq.nomeArquivo || arq.nome || 'arquivo';
            if (!fileUrl || !arq.statusAtivo) continue;

            try {
                dlIndex++;
                sendProgress(2, `Baixando documento ${dlIndex}/${filteredArquivos.length}...`, `"${fileName}"`);
                logger.info(`[PNCP-AI] Downloading: "${fileName}" (tipo: ${arq.tipoDocumentoDescricao || arq.tipoDocumentoId}) from ${fileUrl}`);
                const fileRes = await axios.get(fileUrl, {
                    httpsAgent: agent,
                    timeout: 90000,
                    responseType: 'arraybuffer',
                    maxRedirects: 5,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/pdf,application/zip,application/x-rar-compressed,*/*'
                    }
                } as any);

                const buffer = Buffer.from(fileRes.data as ArrayBuffer);
                if (buffer.length === 0) continue;

                // Detect file type by magic bytes
                const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46; // %PDF
                const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B; // PK
                const isRar = buffer[0] === 0x52 && buffer[1] === 0x61 && buffer[2] === 0x72 && buffer[3] === 0x21; // Rar!

                if (isPdf) {
                    const MAX_INLINE_FILE_KB = 8000; // 8MB per file — keeps base64 under ~11MB per part
                    const bufferSizeKB = buffer.length / 1024;
                    
                    // Only add to pdfParts if we haven't reached the limit for Stage 1
                    if (!pdfPartsFull) {
                    if (bufferSizeKB > MAX_INLINE_FILE_KB) {
                        // Large PDF: use Gemini Files API (supports up to 50MB, works with scanned PDFs)
                        logger.info(`[PNCP-AI] ⚡ Arquivo grande (${Math.round(bufferSizeKB)}KB > ${MAX_INLINE_FILE_KB}KB). Usando Gemini Files API para upload...`);
                        try {
                            const apiKey = process.env.GEMINI_API_KEY;
                            if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');
                            const filesAi = new GoogleGenAI({ apiKey });
                            const tempFilePath = path.join(uploadDir, `temp_upload_${Date.now()}_${fileName.replace(/[^a-z0-9._-]/gi, '_')}`);
                            fs.writeFileSync(tempFilePath, buffer);
                            const uploadedFile = await filesAi.files.upload({
                                file: tempFilePath,
                                config: { mimeType: 'application/pdf', displayName: fileName }
                            });
                            // Clean up temp file
                            try { fs.unlinkSync(tempFilePath); } catch (_e) {}
                            if (uploadedFile && uploadedFile.uri) {
                                pdfParts.push(createPartFromUri(uploadedFile.uri, uploadedFile.mimeType || 'application/pdf'));
                                logger.info(`[PNCP-AI] ✅ Upload via Files API concluído: ${uploadedFile.name} (URI: ${uploadedFile.uri})`);
                            } else {
                                logger.warn(`[PNCP-AI] ⚠️ Files API não retornou URI para ${fileName}`);
                            }
                        } catch (e: any) {
                            logger.warn(`[PNCP-AI] ⚠️ Falha no upload via Files API para ${fileName}:`, e.message);
                        }
                        totalPdfSizeAccum += 1; // Files API handles storage; minimal budget impact
                    } else {
                        // Budget check: if inline budget exceeded, use Files API as fallback
                        if (totalPdfSizeAccum + bufferSizeKB > MAX_TOTAL_PDF_SIZE_KB && pdfParts.length > 0) {
                            logger.info(`[PNCP-AI] ⚡ Orçamento inline de ${MAX_TOTAL_PDF_SIZE_KB}KB atingido. Enviando "${fileName}" via Files API...`);
                            try {
                                const apiKey = process.env.GEMINI_API_KEY;
                                if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');
                                const filesAi = new GoogleGenAI({ apiKey });
                                const tempPath = path.join(uploadDir, `temp_overflow_${Date.now()}_${fileName.replace(/[^a-z0-9._-]/gi, '_')}`);
                                fs.writeFileSync(tempPath, buffer);
                                const uploadedFile = await filesAi.files.upload({
                                    file: tempPath,
                                    config: { mimeType: 'application/pdf', displayName: fileName }
                                });
                                try { fs.unlinkSync(tempPath); } catch (_e) {}
                                if (uploadedFile && uploadedFile.uri) {
                                    pdfParts.push(createPartFromUri(uploadedFile.uri, uploadedFile.mimeType || 'application/pdf'));
                                    logger.info(`[PNCP-AI] ✅ Overflow via Files API: ${uploadedFile.name}`);
                                }
                            } catch (e: any) {
                                logger.warn(`[PNCP-AI] ⚠️ Files API overflow falhou para ${fileName}:`, e.message);
                                discardedFiles.push(`${fileName} (${Math.round(bufferSizeKB)}KB)`);
                            }
                            totalPdfSizeAccum += 1;
                        } else {
                            totalPdfSizeAccum += bufferSizeKB;
                            pdfParts.push({ inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' } });
                        }
                    }
                    } else {
                        logger.info(`[PNCP-AI] 📁 Salvando "${fileName}" (${Math.round(bufferSizeKB)}KB) apenas no storage (limite de ${MAX_PDF_PARTS} docs para IA atingido)`);
                    }
                    
                    const safeFileName = `pncp_${req.user.tenantId}_${fileName.replace(/[^a-z0-9._-]/gi, '_')}`;
                    fs.writeFileSync(path.join(uploadDir, safeFileName), buffer);
                    // Always collect raw buffer for Zerox pre-processing (works with both inline AND FilesAPI PDFs)
                    rawPdfBuffers.push({ buffer, fileName });

                    let storageFileName = safeFileName;
                    try {
                        const up = await storageService.uploadFile({
                            originalname: safeFileName,
                            buffer: buffer,
                            mimetype: 'application/pdf'
                        } as any, req.user.tenantId);
                        storageFileName = up.fileName;
                    } catch (e) {
                        logger.error(`[PNCP-AI] Erro upload PDF Storage:`, e);
                    }

                    // Note: pdfParts is pushed either as text or inlineData above

                    downloadedFiles.push(storageFileName);
                    logger.info(`[PNCP-AI] ✅ PDF: ${fileName} saved as ${storageFileName} (${(buffer.length / 1024).toFixed(0)} KB)`);
                } else if (isZip) {
                    logger.info(`[PNCP-AI] 📦 ZIP detected: ${fileName} (${(buffer.length / 1024).toFixed(0)} KB) — extracting PDFs...`);
                    try {
                        const zip = await JSZip.loadAsync(buffer);
                        let zipEntries = Object.keys(zip.files).filter((name: string) => {
                            if (!name.toLowerCase().endsWith('.pdf') || zip.files[name].dir) return false;
                            const n = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                            const excluded = ARCHIVE_EXCLUDE_PATTERNS.some(pat => n.includes(pat));
                            if (excluded) { logger.info(`[PNCP-AI] 🚫 ZIP: Excluído "${name}" (padrão filtrado)`); discardedFiles.push(`${name} (ZIP, filtrado)`); }
                            return !excluded;
                        });
                        // Smart-sort: priorizar edital > TR > planilha > cronograma > BDI > resto
                        zipEntries.sort((a, b) => archivePriorityScore(a) - archivePriorityScore(b));
                        logger.info(`[PNCP-AI] ZIP contains ${zipEntries.length} PDF(s) (sorted): ${zipEntries.join(', ')}`);

                        for (const entryName of zipEntries) {
                            const pdfPartsFull = pdfParts.length >= MAX_PDF_PARTS;
                            const pdfBuffer = await zip.files[entryName].async('nodebuffer');
                            const entrySizeKB = pdfBuffer.length / 1024;
                            const MAX_SINGLE_FILE_KB = 8000;
                            
                            if (!pdfPartsFull) {
                                if (entrySizeKB > MAX_SINGLE_FILE_KB) {
                                    logger.info(`[PNCP-AI] ⚡ ZIP Entry grande (${Math.round(entrySizeKB)}KB), usando Gemini Files API...`);
                                    try {
                                        const apiKey = process.env.GEMINI_API_KEY;
                                        if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');
                                        const filesAi = new GoogleGenAI({ apiKey });
                                        const tempPath = path.join(uploadDir, `temp_zip_${Date.now()}_${entryName.replace(/[^a-z0-9._-]/gi, '_')}`);
                                        fs.writeFileSync(tempPath, pdfBuffer);
                                        const uploadedFile = await filesAi.files.upload({
                                            file: tempPath,
                                            config: { mimeType: 'application/pdf', displayName: entryName }
                                        });
                                        try { fs.unlinkSync(tempPath); } catch (_e) {}
                                        if (uploadedFile && uploadedFile.uri) {
                                            pdfParts.push(createPartFromUri(uploadedFile.uri, uploadedFile.mimeType || 'application/pdf'));
                                            logger.info(`[PNCP-AI] ✅ ZIP Entry via Files API: ${uploadedFile.name}`);
                                        }
                                    } catch (e: any) {
                                        logger.warn(`[PNCP-AI] ⚠️ Falha Files API para ZIP entry ${entryName}:`, e.message);
                                    }
                                    totalPdfSizeAccum += 1;
                                } else {
                                    if (pdfBuffer.length > 0) {
                                        if (totalPdfSizeAccum + entrySizeKB > MAX_TOTAL_PDF_SIZE_KB && pdfParts.length > 0) {
                                            logger.warn(`[PNCP-AI] \u26a0\ufe0f Orçamento de ${MAX_TOTAL_PDF_SIZE_KB}KB atingido. Apenas salvando no disco ZIP entry "${entryName}" (${Math.round(entrySizeKB)}KB)`);
                                        } else {
                                            totalPdfSizeAccum += entrySizeKB;
                                            pdfParts.push({
                                                inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' }
                                            });
                                        }
                                    }
                                }
                            } else {
                                logger.info(`[PNCP-AI] 📁 Salvando "${entryName}" (${Math.round(entrySizeKB)}KB) do ZIP apenas no storage (limite da IA atingido)`);
                            }

                            if (pdfBuffer.length > 0) {
                                const safeName = `pncp_${req.user.tenantId}_${entryName.replace(/[^a-z0-9._-]/gi, '_')}`;
                                fs.writeFileSync(path.join(uploadDir, safeName), pdfBuffer);

                                let storageFileName = safeName;
                                try {
                                    const up = await storageService.uploadFile({
                                        originalname: safeName,
                                        buffer: pdfBuffer,
                                        mimetype: 'application/pdf'
                                    } as any, req.user.tenantId);
                                    storageFileName = up.fileName;
                                } catch (e) {
                                    logger.error(`[PNCP-AI] Erro upload ZIP-PDF Storage:`, e);
                                }
                                downloadedFiles.push(storageFileName);
                                logger.info(`[PNCP-AI] ✅ Extracted from ZIP: ${entryName} saved as ${storageFileName} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);
                            }
                        }
                    } catch (zipErr: any) {
                        logger.warn(`[PNCP-AI] Failed to extract ZIP ${fileName}: ${zipErr.message}`);
                    }
                } else if (isRar) {
                    logger.info(`[PNCP-AI] 📦 RAR detected: ${fileName} (${(buffer.length / 1024).toFixed(0)} KB) — extracting PDFs...`);
                    try {
                        const extractor = await createExtractorFromData({ data: new Uint8Array(buffer).buffer });
                        const extracted = extractor.extract({});
                        const files = [...extracted.files];
                        const pdfFiles = files.filter(f => {
                            if (!f.fileHeader.name.toLowerCase().endsWith('.pdf')) return false;
                            if (f.fileHeader.flags.directory || !f.extraction) return false;
                            const n = f.fileHeader.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                            const excluded = ARCHIVE_EXCLUDE_PATTERNS.some(pat => n.includes(pat));
                            if (excluded) { logger.info(`[PNCP-AI] 🚫 RAR: Excluído "${f.fileHeader.name}" (padrão filtrado)`); discardedFiles.push(`${f.fileHeader.name} (RAR, filtrado)`); }
                            return !excluded;
                        });
                        // Smart-sort: priorizar edital > TR > planilha > cronograma > BDI > resto
                        pdfFiles.sort((a, b) => archivePriorityScore(a.fileHeader.name) - archivePriorityScore(b.fileHeader.name));
                        logger.info(`[PNCP-AI] RAR contains ${pdfFiles.length} PDF(s) (sorted): ${pdfFiles.map(f => f.fileHeader.name).join(', ')}`);

                        for (const rarFile of pdfFiles) {
                            const pdfPartsFull = pdfParts.length >= MAX_PDF_PARTS;
                            if (rarFile.extraction && rarFile.extraction.length > 0) {
                                const pdfBuffer = Buffer.from(rarFile.extraction);
                                const entrySizeKB = pdfBuffer.length / 1024;
                                const MAX_SINGLE_FILE_KB = 8000;
                                
                                if (!pdfPartsFull) {
                                    if (entrySizeKB > MAX_SINGLE_FILE_KB) {
                                        logger.info(`[PNCP-AI] ⚡ RAR Entry grande (${Math.round(entrySizeKB)}KB), usando Gemini Files API...`);
                                        try {
                                            const apiKey = process.env.GEMINI_API_KEY;
                                            if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');
                                            const filesAi = new GoogleGenAI({ apiKey });
                                            const tempPath = path.join(uploadDir, `temp_rar_${Date.now()}_${rarFile.fileHeader.name.replace(/[^a-z0-9._-]/gi, '_')}`);
                                            fs.writeFileSync(tempPath, pdfBuffer);
                                            const uploadedFile = await filesAi.files.upload({
                                                file: tempPath,
                                                config: { mimeType: 'application/pdf', displayName: rarFile.fileHeader.name }
                                            });
                                            try { fs.unlinkSync(tempPath); } catch (_e) {}
                                            if (uploadedFile && uploadedFile.uri) {
                                                pdfParts.push(createPartFromUri(uploadedFile.uri, uploadedFile.mimeType || 'application/pdf'));
                                                logger.info(`[PNCP-AI] ✅ RAR Entry via Files API: ${uploadedFile.name}`);
                                            }
                                        } catch (e: any) {
                                            logger.warn(`[PNCP-AI] ⚠️ Falha Files API para RAR entry ${rarFile.fileHeader.name}:`, e.message);
                                        }
                                        totalPdfSizeAccum += 1;
                                    } else {
                                        if (totalPdfSizeAccum + entrySizeKB > MAX_TOTAL_PDF_SIZE_KB && pdfParts.length > 0) {
                                            logger.warn(`[PNCP-AI] ⚠️ Orçamento de ${MAX_TOTAL_PDF_SIZE_KB}KB atingido. Apenas salvando no disco RAR entry "${rarFile.fileHeader.name}" (${Math.round(entrySizeKB)}KB)`);
                                        } else {
                                            totalPdfSizeAccum += entrySizeKB;
                                            pdfParts.push({
                                                inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' }
                                            });
                                        }
                                    }
                                } else {
                                    logger.info(`[PNCP-AI] 📁 Salvando "${rarFile.fileHeader.name}" (${Math.round(entrySizeKB)}KB) do RAR apenas no storage (limite da IA atingido)`);
                                }

                                const safeName = `pncp_${req.user.tenantId}_${rarFile.fileHeader.name.replace(/[^a-z0-9._-]/gi, '_')}`;
                                fs.writeFileSync(path.join(uploadDir, safeName), pdfBuffer);

                                let storageFileName = safeName;
                                try {
                                    const up = await storageService.uploadFile({
                                        originalname: safeName,
                                        buffer: pdfBuffer,
                                        mimetype: 'application/pdf'
                                    } as any, req.user.tenantId);
                                    storageFileName = up.fileName;
                                } catch (e) {
                                    logger.error(`[PNCP-AI] Erro upload RAR-PDF Storage:`, e);
                                }
                                downloadedFiles.push(storageFileName);
                                logger.info(`[PNCP-AI] ✅ Extracted from RAR: ${rarFile.fileHeader.name} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);
                            }
                        }
                    } catch (rarErr: any) {
                        logger.warn(`[PNCP-AI] Failed to extract RAR ${fileName}: ${rarErr.message}`);
                    }
                } else {
                    logger.info(`[PNCP-AI] ⏭️ Skipped non-PDF/non-ZIP/non-RAR: ${fileName} (first bytes: ${buffer[0].toString(16)} ${buffer[1].toString(16)})`);
                }
            } catch (dlErr: any) {
                logger.warn(`[PNCP-AI] Failed to download ${fileName}: ${dlErr.message}`);
                const status = dlErr?.response?.status ? `HTTP ${dlErr.response.status}` : dlErr.code || 'Erro de rede';
                downloadErrors.push(`Falha ao baixar ${fileName}: ${status} - ${dlErr.message}`);
            }
        }

        if (pdfParts.length === 0) {
            const discardInfo = discardedFiles.length > 0 ? ` ${discardedFiles.length} excluído(s) por filtro inteligente.` : '';
            const errList = downloadErrors.length > 0 ? ` Problemas de rede/bloqueio: ${downloadErrors.join(' | ')}` : '';
            return sendError(
                'Nenhum arquivo PDF utilizável encontrado para este edital no PNCP.',
                `Encontramos ${arquivos.length} arquivo(s) na API, ${filteredArquivos.length} passou(aram) no filtro, mas nenhum download resultou em PDF válido.${discardInfo}${errList}`
            );
        }

        // ═══════════════════════════════════════════════════════════════════════
        // V2 PIPELINE — 3-Stage Analysis (migrated from /api/analyze-edital/v2)
        // ═══════════════════════════════════════════════════════════════════════
        
        // ── MODEL CONFIGURATION (V5.0 — simplified) ──
        // V5.0: Only 2 AI stages remain (extraction + risk review)
        // Normalization is 100% server-side, re-extraction eliminated
        const PIPELINE_MODELS = {
            extraction: 'gemini-2.5-flash',         // Etapa 1: PDF parsing (multimodal)
            riskReview: 'gemini-2.5-flash',          // Etapa 3: text-only risk analysis
        };
        logger.info(`[PNCP-V2] 🤖 V5.0 Modelos: E1=${PIPELINE_MODELS.extraction} | E3=${PIPELINE_MODELS.riskReview} (norm=server-side, re-extraction=eliminada)`);

        sendProgress(3, 'Documentos prontos para análise', `${pdfParts.length} PDFs`);

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return sendError('GEMINI_API_KEY não configurada');
        }
        const ai = new GoogleGenAI({ apiKey });
        const analysisStartTime = Date.now();

        // Initialize V2 result schema
        const v2Result = createEmptyAnalysisSchema();
        v2Result.analysis_meta.analysis_id = `pncp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        v2Result.analysis_meta.generated_at = new Date().toISOString();
        v2Result.analysis_meta.source_files = downloadedFiles;
        v2Result.analysis_meta.source_type = 'pncp_download';

        let modelsUsed: string[] = [];
        const stageTimes: Record<string, number> = {};
        // Pipeline health tracking for honest confidence scoring
        const pipelineHealth = {
            parseRepairs: 0,
            fallbacksUsed: 0,
            stagesFailed: 0,
        };

        logger.info(`[PNCP-V2] ═══ PIPELINE INICIADO ═══ (${pdfParts.length} PDFs, ${downloadedFiles.join(', ')})`);

        // ── Stage 0.5: Zerox Pre-Processing (PDF → Markdown) ──
        // Convert PDFs to clean Markdown BEFORE sending to Gemini.
        // This reduces tokens by ~60%, eliminates timeouts, and improves extraction quality.
        let zeroxMarkdown: string | null = null;
        let zeroxUsed = false;
        // V5.3: ZEROX KILL SWITCH
        // Production data shows inlineData is vastly superior to Zerox.
        // Zerox (Test 1 & 2): 159s-285s, 29-34 items, 70% score.
        // inlineData (Test 3): 207s (incl 90s timeout wait), 59 items, 100% score.
        // Disabling Zerox forces the pipeline to use the inlineData path instantly.
        const zeroxAvailable = false;
        if (zeroxAvailable) {
            sendProgress(4, 'Pré-processando documentos (OCR)...', 'Convertendo PDFs para texto estruturado');
            try {
                if (rawPdfBuffers.length > 0) {
                    const zeroxResult = await extractMarkdownFromMultiplePdfs(rawPdfBuffers, {
                        concurrency: 5,
                        temperature: 0.1,
                    });
                    if (zeroxResult && zeroxResult.markdown.length > 200) {
                        zeroxMarkdown = zeroxResult.markdown;
                        zeroxUsed = true;
                        logger.info(`[PNCP-V2] ✅ Zerox: ${zeroxResult.totalPages} pgs, ${zeroxResult.markdown.length} chars em ${(zeroxResult.totalDurationMs / 1000).toFixed(1)}s (${zeroxResult.documentsProcessed}/${rawPdfBuffers.length} docs)`);
                    }
                } else {
                    logger.info(`[PNCP-V2] ⚠️ Zerox: nenhum buffer de PDF disponível para pré-processamento`);
                }
            } catch (zeroxErr: any) {
                logger.warn(`[PNCP-V2] ⚠️ Zerox falhou: ${zeroxErr.message} — usando PDF inline`);
            }
        }

        // ── Stage 1: Factual Extraction ──
        const pdfSizes = pdfParts.map((p: any, i: number) => {
            if (p.inlineData?.data) {
                const sizeKB = Math.round(Buffer.from(p.inlineData.data, 'base64').length / 1024);
                return `Doc${i + 1}: ${sizeKB}KB`;
            } else if (p.fileData?.fileUri) {
                return `Doc${i + 1}: FilesAPI`;
            } else {
                return `Doc${i + 1}: text`;
            }
        });
        const totalPdfSizeKB = pdfParts.reduce((sum: number, p: any) => {
            if (p.inlineData?.data) return sum + Buffer.from(p.inlineData.data, 'base64').length;
            return sum;
        }, 0) / 1024;
        const extractionMode = zeroxUsed ? 'ZEROX (texto)' : `PDF inline (${Math.round(totalPdfSizeKB)}KB)`;
        sendProgress(5, 'IA extraindo dados dos documentos...', `Etapa 1/3 — ${extractionMode}`);
        logger.info(`[PNCP-V2] ── Etapa 1/3: Extração Factual [${extractionMode}] (${pdfParts.length} docs — ${pdfSizes.join(', ')})...`);
        let extractionJson: any;
        const t1Start = Date.now();

        try {
            // If Zerox produced Markdown, send TEXT to Gemini (faster, cheaper)
            // Otherwise, fall back to sending raw PDF base64 inline
            const extractionUserPrompt = V2_EXTRACTION_USER_INSTRUCTION.replace('{domainReinforcement}', '');
            const extractionParts: any[] = zeroxUsed
                ? [{ text: `${extractionUserPrompt}\n\n── CONTEÚDO DO EDITAL (extraído via OCR de alta fidelidade) ──\n\n${zeroxMarkdown}` }]
                : [...pdfParts, { text: extractionUserPrompt }];

            const extractionResponse = await callGeminiWithRetry(ai.models, {
                model: PIPELINE_MODELS.extraction,
                contents: [{ role: 'user', parts: extractionParts }],
                config: {
                    systemInstruction: V2_EXTRACTION_PROMPT,
                    temperature: 0.05,
                    maxOutputTokens: 65536,
                    responseMimeType: 'application/json'
                }
            }, zeroxUsed ? 2 : 2, { tenantId: req.user.tenantId, operation: 'analysis', metadata: { stage: zeroxUsed ? 'zerox_extraction' : 'raw_extraction' } });
            const extractionText = extractionResponse.text;
            if (!extractionText) throw new Error('Etapa 1 retornou vazio');
            const parseResult1 = robustJsonParseDetailed(extractionText, 'PNCP-V2-Extraction');
            extractionJson = parseResult1.data;
            if (parseResult1.repaired) pipelineHealth.parseRepairs++;
            v2Result.analysis_meta.workflow_stage_status.extraction = 'done';
            modelsUsed.push(zeroxUsed ? `${PIPELINE_MODELS.extraction}(zerox)` : PIPELINE_MODELS.extraction);
            stageTimes.extraction = (Date.now() - t1Start) / 1000;
            (v2Result.analysis_meta as any).zerox_used = zeroxUsed;
            logger.info(`[PNCP-V2] ✅ Etapa 1 em ${stageTimes.extraction.toFixed(1)}s [${zeroxUsed ? 'ZEROX' : 'INLINE'}] — ${(extractionJson.evidence_registry || []).length} evidências, ${Object.values(extractionJson.requirements || {}).flat().length} exigências`);
        } catch (err: any) {
            const errMsg = err?.message || String(err);
            const isServiceOverload = errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('high demand') || errMsg.includes('429');
            logger.warn(`[PNCP-V2] ⚠️ Etapa 1 Gemini falhou (${isServiceOverload ? 'SOBRECARGA' : 'ERRO'}): ${errMsg}. Tentando OpenAI...`);
            pipelineHealth.fallbacksUsed++;
            try {
                const openAiResult = await fallbackToOpenAiV2({
                    systemPrompt: V2_EXTRACTION_PROMPT,
                    userPrompt: V2_EXTRACTION_USER_INSTRUCTION.replace('{domainReinforcement}', ''),
                    pdfParts,
                    temperature: 0.05,
                    maxTokens: 65536,
                    stageName: 'PNCP Etapa 1 (Extração)'
                });
                if (!openAiResult.text) throw new Error('OpenAI retornou vazio');
                extractionJson = robustJsonParse(openAiResult.text, 'PNCP-V2-Extraction-OpenAI');
                v2Result.analysis_meta.workflow_stage_status.extraction = 'done';
                modelsUsed.push(openAiResult.model);
                stageTimes.extraction = (Date.now() - t1Start) / 1000;
                logger.info(`[PNCP-V2] ✅ Etapa 1 via OpenAI em ${stageTimes.extraction.toFixed(1)}s`);
            } catch (openAiErr: any) {
                logger.error(`[PNCP-V2] ❌ Etapa 1 falhou (ambos modelos)`);
                // User-friendly error message that distinguishes service overload from document issues
                if (isServiceOverload) {
                    throw new Error(`A IA está temporariamente sobrecarregada (5 tentativas em ~90s). ` +
                        `Tente novamente em 1-2 minutos. O edital está salvo e será processado.`);
                }
                throw new Error(`Etapa 1 (Extração) falhou. Gemini: ${errMsg} | OpenAI: ${openAiErr.message}`);
            }
        }

        // Merge extraction into V2 result
        if (extractionJson.process_identification) v2Result.process_identification = extractionJson.process_identification;
        if (extractionJson.timeline) v2Result.timeline = extractionJson.timeline;
        if (extractionJson.participation_conditions) v2Result.participation_conditions = extractionJson.participation_conditions;
        if (extractionJson.requirements) v2Result.requirements = extractionJson.requirements;
        if (extractionJson.technical_analysis) v2Result.technical_analysis = extractionJson.technical_analysis;
        if (extractionJson.economic_financial_analysis) v2Result.economic_financial_analysis = extractionJson.economic_financial_analysis;
        if (extractionJson.proposal_analysis) v2Result.proposal_analysis = extractionJson.proposal_analysis;
        if (extractionJson.contractual_analysis) v2Result.contractual_analysis = extractionJson.contractual_analysis;
        if (extractionJson.evidence_registry) v2Result.evidence_registry = extractionJson.evidence_registry;

        // Diagnostic: check itens_licitados extraction
        const extractedItensFromStage1 = v2Result.proposal_analysis?.itens_licitados || [];
        const stage1ItensCount = Array.isArray(extractedItensFromStage1) ? extractedItensFromStage1.length : 0;
        logger.info(`[PNCP-V2] 📋 itens_licitados: ${stage1ItensCount} itens extraídos pela Etapa 1`);

        // ── ETAPA 1.5: EXTRAÇÃO DEDICADA DE PLANILHA ORÇAMENTÁRIA (ENGENHARIA) ──
        // A E1 extrai itens em formato genérico (itemNumber, description, unit, referencePrice).
        // O módulo de engenharia precisa de metadados ricos: sourceCode (SINAPI/SEINFRA),
        // sourceName, type (ETAPA/SUBETAPA/COMPOSICAO), e insumos detalhados.
        // Portanto, para processos de engenharia, SEMPRE executamos a E1.5 — ela não compete
        // com a E1, ela ENRIQUECE os dados com metadados que só o prompt especializado extrai.
        const detectedTipoObjeto = (extractionJson.process_identification?.tipo_objeto || '').toLowerCase();
        const isEngineeringProcess = detectedTipoObjeto.includes('engenharia') || detectedTipoObjeto.includes('obra');

        if (isEngineeringProcess) {
            // ═══════════════════════════════════════════════════════════════
            // E1.5-A ASYNC: Extração de engenharia desacoplada do pipeline principal
            // 
            // MOTIVO: A extração de 250+ itens com códigos (SINAPI/SEINFRA) de PDFs 
            // de 22MB leva 200-300s. Isso bloqueava o pipeline por 5-9 minutos.
            // Resultados de 7 rodadas: apenas 29% de sucesso com timeout síncrono.
            // 
            // NOVA ABORDAGEM: O pipeline retorna as funções vitais em ~200s.
            // Um background job processa a planilha SEM timeout de race.
            // Quando completa, auto-atualiza o schemaV2 e notifica via SSE.
            // ═══════════════════════════════════════════════════════════════
            logger.info(`[PNCP-V2] 🏗️ Engenharia detectada (tipo=${detectedTipoObjeto}). Extração de planilha será feita em BACKGROUND (sem bloqueio).`);
            
            // Flag para disparar job APÓS o pipeline salvar o resultado
            (v2Result as any)._pendingEngineeringExtraction = true;
            
            // Collect PDF URLs for the background job
            const planilhaUrls = pncpAttachments
                .filter((a: any) => a.ativo && a.url && (
                    a.purpose === 'planilha_orcamentaria' ||
                    a.purpose === 'composicao_custos' ||
                    a.purpose === 'anexo_geral'
                ))
                .map((a: any) => a.url);
            (v2Result as any)._engineeringPdfUrls = planilhaUrls;
            
            // Inform the user
            if (!v2Result.confidence.warnings) v2Result.confidence.warnings = [];
            v2Result.confidence.warnings.push(
                'Planilha orçamentária de engenharia será extraída em background (~3-5 min). ' +
                'Você será notificado quando estiver pronta.'
            );
            sendProgress(5, 'Engenharia detectada — extração de planilha em background', 'Etapa 1.5 — Background Job');
        }

        // ── MANDATORY RFT COMPLETENESS INJECTION ──
        // The AI model consistently omits "obvious" fiscal documents (CNPJ, inscrições).
        // This server-side safety net ensures they're always present.
        const rftItems = Array.isArray((extractionJson.requirements as any)?.regularidade_fiscal_trabalhista)
            ? (extractionJson.requirements as any).regularidade_fiscal_trabalhista as any[]
            : [];
        const rftTexts = rftItems.map((r: any) => `${r.title || ''} ${r.description || ''}`.toLowerCase()).join(' ');

        // Find an existing source_ref from RFT items to reuse
        const existingRftSourceRef = rftItems.find((r: any) => r.source_ref && r.source_ref !== 'referência não localizada')?.source_ref || 'Edital, seção de habilitação';

        const mandatoryRftDocs = [
            {
                keywords: ['cnpj', 'cadastro nacional'],
                item: { requirement_id: 'RFT-CNPJ', title: 'Prova de inscrição no CNPJ', description: 'Comprovação de inscrição e situação cadastral no Cadastro Nacional da Pessoa Jurídica (CNPJ)', obligation_type: 'obrigatoria_universal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: existingRftSourceRef, entry_type: 'exigencia_principal' }
            },
            {
                keywords: ['inscrição estadual', 'inscricao estadual', 'cadastro estadual'],
                item: { requirement_id: 'RFT-IE', title: 'Inscrição estadual no cadastro de contribuintes', description: 'Prova de inscrição no cadastro de contribuintes estadual, relativo ao domicílio ou sede do licitante, pertinente ao seu ramo de atividade', obligation_type: 'se_aplicavel', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: existingRftSourceRef, entry_type: 'exigencia_principal' }
            },
            {
                keywords: ['inscrição municipal', 'inscricao municipal', 'cadastro municipal'],
                item: { requirement_id: 'RFT-IM', title: 'Inscrição municipal no cadastro de contribuintes', description: 'Prova de inscrição no cadastro de contribuintes municipal, relativo ao domicílio ou sede do licitante, pertinente ao seu ramo de atividade', obligation_type: 'se_aplicavel', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: existingRftSourceRef, entry_type: 'exigencia_principal' }
            },
        ];

        let injectedCount = 0;
        for (const doc of mandatoryRftDocs) {
            const alreadyExists = doc.keywords.some(kw => rftTexts.includes(kw));
            if (!alreadyExists) {
                // CNPJ is always mandatory; inscrições only if edital has habilitação section
                const isCnpj = doc.item.requirement_id === 'RFT-CNPJ';
                const hasHabilitacao = rftItems.length > 0; // If there are ANY RFT items, habilitação exists
                if (isCnpj || hasHabilitacao) {
                    rftItems.push(doc.item);
                    injectedCount++;
                }
            }
        }

        if (injectedCount > 0) {
            (extractionJson.requirements as any).regularidade_fiscal_trabalhista = rftItems;
            (v2Result.requirements as any).regularidade_fiscal_trabalhista = rftItems;
            logger.info(`[PNCP-V2] 🔧 RFT completude: +${injectedCount} doc(s) injetado(s) (CNPJ/inscrições omitidos pela IA)`);
        }

        // ── M3: DEDUP — remove generic "estadual ou municipal" if IE/IM are separate ──
        const hasIE = rftItems.some((r: any) => r.requirement_id === 'RFT-IE' || /inscri[çc][ãa]o\s+estadual/i.test(r.title || ''));
        const hasIM = rftItems.some((r: any) => r.requirement_id === 'RFT-IM' || /inscri[çc][ãa]o\s+municipal/i.test(r.title || ''));
        if (hasIE && hasIM) {
            // Remove generic combined IE+IM items ("estadual ou municipal" / "estadual e municipal")
            const beforeLen = rftItems.length;
            const dedupedRft = rftItems.filter((r: any) => {
                const title = (r.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const isGenericCombined = (title.includes('estadual') && title.includes('municipal'))
                    && r.requirement_id !== 'RFT-IE' && r.requirement_id !== 'RFT-IM';
                return !isGenericCombined;
            });
            if (dedupedRft.length < beforeLen) {
                (extractionJson.requirements as any).regularidade_fiscal_trabalhista = dedupedRft;
                (v2Result.requirements as any).regularidade_fiscal_trabalhista = dedupedRft;
                logger.info(`[PNCP-V2] 🧹 Dedup IE/IM: removido(s) ${beforeLen - dedupedRft.length} item(ns) genérico(s) (IE+IM separados existem)`);
            }
        }
        // ── HARD FAILURE GATE: Check extraction quality ──
        const extractedReqs = Object.values(extractionJson.requirements || {}).flat().length;
        const extractedEvidence = (extractionJson.evidence_registry || []).length;
        const hasProcessId = !!(extractionJson.process_identification?.objeto_resumido || extractionJson.process_identification?.objeto_completo);

        // Log detailed per-category extraction
        if (extractionJson.requirements) {
            const catCounts = Object.entries(extractionJson.requirements)
                .map(([cat, items]: [string, any]) => `${cat}: ${Array.isArray(items) ? items.length : 0}`)
                .join(' | ');
            logger.info(`[PNCP-V2] 📋 Exigências por categoria: ${catCounts}`);
        }
        logger.info(`[PNCP-V2] 📊 Extração: ${extractedReqs} exigências, ${extractedEvidence} evidências, processo=${hasProcessId}`);

        // ── ANTI-HALLUCINATION GATE (V4.7.1) ──
        // Detect when the AI generates template/example data from prompt examples
        // instead of reading the actual PDF documents.
        const hallucinationSignals: string[] = [];
        const processId = extractionJson.process_identification || {};
        const allProcessText = [
            processId.orgao, processId.objeto_resumido, processId.objeto_completo,
            processId.municipio_uf, processId.link_sistema, processId.fonte_oficial,
        ].filter(Boolean).join(' ').toLowerCase();

        // Known template/example patterns from prompt examples and taxonomy
        const HALLUCINATION_PATTERNS = [
            { pattern: /prefeitura\s+municipal\s+de\s+exemplo/i, label: 'orgão fictício "Prefeitura Municipal de Exemplo"' },
            { pattern: /exemplo\.gov/i, label: 'URL fictícia "exemplo.gov"' },
            { pattern: /exemplo\/ex\b/i, label: 'UF fictícia "EX"' },
            { pattern: /\bmunicípio\s+de\s+exemplo\b/i, label: 'município fictício "Exemplo"' },
            { pattern: /\borgão\s+de\s+exemplo\b/i, label: 'órgão fictício' },
            { pattern: /\bcidade\s+exemplo\b/i, label: 'cidade fictícia' },
        ];

        for (const hp of HALLUCINATION_PATTERNS) {
            if (hp.pattern.test(allProcessText)) {
                hallucinationSignals.push(hp.label);
            }
        }

        // Additional check: if ALL source_refs are generic "Edital, item X.X" with sequential numbering
        // AND the orgao contains "Exemplo" — strong hallucination signal
        const evidences = extractionJson.evidence_registry || [];
        if (evidences.length > 0) {
            const genericRefCount = evidences.filter((e: any) => /^Edital,\s*item\s+\d+\.\d+$/i.test(e.source_ref || '')).length;
            if (genericRefCount === evidences.length && hallucinationSignals.length > 0) {
                hallucinationSignals.push('todas as referências são genéricas "Edital, item X.X"');
            }
        }

        if (hallucinationSignals.length > 0) {
            logger.error(`[PNCP-V2] 🚨 ALUCINAÇÃO DETECTADA: ${hallucinationSignals.join(', ')}`);
            logger.error(`[PNCP-V2] 🚨 A IA gerou dados de TEMPLATE em vez de ler o PDF real. Abortando análise.`);
            v2Result.analysis_meta.workflow_stage_status.extraction = 'failed';
            return sendError(
                'Alucinação detectada — a IA não conseguiu ler os documentos',
                `A IA gerou dados fictícios (${hallucinationSignals.join('; ')}) em vez de extrair do edital real. ` +
                    `Isso geralmente ocorre quando o PDF está protegido, escaneado sem OCR, ou houve falha de comunicação com a IA. ` +
                    `Tente novamente em alguns minutos.`
            );
        }

        // Hard failure: Extraction returned materially empty content
        const MIN_REQUIREMENTS = 3;
        const MIN_EVIDENCE = 1;
        if (extractedReqs < MIN_REQUIREMENTS && extractedEvidence < MIN_EVIDENCE && !hasProcessId) {
            logger.error(`[PNCP-V2] ❌ FALHA FACTUAL DURA: ${extractedReqs} exigências (mín: ${MIN_REQUIREMENTS}), ${extractedEvidence} evidências (mín: ${MIN_EVIDENCE}), sem identificação do processo`);
            v2Result.analysis_meta.workflow_stage_status.extraction = 'failed';
            const totalDuration = ((Date.now() - analysisStartTime) / 1000).toFixed(1);
            return sendError(
                'Extração factual insuficiente',
                `A IA não conseguiu extrair dados suficientes dos ${pdfParts.length} documento(s). ` +
                    `Foram encontradas apenas ${extractedReqs} exigência(s) e ${extractedEvidence} evidência(s). ` +
                    `Isso pode indicar que os documentos estão escaneados com baixa qualidade, protegidos, ou em formato não-textual.`
            );
        }

        // Soft warning: Low quality extraction (still continues)
        if (extractedReqs < MIN_REQUIREMENTS || extractedEvidence < MIN_EVIDENCE) {
            logger.warn(`[PNCP-V2] ⚠️ Extração abaixo do ideal: ${extractedReqs} exigências, ${extractedEvidence} evidências — pipeline continua com degradação`);
            v2Result.confidence.warnings.push(`Extração com qualidade reduzida: ${extractedReqs} exigências, ${extractedEvidence} evidências`);
            if (extractedReqs < MIN_REQUIREMENTS) {
                v2Result.confidence.warnings.push(`Extração retornou apenas ${extractedReqs} exigência(s) — possível truncamento ou PDF protegido`);
            }
        }

        // Domain Routing
        const detectedObjectType = v2Result.process_identification?.tipo_objeto || 'outro';
        const domainReinforcement = getDomainRoutingInstruction(detectedObjectType);
        if (domainReinforcement) {
            logger.info(`[PNCP-V2] 🎯 Roteamento por tipo: ${detectedObjectType}`);
        }

        // ── V5.0 S4: Structural Validation + Surgical Re-Extraction ──
        // ExtractionValidator detects gaps deterministically. When critical gaps exist
        // (e.g., QEF/QTO/QTP empty for engineering), a SINGLE focused AI call (~3-5s)
        // is made with a category-specific prompt. Unlike V4's re-extraction (which used
        // the same generic prompt that already failed), these surgical prompts are short,
        // keyword-driven, and tell the AI exactly what section to look for.
        const validationResult = validateExtraction(extractionJson, detectedObjectType);
        const extractionGaps = validationResult.gaps;

        // Store gaps in metadata for confidence scoring
        (v2Result.analysis_meta as any).extraction_gaps = extractionGaps;

        if (validationResult.requiresReExtraction && validationResult.reExtractionTargets.length > 0) {
            sendProgress(5, 'Re-extração cirúrgica de categorias faltantes...', `${validationResult.reExtractionTargets.length} categoria(s)`);
            const tReExtStart = Date.now();
            const surgicalTasks = validationResult.reExtractionTargets.slice(0, 3).map(async (category) => {
                const surgicalPrompt = getSurgicalPrompt(category);
                if (!surgicalPrompt) return { category, success: false, reason: 'no prompt' };

                try {
                    const resp = await callGeminiWithRetry(ai.models, {
                        model: PIPELINE_MODELS.extraction,
                        contents: [{ role: 'user', parts: [...pdfParts, { text: surgicalPrompt }] }],
                        config: {
                            temperature: 0.05,
                            maxOutputTokens: 8192,
                            responseMimeType: 'application/json'
                        }
                    }, 2, { tenantId: req.user.tenantId, operation: 'analysis', metadata: { stage: 'surgical-reextraction', category } });

                    const text = resp.text;
                    if (!text) return { category, success: false, reason: 'empty response' };
                    const parsed = robustJsonParseDetailed(text, `Surgical-${category}`);
                    if (parsed.repaired) pipelineHealth.parseRepairs++;
                    const data = parsed.data;

                    // Merge surgical results into extractionJson
                    const catItems = data[category];
                    if (Array.isArray(catItems) && catItems.length > 0) {
                        const existingItems = (extractionJson.requirements as any)?.[category] || [];
                        if (catItems.length > existingItems.length) {
                            // Surgical extraction found MORE items — replace
                            (extractionJson.requirements as any)[category] = catItems;
                            logger.info(`[PNCP-V2] 🔬 Surgical ${category}: ${catItems.length} itens (era ${existingItems.length})`);
                        }
                    }

                    // Merge indices_exigidos if available
                    if (category === 'qualificacao_economico_financeira' && Array.isArray(data.indices_exigidos) && data.indices_exigidos.length > 0) {
                        if (!extractionJson.economic_financial_analysis) extractionJson.economic_financial_analysis = {};
                        if (!Array.isArray(extractionJson.economic_financial_analysis.indices_exigidos) || extractionJson.economic_financial_analysis.indices_exigidos.length === 0) {
                            extractionJson.economic_financial_analysis.indices_exigidos = data.indices_exigidos;
                            logger.info(`[PNCP-V2] 🔬 Surgical QEF: ${data.indices_exigidos.length} índice(s) extraído(s)`);
                        }
                    }

                    // Merge evidence
                    if (Array.isArray(data.evidence_registry)) {
                        extractionJson.evidence_registry = [...(extractionJson.evidence_registry || []), ...data.evidence_registry];
                    }

                    return { category, success: true, items: catItems?.length || 0 };
                } catch (err: any) {
                    logger.warn(`[PNCP-V2] ⚠️ Surgical ${category} falhou: ${err.message}`);
                    return { category, success: false, reason: err.message };
                }
            });

            const surgicalResults = await Promise.allSettled(surgicalTasks);
            const successCount = surgicalResults.filter(r => r.status === 'fulfilled' && (r.value as any)?.success).length;
            stageTimes.surgical_reextraction = (Date.now() - tReExtStart) / 1000;
            logger.info(`[PNCP-V2] 🔬 Re-extração cirúrgica em ${stageTimes.surgical_reextraction.toFixed(1)}s — ${successCount}/${validationResult.reExtractionTargets.length} categorias recuperadas`);

            // Re-validate after surgical extraction
            const postSurgicalValidation = validateExtraction(extractionJson, detectedObjectType);
            (v2Result.analysis_meta as any).post_surgical_gaps = postSurgicalValidation.gaps.length;
        } else if (extractionGaps.length > 0) {
            logger.info(`[PNCP-V2] 📋 ${extractionGaps.length} gap(s) detectado(s) — sem re-extração necessária (SchemaEnforcer cuidará)`);
            v2Result.confidence.warnings.push(`Extração omitiu dados em ${extractionGaps.length} ponto(s) — dados complementados automaticamente`);
        }

        // ── V5.0: Stage 2 (Server-Side Norm) → Stage 3 (Risk Review, SEQUENTIAL) ──
        // V4.x ran normalization AI calls + risk review in parallel, but risk review
        // received '{}' for normalization data. V5.0 makes ALL normalization server-side
        // (<100ms) and runs risk review AFTER, so it gets real normalized data.
        sendProgress(6, 'Normalizando exigências...', 'Etapa 2/3 — normalização server-side');
        logger.info(`[PNCP-V2] ── Etapa 2/3: Normalização 100% server-side (V5.0)...`);
        let normalizationJson: any = {};
        const t2t3Start = Date.now();

        // ── Stage 2: ALL-SERVER-SIDE Normalization (V5.0 — zero AI calls) ──
        const t2Start = Date.now();
        const mergedRequirements: Record<string, any[]> = {};
        const mergedDocs: any[] = [];
        let totalNormalized = 0;
        let categoriesSkipped = 0;

        // Responsible area mapping per category
        const RESPONSIBLE_AREAS: Record<string, string> = {
            'habilitacao_juridica': 'juridico',
            'regularidade_fiscal_trabalhista': 'contabil',
            'qualificacao_economico_financeira': 'contabil',
            'qualificacao_tecnica_operacional': 'engenharia',
            'qualificacao_tecnica_profissional': 'engenharia',
            'proposta_comercial': 'comercial',
            'documentos_complementares': 'licitacoes',
        };

        // Risk defaults per category
        const RISK_DEFAULTS: Record<string, string> = {
            'habilitacao_juridica': 'inabilitacao',
            'regularidade_fiscal_trabalhista': 'inabilitacao',
            'qualificacao_economico_financeira': 'inabilitacao',
            'qualificacao_tecnica_operacional': 'inabilitacao',
            'qualificacao_tecnica_profissional': 'inabilitacao',
            'proposta_comercial': 'desclassificacao',
            'documentos_complementares': 'inabilitacao',
        };

        // Phase defaults
        const PHASE_DEFAULTS: Record<string, string> = {
            'habilitacao_juridica': 'habilitacao',
            'regularidade_fiscal_trabalhista': 'habilitacao',
            'qualificacao_economico_financeira': 'habilitacao',
            'qualificacao_tecnica_operacional': 'habilitacao',
            'qualificacao_tecnica_profissional': 'habilitacao',
            'proposta_comercial': 'proposta',
            'documentos_complementares': 'habilitacao',
        };

        for (const cat of NORM_CATEGORIES) {
            const items = Array.isArray((extractionJson.requirements as any)?.[cat.key])
                ? (extractionJson.requirements as any)[cat.key]
                : [];

            if (items.length === 0) {
                mergedRequirements[cat.key] = [];
                categoriesSkipped++;
                continue;
            }

            // V5.0: ALL categories use deterministic server-side normalization
            const riskDefault = RISK_DEFAULTS[cat.key] || 'inabilitacao';
            const phaseDefault = PHASE_DEFAULTS[cat.key] || 'habilitacao';
            const responsibleArea = RESPONSIBLE_AREAS[cat.key] || 'licitacoes';

            const normalized = items.map((item: any, idx: number) => ({
                ...item,
                requirement_id: item.requirement_id || `${cat.prefix}-${String(idx + 1).padStart(2, '0')}`,
                entry_type: item.entry_type || 'exigencia_principal',
                risk_if_missing: item.risk_if_missing || riskDefault,
                applies_to: item.applies_to || 'licitante',
                obligation_type: item.obligation_type || 'obrigatoria_universal',
                phase: item.phase || phaseDefault,
                source_ref: item.source_ref || 'referência não localizada',
            }));

            mergedRequirements[cat.key] = normalized;
            totalNormalized += normalized.length;

            // Generate documents_to_prepare for principal requirements
            normalized.filter((n: any) => n.entry_type === 'exigencia_principal').forEach((n: any) => {
                mergedDocs.push({
                    document_name: n.title || n.requirement_id,
                    category: cat.key,
                    priority: n.risk_if_missing === 'inabilitacao' || n.risk_if_missing === 'desclassificacao' ? 'critica' : 'alta',
                    responsible_area: responsibleArea,
                    notes: ''
                });
            });

            logger.info(`[PNCP-V2] ⚡ FastNorm ${cat.prefix}: ${normalized.length} itens (server-side)`);
        }

        stageTimes.normalization = (Date.now() - t2Start) / 1000;
        logger.info(`[PNCP-V2] ✅ Etapa 2 em ${stageTimes.normalization.toFixed(1)}s — ${totalNormalized} itens normalizados, ⚡ALL server-side (0 API calls)`);

        // Build normalization result
        normalizationJson = {
            requirements_normalized: mergedRequirements,
            operational_outputs: {
                documents_to_prepare: mergedDocs,
            },
            confidence: {
                overall_confidence: 'alta',
                section_confidence: {} as any,
                warnings: [],
            }
        };

        // Merge normalization into v2Result immediately (so Stage 3 can see it)
        if (normalizationJson.requirements_normalized) {
            v2Result.requirements = normalizationJson.requirements_normalized;
        }
        if (normalizationJson.operational_outputs) {
            v2Result.operational_outputs = { ...v2Result.operational_outputs, ...normalizationJson.operational_outputs };
        }
        v2Result.analysis_meta.workflow_stage_status.normalization = 'done';

        // ── Stage 3 (Risk Review) + Stage 1.5 (Item Extraction) — PARALLEL ──
        // V5.0: Risk review now runs AFTER normalization, with REAL normalized data
        sendProgress(7, 'Avaliando riscos e extraindo itens...', 'Etapas 3/3 + itens em paralelo');
        const extractionJsonCompact = JSON.stringify(extractionJson);
        const normalizationJsonCompact = JSON.stringify(normalizationJson);

        const [riskSettled, itemsSettled] = await Promise.allSettled([
            // ── Stage 3: Risk Review (now with real normalization data) ──
            (async () => {
                const t3Start = Date.now();
                const riskUserInstruction = V2_RISK_REVIEW_USER_INSTRUCTION
                    .replace('{extractionJson}', extractionJsonCompact)
                    .replace('{normalizationJson}', normalizationJsonCompact)  // V5.0: REAL data instead of '{}'
                    + (domainReinforcement ? `\n\n${domainReinforcement}` : '');
                try {
                    const riskResponse = await callGeminiWithRetry(ai.models, {
                        model: PIPELINE_MODELS.riskReview,
                        contents: [{ role: 'user', parts: [{ text: riskUserInstruction }] }],
                        config: {
                            systemInstruction: V2_RISK_REVIEW_PROMPT,
                            temperature: 0.2,
                            maxOutputTokens: 16384,
                            responseMimeType: 'application/json'
                        }
                    }, 4, { tenantId: req.user.tenantId, operation: 'analysis', metadata: { stage: 'risk-review' } });
                    const riskText = riskResponse.text;
                    if (!riskText) throw new Error('Etapa 3 retornou vazio');
                    const parseR = robustJsonParseDetailed(riskText, 'PNCP-V2-RiskReview');
                    const json = parseR.data;
                    stageTimes.risk_review = (Date.now() - t3Start) / 1000;
                    logger.info(`[PNCP-V2] ✅ Etapa 3 em ${stageTimes.risk_review.toFixed(1)}s — ${(json.legal_risk_review?.critical_points || []).length} pontos críticos`);
                    return { json, model: PIPELINE_MODELS.riskReview, repaired: parseR.repaired, fallback: false };
                } catch (err: any) {
                    logger.warn(`[PNCP-V2] ⚠️ Etapa 3 Gemini falhou: ${err.message}. Tentando OpenAI...`);
                    const openAiResult = await fallbackToOpenAiV2({
                        systemPrompt: V2_RISK_REVIEW_PROMPT,
                        userPrompt: riskUserInstruction,
                        temperature: 0.2,
                        stageName: 'PNCP Etapa 3 (Risco)'
                    });
                    if (!openAiResult.text) throw new Error('OpenAI retornou vazio');
                    const parseROai = robustJsonParseDetailed(openAiResult.text, 'PNCP-V2-RiskReview-OpenAI');
                    const json = parseROai.data;
                    stageTimes.risk_review = (Date.now() - t3Start) / 1000;
                    logger.info(`[PNCP-V2] ✅ Etapa 3 via OpenAI em ${stageTimes.risk_review.toFixed(1)}s`);
                    return { json, model: openAiResult.model, repaired: parseROai.repaired, fallback: true };
                }
            })(),

            // ── Stage 1.5: Parallel Item Extraction (runs concurrently with 3) ──
            // When itens_licitados is empty AND we have planilha-like PDFs in the catalog,
            // download and extract items NOW instead of waiting for ai-populate
            (async () => {
                const currentItens = v2Result.proposal_analysis?.itens_licitados || [];
                // Skip if E1.5-A (engineering path) already populated items, OR if E1 found items
                if (Array.isArray(currentItens) && currentItens.length > 0) {
                    logger.info(`[PNCP-V2] ⚡ Etapa 1.5-B SKIP — itens_licitados já tem ${currentItens.length} itens`);
                    return { items: currentItens, skipped: true };
                }
                // Also skip for engineering processes — E1.5-A handles those with the specialized prompt
                if (isEngineeringProcess) {
                    logger.info(`[PNCP-V2] ⚡ Etapa 1.5-B SKIP — processo de engenharia já tratado pela E1.5-A`);
                    return { items: [], skipped: true };
                }

                // Find planilha/budget PDFs from catalog (including excluded-due-to-size ones)
                const planilhaAttachments = pncpAttachments.filter((a: any) =>
                    a.ativo && a.url && (
                        a.purpose === 'planilha_orcamentaria' ||
                        a.purpose === 'composicao_custos' ||
                        a.purpose === 'anexo_geral' ||
                        a.purpose === 'termo_referencia'
                    )
                );

                if (planilhaAttachments.length === 0) {
                    logger.info(`[PNCP-V2] ⚡ Etapa 1.5 SKIP — sem planilhas no catálogo`);
                    return { items: [], skipped: true };
                }

                logger.info(`[PNCP-V2] 📋 Etapa 1.5: Extraindo itens de ${planilhaAttachments.length} PDF(s) em paralelo...`);
                const t15Start = Date.now();

                try {
                    // Download the first planilha PDF (prioritize: planilha > composicao > anexo > TR)
                    const priorityOrder = ['planilha_orcamentaria', 'composicao_custos', 'anexo_geral', 'termo_referencia'];
                    const sorted = planilhaAttachments.sort((a: any, b: any) => 
                        priorityOrder.indexOf(a.purpose) - priorityOrder.indexOf(b.purpose)
                    );
                    const target = sorted[0];
                    
                    const agent15 = new (require('https').Agent)({ rejectUnauthorized: false });
                    const pdfResp = await axios.get(target.url, { 
                        responseType: 'arraybuffer', 
                        httpsAgent: agent15, 
                        timeout: 30000,
                        maxContentLength: 50 * 1024 * 1024 // 50MB max
                    } as any);
                    const pdfBuffer = Buffer.from(pdfResp.data as ArrayBuffer);
                    logger.info(`[PNCP-V2] 📋 Etapa 1.5: PDF "${target.titulo}" (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);

                    const itemExtractionPrompt = `Você é um extrator de itens de planilhas orçamentárias de licitações brasileiras.

Analise o PDF e extraia TODOS os itens/lotes com preço.

Para CADA item extraia:
- itemNumber: número do item/lote
- description: descrição técnica COMPLETA (NÃO resuma)
- unit: unidade de medida (UN, KG, M², M³, ML, MÊS, HORA, DIA, DIÁRIA, KM, LITRO, CJ, VB, SV)
- quantity: quantidade numérica
- referencePrice: valor unitário de referência/estimado (número, sem R$)
- multiplier: se há período (ex: 12 meses), retorne o multiplicador
- multiplierLabel: rótulo do multiplicador (ex: "Meses")

REGRAS:
- Extraia APENAS itens PRINCIPAIS (totalizadores), NÃO sub-itens de composição
- referencePrice é NUMÉRICO (ex: 15000.00, não "R$ 15.000,00")
- Se não encontrar itens com preço, retorne array vazio []
- NUNCA invente itens

Responda APENAS com JSON array:
[{"itemNumber":"1","description":"...","unit":"UN","quantity":1,"referencePrice":0,"multiplier":1,"multiplierLabel":""}]`;

                    const itemResult = await callGeminiWithRetry(ai.models, {
                        model: 'gemini-2.5-flash',
                        contents: [{
                            role: 'user',
                            parts: [
                                { inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' } },
                                { text: itemExtractionPrompt }
                            ]
                        }],
                        config: { temperature: 0.05, maxOutputTokens: 16384 }
                    }, 4, { tenantId: req.user.tenantId, operation: 'analysis', metadata: { stage: 'item_extraction' } });

                    const responseText = itemResult.text?.trim() || '';
                    let jsonStr = responseText;
                    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
                    if (jsonMatch) jsonStr = jsonMatch[0];
                    
                    let items: any[] = [];
                    try { items = JSON.parse(jsonStr); } catch { items = []; }
                    
                    // Filter valid items
                    items = items.filter((it: any) => it.description && it.description.trim().length > 5);
                    
                    const elapsed = ((Date.now() - t15Start) / 1000).toFixed(1);
                    logger.info(`[PNCP-V2] ✅ Etapa 1.5 em ${elapsed}s — ${items.length} itens extraídos de "${target.titulo}"`);
                    
                    return { items, skipped: false, source: target.titulo, elapsed };
                } catch (err: any) {
                    logger.warn(`[PNCP-V2] ⚠️ Etapa 1.5 falhou: ${err.message}`);
                    return { items: [], skipped: false, error: err.message };
                }
            })()
        ]);

        logger.info(`[PNCP-V2] Etapas 2+3 concluídas em ${((Date.now() - t2t3Start) / 1000).toFixed(1)}s (norm: server-side <100ms, risk: AI call)`);

        // Process risk review result
        if (riskSettled.status === 'fulfilled') {
            const riskJson = riskSettled.value.json;
            v2Result.analysis_meta.workflow_stage_status.risk_review = 'done';
            modelsUsed.push(riskSettled.value.model);
            if (riskSettled.value.repaired) pipelineHealth.parseRepairs++;
            if (riskSettled.value.fallback) pipelineHealth.fallbacksUsed++;
            if (riskJson.legal_risk_review) v2Result.legal_risk_review = riskJson.legal_risk_review;
            if (riskJson.operational_outputs_risk) {
                if (riskJson.operational_outputs_risk.questions_for_consultor_chat) {
                    v2Result.operational_outputs.questions_for_consultor_chat = riskJson.operational_outputs_risk.questions_for_consultor_chat;
                }
                if (riskJson.operational_outputs_risk.possible_petition_routes) {
                    v2Result.operational_outputs.possible_petition_routes = riskJson.operational_outputs_risk.possible_petition_routes;
                }
            }
            if (riskJson.confidence_update) {
                v2Result.confidence.section_confidence.risk_review = riskJson.confidence_update.risk_review || 'media';
            }
        } else {
            logger.error(`[PNCP-V2] ❌ Etapa 3 falhou — continuando sem revisão de risco`);
            v2Result.analysis_meta.workflow_stage_status.risk_review = 'failed';
            v2Result.confidence.warnings.push(`Etapa 3 (Risco) falhou: ${riskSettled.reason?.message || 'erro desconhecido'}`);
            stageTimes.risk_review = stageTimes.risk_review || 0;
        }

        // Process item extraction result (Etapa 1.5)
        if (itemsSettled.status === 'fulfilled' && !itemsSettled.value.skipped) {
            const extractedItems = itemsSettled.value.items || [];
            if (extractedItems.length > 0) {
                if (!v2Result.proposal_analysis) v2Result.proposal_analysis = {} as any;
                v2Result.proposal_analysis.itens_licitados = extractedItems;
                stageTimes.item_extraction = parseFloat(itemsSettled.value.elapsed || '0');
                logger.info(`[PNCP-V2] ✅ Etapa 1.5 merge: ${extractedItems.length} itens → proposal_analysis.itens_licitados`);
            }
        } else if (itemsSettled.status === 'rejected') {
            logger.warn(`[PNCP-V2] ⚠️ Etapa 1.5 rejected: ${itemsSettled.reason?.message || 'erro'}`);
        }

        // ── Schema Sanitization: Safe defaults for all arrays/collections ──
        // Prevents "Cannot read properties of undefined (reading 'length')" crashes
        const reqCategories = ['habilitacao_juridica', 'regularidade_fiscal_trabalhista', 'qualificacao_economico_financeira',
            'qualificacao_tecnica_operacional', 'qualificacao_tecnica_profissional', 'proposta_comercial', 'documentos_complementares'];
        if (!v2Result.requirements) v2Result.requirements = {} as any;
        for (const cat of reqCategories) {
            if (!Array.isArray((v2Result.requirements as any)[cat])) {
                (v2Result.requirements as any)[cat] = [];
            }
        }
        if (!Array.isArray(v2Result.evidence_registry)) v2Result.evidence_registry = [];
        if (!v2Result.legal_risk_review) v2Result.legal_risk_review = { critical_points: [], ambiguities: [], inconsistencies: [], omissions: [], possible_restrictive_clauses: [], points_for_impugnation_or_clarification: [] } as any;
        if (!Array.isArray(v2Result.legal_risk_review.critical_points)) v2Result.legal_risk_review.critical_points = [];
        if (!v2Result.operational_outputs) v2Result.operational_outputs = { documents_to_prepare: [], internal_checklist: [], questions_for_consultor_chat: [], possible_petition_routes: [] } as any;
        if (!v2Result.confidence) v2Result.confidence = { overall_confidence: 'baixa', section_confidence: {} as any, warnings: [] } as any;
        if (!Array.isArray(v2Result.confidence.warnings)) v2Result.confidence.warnings = [];
        if (!v2Result.economic_financial_analysis) v2Result.economic_financial_analysis = { indices_exigidos: [] } as any;
        if (!Array.isArray(v2Result.economic_financial_analysis.indices_exigidos)) v2Result.economic_financial_analysis.indices_exigidos = [];
        if (!v2Result.technical_analysis) v2Result.technical_analysis = { parcelas_relevantes: [] } as any;
        if (!Array.isArray(v2Result.technical_analysis.parcelas_relevantes)) v2Result.technical_analysis.parcelas_relevantes = [];

        // Record discarded files in analysis metadata
        if (discardedFiles.length > 0) {
            (v2Result.analysis_meta as any).discarded_files = discardedFiles;
            v2Result.confidence.warnings.push(`${discardedFiles.length} anexo(s) ignorado(s) por limite de tamanho: ${discardedFiles.join(', ')}`);
        }

        // ── Schema Enforcement (Level 1, 2, 3) — ANTES da validação ──
        // Corrige campos vazios com defaults inteligentes, normaliza formatos,
        // e injeta categorias faltantes. Beneficia todos os 8 módulos downstream.
        const enforceResult = enforceSchema(v2Result);
        if (enforceResult.corrections > 0) {
            v2Result.confidence.warnings.push(
                `SchemaEnforcer: ${enforceResult.corrections} campo(s) padronizado(s) automaticamente`
            );
            (v2Result.analysis_meta as any).schema_enforcer = {
                corrections: enforceResult.corrections,
                details: enforceResult.details.slice(0, 20),
            };
        }

        // ── Validation (no AI) ──
        const validation = validateAnalysisCompleteness(v2Result);
        v2Result.analysis_meta.workflow_stage_status.validation = validation.valid ? 'done' : 'failed';
        if (validation.issues.length > 0) {
            v2Result.confidence.warnings.push(...validation.issues);
        }

        // ── Risk Rules Engine ──
        let ruleFindings: any[] = [];
        try {
            ruleFindings = executeRiskRules(v2Result);
            if (ruleFindings.length > 0) {
                (v2Result.analysis_meta as any).rule_findings = ruleFindings;
            }
        } catch (ruleErr: any) {
            logger.warn(`[PNCP-V2] Motor de regras falhou: ${ruleErr.message}`);
        }

        // ── Quality Evaluator ──
        let qualityReport: any = null;
        try {
            qualityReport = evaluateAnalysisQuality(v2Result, ruleFindings, v2Result.analysis_meta.analysis_id);
            (v2Result.analysis_meta as any).quality_report = {
                overallScore: qualityReport.overallScore,
                categoryScores: qualityReport.categoryScores,
                issueCount: qualityReport.issues.length,
                summary: qualityReport.summary
            };
        } catch (qualErr: any) {
            logger.warn(`[PNCP-V2] Avaliador de qualidade falhou: ${qualErr.message}`);
        }

        // ── Confidence Score V3.0 (V5.0 — penalizes safety-nets and extraction gaps) ──
        // V2.5 inflated scores by measuring post-safety-net output (97% on poor extraction).
        // V3.0 penalizes: safety-net injections, category gaps, source_ref monotonicity.
        const stagesDone = Object.values(v2Result.analysis_meta.workflow_stage_status).filter(s => s === 'done').length;
        const stagesTotal = 4;
        const stageScore = (stagesDone / stagesTotal) * 100;
        const qualityScore = qualityReport?.overallScore || 50;
        // Base: stages 30% + validation 25% + quality 25%
        let combinedScore = Math.round((stageScore * 0.30) + (validation.confidence_score * 0.25) + (qualityScore * 0.25));

        // Traceability assessment
        const evidenceCount = v2Result.evidence_registry?.length || 0;
        const allReqArrays = Object.values(v2Result.requirements || {}).flat() as any[];
        const principalReqs = allReqArrays.filter((r: any) => !r.entry_type || r.entry_type === 'exigencia_principal');
        const requirementCount = principalReqs.length;
        const tracedCount = principalReqs.filter((r: any) => r.source_ref && r.source_ref !== 'referência não localizada' && r.source_ref.trim() !== '').length;
        const traceabilityRatio = requirementCount > 0 ? tracedCount / requirementCount : 0;

        // Bônus de excelência: análises ricas recebem até 20% extra
        if (requirementCount >= 20 && traceabilityRatio >= 0.7) {
            combinedScore += 20;
        } else if (requirementCount >= 10 && traceabilityRatio >= 0.5) {
            combinedScore += 15;
        } else if (requirementCount >= 5) {
            combinedScore += 10;
        }

        // V3.0: Safety-net penalty (-5 per injection, max -25)
        const safetyNetCount = enforceResult.safety_net_count || 0;
        if (safetyNetCount > 0) {
            const safetyPenalty = Math.min(safetyNetCount * 5, 25);
            combinedScore -= safetyPenalty;
            v2Result.confidence.warnings.push(`${safetyNetCount} exigência(s) injetada(s) por safety-net — dados precisam validação manual`);
        }

        // V3.0: Extraction gap penalty (from gap detection phase)
        if (extractionGaps.length > 0) {
            const criticalGaps = extractionGaps.filter(g => g.severity === 'critical').length;
            const highGaps = extractionGaps.filter(g => g.severity === 'high').length;
            const mediumGaps = extractionGaps.filter(g => g.severity === 'medium').length;
            combinedScore -= (criticalGaps * 15) + (highGaps * 8) + (mediumGaps * 3);
        }

        // V3.0: Source_ref monotonicity penalty
        const allRefs = allReqArrays.map((r: any) => r.source_ref).filter((s: any) => s && s !== 'referência não localizada');
        const uniqueRefs = new Set(allRefs);
        if (uniqueRefs.size <= 2 && allRefs.length >= 10) {
            combinedScore -= 15;
        }

        // Traceability penalty
        if (traceabilityRatio < 0.3 && requirementCount > 5) {
            combinedScore -= 5;
            v2Result.confidence.warnings.push(`Apenas ${Math.round(traceabilityRatio * 100)}% das exigências têm referência documental — rastreabilidade comprometida`);
        }

        // Parse repair penalty (3/repair, max -10)
        if (pipelineHealth.parseRepairs > 0) {
            const repairPenalty = Math.min(pipelineHealth.parseRepairs * 3, 10);
            combinedScore -= repairPenalty;
            v2Result.confidence.warnings.push(`${pipelineHealth.parseRepairs} reparos de JSON foram necessários`);
        }

        // Fallback penalty (5/fallback, max -12)
        if (pipelineHealth.fallbacksUsed > 0) {
            const fallbackPenalty = Math.min(pipelineHealth.fallbacksUsed * 5, 12);
            combinedScore -= fallbackPenalty;
            v2Result.confidence.warnings.push(`${pipelineHealth.fallbacksUsed} fallback(s) para OpenAI acionado(s)`);
        }

        // Stage failure penalty
        const stagesFailed = Object.values(v2Result.analysis_meta.workflow_stage_status).filter(s => s === 'failed').length;
        if (stagesFailed > 0) {
            combinedScore -= stagesFailed * 10;
        }

        // V3.0 Bônus: extração genuinamente rica SEM safety-nets
        if (safetyNetCount === 0 && requirementCount >= 15) {
            combinedScore += 10;
        }

        // V3.0: Floor lowered to 40% (allow honest low scores)
        // V2.5 used 80% floor which masked poor extractions
        const allStagesOk = stagesFailed === 0 && stagesDone === stagesTotal;
        const scoreFloor = allStagesOk ? 55 : 5;
        combinedScore = Math.max(scoreFloor, Math.min(100, combinedScore));

        // Confidence level V3.0
        if (combinedScore >= 85 && traceabilityRatio >= 0.5 && safetyNetCount <= 2) {
            v2Result.confidence.overall_confidence = 'alta';
        } else if (combinedScore >= 70) {
            v2Result.confidence.overall_confidence = 'alta';
        } else if (combinedScore >= 50) {
            v2Result.confidence.overall_confidence = 'media';
        } else {
            v2Result.confidence.overall_confidence = 'baixa';
        }
        (v2Result.confidence as any).score_percentage = combinedScore;
        (v2Result.confidence as any).pipeline_health = pipelineHealth;
        (v2Result.confidence as any).traceability = {
            total_requirements: requirementCount,
            traced_requirements: tracedCount,
            traceability_percentage: Math.round(traceabilityRatio * 100),
            evidence_registry_count: evidenceCount,
        };
        // V5.0: extraction_health — factual pipeline performance metrics
        (v2Result.confidence as any).extraction_health = {
            total_requirements: requirementCount,
            extracted_by_ai: requirementCount - safetyNetCount,
            injected_by_safety_net: safetyNetCount,
            safety_net_ratio: requirementCount > 0 ? Math.round((safetyNetCount / requirementCount) * 100) : 0,
            gaps_detected: extractionGaps.length,
            source_ref_unique_count: uniqueRefs.size,
            score_version: 'V3.0',
        };

        const uniqueModels = [...new Set(modelsUsed)];
        v2Result.analysis_meta.model_used = uniqueModels.join('+');
        (v2Result.analysis_meta as any).prompt_version = V2_PROMPT_VERSION;
        (v2Result.analysis_meta as any).models_per_stage = {
            extraction: modelsUsed[0] || 'failed',
            normalization: modelsUsed[1] || 'failed',
            risk_review: modelsUsed[2] || 'failed'
        };
        (v2Result.analysis_meta as any).stage_times = stageTimes;

        const totalDuration = ((Date.now() - analysisStartTime) / 1000).toFixed(1);
        const totalReqs = Object.values(v2Result.requirements).reduce((sum, arr) => sum + arr.length, 0);
        sendProgress(7, 'Validando completude da análise...', `${totalReqs} exigências, ${v2Result.evidence_registry.length} evidências`);
        logger.info(`[PNCP-V2] ═══ PIPELINE CONCLUÍDO ═══ ${totalDuration}s total | ` +
            `Modelos: ${uniqueModels.join('+')} | ` +
            `${totalReqs} exigências | ${v2Result.legal_risk_review.critical_points.length} riscos | ` +
            `${v2Result.evidence_registry.length} evidências | Score: ${combinedScore}% (${v2Result.confidence.overall_confidence})`);

        // ── Legacy V1 Compatibility ──
        // Build process/analysis format expected by frontend
        const allReqs = Object.entries(v2Result.requirements).reduce((acc: Record<string, any[]>, [cat, items]) => {
            acc[cat] = items.map((r: any) => ({ item: r.requirement_id, description: `${r.title}: ${r.description}` }));
            return acc;
        }, {} as Record<string, any[]>);

        // ── PNCP Metadata Enrichment: Fetch valorTotalEstimado from PNCP API ──
        let pncpApiValue = 0;
        let pncpApiSessionDate = '';
        try {
            const detailUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${orgao_cnpj}/compras/${ano}/${numero_sequencial}`;
            const detailRes = await axios.get(detailUrl, { httpsAgent: agent, timeout: 5000 } as any);
            const d: any = detailRes.data;
            if (d) {
                pncpApiValue = Number(d.valorTotalEstimado ?? d.valorTotalHomologado ?? d.valorGlobal ?? 0) || 0;
                // dataAberturaProposta = início do recebimento de propostas (NÃO é a sessão!)
                // dataInicioDisputa ou dataAberturaEdital são mais próximos da sessão real
                pncpApiSessionDate = d.dataInicioDisputa || d.dataAberturaEdital || '';
                logger.info(`[PNCP-V2] 💰 API metadata: valor=${pncpApiValue}, sessionDate=${pncpApiSessionDate || '(vazio)'}`);
            }
        } catch (e: any) {
            logger.warn(`[PNCP-V2] Failed to fetch PNCP metadata for value: ${e.message}`);
        }

        // Resolve estimatedValue: AI extraction > PNCP API > 0
        const aiExtractedValue = Number(v2Result.process_identification?.valor_estimado_global) || 0;
        const resolvedEstimatedValue = aiExtractedValue > 0 ? aiExtractedValue : pncpApiValue;
        logger.info(`[PNCP-V2] 💰 Valor resolução: AI=${aiExtractedValue}, API=${pncpApiValue}, final=${resolvedEstimatedValue}`);

        // Resolve sessionDate: AI timeline > PNCP API data_abertura
        const resolvedSessionDateRaw = v2Result.timeline.data_sessao || pncpApiSessionDate || '';

        // Convert Brazilian "DD/MM/AAAA às HH:MM" to ISO for frontend Date() compatibility
        const parseBrazilianDateToISO = (dateStr: string): string => {
            if (!dateStr) return '';
            // Already ISO? Return as-is
            if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr;
            // Parse "DD/MM/AAAA às HH:MM" or "DD/MM/AAAA HH:MM"
            const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(?:às\s+)?(\d{2}):(\d{2}))?/);
            if (match) {
                const [, day, month, year, hour = '00', minute = '00'] = match;
                return `${year}-${month}-${day}T${hour}:${minute}:00-03:00`;
            }
            return dateStr; // Can't parse, return as-is
        };
        const resolvedSessionDateISO = parseBrazilianDateToISO(resolvedSessionDateRaw);

        // ── SANITIZAÇÃO DO OBJETO (anti-poluição por Minuta) ──
        const sanitizeObjeto = (text: string): string => {
            if (!text) return '';
            let s = text
                .replace(/^TERMO DE CONTRATO QUE ENTRE SI FAZEM[\s\S]*?DECLARA:\s*/i, '')
                .replace(/^O presente contrato tem por objeto a execu..o dos servi.os de\s*\[espa.o em branco\]\s*conforme[\s\S]*?processo\.\s*/i, '')
                .replace(/\(Minuta,\s*Cl.usula[\s\S]*?\)\.\s*/gi, '')
                .replace(/\[espa.o em branco\]/gi, '')
                .replace(/\[nome[^\]]*\]/gi, '').replace(/\[CNPJ[^\]]*\]/gi, '')
                .replace(/\bXX\/\d{4}\b/g, '').trim();
            if (s.length < 20) return '';
            return s;
        };
        const rawObjResumo = v2Result.process_identification.objeto_resumido || '';
        const rawObjCompleto = v2Result.process_identification.objeto_completo || '';
        const cleanObjResumo = sanitizeObjeto(rawObjResumo);
        const cleanObjCompleto = sanitizeObjeto(rawObjCompleto);
        const bestObjResumo = cleanObjResumo || cleanObjCompleto.slice(0, 150) || rawObjResumo;
        const bestObjCompleto = cleanObjCompleto || cleanObjResumo || rawObjCompleto;
        let cleanNumProcesso = v2Result.process_identification.numero_processo || '';
        let cleanNumEdital = v2Result.process_identification.numero_edital || '';
        if (/XX\/\d{4}/.test(cleanNumProcesso)) cleanNumProcesso = '';
        if (/XX\/\d{4}/.test(cleanNumEdital)) cleanNumEdital = '';
        if (rawObjResumo !== bestObjResumo) {
            logger.info(`[PNCP-V2] 🧹 Sanitização anti-Minuta: obj "${rawObjResumo.slice(0,50)}..." → "${bestObjResumo.slice(0,50)}..."`);
        }
        const legacyProcess = {
            title: cleanNumEdital
                ? `${v2Result.process_identification.modalidade} ${cleanNumEdital} - ${v2Result.process_identification.orgao}`
                : bestObjResumo || '',
            summary: `${bestObjResumo || bestObjCompleto || ''}\n\n` +
                `Modalidade: ${v2Result.process_identification.modalidade || ''}\n` +
                `Critério: ${v2Result.process_identification.criterio_julgamento || ''}\n` +
                `Regime: ${v2Result.process_identification.regime_execucao || ''}\n` +
                `Município: ${v2Result.process_identification.municipio_uf || ''}\n` +
                `Sessão: ${resolvedSessionDateRaw}\n` +
                (v2Result.participation_conditions.exige_visita_tecnica ? `Visita Técnica: ${v2Result.participation_conditions.visita_tecnica_detalhes}\n` : '') +
                (v2Result.participation_conditions.exige_garantia_proposta ? `Garantia de Proposta: ${v2Result.participation_conditions.garantia_proposta_detalhes}\n` : '') +
                (v2Result.participation_conditions.exige_garantia_contratual ? `Garantia Contratual: ${v2Result.participation_conditions.garantia_contratual_detalhes}\n` : '') +
                `\n--- RISCOS CRÍTICOS (${v2Result.legal_risk_review.critical_points.length}) ---\n` +
                v2Result.legal_risk_review.critical_points.map(cp =>
                    `[${(cp.severity || '').toUpperCase()}] ${cp.title}: ${cp.description} → ${cp.recommended_action}`
                ).join('\n'),
            modality: normalizeModality(v2Result.process_identification.modalidade),
            portal: normalizePortal(v2Result.process_identification.fonte_oficial || 'PNCP', link_sistema),
            estimatedValue: resolvedEstimatedValue,
            risk: v2Result.legal_risk_review.critical_points.some(cp => cp.severity === 'critica') ? 'Crítico'
                : v2Result.legal_risk_review.critical_points.some(cp => cp.severity === 'alta') ? 'Alto'
                : v2Result.legal_risk_review.critical_points.length > 0 ? 'Médio' : 'Baixo',
            sessionDate: resolvedSessionDateISO,
            link_sistema: (() => {
                // Sanitize: strip generic ComprasNet links that are NOT actual monitoring URLs
                // Only cnetmobile.estaleiro.serpro.gov.br/...?compra=XXX is a valid monitoring link
                const rawLink = (v2Result.process_identification.link_sistema || '').trim();
                if (!rawLink) return '';
                const lower = rawLink.toLowerCase();
                const isGenericComprasNet = (
                    lower.includes('comprasnet.gov.br') ||
                    lower.includes('www.gov.br/compras') ||
                    lower.includes('compras.gov.br') && !lower.includes('cnetmobile')
                );
                if (isGenericComprasNet) {
                    logger.info(`[PNCP-V2] 🧹 Sanitização: link_sistema genérico removido: "${rawLink.substring(0, 60)}"`);
                    return '';
                }
                return rawLink;
            })()
        };

        // ── AUTO-ENRICH: Buscar link de monitoramento via API PNCP ──
        // Se link_sistema está vazio OU é genérico (sem parâmetros funcionais para chat monitor),
        // buscamos linkSistemaOrigem da API PNCP para TODAS as plataformas monitoráveis.
        // V4.6.0: Expandido para BLL, BNC, BBMNET, PCP, Licitanet, LMB (antes: só cnetmobile).
        const isAnalysisLinkFunctional = (() => {
            const l = (legacyProcess.link_sistema || '').toLowerCase();
            if (!l) return false;
            // BLL: functional links need param1= or ProcessView
            if ((l.includes('bllcompras') || l.includes('bll.org')) && !l.includes('param1=') && !l.includes('processview')) return false;
            // M2A: functional links need /certame/
            if (l.includes('m2atecnologia') && !l.includes('/certame/')) return false;
            // Generic domain-only links (e.g. "www.bll.org.br", "bllcompras.com") without path
            try {
                const url = new URL(l.startsWith('http') ? l : `https://${l}`);
                if (url.pathname === '/' || url.pathname === '' || url.pathname === '/Home/PublicAccess') return false;
            } catch { /* not a parseable URL, treat as non-functional */ return false; }
            return true;
        })();
        const needsAutoEnrich = (!legacyProcess.link_sistema || !isAnalysisLinkFunctional) && orgao_cnpj && ano && numero_sequencial;
        if (needsAutoEnrich) {
            try {
                const enrichUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${orgao_cnpj}/compras/${ano}/${numero_sequencial}`;
                logger.info(`[PNCP-V2] 🔍 Buscando linkSistemaOrigem: ${enrichUrl} (link_sistema=${legacyProcess.link_sistema ? 'genérico' : 'vazio'})`);
                const controller = new AbortController();
                const enrichTimeout = setTimeout(() => controller.abort(), 8000);
                const enrichRes = await fetch(enrichUrl, { signal: controller.signal });
                clearTimeout(enrichTimeout);
                if (enrichRes.ok) {
                    const enrichData = await enrichRes.json();
                    const lso = (enrichData.linkSistemaOrigem || '').trim();
                    if (lso && hasMonitorableDomain(lso)) {
                        legacyProcess.link_sistema = lso;
                        const platform = detectPlatformFromLink(lso) || 'desconhecida';
                        logger.info(`[PNCP-V2] ✅ linkSistemaOrigem enriquecido (${platform}): ${lso.substring(0, 80)}`);
                    } else {
                        logger.info(`[PNCP-V2] ⚠️ linkSistemaOrigem=${lso ? lso.substring(0, 60) : 'VAZIO'} → tentando Fallback B (edital)`);

                        // ── FALLBACK B: Construir URL ComprasNet a partir dos dados do edital ──
                        // Quando linkSistemaOrigem é null (ex: CE-SOP), o edital pode conter
                        // "UASG: 943001" e "Número Comprasnet: (95033/2026)" que são diferentes
                        // da unidade/número do PNCP (081401/202606994).
                        // Fórmula: UASG(6) + coModalidade(2) + nuCompra(5) + ano(4) = 17 dígitos
                        try {
                            // Fontes: (1) campo IA, (2) regex nos campos IA, (3) regex no PDF direto
                            const aiNumComprasnet = ((v2Result.process_identification as any).numero_comprasnet || '').trim();
                            const aiUasg = ((v2Result.process_identification as any).uasg_comprasnet || '').trim();
                            
                            const allTextFields = [
                                v2Result.process_identification.numero_edital || '',
                                v2Result.process_identification.numero_processo || '',
                                v2Result.process_identification.objeto_completo || '',
                                v2Result.process_identification.fonte_oficial || '',
                                v2Result.process_identification.unidade_compradora || '',
                            ].join(' ');

                            const aiModalidade = (v2Result.process_identification.modalidade || '').toLowerCase();
                            const pncpUasg = enrichData.unidadeOrgao?.codigoUnidade || '';
                            
                            // ── Resolução de numero_comprasnet ──
                            // Prioridade: campo IA > regex campos IA > regex PDF direto
                            let nuCompraRaw = aiNumComprasnet;
                            let compraAno = ano;
                            let resolvedUasg = aiUasg;
                            let extractionSrc = aiNumComprasnet ? 'AI' : '';
                            
                            if (!nuCompraRaw) {
                                const comprasnetMatch = allTextFields.match(/[Nn][uú]mero\s+[Cc]omprasnet\s*:?\s*\(?(\d{4,6})\s*[/\\]?\s*(\d{4})?\)?/);
                                if (comprasnetMatch) {
                                    nuCompraRaw = comprasnetMatch[1];
                                    compraAno = comprasnetMatch[2] || ano;
                                    extractionSrc = 'REGEX-FIELD';
                                }
                            }
                            
                            if (!resolvedUasg) {
                                const uasgMatch = allTextFields.match(/UASG\s*:?\s*(\d{6})/i);
                                if (uasgMatch) resolvedUasg = uasgMatch[1];
                            }
                            
                            // ── Fallback C: Extração direta do PDF via pdf-parse ──
                            // Se a IA e o regex nos campos IA falharam, buscar no texto bruto do PDF
                            if ((!nuCompraRaw || !resolvedUasg) && pdfParts.length > 0) {
                                try {
                                    const pdfParse = require('pdf-parse');
                                    const firstPdf = pdfParts[0];
                                    let pdfBuffer: Buffer | null = null;
                                    if (firstPdf?.inlineData?.data) {
                                        pdfBuffer = Buffer.from(firstPdf.inlineData.data, 'base64');
                                    }
                                    if (pdfBuffer) {
                                        const pdfData = await pdfParse(pdfBuffer);
                                        // Buscar apenas nos primeiros 3000 chars (cabeçalho)
                                        const headerText = (pdfData.text || '').substring(0, 3000);
                                        
                                        if (!nuCompraRaw) {
                                            const pdfNumMatch = headerText.match(/[Nn][uú]mero\s+[Cc]omprasnet\s*:?\s*\(?(\d{4,6})\s*[/\\]?\s*(\d{4})?\)?/);
                                            if (pdfNumMatch) {
                                                nuCompraRaw = pdfNumMatch[1];
                                                compraAno = pdfNumMatch[2] || ano;
                                                extractionSrc = 'PDF-PARSE';
                                                logger.info(`[PNCP-V2] 📄 Fallback C: numero_comprasnet=${nuCompraRaw} extraído do PDF direto`);
                                            }
                                        }
                                        if (!resolvedUasg) {
                                            const pdfUasgMatch = headerText.match(/UASG\s*:?\s*(\d{6})/i);
                                            if (pdfUasgMatch) {
                                                resolvedUasg = pdfUasgMatch[1];
                                                logger.info(`[PNCP-V2] 📄 Fallback C: uasg=${resolvedUasg} extraído do PDF direto`);
                                            }
                                        }
                                    }
                                } catch (pdfErr: any) {
                                    logger.warn(`[PNCP-V2] ⚠️ Fallback C (pdf-parse) falhou: ${pdfErr.message}`);
                                }
                            }
                            
                            // Fallback final para UASG: usar PNCP API
                            if (!resolvedUasg) resolvedUasg = pncpUasg;
                            
                            // Mapeamento de modalidade → código ComprasNet (SISG)
                            const MODALIDADE_TO_CODE: Record<string, string> = {
                                'pregão': '05', 'pregao': '05',
                                'concorrência': '03', 'concorrencia': '03',
                                'tomada de preço': '02', 'tomada de preco': '02',
                                'convite': '04', 'concurso': '01',
                                'leilão': '07', 'leilao': '07',
                                'dispensa': '08', 'inexigibilidade': '09',
                            };
                            
                            let coModalidade = '';
                            for (const [key, code] of Object.entries(MODALIDADE_TO_CODE)) {
                                if (aiModalidade.includes(key)) { coModalidade = code; break; }
                            }

                            if (nuCompraRaw && coModalidade && resolvedUasg && resolvedUasg.length === 6) {
                                const nuCompra = nuCompraRaw.padStart(5, '0');
                                const compraId = `${resolvedUasg}${coModalidade}${nuCompra}${compraAno}`;
                                const fallbackUrl = `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=${compraId}`;
                                
                                legacyProcess.link_sistema = fallbackUrl;
                                logger.info(`[PNCP-V2] 🔧 Fallback B: URL construída do edital → ${fallbackUrl}`);
                                logger.info(`[PNCP-V2]    UASG=${resolvedUasg} mod=${coModalidade} num=${nuCompra} ano=${compraAno} src=${extractionSrc}`);
                            } else {
                                logger.info(`[PNCP-V2] ℹ️ Fallback B+C: dados insuficientes (nuCompra=${nuCompraRaw || 'N/A'}, coMod=${coModalidade || 'N/A'}, uasg=${resolvedUasg || 'N/A'})`);
                            }
                        } catch (fbErr: any) {
                            logger.warn(`[PNCP-V2] ⚠️ Fallback B falhou: ${fbErr.message}`);
                        }
                    }
                }
            } catch (err: any) {
                logger.warn(`[PNCP-V2] ⏱️ Enrich falhou: ${err.message}`);
            }
        }

        // ── Re-normalize portal after Auto-Enrich ──
        // If we enriched link_sistema to a platform URL (BLL, BNC, etc.), the portal
        // was still set to "PNCP" from L3216. Re-normalize with the enriched link.
        if (legacyProcess.link_sistema && hasMonitorableDomain(legacyProcess.link_sistema)) {
            const enrichedPortal = normalizePortal(legacyProcess.portal || 'PNCP', legacyProcess.link_sistema);
            if (enrichedPortal !== legacyProcess.portal) {
                logger.info(`[PNCP-V2] 🔄 Portal re-normalizado: "${legacyProcess.portal}" → "${enrichedPortal}" (Auto-Enrich)`);
                legacyProcess.portal = enrichedPortal;
            }
        }

        const legacyAnalysis = {
            requiredDocuments: allReqs,
            pricingConsiderations: v2Result.economic_financial_analysis.indices_exigidos
                .map(i => `${i.indice}: ${i.formula_ou_descricao} (mín: ${i.valor_minimo})`).join('\n')
                + (v2Result.contractual_analysis.medicao_pagamento ? `\nPagamento: ${v2Result.contractual_analysis.medicao_pagamento}` : '')
                + (v2Result.contractual_analysis.reajuste ? `\nReajuste: ${v2Result.contractual_analysis.reajuste}` : ''),
            irregularitiesFlags: v2Result.legal_risk_review.critical_points.map(cp => `[${(cp.severity || '').toUpperCase()}] ${cp.title}: ${cp.description}`),
            fullSummary: `ANÁLISE V2 PIPELINE — ${bestObjResumo || ''}\n\n` +
                `Objeto: ${bestObjCompleto || ''}\n` +
                `Órgão: ${v2Result.process_identification.orgao || ''}\n` +
                `Sessão: ${v2Result.timeline.data_sessao || ''}\n\n` +
                `--- CONDIÇÕES ---\n` +
                `Consórcio: ${v2Result.participation_conditions.permite_consorcio ?? 'Não informado'}\n` +
                `Subcontratação: ${v2Result.participation_conditions.permite_subcontratacao ?? 'Não informado'}\n` +
                `Visita Técnica: ${v2Result.participation_conditions.exige_visita_tecnica ?? 'Não informado'}\n\n` +
                `--- PENALIDADES ---\n` +
                (v2Result.contractual_analysis.penalidades || []).join('\n') +
                `\n\n--- RISCOS (${v2Result.legal_risk_review.critical_points.length}) ---\n` +
                v2Result.legal_risk_review.critical_points.map(cp =>
                    `[${(cp.severity || '').toUpperCase()}] ${cp.title}: ${cp.description} → ${cp.recommended_action}`
                ).join('\n'),
            deadlines: [
                v2Result.timeline.data_sessao ? `${v2Result.timeline.data_sessao} - Sessão Pública` : '',
                v2Result.timeline.prazo_impugnacao ? `${v2Result.timeline.prazo_impugnacao} - Impugnação` : '',
                v2Result.timeline.prazo_esclarecimento ? `${v2Result.timeline.prazo_esclarecimento} - Esclarecimento` : '',
                v2Result.timeline.prazo_envio_proposta ? `${v2Result.timeline.prazo_envio_proposta} - Envio de Proposta` : '',
                v2Result.contractual_analysis.prazo_execucao ? `Prazo de Execução: ${v2Result.contractual_analysis.prazo_execucao}` : '',
                v2Result.contractual_analysis.prazo_vigencia ? `Vigência: ${v2Result.contractual_analysis.prazo_vigencia}` : '',
                ...(v2Result.timeline.outros_prazos || []).map(p => `${p.data || ''} - ${p.descricao || ''}`)
            ].filter(Boolean),
            penalties: (v2Result.contractual_analysis.penalidades || []).join('\n'),
            qualificationRequirements: Object.values(v2Result.requirements)
                .flat()
                .map(r => `[${r.requirement_id}] ${r.title}: ${r.description}`)
                .join('\n'),
            biddingItems: (() => {
                // Primary: structured items from itens_licitados (V2 pipeline extraction)
                const itens = v2Result.proposal_analysis?.itens_licitados || [];
                if (Array.isArray(itens) && itens.length > 0) {
                    return itens.map((it: any) => 
                        `Item ${it.itemNumber || '?'}: ${it.description || ''} | Unid: ${it.unit || 'UN'} | Qtd: ${it.quantity || 1}${it.multiplier && it.multiplier > 1 ? ` × ${it.multiplier} ${it.multiplierLabel || ''}` : ''} | Ref: R$ ${it.referencePrice || 0}`
                    ).join('\n');
                }
                // Fallback: observacoes_proposta (legacy, but usually short/useless)
                return (v2Result.proposal_analysis.observacoes_proposta || []).join('\n');
            })()
        };

        // Embed pncpSource inside schemaV2 so it's persisted in the DB
        (v2Result as any).pncp_source = {
            link_sistema,
            downloaded_files: downloadedFiles,
            discarded_files: discardedFiles,
            attachments: pncpAttachments,
            analyzed_at: new Date().toISOString()
        };

        // Build final response with both V1 compat and V2 schema
        const finalPayload = {
            process: legacyProcess,
            analysis: legacyAnalysis,
            schemaV2: v2Result,
            pncpSource: {
                link_sistema,
                downloadedFiles,
                discardedFiles,
                attachments: pncpAttachments,  // Full catalog with URLs for proposal module
                analyzedAt: new Date().toISOString()
            },
            _version: '2.0',
            _pipeline_duration_s: parseFloat(totalDuration),
            _prompt_version: V2_PROMPT_VERSION,
            _model_used: uniqueModels.join('+'),
            _overall_confidence: v2Result.confidence.overall_confidence,
            _stage_times: stageTimes,
            _quality_score: qualityReport?.overallScore || null,
            _evidence_count: v2Result.evidence_registry.length,
            _risk_count: v2Result.legal_risk_review.critical_points.length,
            _requirement_count: totalReqs,
            _requires_human_audit: combinedScore < 80 || pipelineHealth.fallbacksUsed > 2 || pipelineHealth.parseRepairs > 1
        };

        logger.info(`[PNCP-V2] SUCCESS — Score: ${combinedScore}% | ${totalReqs} exigências | ${v2Result.evidence_registry.length} evidências`);
        sendProgress(8, 'Análise concluída!', `Score: ${combinedScore}% • ${totalReqs} exigências • ${v2Result.legal_risk_review.critical_points.length} riscos`);

        // ── Telemetry (fire-and-forget) ──
        const catCounts: Record<string, number> = {};
        for (const [cat, items] of Object.entries(v2Result.requirements || {})) {
            catCounts[cat] = (items as any[]).length;
        }
        recordAnalysisTelemetry({
            tenantId: req.user.tenantId,
            processId: undefined,
            numPdfs: pdfParts.length,
            totalPages: 0,
            totalChars: 0,
            hasScannedPdf: false,
            portal: v2Result.process_identification?.portal_licitacao || '',
            modalidade: v2Result.process_identification?.modalidade || '',
            objeto: ((v2Result.process_identification as any)?.objeto || '').substring(0, 200),
            model: uniqueModels.join('+'),
            promptVersion: V2_PROMPT_VERSION,
            extractionTimeMs: Math.round((stageTimes.extraction || 0) * 1000),
            totalTimeMs: Math.round(parseFloat(totalDuration) * 1000),
            parseRepairs: pipelineHealth.parseRepairs,
            fallbackUsed: pipelineHealth.fallbacksUsed > 0,
            categoryGapRecovery: !!stageTimes.re_extraction,
            totalRequirements: totalReqs,
            categoryCounts: catCounts,
            totalEvidences: v2Result.evidence_registry.length,
            totalRisks: v2Result.legal_risk_review.critical_points.length,
            qualityScore: qualityReport?.overallScore ?? null,
            confidenceScore: combinedScore,
            enforcerCorrections: enforceResult.corrections,
            safetyNetsTriggered: classifySafetyNets(enforceResult.details),
            status: 'success',
        }).catch(() => {}); // Never block pipeline

        sendResult(finalPayload);

        // ── Engineering Background Job (fire-and-forget) ──
        // If engineering was detected, dispatch a background job to extract the full planilha.
        // This runs AFTER the user gets their analysis result (~200s) and does NOT block anything.
        if ((v2Result as any)._pendingEngineeringExtraction) {
            const pdfUrls = (v2Result as any)._engineeringPdfUrls || [];
            // We need the biddingId — it's saved by the frontend after receiving the result.
            // Use a short delay to ensure the frontend has persisted the analysis.
            setTimeout(async () => {
                try {
                    // Find the bidding that was just saved (by PNCP source data)
                    const processNumber = v2Result.process_identification?.numero_processo || '';
                    const orgao = v2Result.process_identification?.orgao || '';
                    
                    // Look for the most recently updated bidding matching this process
                    const recentBidding = await prisma.biddingProcess.findFirst({
                        where: {
                            tenantId: req.user.tenantId,
                            aiAnalysis: { isNot: null },
                        },
                        orderBy: { sessionDate: 'desc' },
                        select: { id: true, title: true },
                    });
                    
                    if (recentBidding) {
                        const engJob = await submitJob({
                            tenantId: req.user.tenantId,
                            userId: req.user.id,
                            type: 'engineering_extraction' as any,
                            targetId: recentBidding.id,
                            targetTitle: `Planilha Orçamentária — ${recentBidding.title || processNumber}`,
                            input: {
                                biddingId: recentBidding.id,
                                pdfUrls,
                            }
                        });
                        logger.info(`[PNCP-V2] 🏗️ Engineering BG job dispatched: ${engJob.jobId} for bidding ${recentBidding.id} (${pdfUrls.length} PDFs)`);
                    } else {
                        logger.warn(`[PNCP-V2] ⚠️ Could not find recently saved bidding to dispatch engineering job`);
                    }
                } catch (err: any) {
                    logger.warn(`[PNCP-V2] ⚠️ Failed to dispatch engineering BG job: ${err.message}`);
                }
            }, 5000); // 5s delay to allow frontend save
        }

    } catch (error: any) {
        logger.error('[PNCP-V2] Error:', error?.message || error);
        // Record error telemetry
        recordAnalysisTelemetry({
            tenantId: req.user?.tenantId || 'unknown',
            numPdfs: 0, totalPages: 0, totalChars: 0, hasScannedPdf: false,
            model: 'failed', promptVersion: V2_PROMPT_VERSION,
            extractionTimeMs: 0, totalTimeMs: 0,
            parseRepairs: 0, fallbackUsed: false, categoryGapRecovery: false,
            totalRequirements: 0, categoryCounts: {}, totalEvidences: 0, totalRisks: 0,
            enforcerCorrections: 0, safetyNetsTriggered: [],
            status: 'error', errorMessage: error?.message || 'Unknown',
        }).catch(() => {});
        sendError(`Erro na análise IA do PNCP: ${error?.message || 'Erro desconhecido'}`);
    }
});

// Ai Analysis

export default router;
