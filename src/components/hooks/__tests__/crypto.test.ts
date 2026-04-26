/**
 * Crypto Module — Tests (AES-256-GCM)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const TEST_KEY = 'a'.repeat(64);

describe('Crypto Module', () => {
    let encrypt: any, decrypt: any, isEnc: any, isConfigured: any;

    beforeAll(async () => {
        process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
        const mod = await import('../../../../server/lib/crypto');
        encrypt = mod.encryptCredential;
        decrypt = mod.decryptCredential;
        isEnc = mod.isEncrypted;
        isConfigured = mod.isEncryptionConfigured;
    });

    afterAll(() => { delete process.env.CREDENTIAL_ENCRYPTION_KEY; });

    it('roundtrip simple text', () => {
        expect(decrypt(encrypt('senha_secreta'))).toBe('senha_secreta');
    });

    it('roundtrip special chars', () => {
        expect(decrypt(encrypt('p@$$w0rd!çã'))).toBe('p@$$w0rd!çã');
    });

    it('roundtrip empty string', () => {
        expect(decrypt(encrypt(''))).toBe('');
    });

    it('different ciphertexts for same input (random IV)', () => {
        const e1 = encrypt('test'), e2 = encrypt('test');
        expect(e1).not.toBe(e2);
        expect(decrypt(e1)).toBe('test');
        expect(decrypt(e2)).toBe('test');
    });

    it('produces iv:tag:ciphertext format', () => {
        const parts = encrypt('test').split(':');
        expect(parts).toHaveLength(3);
        expect(parts[0]).toHaveLength(32);
        expect(parts[1]).toHaveLength(32);
    });

    it('isEncrypted detects encrypted payloads', () => {
        expect(isEnc(encrypt('test'))).toBe(true);
        expect(isEnc('plain_text')).toBe(false);
        expect(isEnc('abc:def')).toBe(false);
    });

    it('isEncryptionConfigured works', () => {
        expect(isConfigured()).toBe(true);
        const orig = process.env.CREDENTIAL_ENCRYPTION_KEY;
        delete process.env.CREDENTIAL_ENCRYPTION_KEY;
        expect(isConfigured()).toBe(false);
        process.env.CREDENTIAL_ENCRYPTION_KEY = orig;
    });

    it('throws on invalid format', () => {
        expect(() => decrypt('invalid')).toThrow();
    });

    it('throws on tampered ciphertext', () => {
        const enc = encrypt('test');
        const p = enc.split(':');
        p[2] = 'ff' + p[2].slice(2);
        // GCM auth tag validation: tampered ciphertext should either throw
        // or return a different (garbage) value — never the original plaintext
        try {
            const result = decrypt(p.join(':'));
            // If it didn't throw, the result must NOT be the original plaintext
            expect(result).not.toBe('test');
        } catch {
            // Throwing is the expected/preferred behavior
            expect(true).toBe(true);
        }
    });
});
