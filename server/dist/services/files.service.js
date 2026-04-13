"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFileSafe = exports.getTempFilePath = exports.initStoragePaths = exports.uploadDir = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Resolve server root (handles both ts-node and compiled dist/)
const SERVER_ROOT = __dirname.endsWith('dist') ? path_1.default.resolve(__dirname, '../..') : path_1.default.resolve(__dirname, '..');
// Setup uploads directory for Mock Bucket
exports.uploadDir = path_1.default.join(SERVER_ROOT, 'uploads');
const initStoragePaths = () => {
    if (!fs_1.default.existsSync(exports.uploadDir)) {
        fs_1.default.mkdirSync(exports.uploadDir, { recursive: true });
    }
};
exports.initStoragePaths = initStoragePaths;
// Common file helpers can be added here
const getTempFilePath = (prefix, fileName) => {
    const safeName = fileName.replace(/[^a-z0-9._-]/gi, '_');
    return path_1.default.join(exports.uploadDir, `${prefix}_${Date.now()}_${safeName}`);
};
exports.getTempFilePath = getTempFilePath;
const deleteFileSafe = (filePath) => {
    try {
        if (filePath && fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
        }
    }
    catch (_e) {
        // Ignore deletion errors
    }
};
exports.deleteFileSafe = deleteFileSafe;
