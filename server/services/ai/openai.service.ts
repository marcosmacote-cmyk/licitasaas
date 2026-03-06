import OpenAI from "openai";
const pdfParse = require("pdf-parse");

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
    let fullExtractedText = "";

    console.log(`[OpenAI Fallback] Iniciando extração de texto de ${pdfParts.length} partes do PDF usando pdf-parse...`);

    // Converte os buffers de PDF base64 (usados pelo Gemini) para texto legível pela OpenAI
    for (let i = 0; i < pdfParts.length; i++) {
        const part = pdfParts[i];
        if (part.inlineData && part.inlineData.mimeType === 'application/pdf') {
            try {
                const buffer = Buffer.from(part.inlineData.data, 'base64');
                const data = await pdfParse(buffer);
                fullExtractedText += `\n--- Documento ${i + 1} ---\n` + data.text;
                console.log(`[OpenAI Fallback] Documento ${i + 1} extraído com sucesso (${data.text.length} caracteres).`);
            } catch (err: any) {
                console.warn(`[OpenAI Fallback] Falha ao extrair texto do PDF ${i + 1}: ${err.message}`);
            }
        }
    }

    if (!fullExtractedText.trim()) {
        throw new Error("Não foi possível extrair texto legível dos PDFs para processar com a OpenAI.");
    }

    // Limitamos o texto extraído caso seja insanamente longo para gpt-4o-mini
    // 1 token ~= 4 chars. 128k context = ~500k chars.
    const MAX_CHARS = 400000;
    if (fullExtractedText.length > MAX_CHARS) {
        console.warn(`[OpenAI Fallback] Texto muito longo (${fullExtractedText.length} chars). Truncando para ${MAX_CHARS}...`);
        fullExtractedText = fullExtractedText.substring(0, MAX_CHARS);
    }

    console.log(`[OpenAI Fallback] Chamando modelo gpt-4o-mini...`);
    const startTime = Date.now();

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: `${userInstruction}\n\nTEXTO DO(S) EDITAIS EXTRAÍDO:\n${fullExtractedText}` }
        ],
        temperature: 0.1,
        // Informamos que queremos JSON puro se o prompt demandar JSON.
        // response_format: { type: "json_object" } (Iremos confiar no parser nativo robustJsonParse que vai ler)
    });

    const duration = (Date.now() - startTime) / 1000;
    console.log(`[OpenAI Fallback] gpt-4o-mini respondeu em ${duration.toFixed(1)}s`);

    const textOutput = response.choices[0]?.message?.content || "";
    return { text: textOutput };
}
