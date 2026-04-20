import axios from 'axios';
import https from 'https';

async function test() {
    const url = "https://pncp.gov.br/pncp-api/v1/orgaos/08079402000135/compras/2026/23/arquivos/1";
    const agent = new https.Agent({ rejectUnauthorized: false });
    try {
        const res = await axios.get(url, {
            httpsAgent: agent,
            timeout: 90000,
            responseType: 'arraybuffer',
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/pdf,application/zip,application/x-rar-compressed,*/*'
            }
        });
        console.log("Success! Status:", res.status, "Length:", res.data.length);
        const buffer = Buffer.from(res.data);
        console.log("Magic bytes:", buffer[0].toString(16), buffer[1].toString(16), buffer[2].toString(16), buffer[3].toString(16));
        const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46; // %PDF
        console.log("isPdf:", isPdf);
        if (!isPdf) {
            console.log("Content start:", buffer.toString('utf8', 0, 100));
        }
    } catch (e: any) {
        console.log("Error:", e.message);
        if (e.response) {
            console.log("Status:", e.response.status);
        }
    }
}
test();
