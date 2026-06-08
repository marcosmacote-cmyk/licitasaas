import axios from 'axios';
import https from 'https';

async function main() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    // Pregão Eletrônico da FUERN em 30/07/2025 e 21/07/2025.
    // Vamos buscar de 20/07/2025 a 31/07/2025 na modalidade 1 (Pregão).
    const url = "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=20250720&dataFinal=20250731&codigoModalidadeContratacao=1&pagina=1&tamanhoPagina=50";

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
        console.log(`Total registros: ${data?.totalRegistros}`);
        console.log(`Quantidade nesta página: ${data?.data?.length}`);
        
        if (data?.data && data.data.length > 0) {
            console.log('\nAnalisando itens na página:');
            const items = data.data;
            
            // Vamos listar o CNPJ e o nome de todos os órgãos retornados para ver se encontramos o CNPJ da FUERN: 08258295000102
            const targetCnpj = '08258295000102';
            let found = false;
            
            items.forEach((it: any, idx: number) => {
                const orgao = it.orgaoEntidade || {};
                const cnpj = orgao.cnpj || it.cnpjOrgao || '';
                const nome = orgao.razaoSocial || it.orgaoNome || '';
                
                if (cnpj === targetCnpj || nome.includes('FUERN')) {
                    console.log(`\n!!! ENCONTRADO FUERN !!! no índice ${idx}:`);
                    console.log(JSON.stringify(it, null, 2));
                    found = true;
                }
            });
            
            if (!found) {
                console.log('\nFUERN não foi encontrada nos primeiros 50 resultados deste período.');
                console.log('Alguns CNPJs retornados para amostragem:');
                items.slice(0, 5).forEach((it: any, idx: number) => {
                    console.log(`- Item ${idx}: CNPJ=${it.orgaoEntidade?.cnpj || it.cnpjOrgao} | Nome=${it.orgaoEntidade?.razaoSocial || it.orgaoNome}`);
                });
            }
        }
    } catch (err: any) {
        console.error('Falha na chamada:', err.message);
    }
}

main();
