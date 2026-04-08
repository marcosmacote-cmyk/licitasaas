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
 * Call Gemini with configurable retry count. Defaults to 4 retries on the requested model only.
 * Uses exponential backoff with jitter for 503/429 errors (service unavailable / rate limit).
 * 503 "high demand" spikes from Gemini typically last 15-45 seconds, so we need sufficient
 * wait time (~90s total window) to ride out the spike instead of failing fast.
 * 
 * Includes a 5-minute timeout per attempt to prevent indefinite hangs.
 */
export async function callGeminiWithRetry(
    model: any,
    options: any,
    maxRetries = 4,
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
                const is503 = errMsg.includes('503') || error?.status === 503 || error?.code === 503 ||
                    errMsg.includes('UNAVAILABLE') || errMsg.includes('high demand');
                const is429 = errMsg.includes('429') || error?.status === 429 || error?.code === 429;
                const isRetryable = isTimeout || is503 || is429;
                if (isRetryable && i < maxRetries - 1) {
                    // Exponential backoff with jitter:
                    // 503/high demand: 5s, 12s, 25s, 40s (total ~82s window — rides out demand spikes)
                    // 429/rate limit: 3s, 8s, 15s, 25s (total ~51s window)
                    // Timeout: 2s, 4s, 8s (faster, likely transient)
                    const baseDelays503 = [5000, 12000, 25000, 40000];
                    const baseDelays429 = [3000, 8000, 15000, 25000];
                    const baseDelaysTimeout = [2000, 4000, 8000, 12000];
                    const base = is503 ? (baseDelays503[i] || 40000) :
                                 is429 ? (baseDelays429[i] || 25000) :
                                 (baseDelaysTimeout[i] || 12000);
                    const jitter = Math.floor(Math.random() * 3000); // 0-3s jitter
                    const delay = base + jitter;
                    console.warn(`[Gemini] ${is503 ? '503/UNAVAILABLE' : is429 ? '429/RATE_LIMIT' : 'TIMEOUT'} on '${requestedModel}', retrying in ${(delay / 1000).toFixed(1)}s (attempt ${i + 1}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                // Non-retryable or last attempt
                console.error(`[Gemini] Error on '${requestedModel}' after ${i + 1} attempts: ${errMsg}`);
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
