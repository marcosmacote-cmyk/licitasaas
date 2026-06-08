import axios from 'axios';

async function test() {
    try {
        const url = 'https://pncp.gov.br/api/consulta/v1/orgaos/00394460000141/compras/2022/224';
        const resp = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
            }
        });
        console.log('Dados do edital:', JSON.stringify(resp.data, null, 2));
    } catch (e: any) {
        console.error('Erro:', e.message);
        if (e.response) {
            console.error('Status:', e.response.status);
            console.error('Data:', JSON.stringify(e.response.data));
        }
    }
}

test();
