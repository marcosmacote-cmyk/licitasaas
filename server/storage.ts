import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * ═══════════════════════════════════════════════════════════
 * LicitaSaaS — Storage Service (Local Only)
 * ═══════════════════════════════════════════════════════════
 *
 * All files are stored on local disk (Railway Volume at /app/uploads).
 * Legacy Supabase modes (RAILWAY, SUPABASE) have been removed.
 *
 * STORAGE_TYPE env var is accepted for backward compatibility
 * but only LOCAL mode is active.
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
 * Extracts the filename from a local path (/uploads/abc.pdf)
 * or a legacy Supabase URL (for backward compatibility with old DB records)
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
 * Checks if a URL is a legacy Supabase URL (for backward compat)
 */
function isSupabaseUrl(url: string): boolean {
    return url.includes('supabase.co') || url.includes('supabase.in');
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

        await fs.promises.writeFile(filePath, file.buffer);

        return {
            url: `/uploads/${uniqueName}`,
            fileName: uniqueName
        };
    }

    async deleteFile(fileUrl: string): Promise<void> {
        const fileName = extractFileName(fileUrl);
        const filePath = path.join(this.uploadDir, fileName);
        try {
            await fs.promises.unlink(filePath);
        } catch (err) {
            // Ignore if file doesn't exist
        }
    }

    async getFileBuffer(fileUrlOrName: string): Promise<Buffer> {
        const fileName = extractFileName(fileUrlOrName);
        const filePath = path.join(this.uploadDir, fileName);
        try {
            return await fs.promises.readFile(filePath);
        } catch (err: any) {
            throw new Error(`File not found: ${filePath}. Inner: ${err.message}`);
        }
    }
}


// ═══════════════════════════════════════════════════════════
// ── Service Factory ──
// ═══════════════════════════════════════════════════════════

const STORAGE_TYPE = process.env.STORAGE_TYPE || 'LOCAL';
if (STORAGE_TYPE !== 'LOCAL') {
    console.warn(`[Storage] ⚠️ STORAGE_TYPE=${STORAGE_TYPE} is deprecated. Using LOCAL mode.`);
}
console.log(`[Storage] Initializing storage: LOCAL (disk at ${getUploadDir()})`);

export const storageService: StorageService = new LocalStorageService();

// Export helpers for other modules
export { isSupabaseUrl, extractFileName, getUploadDir };
