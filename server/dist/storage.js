"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.storageService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const supabase_js_1 = require("@supabase/supabase-js");
class LocalStorageService {
    constructor() {
        const serverRoot = __dirname.endsWith('dist') ? path_1.default.resolve(__dirname, '..') : __dirname;
        this.uploadDir = path_1.default.join(serverRoot, 'uploads');
        if (!fs_1.default.existsSync(this.uploadDir)) {
            fs_1.default.mkdirSync(this.uploadDir, { recursive: true });
        }
    }
    async uploadFile(file, tenantId) {
        const prefix = tenantId ? `${tenantId}_` : '';
        const uniqueName = `${prefix}${(0, uuid_1.v4)()}${path_1.default.extname(file.originalname)}`;
        const filePath = path_1.default.join(this.uploadDir, uniqueName);
        fs_1.default.writeFileSync(filePath, file.buffer);
        return {
            url: `/uploads/${uniqueName}`,
            fileName: uniqueName
        };
    }
    async deleteFile(fileUrl) {
        const fileName = path_1.default.basename(fileUrl);
        const filePath = path_1.default.join(this.uploadDir, fileName);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
        }
    }
    async getFileBuffer(fileUrlOrName) {
        const fileName = path_1.default.basename(fileUrlOrName);
        const filePath = path_1.default.join(this.uploadDir, fileName);
        if (!fs_1.default.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        return fs_1.default.readFileSync(filePath);
    }
}
class SupabaseStorageService {
    constructor() {
        const url = process.env.SUPABASE_URL || '';
        const key = process.env.SUPABASE_KEY || '';
        this.bucketName = process.env.SUPABASE_BUCKET || 'documents';
        this.supabase = (0, supabase_js_1.createClient)(url, key);
    }
    async uploadFile(file, tenantId) {
        const prefix = tenantId ? `${tenantId}/` : ''; // Folder by tenant
        const uniqueName = `${prefix}${(0, uuid_1.v4)()}${path_1.default.extname(file.originalname)}`;
        const { data, error } = await this.supabase.storage
            .from(this.bucketName)
            .upload(uniqueName, file.buffer, {
            contentType: file.mimetype,
            upsert: true
        });
        if (error)
            throw error;
        const { data: { publicUrl } } = this.supabase.storage
            .from(this.bucketName)
            .getPublicUrl(uniqueName);
        return {
            url: publicUrl,
            fileName: uniqueName
        };
    }
    async deleteFile(fileUrl) {
        // Extract path from public URL
        // Example: https://xxx.supabase.co/storage/v1/object/public/documents/tenant/file.pdf
        const parts = fileUrl.split(`${this.bucketName}/`);
        if (parts.length > 1) {
            const path = parts[1];
            await this.supabase.storage.from(this.bucketName).remove([path]);
        }
    }
    async getFileBuffer(fileUrlOrName) {
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
            if (!data)
                throw new Error("No data returned from Supabase storage");
            const arrayBuffer = await data.arrayBuffer();
            return Buffer.from(arrayBuffer);
        }
        catch (err) {
            console.error(`[Supabase Storage] Exception downloading ${filePath}:`, err);
            throw err;
        }
    }
}
class S3StorageService {
    async uploadFile(file, tenantId) {
        // Mock implementation for S3 - In production, use @aws-sdk/client-s3
        console.log(`[S3] Uploading ${file.originalname} for tenant ${tenantId}`);
        const uniqueName = `${tenantId || 'root'}_${(0, uuid_1.v4)()}${path_1.default.extname(file.originalname)}`;
        return {
            url: `https://s3-placeholder.aws.com/${uniqueName}`, // Example URL
            fileName: uniqueName
        };
    }
    async deleteFile(fileUrl) {
        console.log(`[S3] Deleting file ${fileUrl}`);
    }
    async getFileBuffer(_fileUrlOrName) {
        throw new Error("Method not implemented.");
    }
}
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'LOCAL';
console.log(`[Storage] Initializing storage system with type: ${STORAGE_TYPE}`);
exports.storageService = STORAGE_TYPE === 'SUPABASE' ? new SupabaseStorageService() :
    STORAGE_TYPE === 'S3' ? new S3StorageService() :
        new LocalStorageService();
console.log(`[Storage] Storage Service instance created: ${exports.storageService.constructor.name}`);
