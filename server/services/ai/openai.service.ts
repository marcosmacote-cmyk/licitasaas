import OpenAI from "openai";
const pdfParse = require("pdf-parse");

/**
 * Extrai texto dos PDFs (compartilhado entre V1 e V2 fallbacks).
 */
async function extractTextFromPdfParts(pdfParts: any[]): Promise<string> {
    let fullExtractedText = "";

    for (let i = 0; i < pdfParts.length; i++) {
        const part = pdfParts[i];
        if (part.inlineData && part.inlineData.mimeType === 'application/pdf') {
            try {
                const buffer = Buffer.from(part.inlineData.data, 'base64');
                const data = await pdfParse(buffer);
                fullExtractedText += `\n--- Documento ${i + 1} ---\n` + data.text;
            } catch (err: any) {
                console.warn(`[OpenAI] Falha ao extrair texto do PDF ${i + 1}: ${err.message}`);
            }
        }
    }

    // Truncar se muito longo — gpt-4o TPM limit is low (30k), keep text budget tight
    // gpt-4o-mini: 128k context but better to keep under 100k chars (~25k tokens)
    const MAX_CHARS = 100000;
    if (fullExtractedText.length > MAX_CHARS) {
        console.warn(`[OpenAI] Texto truncado: ${fullExtractedText.length} → ${MAX_CHARS} chars`);
        fullExtractedText = fullExtractedText.substring(0, MAX_CHARS);
    }

    return fullExtractedText;
}

/**
 * Fallback V1 — Usado pelo endpoint legado /api/analyze-edital
 */
export async function fallbackToOpenAi(
    pdfParts: any[],
    systemInstruction: string,
    userInstruction: string
): Promise<{ text: string }> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error("OPENAI_API_KEY não está configurada para realizar o fallback.");
    }

    const openai = new OpenAI({ apiKey });
    const fullExtractedText = await extractTextFromPdfParts(pdfParts);

    if (!fullExtractedText.trim()) {
        throw new Error("Não foi possível extrair texto legível dos PDFs para processar com a OpenAI.");
    }

    console.log(`[OpenAI Fallback V1] Chamando gpt-4o-mini...`);
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
    console.log(`[OpenAI Fallback V1] gpt-4o-mini respondeu em ${duration.toFixed(1)}s`);

    const textOutput = response.choices[0]?.message?.content || "";
    return { text: textOutput };
}

/**
 * Fallback V2 — Usado por etapas individuais do pipeline V2
 * Aceita input como texto (para etapas 2/3 que não precisam de PDF) ou PDF parts (etapa 1).
 */
export async function fallbackToOpenAiV2(opts: {
    systemPrompt: string;
    userPrompt: string;
    pdfParts?: any[];
    temperature?: number;
    stageName: string;
}): Promise<{ text: string; model: string }> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error("OPENAI_API_KEY não configurada");
    }

    const openai = new OpenAI({ apiKey });
    let userContent = opts.userPrompt;

    // Se tem PDFs (etapa 1), extrai texto e anexa ao prompt
    if (opts.pdfParts && opts.pdfParts.length > 0) {
        const extractedText = await extractTextFromPdfParts(opts.pdfParts);
        if (extractedText.trim()) {
            userContent += `\n\nTEXTO COMPLETO DO(S) DOCUMENTO(S):\n${extractedText}`;
        }
    }

    // gpt-4o-mini: 128k context, higher TPM → primary for large extractions
    // gpt-4o: better quality but 30k TPM limit → fallback for smaller payloads
    const models = ['gpt-4o-mini', 'gpt-4o'] as const;
    let lastError: any = null;

    for (const model of models) {
        console.log(`[OpenAI V2 Fallback] ${opts.stageName} → chamando ${model}...`);
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
                max_tokens: 16384,
            });

            const duration = (Date.now() - startTime) / 1000;
            const textOutput = response.choices[0]?.message?.content || "";
            console.log(`[OpenAI V2 Fallback] ${opts.stageName} respondeu em ${duration.toFixed(1)}s (${textOutput.length} chars) via ${model}`);

            return { text: textOutput, model };
        } catch (err: any) {
            lastError = err;
            const is429 = err.status === 429 || err.message?.includes('429');
            const isContextLimit = err.message?.includes('context_length') || err.message?.includes('too large');
            if (is429 || isContextLimit) {
                console.warn(`[OpenAI V2 Fallback] ${model} falhou (${is429 ? 'rate limit' : 'context'}): ${err.message}. Tentando próximo modelo...`);
                continue;
            }
            // Non-retriable error
            throw err;
        }
    }

    throw lastError || new Error('Todos os modelos OpenAI falharam');
}

