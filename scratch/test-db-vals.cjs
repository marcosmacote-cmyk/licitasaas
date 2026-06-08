const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
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
    } catch (err) {
        console.error("Database query error:", err.message);
    } finally {
        await prisma.$disconnect();
    }
}

run();
