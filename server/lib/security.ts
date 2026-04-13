/**
 * Security Middleware Stack for LicitaSaaS
 * 
 * Consolidates: Helmet, CORS, Rate Limiting, Request Logging, Error Handling
 */

import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import type { Express, Request, Response, NextFunction } from 'express';

// ── Allowed Origins (production + dev) ──
const ALLOWED_ORIGINS = [
    'http://localhost:5173',     // Vite dev
    'http://localhost:3001',     // API dev (frontend served from server)
    process.env.FRONTEND_URL,   // Production frontend URL
    process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined,
].filter(Boolean) as string[];

// ── Rate Limiters ──
// Note: We set `trust proxy: 1` in applySecurityMiddleware(),
// so Express resolves req.ip from X-Forwarded-For automatically.
// The default keyGenerator uses req.ip with proper IPv6 normalization.

/** Global: 200 requests per minute per IP */
export const globalLimiter = rateLimit({
    windowMs: 60 * 1000,         // 1 minuto
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas requisições. Tente novamente em instantes.' },
});

/** Auth routes: 10 attempts per 15 minutes per IP */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 minutos
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
});

/** AI-heavy routes: 20 requests per minute per Tenant (fallback to IP if not authed) */
export const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => req.user?.tenantId || req.ip || 'unknown',
    message: { error: 'Limite corporativo de requisições de IA atingido. Aguarde 1 minuto.' },
});

// ── Request Logger Middleware ──
export function requestLogger(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();

    // Use 'finish' event — cleaner than monkey-patching res.end
    res.on('finish', () => {
        const duration = Date.now() - start;
        const tenantId = (req as any).user?.tenantId || '-';
        const method = req.method;
        const reqPath = req.path;
        const status = res.statusCode;

        // Only log API calls, skip static files
        if (reqPath.startsWith('/api/')) {
            const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
            console.log(
                `[${level}] ${method} ${reqPath} | status=${status} | tenant=${tenantId} | ${duration}ms`
            );
        }
    });

    next();
}

// ── Health Check ──
export function healthCheckRoute(req: Request, res: Response) {
    res.json({
        status: 'ok',
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        node: process.version,
    });
}

// ── Global Error Handler (must be last middleware) ──
export function globalErrorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
    const tenantId = (req as any).user?.tenantId || '-';
    const userId = (req as any).user?.userId || '-';

    // Use the intelligent error translation system
    const { translateError } = require('../middlewares/errorHandler');
    const translated = translateError(err);

    console.error(
        `[UNHANDLED ERROR] ${req.method} ${req.path} | tenant=${tenantId} user=${userId} | code=${translated.code}`,
        err.message || err,
        err.stack ? `\n${err.stack.split('\n').slice(0, 3).join('\n')}` : ''
    );

    // Never leak stack trace to client — always return translated message
    if (!res.headersSent) {
        res.status(translated.statusCode).json({
            error: translated.userMessage,
            code: translated.code,
        });
    }
}

/**
 * Apply the full security middleware stack to an Express app.
 * Must be called BEFORE any routes are defined.
 */
export function applySecurityMiddleware(app: Express) {
    // 1. Trust proxy (Railway/Docker)
    app.set('trust proxy', 1);

    // 2. Helmet — HTTP security headers
    app.use(helmet({
        contentSecurityPolicy: false,        // Disabled — SPA serves its own CSP
        crossOriginEmbedderPolicy: false,    // Allow loading external resources (PDF, images)
    }));

    // 3. CORS — Restricted origins
    app.use(cors({
        origin: (origin, callback) => {
            // Allow requests with no origin (server-to-server, curl, mobile apps)
            if (!origin) return callback(null, true);
            if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
            console.warn(`[CORS] Blocked request from origin: ${origin}`);
            callback(new Error('Não permitido por CORS'));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    }));

    // 4. Global rate limiter
    app.use(globalLimiter);

    // 5. Request logger
    app.use(requestLogger);

    // 6. Health check (before auth — must be public)
    app.get('/api/health', healthCheckRoute);

    console.log('[Security] ✅ Helmet, CORS, Rate Limiting, Request Logger initialized');
    console.log(`[Security] Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
}
