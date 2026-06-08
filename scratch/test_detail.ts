import axios from 'axios';
import https from 'https';

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const PNCP_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
};

async function testSingleDetail() {
    const url = 'https://pncp.gov.br/api/consulta/v1/orgaos/10744098000145/compras/2026/92';
    console.log("Fetching: " + url);
    const start = Date.now();
    try {
        const resp = await axios.get(url, { httpsAgent: agent, headers: PNCP_HEADERS, timeout: 15000 });
        console.log("Success in " + (Date.now() - start) + "ms");
        console.log("valorTotalEstimado:", resp.data?.valorTotalEstimado);
        console.log("linkSistemaOrigem:", resp.data?.linkSistemaOrigem);
    } catch (e: any) {
        console.error("Failed in " + (Date.now() - start) + "ms: " + e.message);
    }
}

testSingleDetail();
