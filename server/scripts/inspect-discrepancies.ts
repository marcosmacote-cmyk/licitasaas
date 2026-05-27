import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const proposalId = "614215bf-a2f3-4bc8-8b15-c9ccaf21bac3";
  const dbName = `PROPRIA_${proposalId}`;
  
  const db = await prisma.engineeringDatabase.findFirst({ where: { name: dbName } });
  if (!db) {
    console.error("Database not found");
    return;
  }
  const databaseId = db.id;

  const codes = ["CPMH07", "CPMH08", "CPMH09"];

  for (const code of codes) {
    const comp = await prisma.engineeringComposition.findFirst({
      where: { code, databaseId },
      include: {
        items: {
          include: {
            item: true
          }
        }
      }
    });

    if (!comp) {
      console.log(`\n❌ Composition ${code} not found in DB ${dbName}`);
      continue;
    }

    console.log(`\n======================================`);
    console.log(`Composition: ${comp.code} - ${comp.description}`);
    console.log(`Saved TotalPrice in DB: R$ ${comp.totalPrice}`);
    
    let calculatedSum = 0;
    for (const ci of comp.items) {
      if (ci.itemId && ci.item) {
        const unitPrice = ci.coefficient > 0 ? (ci.price / ci.coefficient) : 0;
        const lineCost = ci.price;
        calculatedSum += lineCost;
        console.log(`  - ITEM: ${ci.item.code} (${ci.item.description.substring(0, 30)}) | Coef: ${ci.coefficient} | Saved Price: R$ ${ci.price} | Derived UnitPrice: R$ ${unitPrice} | Line Cost: R$ ${lineCost}`);
      } else if (ci.auxiliaryCompositionId) {
        const aux = await prisma.engineeringComposition.findUnique({
          where: { id: ci.auxiliaryCompositionId },
          include: {
            items: {
              include: {
                item: true
              }
            }
          }
        });

        if (!aux) {
          console.log(`  - AUX COMP ID ${ci.auxiliaryCompositionId} NOT FOUND`);
          continue;
        }

        let auxSum = 0;
        console.log(`  - AUX COMP: ${aux.code} (${aux.description.substring(0, 30)}) | Coef: ${ci.coefficient} | Saved Price: R$ ${ci.price}`);
        for (const aci of aux.items) {
          if (aci.item) {
            const auxUnitPrice = aci.coefficient > 0 ? (aci.price / aci.coefficient) : 0;
            auxSum += aci.price;
            console.log(`      * ITEM: ${aci.item.code} (${aci.item.description.substring(0, 30)}) | Coef: ${aci.coefficient} | Saved Price: R$ ${aci.price} | Derived UnitPrice: R$ ${auxUnitPrice}`);
          }
        }
        const contribution = auxSum * ci.coefficient;
        console.log(`      * Auxiliary Calculated Sum: R$ ${auxSum} | Multiplied by Coef: R$ ${contribution}`);
        calculatedSum += contribution;
      }
    }
    console.log(`Calculated Sum: R$ ${calculatedSum}`);
  }
}

main().finally(() => prisma.$disconnect());
