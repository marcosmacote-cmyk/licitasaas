import axios from 'axios';
import https from 'https';

async function main() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    // Buscar pelo CNPJ da FUERN
    const url = "https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=100&pagina=1&q=08258295000102";

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
        console.log(`Total de registros da FUERN: ${data?.total}`);
        
        const items = data?.items || [];
        console.log(`Itens retornados nesta página: ${items.length}`);
        
        const items2025 = items.filter((it: any) => {
            const dateStr = it.data_publicacao_pncp || it.createdAt;
            return dateStr && dateStr.startsWith('2025');
        });
        console.log(`Total de itens em 2025 nesta página: ${items2025.length}`);
        
        items2025.forEach((it: any, idx: number) => {
            console.log(`- Item ${idx + 1}: Data: ${it.data_publicacao_pncp || it.createdAt} | Modalidade: ${it.modalidade_licitacao_nome || it.modalidade} | Objeto: ${it.title || it.titulo || it.description}`);
        });
        
    } catch (err: any) {
        console.error('Falha ao consultar a API de busca do governo:', err.message);
        if (err.response) {
            console.error('Response status:', err.response.status);
            console.error('Response data:', err.response.data);
        }
    }
}

main();
