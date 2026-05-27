import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  console.log("\n=== Scanning for Inconsistent Composition Items ===");
  const compItems = await prisma.engineeringCompositionItem.findMany({
    where: {
      composition: {
        database: {
          name: { startsWith: "PROPRIA" }
        }
      }
    },
    include: {
      composition: {
        include: { database: true }
      },
      item: true
    }
  });

  console.log(`Found ${compItems.length} total composition items in PROPRIA databases.`);
  let inconsistentCount = 0;
  for (const ci of compItems) {
    let unitPrice = 0;
    let description = '';
    let itemCode = '';
    
    if (ci.itemId && ci.item) {
      unitPrice = ci.item.price;
      description = ci.item.description;
      itemCode = ci.item.code;
    } else if (ci.auxiliaryCompositionId) {
      const aux = await prisma.engineeringComposition.findUnique({
        where: { id: ci.auxiliaryCompositionId }
      });
      if (aux) {
        unitPrice = aux.totalPrice;
        description = aux.description;
        itemCode = aux.code;
      }
    }
    
    const expectedSubtotal = ci.coefficient * unitPrice;
    const diff = Math.abs(ci.price - expectedSubtotal);
    
    // If the difference is significant (more than 0.05 BRL)
    if (diff > 0.05 && ci.coefficient > 0) {
      inconsistentCount++;
      console.log(`Inconsistency #${inconsistentCount}:`);
      console.log(`  Composition: ${ci.composition.code} (${ci.composition.description.substring(0, 50)})`);
      console.log(`  Database: ${ci.composition.database?.name}`);
      console.log(`  Item: Code=${itemCode}, Desc=${description.substring(0, 50)}`);
      console.log(`  Stored Coefficient: ${ci.coefficient}`);
      console.log(`  Stored Subtotal: R$ ${ci.price}`);
      console.log(`  Backing Item Unit Price: R$ ${unitPrice}`);
      console.log(`  Expected Subtotal: R$ ${expectedSubtotal} (Diff: R$ ${diff.toFixed(2)})`);
      console.log(`  Implied Unit Price: R$ ${(ci.price / ci.coefficient).toFixed(5)}`);
      console.log("--------------------------------------------------");
    }
  }
  console.log(`Scan complete. Found ${inconsistentCount} inconsistent items.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
