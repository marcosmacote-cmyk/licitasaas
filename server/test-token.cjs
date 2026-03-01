const jwt = require('jsonwebtoken');
const axios = require('axios');

const JWT_SECRET = 'licitasaas-secret-key-2026';

const payload = {
    userId: '123',
    tenantId: '123'
};

const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });

async function test() {
    try {
        const response = await axios.post('http://localhost:3001/api/pncp/search', {
            keywords: 'obras',
            status: 'recebendo_proposta',
            uf: 'CE',
            pagina: 1
        }, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        console.log("Status:", response.status);
        if (response.data && response.data.items) {
            console.log("Success! Items:", response.data.items.length);
        } else {
            console.dir(response.data);
        }
    } catch (e) {
        if (e.response) {
            console.error("HTTP Error:", e.response.status);
            console.error("Data:", e.response.data);
        } else {
            console.error("Request failed:", e.message);
        }
    }
}
test();
