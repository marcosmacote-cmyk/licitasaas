import { GoogleGenAI } from '@google/genai';

import { prisma } from '../../lib/prisma';
import { trackAiUsage, AiUsageContext } from '../../lib/aiUsageTracker';

/**
 * Race a promise against a timeout. Returns the promise result or throws on timeout.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`[Gemini] Timeout após ${timeoutMs / 1000}s em '${label}'`));
        }, timeoutMs);
        promise.then(
            (val) => { clearTimeout(timer); resolve(val); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
}

/**
 * Call Gemini with configurable retry count. Defaults to 2 retries on the requested model only.
 * Only falls back to other models if explicitly allowed.
 * Lower retry count = faster failure → faster fallback to OpenAI.
 * 
 * Includes a 5-minute timeout per attempt to prevent indefinite hangs.
 */
export async function callGeminiWithRetry(
    model: any,
    options: any,
    maxRetries = 2,
    trackingContext?: Pick<AiUsageContext, 'tenantId' | 'userId' | 'operation' | 'metadata'>
): Promise<any> {
    let lastError: any;
    const requestedModel = options.model || 'gemini-2.5-flash';
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per attempt

    const executeCall = async () => {
        for (let i = 0; i < maxRetries; i++) {
            try {
                if (i > 0) console.log(`[Gemini] Retrying '${requestedModel}' (attempt ${i + 1}/${maxRetries})`);
                const result = await withTimeout(
                    model.generateContent({ ...options, model: requestedModel }),
                    TIMEOUT_MS,
                    `${requestedModel} attempt ${i + 1}`
                );
                return result;
            } catch (error: any) {
                lastError = error;
                const errMsg = error?.message || String(error);
                const isTimeout = errMsg.includes('Timeout');
                const isRetryable = isTimeout ||
                    errMsg.includes('503') || errMsg.includes('429') ||
                    error?.status === 503 || error?.code === 503 ||
                    error?.status === 429 || error?.code === 429;
                if (isRetryable && i < maxRetries - 1) {
                    const delay = Math.min((i + 1) * 2000, 8000); // faster backoff, max 8s
                    console.warn(`[Gemini] ${isTimeout ? 'TIMEOUT' : error?.status || '503/429'} on '${requestedModel}', retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                // Non-retryable or last attempt
                console.error(`[Gemini] Error on '${requestedModel}': ${errMsg}`);
                break;
            }
        }

        const finalErrorMsg = lastError?.message || String(lastError);
        if (finalErrorMsg.includes('leaked') || lastError?.status === 403) {
            console.error("!!! CRITICAL: GEMINI API KEY IS LEAKED OR INVALID !!!", lastError);
            throw new Error("A chave da API Gemini foi bloqueada por razões de segurança ou é inválida. Por favor, atualize a GEMINI_API_KEY no arquivo .env.");
        }

        throw lastError;
    };

    if (trackingContext) {
        return trackAiUsage(prisma, {
            ...trackingContext,
            model: requestedModel
        }, executeCall);
    }
    
    return executeCall();
}
