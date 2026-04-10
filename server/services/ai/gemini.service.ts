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
    // gemini-2.0-flash removed: deprecated by Google (404 NOT_FOUND since Apr 2026)
    // Cascade: primary → 3.1-pro (idle, 1/2k RPM) → 2.5-flash-lite (lightweight)
    'gemini-2.5-flash': ['gemini-3.1-pro', 'gemini-2.5-flash-lite'],
    'gemini-2.5-pro': ['gemini-3.1-pro', 'gemini-2.5-flash-lite'],
    'gemini-2.5-flash-lite': ['gemini-3.1-pro'],
};

/** Check if an error indicates 503/UNAVAILABLE/high demand */
function isServiceUnavailable(error: any): boolean {
    const errMsg = error?.message || String(error);
    return errMsg.includes('503') || error?.status === 503 || error?.code === 503 ||
        errMsg.includes('UNAVAILABLE') || errMsg.includes('high demand') ||
        errMsg.includes('overloaded');
}

// ══════════════════════════════════════════════════════════════════
//  CIRCUIT BREAKER — Skip models that are in sustained outage
// ══════════════════════════════════════════════════════════════════
//
// Problem: When gemini-2.5-flash is down ALL DAY, every pipeline call wastes
// ~90s retrying 5 times before cascading to 3.1-pro. For a 5-stage pipeline,
// that's 450s (7.5 min) of pure waste per analysis.
//
// Solution: Track consecutive 503 failures per model. After 3 consecutive
// 503s, the circuit "opens" and skips directly to fallback for 2 minutes.
// After 2 min, it "half-opens" (tries 1 quick attempt to see if recovered).
// On success, the circuit resets ("closes").

interface CircuitState {
    consecutiveFailures: number;
    lastFailureTime: number;
    isOpen: boolean;
}

const circuitBreakers = new Map<string, CircuitState>();
const CIRCUIT_OPEN_THRESHOLD = 3;     // Open after 3 consecutive 503s
const CIRCUIT_RESET_MS = 2 * 60 * 1000; // Try again after 2 minutes

function getCircuitState(model: string): CircuitState {
    if (!circuitBreakers.has(model)) {
        circuitBreakers.set(model, { consecutiveFailures: 0, lastFailureTime: 0, isOpen: false });
    }
    return circuitBreakers.get(model)!;
}

function recordSuccess(model: string): void {
    const state = getCircuitState(model);
    if (state.consecutiveFailures > 0 || state.isOpen) {
        console.log(`[Gemini] 🟢 Circuit CLOSED para '${model}' — modelo respondeu com sucesso`);
    }
    state.consecutiveFailures = 0;
    state.isOpen = false;
}

function recordFailure503(model: string): void {
    const state = getCircuitState(model);
    state.consecutiveFailures++;
    state.lastFailureTime = Date.now();
    if (state.consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD && !state.isOpen) {
        state.isOpen = true;
        console.warn(`[Gemini] 🔴 Circuit OPEN para '${model}' — ${state.consecutiveFailures} falhas 503 consecutivas. Pulando para fallback por ${CIRCUIT_RESET_MS / 1000}s.`);
    }
}

function shouldSkipModel(model: string): boolean {
    const state = getCircuitState(model);
    if (!state.isOpen) return false;
    
    // Half-open: after CIRCUIT_RESET_MS, allow ONE probe attempt
    const elapsed = Date.now() - state.lastFailureTime;
    if (elapsed >= CIRCUIT_RESET_MS) {
        console.log(`[Gemini] 🟡 Circuit HALF-OPEN para '${model}' — tentando 1 chamada de teste após ${(elapsed / 1000).toFixed(0)}s`);
        return false; // Allow one attempt
    }
    
    return true; // Skip this model
}

// ══════════════════════════════════════════════════════════════════

/**
 * Call Gemini with configurable retry count. Defaults to 4 retries on the requested model.
 * Uses exponential backoff with jitter for 503/429 errors (service unavailable / rate limit).
 * 
 * Features:
 * - Circuit breaker: skips models in sustained outage (3+ consecutive 503s → skip for 2 min)
 * - Model cascade: 2.5-flash → 3.1-pro → 2.5-flash-lite (preserves multimodal capability)
 * - 404 skip: instantly moves to next model if current one is deprecated
 * - 5-minute timeout per attempt to prevent indefinite hangs
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
        
        // Circuit breaker check
        if (shouldSkipModel(targetModel)) {
            const state = getCircuitState(targetModel);
            console.warn(`[Gemini] ⚡ Circuit OPEN — pulando '${targetModel}' (${state.consecutiveFailures} falhas 503). Direto para fallback.`);
            return null;
        }
        
        // If circuit is half-open, only try 1 attempt (probe)
        const circuitState = getCircuitState(targetModel);
        const isHalfOpen = circuitState.isOpen && (Date.now() - circuitState.lastFailureTime >= CIRCUIT_RESET_MS);
        const effectiveRetries = isHalfOpen ? 1 : retries;
        
        for (let i = 0; i < effectiveRetries; i++) {
            try {
                if (i > 0 || isFallback) {
                    console.log(`[Gemini] ${isFallback ? '🔄 Cascata →' : 'Retrying'} '${label}' (attempt ${i + 1}/${effectiveRetries})`);
                }
                const result = await withTimeout(
                    model.generateContent({ ...options, model: targetModel }),
                    TIMEOUT_MS,
                    `${label} attempt ${i + 1}`
                );
                if (isFallback) {
                    console.log(`[Gemini] ✅ Fallback '${targetModel}' respondeu com sucesso`);
                }
                // Success — reset circuit breaker
                recordSuccess(targetModel);
                return result;
            } catch (error: any) {
                lastError = error;
                const errMsg = error?.message || String(error);
                
                // 404/NOT_FOUND = model deprecated/removed → skip immediately, no retry
                const is404 = errMsg.includes('404') || error?.status === 404 || error?.code === 404 ||
                    errMsg.includes('NOT_FOUND') || errMsg.includes('no longer available');
                if (is404) {
                    console.warn(`[Gemini] ⛔ Modelo '${targetModel}' não existe (404). Pulando para próximo fallback...`);
                    break;
                }

                const isTimeout = errMsg.includes('Timeout');
                const is503 = isServiceUnavailable(error);
                const is429 = errMsg.includes('429') || error?.status === 429 || error?.code === 429;
                
                // Record 503 for circuit breaker
                if (is503) {
                    recordFailure503(targetModel);
                }
                
                const isRetryable = isTimeout || is503 || is429;
                if (isRetryable && i < effectiveRetries - 1) {
                    // Shorter delays for fallback model (it's already a backup plan)
                    const baseDelays503 = isFallback ? [3000, 8000] : [5000, 12000, 25000, 40000];
                    const baseDelays429 = isFallback ? [2000, 5000] : [3000, 8000, 15000, 25000];
                    const baseDelaysTimeout = [2000, 4000, 8000, 12000];
                    const base = is503 ? (baseDelays503[i] || 8000) :
                                 is429 ? (baseDelays429[i] || 5000) :
                                 (baseDelaysTimeout[i] || 12000);
                    const jitter = Math.floor(Math.random() * 2000);
                    const delay = base + jitter;
                    console.warn(`[Gemini] ${is503 ? '503/UNAVAILABLE' : is429 ? '429/RATE_LIMIT' : 'TIMEOUT'} on '${label}', retrying in ${(delay / 1000).toFixed(1)}s (attempt ${i + 1}/${effectiveRetries})...`);
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
        // Phase 1: Try the requested model (may be skipped by circuit breaker)
        const primaryResult = await tryModel(requestedModel, maxRetries);
        if (primaryResult) return primaryResult;

        // Phase 2: If primary failed with 503/UNAVAILABLE, try fallback Gemini models
        // This preserves multimodal capability (critical for scanned PDFs)
        const primaryFailed503 = isServiceUnavailable(lastError) || shouldSkipModel(requestedModel);
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
