/**
 * ══════════════════════════════════════════════════════════
 *  Sentry Instrumentation — Frontend (React/Vite)
 *  Sprint 7.2 — Observabilidade em Produção
 * ══════════════════════════════════════════════════════════
 *
 *  Gracefully no-ops when VITE_SENTRY_DSN is not set.
 *  Import and call initSentry() in main.tsx BEFORE rendering.
 */
import * as Sentry from '@sentry/react';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || '';

export function initSentry() {
    if (!SENTRY_DSN) {
        console.info('[Sentry] ⏭ VITE_SENTRY_DSN not set — frontend error tracking disabled');
        return;
    }

    Sentry.init({
        dsn: SENTRY_DSN,
        environment: import.meta.env.MODE || 'development',
        release: import.meta.env.VITE_GIT_SHA || 'local',

        // Performance: sample 10% of page loads
        tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,

        // Replay: capture 0% of sessions, 100% of errors
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 1.0,

        // Don't send PII
        sendDefaultPii: false,

        // Filter browser noise
        ignoreErrors: [
            'ResizeObserver loop',
            'Loading chunk',
            'Failed to fetch',
            'NetworkError',
            'AbortError',
            'Non-Error promise rejection',
            'Cannot read properties of null',
        ],

        beforeSend(event) {
            // Strip auth tokens from breadcrumbs
            if (event.breadcrumbs) {
                event.breadcrumbs = event.breadcrumbs.map(b => {
                    if (b.data?.url) {
                        b.data.url = b.data.url.replace(/token=[^&]+/, 'token=***');
                    }
                    return b;
                });
            }
            return event;
        },
    });

    console.info('[Sentry] ✅ Frontend instrumentation initialized');
}

/**
 * ErrorBoundary wrapper for the app root.
 * Shows a fallback UI when a React error occurs.
 */
export const SentryErrorBoundary = SENTRY_DSN
    ? Sentry.ErrorBoundary
    : (({ children }: { children: React.ReactNode; fallback?: any }) => children) as any;

/**
 * Set user context after login.
 */
export function setSentryUser(userId: string, tenantId: string, email?: string) {
    if (SENTRY_DSN) {
        Sentry.setUser({ id: userId, segment: tenantId, email });
    }
}

/**
 * Capture a manual error with context.
 */
export function captureError(error: Error, context?: Record<string, any>) {
    if (SENTRY_DSN) {
        Sentry.captureException(error, { extra: context });
    }
}

export { Sentry };
