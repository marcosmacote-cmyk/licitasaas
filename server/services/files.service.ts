import path from 'path';
import fs from 'fs';

// Resolve server root (handles both ts-node and compiled dist/)
const SERVER_ROOT = __dirname.endsWith('dist') ? path.resolve(__dirname, '../..') : path.resolve(__dirname, '..');

// Setup uploads directory for Mock Bucket
export const uploadDir = path.join(SERVER_ROOT, 'uploads');

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
