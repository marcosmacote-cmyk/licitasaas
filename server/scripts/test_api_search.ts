import axios from 'axios';
import https from 'https';

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const PNCP_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
};

async function testApiSearch() {
    console.log("=== SIMULANDO BUSCA HÍBRIDA OFICIAL ===");
    const url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=10&pagina=1&q=jaguaruana`;

    const resp = await axios.get(url, { httpsAgent: agent, headers: PNCP_HEADERS });
    const items = resp.data?.items || [];
    console.log(`Encontrados ${items.length} itens.`);

    for (const item of items) {
        const cnpj = item.orgao_cnpj || item.orgaoEntidade?.cnpj || item.cnpj || '';
        const ano = item.ano || item.anoCompra || '';
        const seq = item.numero_sequencial || item.sequencialCompra || item.numero_compra || '';
        const numControle = item.numero_controle_pncp || `${cnpj}-${ano}-${seq}`;
        const rawVal = item.valor_estimado ?? item.valor_global ?? item.valorTotalEstimado ?? item.valorTotalHomologado ?? item.valorEstimado ?? 0;
        
        console.log(`\n----------------------------------------`);
        console.log(`Controle: ${numControle}`);
        console.log(`Título: ${item.title || item.titulo}`);
        console.log(`Valor Bruto API Search: ${rawVal}`);
        console.log(`Link Sistema Origem: ${item.linkSistemaOrigem}`);

        // Try to fetch compra details
        const purchaseUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
        try {
            const detailResp = await axios.get(purchaseUrl, { httpsAgent: agent, headers: PNCP_HEADERS, timeout: 5000 });
            const detailVal = detailResp.data?.valorTotalEstimado ?? detailResp.data?.valorTotalHomologado ?? null;
            const lso = detailResp.data?.linkSistemaOrigem;
            console.log(`  -> Compra API valorTotalEstimado: ${detailVal}`);
            console.log(`  -> Compra API linkSistemaOrigem: ${lso}`);
        } catch (e: any) {
            console.log(`  -> Compra API falhou: ${e.message}`);
        }
    }
}

testApiSearch()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
