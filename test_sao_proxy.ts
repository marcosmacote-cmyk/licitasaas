import axios from 'axios';
import https from 'https';

async function test() {
    const url = "https://pncp.gov.br/pncp-api/v1/orgaos/08079402000135/compras/2026/23/arquivos/1";
    const agent = new https.Agent({ rejectUnauthorized: false });
    try {
        console.log("Fetching", url);
        // Do a GET with follow redirects to see the final URL
        const res = await axios.get(url, {
            httpsAgent: agent,
            maxRedirects: 0, // We want to see the redirect
            validateStatus: status => status >= 200 && status < 400
        });
        console.log("No redirect? Status:", res.status);
    } catch (e: any) {
        if (e.response && (e.response.status === 301 || e.response.status === 302)) {
            console.log("REDIRECT to:", e.response.headers.location);
            const redirectUrl = e.response.headers.location;
            
            // Try downloading the redirect
            try {
                const res2 = await axios.get(redirectUrl, {
                    httpsAgent: agent,
                    timeout: 10000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': '*/*'
                    }
                });
                console.log("Redirect download success:", res2.status);
            } catch (e2: any) {
                console.log("Redirect download error:", e2.message);
                if (e2.response) {
                    console.log("Status:", e2.response.status);
                    console.log("Headers:", e2.response.headers);
                }
            }
        } else {
            console.log("Error:", e.message);
        }
    }
}
test();
