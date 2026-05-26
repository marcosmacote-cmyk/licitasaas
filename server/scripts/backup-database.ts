#!/usr/bin/env ts-node
/**
 * 🗄️ LicitaSaaS — Backup Automatizado do PostgreSQL
 * 
 * Este script faz pg_dump do banco, comprime com gzip,
 * e salva em diretório persistente (Railway Volume).
 * 
 * Uso manual:
 *   npx ts-node server/scripts/backup-database.ts
 * 
 * Em produção (Railway cron job ou container separado):
 *   node dist/scripts/backup-database.js
 * 
 * Variáveis necessárias:
 *   DATABASE_URL            — Connection string do Postgres
 *   BACKUP_DIR              — Diretório persistente para backups (default: /app/backups)
 *   BACKUP_RETENTION_DAYS   — Dias para manter backups (default: 7)
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { logger } from '../lib/logger';

// Load env
const SERVER_ROOT = __dirname.endsWith('dist/scripts')
    ? path.resolve(__dirname, '../..')
    : path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_ROOT, '.env'), override: false });

const DATABASE_URL = process.env.DATABASE_URL;
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '7');

/**
 * Determines the backup directory. Priority:
 *   1. BACKUP_DIR env var (explicit configuration)
 *   2. /app/backups (Railway Volume mount — persistent across deploys)
 *   3. {SERVER_ROOT}/backups (local development fallback)
 */
function getBackupDir(): string {
    if (process.env.BACKUP_DIR) {
        return process.env.BACKUP_DIR;
    }
    // Railway: use /app/backups (should be a mounted Volume)
    if (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production') {
        return '/app/backups';
    }
    // Local dev fallback
    return path.join(SERVER_ROOT, 'backups');
}

// ── Helpers ──

function timestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function log(msg: string) {
    logger.info(`[Backup] ${msg}`);
}

function error(msg: string) {
    logger.error(`[Backup] ${msg}`);
}

// ── Main ──

async function runBackup(): Promise<{ success: boolean; fileName?: string; sizeKB?: number; path?: string; error?: string }> {
    // Validate env
    if (!DATABASE_URL) {
        error('DATABASE_URL não configurada');
        return { success: false, error: 'DATABASE_URL not set' };
    }

    const backupDir = getBackupDir();
    const fileName = `licitasaas-backup-${timestamp()}.sql.gz`;
    const filePath = path.join(backupDir, fileName);

    try {
        // 1. Ensure backup directory exists
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
            log(`Diretório de backup criado: ${backupDir}`);
        }

        // 2. pg_dump → gzip
        log(`Iniciando pg_dump para ${backupDir}...`);
        const startTime = Date.now();

        // --no-owner --no-acl: makes restore easier across environments
        // --format=plain: SQL text format (compressible)
        execSync(
            `pg_dump "${DATABASE_URL}" --no-owner --no-acl --clean --if-exists | gzip > "${filePath}"`,
            {
                timeout: 300_000, // 5 min max
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, PGCONNECT_TIMEOUT: '30' }
            }
        );

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const stats = fs.statSync(filePath);
        const sizeKB = Math.round(stats.size / 1024);

        log(`✅ pg_dump concluído em ${duration}s — ${sizeKB}KB comprimido → ${filePath}`);

        // 3. Cleanup old backups (retention policy)
        await cleanupOldBackups(backupDir);

        return { success: true, fileName, sizeKB, path: filePath };

    } catch (err: any) {
        error(`Falha no backup: ${err.message}`);

        // Cleanup on error
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (_) { }

        return { success: false, error: err.message };
    }
}

/**
 * Removes backup files older than RETENTION_DAYS.
 * Only deletes files matching the naming pattern: licitasaas-backup-*.sql.gz
 */
async function cleanupOldBackups(backupDir: string): Promise<void> {
    try {
        const files = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('licitasaas-backup-') && f.endsWith('.sql.gz'));

        if (files.length === 0) return;

        const cutoffMs = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
        let removed = 0;

        for (const file of files) {
            const filePath = path.join(backupDir, file);
            const stat = fs.statSync(filePath);
            if (stat.mtimeMs < cutoffMs) {
                fs.unlinkSync(filePath);
                removed++;
            }
        }

        if (removed > 0) {
            log(`🗑️ Removidos ${removed} backups antigos (>${RETENTION_DAYS} dias)`);
        } else {
            log(`Nenhum backup antigo para remover (retenção: ${RETENTION_DAYS} dias, ${files.length} arquivos)`);
        }
    } catch (err: any) {
        error(`Falha na limpeza: ${err.message}`);
    }
}

// ── Export for use as module ──
export { runBackup };

// ── CLI execution ──
if (require.main === module) {
    log('═══════════════════════════════════════');
    log('  LicitaSaaS — Backup Automatizado');
    log(`  Destino: ${getBackupDir()}`);
    log('═══════════════════════════════════════');

    runBackup().then(result => {
        if (result.success) {
            log(`✅ BACKUP CONCLUÍDO: ${result.fileName} (${result.sizeKB}KB) → ${result.path}`);
            process.exit(0);
        } else {
            error(`❌ BACKUP FALHOU: ${result.error}`);
            process.exit(1);
        }
    });
}
