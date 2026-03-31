"use strict";
/**
 * Migration Script: Encrypt existing CompanyCredential login/password fields
 *
 * Reads all credentials from the database, checks if they are already encrypted,
 * and encrypts any plaintext values using AES-256-GCM.
 *
 * Usage:
 *   CREDENTIAL_ENCRYPTION_KEY=<your-64-char-hex-key> npx ts-node scripts/encrypt-credentials.ts
 *
 * This script is IDEMPOTENT — it can be safely run multiple times.
 * Already-encrypted values (iv:tag:ciphertext format) will be skipped.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const crypto_1 = require("../lib/crypto");
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Load env
dotenv_1.default.config({ path: path_1.default.join(__dirname, '..', '.env') });
async function main() {
    if (!(0, crypto_1.isEncryptionConfigured)()) {
        console.error('❌ CREDENTIAL_ENCRYPTION_KEY not set or invalid.');
        console.error('   Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
        process.exit(1);
    }
    const prisma = new client_1.PrismaClient();
    try {
        const credentials = await prisma.companyCredential.findMany();
        console.log(`Found ${credentials.length} credentials in database.`);
        let encrypted = 0;
        let skipped = 0;
        for (const cred of credentials) {
            const needsLoginEncrypt = cred.login && !(0, crypto_1.isEncrypted)(cred.login);
            const needsPasswordEncrypt = cred.password && !(0, crypto_1.isEncrypted)(cred.password);
            if (!needsLoginEncrypt && !needsPasswordEncrypt) {
                skipped++;
                console.log(`  ⏭️  [${cred.id}] ${cred.platform} — already encrypted, skipping`);
                continue;
            }
            const updateData = {};
            if (needsLoginEncrypt) {
                updateData.login = (0, crypto_1.encryptCredential)(cred.login);
            }
            if (needsPasswordEncrypt) {
                updateData.password = (0, crypto_1.encryptCredential)(cred.password);
            }
            await prisma.companyCredential.update({
                where: { id: cred.id },
                data: updateData,
            });
            encrypted++;
            console.log(`  ✅ [${cred.id}] ${cred.platform} — encrypted successfully`);
        }
        console.log(`\n─── Migration Complete ───`);
        console.log(`  Encrypted: ${encrypted}`);
        console.log(`  Skipped (already encrypted): ${skipped}`);
        console.log(`  Total: ${credentials.length}`);
    }
    catch (error) {
        console.error('Migration failed:', error.message);
        process.exit(1);
    }
    finally {
        await prisma.$disconnect();
    }
}
main();
