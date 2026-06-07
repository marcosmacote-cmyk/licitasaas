import prisma from '../lib/prisma';
import { PncpHydrationService } from '../services/pncp/pncp-hydration.service';
import { PncpSearchV3 } from '../services/pncp/pncp-search-v3.service';

async function main() {
    console.log('--- 1. Limpando dados locais da FUERN para o teste ---');
    const deleteResult = await prisma.pncpContratacao.deleteMany({
        where: {
            cnpjOrgao: '08258295000102'
        }
    });
    console.log(`Contratações da FUERN removidas: ${deleteResult.count}`);

    console.log('\n--- 2. Executando hydrateSearch sob demanda para o CNPJ da FUERN ---');
    const totalSincronizados = await PncpHydrationService.hydrateSearch('08258295000102');
    console.log(`Total de contratações sincronizadas: ${totalSincronizados}`);

    console.log('\n--- 3. Verificando persistência no banco local ---');
    const totalNoBanco = await prisma.pncpContratacao.count({
        where: {
            cnpjOrgao: '08258295000102'
        }
    });
    console.log(`Total de contratações no banco local para FUERN: ${totalNoBanco}`);

    console.log('\n--- 4. Executando a busca simulada do usuário via PncpSearchV3 ---');
    // Simular a busca: Status = "encerrada", Órgão = FUERN (CNPJ), Período = 01/07/2025 a 31/12/2025
    const result = await PncpSearchV3.search({
        orgao: '08258295000102',
        status: 'encerrada',
        dataInicio: '2025-07-01',
        dataFim: '2025-12-31',
        pagina: 1,
        tamanhoPagina: 50
    });

    console.log(`Resultados da busca FTS local: ${result.total} itens encontrados.`);
    if (result.items.length > 0) {
        console.log('Primeiras amostragem de resultados encontrados:');
        result.items.slice(0, 5).forEach((it: any, idx: number) => {
            console.log(`- Item ${idx + 1}: Título=${it.titulo} | Modalidade=${it.modalidade_nome} | Data Encerramento/Abertura=${it.data_encerramento_proposta || it.data_abertura} | Status=${it.status}`);
        });
    } else {
        console.log('AVISO: Nenhum item retornado pela busca FTS local no período solicitado.');
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
