import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function run() {
    console.log('Fetching logs with missing valorEstimado...');
    const logs = await prisma.opportunityScannerLog.findMany({
        where: { valorEstimado: null },
        take: 200,
        orderBy: { createdAt: 'desc' }
    });

    console.log(`Found ${logs.length} logs to update.`);

    for (const log of logs) {
        if (!log.orgaoCnpj || !log.anoCompra || !log.sequencialCompra) continue;
        
        try {
            const url = `https://pncp.gov.br/api/pncp/v1/orgaos/${log.orgaoCnpj}/compras/${log.anoCompra}/${log.sequencialCompra}/itens?pagina=1&tamanhoPagina=100`;
            const resp = await axios.get(url, { timeout: 5000 });
            const items = resp.data?.data || resp.data?.items || resp.data || [];
            
            if (Array.isArray(items) && items.length > 0) {
                const computedValue = items.reduce((acc: number, it: any) => {
                    return acc + (Number(it.valorTotal) || ((Number(it.quantidade) || 0) * (Number(it.valorUnitarioEstimado || it.valorUnitarioHomologado) || 0)) || 0);
                }, 0);

                if (computedValue > 0) {
                    await prisma.opportunityScannerLog.update({
                        where: { id: log.id },
                        data: { valorEstimado: computedValue }
                    });
                    console.log(`Updated ${log.pncpId} -> R$ ${computedValue}`);
                }
            }
        } catch (err: any) {
            console.log(`Failed for ${log.pncpId}: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 200));
    }
    console.log('Done');
}

run().catch(console.error).finally(() => prisma.$disconnect());
