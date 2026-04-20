import axios from 'axios';
import https from 'https';

async function test() {
    const url = "https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=20&pagina=1&q=%22SAO%20GONCALO%20DO%20AMARANTE%22";
    const agent = new https.Agent({ rejectUnauthorized: false });
    try {
        const res = await axios.get(url, { httpsAgent: agent, timeout: 10000 });
        const item = res.data.items[0];
        console.log("Found:", item.orgao_nome, item.ano, item.numero_sequencial, item.orgao_cnpj);
        
        const arquivosUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${item.orgao_cnpj}/compras/${item.ano}/${item.numero_sequencial}/arquivos`;
        console.log("Fetching files:", arquivosUrl);
        const arquivosRes = await axios.get(arquivosUrl, { httpsAgent: agent, timeout: 10000 });
        console.log("Files:", arquivosRes.data);
    } catch (e: any) {
        console.log("Error:", e.message);
    }
}
test();
