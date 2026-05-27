import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function main() {
  const proposalId = "614215bf-a2f3-4bc8-8b15-c9ccaf21bac3";
  const dbName = `PROPRIA_${proposalId}`;

  console.log(`\n=== Locating Database ${dbName} ===`);
  const database = await prisma.engineeringDatabase.findFirst({
    where: { name: dbName }
  });

  if (!database) {
    console.error(`❌ Error: Database ${dbName} not found!`);
    return;
  }
  const databaseId = database.id;
  console.log(`Found Database: ID=${databaseId}`);

  // Step 1: Delete all existing compositions in the proposal database (Clean Slate)
  console.log("\n=== 1. Cleaning slate in proposal database ===");
  const deleteCount = await prisma.engineeringComposition.deleteMany({
    where: { databaseId }
  });
  console.log(`Deleted ${deleteCount.count} existing proposal-specific compositions.`);

  // Mapping from global composition ID -> proposal-specific cloned composition ID
  const cloneMap = new Map<string, string>();

  // Helper function to clone a composition recursively
  async function cloneComposition(globalCompId: string): Promise<string> {
    if (cloneMap.has(globalCompId)) {
      return cloneMap.get(globalCompId)!;
    }

    const globalComp = await prisma.engineeringComposition.findUnique({
      where: { id: globalCompId },
      include: { database: true }
    });

    if (!globalComp) {
      throw new Error(`Global composition ID=${globalCompId} not found`);
    }

    // Create the clone
    const clone = await prisma.engineeringComposition.create({
      data: {
        databaseId,
        code: globalComp.code,
        description: globalComp.description,
        unit: globalComp.unit,
        totalPrice: globalComp.totalPrice,
        metadata: globalComp.metadata || undefined
      }
    });

    cloneMap.set(globalCompId, clone.id);
    console.log(`🐑 Cloned Composition ${globalComp.code} (original ID: ${globalComp.id}) -> New ID: ${clone.id}`);

    // Clone its items
    const globalItems = await prisma.engineeringCompositionItem.findMany({
      where: { compositionId: globalCompId }
    });

    for (const git of globalItems) {
      let childItemId = git.itemId;
      let childAuxId = git.auxiliaryCompositionId;

      if (git.auxiliaryCompositionId) {
        childAuxId = await cloneComposition(git.auxiliaryCompositionId);
      }

      await prisma.engineeringCompositionItem.create({
        data: {
          compositionId: clone.id,
          itemId: childItemId,
          auxiliaryCompositionId: childAuxId,
          coefficient: git.coefficient,
          price: git.price,
          groupKey: git.groupKey,
          coefficientExpression: git.coefficientExpression
        }
      });
    }

    return clone.id;
  }

  // Step 2: Clone the four main compositions
  console.log("\n=== 2. Cloning Main Compositions ===");
  
  const mainCodes = [
    { code: "CPMH06" },
    { code: "CPMH07" },
    { code: "CPMH08" },
    { code: "CPMH09" }
  ];

  for (const m of mainCodes) {
    const globalComp = await prisma.engineeringComposition.findFirst({
      where: {
        code: m.code,
        database: { name: { in: ["PROPRIA", "SINAPI", "SEINFRA"] } }
      },
      orderBy: { database: { name: "desc" } } // prefers PROPRIA over others
    });

    if (!globalComp) {
      console.error(`❌ Could not find global composition for ${m.code}`);
      continue;
    }

    console.log(`Found global main comp ${m.code} in database ${globalComp.databaseId}`);
    await cloneComposition(globalComp.id);
  }

  // Step 3: Create unique items for periculosidade
  console.log("\n=== 3. Creating Unique Periculosidade Items ===");
  
  async function getOrCreateItem(code: string, description: string, unit: string, price: number) {
    let item = await prisma.engineeringItem.findFirst({
      where: { databaseId, code }
    });

    if (!item) {
      item = await prisma.engineeringItem.create({
        data: {
          databaseId,
          code,
          description,
          unit,
          price,
          type: "MATERIAL"
        }
      });
      console.log(`🆕 Created Item: Code=${code}, Price=${price}, Unit=${unit}, ID=${item.id}`);
    } else {
      if (Math.abs(item.price - price) > 0.01) {
        item = await prisma.engineeringItem.update({
          where: { id: item.id },
          data: { price }
        });
        console.log(`📝 Updated Item Price: Code=${code}, New Price=${price}`);
      } else {
        console.log(`✓ Item Already Exists: Code=${code}, Price=${item.price}, Unit=${item.unit}, ID=${item.id}`);
      }
    }
    return item;
  }

  const itemAjHourly = await getOrCreateItem(
    "INS-PMH01-H-AJ",
    "ADICIONAL DE PERICULOSIDADE DE 30% SOBRE O SALÁRIO-BASE (AJUDANTE) - H",
    "H",
    2.43
  );

  const itemElMonthly = await getOrCreateItem(
    "INS-PMH01-M-EL",
    "ADICIONAL DE PERICULOSIDADE DE 30% SOBRE O SALÁRIO-BASE (ELETRICISTA) - MÊS",
    "MÊS",
    669.23
  );

  const itemAjMonthly = await getOrCreateItem(
    "INS-PMH01-M-AJ",
    "ADICIONAL DE PERICULOSIDADE DE 30% SOBRE O SALÁRIO-BASE (AJUDANTE) - MÊS",
    "MÊS",
    526.78
  );

  // Step 4: Update periculosidade items in the cloned compositions
  console.log("\n=== 4. Updating Cloned Compositions' Items ===");

  // CPMH02 (Hourly Ajudante) -> point to INS-PMH01-H-AJ
  const cpmh02 = await prisma.engineeringComposition.findFirst({
    where: { code: "CPMH02", databaseId }
  });
  if (cpmh02) {
    const compItem = await prisma.engineeringCompositionItem.findFirst({
      where: {
        compositionId: cpmh02.id,
        item: { code: { in: ["INS-PMH01", "INS-PMH01-H-AJ"] } }
      }
    });
    if (compItem) {
      await prisma.engineeringCompositionItem.update({
        where: { id: compItem.id },
        data: {
          itemId: itemAjHourly.id,
          coefficient: 1.0,
          price: 2.43
        }
      });
      console.log(`✅ Updated CPMH02 in proposal DB to use INS-PMH01-H-AJ`);
    }
  }

  // CPMH04 (Monthly Eletricista) -> point to INS-PMH01-M-EL
  const cpmh04 = await prisma.engineeringComposition.findFirst({
    where: { code: "CPMH04", databaseId }
  });
  if (cpmh04) {
    const compItem = await prisma.engineeringCompositionItem.findFirst({
      where: {
        compositionId: cpmh04.id,
        item: { code: { in: ["INS-PMH01", "INS-PMH01-M-EL"] } }
      }
    });
    if (compItem) {
      await prisma.engineeringCompositionItem.update({
        where: { id: compItem.id },
        data: {
          itemId: itemElMonthly.id,
          coefficient: 1.0,
          price: 669.23
        }
      });
      console.log(`✅ Updated CPMH04 in proposal DB to use INS-PMH01-M-EL`);
    }
  }

  // CPMH05 (Monthly Ajudante) -> point to INS-PMH01-M-AJ
  const cpmh05 = await prisma.engineeringComposition.findFirst({
    where: { code: "CPMH05", databaseId }
  });
  if (cpmh05) {
    const compItem = await prisma.engineeringCompositionItem.findFirst({
      where: {
        compositionId: cpmh05.id,
        item: { code: { in: ["INS-PMH01", "INS-PMH01-M-AJ"] } }
      }
    });
    if (compItem) {
      await prisma.engineeringCompositionItem.update({
        where: { id: compItem.id },
        data: {
          itemId: itemAjMonthly.id,
          coefficient: 1.0,
          price: 526.78
        }
      });
      console.log(`✅ Updated CPMH05 in proposal DB to use INS-PMH01-M-AJ`);
    }
  }

  // Step 5: Fix Plaqueta I7413 in CPMH09 clone
  console.log("\n=== 5. Fixing Plaqueta I7413 in CPMH09 Clone ===");
  const cpmh09 = await prisma.engineeringComposition.findFirst({
    where: { code: "CPMH09", databaseId }
  });
  if (cpmh09) {
    const plaquetaItem = await prisma.engineeringCompositionItem.findFirst({
      where: {
        compositionId: cpmh09.id,
        item: { code: "I7413" }
      }
    });
    if (plaquetaItem) {
      await prisma.engineeringCompositionItem.update({
        where: { id: plaquetaItem.id },
        data: {
          coefficient: 1.0,
          price: 8.08
        }
      });
      console.log(`✅ Corrected Plaqueta I7413 coefficient to 1.0 and price to 8.08 in CPMH09`);
    }
  }

  // Step 6: Recalculate all unit costs and prices from bottom-to-top
  console.log("\n=== 6. Recalculating Composition Prices (Bottom-to-Top) ===");
  const visitedRecalc = new Map<string, number>();

  async function recalculateComposition(compId: string): Promise<number> {
    if (visitedRecalc.has(compId)) {
      return visitedRecalc.get(compId)!;
    }

    const compItems = await prisma.engineeringCompositionItem.findMany({
      where: { compositionId: compId },
      include: { item: true }
    });

    let totalPrice = 0;

    for (const ci of compItems) {
      let unitPrice = 0;
      if (ci.itemId && ci.item) {
        unitPrice = ci.item.price;
      } else if (ci.auxiliaryCompositionId) {
        unitPrice = await recalculateComposition(ci.auxiliaryCompositionId);
      }

      const itemPrice = unitPrice * ci.coefficient;
      totalPrice += itemPrice;

      // Update the composition item's price
      await prisma.engineeringCompositionItem.update({
        where: { id: ci.id },
        data: { price: itemPrice }
      });
    }

    // Update composition totalPrice
    await prisma.engineeringComposition.update({
      where: { id: compId },
      data: { totalPrice }
    });

    visitedRecalc.set(compId, totalPrice);
    return totalPrice;
  }

  // Recalculate the four main cloned compositions
  const mainCloned = await prisma.engineeringComposition.findMany({
    where: { databaseId, code: { in: ["CPMH06", "CPMH07", "CPMH08", "CPMH09"] } }
  });

  for (const c of mainCloned) {
    const finalPrice = await recalculateComposition(c.id);
    console.log(`✨ Recalculated Composition ${c.code}: New Total Price = R$ ${finalPrice.toFixed(4)}`);
  }

  // Step 7: Update proposal items unitCost to match the new recalculated composition prices
  console.log("\n=== 7. Updating Proposal Items unitCost ===");
  for (const c of mainCloned) {
    const updateResult = await prisma.engineeringProposalItem.updateMany({
      where: { proposalId, code: c.code },
      data: { unitCost: visitedRecalc.get(c.id)! }
    });
    console.log(`📝 Updated ${updateResult.count} proposal items for code ${c.code} with unitCost = ${visitedRecalc.get(c.id)!.toFixed(4)}`);
  }
}

main()
  .catch(err => console.error("❌ Execution failed:", err))
  .finally(() => prisma.$disconnect());
