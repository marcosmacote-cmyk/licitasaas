import axios from 'axios';
import https from 'https';

async function runTest() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    // Testing dataInicial and dataFinal in search parameters
    const url = "https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=10&pagina=1&status=encerradas&dataInicial=20250101&dataFinal=20250110";
    console.log(`URL: ${url}`);
    
    try {
        const response = await axios.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: agent, timeout: 15000 });
        console.log('Success! Status:', response.status);
        console.log('Total results:', response.data?.total || response.data?.totalRegistros);
        const items = response.data?.items || [];
        console.log('Items returned:', items.length);
    } catch (e: any) {
        console.log('Failed:', e.message);
        if (e.response) {
            console.log('  Response status:', e.response.status);
            console.log('  Response data:', JSON.stringify(e.response.data, null, 2).substring(0, 500));
        }
    }
}

runTest();
