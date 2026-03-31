"use strict";
/**
 * ══════════════════════════════════════════════════════════════════
 *  LicitaSaaS — Structured Logger
 * ══════════════════════════════════════════════════════════════════
 *
 * JSON-structured logging for production observability.
 * In development, uses human-readable colored output.
 * In production, emits JSON lines for easy parsing by
 * CloudWatch, Datadog, Grafana Loki, etc.
 *
 * Usage:
 *   import { logger } from './lib/logger';
 *   logger.info('User logged in', { userId: '123', ip: req.ip });
 *   logger.warn('Rate limit near', { tenantId, remaining: 5 });
 *   logger.error('DB query failed', { error: err.message, query: 'findUser' });
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
const isProduction = process.env.NODE_ENV === 'production';
const minLevel = LOG_LEVELS[process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug')];
const serviceName = process.env.SERVICE_NAME || 'licitasaas';
const processRole = process.env.PROCESS_ROLE || 'all';
// ANSI colors for dev output
const COLORS = {
    debug: '\x1b[36m', // cyan
    info: '\x1b[32m', // green
    warn: '\x1b[33m', // yellow
    error: '\x1b[31m', // red
    reset: '\x1b[0m',
};
function formatDev(entry) {
    const color = COLORS[entry.level] || COLORS.reset;
    const level = entry.level.toUpperCase().padEnd(5);
    const { timestamp, level: _, message, service, role, ...meta } = entry;
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${color}[${level}]${COLORS.reset} ${message}${metaStr}`;
}
function emit(level, message, meta = {}) {
    if (LOG_LEVELS[level] < minLevel)
        return;
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        service: serviceName,
        role: processRole,
        ...meta,
    };
    if (isProduction) {
        // JSON line — one line per log entry
        const line = JSON.stringify(entry);
        if (level === 'error') {
            process.stderr.write(line + '\n');
        }
        else {
            process.stdout.write(line + '\n');
        }
    }
    else {
        // Human-readable colored output for development
        const formatted = formatDev(entry);
        if (level === 'error') {
            console.error(formatted);
        }
        else if (level === 'warn') {
            console.warn(formatted);
        }
        else {
            console.log(formatted);
        }
    }
}
exports.logger = {
    debug: (message, meta) => emit('debug', message, meta),
    info: (message, meta) => emit('info', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    error: (message, meta) => emit('error', message, meta),
    /** Create a child logger with persistent metadata */
    child: (defaultMeta) => ({
        debug: (msg, meta) => emit('debug', msg, { ...defaultMeta, ...meta }),
        info: (msg, meta) => emit('info', msg, { ...defaultMeta, ...meta }),
        warn: (msg, meta) => emit('warn', msg, { ...defaultMeta, ...meta }),
        error: (msg, meta) => emit('error', msg, { ...defaultMeta, ...meta }),
    }),
};
