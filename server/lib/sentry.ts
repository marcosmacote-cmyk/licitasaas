/**
 * ══════════════════════════════════════════════════════════
 *  Sentry Instrumentation — Backend (Express/Node.js)
 *  Sprint 7.2 — Observabilidade em Produção
 * ══════════════════════════════════════════════════════════
 *
 *  MUST be imported BEFORE express and other modules.
 *  Gracefully no-ops when SENTRY_DSN_BACKEND is not set.
 */
import * as Sentry from '@sentry/node';
import { logger } from './logger';

const SENTRY_DSN = process.env.SENTRY_DSN_BACKEND || '';

if (SENTRY_DSN) {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        release: process.env.RAILWAY_GIT_COMMIT_SHA || 'local',

        // Performance: sample 20% of transactions in production
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

        // Don't send PII (emails, IPs)
        sendDefaultPii: false,

        // Filter noisy errors
        ignoreErrors: [
            'ECONNRESET',
            'ECONNREFUSED',
            'ETIMEDOUT',
            'socket hang up',
            'EPIPE',
        ],

        // Attach server context
        beforeSend(event) {
            // Strip sensitive headers
            if (event.request?.headers) {
                delete event.request.headers['authorization'];
                delete event.request.headers['cookie'];
                delete event.request.headers['x-worker-secret'];
            }
            return event;
        },
    });

    logger.info('[Sentry] ✅ Backend instrumentation initialized');
} else {
    logger.info('[Sentry] ⏭ SENTRY_DSN_BACKEND not set — error tracking disabled');
}

export { Sentry };

/**
 * Express error handler that reports to Sentry.
 * Use as the LAST error middleware before app.listen().
 */
export function sentryErrorHandler(err: any, req: any, res: any, next: any) {
    if (SENTRY_DSN) {
        Sentry.captureException(err, {
            extra: {
                route: `${req.method} ${req.path}`,
                tenantId: req.user?.tenantId || 'anonymous',
                body: req.body ? JSON.stringify(req.body).substring(0, 500) : undefined,
            },
        });
    }
    next(err);
}

/**
 * Utility: manually capture an error with context.
 * Use in catch blocks for critical operations.
 */
export function captureError(error: Error, context?: Record<string, any>) {
    if (SENTRY_DSN) {
        Sentry.captureException(error, { extra: context });
    }
}

/**
 * Utility: set the current user context for Sentry.
 * Call after authentication.
 */
export function setSentryUser(userId: string, tenantId: string) {
    if (SENTRY_DSN) {
        Sentry.setUser({ id: userId, segment: tenantId });
    }
}
