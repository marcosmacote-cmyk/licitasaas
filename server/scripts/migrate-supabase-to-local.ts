#!/usr/bin/env ts-node
/**
 * ═══════════════════════════════════════════════════════════
 * LicitaSaaS — Supabase → Local Migration Script
 * ═══════════════════════════════════════════════════════════
 *
 * Downloads all files referenced in the database from Supabase Storage
 * and saves them to the local /uploads directory. Updates database URLs
 * to point to local paths.
 *
 * Usage:
 *   npx tsx server/scripts/migrate-supabase-to-local.ts
 *   npx tsx server/scripts/migrate-supabase-to-local.ts --dry-run   # Preview only
 *   npx tsx server/scripts/migrate-supabase-to-local.ts --rewrite   # Also rewrite DB URLs
 *
 * Safety:
 *   - Files are NOT deleted from Supabase (manual cleanup after verification)
 *   - DB URL rewriting is opt-in (--rewrite flag)
 *   - Each file is verified after download (size check)
 *   - Existing local files are skipped (idempotent)
 */

import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load env
const SERVER_ROOT = __dirname.endsWith('dist/scripts')
    ? path.resolve(__dirname, '../..')
    : path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_ROOT, '.env'), override: false });

const prisma = new PrismaClient();
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BUCKET_NAME = process.env.SUPABASE_BUCKET || 'documents';

const DRY_RUN = process.argv.includes('--dry-run');
const REWRITE_URLS = process.argv.includes('--rewrite');

const uploadDir = process.env.NODE_ENV === 'production' ? '/app/uploads' : path.join(SERVER_ROOT, 'uploads');

interface MigrationResult {
    total: number;
    downloaded: number;
    skipped: number;
    failed: number;
    rewritten: number;
    errors: string[];
}

function log(msg: string) {
    console.log(`[Migration ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function isSupabaseUrl(url: string): boolean {
    return url?.includes('supabase.co') || url?.includes('supabase.in') || false;
}

function extractSupabasePath(url: string): string {
    const parts = url.split(`${BUCKET_NAME}/`);
    if (parts.length > 1) {
        return decodeURIComponent(parts[1].split('?')[0]);
    }
    return path.basename(url.split('?')[0]);
}

function extractFileName(url: string): string {
    if (!url) return '';
    const clean = url.split('?')[0];
    if (clean.startsWith('http')) {
        return path.basename(new URL(clean).pathname);
    }
    return path.basename(clean);
}

async function downloadFromSupabase(supabase: any, remotePath: string, localPath: string): Promise<boolean> {
    try {
        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .download(remotePath);

        if (error) {
            if ((error as any).statusCode === 404 || error.message?.includes('not found')) {
                return false; // File doesn't exist on Supabase
            }
            throw error;
        }

        if (!data) return false;

        const arrayBuffer = await data.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length === 0) {
            log(`  ⚠️ Empty file from Supabase: ${remotePath}`);
            return false;
        }

        fs.writeFileSync(localPath, buffer);

        // Verify
        const stats = fs.statSync(localPath);
        if (stats.size !== buffer.length) {
            log(`  ❌ Size mismatch: expected ${buffer.length}, got ${stats.size}`);
            return false;
        }

        return true;
    } catch (err: any) {
        log(`  ❌ Download error: ${err.message}`);
        return false;
    }
}

async function migrateTable(
    supabase: any,
    tableName: string,
    records: { id: string; fileUrl: string }[],
    updateFn: (id: string, newUrl: string) => Promise<void>,
    result: MigrationResult
) {
    log(`\n📋 ${tableName}: ${records.length} records with Supabase URLs`);

    for (const record of records) {
        result.total++;
        const fileName = extractFileName(record.fileUrl);
        const localPath = path.join(uploadDir, fileName);
        const newUrl = `/uploads/${fileName}`;

        // Skip if already exists locally
        if (fs.existsSync(localPath)) {
            result.skipped++;
            if (REWRITE_URLS && !DRY_RUN) {
                await updateFn(record.id, newUrl);
                result.rewritten++;
            }
            continue;
        }

        if (DRY_RUN) {
            log(`  [DRY] Would download: ${fileName}`);
            result.skipped++;
            continue;
        }

        // Download from Supabase
        const remotePath = extractSupabasePath(record.fileUrl);
        const success = await downloadFromSupabase(supabase, remotePath, localPath);

        if (success) {
            result.downloaded++;
            const sizeKB = Math.round(fs.statSync(localPath).size / 1024);
            log(`  ✅ ${fileName} (${sizeKB}KB)`);

            if (REWRITE_URLS) {
                await updateFn(record.id, newUrl);
                result.rewritten++;
            }
        } else {
            result.failed++;
            result.errors.push(`${tableName}/${record.id}: ${fileName}`);
            log(`  ❌ Failed: ${fileName}`);
        }

        // Rate limit: 200ms between downloads
        await new Promise(r => setTimeout(r, 200));
    }
}


async function main() {
    log('═══════════════════════════════════════');
    log('  LicitaSaaS — Supabase → Local Migration');
    log('═══════════════════════════════════════');
    log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN (preview only)' : '🚀 LIVE'}`);
    log(`  URL Rewrite: ${REWRITE_URLS ? '✅ Enabled' : '❌ Disabled (add --rewrite)'}`);
    log(`  Upload Dir: ${uploadDir}`);
    log('═══════════════════════════════════════\n');

    // Validate
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        log('❌ SUPABASE_URL and SUPABASE_KEY required');
        process.exit(1);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Ensure upload dir exists
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    const result: MigrationResult = {
        total: 0, downloaded: 0, skipped: 0, failed: 0, rewritten: 0, errors: []
    };

    // ── 1. Documents table ──
    const docs = await prisma.document.findMany({
        where: { fileUrl: { contains: 'supabase' } },
        select: { id: true, fileUrl: true }
    });

    await migrateTable(supabase, 'Document', docs, async (id, newUrl) => {
        await prisma.document.update({ where: { id }, data: { fileUrl: newUrl } });
    }, result);

    // ── 2. TechnicalCertificate table ──
    const certs = await prisma.technicalCertificate.findMany({
        where: { fileUrl: { contains: 'supabase' } },
        select: { id: true, fileUrl: true }
    });

    await migrateTable(supabase, 'TechnicalCertificate', certs, async (id, newUrl) => {
        await prisma.technicalCertificate.update({ where: { id }, data: { fileUrl: newUrl } });
    }, result);

    // ── Summary ──
    log('\n═══════════════════════════════════════');
    log('  Migration Summary');
    log('═══════════════════════════════════════');
    log(`  Total files:     ${result.total}`);
    log(`  Downloaded:      ${result.downloaded}`);
    log(`  Skipped (local): ${result.skipped}`);
    log(`  Failed:          ${result.failed}`);
    log(`  URLs rewritten:  ${result.rewritten}`);

    if (result.errors.length > 0) {
        log('\n  ❌ Failed files:');
        result.errors.forEach(e => log(`    - ${e}`));
    }

    if (result.failed === 0) {
        log('\n  ✅ Migration completed successfully!');
        if (!REWRITE_URLS && result.total > 0) {
            log('  💡 Run with --rewrite to update database URLs');
        }
    } else {
        log(`\n  ⚠️ ${result.failed} files failed. Re-run to retry.`);
    }

    log('═══════════════════════════════════════\n');

    await prisma.$disconnect();
}

main().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
