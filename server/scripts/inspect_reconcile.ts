import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("=== INSPECTING COMPOSITIONS AND ITEMS ===");
    
    // Find all items with "EDITH" in the description
    const items = await prisma.engineeringProposalItem.findMany({
        where: {
            description: { contains: 'EDITH', mode: 'insensitive' }
        }
    });

    console.log(`Found ${items.length} proposal items matching "EDITH":`);
    for (const it of items) {
        console.log(`Item ID: ${it.id}`);
        console.log(`Code: ${it.code}`);
        console.log(`Description: ${it.description}`);
        console.log(`Unit Cost: ${it.unitCost} (type: ${typeof it.unitCost})`);
        console.log(`Unit Price: ${it.unitPrice}`);
        console.log(`Total Price: ${it.totalPrice}`);
        console.log(`compositionTotalPrice: ${it.compositionTotalPrice}`);
        console.log(`Proposal ID: ${it.proposalId}`);
        console.log('--------------------------------------------------');
    }

    if (items.length > 0) {
        const item = items[0];
        
        // Find composition
        const comps = await prisma.engineeringComposition.findMany({
            where: {
                code: { equals: item.code!, mode: 'insensitive' }
            },
            include: {
                database: true,
                items: {
                    include: {
                        item: true
                    }
                }
            }
        });

        console.log(`Found ${comps.length} compositions matching code "${item.code}":`);
        for (const comp of comps) {
            console.log(`Comp ID: ${comp.id}`);
            console.log(`Code: ${comp.code}`);
            console.log(`Description: ${comp.description}`);
            console.log(`Total Price: ${comp.totalPrice}`);
            console.log(`Database Type: ${comp.database?.type}`);
            console.log(`Database ID: ${comp.database?.id}`);
            console.log(`Metadata: ${comp.metadata}`);
            
            console.log(`Composition Items (total count: ${comp.items.length}):`);
            let sumSubtotals = 0;
            let sumItemPrices = 0;
            for (const ci of comp.items) {
                console.log(`  - Coefficient: ${ci.coefficient}`);
                console.log(`    ci.price (saved subtotal): ${ci.price}`);
                console.log(`    ci.item (insumo): ID=${ci.item?.id}, Code=${ci.item?.code}, Description=${ci.item?.description}, Price=${ci.item?.price}`);
                sumSubtotals += ci.price || 0;
                if (ci.item) {
                    sumItemPrices += (ci.item.price * ci.coefficient);
                }
            }
            console.log(`Sum of ci.price (subtotals): ${sumSubtotals}`);
            console.log(`Sum of (ci.item.price * coefficient): ${sumItemPrices}`);
            console.log('==================================================');
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
