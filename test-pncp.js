const axios = require('axios');
const https = require('https');

async function test() {
    let url = "https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=10&pagina=1&q=obras&status=recebendo_proposta&ufs=CE";
    const agent = new https.Agent({ rejectUnauthorized: false });

    try {
        const response = await axios.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: agent, timeout: 10000 });
        const data = response.data;
        const items = data.items || data.data || [];
        console.log("Items mapped");
        const now = Date.now();
        items.sort((a, b) => {
            const dateA = new Date(a.data_abertura).getTime();
            const dateB = new Date(b.data_abertura).getTime();
            return Math.abs(dateA - now) - Math.abs(dateB - now);
        });
        console.log("Sorted");
    } catch (e) {
        console.error("Error:", e.message);
    }
}
test();
