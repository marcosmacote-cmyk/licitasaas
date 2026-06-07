import axios from 'axios';
import https from 'https';

async function runTest() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const url = "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=20250101&dataFinal=20250110&pagina=1&tamanhoPagina=10";
    
    try {
        const response = await axios.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: agent, timeout: 15000 });
        console.log('Success! Status:', response.status);
        const data = response.data;
        console.log('Is Array?', Array.isArray(data));
        console.log('Length:', data?.length);
        if (Array.isArray(data) && data.length > 0) {
            console.log('First item keys:', Object.keys(data[0]));
            console.log('First item sample:', JSON.stringify(data[0], null, 2));
        }
    } catch (e: any) {
        console.log('Failed:', e.message);
    }
}

runTest();
