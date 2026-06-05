import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

async function audit() {
  console.log("==================================================");
  console.log("             AUDITING SICRO BASES                ");
  console.log("==================================================");
  try {
    const databases = await prisma.engineeringDatabase.findMany({
      where: { name: 'SICRO' },
      orderBy: [
        { uf: 'asc' },
        { referenceYear: 'desc' },
        { referenceMonth: 'desc' },
        { payrollExemption: 'asc' }
      ]
    });

    console.log(`\nFound ${databases.length} SICRO database record(s) in total.`);

    if (databases.length === 0) {
      console.log("No SICRO databases found in the database.");
      return;
    }

    // Print databases
    console.log("\n--- List of SICRO Databases ---");
    for (const db of databases) {
      console.log(`- ID: ${db.id} | UF: ${db.uf} | Period: ${String(db.referenceMonth).padStart(2, '0')}/${db.referenceYear} | Regime: ${db.payrollExemption ? 'Desonerada' : 'Onerada'} | Items: ${db.itemCount} | Comps: ${db.compositionCount}`);
      
      // Let's count items by type
      const itemsGroup = await prisma.engineeringItem.groupBy({
        by: ['type'],
        where: { databaseId: db.id },
        _count: { id: true }
      });
      console.log(`  Items by type:`, itemsGroup.map(g => `${g.type}: ${g._count.id}`).join(', '));

      // Let's check sample items (insumos)
      const sampleItems = await prisma.engineeringItem.findMany({
        where: { databaseId: db.id },
        take: 3
      });
      if (sampleItems.length > 0) {
        console.log(`  Sample Items:`, sampleItems.map(i => ({ code: i.code, desc: i.description.substring(0, 30), type: i.type, price: i.price })));
      }

      // Let's check sample compositions
      const sampleComps = await prisma.engineeringComposition.findMany({
        where: { databaseId: db.id },
        take: 3
      });
      if (sampleComps.length > 0) {
        console.log(`  Sample Comps:`, sampleComps.map(c => ({ code: c.code, desc: c.description.substring(0, 30), price: c.totalPrice })));
      }

      // Let's check if there are composition items (breakdown/coefs)
      const compIds = await prisma.engineeringComposition.findMany({
        where: { databaseId: db.id },
        select: { id: true },
        take: 50
      });
      
      const compItemCount = await prisma.engineeringCompositionItem.count({
        where: {
          compositionId: { in: compIds.map(c => c.id) }
        }
      });
      console.log(`  Composition Items (sample check for first 50 comps): ${compItemCount} sub-items found`);
      console.log("--------------------------------------------------");
    }

    // Let's check if there are any duplicate databases
    console.log("\n--- Integrity & Version Analysis ---");
    const summary = await prisma.engineeringDatabase.groupBy({
      by: ['uf', 'referenceMonth', 'referenceYear'],
      where: { name: 'SICRO' },
      _count: { id: true }
    });

    console.log(`Unique periods/UFs with SICRO data: ${summary.length}`);
    for (const s of summary) {
      if (s._count.id > 1) {
        console.log(`⚠️ Warning: Duplicate SICRO databases for UF ${s.uf} at ${s.referenceMonth}/${s.referenceYear} (Count: ${s._count.id})`);
      }
    }

    // Check regime division
    const oneradas = databases.filter(db => !db.payrollExemption).length;
    const desoneradas = databases.filter(db => db.payrollExemption).length;
    console.log(`\nOneradas (payrollExemption=false): ${oneradas}`);
    console.log(`Desoneradas (payrollExemption=true): ${desoneradas}`);

  } catch (error) {
    console.error("Error auditing SICRO database:", error);
  } finally {
    await prisma.$disconnect();
  }
}

audit();
