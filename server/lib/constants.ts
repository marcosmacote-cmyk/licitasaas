/**
 * Centralized security constants.
 * JWT_SECRET MUST be set via environment variable in production.
 * The server will crash at startup if JWT_SECRET is not configured.
 */

const _jwtSecret = process.env.JWT_SECRET;

if (!_jwtSecret && process.env.NODE_ENV === 'production') {
    console.error('❌ FATAL: JWT_SECRET environment variable is NOT set. Cannot start in production without it.');
    process.exit(1);
}

if (!_jwtSecret) {
    console.warn('⚠️  JWT_SECRET not set — using development fallback. DO NOT use in production!');
}

/** JWT signing/verification secret. Crashes in production if not set. */
export const JWT_SECRET: string = _jwtSecret || 'dev-only-fallback-not-for-production';

/** bcrypt hashing cost factor (OWASP recommends ≥12 for production) */
export const BCRYPT_COST = 12;
