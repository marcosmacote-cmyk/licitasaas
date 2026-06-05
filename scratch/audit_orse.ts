import { prisma } from '../server/lib/prisma';

async function main() {
  console.log("=== ORSE Database Audit ===");
  const orseDbs = await prisma.engineeringDatabase.findMany({
    where: {
      name: {
        equals: 'ORSE',
        mode: 'insensitive'
      }
    },
    orderBy: [
      { referenceYear: 'desc' },
      { referenceMonth: 'desc' },
      { payrollExemption: 'asc' }
    ]
  });

  console.log(`Found ${orseDbs.length} ORSE database entries in the system.\n`);

  for (const db of orseDbs) {
    const actualItems = await prisma.engineeringItem.count({ where: { databaseId: db.id } });
    const actualCompositions = await prisma.engineeringComposition.count({ where: { databaseId: db.id } });
    
    // Group items by type
    const itemTypeCounts = await prisma.engineeringItem.groupBy({
      by: ['type'],
      where: { databaseId: db.id },
      _count: { id: true }
    });

    const typesBreakdown = itemTypeCounts.map(t => `${t.type}: ${t._count.id}`).join(', ');

    console.log(`Database: ${db.name} | UF: ${db.uf} | Version: ${db.version} | ${db.referenceYear}-${String(db.referenceMonth).padStart(2, '0')} | Exemption (Desonerado): ${db.payrollExemption}`);
    console.log(`  Expected counters: items=${db.itemCount}, compositions=${db.compositionCount}`);
    console.log(`  Actual count:      items=${actualItems} (${typesBreakdown || 'None'}), compositions=${actualCompositions}`);
    console.log(`--------------------------------------------------------------------------------`);
  }

  // 36 Months Check
  console.log("\n=== 36-Month Period Analysis ===");
  // Generate the last 36 months starting from June 2026 (local time is June 2026)
  const currentYear = 2026;
  const currentMonth = 6;
  const missingPeriods: string[] = [];
  const presentPeriods = new Set(orseDbs.map(db => `${db.referenceYear}-${db.referenceMonth}`));

  for (let i = 0; i < 36; i++) {
    let y = currentYear;
    let m = currentMonth - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    const key = `${y}-${m}`;
    const formatted = `${String(m).padStart(2, '0')}/${y}`;
    if (!presentPeriods.has(key)) {
      missingPeriods.push(formatted);
    }
  }

  console.log(`Total present months: ${presentPeriods.size}`);
  console.log(`Missing months out of last 36: ${missingPeriods.length}`);
  if (missingPeriods.length > 0) {
    console.log("Missing periods list:", missingPeriods.join(', '));
  } else {
    console.log("All last 36 months are present!");
  }

  // Check if we have Onerada and Desonerada versions
  console.log("\n=== Onerada vs Desonerada Check ===");
  const oneradaCount = orseDbs.filter(db => !db.payrollExemption).length;
  const desoneradaCount = orseDbs.filter(db => db.payrollExemption).length;
  console.log(`Onerada databases: ${oneradaCount}`);
  console.log(`Desonerada databases: ${desoneradaCount}`);

  const uniquePeriods = Array.from(new Set(orseDbs.map(db => `${db.referenceYear}-${db.referenceMonth}`)));
  const mismatchedExemptionPeriods: string[] = [];
  for (const p of uniquePeriods) {
    const [y, m] = p.split('-').map(Number);
    const dbsForPeriod = orseDbs.filter(db => db.referenceYear === y && db.referenceMonth === m);
    const hasOnerada = dbsForPeriod.some(db => !db.payrollExemption);
    const hasDesonerada = dbsForPeriod.some(db => db.payrollExemption);
    if (!hasOnerada || !hasDesonerada) {
      mismatchedExemptionPeriods.push(`${String(m).padStart(2, '0')}/${y} (Onerada: ${hasOnerada}, Desonerada: ${hasDesonerada})`);
    }
  }

  if (mismatchedExemptionPeriods.length > 0) {
    console.log(`Periods missing one of the versions:`, mismatchedExemptionPeriods.join(', '));
  } else {
    console.log(`All periods have both Onerada and Desonerada versions.`);
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
