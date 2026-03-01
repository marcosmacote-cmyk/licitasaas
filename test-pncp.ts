import axios from 'axios';
import https from 'https';

async function test() {
    let url = "https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=10&pagina=1&q=obras&status=recebendo_proposta&ufs=CE";
    const agent = new https.Agent({ rejectUnauthorized: false });

    try {
        const response = await axios.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: agent, timeout: 10000 });
        const data = response.data;
        const mappedItems = (data.items || data.data || []).map((item) => ({
            id: item.id || item.numeroControlePNCP || Math.random().toString(),
            data_abertura: item.data_fim_vigencia || item.data_inicio_vigencia || item.dataAberturaProposta || item.data_abertura || item.dataPublicacaoPncp || new Date().toISOString(),
        }));

        console.log("Mapped format length:", mappedItems.length);

        const now = Date.now();
        mappedItems.sort((a, b) => {
            const dateA = new Date(a.data_abertura).getTime();
            const dateB = new Date(b.data_abertura).getTime();
            return Math.abs(dateA - now) - Math.abs(dateB - now);
        });
        console.log("Sort succeeded.", mappedItems.length, "items.");
    } catch (e) {
        console.log("String(e):", String(e));
        console.error("Error:", e.message);
    }
}
test();
