/**
 * ══════════════════════════════════════════════════════════════════
 *  Request Logger Middleware
 * ══════════════════════════════════════════════════════════════════
 * 
 * Logs every HTTP request with:
 * - Correlation ID (X-Request-Id header, auto-generated if absent)
 * - Method, URL, status code
 * - Response time in ms
 * - Tenant ID (from JWT, if available)
 * - User agent (truncated)
 * 
 * Attaches req.requestId for downstream use.
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from './logger';

// Extend Express Request type
declare global {
    namespace Express {
        interface Request {
            requestId?: string;
        }
    }
}

/** Paths to skip logging (high-frequency health checks, static) */
const SKIP_PATHS = new Set(['/health', '/favicon.ico']);

export function requestLogger(req: Request, res: Response, next: NextFunction) {
    // Skip noisy paths
    if (SKIP_PATHS.has(req.path)) return next();

    // Correlation ID
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const start = Date.now();

    // Log after response finishes
    res.on('finish', () => {
        const durationMs = Date.now() - start;
        const tenantId = (req as any).user?.tenantId || '-';
        const userId = (req as any).user?.userId || '-';

        const meta: Record<string, any> = {
            requestId,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs,
            tenantId,
            userId,
            ip: req.ip || req.socket.remoteAddress,
        };

        // Add user-agent (truncated for space)
        const ua = req.headers['user-agent'];
        if (ua) meta.ua = ua.substring(0, 80);

        // Choose log level based on status code
        if (res.statusCode >= 500) {
            logger.error(`${req.method} ${req.path} ${res.statusCode}`, meta);
        } else if (res.statusCode >= 400) {
            logger.warn(`${req.method} ${req.path} ${res.statusCode}`, meta);
        } else if (durationMs > 5000) {
            // Slow request warning
            logger.warn(`SLOW ${req.method} ${req.path} ${res.statusCode} (${durationMs}ms)`, meta);
        } else {
            logger.info(`${req.method} ${req.path} ${res.statusCode}`, meta);
        }
    });

    next();
}
