import axios from 'axios';
import https from 'https';

async function test() {
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    // We'll test the top 5 results from "Estradas Vicinais"
    const items = [
        { orgao_cnpj: '07744303000168', ano: '2026', seq: '78', name: 'QUIXERAMOBIM' },
        { orgao_cnpj: '07413255000125', ano: '2026', seq: '14', name: 'JATI' },
        { orgao_cnpj: '07598618000144', ano: '2026', seq: '40', name: 'COREAU' },
        { orgao_cnpj: '07735178000120', ano: '2026', seq: '43', name: 'TIANGUA' },
        { orgao_cnpj: '12459616000104', ano: '2026', seq: '24', name: 'OCARA' }
    ];

    for (const item of items) {
        const url = `https://pncp.gov.br/api/pncp/v1/orgaos/${item.orgao_cnpj}/compras/${item.ano}/${item.seq}/arquivos`;
        try {
            const res = await axios.get(url, { httpsAgent: agent, timeout: 10000 });
            const data = res.data;
            console.log(`${item.name} (${item.orgao_cnpj}-${item.ano}-${item.seq}): HTTP 200, length=${Array.isArray(data) ? data.length : 'not array'}`);
        } catch (e: any) {
            console.log(`${item.name} (${item.orgao_cnpj}-${item.ano}-${item.seq}): ERROR ${e.message} ${e.response?.status}`);
        }
    }
}
test();
