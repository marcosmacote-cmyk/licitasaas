import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

// Helper functions copied from backend route logic
function normalizeInsumoType(type: string | null | undefined): string {
  if (!type) return 'MATERIAL';
  const t = type.toUpperCase();
  if (t === 'MÃO DE OBRA' || t === 'MAO_DE_OBRA' || t === 'MAO DE OBRA' || t === 'LABOR') return 'MAO_DE_OBRA';
  if (t === 'EQUIPAMENTO' || t === 'EQUIPMENT') return 'EQUIPAMENTO';
  if (t === 'SERVICO' || t === 'SERVIÇO' || t === 'SERVICE') return 'SERVICO';
  return 'MATERIAL';
}

function buildCompositionCodeVariants(code: string, sourceName?: string): string[] {
  const clean = code.trim();
  const variants = [clean];
  const upper = clean.toUpperCase();
  if (upper !== clean) variants.push(upper);
  
  if (sourceName === 'SEINFRA') {
    // Add variations for SEINFRA (e.g. padding/unpadding)
    if (/^[C]\d+$/i.test(clean)) {
      const num = clean.substring(1);
      const padded = 'C' + num.padStart(4, '0');
      if (!variants.includes(padded)) variants.push(padded);
    }
  }
  return variants;
}

async function findBestAnalyticalComposition(variants: string[], databaseId?: string, sourceName?: string, tenantId?: string, proposalId?: string) {
  const targetDbName = proposalId ? `PROPRIA_${proposalId}` : 'PROPRIA';
  const propriaWhere: any = { name: targetDbName };
  if (tenantId) propriaWhere.tenantId = tenantId;

  // 1. Try proposal-specific PROPRIA
  let comp = await prisma.engineeringComposition.findFirst({
    where: { code: { in: variants }, database: propriaWhere },
    include: {
      database: true,
      items: {
        include: {
          item: { include: { database: true } }
        }
      }
    }
  });

  // 2. Try global PROPRIA as fallback
  if (!comp && proposalId) {
    const globalPropriaWhere: any = { name: 'PROPRIA' };
    if (tenantId) globalPropriaWhere.tenantId = tenantId;
    comp = await prisma.engineeringComposition.findFirst({
      where: { code: { in: variants }, database: globalPropriaWhere },
      include: {
        database: true,
        items: {
          include: {
            item: { include: { database: true } }
          }
        }
      }
    });
  }

  // 3. Try official database matching sourceName
  if (!comp && sourceName && sourceName !== 'PROPRIA') {
    comp = await prisma.engineeringComposition.findFirst({
      where: { code: { in: variants }, database: { name: sourceName } },
      include: {
        database: true,
        items: {
          include: {
            item: { include: { database: true } }
          }
        }
      }
    });
  }

  // 4. Try any matching database
  if (!comp) {
    comp = await prisma.engineeringComposition.findFirst({
      where: { code: { in: variants } },
      include: {
        database: true,
        items: {
          include: {
            item: { include: { database: true } }
          }
        }
      }
    });
  }

  return comp;
}

async function simulate() {
  const proposalId = "614215bf-a2f3-4bc8-8b15-c9ccaf21bac3";
  const tenantId = "814215bf-a2f3-4bc8-8b15-c9ccaf21bac3"; // from earlier context

  const proposalItems = await prisma.engineeringProposalItem.findMany({
    where: { proposalId },
    orderBy: { sortOrder: 'asc' }
  });

  console.log(`Loaded ${proposalItems.length} proposal items.`);

  const consolidated = new Map<string, {
    codigo: string;
    precoOriginal: number;
    coeficienteTotal: number;
    custoTotal: number;
  }>();

  let compositionsFound = 0;

  for (const clientItem of proposalItems) {
    if (clientItem.type === 'ETAPA' || clientItem.type === 'SUBETAPA') continue;
    const code = (clientItem.code || '').trim();
    if (!code || code === 'N/A') continue;

    const codeVariants = buildCompositionCodeVariants(code, clientItem.sourceName);
    const composition = await findBestAnalyticalComposition(codeVariants, undefined, clientItem.sourceName, undefined, proposalId);

    if (!composition) {
      console.log(`⚠️ Composition not found for: ${code}`);
      continue;
    }

    compositionsFound++;
    const serviceQty = Number(clientItem.quantity) || 1;
    const baseName = composition.database?.name || clientItem.sourceName || 'PROPRIA';

    const meta = composition.metadata ? (typeof composition.metadata === 'string' ? JSON.parse(composition.metadata) : composition.metadata) as any : {};
    const divisor = Number(meta?.referenceDivisor?.value) || 1;
    const effectiveServiceQty = serviceQty / divisor;

    let compositionSimulatedUnitCost = 0;

    const addInsumo = (insumoCode: string, insumo: any, coef: number, overridePrice?: number) => {
      const insumoKey = insumoCode.toUpperCase();
      const existing = consolidated.get(insumoKey);
      const weightedCoef = coef * effectiveServiceQty;
      const priceToUse = overridePrice !== undefined ? overridePrice : insumo.price;

      compositionSimulatedUnitCost += (coef / divisor) * priceToUse;

      if (existing) {
        existing.coeficienteTotal += weightedCoef;
        existing.custoTotal += priceToUse * weightedCoef;
        existing.precoOriginal = existing.custoTotal / existing.coeficienteTotal;
      } else {
        consolidated.set(insumoKey, {
          codigo: insumo.code,
          precoOriginal: priceToUse,
          coeficienteTotal: weightedCoef,
          custoTotal: priceToUse * weightedCoef
        });
      }
    };

    const isPropriaDb = baseName === 'PROPRIA' || baseName.startsWith('PROPRIA_');

    for (const ci of composition.items) {
      if (ci.item) {
        let unitPrice = ci.item.price;
        if (isPropriaDb && ci.price !== undefined && ci.coefficient > 0) {
          unitPrice = ci.price / ci.coefficient;
        }
        addInsumo(ci.item.code, ci.item, ci.coefficient, unitPrice);
      } else if (ci.auxiliaryCompositionId) {
        const visitedAux = new Set<string>();
        const resolveAuxiliary = async (auxId: string, parentCoef: number) => {
          if (visitedAux.has(auxId)) return;
          visitedAux.add(auxId);

          const auxComp = await prisma.engineeringComposition.findUnique({
            where: { id: auxId },
            include: { items: { include: { item: true } }, database: true },
          });
          if (!auxComp) return;

          const auxDbName = auxComp.database?.name || '';
          const isAuxPropriaDb = auxDbName === 'PROPRIA' || auxDbName.startsWith('PROPRIA_');

          const auxMeta = auxComp.metadata ? (typeof auxComp.metadata === 'string' ? JSON.parse(auxComp.metadata) : auxComp.metadata) as any : {};
          const auxDivisor = Number(auxMeta?.referenceDivisor?.value) || 1;
          const effectiveParentCoef = parentCoef / auxDivisor;

          for (const auxCi of auxComp.items) {
            if (auxCi.item) {
              let unitPrice = auxCi.item.price;
              if (isAuxPropriaDb && auxCi.price !== undefined && auxCi.coefficient > 0) {
                unitPrice = auxCi.price / auxCi.coefficient;
              }
              addInsumo(auxCi.item.code, auxCi.item, auxCi.coefficient * effectiveParentCoef, unitPrice);
            } else if (auxCi.auxiliaryCompositionId) {
              await resolveAuxiliary(auxCi.auxiliaryCompositionId, auxCi.coefficient * effectiveParentCoef);
            }
          }
        };
        await resolveAuxiliary(ci.auxiliaryCompositionId, ci.coefficient);
      }
    }

    const itemBudgetUnitCost = Number(clientItem.unitCost);
    const itemDiff = Math.abs(compositionSimulatedUnitCost - itemBudgetUnitCost);
    if (itemDiff > 0.01) {
      console.log(`❌ DISCREPANCY in Item ${clientItem.code} (${clientItem.description.substring(0, 40)}):`);
      console.log(`   Budget Unit Cost:      R$ ${itemBudgetUnitCost.toFixed(4)}`);
      console.log(`   Simulated Unit Cost:   R$ ${compositionSimulatedUnitCost.toFixed(4)}`);
      console.log(`   Diff per unit:         R$ ${itemDiff.toFixed(4)}`);
      console.log(`   Total Diff for item:   R$ ${(itemDiff * serviceQty).toFixed(4)}`);
    } else {
      console.log(`✓ Item ${clientItem.code} matches perfectly.`);
    }
  }

  console.log(`\n=== Simulated Hub Insumos Results ===`);
  let totalCusto = 0;
  const insumos = Array.from(consolidated.values());
  
  // Sort insumos by custoTotal descending
  insumos.sort((a, b) => b.custoTotal - a.custoTotal);
  
  console.log("Top 10 Simulated Insumos by Cost:");
  for (let i = 0; i < Math.min(10, insumos.length); i++) {
    const ins = insumos[i];
    console.log(`- Code: ${ins.codigo}, Price: R$ ${ins.precoOriginal.toFixed(2)}, Coef: ${ins.coeficienteTotal.toFixed(4)}, Total Cost: R$ ${ins.custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  }

  for (const ins of insumos) {
    totalCusto += ins.custoTotal;
  }

  console.log(`Total Insumos Cost (Simulated): R$ ${totalCusto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  
  // Calculate budget total without BDI
  let budgetTotal = 0;
  for (const it of proposalItems) {
    if (it.type !== 'ETAPA' && it.type !== 'SUBETAPA') {
      budgetTotal += it.quantity * it.unitCost;
    }
  }
  console.log(`Total Budget Cost without BDI:  R$ ${budgetTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  
  const diff = Math.abs(totalCusto - budgetTotal);
  console.log(`Absolute Difference:             R$ ${diff.toFixed(4)}`);
  
  if (diff < 1.0) {
    console.log("🟢 SUCCESS: The totals match within R$ 1.00 rounding margins!");
  } else {
    console.log("❌ ERROR: Large discrepancy detected!");
  }
}

simulate()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
