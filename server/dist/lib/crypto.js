"use strict";
/**
 * Credential Encryption Service — AES-256-GCM
 *
 * Encrypts/decrypts sensitive data (portal credentials) at rest.
 * Uses AES-256-GCM with random IV and authentication tag.
 *
 * Required env var: CREDENTIAL_ENCRYPTION_KEY (64-char hex = 32 bytes)
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptCredential = encryptCredential;
exports.decryptCredential = decryptCredential;
exports.isEncrypted = isEncrypted;
exports.isEncryptionConfigured = isEncryptionConfigured;
const crypto_1 = __importDefault(require("crypto"));
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128-bit IV
const TAG_LENGTH = 16; // 128-bit auth tag
const ENCODING = 'hex';
function getEncryptionKey() {
    const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!keyHex || keyHex.length !== 64) {
        throw new Error('[Crypto] CREDENTIAL_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
            'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    }
    return Buffer.from(keyHex, 'hex');
}
/**
 * Encrypt a plaintext string.
 * Returns format: iv:authTag:ciphertext (all hex)
 */
function encryptCredential(plaintext) {
    const key = getEncryptionKey();
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', ENCODING);
    encrypted += cipher.final(ENCODING);
    const authTag = cipher.getAuthTag().toString(ENCODING);
    return `${iv.toString(ENCODING)}:${authTag}:${encrypted}`;
}
/**
 * Decrypt a previously encrypted string.
 * Expects format: iv:authTag:ciphertext (all hex)
 */
function decryptCredential(encryptedPayload) {
    const key = getEncryptionKey();
    const parts = encryptedPayload.split(':');
    if (parts.length !== 3) {
        throw new Error('[Crypto] Invalid encrypted payload format (expected iv:tag:ciphertext)');
    }
    const [ivHex, authTagHex, ciphertext] = parts;
    const iv = Buffer.from(ivHex, ENCODING);
    const authTag = Buffer.from(authTagHex, ENCODING);
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, ENCODING, 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
/**
 * Check if a string looks like an encrypted payload (iv:tag:ciphertext hex format).
 * Used to detect already-encrypted values during migration.
 */
function isEncrypted(value) {
    const parts = value.split(':');
    if (parts.length !== 3)
        return false;
    // Each part should be a valid hex string
    return parts.every(p => /^[0-9a-f]+$/i.test(p));
}
/**
 * Check if the encryption key is configured.
 * Returns false instead of throwing — useful for startup checks.
 */
function isEncryptionConfigured() {
    const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;
    return !!keyHex && keyHex.length === 64;
}
