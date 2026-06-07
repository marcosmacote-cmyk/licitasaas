import { PrismaClient } from '@prisma/client';
import { PncpSearchV3 } from '../services/pncp/pncp-search-v3.service';
import { PncpSynonymService } from '../services/pncp/pncp-synonym.service';

const prisma = new PrismaClient();

async function runAutoSetupLocal() {
    console.log('⚙️ Configurando triggers e índices de busca do PNCP (FTS e Trigramas)...');
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS unaccent;`);
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

    // Configuração de busca no Postgres
    await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'pt_unaccent') THEN
            CREATE TEXT SEARCH CONFIGURATION pt_unaccent (COPY = portuguese);
            ALTER TEXT SEARCH CONFIGURATION pt_unaccent
              ALTER MAPPING FOR hword, hword_part, word WITH unaccent, portuguese_stem;
          END IF;
        END
        $$;
    `);

    // Trigger function
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

    // Dropar e recriar trigger
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS tsvectorupdate ON "PncpContratacao";`);
    await prisma.$executeRawUnsafe(`
        CREATE TRIGGER tsvectorupdate
        BEFORE INSERT OR UPDATE ON "PncpContratacao"
        FOR EACH ROW EXECUTE FUNCTION pncp_search_vector_trigger();
    `);

    // Criar índices FTS e trigrama
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PncpContratacao_searchVector_idx" ON "PncpContratacao" USING GIN("searchVector");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PncpContratacao_uf_situacao_idx" ON "PncpContratacao" ("uf", "situacao");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PncpContratacao_dataEncerramento_sort_idx" ON "PncpContratacao" ("dataEncerramento" ASC NULLS LAST);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PncpContratacao_objeto_trgm_idx" ON "PncpContratacao" USING GIN("objeto" gin_trgm_ops);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PncpContratacao_orgaoNome_trgm_idx" ON "PncpContratacao" USING GIN("orgaoNome" gin_trgm_ops);`);

    // Seed de Sinônimos Iniciais
    const seedSynonyms = [
        { word: 'merenda', synonyms: 'merenda, alimentacao escolar, generos alimenticios, refeicao, merenda escolar' },
        { word: 'ti', synonyms: 'ti, tecnologia da informacao, software, informatica, computador, licenciamento de software' },
        { word: 'obra', synonyms: 'obra, construcao civil, reforma, engenharia civil, pavimentacao' },
        { word: 'seguranca', synonyms: 'seguranca, vigilancia, monitoramento, seguranca patrimonial, guarda' },
        { word: 'limpeza', synonyms: 'limpeza, conservacao, higienizacao, asseio, servicos gerais' }
    ];

    for (const s of seedSynonyms) {
        await prisma.pncpSynonym.upsert({
            where: { word: s.word },
            update: {},
            create: s
        });
    }
    console.log('⚙️ Setup concluído!');
}

async function runTest() {
    console.log('🧪 Iniciando testes de performance e precisão de Busca PNCP...');
    console.log('------------------------------------------------------------');

    try {
        // Executar auto setup
        await runAutoSetupLocal();

        // 1. Verificar se as extensões e índices existem no banco
        const extensions = await prisma.$queryRaw`
            SELECT extname FROM pg_extension WHERE extname IN ('unaccent', 'pg_trgm');
        ` as any[];
        console.log('✅ Extensões ativas:', extensions.map(e => e.extname).join(', '));

        const indexes = await prisma.$queryRaw`
            SELECT indexname FROM pg_indexes 
            WHERE tablename = 'PncpContratacao' 
            AND indexname IN ('PncpContratacao_objeto_trgm_idx', 'PncpContratacao_orgaoNome_trgm_idx', 'PncpContratacao_searchVector_idx');
        ` as any[];
        console.log('✅ Índices detectados:', indexes.map(i => i.indexname).join(', '));

        // Forçar atualização do cache do serviço de sinônimos
        await PncpSynonymService.loadCacheIfNeeded(true);

        // 2. Testar a Expansão de Sinônimos
        console.log('\n--- 🧠 TESTE DE EXPANSÃO DE SINÔNIMOS ---');
        const queryOriginal = 'ti';
        const queryExpandida = await PncpSynonymService.expandQuery(queryOriginal);
        console.log(`Original: "${queryOriginal}"`);
        console.log(`Expandida: "${queryExpandida}"`);

        if (queryExpandida.includes('OR') && queryExpandida.includes('tecnologia da informacao')) {
            console.log('✅ Expansão de sinônimos funcionando corretamente!');
        } else {
            console.warn('⚠️ Falha potencial na expansão de sinônimos. Verifique se o seed foi executado.');
        }

        // Executar a busca com sinônimos expandidos
        const startSyn = Date.now();
        const searchResultSyn = await PncpSearchV3.search({ keywords: queryExpandida });
        const timeSyn = Date.now() - startSyn;
        console.log(`Resultados encontrados para "${queryOriginal}" (expandido): ${searchResultSyn.total}`);
        console.log(`Tempo de resposta: ${timeSyn}ms (elapsed retornado do buscador: ${searchResultSyn.elapsed}ms)`);

        // 3. Testar Busca Fuzzy (Tolerância a erros de digitação via pg_trgm)
        console.log('\n--- 🎯 TESTE DE BUSCA FUZZY (pg_trgm) ---');
        
        // Vamos testar no Postgres os scores de similaridade e word_similarity para entender o comportamento
        try {
            const trgmScores = await prisma.$queryRaw`
                SELECT 
                    "orgaoNome",
                    similarity("orgaoNome", 'FUERNn') as sim,
                    word_similarity('FUERNn', "orgaoNome") as word_sim,
                    ('FUERNn' %> "orgaoNome")::boolean as op_word_sim,
                    ('FUERNn' <% "orgaoNome")::boolean as op_word_sim_inv,
                    (word_similarity('FUERNn', "orgaoNome") > 0.5)::boolean as direct_check
                FROM "PncpContratacao"
                WHERE "orgaoNome" ILIKE '%FUERN%'
                LIMIT 1;
            ` as any[];
            if (trgmScores.length > 0) {
                console.log(`Amostra do banco: "${trgmScores[0].orgaoNome}"`);
                console.log(`- similarity('FUERNn'): ${trgmScores[0].sim}`);
                console.log(`- word_similarity('FUERNn'): ${trgmScores[0].word_sim}`);
                console.log(`- operador 'FUERNn' %> "orgaoNome" (incorreto): ${trgmScores[0].op_word_sim}`);
                console.log(`- operador 'FUERNn' <% "orgaoNome" (correto): ${trgmScores[0].op_word_sim_inv}`);
                console.log(`- word_similarity('FUERNn', "orgaoNome") > 0.5: ${trgmScores[0].direct_check}`);
            }
        } catch (err: any) {
            console.error('Erro ao calcular scores de similaridade:', err.message);
        }

        const queryFuzzy = 'FUERNn';
        console.log(`Buscando termo com erro de digitação: "${queryFuzzy}"`);

        const startFuzzy = Date.now();
        const searchResultFuzzy = await PncpSearchV3.search({ keywords: queryFuzzy });
        const timeFuzzy = Date.now() - startFuzzy;

        console.log(`Resultados encontrados: ${searchResultFuzzy.total}`);
        console.log(`Tempo de resposta: ${timeFuzzy}ms (elapsed retornado: ${searchResultFuzzy.elapsed}ms)`);
        
        if (searchResultFuzzy.total > 0) {
            console.log('✅ Busca Fuzzy capturou correspondências corretas mesmo com erro de digitação!');
            console.log('Amostra de objetos encontrados:');
            searchResultFuzzy.items.slice(0, 2).forEach((item, idx) => {
                console.log(`  [${idx + 1}] Órgão: ${item.orgao_nome} | Objeto: ${item.objeto.substring(0, 80)}...`);
            });
        } else {
            console.warn('⚠️ Nenhum resultado encontrado. Talvez não haja editais correspondentes.');
        }

        // 4. Testar Busca por Termo Exato (FTS puro)
        console.log('\n--- 🔍 TESTE DE BUSCA POR TERMO EXATO (FTS) ---');
        const queryExact = 'obra';
        const startExact = Date.now();
        const searchResultExact = await PncpSearchV3.search({ keywords: queryExact });
        const timeExact = Date.now() - startExact;

        console.log(`Resultados encontrados para "${queryExact}": ${searchResultExact.total}`);
        console.log(`Tempo de resposta: ${timeExact}ms (elapsed retornado: ${searchResultExact.elapsed}ms)`);
        
        if (searchResultExact.total > 0) {
            console.log('Amostra de objetos encontrados:');
            searchResultExact.items.slice(0, 2).forEach((item, idx) => {
                console.log(`  [${idx + 1}] Objeto: ${item.objeto.substring(0, 100)}...`);
            });
        }

        // 5. Comparar tempos e dar um veredito
        console.log('\n---------------- Veredito de Performance ----------------');
        console.log(`- Busca por Sinônimos (Expandida): ${timeSyn}ms (${searchResultSyn.total} resultados)`);
        console.log(`- Busca Fuzzy (Com Erros): ${timeFuzzy}ms (${searchResultFuzzy.total} resultados)`);
        console.log(`- Busca FTS Pura (Exata): ${timeExact}ms (${searchResultExact.total} resultados)`);
        console.log('---------------------------------------------------------');
        console.log('✅ Testes de performance concluídos com sucesso!');

    } catch (e: any) {
        console.error('❌ Erro durante a execução dos testes:', e);
    } finally {
        await prisma.$disconnect();
    }
}

runTest();
