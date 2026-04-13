"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sentry = void 0;
exports.sentryErrorHandler = sentryErrorHandler;
exports.captureError = captureError;
exports.setSentryUser = setSentryUser;
/**
 * ══════════════════════════════════════════════════════════
 *  Sentry Instrumentation — Backend (Express/Node.js)
 *  Sprint 7.2 — Observabilidade em Produção
 * ══════════════════════════════════════════════════════════
 *
 *  MUST be imported BEFORE express and other modules.
 *  Gracefully no-ops when SENTRY_DSN_BACKEND is not set.
 */
const Sentry = __importStar(require("@sentry/node"));
exports.Sentry = Sentry;
const logger_1 = require("./logger");
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
    logger_1.logger.info('[Sentry] ✅ Backend instrumentation initialized');
}
else {
    logger_1.logger.info('[Sentry] ⏭ SENTRY_DSN_BACKEND not set — error tracking disabled');
}
/**
 * Express error handler that reports to Sentry.
 * Use as the LAST error middleware before app.listen().
 */
function sentryErrorHandler(err, req, res, next) {
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
function captureError(error, context) {
    if (SENTRY_DSN) {
        Sentry.captureException(error, { extra: context });
    }
}
/**
 * Utility: set the current user context for Sentry.
 * Call after authentication.
 */
function setSentryUser(userId, tenantId) {
    if (SENTRY_DSN) {
        Sentry.setUser({ id: userId, segment: tenantId });
    }
}
