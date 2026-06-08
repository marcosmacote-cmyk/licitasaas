import axios from 'axios';
import https from 'https';

async function main() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const targetCnpj = '08258295000102'; // CNPJ da FUERN
    
    // Consultar o bloco onde o edital de 30/07/2025 da FUERN deveria estar.
    // dataInicial=20250729 e dataFinal=20250804
    const url = "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=20250729&dataFinal=20250804&codigoModalidadeContratacao=6&pagina=1&tamanhoPagina=50";

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
        console.log(`Status: ${res.status}`);
        console.log(`Total registros no bloco: ${data?.totalRegistros}`);
        console.log(`Quantidade de páginas: ${data?.totalPaginas}`);
        
        // Vamos varrer todas as páginas para garantir que não perdemos o edital se ele estiver em uma página posterior!
        const totalPaginas = data?.totalPaginas || 1;
        let found = false;

        for (let p = 1; p <= totalPaginas; p++) {
            const pageUrl = `https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=20250729&dataFinal=20250804&codigoModalidadeContratacao=6&pagina=${p}&tamanhoPagina=50`;
            const pageRes = await axios.get(pageUrl, { 
                headers: { 
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }, 
                httpsAgent: agent, 
                timeout: 5000 
            } as any);
            const pageData = pageRes.data as any;
            const items = pageData.data || [];
            
            console.log(`Página ${p} processada: ${items.length} itens.`);
            
            items.forEach((it: any) => {
                const orgao = it.orgaoEntidade || {};
                const cnpj = orgao.cnpj || it.cnpjOrgao || '';
                if (cnpj === targetCnpj) {
                    console.log(`\n!!! ENCONTRADO FUERN !!! na página ${p}:`);
                    console.log(JSON.stringify(it, null, 2));
                    found = true;
                }
            });
        }
        
        if (!found) {
            console.log('\nFUERN não foi encontrada em nenhuma página desse bloco da API de publicações.');
        }
    } catch (err: any) {
        console.error('Falha:', err.message);
    }
}

main();
