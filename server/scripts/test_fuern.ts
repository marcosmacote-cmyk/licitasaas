import prisma from '../lib/prisma';
import { PncpHydrationService } from '../services/pncp/pncp-hydration.service';
import axios from 'axios';
import https from 'https';

async function main() {
    const agent = new https.Agent({ rejectUnauthorized: false });

    // Test a direct search in Gov.br Elasticsearch for FUERN to see what is there
    const searchUrl = "https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=10&pagina=1&q=FUERN";
    try {
        const searchResp = await axios.get(searchUrl, { httpsAgent: agent } as any);
        const data = searchResp.data as any;
        console.log('Gov.br Elasticsearch hits for FUERN (overall):', data?.total || 0);
        if (data?.items?.length > 0) {
            console.log('Sample item from Search API for FUERN:', {
                title: data.items[0].title,
                orgao: data.items[0].orgao_nome,
                cnpj: data.items[0].orgao_cnpj,
                date: data.items[0].data_publicacao_pncp
            });
        }
    } catch (err: any) {
        console.log('Search API check failed:', err.message);
    }

    // Run hydration for the date range requested by the user
    console.log('\n--- Running Hydration for 2025-07-01 to 2025-12-31 ---');
    try {
        await PncpHydrationService.hydrate('2025-07-01', '2025-12-31');
    } catch (err: any) {
        console.error('Hydration failed:', err.message);
    }

    // Query local DB
    console.log('\n--- Querying Local Database ---');
    const localCount = await prisma.pncpContratacao.count({
        where: {
            orgaoNome: { contains: 'FUERN', mode: 'insensitive' }
        }
    });
    console.log('Total local items matching FUERN in DB:', localCount);

    const samples = await prisma.pncpContratacao.findMany({
        where: {
            orgaoNome: { contains: 'FUERN', mode: 'insensitive' }
        },
        take: 5,
        select: {
            numeroControle: true,
            orgaoNome: true,
            objeto: true,
            dataPublicacao: true,
            dataEncerramento: true,
            situacao: true
        }
    });
    console.log('Local samples:', JSON.stringify(samples, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
