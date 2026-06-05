import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function audit() {
  console.log("=== Auditing CAERN Databases ===");
  try {
    const databases = await prisma.engineeringDatabase.findMany({
      where: { name: 'CAERN' },
      orderBy: [
        { referenceYear: 'desc' },
        { referenceMonth: 'desc' }
      ]
    });
    
    console.log(`Found ${databases.length} CAERN database(s):`);
    for (const db of databases) {
      console.log(`- ID: ${db.id}`);
      console.log(`  Version/Name: ${db.version}`);
      console.log(`  UF: ${db.uf}`);
      console.log(`  Date base: ${db.referenceMonth}/${db.referenceYear}`);
      console.log(`  Item Count (Insumos/Materials): ${db.itemCount}`);
      console.log(`  Composition Count: ${db.compositionCount}`);
      console.log(`  Type: ${db.type}`);
      console.log(`  Created At: ${db.createdAt}`);
      
      // Check sample items
      const sampleItems = await prisma.engineeringItem.findMany({
        where: { databaseId: db.id },
        take: 3
      });
      console.log(`  Sample Items (${sampleItems.length}):`, sampleItems.map(i => ({ code: i.code, desc: i.description.substring(0, 40), unit: i.unit, price: i.price, type: i.type })));
      
      // Check sample compositions
      const sampleComps = await prisma.engineeringComposition.findMany({
        where: { databaseId: db.id },
        take: 3
      });
      console.log(`  Sample Comps (${sampleComps.length}):`, sampleComps.map(c => ({ code: c.code, desc: c.description.substring(0, 40), unit: c.unit, price: c.totalPrice })));
      console.log("---------------------------------------");
    }
  } catch (error) {
    console.error("Error auditing CAERN:", error);
  } finally {
    await prisma.$disconnect();
  }
}

audit();
