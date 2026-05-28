import { prisma } from '../server/lib/prisma.js';

async function main() {
    const codes = ['C1937', 'C0527', 'C0537', 'C2784', 'C2921'];
    
    console.log('--- BUSCANDO COMPOSIÇÕES ---');
    const comps = await prisma.engineeringComposition.findMany({
        where: { code: { in: codes } },
        include: {
            database: true
        }
    });

    for (const comp of comps) {
        console.log(`Comp: Code=${comp.code} | Desc=${comp.description.slice(0, 40)} | DB=${comp.database.name} | UF=${comp.database.uf} | Ver=${comp.database.version} | Exemption=${comp.database.payrollExemption} | Price=${comp.totalPrice}`);
    }

    console.log('\n--- BUSCANDO ITENS ---');
    const items = await prisma.engineeringItem.findMany({
        where: { code: { in: codes } },
        include: {
            database: true
        }
    });

    for (const item of items) {
        console.log(`Item: Code=${item.code} | Desc=${item.description.slice(0, 40)} | DB=${item.database.name} | UF=${item.database.uf} | Ver=${item.database.version} | Exemption=${item.database.payrollExemption} | Price=${item.price}`);
    }
}

main().catch(console.error);
