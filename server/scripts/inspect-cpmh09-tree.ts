import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
  }
});

async function dumpComp(compId: string, depth = 0, parentCoef = 1) {
  const comp = await prisma.engineeringComposition.findUnique({
    where: { id: compId },
    include: {
      items: {
        include: {
          item: true
        }
      },
      database: true
    }
  });

  if (!comp) {
    console.log(" ".repeat(depth * 2) + `[Error: Comp ${compId} not found]`);
    return;
  }

  const meta = comp.metadata ? (typeof comp.metadata === 'string' ? JSON.parse(comp.metadata) : comp.metadata) as any : {};
  const divisor = Number(meta?.referenceDivisor?.value) || 1;

  console.log(" ".repeat(depth * 2) + `-> Comp: Code=${comp.code}, Name=${comp.description.substring(0, 60)}, Unit=${comp.unit}, Price=${comp.totalPrice}, Divisor=${divisor}, ParentCoef=${parentCoef}`);

  for (const ci of comp.items) {
    if (ci.item) {
      console.log(" ".repeat(depth * 2) + `  - Insumo: Code=${ci.item.code}, Desc=${ci.item.description.substring(0, 60)}, Unit=${ci.item.unit}, Price=${ci.item.price}, Coef=${ci.coefficient}, CalcQtyPerParentUnit=${ci.coefficient / divisor}`);
    } else if (ci.auxiliaryCompositionId) {
      console.log(" ".repeat(depth * 2) + `  - Aux: Coef=${ci.coefficient}, CalcQtyPerParentUnit=${ci.coefficient / divisor}`);
      await dumpComp(ci.auxiliaryCompositionId, depth + 1, ci.coefficient / divisor);
    } else {
      console.log(" ".repeat(depth * 2) + `  - [Empty item: id=${ci.id}]`);
    }
  }
}

async function main() {
  const proposalId = "614215bf-a2f3-4bc8-8b15-c9ccaf21bac3";
  const comp = await prisma.engineeringComposition.findFirst({
    where: { code: "CPMH09", database: { name: `PROPRIA_${proposalId}` } }
  });

  if (!comp) {
    console.log("Composition CPMH09 not found!");
    return;
  }

  await dumpComp(comp.id);
}

main()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
