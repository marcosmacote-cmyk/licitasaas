import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';

export interface StorageService {
    uploadFile(file: Express.Multer.File, tenantId?: string): Promise<{ url: string; fileName: string }>;
    deleteFile(fileUrl: string): Promise<void>;
    getFileBuffer(fileUrlOrName: string): Promise<Buffer>;
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

    async getFileBuffer(fileUrlOrName: string): Promise<Buffer> {
        const fileName = path.basename(fileUrlOrName);
        const filePath = path.join(this.uploadDir, fileName);
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        return fs.readFileSync(filePath);
    }
}

class SupabaseStorageService implements StorageService {
    private supabase;
    private bucketName: string;

    constructor() {
        const url = process.env.SUPABASE_URL || '';
        const key = process.env.SUPABASE_KEY || '';
        this.bucketName = process.env.SUPABASE_BUCKET || 'documents';
        this.supabase = createClient(url, key);
    }

    async uploadFile(file: Express.Multer.File, tenantId?: string): Promise<{ url: string; fileName: string }> {
        const prefix = tenantId ? `${tenantId}/` : ''; // Folder by tenant
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
        // Extract path from public URL
        // Example: https://xxx.supabase.co/storage/v1/object/public/documents/tenant/file.pdf
        const parts = fileUrl.split(`${this.bucketName}/`);
        if (parts.length > 1) {
            const path = parts[1];
            await this.supabase.storage.from(this.bucketName).remove([path]);
        }
    }

    async getFileBuffer(fileUrlOrName: string): Promise<Buffer> {
        // If it's a full URL, extract the path
        let filePath = fileUrlOrName;
        if (fileUrlOrName.startsWith('http')) {
            const parts = fileUrlOrName.split(`${this.bucketName}/`);
            if (parts.length > 1) {
                filePath = parts[1];
            }
        }

        // Clean query parameters and decoding
        filePath = decodeURIComponent(filePath).split('?')[0];

        try {
            console.log(`[Supabase Storage] Downloading path: "${filePath}" from bucket: "${this.bucketName}"`);
            const { data, error } = await this.supabase.storage
                .from(this.bucketName)
                .download(filePath);

            if (error) {
                console.error(`[Supabase Storage] Error downloading ${filePath}:`, error);
                throw error;
            }
            if (!data) throw new Error("No data returned from Supabase storage");

            const arrayBuffer = await data.arrayBuffer();
            return Buffer.from(arrayBuffer);
        } catch (err) {
            console.error(`[Supabase Storage] Exception downloading ${filePath}:`, err);
            throw err;
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

    async getFileBuffer(_fileUrlOrName: string): Promise<Buffer> {
        throw new Error("Method not implemented.");
    }
}

const STORAGE_TYPE = process.env.STORAGE_TYPE || 'LOCAL';
console.log(`[Storage] Initializing storage system with type: ${STORAGE_TYPE}`);

export const storageService: StorageService =
    STORAGE_TYPE === 'SUPABASE' ? new SupabaseStorageService() :
        STORAGE_TYPE === 'S3' ? new S3StorageService() :
            new LocalStorageService();

console.log(`[Storage] Storage Service instance created: ${storageService.constructor.name}`);
