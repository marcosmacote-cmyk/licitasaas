import { prisma } from '../server/lib/prisma.js';

async function run() {
    try {
        console.log("prisma instance exists:", !!prisma);
        if (!prisma) {
            console.log("prisma is undefined, let's see what keys are in module");
            const mod = await import('../server/lib/prisma.js');
            console.log("Module keys:", Object.keys(mod));
            return;
        }
        const total = await prisma.pncpContratacao.count();
        const nullVal = await prisma.pncpContratacao.count({
            where: {
                OR: [
                    { valorEstimado: null },
                    { valorEstimado: 0 }
                ]
            }
        });
        console.log(`Total records: ${total}`);
        console.log(`Records with null or zero valorEstimado: ${nullVal}`);

        // Fetch first 5 records with null/zero value
        const sample = await prisma.pncpContratacao.findMany({
            where: {
                OR: [
                    { valorEstimado: null },
                    { valorEstimado: 0 }
                ]
            },
            take: 5,
            select: {
                id: true,
                numeroControle: true,
                cnpjOrgao: true,
                anoCompra: true,
                sequencialCompra: true,
                objeto: true,
                valorEstimado: true,
                itens: {
                    select: {
                        valorTotal: true
                    }
                }
            }
        });

        console.log("Samples with null/zero valorEstimado:");
        for (const item of sample) {
            const sum = item.itens.reduce((acc, it) => acc + (it.valorTotal || 0), 0);
            console.log(`- ID: ${item.numeroControle}, Objeto: ${item.objeto?.substring(0, 60)}..., DB Value: ${item.valorEstimado}, Sum of items: ${sum}`);
        }
    } catch (err: any) {
        console.error("Database query error:", err.message);
    } finally {
        if (prisma) await prisma.$disconnect();
    }
}

run();
