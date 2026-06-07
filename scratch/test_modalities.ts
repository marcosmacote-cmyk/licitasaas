import axios from 'axios';
import https from 'https';

async function runTest() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    // We try modality codes from 1 to 15
    for (let code = 1; code <= 15; code++) {
        const url = `https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=20250102&dataFinal=20250102&codigoModalidadeContratacao=${code}&pagina=1&tamanhoPagina=10`;
        try {
            const response = await axios.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: agent, timeout: 5000 });
            console.log(`Code ${code} -> Success! Total: ${response.data?.totalRegistros || 0}`);
        } catch (e: any) {
            console.log(`Code ${code} -> Failed: status ${e.response?.status || e.message}`);
        }
    }
}

runTest();
