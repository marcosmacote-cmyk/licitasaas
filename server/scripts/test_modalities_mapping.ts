import axios from 'axios';
import https from 'https';

async function main() {
    const agent = new https.Agent({ rejectUnauthorized: false });
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
        
        const items2025 = items.filter((it: any) => {
            const dateStr = it.data_publicacao_pncp || it.createdAt;
            return dateStr && dateStr.startsWith('2025');
        });

        console.log(`Mapeamento de modalidades da FUERN em 2025 (Total: ${items2025.length}):`);
        const map = new Map<string, string>();
        for (const it of items2025) {
            const id = it.modalidade_licitacao_id;
            const nome = it.modalidade_licitacao_nome;
            map.set(id, nome);
            console.log(`- Id: ${id} | Nome: ${nome} | Titulo: ${it.title || it.titulo}`);
        }
        
        console.log('\nResumo do mapeamento ID -> Nome detectado:');
        map.forEach((value, key) => {
            console.log(`  ID: ${key} => NOME: ${value}`);
        });
    } catch (err: any) {
        console.error('Erro:', err.message);
    }
}

main();
