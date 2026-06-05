import 'dotenv/config';
import { prisma } from '../lib/prisma';

async function main() {
  console.log("==================================================");
  console.log("    RECLASSIFYING SICRO DATABASES (BATCH MODE)    ");
  console.log("==================================================");
  
  const databases = await prisma.engineeringDatabase.findMany({
    where: { name: 'SICRO' },
    orderBy: [
      { uf: 'asc' },
      { referenceYear: 'desc' },
      { referenceMonth: 'desc' },
      { payrollExemption: 'asc' }
    ]
  });
  
  console.log(`Found ${databases.length} SICRO database(s) in total.`);
  
  let totalMoved = 0;
  
  for (const db of databases) {
    console.log(`\nProcessing: DB=${db.id} | UF=${db.uf} | Period=${String(db.referenceMonth).padStart(2, '0')}/${db.referenceYear} | Regime=${db.payrollExemption ? 'Desonerada' : 'Onerada'}`);
    
    // Find all compositions in this DB whose code starts with M, E, P, or A
    const compsToMove = await prisma.engineeringComposition.findMany({
      where: {
        databaseId: db.id,
        OR: [
          { code: { startsWith: 'M', mode: 'insensitive' } },
          { code: { startsWith: 'E', mode: 'insensitive' } },
          { code: { startsWith: 'P', mode: 'insensitive' } },
          { code: { startsWith: 'A', mode: 'insensitive' } }
        ]
      }
    });
    
    if (compsToMove.length === 0) {
      console.log("  No misclassified items found in this database. Skipping.");
      continue;
    }
    
    console.log(`  Found ${compsToMove.length} items to move to inputs.`);
    
    // Build items to insert
    const itemsToInsert = compsToMove.map(comp => {
      const firstChar = comp.code.charAt(0).toUpperCase();
      let itemType = 'MATERIAL';
      if (firstChar === 'P') itemType = 'MAO_DE_OBRA';
      else if (firstChar === 'E') itemType = 'EQUIPAMENTO';
      
      return {
        databaseId: db.id,
        code: comp.code,
        description: comp.description,
        unit: comp.unit,
        price: comp.totalPrice,
        type: itemType
      };
    });
    
    try {
      // Set transaction timeout to 60000ms (60 seconds) to handle large batch sizes over public internet proxy
      await prisma.$transaction(async (tx) => {
        // Insert items in batch (skip duplicates to be safe)
        const inserted = await tx.engineeringItem.createMany({
          data: itemsToInsert,
          skipDuplicates: true
        });
        
        // Delete original compositions in batch
        const deleted = await tx.engineeringComposition.deleteMany({
          where: {
            id: { in: compsToMove.map(c => c.id) }
          }
        });
        
        console.log(`  Successfully inserted ${inserted.count} items and deleted ${deleted.count} compositions.`);
        totalMoved += deleted.count;
      }, { timeout: 60000 });
    } catch (err: any) {
      console.error(`  [Error] Failed to execute batch reclassification: ${err.message}`);
    }
    
    // Recalculate and update counts
    const finalItemCount = await prisma.engineeringItem.count({ where: { databaseId: db.id } });
    const finalCompositionCount = await prisma.engineeringComposition.count({ where: { databaseId: db.id } });
    
    await prisma.engineeringDatabase.update({
      where: { id: db.id },
      data: {
        itemCount: finalItemCount,
        compositionCount: finalCompositionCount
      }
    });
    
    console.log(`  Updated Stats: itemCount=${finalItemCount}, compositionCount=${finalCompositionCount}`);
  }
  
  console.log(`\n==================================================`);
  console.log(`RECLASSIFICATION COMPLETE. Total items moved: ${totalMoved}`);
  console.log("==================================================");
}

main().catch(console.error).finally(() => prisma.$disconnect());
