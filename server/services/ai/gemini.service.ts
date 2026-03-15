import { GoogleGenAI } from '@google/genai';

/**
 * Call Gemini with configurable retry count. Defaults to 2 retries on the requested model only.
 * Only falls back to other models if explicitly allowed.
 * Lower retry count = faster failure → faster fallback to OpenAI.
 */
export async function callGeminiWithRetry(model: any, options: any, maxRetries = 2) {
    let lastError;
    const requestedModel = options.model || 'gemini-2.5-flash';

    for (let i = 0; i < maxRetries; i++) {
        try {
            if (i > 0) console.log(`[Gemini] Retrying '${requestedModel}' (attempt ${i + 1}/${maxRetries})`);
            return await model.generateContent({ ...options, model: requestedModel });
        } catch (error: any) {
            lastError = error;
            const isRetryable = error?.message?.includes('503') || error?.message?.includes('429') ||
                error?.status === 503 || error?.code === 503 ||
                error?.status === 429 || error?.code === 429;
            if (isRetryable && i < maxRetries - 1) {
                const delay = Math.min((i + 1) * 2000, 8000); // faster backoff, max 8s
                console.warn(`[Gemini] ${error?.status || '503/429'} on '${requestedModel}', retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            // Non-retryable or last attempt
            const errorMsg = error?.message || String(error);
            console.error(`[Gemini] Error on '${requestedModel}': ${errorMsg}`);
            break;
        }
    }

    const finalErrorMsg = lastError?.message || String(lastError);
    if (finalErrorMsg.includes('leaked') || lastError?.status === 403) {
        console.error("!!! CRITICAL: GEMINI API KEY IS LEAKED OR INVALID !!!", lastError);
        throw new Error("A chave da API Gemini foi bloqueada por razões de segurança ou é inválida. Por favor, atualize a GEMINI_API_KEY no arquivo .env.");
    }

    throw lastError;
}
