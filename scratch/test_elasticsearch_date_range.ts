import axios from 'axios';
import https from 'https';

async function runTest() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    // Testing June 2026 range (current month/year)
    const queries = [
        'data_fim_vigencia:[2026-06-01T00:00:00.000Z TO 2026-06-30T23:59:59.999Z]',
        'data_inicio_vigencia:[2026-06-01T00:00:00.000Z TO 2026-06-30T23:59:59.999Z]',
        'data_publicacao_pncp:[2026-06-01T00:00:00.000Z TO 2026-06-30T23:59:59.999Z]'
    ];
    
    for (const q of queries) {
        const url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=10&pagina=1&q=${encodeURIComponent(q)}`;
        console.log(`Testing query: "${q}"`);
        try {
            const response = await axios.get(url, { 
                headers: { 
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }, 
                httpsAgent: agent, 
                timeout: 15000 
            } as any);
            console.log('  Success! Status:', response.status);
            const total = response.data?.total || response.data?.totalRegistros;
            console.log('  Total results:', total);
            const items = response.data?.items || [];
            console.log('  Items returned:', items.length);
            if (items.length > 0) {
                console.log('  Sample item:', items[0].title, '| data_fim_vigencia:', items[0].data_fim_vigencia);
            }
        } catch (e: any) {
            console.log('  Failed:', e.message);
        }
        console.log('-------------------------------------------');
    }
}

runTest();
