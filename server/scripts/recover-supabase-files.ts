#!/usr/bin/env ts-node
/**
 * ═══════════════════════════════════════════════════════════
 * LicitaSaaS — Recovery Script for Supabase Migration
 * ═══════════════════════════════════════════════════════════
 *
 * Recovers files that had their URLs rewritten to /uploads/* but 
 * were lost from ephemeral storage before being moved to the persistent volume.
 * 
 * Reconstructs the Supabase URL using the tenantId and fileName.
 */

import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const SERVER_ROOT = __dirname.endsWith('dist/scripts')
    ? path.resolve(__dirname, '../..')
    : path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_ROOT, '.env'), override: false });

const prisma = new PrismaClient();
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BUCKET_NAME = process.env.SUPABASE_BUCKET || 'documents';

const uploadDir = process.env.NODE_ENV === 'production' ? '/app/uploads' : path.join(SERVER_ROOT, 'uploads');

function log(msg: string) {
    console.log(`[Recovery ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function downloadFromSupabase(supabase: any, remotePath: string, localPath: string): Promise<boolean> {
    try {
        const { data, error } = await supabase.storage.from(BUCKET_NAME).download(remotePath);
        if (error) return false;
        if (!data) return false;

        const arrayBuffer = await data.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (buffer.length === 0) return false;

        fs.writeFileSync(localPath, buffer);
        return true;
    } catch (err) {
        return false;
    }
}

async function recoverTable(
    supabase: any,
    tableName: string,
    records: { id: string; fileUrl: string; tenantId: string }[]
) {
    log(`\n📋 ${tableName}: ${records.length} records to check`);
    let recovered = 0;
    let skipped = 0;
    let failed = 0;

    // Cache root folders to try as fallback
    const { data: rootItems } = await supabase.storage.from(BUCKET_NAME).list('', { limit: 100 });
    const rootFolders = rootItems?.filter((i: any) => !i.id && !i.name.includes('.'))?.map((i: any) => i.name) || [];

    for (const record of records) {
        const fileName = path.basename(record.fileUrl);
        const localPath = path.join(uploadDir, fileName);

        if (fs.existsSync(localPath)) {
            skipped++;
            continue;
        }

        let success = false;

        // Strategy 1: If fileName has tenantId_ prefix, it might actually be tenantId/ in Supabase
        if (record.tenantId && fileName.startsWith(record.tenantId + '_')) {
            const reconstructed = fileName.replace(record.tenantId + '_', record.tenantId + '/');
            success = await downloadFromSupabase(supabase, reconstructed, localPath);
        }

        // Strategy 2: Standard tenantId/fileName
        if (!success && record.tenantId) {
            success = await downloadFromSupabase(supabase, `${record.tenantId}/${fileName}`, localPath);
        }
        
        // Strategy 3: Flat fileName
        if (!success) {
            success = await downloadFromSupabase(supabase, fileName, localPath);
        }

        // Strategy 4: Try all known root folders
        if (!success) {
            for (const folder of rootFolders) {
                success = await downloadFromSupabase(supabase, `${folder}/${fileName}`, localPath);
                if (success) break;
                
                // Strategy 5: What if the DB stripped the tenant_ prefix but it exists in bucket?
                const fileWithTenant = `${folder}_${fileName}`;
                success = await downloadFromSupabase(supabase, `${folder}/${fileWithTenant}`, localPath);
                if (success) break;
            }
        }

        if (success) {
            recovered++;
            log(`  ✅ Recovered: ${fileName}`);
        } else {
            failed++;
            log(`  ❌ Failed: ${fileName}`);
        }
        await new Promise(r => setTimeout(r, 50)); // Rate limit
    }
    
    log(`Result for ${tableName}: ${recovered} recovered, ${skipped} skipped, ${failed} failed.`);
}

async function main() {
    log('═══════════════════════════════════════');
    log('  LicitaSaaS — Supabase Recovery');
    log('═══════════════════════════════════════');
    
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        log('❌ SUPABASE_URL and SUPABASE_KEY required');
        process.exit(1);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    // 1. Documents
    const docs = await prisma.document.findMany({
        where: { fileUrl: { startsWith: '/uploads/' } },
        select: { id: true, fileUrl: true, tenantId: true }
    });
    await recoverTable(supabase, 'Document', docs);

    // 2. Technical Certificates
    const certs = await prisma.technicalCertificate.findMany({
        where: { fileUrl: { startsWith: '/uploads/' } },
        select: { id: true, fileUrl: true, tenantId: true }
    });
    await recoverTable(supabase, 'TechnicalCertificate', certs);

    log('\n✅ Recovery completed!');
    await prisma.$disconnect();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
