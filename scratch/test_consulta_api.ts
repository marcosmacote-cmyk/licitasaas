import axios from 'axios';
import https from 'https';

async function runTest() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const url = "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=20250101&dataFinal=20250110&pagina=1&tamanhoPagina=10";
    
    try {
        const response = await axios.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: agent, timeout: 15000 });
        console.log('Success!', response.status);
    } catch (e: any) {
        console.log('Failed:', e.message);
        if (e.response) {
            console.log('Response status:', e.response.status);
            console.log('Response data:', JSON.stringify(e.response.data, null, 2));
        }
    }
}

runTest();
