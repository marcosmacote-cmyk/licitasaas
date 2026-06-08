import axios from 'axios';
import https from 'https';

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const PNCP_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
};

const cnpjs = [
    { cnpj: '10744098000145', ano: '2026', seq: '92' },
    { cnpj: '07615750000117', ano: '2026', seq: '59' },
    { cnpj: '07615750000117', ano: '2026', seq: '58' },
    { cnpj: '07615750000117', ano: '2026', seq: '57' },
    { cnpj: '07615750000117', ano: '2026', seq: '56' }
];

async function testMultipleDetailsWithDelay() {
    console.log("=== STARTING STAGGERED FETCH ===");
    for (let i = 0; i < cnpjs.length; i++) {
        const item = cnpjs[i];
        const url = `https://pncp.gov.br/api/consulta/v1/orgaos/${item.cnpj}/compras/${item.ano}/${item.seq}`;
        console.log(`[${i}] Fetching: ${url}`);
        const start = Date.now();
        try {
            const resp = await axios.get(url, { httpsAgent: agent, headers: PNCP_HEADERS, timeout: 8000 });
            console.log(`[${i}] Success in ${Date.now() - start}ms - val: ${resp.data?.valorTotalEstimado}`);
        } catch (e: any) {
            console.error(`[${i}] Failed in ${Date.now() - start}ms: ${e.message}`);
        }
        // Wait 300ms before next request
        await new Promise(r => setTimeout(r, 300));
    }
}

testMultipleDetailsWithDelay();
