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

import { PrismaClient } from '@prisma/client';
import { encryptCredential, isEncrypted, isEncryptionConfigured } from '../lib/crypto';
import dotenv from 'dotenv';
import path from 'path';

// Load env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
    if (!isEncryptionConfigured()) {
        console.error('❌ CREDENTIAL_ENCRYPTION_KEY not set or invalid.');
        console.error('   Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
        process.exit(1);
    }

    const prisma = new PrismaClient();

    try {
        const credentials = await prisma.companyCredential.findMany();
        console.log(`Found ${credentials.length} credentials in database.`);

        let encrypted = 0;
        let skipped = 0;

        for (const cred of credentials) {
            const needsLoginEncrypt = cred.login && !isEncrypted(cred.login);
            const needsPasswordEncrypt = cred.password && !isEncrypted(cred.password);

            if (!needsLoginEncrypt && !needsPasswordEncrypt) {
                skipped++;
                console.log(`  ⏭️  [${cred.id}] ${cred.platform} — already encrypted, skipping`);
                continue;
            }

            const updateData: any = {};
            if (needsLoginEncrypt) {
                updateData.login = encryptCredential(cred.login);
            }
            if (needsPasswordEncrypt) {
                updateData.password = encryptCredential(cred.password);
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
    } catch (error: any) {
        console.error('Migration failed:', error.message);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
