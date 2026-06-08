import axios from 'axios';
import https from 'https';

async function main() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    // Mesmo cabeçalho do serviço: apenas Accept
    const url = "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=20250701&dataFinal=20250707&codigoModalidadeContratacao=1&pagina=1&tamanhoPagina=50";

    try {
        console.log("Executando chamada SEM User-Agent...");
        const res = await axios.get(url, { 
            headers: { 'Accept': 'application/json' }, 
            httpsAgent: agent, 
            timeout: 10000 
        } as any);
        console.log(`SEM User-Agent - Status: ${res.status}`);
        const resData1 = (res as any).data;
        console.log(`SEM User-Agent - Total Registros: ${resData1?.totalRegistros}`);
        console.log(`SEM User-Agent - data length: ${resData1?.data?.length}`);
    } catch (err: any) {
        console.error('SEM User-Agent - Erro:', err.message);
    }

    try {
        console.log("\nExecutando chamada COM User-Agent...");
        const res = await axios.get(url, { 
            headers: { 
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }, 
            httpsAgent: agent, 
            timeout: 10000 
        } as any);
        console.log(`COM User-Agent - Status: ${res.status}`);
        const resData2 = (res as any).data;
        console.log(`COM User-Agent - Total Registros: ${resData2?.totalRegistros}`);
        console.log(`COM User-Agent - data length: ${resData2?.data?.length}`);
    } catch (err: any) {
        console.error('COM User-Agent - Erro:', err.message);
    }
}

main();
