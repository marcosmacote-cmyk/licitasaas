import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

let databaseId = "";

// Helper function to find a basic item by code
async function findItem(code: string): Promise<any> {
  // First try to find in the proposal database to respect overrides/new items
  let item = await prisma.engineeringItem.findFirst({
    where: { code, databaseId }
  });
  if (!item) {
    // Fallback to global databases
    item = await prisma.engineeringItem.findFirst({
      where: { code }
    });
  }
  if (!item) {
    throw new Error(`EngineeringItem with code ${code} not found`);
  }
  return item;
}

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
  databaseId = database.id;
  console.log(`Found Database: ID=${databaseId}`);

  // Step 1: Clean slate in the proposal database
  console.log("\n=== 1. Cleaning slate in proposal database ===");
  const deleteComps = await prisma.engineeringComposition.deleteMany({
    where: { databaseId }
  });
  console.log(`Deleted ${deleteComps.count} existing proposal compositions.`);

  // Mapping from global composition ID -> proposal-specific cloned composition ID
  const cloneMap = new Map<string, string>();

  // Helper to clone a composition recursively using its global ID
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

    // Ensure unique code in this databaseId to respect database constraints
    let code = globalComp.code;
    let suffix = 0;
    while (true) {
      const existing = await prisma.engineeringComposition.findFirst({
        where: { databaseId, code }
      });
      if (!existing) break;
      suffix++;
      code = `${globalComp.code}-${suffix}`;
    }

    const clone = await prisma.engineeringComposition.create({
      data: {
        databaseId,
        code,
        description: globalComp.description,
        unit: globalComp.unit,
        totalPrice: globalComp.totalPrice,
        metadata: {
          ...(globalComp.metadata as any || {}),
          originalId: globalCompId
        }
      }
    });

    cloneMap.set(globalCompId, clone.id);
    console.log(`🐑 Cloned Composition ${globalComp.code} (original ID: ${globalComp.id}) -> New ID: ${clone.id} (Code: ${code})`);

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

  // Step 2: Clone global principal compositions CPMH06, CPMH07 and CPMH03 from PROPRIA
  console.log("\n=== 2. Cloning known global PROPRIA compositions ===");
  const propreCodes = ["CPMH06", "CPMH07", "CPMH03"];
  for (const code of propreCodes) {
    const globalComp = await prisma.engineeringComposition.findFirst({
      where: { code, database: { name: "PROPRIA" } }
    });
    if (globalComp) {
      await cloneComposition(globalComp.id);
    } else {
      console.warn(`⚠️ Warning: Global CPMH composition ${code} not found in PROPRIA database`);
    }
  }

  // Step 2a: Update CPMH06 referenceDivisor in metadata
  console.log("\n=== 2a. Updating referenceDivisor in CPMH06 clone ===");
  const clonedCpmh06 = await prisma.engineeringComposition.findFirst({
    where: { code: "CPMH06", databaseId }
  });
  if (clonedCpmh06) {
    const currentMeta = (clonedCpmh06.metadata as any) || {};
    await prisma.engineeringComposition.update({
      where: { id: clonedCpmh06.id },
      data: {
        metadata: {
          ...currentMeta,
          referenceDivisor: { value: 12765.146208034575 }
        }
      }
    });
    console.log(`📌 Set CPMH06 referenceDivisor to 12765.146208034575 in metadata`);
  }

  // Step 3: Clone correct SINAPI auxiliaries for CPMH08
  console.log("\n=== 3. Cloning correct SINAPI auxiliaries ===");
  const sinapiIds = [
    "def9e88f-1825-43c8-bc7c-2e92c0c06eb7", // 93566 (price 4298.74)
    "57e54234-7a81-4880-8d15-92418c2a3092", // 101375 (price 4547.95)
    "dbc9cd02-4ccf-4ee8-a817-375912597dfd"  // 101399 (price 5367.86)
  ];
  for (const id of sinapiIds) {
    await cloneComposition(id);
  }

  // Step 4: Create/Update proposal-specific Items
  console.log("\n=== 4. Creating/Updating Unique Items ===");
  
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

  // Hourly periculosidade for eletricista (3.09)
  await getOrCreateItem(
    "INS-PMH01",
    "ADICIONAL DE PERICULOSIDADE DE 30% SOBRE O SALÁRIO-BASE (ELETRICISTA) - H",
    "H",
    3.09
  );

  // Hourly periculosidade for ajudante (2.43)
  const itemAjHourly = await getOrCreateItem(
    "INS-PMH01-H-AJ",
    "ADICIONAL DE PERICULOSIDADE DE 30% SOBRE O SALÁRIO-BASE (AJUDANTE) - H",
    "H",
    2.43
  );

  // Monthly periculosidade for eletricista (669.23)
  const itemElMonthly = await getOrCreateItem(
    "INS-PMH01-M-EL",
    "ADICIONAL DE PERICULOSIDADE DE 30% SOBRE O SALÁRIO-BASE (ELETRICISTA) - MÊS",
    "MÊS",
    669.23
  );

  // Monthly periculosidade for ajudante (526.78)
  const itemAjMonthly = await getOrCreateItem(
    "INS-PMH01-M-AJ",
    "ADICIONAL DE PERICULOSIDADE DE 30% SOBRE O SALÁRIO-BASE (AJUDANTE) - MÊS",
    "MÊS",
    526.78
  );

  // Step 5: Manually Recreate CPMH01 and CPMH02 in proposal DB
  console.log("\n=== 5. Recreating CPMH01 and CPMH02 ===");
  
  const cpmh01 = await prisma.engineeringComposition.create({
    data: {
      databaseId,
      code: "CPMH01",
      description: "ELETRICISTA COM ENCARGOS COMPLEMENTARES",
      unit: "H",
      totalPrice: 35.10
    }
  });
  console.log(`Recreated CPMH01 ID: ${cpmh01.id}`);

  const cpmh01Items = [
    { code: "2436", coef: 1.0, price: 21.86 },
    { code: "37370", coef: 1.0, price: 4.15 },
    { code: "37371", coef: 1.0, price: 1.09 },
    { code: "37372", coef: 1.0, price: 1.48 },
    { code: "37373", coef: 1.0, price: 0.11 },
    { code: "43460", coef: 1.0, price: 0.88 },
    { code: "43484", coef: 1.0, price: 1.41 },
    { code: "INS-PMH01", coef: 1.0, price: 3.09 },
    { code: "INS-PMH02", coef: 1.0, price: 1.03 }
  ];

  for (const it of cpmh01Items) {
    const item = await findItem(it.code);
    await prisma.engineeringCompositionItem.create({
      data: {
        compositionId: cpmh01.id,
        itemId: item.id,
        coefficient: it.coef,
        price: it.price
      }
    });
  }

  const cpmh02 = await prisma.engineeringComposition.create({
    data: {
      databaseId,
      code: "CPMH02",
      description: "AJUDANTE DE ELETRICISTA COM ENCARGOS COMPLEMENTARES",
      unit: "H",
      totalPrice: 28.75
    }
  });
  console.log(`Recreated CPMH02 ID: ${cpmh02.id}`);

  const cpmh02Items = [
    { code: "247", coef: 1.0, price: 17.20 },
    { code: "37370", coef: 1.0, price: 4.15 },
    { code: "37371", coef: 1.0, price: 1.09 },
    { code: "37372", coef: 1.0, price: 1.48 },
    { code: "37373", coef: 1.0, price: 0.11 },
    { code: "43460", coef: 1.0, price: 0.88 },
    { code: "43484", coef: 1.0, price: 1.41 },
    { code: "INS-PMH01-H-AJ", coef: 1.0, price: 2.43 }
  ];

  for (const it of cpmh02Items) {
    const item = await findItem(it.code);
    await prisma.engineeringCompositionItem.create({
      data: {
        compositionId: cpmh02.id,
        itemId: item.id,
        coefficient: it.coef,
        price: it.price
      }
    });
  }

  // Step 6: Recreate CPMH08 and CPMH09 directly in the proposal database
  console.log("\n=== 6. Recreating CPMH08 and CPMH09 ===");
  const itemI8973 = await findItem("I8973");
  const itemI8606 = await findItem("I8606");

  const cpmh08 = await prisma.engineeringComposition.create({
    data: {
      databaseId,
      code: "CPMH08",
      description: "SERVIÇO DE CADASTRAMENTO DO ACERVO DE ILUMINAÇÃO PÚBLICA MUNICIPAL, COM LEVANTAMENTO E ATUALIZAÇÃO DE INFORMAÇÕES GEORREFERENCIADAS DE TODOS OS PONTOS LUMINOSOS EM PLATAFORMA INTEGRADA AO SISTEMA DE GESTÃO DO PARQUE.",
      unit: "UN",
      totalPrice: 42191.50
    }
  });
  console.log(`Recreated CPMH08 ID: ${cpmh08.id}`);

  const clone93566Id = cloneMap.get("def9e88f-1825-43c8-bc7c-2e92c0c06eb7")!;
  const clone101375Id = cloneMap.get("57e54234-7a81-4880-8d15-92418c2a3092")!;
  const clone101399Id = cloneMap.get("dbc9cd02-4ccf-4ee8-a817-375912597dfd")!;

  const cpmh08Items = [
    { itemId: itemI8973.id, auxiliaryCompositionId: null, coefficient: 440.0, price: 268.40 },
    { itemId: itemI8606.id, auxiliaryCompositionId: null, coefficient: 2.0, price: 13491.96 },
    { itemId: null, auxiliaryCompositionId: clone93566Id, coefficient: 2.0, price: 8597.48 },
    { itemId: null, auxiliaryCompositionId: clone101375Id, coefficient: 2.0, price: 9095.90 },
    { itemId: null, auxiliaryCompositionId: clone101399Id, coefficient: 2.0, price: 10735.72 }
  ];

  for (const it of cpmh08Items) {
    await prisma.engineeringCompositionItem.create({
      data: {
        compositionId: cpmh08.id,
        itemId: it.itemId,
        auxiliaryCompositionId: it.auxiliaryCompositionId,
        coefficient: it.coefficient,
        price: it.price
      }
    });
  }

  const itemI7413 = await findItem("I7413");
  const itemG0698 = await findItem("G0698");
  const item157 = await findItem("157");

  const cpmh09 = await prisma.engineeringComposition.create({
    data: {
      databaseId,
      code: "CPMH09",
      description: "SERVIÇO DE EMPLAQUETAMENTO DE PONTOS LUMINOSOS",
      unit: "UN",
      totalPrice: 65.16
    }
  });
  console.log(`Recreated CPMH09 ID: ${cpmh09.id}`);

  const cloneCPMH03 = await prisma.engineeringComposition.findFirst({
    where: { code: "CPMH03", databaseId }
  });
  if (!cloneCPMH03) {
    throw new Error("Could not find cloned CPMH03 in proposal database");
  }

  const cpmh09Items = [
    { itemId: null, auxiliaryCompositionId: cpmh01.id, coefficient: 0.1666, price: 5.98 },
    { itemId: null, auxiliaryCompositionId: cpmh02.id, coefficient: 0.1666, price: 4.90 },
    { itemId: itemI7413.id, auxiliaryCompositionId: null, coefficient: 1.0, price: 8.08 },
    { itemId: itemG0698.id, auxiliaryCompositionId: null, coefficient: 0.002, price: 1.22 },
    { itemId: item157.id, auxiliaryCompositionId: null, coefficient: 0.015, price: 2.62 },
    { itemId: null, auxiliaryCompositionId: cloneCPMH03.id, coefficient: 0.1666, price: 42.36 }
  ];

  for (const it of cpmh09Items) {
    await prisma.engineeringCompositionItem.create({
      data: {
        compositionId: cpmh09.id,
        itemId: it.itemId,
        auxiliaryCompositionId: it.auxiliaryCompositionId,
        coefficient: it.coefficient,
        price: it.price
      }
    });
  }

  // Step 7: Update periculosidade items in the cloned monthly compositions (CPMH04, CPMH05)
  console.log("\n=== 7. Updating periculosidade in cloned CPMH04 and CPMH05 ===");
  const dbCpmh04 = await prisma.engineeringComposition.findFirst({
    where: { code: "CPMH04", databaseId }
  });
  if (dbCpmh04) {
    const compItem = await prisma.engineeringCompositionItem.findFirst({
      where: {
        compositionId: dbCpmh04.id,
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

  const dbCpmh05 = await prisma.engineeringComposition.findFirst({
    where: { code: "CPMH05", databaseId }
  });
  if (dbCpmh05) {
    const compItem = await prisma.engineeringCompositionItem.findFirst({
      where: {
        compositionId: dbCpmh05.id,
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

  // Step 8: Recalculate all unit costs and prices from bottom-to-top
  console.log("\n=== 8. Recalculating Composition Prices (Bottom-to-Top) ===");
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

  const mainCloned = await prisma.engineeringComposition.findMany({
    where: { databaseId, code: { in: ["CPMH06", "CPMH07", "CPMH08", "CPMH09"] } }
  });

  for (const c of mainCloned) {
    const finalPrice = await recalculateComposition(c.id);
    console.log(`✨ Recalculated Composition ${c.code}: New Total Price = R$ ${finalPrice.toFixed(4)}`);
  }

  // Step 9: Update proposal items unitCost
  console.log("\n=== 9. Updating Proposal Items unitCost ===");
  for (const c of mainCloned) {
    let divisor = 1;
    if (c.metadata) {
      const meta = (typeof c.metadata === 'string' ? JSON.parse(c.metadata) : c.metadata) as any;
      if (meta?.referenceDivisor?.value > 0) {
        divisor = Number(meta.referenceDivisor.value) || 1;
      }
    }
    const unitCost = visitedRecalc.get(c.id)! / divisor;

    const updateResult = await prisma.engineeringProposalItem.updateMany({
      where: { proposalId, code: c.code },
      data: { unitCost }
    });
    console.log(`📝 Updated ${updateResult.count} proposal items for code ${c.code} with unitCost = ${unitCost.toFixed(8)}`);
  }
}

main()
  .catch(err => console.error("❌ Execution failed:", err))
  .finally(() => prisma.$disconnect());
