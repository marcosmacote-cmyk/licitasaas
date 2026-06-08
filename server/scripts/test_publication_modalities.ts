import axios from 'axios';
import https from 'https';

async function main() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    // Testar com codigoModalidadeContratacao=6
    const url6 = "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=20250701&dataFinal=20250702&codigoModalidadeContratacao=6&pagina=1&tamanhoPagina=10";
    try {
        const res = await axios.get(url6, { 
            headers: { 
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            }, 
            httpsAgent: agent 
        } as any);
        const data = res.data as any;
        console.log(`\n--- Testando codigoModalidadeContratacao=6 (Retornou total: ${data.totalRegistros}) ---`);
        data.data?.slice(0, 3).forEach((it: any) => {
            console.log(`- Modalidade no item: ID=${it.modalidadeId} | Nome=${it.modalidadeNome} | Objeto=${it.objetoCompra?.substring(0, 50)}`);
        });
    } catch (err: any) {
        console.error('Erro na mod 6:', err.message);
    }

    // Testar com codigoModalidadeContratacao=1
    const url1 = "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=20250701&dataFinal=20250702&codigoModalidadeContratacao=1&pagina=1&tamanhoPagina=10";
    try {
        const res = await axios.get(url1, { 
            headers: { 
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            }, 
            httpsAgent: agent 
        } as any);
        const data = res.data as any;
        console.log(`\n--- Testando codigoModalidadeContratacao=1 (Retornou total: ${data.totalRegistros}) ---`);
        data.data?.slice(0, 3).forEach((it: any) => {
            console.log(`- Modalidade no item: ID=${it.modalidadeId} | Nome=${it.modalidadeNome} | Objeto=${it.objetoCompra?.substring(0, 50)}`);
        });
    } catch (err: any) {
        console.error('Erro na mod 1:', err.message);
    }

    // Testar com codigoModalidadeContratacao=8
    const url8 = "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=20250701&dataFinal=20250702&codigoModalidadeContratacao=8&pagina=1&tamanhoPagina=10";
    try {
        const res = await axios.get(url8, { 
            headers: { 
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            }, 
            httpsAgent: agent 
        } as any);
        const data = res.data as any;
        console.log(`\n--- Testando codigoModalidadeContratacao=8 (Retornou total: ${data.totalRegistros}) ---`);
        data.data?.slice(0, 3).forEach((it: any) => {
            console.log(`- Modalidade no item: ID=${it.modalidadeId} | Nome=${it.modalidadeNome} | Objeto=${it.objetoCompra?.substring(0, 50)}`);
        });
    } catch (err: any) {
        console.error('Erro na mod 8:', err.message);
    }
}

main();
