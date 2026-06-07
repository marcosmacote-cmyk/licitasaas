import axios from 'axios';
import https from 'https';

async function runTest() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    const testCases = [
        '2025',
        'obras 2025',
        'edital 2025',
    ];
    
    for (const q of testCases) {
        const url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=10&pagina=1&status=encerradas&q=${encodeURIComponent(q)}`;
        console.log(`URL for q="${q}": ${url}`);
        try {
            const response = await axios.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: agent, timeout: 15000 });
            const total = response.data?.total || response.data?.totalRegistros;
            const items = response.data?.items || [];
            console.log(`  Success! Total: ${total}, Items: ${items.length}`);
            if (items.length > 0) {
                console.log(`  Sample item title: "${items[0].title}" | year: ${items[0].ano}`);
            }
        } catch (e: any) {
            console.log(`  Failed: ${e.message}`);
        }
        console.log('-------------------------------------------');
    }
}

runTest();
