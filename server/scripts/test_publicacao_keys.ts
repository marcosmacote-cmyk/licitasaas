import axios from 'axios';
import https from 'https';

async function main() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const url = "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=20250701&dataFinal=20250702&codigoModalidadeContratacao=6&pagina=1&tamanhoPagina=50";

    try {
        const res = await axios.get(url, { 
            headers: { 
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }, 
            httpsAgent: agent, 
            timeout: 10000 
        } as any);
        const data = res.data as any;
        console.log("Status da resposta:", res.status);
        console.log("Chaves do objeto retornado:", Object.keys(data));
        console.log("totalRegistros:", data.totalRegistros);
        console.log("totalPaginas:", data.totalPaginas);
        console.log("numeroPagina:", data.numeroPagina);
        console.log("Tamanho do array 'data':", data.data?.length);
        if (data.data?.length > 0) {
            console.log("Chaves de um item individual:", Object.keys(data.data[0]));
        }
    } catch (err: any) {
        console.error('Falha:', err.message);
    }
}

main();
