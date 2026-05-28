// Check SEINFRA composition prices for C0527 and C0537 in both regimes
const path = require('path');
const { PrismaClient } = require(path.join(__dirname, '..', 'server', 'node_modules', '@prisma', 'client'));
const prisma = new PrismaClient();

async function main() {
    // Find all SEINFRA databases
    const seinfraDBs = await prisma.engineeringDatabase.findMany({
        where: { name: 'SEINFRA', type: 'OFICIAL' },
        select: { id: true, name: true, uf: true, version: true, payrollExemption: true }
    });
    
    console.log('=== SEINFRA Databases ===');
    for (const db of seinfraDBs) {
        console.log(`  ${db.id} | ${db.name}/${db.uf} v${db.version} | desoneracao=${db.payrollExemption}`);
    }

    const codes = ['C0527', 'C0537'];
    
    for (const code of codes) {
        console.log(`\n=== Composição ${code} ===`);
        
        const comps = await prisma.engineeringComposition.findMany({
            where: { 
                code: { equals: code, mode: 'insensitive' },
                database: { name: 'SEINFRA', type: 'OFICIAL' }
            },
            include: { 
                database: { select: { id: true, payrollExemption: true, version: true } },
                items: {
                    include: { 
                        item: { select: { code: true, description: true, price: true, type: true } }
                    }
                }
            }
        });

        for (const comp of comps) {
            const regime = comp.database.payrollExemption ? 'DESONERADO' : 'ONERADO';
            console.log(`\n  [${regime}] dbId=${comp.database.id} v=${comp.database.version}`);
            console.log(`  Description: ${comp.description}`);
            console.log(`  totalPrice: R$ ${comp.totalPrice}`);
            console.log(`  unit: ${comp.unit}`);
            console.log(`  Items (${comp.items.length}):`);
            
            let calcTotal = 0;
            for (const ci of comp.items) {
                const itemPrice = ci.item?.price || 0;
                const subtotal = (ci.coefficient || 0) * itemPrice;
                calcTotal += subtotal;
                console.log(`    - ${ci.item?.code || 'N/A'} | ${ci.item?.description?.substring(0, 50)} | coef=${ci.coefficient} * price=${itemPrice} = ${subtotal.toFixed(4)} | type=${ci.type || ci.item?.type}`);
            }
            console.log(`  Calculated total: R$ ${calcTotal.toFixed(4)}`);
            console.log(`  Stored totalPrice: R$ ${comp.totalPrice}`);
            if (Math.abs(calcTotal - Number(comp.totalPrice)) > 0.1) {
                console.log(`  ⚠️ MISMATCH! Diff = R$ ${(Number(comp.totalPrice) - calcTotal).toFixed(4)}`);
            }
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
