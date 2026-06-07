import axios from 'axios';
import https from 'https';

async function runTest() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    // Testing June 2026 range (current month)
    const testCases = [
        'data_publicacao_pncp:[2026-06-01 TO 2026-06-07]',
        'data_fim_vigencia:[2026-06-01 TO 2026-06-30]'
    ];
    
    for (const query of testCases) {
        const url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=10&pagina=1&q=${encodeURIComponent(query)}`;
        console.log(`Testing query: ${query}`);
        console.log(`URL: ${url}`);
        try {
            const response = await axios.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: agent, timeout: 15000 });
            console.log('  Success! Status:', response.status);
            const total = response.data?.total || response.data?.totalRegistros;
            console.log('  Total results:', total);
            const items = response.data?.items || [];
            console.log('  Items returned:', items.length);
            if (items.length > 0) {
                console.log('  Sample item - title:', items[0].title);
                console.log('  Sample item - data_publicacao_pncp:', items[0].data_publicacao_pncp, 'data_fim_vigencia:', items[0].data_fim_vigencia);
            }
        } catch (e: any) {
            console.log('  Failed:', e.message);
        }
        console.log('-------------------------------------------');
    }
}

runTest();
