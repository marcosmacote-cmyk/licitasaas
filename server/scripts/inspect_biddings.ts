import prisma from '../lib/prisma';

async function main() {
    const biddings = await prisma.biddingProcess.findMany({
        include: {
            aiAnalysis: true
        }
    });

    console.log(`Encontrados ${biddings.length} processos licitatórios.`);
    for (const b of biddings) {
        console.log(`-----------------------------------`);
        console.log(`ID: ${b.id}`);
        console.log(`Título: ${b.title}`);
        console.log(`Status: ${b.status}`);
        console.log(`Sub-fase: ${b.substage}`);
        console.log(`Tem Análise IA? ${!!b.aiAnalysis}`);
        if (b.aiAnalysis) {
            console.log(`  requiredDocuments:`, b.aiAnalysis.requiredDocuments);
            console.log(`  schemaV2 operational_outputs:`, JSON.stringify(b.aiAnalysis.schemaV2?.operational_outputs));
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
