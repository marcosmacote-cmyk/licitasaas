import axios from 'axios';
import https from 'https';

async function runInspect() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const url = "https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=1&pagina=1&q=obras";
    
    try {
        const response = await axios.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: agent, timeout: 15000 });
        const items = response.data?.items || [];
        if (items.length > 0) {
            console.log("Keys of a raw item:", Object.keys(items[0]));
            console.log("\nRaw item data:", JSON.stringify(items[0], null, 2));
        } else {
            console.log("No items returned");
        }
    } catch (e: any) {
        console.error("Error inspecting:", e.message);
    }
}

runInspect();
