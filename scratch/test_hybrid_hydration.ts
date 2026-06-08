import axios from 'axios';
import https from 'https';

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const PNCP_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
};

// Re-implement the stagger function for testing
const runWithStagger = async <T>(
    itemsList: any[],
    concurrency: number,
    staggerMs: number,
    fn: (item: any) => Promise<T>
): Promise<PromiseSettledResult<T>[]> => {
    const results: PromiseSettledResult<T>[] = [];
    const limit = concurrency;
    let active = 0;
    let index = 0;

    return new Promise<PromiseSettledResult<T>[]>((resolve) => {
        const next = async () => {
            if (index >= itemsList.length && active === 0) {
                resolve(results);
                return;
            }

            while (active < limit && index < itemsList.length) {
                const currentIdx = index++;
                const it = itemsList[currentIdx];
                active++;

                if (staggerMs > 0 && currentIdx > 0) {
                    await new Promise(r => setTimeout(r, staggerMs));
                }

                fn(it).then(val => {
                    results[currentIdx] = { status: 'fulfilled', value: val };
                }).catch(err => {
                    results[currentIdx] = { status: 'rejected', reason: err };
                }).finally(() => {
                    active--;
                    next();
                });
            }
        };
        next();
    });
};

async function testHydrationLogic() {
    console.log("=== HYDRATING TEST ITEMS WITH STAGGER ===");
    // Jaguaruana biddings that previously timed out
    const stillMissing = [
        { id: '10744098000145-1-000092/2026', orgao_cnpj: '10744098000145', ano: '2026', numero_sequencial: '92', valor_estimado: 0 },
        { id: '07615750000117-1-000059/2026', orgao_cnpj: '07615750000117', ano: '2026', numero_sequencial: '59', valor_estimado: 0 },
        { id: '07615750000117-1-000058/2026', orgao_cnpj: '07615750000117', ano: '2026', numero_sequencial: '58', valor_estimado: 0 },
        { id: '07615750000117-1-000057/2026', orgao_cnpj: '07615750000117', ano: '2026', numero_sequencial: '57', valor_estimado: 0 },
        { id: '07615750000117-1-000056/2026', orgao_cnpj: '07615750000117', ano: '2026', numero_sequencial: '56', valor_estimado: 0 }
    ];

    const start = Date.now();
    const results = await runWithStagger(
        stillMissing,
        3,
        150,
        (it) => axios.get(
            `https://pncp.gov.br/api/consulta/v1/orgaos/${it.orgao_cnpj}/compras/${it.ano}/${it.numero_sequencial}`, 
            { httpsAgent: agent, timeout: 8000, headers: PNCP_HEADERS } as any
        )
    );

    console.log(`\nFinished in ${Date.now() - start}ms`);
    results.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
            const val = (r.value.data as any)?.valorTotalEstimado ?? (r.value.data as any)?.valorTotalHomologado ?? null;
            const lso = (r.value.data as any)?.linkSistemaOrigem;
            console.log(`Item [${idx}] (${stillMissing[idx].id}): Success! Value: ${val}, linkOrigem: ${lso}`);
        } else {
            console.error(`Item [${idx}] (${stillMissing[idx].id}): Failed! Error: ${r.reason.message}`);
        }
    });
}

testHydrationLogic();
