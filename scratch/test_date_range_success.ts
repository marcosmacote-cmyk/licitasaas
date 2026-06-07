import axios from 'axios';
import https from 'https';

async function runTest() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    // Testing the whole year of 2025 on data_inicio_vigencia
    const query = 'data_inicio_vigencia:[2025-01-01T00:00:00.000Z TO 2025-12-31T23:59:59.999Z]';
    const url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=10&pagina=1&q=${encodeURIComponent(query)}`;
    console.log(`URL: ${url}`);
    
    try {
        const response = await axios.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: agent, timeout: 15000 });
        console.log('Success! Status:', response.status);
        console.log('Data keys:', Object.keys(response.data || {}));
        const total = response.data?.total || response.data?.totalRegistros;
        console.log('Total:', total);
        const items = response.data?.items || [];
        console.log('Items count:', items.length);
        if (items.length > 0) {
            console.log('Sample item:', items[0].title, '| Start:', items[0].data_inicio_vigencia);
        }
    } catch (e: any) {
        console.log('Failed:', e.message);
    }
}

runTest();
