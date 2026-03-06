import { GoogleGenAI } from '@google/genai';

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'];

export async function callGeminiWithRetry(model: any, options: any, maxRetries = 4) {
    let lastError;
    // Iterate over fallback models
    for (const modelName of GEMINI_MODELS) {
        const attemptOptions = { ...options, model: modelName };
        for (let i = 0; i < maxRetries; i++) {
            try {
                console.log(`[Gemini] Trying model '${modelName}' (attempt ${i + 1}/${maxRetries})`);
                return await model.generateContent(attemptOptions);
            } catch (error: any) {
                lastError = error;
                const isRetryable = error?.message?.includes('503') || error?.message?.includes('429') ||
                    error?.status === 503 || error?.code === 503 ||
                    error?.status === 429 || error?.code === 429;
                if (isRetryable) {
                    const delay = Math.min((i + 1) * 3000, 15000); // exponential backoff, max 15s
                    console.warn(`[Gemini] ${error?.status || '503/429'} error on '${modelName}', retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                // Non-retryable error: break inner loop, try next model
                const errorMsg = error?.message || String(error);
                console.error(`[Gemini] Non-retryable error on '${modelName}': ${errorMsg}`);
                break;
            }
        }
        console.warn(`[Gemini] All retries exhausted for model '${modelName}', trying next model...`);
    }

    const finalErrorMsg = lastError?.message || String(lastError);
    if (finalErrorMsg.includes('leaked') || lastError?.status === 403) {
        console.error("!!! CRITICAL: GEMINI API KEY IS LEAKED OR INVALID !!!", lastError);
        throw new Error("A chave da API Gemini foi bloqueada por razões de segurança ou é inválida. Por favor, atualize a GEMINI_API_KEY no arquivo .env.");
    }

    throw lastError;
}
