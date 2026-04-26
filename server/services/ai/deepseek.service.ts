import OpenAI from "openai";
import { logger } from '../../lib/logger';
const pdfParse = require("pdf-parse");

/**
 * DeepSeek Service — Motor alternativo para extração PNCP
 * 
 * Usa a API OpenAI-compatible do DeepSeek (api.deepseek.com).
 * Modelo: deepseek-chat (DeepSeek-V4, 128k context)
 * 
 * DIFERENÇAS vs Gemini:
 * - NÃO suporta multimodal (PDF inline) → requer extração de texto via pdf-parse
 * - Contexto de 128k tokens (~500k chars) → suficiente para editais grandes
 * - Muito mais rápido para extração tabular (~10-30s vs 300-700s do Gemini)
 * - Custo: $0.14/M input, $0.28/M output (vs Gemini free-tier)
 * 
 * @since 2026-04-26 — Teste de latência para atingir meta de 120s no pipeline PNCP
 */

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEEPSEEK_MODEL = 'deepseek-chat'; // DeepSeek-V4

/**
 * Extrai texto dos PDFs para envio ao DeepSeek (mesma lógica do OpenAI fallback).
 * DeepSeek não suporta multimodal — precisa de texto puro.
 */
async function extractTextFromPdfParts(pdfParts: any[]): Promise<string> {
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
                    fullExtractedText += `\n--- Documento ${i + 1} ---\n` + data.text;
                    partsProcessed++;
                } else {
                    logger.warn(`[DeepSeek] PDF ${i + 1} (inline) não contém texto extraível (possível scan sem OCR)`);
                    partsFailed++;
                }
            } catch (err: any) {
                logger.warn(`[DeepSeek] Falha ao extrair texto do PDF ${i + 1}: ${err.message}`);
                partsFailed++;
            }
        }
        // Case 2: Gemini Files API URI — download and parse
        else if (part.fileData?.fileUri) {
            try {
                const uri = part.fileData.fileUri;
                const apiKey = process.env.GEMINI_API_KEY;
                const downloadUrl = uri.includes('?') ? `${uri}&key=${apiKey}` : `${uri}?key=${apiKey}`;
                const response = await fetch(downloadUrl);
                if (response.ok) {
                    const arrayBuffer = await response.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    const data = await pdfParse(buffer);
                    if (data.text && data.text.trim().length > 0) {
                        fullExtractedText += `\n--- Documento ${i + 1} ---\n` + data.text;
                        partsProcessed++;
                        logger.info(`[DeepSeek] ✅ PDF ${i + 1}: ${data.text.length} chars extraídos`);
                    } else {
                        logger.warn(`[DeepSeek] PDF ${i + 1} não contém texto extraível`);
                        partsFailed++;
                    }
                } else {
                    logger.warn(`[DeepSeek] Falha ao baixar PDF (${response.status}): ${uri.substring(0, 60)}`);
                    partsFailed++;
                }
            } catch (err: any) {
                logger.warn(`[DeepSeek] Falha ao processar PDF ${i + 1}: ${err.message}`);
                partsFailed++;
            }
        }
        // Case 3: Plain text part — skip (user instruction, not document)
    }

    logger.info(`[DeepSeek] Extração de texto: ${partsProcessed} PDF(s) ok, ${partsFailed} falha(s), ${fullExtractedText.length} chars total`);

    // DeepSeek V4 has 128k context (~500k chars) — generous budget
    const MAX_CHARS = 400000;
    if (fullExtractedText.length > MAX_CHARS) {
        logger.warn(`[DeepSeek] Texto truncado: ${fullExtractedText.length} → ${MAX_CHARS} chars`);
        fullExtractedText = fullExtractedText.substring(0, MAX_CHARS);
    }

    return fullExtractedText;
}

/**
 * Chama o DeepSeek para extração de dados de editais.
 * Retorno compatível com o formato do pipeline (text + model).
 */
export async function callDeepSeek(opts: {
    systemPrompt: string;
    userPrompt: string;
    pdfParts?: any[];
    zeroxMarkdown?: string;
    temperature?: number;
    maxTokens?: number;
    stageName: string;
}): Promise<{ text: string; model: string }> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        throw new Error("DEEPSEEK_API_KEY não configurada. Configure a variável de ambiente no Railway.");
    }

    const client = new OpenAI({
        apiKey,
        baseURL: DEEPSEEK_BASE_URL,
    });

    let userContent = opts.userPrompt;

    // Se tem Zerox markdown (melhor qualidade), usa ele
    if (opts.zeroxMarkdown && opts.zeroxMarkdown.trim().length > 0) {
        userContent += `\n\n── CONTEÚDO DO EDITAL (extraído via OCR de alta fidelidade) ──\n\n${opts.zeroxMarkdown}`;
        logger.info(`[DeepSeek] Usando Zerox markdown (${opts.zeroxMarkdown.length} chars)`);
    }
    // Senão, extrai texto dos PDFs
    else if (opts.pdfParts && opts.pdfParts.length > 0) {
        const extractedText = await extractTextFromPdfParts(opts.pdfParts);
        if (extractedText.trim()) {
            userContent += `\n\nTEXTO COMPLETO DO(S) DOCUMENTO(S):\n${extractedText}`;
        } else {
            throw new Error(`[DeepSeek] Não foi possível extrair texto de ${opts.pdfParts.length} PDF(s). Possível documento escaneado sem OCR.`);
        }
    }

    const startTime = Date.now();
    logger.info(`[DeepSeek] ${opts.stageName} → chamando ${DEEPSEEK_MODEL} (temp: ${opts.temperature ?? 0.1})...`);

    try {
        const response = await client.chat.completions.create({
            model: DEEPSEEK_MODEL,
            messages: [
                { role: "system", content: opts.systemPrompt },
                { role: "user", content: userContent }
            ],
            temperature: opts.temperature ?? 0.1,
            max_tokens: opts.maxTokens || 65536,
            response_format: { type: "json_object" },
        });

        const duration = (Date.now() - startTime) / 1000;
        const textOutput = response.choices[0]?.message?.content || "";
        const usage = response.usage;

        logger.info(`[DeepSeek] ✅ ${opts.stageName} em ${duration.toFixed(1)}s (${textOutput.length} chars) via ${DEEPSEEK_MODEL}`);
        if (usage) {
            logger.info(`[DeepSeek] 📊 Tokens: input=${usage.prompt_tokens}, output=${usage.completion_tokens}, total=${usage.total_tokens}`);
        }

        return { text: textOutput, model: `deepseek-v4` };
    } catch (err: any) {
        const duration = (Date.now() - startTime) / 1000;
        logger.error(`[DeepSeek] ❌ ${opts.stageName} falhou em ${duration.toFixed(1)}s: ${err.message}`);
        throw err;
    }
}

/**
 * Verifica se o DeepSeek está disponível (API key configurada).
 */
export function isDeepSeekAvailable(): boolean {
    return !!process.env.DEEPSEEK_API_KEY;
}
