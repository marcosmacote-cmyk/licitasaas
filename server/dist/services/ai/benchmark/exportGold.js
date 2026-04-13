"use strict";
// @ts-nocheck
/**
 * ══════════════════════════════════════════════════════════════════
 *  exportGold.ts — Exporta análises do banco para Gold Dataset
 * ══════════════════════════════════════════════════════════════════
 *
 *  Uso:
 *    DATABASE_URL="postgresql://..." npx tsx server/services/ai/benchmark/exportGold.ts
 *    DATABASE_URL="postgresql://..." npx tsx server/services/ai/benchmark/exportGold.ts --save
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("../../../lib/logger");
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl || dbUrl.includes('localhost')) {
    logger_1.logger.error(`\n❌ DATABASE_URL aponta para localhost ou não está definida.`);
    logger_1.logger.error(`   Uso: DATABASE_URL="postgresql://..." npx tsx exportGold.ts\n`);
    process.exit(1);
}
const prisma = new client_1.PrismaClient({ datasources: { db: { url: dbUrl } } });
const GOLD_DIR = path.join(__dirname, 'gold');
const MANIFEST_PATH = path.join(__dirname, 'benchmarkManifest.json');
async function main() {
    const args = process.argv.slice(2);
    const shouldSave = args.includes('--save');
    const limitIdx = args.indexOf('--limit');
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 25 : 25;
    logger_1.logger.info(`\n${'═'.repeat(60)}`);
    logger_1.logger.info(`📦  GOLD DATASET EXPORTER`);
    logger_1.logger.info(`${'═'.repeat(60)}\n`);
    logger_1.logger.info(`⏳ Conectando ao banco de produção...`);
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
        logger_1.logger.info('⚠️ Nenhuma análise com schemaV2 encontrada.');
        await prisma.$disconnect();
        return;
    }
    logger_1.logger.info(`✅ ${analyses.length} análises com schemaV2 encontradas:\n`);
    const typeDistribution = {};
    const candidates = [];
    for (let i = 0; i < analyses.length; i++) {
        const a = analyses[i];
        const schema = typeof a.schemaV2 === 'string' ? JSON.parse(a.schemaV2) : a.schemaV2;
        if (!schema?.process_identification) {
            continue;
        }
        const tipoObjeto = schema.process_identification?.tipo_objeto || 'unknown';
        const allReqs = Object.values(schema.requirements || {}).flat();
        const categories = Object.entries(schema.requirements || {})
            .filter(([_, v]) => Array.isArray(v) && v.length > 0)
            .map(([k]) => k);
        const risks = schema.legal_risk_review?.critical_points || [];
        const evidence = schema.evidence_registry || [];
        typeDistribution[tipoObjeto] = (typeDistribution[tipoObjeto] || 0) + 1;
        const bp = a.biddingProcess;
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
        logger_1.logger.info(`  ${String(i + 1).padStart(2)}. ${icon} [${tipoObjeto}] ${(bp?.title || '').slice(0, 65)}` +
            `\n      ${bp?.portal} | ${bp?.modality} | ${allReqs.length} exig. | ${risks.length} riscos | ${evidence.length} evid. | v${a.promptVersion || 'N/A'}\n`);
    }
    logger_1.logger.info(`${'─'.repeat(60)}`);
    logger_1.logger.info(`📊 Distribuição: ${Object.entries(typeDistribution).map(([k, v]) => `${k}(${v})`).join(', ')}`);
    logger_1.logger.info(`📊 Total: ${candidates.length}\n`);
    if (!shouldSave) {
        logger_1.logger.info(`Para salvar, rode com --save\n`);
        await prisma.$disconnect();
        return;
    }
    // ── SAVE ──
    if (!fs.existsSync(GOLD_DIR))
        fs.mkdirSync(GOLD_DIR, { recursive: true });
    let manifest = { cases: [], scoring: {
            tipoObjetoCorrect: 10, categoriesFoundPct: 25, keyRequirementsFoundPct: 30,
            criticalPointsFoundPct: 20, minRequirementsMet: 10, minEvidenceMet: 5
        } };
    if (fs.existsSync(MANIFEST_PATH))
        manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    const existingNums = (manifest.cases || [])
        .filter((c) => c.id.startsWith('real-'))
        .map((c) => parseInt(c.id.replace('real-', '')))
        .filter((n) => !isNaN(n));
    let nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
    let newCount = 0;
    for (const c of candidates) {
        if ((manifest.cases || []).some((mc) => mc.source?.processId === c.processId)) {
            logger_1.logger.info(`  ⏭ ${c.title.slice(0, 50)} — já exportado`);
            continue;
        }
        const caseId = `real-${String(nextNum).padStart(3, '0')}`;
        fs.writeFileSync(path.join(GOLD_DIR, `gold-${caseId}.json`), JSON.stringify(c.schemaV2, null, 2));
        logger_1.logger.info(`  ✅ gold-${caseId}.json — [${c.tipoObjeto}] ${c.title.slice(0, 50)}`);
        let pncpRef = null;
        if (c.pncpLink) {
            const m = c.pncpLink.match(/editais\/(\d+)\/(\d+)\/(\d+)/);
            if (m)
                pncpRef = { cnpj: m[1], ano: m[2], seq: m[3] };
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
    logger_1.logger.info(`\n📋 Manifest: ${manifest.cases.length} casos (+${newCount} novos)`);
    logger_1.logger.info(`\n✅ Agora rode: npx tsx server/services/ai/benchmark/runAll.ts --save\n`);
    await prisma.$disconnect();
}
main().catch(async (e) => { logger_1.logger.error(`\n❌ ${e.message}`); await prisma.$disconnect(); process.exit(1); });
