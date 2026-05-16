/**
 * downloadUtils.ts — Shared download helpers for engineering extraction modules.
 * FIX-10: Provides retry-resilient download for PNCP attachments.
 */
import axios from 'axios';
import https from 'https';

const agent = new https.Agent({ rejectUnauthorized: false });

/**
 * Download a URL with exponential backoff retry for transient errors.
 * Handles 5xx, ECONNABORTED, ETIMEDOUT, ECONNRESET.
 * 
 * @param url - URL to download
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param timeoutMs - Timeout per attempt in ms (default: 60000)
 * @returns Buffer with the downloaded content
 */
export async function downloadWithRetry(
    url: string,
    maxRetries = 3,
    timeoutMs = 60000
): Promise<Buffer> {
    const delays = [2000, 5000, 10000]; // Exponential backoff delays

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                httpsAgent: agent,
                timeout: timeoutMs,
                maxRedirects: 5,
                maxContentLength: 50 * 1024 * 1024, // 50MB max
            } as any);
            return Buffer.from(response.data as ArrayBuffer);
        } catch (err: any) {
            const status = err?.response?.status;
            const code = err?.code;
            const isRetryable =
                (status && status >= 500) ||
                code === 'ECONNABORTED' ||
                code === 'ETIMEDOUT' ||
                code === 'ECONNRESET';

            if (!isRetryable || attempt >= maxRetries) {
                throw err;
            }

            const delay = delays[attempt] || 10000;
            console.log(
                `[DownloadRetry] ⚠️ Attempt ${attempt + 1}/${maxRetries} failed ` +
                `(${status ? `HTTP ${status}` : code}) — retrying in ${delay / 1000}s...`
            );
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw new Error('Download failed after all retry attempts');
}
