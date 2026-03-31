"use strict";
/**
 * Security Middleware Stack for LicitaSaaS
 *
 * Consolidates: Helmet, CORS, Rate Limiting, Request Logging, Error Handling
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiLimiter = exports.authLimiter = exports.globalLimiter = void 0;
exports.requestLogger = requestLogger;
exports.healthCheckRoute = healthCheckRoute;
exports.globalErrorHandler = globalErrorHandler;
exports.applySecurityMiddleware = applySecurityMiddleware;
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
// ── Allowed Origins (production + dev) ──
const ALLOWED_ORIGINS = [
    'http://localhost:5173', // Vite dev
    'http://localhost:3001', // API dev (frontend served from server)
    process.env.FRONTEND_URL, // Production frontend URL
    process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined,
].filter(Boolean);
// ── Rate Limiters ──
// Note: We set `trust proxy: 1` in applySecurityMiddleware(),
// so Express resolves req.ip from X-Forwarded-For automatically.
// The default keyGenerator uses req.ip with proper IPv6 normalization.
/** Global: 200 requests per minute per IP */
exports.globalLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minuto
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas requisições. Tente novamente em instantes.' },
});
/** Auth routes: 10 attempts per 15 minutes per IP */
exports.authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
});
/** AI-heavy routes: 20 requests per minute per IP */
exports.aiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Limite de requisições de IA atingido. Tente novamente em instantes.' },
});
// ── Request Logger Middleware ──
function requestLogger(req, res, next) {
    const start = Date.now();
    // Use 'finish' event — cleaner than monkey-patching res.end
    res.on('finish', () => {
        const duration = Date.now() - start;
        const tenantId = req.user?.tenantId || '-';
        const method = req.method;
        const reqPath = req.path;
        const status = res.statusCode;
        // Only log API calls, skip static files
        if (reqPath.startsWith('/api/')) {
            const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
            console.log(`[${level}] ${method} ${reqPath} | status=${status} | tenant=${tenantId} | ${duration}ms`);
        }
    });
    next();
}
// ── Health Check ──
function healthCheckRoute(req, res) {
    res.json({
        status: 'ok',
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        node: process.version,
    });
}
// ── Global Error Handler (must be last middleware) ──
function globalErrorHandler(err, req, res, _next) {
    const tenantId = req.user?.tenantId || '-';
    const userId = req.user?.userId || '-';
    console.error(`[UNHANDLED ERROR] ${req.method} ${req.path} | tenant=${tenantId} user=${userId}`, err.message || err, err.stack ? `\n${err.stack.split('\n').slice(0, 3).join('\n')}` : '');
    // Never leak stack trace to client in production
    const isDev = process.env.NODE_ENV !== 'production';
    res.status(err.status || 500).json({
        error: isDev ? err.message : 'Erro interno do servidor',
        ...(isDev && { stack: err.stack?.split('\n').slice(0, 3) }),
    });
}
/**
 * Apply the full security middleware stack to an Express app.
 * Must be called BEFORE any routes are defined.
 */
function applySecurityMiddleware(app) {
    // 1. Trust proxy (Railway/Docker)
    app.set('trust proxy', 1);
    // 2. Helmet — HTTP security headers
    app.use((0, helmet_1.default)({
        contentSecurityPolicy: false, // Disabled — SPA serves its own CSP
        crossOriginEmbedderPolicy: false, // Allow loading external resources (PDF, images)
    }));
    // 3. CORS — Restricted origins
    app.use((0, cors_1.default)({
        origin: (origin, callback) => {
            // Allow requests with no origin (server-to-server, curl, mobile apps)
            if (!origin)
                return callback(null, true);
            if (ALLOWED_ORIGINS.includes(origin))
                return callback(null, true);
            console.warn(`[CORS] Blocked request from origin: ${origin}`);
            callback(new Error('Não permitido por CORS'));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    }));
    // 4. Global rate limiter
    app.use(exports.globalLimiter);
    // 5. Request logger
    app.use(requestLogger);
    // 6. Health check (before auth — must be public)
    app.get('/api/health', healthCheckRoute);
    console.log('[Security] ✅ Helmet, CORS, Rate Limiting, Request Logger initialized');
    console.log(`[Security] Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
}
