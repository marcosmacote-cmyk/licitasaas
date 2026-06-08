import axios from 'axios';
import https from 'https';

async function main() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const pageSizes = [100, 50, 30, 20, 10];
    
    for (const size of pageSizes) {
        const url = `https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=20250701&dataFinal=20250702&codigoModalidadeContratacao=6&pagina=1&tamanhoPagina=${size}`;
        try {
            const res = await axios.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: agent, timeout: 5000 } as any);
            const resData = (res as any).data;
            console.log(`Page size ${size}: SUCCESS (status ${res.status}, items ${resData?.data?.length}, total ${resData?.totalRegistros})`);
        } catch (err: any) {
            console.log(`Page size ${size}: FAILED (${err.message}) - status ${err.response?.status}`);
        }
    }
}

main();
