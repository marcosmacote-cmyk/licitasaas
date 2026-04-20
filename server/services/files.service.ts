import path from 'path';
import fs from 'fs';

// Resolve server root (handles both ts-node and compiled dist/)
// In production: __dirname = /app/server/dist/services → SERVER_ROOT = /app/server
// In dev (ts-node): __dirname = /path/server/services → SERVER_ROOT = /path/server
const pathParts = __dirname.split(path.sep);
const distIndex = pathParts.lastIndexOf('dist');
const SERVER_ROOT = distIndex >= 0
    ? pathParts.slice(0, distIndex).join(path.sep) || '/'
    : path.resolve(__dirname, '..');

// Setup uploads directory for Mock Bucket
export const uploadDir = path.join(SERVER_ROOT, 'uploads');

// Auto-initialize on import to prevent ENOENT crashes in any consumer
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

export const initStoragePaths = () => {
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }
};

// Common file helpers can be added here
export const getTempFilePath = (prefix: string, fileName: string) => {
    const safeName = fileName.replace(/[^a-z0-9._-]/gi, '_');
    return path.join(uploadDir, `${prefix}_${Date.now()}_${safeName}`);
};

export const deleteFileSafe = (filePath: string) => {
    try {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (_e) {
        // Ignore deletion errors
    }
};
