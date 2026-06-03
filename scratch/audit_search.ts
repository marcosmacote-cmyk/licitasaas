import pkg from '@prisma/client';
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function runAudit() {
    console.log("=== OPPORTUNITIES MODULE AUDIT ===");

    // 1. Database Counts
    const totalContratacoes = await prisma.pncpContratacao.count();
    const totalItens = await prisma.pncpItem.count();
    console.log(`Total rows in PncpContratacao: ${totalContratacoes}`);
    console.log(`Total rows in PncpItem: ${totalItens}`);

    // 2. Check index existence
    try {
        const indexes = await prisma.$queryRawUnsafe(`
            SELECT indexname, indexdef 
            FROM pg_indexes 
            WHERE tablename = 'PncpContratacao';
        `) as any[];
        console.log("\nExisting Indexes on PncpContratacao:");
        for (const idx of indexes) {
            console.log(`- ${idx.indexname}: ${idx.indexdef}`);
        }
    } catch (e: any) {
        console.error("Error reading indexes:", e.message);
    }

    // 3. Test queries and timings
    const keywords = ['alimentos', 'construção', 'limpeza', 'gerenciamento'];
    
    for (const kw of keywords) {
        console.log(`\n--- Benchmarking keyword: "${kw}" ---`);

        // Case A: ILIKE (Without unaccent)
        const startIlike = Date.now();
        const ilikeResult = await prisma.$queryRawUnsafe(`
            SELECT id, "numeroControle", "objeto" 
            FROM "PncpContratacao"
            WHERE "objeto" ILIKE $1
            LIMIT 50;
        `, `%${kw}%`) as any[];
        const durationIlike = Date.now() - startIlike;
        console.log(`[ILIKE] Count: ${ilikeResult.length} matches (capped 50) | Duration: ${durationIlike}ms`);

        // Case B: ILIKE with unaccent on both sides
        const startUnaccentIlike = Date.now();
        const unaccentResult = await prisma.$queryRawUnsafe(`
            SELECT id, "numeroControle" 
            FROM "PncpContratacao"
            WHERE unaccent("objeto") ILIKE unaccent($1)
            LIMIT 50;
        `, `%${kw}%`) as any[];
        const durationUnaccent = Date.now() - startUnaccentIlike;
        console.log(`[ILIKE + unaccent] Count: ${unaccentResult.length} matches (capped 50) | Duration: ${durationUnaccent}ms`);

        // Case C: Full-Text Search using searchVector
        const startFts = Date.now();
        // Construct standard websearch_to_tsquery or plainto_tsquery
        const ftsResult = await prisma.$queryRawUnsafe(`
            SELECT id, "numeroControle", "objeto" 
            FROM "PncpContratacao"
            WHERE "searchVector" @@ websearch_to_tsquery('pt_unaccent', $1)
            LIMIT 50;
        `, kw) as any[];
        const durationFts = Date.now() - startFts;
        console.log(`[FTS searchVector] Count: ${ftsResult.length} matches (capped 50) | Duration: ${durationFts}ms`);

        // Check if searchVector gets different matches due to accent-insensitivity/stemming
        const ilikeIds = new Set(ilikeResult.map(r => r.numeroControle));
        const ftsIds = new Set(ftsResult.map(r => r.numeroControle));
        
        const onlyInFts = ftsResult.filter(r => !ilikeIds.has(r.numeroControle)).slice(0, 3);
        if (onlyInFts.length > 0) {
            console.log(`  -> FTS found records not matched by raw ILIKE (due to accents/stemming):`);
            for (const item of onlyInFts) {
                console.log(`     * [${item.numeroControle}] ${item.objeto?.substring(0, 100)}...`);
            }
        }
    }

    // 4. Test Multi-word Search (combinations)
    const multiWord = "alimentação escola"; // "alimentação" has accents
    console.log(`\n--- Benchmarking multi-word query: "${multiWord}" ---`);
    
    // ILIKE combination
    const startMultiIlike = Date.now();
    const multiIlikeResult = await prisma.$queryRawUnsafe(`
        SELECT id FROM "PncpContratacao"
        WHERE "objeto" ILIKE '%alimentação%' AND "objeto" ILIKE '%escola%'
        LIMIT 50;
    `) as any[];
    const durationMultiIlike = Date.now() - startMultiIlike;
    console.log(`[Multi ILIKE] Count: ${multiIlikeResult.length} | Duration: ${durationMultiIlike}ms`);

    // FTS combination
    const startMultiFts = Date.now();
    const multiFtsResult = await prisma.$queryRawUnsafe(`
        SELECT id FROM "PncpContratacao"
        WHERE "searchVector" @@ websearch_to_tsquery('pt_unaccent', $1)
        LIMIT 50;
    `, multiWord) as any[];
    const durationMultiFts = Date.now() - startMultiFts;
    console.log(`[Multi FTS] Count: ${multiFtsResult.length} | Duration: ${durationMultiFts}ms`);
}

runAudit()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
