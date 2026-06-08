import axios from 'axios';
import https from 'https';

async function main() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const targetCnpj = '08258295000102'; // CNPJ da FUERN
    const targetSeq = '16'; // Sequencial do item 17 (Edital 90016/2025)
    
    // Testar todos os códigos de modalidade de 1 a 10 para o dia 30/07/2025
    for (let mod = 1; mod <= 10; mod++) {
        const url = `https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=20250730&dataFinal=20250730&codigoModalidadeContratacao=${mod}&pagina=1&tamanhoPagina=50`;
        
        try {
            const res = await axios.get(url, { 
                headers: { 
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }, 
                httpsAgent: agent, 
                timeout: 5000 
            } as any);
            const data = res.data as any;
            const items = data.data || [];
            
            items.forEach((it: any) => {
                const orgao = it.orgaoEntidade || {};
                const cnpj = orgao.cnpj || it.cnpjOrgao || '';
                const seq = it.sequencialCompra || '';
                
                if (cnpj === targetCnpj) {
                    console.log(`\n!!! ACHEI !!! Modalidade ID: ${mod}`);
                    console.log(`Edital encontrado: ${it.objetoCompra || it.objeto}`);
                    console.log(`CNPJ Órgão: ${cnpj}`);
                    console.log(`Ano: ${it.anoCompra}`);
                    console.log(`Seq: ${seq}`);
                    console.log(`Modalidade Nome no item: ${it.modalidadeNome}`);
                    console.log(`Situação: ${it.situacaoCompraNome}`);
                    console.log(`Data Publicação PNCP: ${it.dataPublicacaoPncp}`);
                }
            });
            
        } catch (err: any) {
            console.error(`Erro na mod ${mod}:`, err.message);
        }
    }
}

main();
