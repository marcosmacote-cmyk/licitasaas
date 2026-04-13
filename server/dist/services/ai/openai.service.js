"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fallbackToOpenAi = fallbackToOpenAi;
exports.fallbackToOpenAiV2 = fallbackToOpenAiV2;
const openai_1 = __importDefault(require("openai"));
const logger_1 = require("../../lib/logger");
const pdfParse = require("pdf-parse");
/**
 * Extrai texto dos PDFs (compartilhado entre V1 e V2 fallbacks).
 * Suporta:
 *   - inlineData (base64 PDF) → extrai texto via pdf-parse
 *   - fileData (Gemini Files API URI) → download + extrai texto
 *   - text parts → usa texto direto
 */
async function extractTextFromPdfParts(pdfParts) {
    let fullExtractedText = "";
    let partsProcessed = 0;
    let partsFailed = 0;
    for (let i = 0; i < pdfParts.length; i++) {
        const part = pdfParts[i];
        // Case 1: Inline base64 PDF
        if (part.inlineData && part.inlineData.mimeType === 'application/pdf') {
            try {
                const buffer = Buffer.from(part.inlineData.data, 'base64');
                const data = await pdfParse(buffer);
                if (data.text && data.text.trim().length > 0) {
                    fullExtractedText += `\n--- Documento ${i + 1} (inline) ---\n` + data.text;
                    partsProcessed++;
                }
                else {
                    logger_1.logger.warn(`[OpenAI] PDF ${i + 1} (inline) não contém texto extraível (possível scan sem OCR)`);
                    partsFailed++;
                }
            }
            catch (err) {
                logger_1.logger.warn(`[OpenAI] Falha ao extrair texto do PDF ${i + 1} (inline): ${err.message}`);
                partsFailed++;
            }
        }
        // Case 2: Gemini Files API URI — download and parse
        else if (part.fileData?.fileUri) {
            try {
                const uri = part.fileData.fileUri;
                logger_1.logger.info(`[OpenAI] Downloading PDF from Files API: ${uri.substring(0, 80)}...`);
                // Gemini Files API URIs require API key authentication
                const apiKey = process.env.GEMINI_API_KEY;
                // The Files API URI format: https://generativelanguage.googleapis.com/...
                const downloadUrl = uri.includes('?') ? `${uri}&key=${apiKey}` : `${uri}?key=${apiKey}`;
                const response = await fetch(downloadUrl);
                if (response.ok) {
                    const arrayBuffer = await response.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    const data = await pdfParse(buffer);
                    if (data.text && data.text.trim().length > 0) {
                        fullExtractedText += `\n--- Documento ${i + 1} (Files API) ---\n` + data.text;
                        partsProcessed++;
                        logger_1.logger.info(`[OpenAI] ✅ Files API PDF ${i + 1}: ${data.text.length} chars extraídos`);
                    }
                    else {
                        logger_1.logger.warn(`[OpenAI] Files API PDF ${i + 1} não contém texto extraível`);
                        partsFailed++;
                    }
                }
                else {
                    logger_1.logger.warn(`[OpenAI] Falha ao baixar PDF da Files API (${response.status}): ${uri.substring(0, 60)}`);
                    partsFailed++;
                }
            }
            catch (err) {
                logger_1.logger.warn(`[OpenAI] Falha ao processar Files API PDF ${i + 1}: ${err.message}`);
                partsFailed++;
            }
        }
        // Case 3: Plain text part
        else if (part.text) {
            // Skip — text parts are the user instruction, not document content
        }
    }
    logger_1.logger.info(`[OpenAI] Extração de texto: ${partsProcessed} PDF(s) processado(s), ${partsFailed} falha(s), ${fullExtractedText.length} chars total`);
    // Truncar se muito longo — gpt-4o TPM limit is low (30k), keep text budget tight
    // gpt-4o-mini: 128k context but better to keep under 100k chars (~25k tokens)
    const MAX_CHARS = 100000;
    if (fullExtractedText.length > MAX_CHARS) {
        logger_1.logger.warn(`[OpenAI] Texto truncado: ${fullExtractedText.length} → ${MAX_CHARS} chars`);
        fullExtractedText = fullExtractedText.substring(0, MAX_CHARS);
    }
    return fullExtractedText;
}
/**
 * Fallback V1 — Usado pelo endpoint legado /api/analyze-edital
 */
async function fallbackToOpenAi(pdfParts, systemInstruction, userInstruction) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error("OPENAI_API_KEY não está configurada para realizar o fallback.");
    }
    const openai = new openai_1.default({ apiKey });
    const fullExtractedText = await extractTextFromPdfParts(pdfParts);
    if (!fullExtractedText.trim()) {
        throw new Error("Não foi possível extrair texto legível dos PDFs para processar com a OpenAI.");
    }
    logger_1.logger.info(`[OpenAI Fallback V1] Chamando gpt-4o-mini...`);
    const startTime = Date.now();
    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: `${userInstruction}\n\nTEXTO DO(S) EDITAIS EXTRAÍDO:\n${fullExtractedText}` }
        ],
        temperature: 0.1,
    });
    const duration = (Date.now() - startTime) / 1000;
    logger_1.logger.info(`[OpenAI Fallback V1] gpt-4o-mini respondeu em ${duration.toFixed(1)}s`);
    const textOutput = response.choices[0]?.message?.content || "";
    return { text: textOutput };
}
/**
 * Fallback V2 — Usado por etapas individuais do pipeline V2
 * Aceita input como texto (para etapas 2/3 que não precisam de PDF) ou PDF parts (etapa 1).
 */
async function fallbackToOpenAiV2(opts) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error("OPENAI_API_KEY não configurada");
    }
    const openai = new openai_1.default({ apiKey });
    let userContent = opts.userPrompt;
    // Se tem PDFs (etapa 1), extrai texto e anexa ao prompt
    if (opts.pdfParts && opts.pdfParts.length > 0) {
        const extractedText = await extractTextFromPdfParts(opts.pdfParts);
        if (extractedText.trim()) {
            userContent += `\n\nTEXTO COMPLETO DO(S) DOCUMENTO(S):\n${extractedText}`;
        }
        else {
            // All PDFs failed text extraction — likely scanned images without OCR
            throw new Error(`Não foi possível extrair texto de ${opts.pdfParts.length} PDF(s). Possível documento escaneado sem OCR. O Gemini processa imagens diretamente, mas o fallback OpenAI requer texto extraível.`);
        }
    }
    // gpt-4o-mini: 128k context, higher TPM → primary for large extractions
    // gpt-4o: better quality but 30k TPM limit → fallback for smaller payloads
    // Model-specific max output token limits (OpenAI enforces these strictly)
    const MODEL_MAX_TOKENS = {
        'gpt-4o-mini': 16384,
        'gpt-4o': 16384,
    };
    const models = ['gpt-4o-mini', 'gpt-4o'];
    let lastError = null;
    for (const model of models) {
        // Cap max_tokens to model's limit (avoid 400 errors)
        const modelLimit = MODEL_MAX_TOKENS[model] || 16384;
        const effectiveMaxTokens = Math.min(opts.maxTokens || 16384, modelLimit);
        logger_1.logger.info(`[OpenAI V2 Fallback] ${opts.stageName} → chamando ${model} (max_tokens: ${effectiveMaxTokens})...`);
        const startTime = Date.now();
        try {
            const response = await openai.chat.completions.create({
                model,
                messages: [
                    { role: "system", content: opts.systemPrompt },
                    { role: "user", content: userContent }
                ],
                temperature: opts.temperature ?? 0.1,
                response_format: { type: "json_object" },
                max_tokens: effectiveMaxTokens,
            });
            const duration = (Date.now() - startTime) / 1000;
            const textOutput = response.choices[0]?.message?.content || "";
            logger_1.logger.info(`[OpenAI V2 Fallback] ${opts.stageName} respondeu em ${duration.toFixed(1)}s (${textOutput.length} chars) via ${model}`);
            return { text: textOutput, model };
        }
        catch (err) {
            lastError = err;
            const is429 = err.status === 429 || err.message?.includes('429');
            const isContextLimit = err.message?.includes('context_length') || err.message?.includes('too large');
            const isMaxTokens = err.status === 400 && err.message?.includes('max_tokens');
            if (is429 || isContextLimit || isMaxTokens) {
                logger_1.logger.warn(`[OpenAI V2 Fallback] ${model} falhou (${is429 ? 'rate limit' : isMaxTokens ? 'max_tokens' : 'context'}): ${err.message}. Tentando próximo modelo...`);
                continue;
            }
            // Non-retriable error
            throw err;
        }
    }
    throw lastError || new Error('Todos os modelos OpenAI falharam');
}
