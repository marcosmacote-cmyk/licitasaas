import axios from 'axios';
import https from 'https';

async function runTest() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    // Testing the general contratações endpoint
    const url = "https://pncp.gov.br/api/consulta/v1/contratacoes?dataInicial=20250101&dataFinal=20250110&pagina=1&tamanhoPagina=10";
    console.log(`URL: ${url}`);
    
    try {
        const response = await axios.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: agent, timeout: 15000 });
        console.log('Success! Status:', response.status);
        console.log('Response keys:', Object.keys(response.data || {}));
        const data = response.data?.data || [];
        console.log('Data count:', data.length);
        if (data.length > 0) {
            console.log('First item:', JSON.stringify(data[0], null, 2).substring(0, 500));
        }
    } catch (e: any) {
        console.log('Failed:', e.message);
        if (e.response) {
            console.log('  Response status:', e.response.status);
            console.log('  Response data:', JSON.stringify(e.response.data, null, 2).substring(0, 1000));
        }
    }
}

runTest();
