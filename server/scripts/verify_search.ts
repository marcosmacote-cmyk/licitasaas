import { PncpSearchV3 } from '../services/pncp/pncp-search-v3.service';

async function main() {
    const result = await PncpSearchV3.search({
        status: 'recebendo_proposta',
        uf: 'PE',
        pagina: 1,
        tamanhoPagina: 10
    });
    console.log('FTS search success!');
    console.log('Total found:', result.total);
    console.log('Items returned:', result.items.length);
    if (result.items.length > 0) {
        console.log('First item title:', result.items[0].titulo);
        console.log('First item status:', result.items[0].status);
    }
}

main().catch(console.error);
