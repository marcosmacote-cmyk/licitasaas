import axios from 'axios';
import https from 'https';

async function main() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    // Vamos testar várias combinações de parâmetros na URL fora do 'q'
    const paramCombinations = [
        { name: 'Nenhum (Referência)', params: '' },
        { name: 'data_inicial e data_final (hifen)', params: '&data_inicial=2025-07-01&data_final=2025-12-31' },
        { name: 'data_inicial e data_final (sem hifen)', params: '&data_inicial=20250701&data_final=20251231' },
        { name: 'dataInicial e dataFinal', params: '&dataInicial=2025-07-01&dataFinal=2025-12-31' },
        { name: 'dataInicial e dataFinal (sem hifen)', params: '&dataInicial=20250701&dataFinal=20251231' },
        { name: 'data_publicacao_inicial e data_publicacao_final', params: '&data_publicacao_inicial=2025-07-01&data_publicacao_final=2025-12-31' },
        { name: 'dataPublicacaoPncpInicial e dataPublicacaoPncpFinal', params: '&dataPublicacaoPncpInicial=2025-07-01&dataPublicacaoPncpFinal=2025-12-31' }
    ];

    for (const item of paramCombinations) {
        const url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=10&pagina=1&q=08258295000102${item.params}`;
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
            console.log(`Parâmetros: "${item.name}" => Total: ${data?.total}`);
        } catch (err: any) {
            console.error(`Parâmetros: "${item.name}" => Erro: ${err.message}`);
        }
    }
}

main();
