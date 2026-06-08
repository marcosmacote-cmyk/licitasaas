import prisma from '../lib/prisma';

async function checkJaguaruana() {
    console.log("=== JAGUARUANA DATABASE RECORD CHECK ===");
    const rows = await prisma.pncpContratacao.findMany({
        where: {
            orgaoNome: {
                contains: 'JAGUARUANA',
                mode: 'insensitive'
            }
        },
        select: {
            id: true,
            numeroControle: true,
            objeto: true,
            valorEstimado: true,
            linkSistema: true,
            linkOrigem: true,
            itens: {
                select: {
                    id: true,
                    descricao: true,
                    valorTotal: true
                }
            }
        }
    });

    console.log(`Encontrados ${rows.length} registros para Jaguaruana.`);
    for (const r of rows) {
        console.log(`\nControle: ${r.numeroControle}`);
        console.log(`Valor Estimado no DB: ${r.valorEstimado}`);
        console.log(`Link Sistema: ${r.linkSistema}`);
        console.log(`Link Origem: ${r.linkOrigem}`);
        console.log(`Itens no DB: ${r.itens.length}`);
        if (r.itens.length > 0) {
            console.log(`Soma dos itens no DB: ${r.itens.reduce((acc, it) => acc + (Number(it.valorTotal) || 0), 0)}`);
        }
    }
}

checkJaguaruana()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
