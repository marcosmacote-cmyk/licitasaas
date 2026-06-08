import axios from 'axios';
import https from 'https';

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const PNCP_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
};

async function inspectSearchItem() {
    const url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=2&pagina=1&q=jaguaruana`;
    try {
        const resp = await axios.get(url, { httpsAgent: agent, headers: PNCP_HEADERS });
        console.log("=== RAW SEARCH ITEM ===");
        if (resp.data?.items?.length > 0) {
            console.log(JSON.stringify(resp.data.items[0], null, 2));
        } else {
            console.log("No items found");
        }
    } catch (e: any) {
        console.error("Failed:", e.message);
    }
}

inspectSearchItem();
