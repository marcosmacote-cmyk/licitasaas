import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * ═══════════════════════════════════════════════════════════
 * LicitaSaaS — Storage Service (Unified)
 * ═══════════════════════════════════════════════════════════
 *
 * Modes:
 *   STORAGE_TYPE=LOCAL     → Pure local disk (Railway Volume)
 *   STORAGE_TYPE=RAILWAY   → Local disk + Supabase read-fallback (MIGRATION MODE)
 *   STORAGE_TYPE=SUPABASE  → Legacy Supabase-only mode
 *
 * Migration path: SUPABASE → RAILWAY → LOCAL
 *   1. Set STORAGE_TYPE=RAILWAY — new files go to disk, old files fetched from Supabase on first access
 *   2. Run migration script to bulk-copy Supabase → disk
 *   3. Once confirmed, switch STORAGE_TYPE=LOCAL and remove Supabase env vars
 * ═══════════════════════════════════════════════════════════
 */

export interface StorageService {
    uploadFile(file: Express.Multer.File, tenantId?: string): Promise<{ url: string; fileName: string }>;
    deleteFile(fileUrl: string): Promise<void>;
    getFileBuffer(fileUrlOrName: string): Promise<Buffer>;
}

// ── Helpers ──

function getUploadDir(): string {
    const serverRoot = __dirname.endsWith('dist') ? path.resolve(__dirname, '..') : __dirname;
    const dir = process.env.NODE_ENV === 'production' ? '/app/uploads' : path.join(serverRoot, 'uploads');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * Extracts the filename from either a local path (/uploads/abc.pdf)
 * or a Supabase URL (https://xxx.supabase.co/storage/v1/object/public/documents/tenant/abc.pdf)
 */
function extractFileName(fileUrlOrName: string): string {
    if (!fileUrlOrName) return '';

    // Remove query parameters
    const cleanUrl = fileUrlOrName.split('?')[0];

    // If it's a full URL, get the last path segment
    if (cleanUrl.startsWith('http')) {
        const urlPath = new URL(cleanUrl).pathname;
        return path.basename(urlPath);
    }

    // If it's a local path like /uploads/abc.pdf, get the basename
    return path.basename(cleanUrl);
}

/**
 * Checks if a URL is a Supabase URL
 */
function isSupabaseUrl(url: string): boolean {
    return url.includes('supabase.co') || url.includes('supabase.in');
}

/**
 * Extracts the Supabase storage path from a full Supabase URL.
 * Example: https://xxx.supabase.co/storage/v1/object/public/documents/tenantId/abc.pdf
 * Returns: tenantId/abc.pdf
 */
function extractSupabasePath(url: string, bucketName: string): string {
    const parts = url.split(`${bucketName}/`);
    if (parts.length > 1) {
        return decodeURIComponent(parts[1].split('?')[0]);
    }
    // Fallback: use just the filename
    return extractFileName(url);
}


// ═══════════════════════════════════════════════════════════
// ── LocalStorageService: Pure local disk (Railway Volume) ──
// ═══════════════════════════════════════════════════════════

class LocalStorageService implements StorageService {
    private uploadDir: string;

    constructor() {
        this.uploadDir = getUploadDir();
    }

    async uploadFile(file: Express.Multer.File, tenantId?: string): Promise<{ url: string; fileName: string }> {
        const prefix = tenantId ? `${tenantId}_` : '';
        const uniqueName = `${prefix}${uuidv4()}${path.extname(file.originalname)}`;
        const filePath = path.join(this.uploadDir, uniqueName);

        fs.writeFileSync(filePath, file.buffer);

        return {
            url: `/uploads/${uniqueName}`,
            fileName: uniqueName
        };
    }

    async deleteFile(fileUrl: string): Promise<void> {
        const fileName = extractFileName(fileUrl);
        const filePath = path.join(this.uploadDir, fileName);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    async getFileBuffer(fileUrlOrName: string): Promise<Buffer> {
        const fileName = extractFileName(fileUrlOrName);
        const filePath = path.join(this.uploadDir, fileName);
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        return fs.readFileSync(filePath);
    }
}


// ═══════════════════════════════════════════════════════════
// ── RailwayStorageService: MIGRATION MODE ──
// Writes to local disk. Reads local-first, falls back to
// Supabase for legacy files. Auto-caches Supabase files locally.
// ═══════════════════════════════════════════════════════════

class RailwayStorageService implements StorageService {
    private uploadDir: string;
    private supabase: any; // Lazy-initialized
    private bucketName: string;
    private supabaseAvailable: boolean;

    constructor() {
        this.uploadDir = getUploadDir();
        this.bucketName = process.env.SUPABASE_BUCKET || 'documents';
        this.supabaseAvailable = false;

        // Lazy-init Supabase for read-fallback only
        const url = process.env.SUPABASE_URL || '';
        const key = process.env.SUPABASE_KEY || '';
        if (url && key) {
            try {
                // Dynamic import to avoid crash if @supabase/supabase-js is not installed
                const { createClient } = require('@supabase/supabase-js');
                this.supabase = createClient(url, key);
                this.supabaseAvailable = true;
                console.log('[Storage] 🔄 RAILWAY mode: Supabase read-fallback enabled');
            } catch (err: any) {
                console.warn('[Storage] ⚠️ RAILWAY mode: Supabase SDK not available, fallback disabled');
            }
        } else {
            console.warn('[Storage] ⚠️ RAILWAY mode: No Supabase credentials, fallback disabled');
        }
    }

    /**
     * UPLOAD: Always writes to local disk (never to Supabase anymore)
     */
    async uploadFile(file: Express.Multer.File, tenantId?: string): Promise<{ url: string; fileName: string }> {
        const prefix = tenantId ? `${tenantId}_` : '';
        const uniqueName = `${prefix}${uuidv4()}${path.extname(file.originalname)}`;
        const filePath = path.join(this.uploadDir, uniqueName);

        fs.writeFileSync(filePath, file.buffer);

        return {
            url: `/uploads/${uniqueName}`,
            fileName: uniqueName
        };
    }

    /**
     * DELETE: Removes from local disk. If it was a Supabase URL, also tries to remove from Supabase.
     */
    async deleteFile(fileUrl: string): Promise<void> {
        // Delete local copy
        const fileName = extractFileName(fileUrl);
        const localPath = path.join(this.uploadDir, fileName);
        if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
        }

        // Also delete from Supabase if it's a Supabase URL
        if (isSupabaseUrl(fileUrl) && this.supabaseAvailable) {
            try {
                const sbPath = extractSupabasePath(fileUrl, this.bucketName);
                await this.supabase.storage.from(this.bucketName).remove([sbPath]);
            } catch (err: any) {
                console.warn(`[Storage] Supabase delete failed (non-blocking): ${err.message}`);
            }
        }
    }

    /**
     * READ: Try local disk first. If not found and URL is Supabase, fetch from Supabase
     * and cache locally for future reads (auto-migration on access).
     */
    async getFileBuffer(fileUrlOrName: string): Promise<Buffer> {
        const fileName = extractFileName(fileUrlOrName);
        const localPath = path.join(this.uploadDir, fileName);

        // 1. Try local disk first (fast path)
        if (fs.existsSync(localPath)) {
            return fs.readFileSync(localPath);
        }

        // 2. If it's a Supabase URL, try to fetch and cache locally
        if (isSupabaseUrl(fileUrlOrName) && this.supabaseAvailable) {
            console.log(`[Storage] 📥 Fetching from Supabase (auto-migrating): ${fileName}`);

            const sbPath = extractSupabasePath(fileUrlOrName, this.bucketName);

            try {
                const { data, error } = await this.supabase.storage
                    .from(this.bucketName)
                    .download(sbPath);

                if (error) throw error;
                if (!data) throw new Error('No data returned from Supabase');

                const arrayBuffer = await data.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                // Cache locally for future reads (auto-migration)
                try {
                    fs.writeFileSync(localPath, buffer);
                    console.log(`[Storage] ✅ Auto-migrated to local: ${fileName} (${Math.round(buffer.length / 1024)}KB)`);
                } catch (writeErr: any) {
                    console.warn(`[Storage] Could not cache locally: ${writeErr.message}`);
                }

                return buffer;
            } catch (err: any) {
                console.warn(`[Storage] Supabase download failed: ${err.message}`);
                throw new Error(`File not found locally or on Supabase: ${fileName}`);
            }
        }

        // 3. Not found anywhere
        throw new Error(`File not found: ${localPath}`);
    }
}


// ═══════════════════════════════════════════════════════════
// ── Legacy SupabaseStorageService (kept for backward compat) ──
// ═══════════════════════════════════════════════════════════

class SupabaseStorageService implements StorageService {
    private supabase: any;
    private bucketName: string;

    constructor() {
        const url = process.env.SUPABASE_URL || '';
        const key = process.env.SUPABASE_KEY || '';
        this.bucketName = process.env.SUPABASE_BUCKET || 'documents';
        const { createClient } = require('@supabase/supabase-js');
        this.supabase = createClient(url, key);
    }

    async uploadFile(file: Express.Multer.File, tenantId?: string): Promise<{ url: string; fileName: string }> {
        const prefix = tenantId ? `${tenantId}/` : '';
        const uniqueName = `${prefix}${uuidv4()}${path.extname(file.originalname)}`;

        const { data, error } = await this.supabase.storage
            .from(this.bucketName)
            .upload(uniqueName, file.buffer, {
                contentType: file.mimetype,
                upsert: true
            });

        if (error) throw error;

        const { data: { publicUrl } } = this.supabase.storage
            .from(this.bucketName)
            .getPublicUrl(uniqueName);

        return {
            url: publicUrl,
            fileName: uniqueName
        };
    }

    async deleteFile(fileUrl: string): Promise<void> {
        const parts = fileUrl.split(`${this.bucketName}/`);
        if (parts.length > 1) {
            const p = parts[1];
            await this.supabase.storage.from(this.bucketName).remove([p]);
        }
    }

    async getFileBuffer(fileUrlOrName: string): Promise<Buffer> {
        let filePath = fileUrlOrName;
        if (fileUrlOrName.startsWith('http')) {
            const parts = fileUrlOrName.split(`${this.bucketName}/`);
            if (parts.length > 1) {
                filePath = parts[1];
            }
        }

        filePath = decodeURIComponent(filePath).split('?')[0];

        try {
            console.log(`[Supabase Storage] Downloading path: "${filePath}" from bucket: "${this.bucketName}"`);
            const { data, error } = await this.supabase.storage
                .from(this.bucketName)
                .download(filePath);

            if (error) {
                if ((error as any).statusCode === 400 || (error as any).statusCode === 404 || error.message?.includes('400')) {
                    console.warn(`[Supabase Storage] Not found or invalid path: ${filePath}`);
                } else {
                    console.error(`[Supabase Storage] Error downloading ${filePath}:`, error.message || error);
                }
                throw error;
            }
            if (!data) throw new Error("No data returned from Supabase storage");

            const arrayBuffer = await data.arrayBuffer();
            return Buffer.from(arrayBuffer);
        } catch (err: any) {
            console.warn(`[Supabase Storage] Exception downloading ${filePath}: ${err.message || 'Unknown error'}`);
            throw err;
        }
    }
}


// ═══════════════════════════════════════════════════════════
// ── Service Factory ──
// ═══════════════════════════════════════════════════════════

const STORAGE_TYPE = process.env.STORAGE_TYPE || 'LOCAL';
console.log(`[Storage] Initializing storage system with type: ${STORAGE_TYPE}`);

export const storageService: StorageService =
    STORAGE_TYPE === 'RAILWAY' ? new RailwayStorageService() :
        STORAGE_TYPE === 'SUPABASE' ? new SupabaseStorageService() :
            new LocalStorageService();

console.log(`[Storage] Storage Service instance created: ${storageService.constructor.name}`);

// Export helpers for migration script
export { isSupabaseUrl, extractFileName, extractSupabasePath, getUploadDir };
