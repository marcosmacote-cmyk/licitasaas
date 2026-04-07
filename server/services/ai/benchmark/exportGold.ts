/**
 * ══════════════════════════════════════════════════════════════════
 *  exportGold.ts — Exporta análises do banco para Gold Dataset
 * ══════════════════════════════════════════════════════════════════
 *
 *  Conecta no banco Prisma, busca análises com schemaV2 e exporta
 *  os JSONs para o diretório gold/ com IDs sequenciais.
 *
 *  Uso:
 *    npx tsx server/services/ai/benchmark/exportGold.ts
 *    npx tsx server/services/ai/benchmark/exportGold.ts --limit 20
 *    npx tsx server/services/ai/benchmark/exportGold.ts --process-id <id>
 *
 *  O que faz:
 *    1. Busca análises recentes que têm schemaV2 preenchido
 *    2. Exibe resumo de cada uma (título, score, tipo_objeto)
 *    3. Salva as selecionadas em gold/gold-real-{NNN}.json
 *    4. Gera entries pro benchmarkManifest.json
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const GOLD_DIR = path.join(__dirname, 'gold');
const MANIFEST_PATH = path.join(__dirname, 'benchmarkManifest.json');

interface GoldCandidate {
    analysisId: string;
    processId: string;
    title: string;
    portal: string;
    tipoObjeto: string;
    overallConfidence: string | null;
    qualityScore: number | null;
    promptVersion: string | null;
    requirementCount: number;
    riskCount: number;
    evidenceCount: number;
    categoryCount: number;
    categories: string[];
    analyzedAt: string | null;
    pncpLink: string | null;
    schemaV2: any;
}

async function main() {
    const args = process.argv.slice(2);
    const limitIdx = args.indexOf('--limit');
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 20 : 20;
    const processIdIdx = args.indexOf('--process-id');
    const specificProcessId = processIdIdx >= 0 ? args[processIdIdx + 1] : null;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📦  GOLD DATASET EXPORTER`);
    console.log(`${'═'.repeat(60)}\n`);

    // Query analyses with schemaV2
    const where: any = {
        schemaV2: { not: null },
    };
    if (specificProcessId) {
        where.biddingProcessId = specificProcessId;
    }

    const analyses = await prisma.aiAnalysis.findMany({
        where,
        include: {
            biddingProcess: {
                select: {
                    title: true,
                    portal: true,
                    pncpLink: true,
                    modality: true,
                }
            }
        },
        orderBy: { analyzedAt: 'desc' },
        take: limit,
    });

    if (analyses.length === 0) {
        console.log('⚠️ Nenhuma análise com schemaV2 encontrada no banco.');
        await prisma.$disconnect();
        return;
    }

    console.log(`📋 ${analyses.length} análises encontradas:\n`);

    const candidates: GoldCandidate[] = [];

    for (let i = 0; i < analyses.length; i++) {
        const a = analyses[i];
        const schema = typeof a.schemaV2 === 'string' ? JSON.parse(a.schemaV2) : a.schemaV2;
        
        if (!schema || !schema.process_identification) {
            console.log(`  ${i + 1}. ⏭ ${a.id.slice(0, 8)} — schemaV2 inválido`);
            continue;
        }

        const tipoObjeto = schema.process_identification?.tipo_objeto || 'unknown';
        const allReqs = Object.values(schema.requirements || {}).flat() as any[];
        const categories = Object.entries(schema.requirements || {})
            .filter(([_, v]) => Array.isArray(v) && (v as any[]).length > 0)
            .map(([k]) => k);
        const risks = schema.legal_risk_review?.critical_points || [];
        const evidence = schema.evidence_registry || [];

        const candidate: GoldCandidate = {
            analysisId: a.id,
            processId: a.biddingProcessId,
            title: (a.biddingProcess as any)?.title || 'Sem título',
            portal: (a.biddingProcess as any)?.portal || 'N/A',
            tipoObjeto,
            overallConfidence: a.overallConfidence,
            qualityScore: null, // será calculado depois se necessário
            promptVersion: a.promptVersion,
            requirementCount: allReqs.length,
            riskCount: risks.length,
            evidenceCount: evidence.length,
            categoryCount: categories.length,
            categories,
            analyzedAt: a.analyzedAt ? new Date(a.analyzedAt).toISOString() : null,
            pncpLink: (a.biddingProcess as any)?.pncpLink || null,
            schemaV2: schema,
        };

        candidates.push(candidate);

        const confidenceIcon = a.overallConfidence === 'alta' ? '🟢' :
            a.overallConfidence === 'media' ? '🟡' : '🔴';

        console.log(
            `  ${String(i + 1).padStart(2)}. ${confidenceIcon} [${tipoObjeto}] ${candidate.title.slice(0, 60)}` +
            `\n      ${allReqs.length} exig. | ${risks.length} riscos | ${evidence.length} evid. | ${categories.length} cats | ${a.promptVersion || 'N/A'}`
        );
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`\nPara salvar todos como gold files, rode com --save:`);
    console.log(`  npx tsx server/services/ai/benchmark/exportGold.ts --save\n`);
    console.log(`Para salvar um específico:`);
    console.log(`  npx tsx server/services/ai/benchmark/exportGold.ts --process-id <id> --save\n`);

    // If --save flag, export gold files
    if (args.includes('--save')) {
        console.log(`\n💾 Salvando ${candidates.length} gold files...\n`);

        if (!fs.existsSync(GOLD_DIR)) fs.mkdirSync(GOLD_DIR, { recursive: true });

        // Load existing manifest to find next available case number
        let manifest: any = { cases: [], scoring: {} };
        if (fs.existsSync(MANIFEST_PATH)) {
            manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
        }

        const existingRealCases = (manifest.cases || [])
            .filter((c: any) => c.id.startsWith('real-'))
            .map((c: any) => parseInt(c.id.replace('real-', '')))
            .filter((n: number) => !isNaN(n));
        
        let nextNum = existingRealCases.length > 0 ? Math.max(...existingRealCases) + 1 : 1;
        const newCases: any[] = [];

        for (const candidate of candidates) {
            const caseId = `real-${String(nextNum).padStart(3, '0')}`;
            const goldFilename = `gold-${caseId}.json`;
            const goldPath = path.join(GOLD_DIR, goldFilename);

            // Check if already exported (by processId match)
            const alreadyExported = (manifest.cases || []).some(
                (c: any) => c.pncp_ref?.processId === candidate.processId
            );
            if (alreadyExported) {
                console.log(`  ⏭ ${candidate.title.slice(0, 50)} — já exportado`);
                continue;
            }

            // Save gold JSON
            fs.writeFileSync(goldPath, JSON.stringify(candidate.schemaV2, null, 2));
            console.log(`  ✅ ${goldFilename} — ${candidate.title.slice(0, 50)}`);

            // Parse PNCP reference
            let pncpRef: any = null;
            if (candidate.pncpLink) {
                const match = candidate.pncpLink.match(/editais\/(\d+)\/(\d+)\/(\d+)/);
                if (match) {
                    pncpRef = { cnpj: match[1], ano: match[2], seq: match[3], processId: candidate.processId };
                }
            }

            // Build manifest case entry
            const newCase = {
                id: caseId,
                name: candidate.title.slice(0, 80),
                tipo_objeto: candidate.tipoObjeto,
                complexity: candidate.requirementCount > 20 ? 'alta' : candidate.requirementCount > 12 ? 'media' : 'baixa',
                description: `${candidate.portal} — ${candidate.tipoObjeto} — ${candidate.requirementCount} exigências`,
                pncp_ref: pncpRef,
                source: {
                    analysisId: candidate.analysisId,
                    processId: candidate.processId,
                    promptVersion: candidate.promptVersion,
                    exportedAt: new Date().toISOString(),
                },
                expected: {
                    tipo_objeto_expected: candidate.tipoObjeto,
                    categories_to_find: candidate.categories,
                    key_requirements: [], // TODO: preencher manualmente com exigências-chave
                    critical_points: [],  // TODO: preencher manualmente com pontos críticos
                    min_requirements: Math.max(Math.floor(candidate.requirementCount * 0.7), 5),
                    min_evidence_refs: Math.max(Math.floor(candidate.evidenceCount * 0.5), 3),
                },
            };

            newCases.push(newCase);
            nextNum++;
        }

        if (newCases.length > 0) {
            // Merge new cases into manifest
            manifest.cases = [...(manifest.cases || []), ...newCases];
            manifest.total_cases = manifest.cases.length;
            manifest.updated_at = new Date().toISOString().split('T')[0];

            fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
            console.log(`\n📋 Manifest atualizado: ${manifest.cases.length} casos totais (+${newCases.length} novos)`);
        } else {
            console.log(`\nℹ️ Nenhum caso novo para adicionar.`);
        }
    }

    await prisma.$disconnect();
}

main().catch(async (err) => {
    console.error(`\n❌ Erro: ${err.message}`);
    await prisma.$disconnect();
    process.exit(1);
});
