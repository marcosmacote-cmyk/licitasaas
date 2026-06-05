import 'dotenv/config';
import { prisma } from '../lib/prisma';

async function verify() {
  console.log("=== VERIFYING REGIME SPLIT PRICES FOR SICRO ===");
  try {
    const oneradoDb = await prisma.engineeringDatabase.findFirst({
      where: { name: 'SICRO', uf: 'CE', referenceMonth: 1, referenceYear: 2026, payrollExemption: false }
    });
    const desoneradoDb = await prisma.engineeringDatabase.findFirst({
      where: { name: 'SICRO', uf: 'CE', referenceMonth: 1, referenceYear: 2026, payrollExemption: true }
    });

    if (!oneradoDb || !desoneradoDb) {
      console.error("Error: Databases not found!");
      return;
    }

    console.log(`Onerado DB ID: ${oneradoDb.id}`);
    console.log(`Desonerado DB ID: ${desoneradoDb.id}`);

    const itemOnerado = await prisma.engineeringItem.findFirst({
      where: { databaseId: oneradoDb.id, code: 'P9801' }
    });
    const itemDesonerado = await prisma.engineeringItem.findFirst({
      where: { databaseId: desoneradoDb.id, code: 'P9801' }
    });

    console.log(`\nLabor Item: P9801 (Ajudante)`);
    console.log(`- Price in Onerado: ${itemOnerado ? `R$ ${itemOnerado.price}` : 'Not found'}`);
    console.log(`- Price in Desonerado: ${itemDesonerado ? `R$ ${itemDesonerado.price}` : 'Not found'}`);

    // Let's also check equipment E9007 (Bomba de pistão triplex)
    const eqOnerado = await prisma.engineeringItem.findFirst({
      where: { databaseId: oneradoDb.id, code: 'E9007' }
    });
    const eqDesonerado = await prisma.engineeringItem.findFirst({
      where: { databaseId: desoneradoDb.id, code: 'E9007' }
    });
    
    console.log(`\nEquipment Item: E9007`);
    console.log(`- Price in Onerado: ${eqOnerado ? `R$ ${eqOnerado.price}` : 'Not found'}`);
    console.log(`- Price in Desonerado: ${eqDesonerado ? `R$ ${eqDesonerado.price}` : 'Not found'}`);

    // Let's check a material M0003 (Aço CA 25)
    const matOnerado = await prisma.engineeringItem.findFirst({
      where: { databaseId: oneradoDb.id, code: 'M0003' }
    });
    const matDesonerado = await prisma.engineeringItem.findFirst({
      where: { databaseId: desoneradoDb.id, code: 'M0003' }
    });

    console.log(`\nMaterial Item: M0003 (Aço CA 25)`);
    console.log(`- Price in Onerado: ${matOnerado ? `R$ ${matOnerado.price}` : 'Not found'}`);
    console.log(`- Price in Desonerado: ${matDesonerado ? `R$ ${matDesonerado.price}` : 'Not found'}`);

  } catch (err: any) {
    console.error("Error verifying:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

verify();
