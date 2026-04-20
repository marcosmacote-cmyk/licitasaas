import axios from 'axios';
import https from 'https';

async function test() {
    const url = "https://pncp.gov.br/api/pncp/v1/orgaos/08079402000135/compras/2026/23/arquivos/1";
    const agent = new https.Agent({ rejectUnauthorized: false });
    try {
        console.log("Fetching", url);
        const res = await axios.get(url, {
            httpsAgent: agent,
            timeout: 10000,
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });
        console.log("Success:", res.status);
    } catch (e: any) {
        console.log("Error:", e.message);
        if (e.response) {
            console.log("Status:", e.response.status);
        }
    }
}
test();
