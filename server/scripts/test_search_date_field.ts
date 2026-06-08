import axios from 'axios';
import https from 'https';

async function main() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const fields = [
        'data_publicacao_pncp',
        'dataPublicacaoPncp',
        'data_publicacao',
        'data',
        'createdAt',
        'dataInclusao',
        'data_inicio_vigencia'
    ];

    for (const field of fields) {
        const query = `08258295000102 AND ${field}:[2025-07-01 TO 2025-12-31]`;
        const url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=10&pagina=1&q=${encodeURIComponent(query)}`;
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
            console.log(`Campo: "${field}" => Total: ${data?.total}`);
        } catch (err: any) {
            console.error(`Campo: "${field}" => Erro: ${err.message}`);
        }
    }
}

main();
