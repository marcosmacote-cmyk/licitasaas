import axios from 'axios';
import https from 'https';

async function main() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const url = "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=20250701&dataFinal=20250707&codigoModalidadeContratacao=6&pagina=1&tamanhoPagina=100";
    
    try {
        const res = await axios.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: agent, timeout: 15000 });
        console.log('Status:', res.status);
        console.log('Keys:', Object.keys(res.data || {}));
        console.log('totalRegistros:', res.data?.totalRegistros);
        console.log('data length:', res.data?.data?.length);
    } catch (err: any) {
        console.error('Failed:', err.message);
        if (err.response) {
            console.error('Response status:', err.response.status);
            console.error('Response data:', err.response.data);
        }
    }
}

main();
