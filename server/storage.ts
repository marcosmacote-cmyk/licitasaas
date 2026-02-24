import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface StorageService {
    uploadFile(file: Express.Multer.File, tenantId?: string): Promise<{ url: string; fileName: string }>;
    deleteFile(fileUrl: string): Promise<void>;
}

class LocalStorageService implements StorageService {
    private uploadDir: string;

    constructor() {
        const serverRoot = __dirname.endsWith('dist') ? path.resolve(__dirname, '..') : __dirname;
        this.uploadDir = path.join(serverRoot, 'uploads');
        if (!fs.existsSync(this.uploadDir)) {
            fs.mkdirSync(this.uploadDir, { recursive: true });
        }
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
        const fileName = path.basename(fileUrl);
        const filePath = path.join(this.uploadDir, fileName);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
}

class S3StorageService implements StorageService {
    async uploadFile(file: Express.Multer.File, tenantId?: string): Promise<{ url: string; fileName: string }> {
        // Mock implementation for S3 - In production, use @aws-sdk/client-s3
        console.log(`[S3] Uploading ${file.originalname} for tenant ${tenantId}`);
        const uniqueName = `${tenantId || 'root'}_${uuidv4()}${path.extname(file.originalname)}`;
        return {
            url: `https://s3-placeholder.aws.com/${uniqueName}`, // Example URL
            fileName: uniqueName
        };
    }

    async deleteFile(fileUrl: string): Promise<void> {
        console.log(`[S3] Deleting file ${fileUrl}`);
    }
}

const STORAGE_TYPE = process.env.STORAGE_TYPE || 'LOCAL';

export const storageService: StorageService = STORAGE_TYPE === 'S3'
    ? new S3StorageService()
    : new LocalStorageService();
