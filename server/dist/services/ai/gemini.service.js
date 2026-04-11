"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callGeminiWithRetry = callGeminiWithRetry;
const prisma_1 = require("../../lib/prisma");
const aiUsageTracker_1 = require("../../lib/aiUsageTracker");
/**
 * Race a promise against a timeout. Returns the promise result or throws on timeout.
 */
function withTimeout(promise, timeoutMs, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`[Gemini] Timeout após ${timeoutMs / 1000}s em '${label}'`));
        }, timeoutMs);
        promise.then((val) => { clearTimeout(timer); resolve(val); }, (err) => { clearTimeout(timer); reject(err); });
    });
}
/**
 * Gemini model cascade: when the primary model is unavailable (503),
 * try a fallback model from the same family that uses a different capacity pool.
 * This preserves multimodal capability (critical for scanned PDFs).
 */
const GEMINI_FALLBACK_MODELS = {
    // gemini-2.0-flash removed: deprecated by Google (404 NOT_FOUND since Apr 2026)
    // Cascade: primary → 3.1-pro (idle, 1/2k RPM) → 2.5-flash-lite (lightweight)
    'gemini-2.5-flash': ['gemini-3.1-pro', 'gemini-2.5-flash-lite'],
    'gemini-2.5-pro': ['gemini-3.1-pro', 'gemini-2.5-flash-lite'],
    'gemini-2.5-flash-lite': ['gemini-3.1-pro'],
};
/** Check if an error indicates 503/UNAVAILABLE/high demand */
function isServiceUnavailable(error) {
    const errMsg = error?.message || String(error);
    return errMsg.includes('503') || error?.status === 503 || error?.code === 503 ||
        errMsg.includes('UNAVAILABLE') || errMsg.includes('high demand') ||
        errMsg.includes('overloaded');
}
const circuitBreakers = new Map();
const CIRCUIT_OPEN_THRESHOLD = 3; // Open after 3 consecutive 503s
const CIRCUIT_RESET_MS = 5 * 60 * 1000; // Try again after 5 minutes (was 2 min — too short for Gemini outages)
function getCircuitState(model) {
    if (!circuitBreakers.has(model)) {
        circuitBreakers.set(model, { consecutiveFailures: 0, lastFailureTime: 0, isOpen: false });
    }
    return circuitBreakers.get(model);
}
function recordSuccess(model) {
    const state = getCircuitState(model);
    if (state.consecutiveFailures > 0 || state.isOpen) {
        console.log(`[Gemini] 🟢 Circuit CLOSED para '${model}' — modelo respondeu com sucesso`);
    }
    state.consecutiveFailures = 0;
    state.isOpen = false;
}
function recordFailure503(model) {
    const state = getCircuitState(model);
    state.consecutiveFailures++;
    state.lastFailureTime = Date.now();
    if (state.consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD && !state.isOpen) {
        state.isOpen = true;
        console.warn(`[Gemini] 🔴 Circuit OPEN para '${model}' — ${state.consecutiveFailures} falhas 503 consecutivas. Pulando para fallback por ${CIRCUIT_RESET_MS / 1000}s.`);
    }
}
function shouldSkipModel(model) {
    const state = getCircuitState(model);
    if (!state.isOpen)
        return false;
    // Half-open: after CIRCUIT_RESET_MS, allow ONE probe attempt
    const elapsed = Date.now() - state.lastFailureTime;
    if (elapsed >= CIRCUIT_RESET_MS) {
        console.log(`[Gemini] 🟡 Circuit HALF-OPEN para '${model}' — tentando 1 chamada de teste após ${(elapsed / 1000).toFixed(0)}s`);
        return false; // Allow one attempt
    }
    return true; // Skip this model
}
// ══════════════════════════════════════════════════════════════════
//  GLOBAL OUTAGE DETECTOR — When ALL models are down, fail fast
// ══════════════════════════════════════════════════════════════════
//
// Problem: When Gemini has a PLATFORM-WIDE outage, each call still tries
// primary (4 retries) + fallback1 (2 retries) + fallback2 (2 retries) = 8 calls.
// With 5 pipeline stages × 3 concurrent analyses = ~120 wasted API calls.
//
// Solution: If ALL models in the cascade have open circuits, skip the entire
// Gemini stack and throw immediately for the OpenAI fallback (if available).
function isGlobalOutage(requestedModel) {
    const fallbacks = GEMINI_FALLBACK_MODELS[requestedModel] || [];
    const allModels = [requestedModel, ...fallbacks];
    const allOpen = allModels.every(m => {
        const state = getCircuitState(m);
        if (!state.isOpen)
            return false;
        // Only count as "open" if still within the reset window
        return (Date.now() - state.lastFailureTime) < CIRCUIT_RESET_MS;
    });
    return allOpen && allModels.length >= 2; // Need at least 2 models to detect global outage
}
// ══════════════════════════════════════════════════════════════════
/**
 * Call Gemini with configurable retry count. Defaults to 3 retries on the requested model.
 * Uses exponential backoff with jitter for 503/429 errors (service unavailable / rate limit).
 *
 * Features:
 * - Circuit breaker: skips models in sustained outage (3+ consecutive 503s → skip for 5 min)
 * - Global outage detector: if ALL models are down, fails fast without any API calls
 * - Model cascade: 2.5-flash → 3.1-pro → 2.5-flash-lite (preserves multimodal capability)
 * - 404 skip: instantly moves to next model if current one is deprecated
 * - 3-minute timeout per attempt to prevent indefinite hangs
 *
 * V4.8.3: Reduced retries 4→3, shorter delays, 5-min circuit reset, global outage detection
 */
async function callGeminiWithRetry(model, options, maxRetries = 3, // Reduced from 4 — less waste during outages
trackingContext) {
    let lastError;
    const requestedModel = options.model || 'gemini-2.5-flash';
    const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes per attempt (was 5 — too long)
    // Global outage fast-fail: if ALL models are circuit-open, skip entirely
    if (isGlobalOutage(requestedModel)) {
        const fallbacks = GEMINI_FALLBACK_MODELS[requestedModel] || [];
        console.error(`[Gemini] 🔥 GLOBAL OUTAGE DETECTADA — todos os modelos com circuit OPEN (${requestedModel}, ${fallbacks.join(', ')}). Falhando imediatamente.`);
        throw new Error(`[Gemini] Global outage detectada — todos os modelos Gemini indisponíveis. Tente novamente em ${CIRCUIT_RESET_MS / 60000} minutos.`);
    }
    const tryModel = async (targetModel, retries, isFallback = false) => {
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
                const result = await withTimeout(model.generateContent({ ...options, model: targetModel }), TIMEOUT_MS, `${label} attempt ${i + 1}`);
                if (isFallback) {
                    console.log(`[Gemini] ✅ Fallback '${targetModel}' respondeu com sucesso`);
                }
                // Success — reset circuit breaker
                recordSuccess(targetModel);
                return result;
            }
            catch (error) {
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
                    // If circuit just opened on this model, bail immediately — no more retries
                    if (shouldSkipModel(targetModel)) {
                        console.warn(`[Gemini] ⚡ Circuit ABRIU durante retry — interrompendo retries para '${targetModel}'`);
                        break;
                    }
                }
                const isRetryable = isTimeout || is503 || is429;
                if (isRetryable && i < effectiveRetries - 1) {
                    // Shorter delays to reduce waste during outages
                    const baseDelays503 = isFallback ? [2000, 5000] : [3000, 8000, 15000];
                    const baseDelays429 = isFallback ? [2000, 5000] : [3000, 8000, 15000];
                    const baseDelaysTimeout = [2000, 4000, 8000];
                    const base = is503 ? (baseDelays503[i] || 8000) :
                        is429 ? (baseDelays429[i] || 5000) :
                            (baseDelaysTimeout[i] || 8000);
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
        if (primaryResult)
            return primaryResult;
        // Phase 2: If primary failed with 503/UNAVAILABLE, try fallback Gemini models
        // This preserves multimodal capability (critical for scanned PDFs)
        const primaryFailed503 = isServiceUnavailable(lastError) || shouldSkipModel(requestedModel);
        const fallbackModels = GEMINI_FALLBACK_MODELS[requestedModel] || [];
        if (primaryFailed503 && fallbackModels.length > 0) {
            for (const fallbackModel of fallbackModels) {
                console.warn(`[Gemini] 🔄 Modelo '${requestedModel}' indisponível. Tentando fallback '${fallbackModel}'...`);
                const fallbackResult = await tryModel(fallbackModel, 2, true);
                if (fallbackResult)
                    return fallbackResult;
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
        return (0, aiUsageTracker_1.trackAiUsage)(prisma_1.prisma, {
            ...trackingContext,
            model: requestedModel
        }, executeCall);
    }
    return executeCall();
}
