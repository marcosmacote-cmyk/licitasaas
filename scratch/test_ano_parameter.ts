import axios from 'axios';
import https from 'https';

async function runTest() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    const params = [
        'exercicio=2025',
        'anoCompra=2025',
        'ano_compra=2025',
        'anoDaCompra=2025',
        'ano_da_compra=2025'
    ];
    
    for (const p of params) {
        const url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=10&pagina=1&status=encerradas&${p}`;
        console.log(`Testing param: ${p}`);
        try {
            const response = await axios.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: agent, timeout: 15000 });
            console.log('  Success! Status:', response.status);
            const total = response.data?.total || response.data?.totalRegistros;
            console.log('  Total results:', total);
            const items = response.data?.items || [];
            console.log('  Items returned:', items.length);
            if (items.length > 0) {
                console.log('  Sample item year:', items[0].ano);
            }
        } catch (e: any) {
            console.log('  Failed:', e.message);
        }
        console.log('-------------------------------------------');
    }
}

runTest();
