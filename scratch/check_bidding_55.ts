import axios from 'axios';
import https from 'https';

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const PNCP_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
};

async function checkSpecificBidding() {
    const url = 'https://pncp.gov.br/api/consulta/v1/orgaos/07615750000117/compras/2026/55';
    try {
        const resp = await axios.get(url, { httpsAgent: agent, headers: PNCP_HEADERS });
        console.log("=== DETAIL RESPONSE ===");
        console.log("valorTotalEstimado:", resp.data?.valorTotalEstimado);
        console.log("linkSistemaOrigem:", resp.data?.linkSistemaOrigem);
        console.log("dataInicioDisputa:", resp.data?.dataInicioDisputa);
        console.log("dataAberturaEdital:", resp.data?.dataAberturaEdital);
    } catch (e: any) {
        console.error("Failed:", e.message);
    }
}

checkSpecificBidding();
