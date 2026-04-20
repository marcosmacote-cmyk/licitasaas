import axios from 'axios';
import https from 'https';

async function test() {
    const url = "https://pncp.gov.br/pncp-api/v1/orgaos/07598618000144/compras/2026/40/arquivos/1";
    const agent = new https.Agent({ rejectUnauthorized: false });
    console.log("Fetching without UA...");
    try {
        const res = await axios.get(url, {
            httpsAgent: agent,
            timeout: 10000,
            responseType: 'arraybuffer',
            maxRedirects: 5,
            headers: {
                // 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        console.log("Success! Status:", res.status, "Length:", res.data.length);
    } catch (e: any) {
        console.error("Error:", e.message);
        if (e.response) {
            console.error("Status:", e.response.status);
        }
    }
}
test();
