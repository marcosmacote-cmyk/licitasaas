import crypto from 'crypto';

export class DedupService {
    static generateFingerprint(processId: string, messageId: string | undefined | null, content: string, authorType: string | undefined | null): string {
        const rawString = `${processId}|${messageId || 'NO_ID'}|${(content || '').trim().toLowerCase()}|${authorType || 'UNKNOWN'}`;
        return crypto.createHash('sha256').update(rawString).digest('hex');
    }
}
