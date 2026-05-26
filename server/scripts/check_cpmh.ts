import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log('--- CHECKING CP-PMH03 AND CP-PMH02 ---');
    const comps = await prisma.engineeringComposition.findMany({
        where: {
            code: { in: ['CP-PMH03', 'CP-PMH02', 'CPMH03', 'CPMH02'] }
        },
        include: {
            database: true,
            items: {
                include: {
                    item: true,
                    auxiliaryComposition: true
                }
            }
        }
    });

    for (const comp of comps) {
        console.log(`\nComposition: ${comp.code}`);
        console.log(`- ID: ${comp.id}`);
        console.log(`- Description: ${comp.description}`);
        console.log(`- Unit: ${comp.unit}`);
        console.log(`- TotalPrice in DB: ${comp.totalPrice}`);
        console.log(`- Database Name: ${comp.database.name}`);
        console.log(`- Database Type: ${comp.database.type}`);
        
        console.log('Items:');
        for (const compItem of comp.items) {
            const item = compItem.item;
            const aux = compItem.auxiliaryComposition;
            if (item) {
                console.log(`  * Insumo Code: ${item.code} | Desc: ${item.description.substring(0, 45)} | Coeff: ${compItem.coefficient} | Price: ${compItem.price}`);
            } else if (aux) {
                console.log(`  * Aux Code: ${aux.code} | Desc: ${aux.description.substring(0, 45)} | Coeff: ${compItem.coefficient} | Price: ${compItem.price}`);
            } else {
                console.log(`  * Observation/Etapa Coeff: ${compItem.coefficient} | Price: ${compItem.price}`);
            }
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
