import axios from 'axios';
import https from 'https';

async function main() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const queries = [
        '08258295000102 AND data_publicacao_pncp:[2025-07-01T00:00:00.000Z TO 2025-12-31T23:59:59.999Z]',
        '08258295000102 AND data_publicacao_pncp:[2025-07-01 TO 2025-12-31]',
        '08258295000102 AND data_publicacao_pncp:[2025-07-01T00:00:00Z TO 2025-12-31T23:59:59Z]'
    ];

    for (const query of queries) {
        const url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=100&pagina=1&q=${encodeURIComponent(query)}`;
        try {
            const res = await axios.get(url, { 
                headers: { 
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }, 
                httpsAgent: agent, 
                timeout: 5000 
            } as any);
            const data = res.data as any;
            console.log(`Query: "${query}" => Total: ${data?.total}`);
        } catch (err: any) {
            console.error(`Query: "${query}" => Erro: ${err.message}`);
        }
    }
}

main();
