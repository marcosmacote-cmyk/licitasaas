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
 * Gemini model cascade: when the primary model is unavailable (503),
 * try a fallback model from the same family that uses a different capacity pool.
 * This preserves multimodal capability (critical for scanned PDFs).
 */
const GEMINI_FALLBACK_MODELS: Record<string, string[]> = {
    // Cascade: primary → idle Pro (1/2k RPM) → older Flash (different pool)
    'gemini-2.5-flash': ['gemini-3.1-pro', 'gemini-2.0-flash'],
    'gemini-2.5-pro': ['gemini-3.1-pro', 'gemini-2.0-flash'],
    'gemini-2.0-flash': ['gemini-3.1-pro'],
};

/** Check if an error indicates 503/UNAVAILABLE/high demand */
function isServiceUnavailable(error: any): boolean {
    const errMsg = error?.message || String(error);
    return errMsg.includes('503') || error?.status === 503 || error?.code === 503 ||
        errMsg.includes('UNAVAILABLE') || errMsg.includes('high demand') ||
        errMsg.includes('overloaded');
}

/**
 * Call Gemini with configurable retry count. Defaults to 4 retries on the requested model.
 * Uses exponential backoff with jitter for 503/429 errors (service unavailable / rate limit).
 * 
 * If all retries on the primary model fail with 503/UNAVAILABLE, automatically cascades to
 * a fallback Gemini model (e.g., gemini-2.0-flash) with 2 quick retries. This preserves
 * multimodal capability for scanned PDFs that OpenAI cannot process.
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

    const tryModel = async (targetModel: string, retries: number, isFallback = false): Promise<any> => {
        const label = isFallback ? `FALLBACK ${targetModel}` : targetModel;
        for (let i = 0; i < retries; i++) {
            try {
                if (i > 0 || isFallback) {
                    console.log(`[Gemini] ${isFallback ? '🔄 Cascata →' : 'Retrying'} '${label}' (attempt ${i + 1}/${retries})`);
                }
                const result = await withTimeout(
                    model.generateContent({ ...options, model: targetModel }),
                    TIMEOUT_MS,
                    `${label} attempt ${i + 1}`
                );
                if (isFallback) {
                    console.log(`[Gemini] ✅ Fallback '${targetModel}' respondeu com sucesso`);
                }
                return result;
            } catch (error: any) {
                lastError = error;
                const errMsg = error?.message || String(error);
                const isTimeout = errMsg.includes('Timeout');
                const is503 = isServiceUnavailable(error);
                const is429 = errMsg.includes('429') || error?.status === 429 || error?.code === 429;
                const isRetryable = isTimeout || is503 || is429;
                if (isRetryable && i < retries - 1) {
                    // Shorter delays for fallback model (it's already a backup plan)
                    const baseDelays503 = isFallback ? [3000, 8000] : [5000, 12000, 25000, 40000];
                    const baseDelays429 = isFallback ? [2000, 5000] : [3000, 8000, 15000, 25000];
                    const baseDelaysTimeout = [2000, 4000, 8000, 12000];
                    const base = is503 ? (baseDelays503[i] || 8000) :
                                 is429 ? (baseDelays429[i] || 5000) :
                                 (baseDelaysTimeout[i] || 12000);
                    const jitter = Math.floor(Math.random() * 2000);
                    const delay = base + jitter;
                    console.warn(`[Gemini] ${is503 ? '503/UNAVAILABLE' : is429 ? '429/RATE_LIMIT' : 'TIMEOUT'} on '${label}', retrying in ${(delay / 1000).toFixed(1)}s (attempt ${i + 1}/${retries})...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                console.error(`[Gemini] Error on '${label}' after ${i + 1} attempts: ${errMsg}`);
                break;
            }
        }
        return null; // All retries exhausted
    };

    const executeCall = async () => {
        // Phase 1: Try the requested model with full retries
        const primaryResult = await tryModel(requestedModel, maxRetries);
        if (primaryResult) return primaryResult;

        // Phase 2: If primary failed with 503/UNAVAILABLE, try fallback Gemini model
        // This preserves multimodal capability (critical for scanned PDFs)
        const primaryFailed503 = isServiceUnavailable(lastError);
        const fallbackModels = GEMINI_FALLBACK_MODELS[requestedModel] || [];
        
        if (primaryFailed503 && fallbackModels.length > 0) {
            for (const fallbackModel of fallbackModels) {
                console.warn(`[Gemini] 🔄 Modelo '${requestedModel}' indisponível. Tentando fallback '${fallbackModel}'...`);
                const fallbackResult = await tryModel(fallbackModel, 2, true);
                if (fallbackResult) return fallbackResult;
            }
            console.error(`[Gemini] ❌ Todos os modelos Gemini falharam (${requestedModel} + fallbacks: ${fallbackModels.join(', ')})`);
        }

        // Phase 3: All Gemini models failed — throw for OpenAI fallback
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

