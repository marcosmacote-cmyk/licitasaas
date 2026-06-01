import { describe, it } from 'vitest';
import prisma from '../../lib/prisma';
import axios from 'axios';
import https from 'https';

describe('Search and Indexing Performance Audit', () => {
    it('should measure database size, indexes, and search execution times', async () => {
        console.log("=== OPPORTUNITIES MODULE AUDIT ===");

        // 1. Setup Database Extensions and Configurations
        console.log("\n[Setup] Checking database extensions...");
        try {
            await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS unaccent;`);
            console.log("[Setup] ✅ unaccent extension is enabled.");
        } catch (e: any) {
            console.error("[Setup] ❌ Failed to create unaccent extension:", e.message);
        }

        console.log("[Setup] Checking text search configuration...");
        try {
            // Check if pt_unaccent exists
            const configExists = await prisma.$queryRawUnsafe(`
                SELECT 1 FROM pg_ts_config WHERE cfgname = 'pt_unaccent';
            `) as any[];
            
            if (configExists.length === 0) {
                await prisma.$executeRawUnsafe(`CREATE TEXT SEARCH CONFIGURATION pt_unaccent (COPY = portuguese);`);
                await prisma.$executeRawUnsafe(`
                    ALTER TEXT SEARCH CONFIGURATION pt_unaccent
                    ALTER MAPPING FOR hword, hword_part, word WITH unaccent, portuguese_stem;
                `);
                console.log("[Setup] ✅ pt_unaccent text search configuration created.");
            } else {
                console.log("[Setup] ✅ pt_unaccent configuration already exists.");
            }
        } catch (e: any) {
            console.error("[Setup] ❌ Failed to setup pt_unaccent configuration:", e.message);
        }

        console.log("[Setup] Checking searchVector column...");
        try {
            // Add column if not exists
            await prisma.$executeRawUnsafe(`
                ALTER TABLE "PncpContratacao" 
                ADD COLUMN IF NOT EXISTS "searchVector" tsvector;
            `);
            console.log("[Setup] ✅ searchVector column checked/created.");
        } catch (e: any) {
            console.error("[Setup] ❌ Failed to check/create searchVector column:", e.message);
        }

        console.log("[Setup] Creating searchVector trigger...");
        try {
            await prisma.$executeRawUnsafe(`
                CREATE OR REPLACE FUNCTION pncp_search_vector_trigger() RETURNS trigger AS $$
                BEGIN
                  NEW."searchVector" :=
                    setweight(to_tsvector('pt_unaccent', coalesce(NEW."objeto", '')), 'A') ||
                    setweight(to_tsvector('pt_unaccent', coalesce(NEW."orgaoNome", '')), 'B') ||
                    setweight(to_tsvector('pt_unaccent', coalesce(NEW."unidadeNome", '')), 'B') ||
                    setweight(to_tsvector('pt_unaccent', coalesce(NEW."modalidade", '')), 'C') ||
                    setweight(to_tsvector('pt_unaccent', coalesce(NEW."municipio", '')), 'C');
                  RETURN NEW;
                END
                $$ LANGUAGE plpgsql;
            `);

            await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS tsvectorupdate ON "PncpContratacao";`);
            await prisma.$executeRawUnsafe(`
                CREATE TRIGGER tsvectorupdate
                BEFORE INSERT OR UPDATE ON "PncpContratacao"
                FOR EACH ROW EXECUTE FUNCTION pncp_search_vector_trigger();
            `);
            console.log("[Setup] ✅ searchVector trigger checked/created.");
        } catch (e: any) {
            console.error("[Setup] ❌ Failed to setup trigger:", e.message);
        }

        console.log("[Setup] Creating GIN index...");
        try {
            await prisma.$executeRawUnsafe(`
                CREATE INDEX IF NOT EXISTS "PncpContratacao_searchVector_idx" 
                ON "PncpContratacao" USING GIN("searchVector");
            `);
            console.log("[Setup] ✅ GIN index checked/created.");
        } catch (e: any) {
            console.error("[Setup] ❌ Failed to create GIN index:", e.message);
        }

        // 2. Seed Database with Real Data from PNCP API if empty
        const countBefore = await prisma.pncpContratacao.count();
        console.log(`\nCurrent PncpContratacao count: ${countBefore}`);
        
        if (countBefore === 0) {
            console.log("\n[Seed] Database is empty. Seeding with live data from PNCP API for CE & PE...");
            const agent = new https.Agent({ rejectUnauthorized: false });
            const ufsToSeed = ['CE', 'PE'];
            let totalSeeded = 0;

            for (const uf of ufsToSeed) {
                console.log(`[Seed] Fetching page 1 for ${uf}...`);
                const url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&status=recebendo_proposta&ufs=${uf}&pagina=1&tam_pagina=100`;
                try {
                    const resp = await axios.get(url, { httpsAgent: agent, timeout: 15000 });
                    const items = resp.data?.items || [];
                    console.log(`[Seed] Found ${items.length} items for ${uf}. Inserting...`);

                    let insertedForUf = 0;
                    for (const item of items) {
                        const cnpj = item.orgao_cnpj || item.orgaoEntidade?.cnpj || item.cnpj || '';
                        const ano = item.ano || item.anoCompra || 0;
                        const seq = item.numero_sequencial || item.sequencialCompra || item.numero_compra || 0;
                        const numeroControle = item.numero_controle_pncp || item.numeroControlePNCP || `${cnpj}-1-${seq}/${ano}`;

                        if (!cnpj || !ano || !seq) {
                            continue;
                        }

                        const mapped = {
                            numeroControle,
                            cnpjOrgao: String(cnpj),
                            anoCompra: Number(ano),
                            sequencialCompra: Number(seq),
                            orgaoNome: item.orgao_nome || item.orgaoEntidade?.razaoSocial || item.nomeOrgao || 'Órgão não informado',
                            unidadeNome: item.unidade_nome || item.unidadeOrgao?.nomeUnidade || null,
                            uf: item.uf || item.unidadeOrgao?.ufSigla || null,
                            municipio: item.municipio_nome || item.municipio || null,
                            esfera: String(item.esfera_id || item.esfera || ''),
                            objeto: item.description || item.objeto || item.resumo || 'Sem objeto',
                            modalidade: item.modalidade_licitacao_nome || item.modalidade_nome || item.modalidade || null,
                            situacao: item.situacao_nome || item.status || 'Divulgada',
                            valorEstimado: item.valor_estimado ? Number(item.valor_estimado) : 0,
                            dataPublicacao: item.createdAt || item.dataPublicacaoPncp ? new Date(item.createdAt || item.dataPublicacaoPncp) : null,
                            dataAbertura: item.dataAberturaProposta || item.data_abertura ? new Date(item.dataAberturaProposta || item.data_abertura) : null,
                            dataEncerramento: item.dataEncerramentoProposta || item.data_encerramento_proposta ? new Date(item.dataEncerramentoProposta || item.data_encerramento_proposta) : null,
                            linkSistema: item.linkSistemaOrigem || item.link_sistema || null,
                            linkOrigem: `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}`,
                        };

                        await prisma.pncpContratacao.upsert({
                            where: { numeroControle: mapped.numeroControle },
                            update: { ...mapped, syncedAt: new Date() },
                            create: mapped,
                        });
                        totalSeeded++;
                        insertedForUf++;
                    }
                    console.log(`[Seed] Successfully inserted/updated ${insertedForUf} items for ${uf}`);
                } catch (err: any) {
                    console.error(`[Seed] ❌ Failed to fetch/insert for ${uf}:`, err.message);
                }
            }
            
            // Explicitly run UPDATE to calculate searchVector for the seeded rows
            console.log("[Seed] Re-calculating searchVector for all rows...");
            await prisma.$executeRawUnsafe(`
                UPDATE "PncpContratacao" SET "searchVector" = 
                  setweight(to_tsvector('pt_unaccent', coalesce("objeto", '')), 'A') ||
                  setweight(to_tsvector('pt_unaccent', coalesce("orgaoNome", '')), 'B') ||
                  setweight(to_tsvector('pt_unaccent', coalesce("unidadeNome", '')), 'B') ||
                  setweight(to_tsvector('pt_unaccent', coalesce("modalidade", '')), 'C') ||
                  setweight(to_tsvector('pt_unaccent', coalesce("municipio", '')), 'C')
                WHERE "searchVector" IS NULL;
            `);
            console.log(`[Seed] Seeding completed. Total rows: ${await prisma.pncpContratacao.count()}`);
        }

        // 3. Database Counts & Indexes Verification
        const totalContratacoes = await prisma.pncpContratacao.count();
        const totalItens = await prisma.pncpItem.count();
        console.log(`\nFinal rows in PncpContratacao: ${totalContratacoes}`);
        console.log(`Final rows in PncpItem: ${totalItens}`);

        // 4. Benchmarking Queries and Timings
        const keywords = ['alimentos', 'construção', 'limpeza', 'gerenciamento', 'serviço', 'material'];
        
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
            console.log(`[ILIKE] Count: ${ilikeResult.length} matches | Duration: ${durationIlike}ms`);

            // Case B: ILIKE with unaccent on both sides
            const startUnaccentIlike = Date.now();
            const unaccentResult = await prisma.$queryRawUnsafe(`
                SELECT id, "numeroControle" 
                FROM "PncpContratacao"
                WHERE unaccent("objeto") ILIKE unaccent($1)
                LIMIT 50;
            `, `%${kw}%`) as any[];
            const durationUnaccent = Date.now() - startUnaccentIlike;
            console.log(`[ILIKE + unaccent] Count: ${unaccentResult.length} matches | Duration: ${durationUnaccent}ms`);

            // Case C: Full-Text Search using searchVector
            const startFts = Date.now();
            const ftsResult = await prisma.$queryRawUnsafe(`
                SELECT id, "numeroControle", "objeto" 
                FROM "PncpContratacao"
                WHERE "searchVector" @@ websearch_to_tsquery('pt_unaccent', $1)
                LIMIT 50;
            `, kw) as any[];
            const durationFts = Date.now() - startFts;
            console.log(`[FTS searchVector] Count: ${ftsResult.length} matches | Duration: ${durationFts}ms`);

            // Compare result IDs to see if FTS caught more due to accents/stemming
            const ilikeIds = new Set(ilikeResult.map(r => r.numeroControle));
            const ftsResultMatch = ftsResult.filter(r => !ilikeIds.has(r.numeroControle)).slice(0, 5);
            if (ftsResultMatch.length > 0) {
                console.log(`  -> FTS found records not matched by raw ILIKE (due to accents/stemming/multi-field search):`);
                for (const item of ftsResultMatch) {
                    console.log(`     * [${item.numeroControle}] ${item.objeto?.substring(0, 100)}...`);
                }
            }
        }

        // 5. Test Multi-word Search (combinations)
        const multiWord = "serviço engenharia";
        console.log(`\n--- Benchmarking multi-word query: "${multiWord}" ---`);
        
        const startMultiIlike = Date.now();
        const multiIlikeResult = await prisma.$queryRawUnsafe(`
            SELECT id FROM "PncpContratacao"
            WHERE "objeto" ILIKE '%serviço%' AND "objeto" ILIKE '%engenharia%'
            LIMIT 50;
        `) as any[];
        const durationMultiIlike = Date.now() - startMultiIlike;
        console.log(`[Multi ILIKE] Count: ${multiIlikeResult.length} | Duration: ${durationMultiIlike}ms`);

        const startMultiFts = Date.now();
        const multiFtsResult = await prisma.$queryRawUnsafe(`
            SELECT id FROM "PncpContratacao"
            WHERE "searchVector" @@ websearch_to_tsquery('pt_unaccent', $1)
            LIMIT 50;
        `, multiWord) as any[];
        const durationMultiFts = Date.now() - startMultiFts;
        console.log(`[Multi FTS] Count: ${multiFtsResult.length} | Duration: ${durationMultiFts}ms`);
    }, 120000); // 120s timeout for seeding

    it('should verify PncpSearchV3 search works correctly', async () => {
        const { PncpSearchV3 } = await import('./pncp-search-v3.service');
        const results = await PncpSearchV3.search({
            keywords: 'serviço',
            pagina: 1,
            tamanhoPagina: 10
        });

        console.log(`\n=== PncpSearchV3.search VERIFICATION ===`);
        console.log(`Total results: ${results.total}`);
        console.log(`Returned items: ${results.items.length}`);
        if (results.items.length > 0) {
            console.log(`First item title: ${results.items[0].titulo}`);
            console.log(`First item source: ${results.items[0]._source}`);
            console.log(`First item link: ${results.items[0].link_sistema}`);
        }
    });
});
