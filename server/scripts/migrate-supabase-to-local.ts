#!/usr/bin/env ts-node
/**
 * ═══════════════════════════════════════════════════════════
 * LicitaSaaS — Supabase → Local Migration Script
 * ═══════════════════════════════════════════════════════════
 *
 * Lists ALL files in the Supabase bucket and downloads them to
 * the local /app/uploads volume, preserving directory structure.
 * Optionally rewrites database URLs to point to local paths.
 *
 * Usage:
 *   npx tsx scripts/migrate-supabase-to-local.ts
 *   npx tsx scripts/migrate-supabase-to-local.ts --dry-run   # Preview only
 *   npx tsx scripts/migrate-supabase-to-local.ts --rewrite   # Also rewrite DB URLs
 *
 * Safety:
 *   - Files are NOT deleted from Supabase (manual cleanup after verification)
 *   - DB URL rewriting is opt-in (--rewrite flag)
 *   - Each file is verified after download (size check)
 *   - Existing local files are skipped (idempotent)
 *   - Bucket listing is fully paginated (handles >100 files)
 */

import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// ── Environment setup ──────────────────────────────────────

const SERVER_ROOT = __dirname.endsWith('dist/scripts')
    ? path.resolve(__dirname, '../..')
    : path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_ROOT, '.env'), override: false });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BUCKET_NAME = process.env.SUPABASE_BUCKET || 'documents';

const DRY_RUN = process.argv.includes('--dry-run');
const REWRITE_URLS = process.argv.includes('--rewrite');

// Railway volume mount point — falls back to server/uploads for local dev
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(SERVER_ROOT, 'uploads');

// ── Types ──────────────────────────────────────────────────

interface BucketFile {
    /** Full path within the bucket, e.g. "tenantId/uuid.pdf" */
    remotePath: string;
    /** Size in bytes as reported by Supabase (may be 0 for folders) */
    size: number;
}

interface MigrationResult {
    total: number;
    downloaded: number;
    skipped: number;
    failed: number;
    rewritten: number;
    errors: Array<{ path: string; reason: string }>;
}

// ── Logging ────────────────────────────────────────────────

function log(msg: string): void {
    console.log(`[Migration ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function logError(msg: string): void {
    console.error(`[Migration ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// ── Bucket listing (paginated, recursive) ─────────────────

/**
 * Recursively lists all files in a Supabase Storage bucket folder.
 * Supabase returns at most 100 items per call, so we paginate with offset.
 */
async function listBucketFiles(
    supabase: ReturnType<typeof createClient>,
    prefix: string = ''
): Promise<BucketFile[]> {
    const PAGE_SIZE = 100;
    const files: BucketFile[] = [];
    let offset = 0;

    while (true) {
        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .list(prefix, {
                limit: PAGE_SIZE,
                offset,
                sortBy: { column: 'name', order: 'asc' },
            });

        if (error) {
            throw new Error(`Failed to list bucket "${BUCKET_NAME}" at prefix "${prefix}": ${error.message}`);
        }

        if (!data || data.length === 0) break;

        for (const item of data) {
            const itemPath = prefix ? `${prefix}/${item.name}` : item.name;

            if (item.id === null || item.metadata === null) {
                // Supabase represents folders as items with null id/metadata
                log(`  📁 Entering folder: ${itemPath}`);
                const nested = await listBucketFiles(supabase, itemPath);
                files.push(...nested);
            } else {
                files.push({
                    remotePath: itemPath,
                    size: (item.metadata as any)?.size ?? 0,
                });
            }
        }

        if (data.length < PAGE_SIZE) break; // Last page
        offset += PAGE_SIZE;
    }

    return files;
}

// ── Download ───────────────────────────────────────────────

/**
 * Downloads a single file from Supabase and writes it to localPath.
 * Returns true on success, false if the file was not found (404).
 * Throws on unexpected errors.
 */
async function downloadFile(
    supabase: ReturnType<typeof createClient>,
    remotePath: string,
    localPath: string
): Promise<boolean> {
    const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .download(remotePath);

    if (error) {
        const status = (error as any).statusCode ?? (error as any).status;
        if (status === 404 || error.message?.toLowerCase().includes('not found')) {
            return false;
        }
        throw new Error(error.message);
    }

    if (!data) return false;

    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
        throw new Error('Supabase returned an empty file body');
    }

    // Ensure parent directory exists (preserves bucket directory structure)
    const parentDir = path.dirname(localPath);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(localPath, buffer);

    // Integrity check: written size must match downloaded size
    const writtenSize = fs.statSync(localPath).size;
    if (writtenSize !== buffer.length) {
        fs.unlinkSync(localPath); // Remove corrupt file
        throw new Error(`Size mismatch after write: expected ${buffer.length}B, got ${writtenSize}B`);
    }

    return true;
}

// ── Database URL rewriting ─────────────────────────────────

/**
 * Builds the local URL for a given remote bucket path.
 * Preserves the directory structure under /uploads/.
 */
function toLocalUrl(remotePath: string): string {
    return `/uploads/${remotePath}`;
}

/**
 * Checks whether a URL points to Supabase Storage.
 */
function isSupabaseUrl(url: string): boolean {
    return Boolean(url?.includes('supabase.co') || url?.includes('supabase.in'));
}

/**
 * Extracts the bucket-relative path from a full Supabase public URL.
 * e.g. "https://xxx.supabase.co/storage/v1/object/public/documents/tenantId/file.pdf"
 *   → "tenantId/file.pdf"
 */
function extractRemotePath(url: string): string {
    const marker = `${BUCKET_NAME}/`;
    const idx = url.indexOf(marker);
    if (idx !== -1) {
        return decodeURIComponent(url.slice(idx + marker.length).split('?')[0]);
    }
    // Fallback: use just the filename
    return path.basename(url.split('?')[0]);
}

/**
 * Rewrites all Supabase fileUrls in the Document and TechnicalCertificate
 * tables to their corresponding local /uploads/ paths.
 */
async function rewriteDatabaseUrls(
    prisma: PrismaClient,
    result: MigrationResult
): Promise<void> {
    log('\n🔄 Rewriting database URLs...');

    // ── Documents ──
    const docs = await prisma.document.findMany({
        where: { fileUrl: { contains: 'supabase' } },
        select: { id: true, fileUrl: true },
    });

    for (const doc of docs) {
        const remotePath = extractRemotePath(doc.fileUrl);
        const newUrl = toLocalUrl(remotePath);
        try {
            await prisma.document.update({ where: { id: doc.id }, data: { fileUrl: newUrl } });
            result.rewritten++;
        } catch (err: any) {
            logError(`  ❌ DB update failed for Document ${doc.id}: ${err.message}`);
        }
    }

    // ── TechnicalCertificates ──
    const certs = await prisma.technicalCertificate.findMany({
        where: { fileUrl: { contains: 'supabase' } },
        select: { id: true, fileUrl: true },
    });

    for (const cert of certs) {
        const remotePath = extractRemotePath(cert.fileUrl);
        const newUrl = toLocalUrl(remotePath);
        try {
            await prisma.technicalCertificate.update({ where: { id: cert.id }, data: { fileUrl: newUrl } });
            result.rewritten++;
        } catch (err: any) {
            logError(`  ❌ DB update failed for TechnicalCertificate ${cert.id}: ${err.message}`);
        }
    }

    log(`  ✅ Rewrote ${result.rewritten} database URL(s)`);
}

// ── Main ───────────────────────────────────────────────────

async function main(): Promise<void> {
    log('═══════════════════════════════════════════════════');
    log('  LicitaSaaS — Supabase → Local Storage Migration');
    log('═══════════════════════════════════════════════════');
    log(`  Bucket:      ${BUCKET_NAME}`);
    log(`  Upload dir:  ${UPLOAD_DIR}`);
    log(`  Mode:        ${DRY_RUN ? '🔍 DRY RUN (no files written)' : '🚀 LIVE'}`);
    log(`  URL rewrite: ${REWRITE_URLS ? '✅ Enabled (--rewrite)' : '❌ Disabled'}`);
    log('═══════════════════════════════════════════════════\n');

    // ── Validate environment ──
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        logError('❌ SUPABASE_URL and SUPABASE_KEY environment variables are required.');
        process.exit(1);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const prisma = new PrismaClient();

    // Ensure the upload directory exists
    if (!DRY_RUN && !fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        log(`📁 Created upload directory: ${UPLOAD_DIR}`);
    }

    const result: MigrationResult = {
        total: 0,
        downloaded: 0,
        skipped: 0,
        failed: 0,
        rewritten: 0,
        errors: [],
    };

    // ── Step 1: List all files in the bucket ──
    log('📋 Listing all files in Supabase bucket...');
    let bucketFiles: BucketFile[];
    try {
        bucketFiles = await listBucketFiles(supabase);
    } catch (err: any) {
        logError(`❌ Failed to list bucket: ${err.message}`);
        await prisma.$disconnect();
        process.exit(1);
    }

    log(`📦 Found ${bucketFiles.length} file(s) in bucket "${BUCKET_NAME}"\n`);

    if (bucketFiles.length === 0) {
        log('ℹ️  Bucket is empty — nothing to migrate.');
        await prisma.$disconnect();
        log('\nMigration completed successfully');
        return;
    }

    // ── Step 2: Download each file ──
    for (const file of bucketFiles) {
        result.total++;
        const localPath = path.join(UPLOAD_DIR, file.remotePath);
        const sizeLabel = file.size > 0 ? `${Math.round(file.size / 1024)}KB` : 'unknown size';

        // Skip files that already exist locally (idempotent)
        if (fs.existsSync(localPath)) {
            log(`  ⏭️  Skipping (already exists): ${file.remotePath}`);
            result.skipped++;
            continue;
        }

        if (DRY_RUN) {
            log(`  [DRY] Would download: ${file.remotePath} (${sizeLabel})`);
            result.skipped++;
            continue;
        }

        try {
            log(`  ⬇️  Downloading: ${file.remotePath} (${sizeLabel})`);
            const found = await downloadFile(supabase, file.remotePath, localPath);

            if (!found) {
                logError(`  ⚠️  Not found on Supabase (404): ${file.remotePath}`);
                result.failed++;
                result.errors.push({ path: file.remotePath, reason: 'Not found on Supabase (404)' });
            } else {
                const actualKB = Math.round(fs.statSync(localPath).size / 1024);
                log(`  ✅ Saved: ${file.remotePath} (${actualKB}KB)`);
                result.downloaded++;
            }
        } catch (err: any) {
            logError(`  ❌ Error downloading ${file.remotePath}: ${err.message}`);
            result.failed++;
            result.errors.push({ path: file.remotePath, reason: err.message });
        }

        // Polite rate-limiting: 150ms between requests to avoid hammering the API
        await new Promise(r => setTimeout(r, 150));
    }

    // ── Step 3: Rewrite database URLs (opt-in) ──
    if (REWRITE_URLS && !DRY_RUN) {
        await rewriteDatabaseUrls(prisma, result);
    }

    await prisma.$disconnect();

    // ── Summary ──
    log('\n═══════════════════════════════════════════════════');
    log('  Migration Summary');
    log('═══════════════════════════════════════════════════');
    log(`  Total files in bucket : ${result.total}`);
    log(`  Downloaded            : ${result.downloaded}`);
    log(`  Skipped (exist local) : ${result.skipped}`);
    log(`  Failed                : ${result.failed}`);
    if (REWRITE_URLS) {
        log(`  DB URLs rewritten     : ${result.rewritten}`);
    }

    if (result.errors.length > 0) {
        log('\n  ❌ Failed files:');
        result.errors.forEach(e => log(`    • ${e.path} — ${e.reason}`));
    }

    log('═══════════════════════════════════════════════════');

    if (result.failed > 0) {
        log(`\n  ⚠️  ${result.failed} file(s) failed. Re-run the script to retry.`);
        if (!REWRITE_URLS && result.downloaded > 0) {
            log('  💡 Add --rewrite to update database URLs once all files are migrated.');
        }
        // Exit with non-zero so CI/deployment pipelines can detect partial failures
        process.exit(1);
    }

    log('\nMigration completed successfully');
}

main().catch(err => {
    logError(`Fatal error: ${err.message ?? err}`);
    process.exit(1);
});
