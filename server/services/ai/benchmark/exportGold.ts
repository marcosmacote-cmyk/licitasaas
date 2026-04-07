/**
 * ══════════════════════════════════════════════════════════════════
 *  exportGold.ts — Exporta análises do banco para Gold Dataset
 * ══════════════════════════════════════════════════════════════════
 *
 *  Uso:
 *    DATABASE_URL="postgresql://..." npx tsx server/services/ai/benchmark/exportGold.ts
 *    DATABASE_URL="postgresql://..." npx tsx server/services/ai/benchmark/exportGold.ts --save
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl || dbUrl.includes('localhost')) {
    console.error(`\n❌ DATABASE_URL aponta para localhost ou não está definida.`);
    console.error(`   Uso: DATABASE_URL="postgresql://..." npx tsx exportGold.ts\n`);
    process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const GOLD_DIR = path.join(__dirname, 'gold');
const MANIFEST_PATH = path.join(__dirname, 'benchmarkManifest.json');

async function main() {
    const args = process.argv.slice(2);
    const shouldSave = args.includes('--save');
    const limitIdx = args.indexOf('--limit');
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 25 : 25;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📦  GOLD DATASET EXPORTER`);
    console.log(`${'═'.repeat(60)}\n`);
    console.log(`⏳ Conectando ao banco de produção...`);

    const analyses = await prisma.aiAnalysis.findMany({
        where: { schemaV2: { not: null } },
        include: {
            biddingProcess: {
                select: { title: true, portal: true, pncpLink: true, modality: true }
            }
        },
        orderBy: { analyzedAt: 'desc' },
        take: limit,
    });

    if (analyses.length === 0) {
        console.log('⚠️ Nenhuma análise com schemaV2 encontrada.');
        await prisma.$disconnect();
        return;
    }

    console.log(`✅ ${analyses.length} análises com schemaV2 encontradas:\n`);

    const typeDistribution: Record<string, number> = {};
    const candidates: any[] = [];

    for (let i = 0; i < analyses.length; i++) {
        const a = analyses[i];
        const schema = typeof a.schemaV2 === 'string' ? JSON.parse(a.schemaV2 as string) : a.schemaV2 as any;
        if (!schema?.process_identification) { continue; }

        const tipoObjeto = schema.process_identification?.tipo_objeto || 'unknown';
        const allReqs = Object.values(schema.requirements || {}).flat() as any[];
        const categories = Object.entries(schema.requirements || {})
            .filter(([_, v]) => Array.isArray(v) && (v as any[]).length > 0)
            .map(([k]) => k);
        const risks = schema.legal_risk_review?.critical_points || [];
        const evidence = schema.evidence_registry || [];

        typeDistribution[tipoObjeto] = (typeDistribution[tipoObjeto] || 0) + 1;

        const bp = a.biddingProcess as any;
        candidates.push({
            analysisId: a.id, processId: a.biddingProcessId,
            title: bp?.title || 'Sem título', portal: bp?.portal || 'N/A',
            modality: bp?.modality || 'N/A', tipoObjeto,
            overallConfidence: a.overallConfidence, promptVersion: a.promptVersion,
            requirementCount: allReqs.length, riskCount: risks.length,
            evidenceCount: evidence.length, categoryCount: categories.length,
            categories, pncpLink: bp?.pncpLink || null, schemaV2: schema,
            analyzedAt: a.analyzedAt,
        });

        const icon = a.overallConfidence === 'alta' ? '🟢' : a.overallConfidence === 'media' ? '🟡' : '🔴';
        console.log(
            `  ${String(i + 1).padStart(2)}. ${icon} [${tipoObjeto}] ${(bp?.title || '').slice(0, 65)}` +
            `\n      ${bp?.portal} | ${bp?.modality} | ${allReqs.length} exig. | ${risks.length} riscos | ${evidence.length} evid. | v${a.promptVersion || 'N/A'}\n`
        );
    }

    console.log(`${'─'.repeat(60)}`);
    console.log(`📊 Distribuição: ${Object.entries(typeDistribution).map(([k, v]) => `${k}(${v})`).join(', ')}`);
    console.log(`📊 Total: ${candidates.length}\n`);

    if (!shouldSave) {
        console.log(`Para salvar, rode com --save\n`);
        await prisma.$disconnect();
        return;
    }

    // ── SAVE ──
    if (!fs.existsSync(GOLD_DIR)) fs.mkdirSync(GOLD_DIR, { recursive: true });

    let manifest: any = { cases: [], scoring: {
        tipoObjetoCorrect: 10, categoriesFoundPct: 25, keyRequirementsFoundPct: 30,
        criticalPointsFoundPct: 20, minRequirementsMet: 10, minEvidenceMet: 5
    }};
    if (fs.existsSync(MANIFEST_PATH)) manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));

    const existingNums = (manifest.cases || [])
        .filter((c: any) => c.id.startsWith('real-'))
        .map((c: any) => parseInt(c.id.replace('real-', '')))
        .filter((n: number) => !isNaN(n));
    let nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
    let newCount = 0;

    for (const c of candidates) {
        if ((manifest.cases || []).some((mc: any) => mc.source?.processId === c.processId)) {
            console.log(`  ⏭ ${c.title.slice(0, 50)} — já exportado`);
            continue;
        }

        const caseId = `real-${String(nextNum).padStart(3, '0')}`;
        fs.writeFileSync(path.join(GOLD_DIR, `gold-${caseId}.json`), JSON.stringify(c.schemaV2, null, 2));
        console.log(`  ✅ gold-${caseId}.json — [${c.tipoObjeto}] ${c.title.slice(0, 50)}`);

        let pncpRef: any = null;
        if (c.pncpLink) {
            const m = c.pncpLink.match(/editais\/(\d+)\/(\d+)\/(\d+)/);
            if (m) pncpRef = { cnpj: m[1], ano: m[2], seq: m[3] };
        }

        manifest.cases.push({
            id: caseId, name: c.title.slice(0, 80), tipo_objeto: c.tipoObjeto,
            complexity: c.requirementCount > 20 ? 'alta' : c.requirementCount > 12 ? 'media' : 'baixa',
            description: `${c.portal} | ${c.modality} — ${c.requirementCount} exig., ${c.riskCount} riscos`,
            pncp_ref: pncpRef,
            source: { processId: c.processId, promptVersion: c.promptVersion, exportedAt: new Date().toISOString() },
            expected: {
                tipo_objeto_expected: c.tipoObjeto,
                categories_to_find: c.categories,
                key_requirements: [], critical_points: [],
                min_requirements: Math.max(Math.floor(c.requirementCount * 0.7), 5),
                min_evidence_refs: Math.max(Math.floor(c.evidenceCount * 0.5), 3),
            },
        });
        nextNum++;
        newCount++;
    }

    manifest.total_cases = manifest.cases.length;
    manifest.updated_at = new Date().toISOString().split('T')[0];
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`\n📋 Manifest: ${manifest.cases.length} casos (+${newCount} novos)`);
    console.log(`\n✅ Agora rode: npx tsx server/services/ai/benchmark/runAll.ts --save\n`);
    await prisma.$disconnect();
}

main().catch(async (e) => { console.error(`\n❌ ${e.message}`); await prisma.$disconnect(); process.exit(1); });
