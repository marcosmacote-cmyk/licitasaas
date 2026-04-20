import axios from 'axios';
import https from 'https';

async function test() {
    const url = "https://pncp.gov.br/pncp-api/v1/orgaos/07598618000144/compras/2026/40/arquivos/1";
    const agent = new https.Agent({ rejectUnauthorized: false });
    console.log("Fetching:", url);
    try {
        const fileRes = await axios.get(url, {
            httpsAgent: agent,
            timeout: 90000,
            responseType: 'arraybuffer',
            maxRedirects: 5
        });
        const buffer = Buffer.from(fileRes.data);
        console.log("Length:", buffer.length);
        console.log("Magic bytes:", buffer[0].toString(16), buffer[1].toString(16), buffer[2].toString(16), buffer[3].toString(16));
        
        const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
        console.log("isPdf:", isPdf);
        
        if (!isPdf) {
            console.log("Content start:", buffer.toString('utf8', 0, 100));
        }
    } catch (e: any) {
        console.error("Error:", e.message);
    }
}
test();
