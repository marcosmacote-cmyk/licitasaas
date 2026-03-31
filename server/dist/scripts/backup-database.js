#!/usr/bin/env ts-node
"use strict";
/**
 * 🗄️ LicitaSaaS — Backup Automatizado do PostgreSQL
 *
 * Este script faz pg_dump do banco, comprime com gzip,
 * e sobe para o Supabase Storage (bucket: backups).
 *
 * Uso manual:
 *   npx ts-node server/scripts/backup-database.ts
 *
 * Em produção (Railway cron job ou container separado):
 *   node dist/scripts/backup-database.js
 *
 * Variáveis necessárias:
 *   DATABASE_URL        — Connection string do Postgres
 *   SUPABASE_URL        — URL do projeto Supabase
 *   SUPABASE_KEY        — Service role key
 *   BACKUP_RETENTION_DAYS — Dias para manter backups (default: 7)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBackup = runBackup;
const child_process_1 = require("child_process");
const supabase_js_1 = require("@supabase/supabase-js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
// Load env
const SERVER_ROOT = __dirname.endsWith('dist/scripts')
    ? path_1.default.resolve(__dirname, '../..')
    : path_1.default.resolve(__dirname, '..');
dotenv_1.default.config({ path: path_1.default.join(SERVER_ROOT, '.env'), override: false });
const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BACKUP_BUCKET = process.env.BACKUP_BUCKET || 'backups';
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '7');
// ── Helpers ──
function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
function log(msg) {
    console.log(`[Backup ${new Date().toISOString()}] ${msg}`);
}
function error(msg) {
    console.error(`[Backup ERROR ${new Date().toISOString()}] ${msg}`);
}
// ── Main ──
async function runBackup() {
    // Validate env
    if (!DATABASE_URL) {
        error('DATABASE_URL não configurada');
        return { success: false, error: 'DATABASE_URL not set' };
    }
    const useSupabase = !!(SUPABASE_URL && SUPABASE_KEY);
    const fileName = `licitasaas-backup-${timestamp()}.sql.gz`;
    const tmpDir = path_1.default.join(SERVER_ROOT, '.tmp-backups');
    const tmpFile = path_1.default.join(tmpDir, fileName);
    try {
        // 1. Create temp dir
        if (!fs_1.default.existsSync(tmpDir)) {
            fs_1.default.mkdirSync(tmpDir, { recursive: true });
        }
        // 2. pg_dump → gzip
        log(`Iniciando pg_dump...`);
        const startTime = Date.now();
        // Use pg_dump with DATABASE_URL, pipe through gzip
        // --no-owner --no-acl: makes restore easier across environments
        // --format=plain: SQL text format (compressible)
        (0, child_process_1.execSync)(`pg_dump "${DATABASE_URL}" --no-owner --no-acl --clean --if-exists | gzip > "${tmpFile}"`, {
            timeout: 300000, // 5 min max
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PGCONNECT_TIMEOUT: '30' }
        });
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const stats = fs_1.default.statSync(tmpFile);
        const sizeKB = Math.round(stats.size / 1024);
        log(`pg_dump concluído em ${duration}s — ${sizeKB}KB comprimido`);
        // 3. Upload to Supabase Storage (if configured)
        if (useSupabase) {
            log(`Enviando para Supabase Storage (bucket: ${BACKUP_BUCKET})...`);
            const supabase = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_KEY);
            // Ensure bucket exists
            const { error: bucketError } = await supabase.storage.createBucket(BACKUP_BUCKET, {
                public: false,
                fileSizeLimit: 500 * 1024 * 1024, // 500MB max
            });
            // Ignore "already exists" error
            if (bucketError && !bucketError.message?.includes('already exists')) {
                log(`Aviso ao criar bucket: ${bucketError.message} (pode já existir)`);
            }
            const fileBuffer = fs_1.default.readFileSync(tmpFile);
            const remotePath = `daily/${fileName}`;
            const { error: uploadError } = await supabase.storage
                .from(BACKUP_BUCKET)
                .upload(remotePath, fileBuffer, {
                contentType: 'application/gzip',
                upsert: true
            });
            if (uploadError) {
                error(`Falha no upload: ${uploadError.message}`);
                return { success: false, error: `Upload failed: ${uploadError.message}` };
            }
            log(`✅ Upload concluído: ${BACKUP_BUCKET}/${remotePath}`);
            // 4. Cleanup old backups (retention policy)
            await cleanupOldBackups(supabase);
        }
        else {
            log(`⚠️ Supabase não configurado. Backup salvo localmente: ${tmpFile}`);
            // Keep local file if no Supabase
            return { success: true, fileName, sizeKB };
        }
        // 5. Remove local temp file (Supabase has it now)
        fs_1.default.unlinkSync(tmpFile);
        log(`Arquivo local temporário removido`);
        return { success: true, fileName, sizeKB };
    }
    catch (err) {
        error(`Falha no backup: ${err.message}`);
        // Cleanup on error
        try {
            if (fs_1.default.existsSync(tmpFile))
                fs_1.default.unlinkSync(tmpFile);
        }
        catch (_) { }
        return { success: false, error: err.message };
    }
}
async function cleanupOldBackups(supabase) {
    try {
        const { data: files } = await supabase.storage
            .from(BACKUP_BUCKET)
            .list('daily', { limit: 100, sortBy: { column: 'created_at', order: 'asc' } });
        if (!files || files.length === 0)
            return;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
        const toDelete = [];
        for (const file of files) {
            const fileDate = new Date(file.created_at);
            if (fileDate < cutoffDate) {
                toDelete.push(`daily/${file.name}`);
            }
        }
        if (toDelete.length > 0) {
            await supabase.storage.from(BACKUP_BUCKET).remove(toDelete);
            log(`🗑️ Removidos ${toDelete.length} backups antigos (>${RETENTION_DAYS} dias)`);
        }
        else {
            log(`Nenhum backup antigo para remover (retenção: ${RETENTION_DAYS} dias)`);
        }
    }
    catch (err) {
        error(`Falha na limpeza: ${err.message}`);
    }
}
// ── CLI execution ──
if (require.main === module) {
    log('═══════════════════════════════════════');
    log('  LicitaSaaS — Backup Automatizado');
    log('═══════════════════════════════════════');
    runBackup().then(result => {
        if (result.success) {
            log(`✅ BACKUP CONCLUÍDO: ${result.fileName} (${result.sizeKB}KB)`);
            process.exit(0);
        }
        else {
            error(`❌ BACKUP FALHOU: ${result.error}`);
            process.exit(1);
        }
    });
}
