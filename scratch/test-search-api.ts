import axios from 'axios';
import https from 'https';

async function run() {
    const url = 'https://pncp.gov.br/api/consulta/v1/orgaos/18085563000195/compras/2026/14';
    const agent = new https.Agent({ rejectUnauthorized: false });
    try {
        console.log("Fetching purchase details from PNCP API...");
        const res = await axios.get(url, {
            httpsAgent: agent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        });
        console.log("Response data:", JSON.stringify(res.data, null, 2));
    } catch (err: any) {
        console.error("Error fetching:", err.message);
    }
}

run();
