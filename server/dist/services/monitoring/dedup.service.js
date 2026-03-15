"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DedupService = void 0;
const crypto_1 = __importDefault(require("crypto"));
class DedupService {
    static generateFingerprint(processId, messageId, content, authorType) {
        const rawString = `${processId}|${messageId || 'NO_ID'}|${(content || '').trim().toLowerCase()}|${authorType || 'UNKNOWN'}`;
        return crypto_1.default.createHash('sha256').update(rawString).digest('hex');
    }
}
exports.DedupService = DedupService;
