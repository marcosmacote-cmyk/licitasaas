/**
 * Shared HTTPS agent for PNCP Gov.br API calls.
 * Centralizes TLS config and connection pooling to avoid
 * duplicate agents across modules.
 */
import https from 'https';

export const pncpAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
    maxSockets: 10,
});
