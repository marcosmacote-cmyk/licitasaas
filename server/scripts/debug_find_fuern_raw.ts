import axios from 'axios';
import https from 'https';

async function main() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    // CNPJ da FUERN
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
        const items = data?.items || [];
        
        console.log(`Analisando editais da FUERN do ano de 2025 (Total no array: ${items.length}):`);
        
        const items2025 = items.filter((it: any) => {
            const dateStr = it.data_publicacao_pncp || it.createdAt;
            return dateStr && dateStr.startsWith('2025');
        });

        for (const it of items2025) {
            const cnpj = it.orgao_cnpj || '';
            const ano = it.ano || '';
            const seq = it.numero_sequencial || '';
            const titulo = it.title || it.titulo || '';
            
            // Fazer chamada ao endpoint de detalhes para obter os campos de data estruturados do PNCP
            const detailUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
            try {
                const detailRes = await axios.get(detailUrl, { 
                    headers: { 
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }, 
                    httpsAgent: agent, 
                    timeout: 5000 
                } as any);
                const d = detailRes.data as any;
                console.log(`\nEdital: ${titulo} | Seq: ${seq}`);
                console.log('Chaves do objeto retornado:', Object.keys(d));
                console.log('PAYLOAD COMPLETO:', JSON.stringify(d, null, 2));
                // Parar no primeiro item para inspecionarmos
                break;
            } catch (err: any) {
                console.log(`- Falha ao obter detalhes de ${seq}: ${err.message}`);
            }
        }
        
    } catch (err: any) {
        console.error('Falha geral:', err.message);
    }
}

main();
