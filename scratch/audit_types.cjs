const { PrismaClient } = require('/app/server/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // 1. Check item 6153 across ALL databases
    console.log('=== ITEM 6153 EM TODAS AS BASES ===\n');
    const items6153 = await prisma.$queryRawUnsafe(
        `SELECT i.id, i.code, i.description, i.type, i.unit, i.price,
                d.name as db_name, d.type as db_type
         FROM "EngineeringItem" i
         JOIN "EngineeringDatabase" d ON d.id = i."databaseId"
         WHERE i.code = '6153'
         ORDER BY d.name`
    );
    for (const it of items6153) {
        const wrong = it.description?.toLowerCase().includes('horista') && it.type !== 'MAO_DE_OBRA';
        console.log(`${wrong ? '❌' : '✅'} ${it.code} | type=${it.type} | DB=${it.db_name} | ${it.description} | R$${Number(it.price).toFixed(2)}`);
    }

    // 2. Broader audit: find ALL items that are HORISTA/MO descriptions but typed as MATERIAL
    console.log('\n=== ITENS COM DESCRIÇÃO DE MÃO DE OBRA MAS TIPO MATERIAL ===\n');
    const mistyped = await prisma.$queryRawUnsafe(
        `SELECT i.code, i.description, i.type, i.unit, d.name as db_name
         FROM "EngineeringItem" i
         JOIN "EngineeringDatabase" d ON d.id = i."databaseId"
         WHERE i.type = 'MATERIAL'
           AND (
             i.description ILIKE '%HORISTA%'
             OR i.description ILIKE '%MENSALISTA%'
             OR i.description ILIKE '%SERVENTE%'
             OR i.description ILIKE '%PEDREIRO%'
             OR i.description ILIKE '%ELETRICISTA%'
             OR i.description ILIKE '%SOLDADOR%'
             OR i.description ILIKE '%AJUDANTE%'
             OR i.description ILIKE '%ENCANADOR%'
             OR i.description ILIKE '%CARPINTEIRO%'
             OR i.description ILIKE '%ARMADOR%'
             OR i.description ILIKE '%PINTOR%'
             OR i.description ILIKE '%OPERADOR%DE%'
             OR i.description ILIKE '%MOTORISTA%'
             OR i.description ILIKE '%ENGENHEIRO%'
             OR i.description ILIKE '%MESTRE%DE%OBRA%'
             OR i.description ILIKE '%SERRALHEIRO%'
             OR i.description ILIKE '%BOMBEIRO%HIDRA%'
             OR i.description ILIKE '%MONTADOR%'
             OR i.description ILIKE '%FERREIRO%'
             OR i.description ILIKE '%VIGIA%'
             OR i.description ILIKE '%TOPOGRAFO%'
             OR i.description ILIKE '%ENCARREGADO%'
           )
         ORDER BY d.name, i.code
         LIMIT 100`
    );
    console.log(`Total: ${mistyped.length} itens mal classificados\n`);
    for (const it of mistyped) {
        console.log(`  ❌ ${it.code} | ${it.type} → deveria ser MAO_DE_OBRA | DB: ${it.db_name} | ${(it.description || '').substring(0, 60)}`);
    }

    // 3. Also check: items that are MAO_DE_OBRA but look like materials  
    console.log('\n=== ITENS COM DESCRIÇÃO DE MATERIAL MAS TIPO MAO_DE_OBRA ===\n');
    const mistyped2 = await prisma.$queryRawUnsafe(
        `SELECT i.code, i.description, i.type, i.unit, d.name as db_name
         FROM "EngineeringItem" i
         JOIN "EngineeringDatabase" d ON d.id = i."databaseId"
         WHERE i.type = 'MAO_DE_OBRA'
           AND (
             i.description ILIKE '%CABO%COBRE%'
             OR i.description ILIKE '%TUBO%'
             OR i.description ILIKE '%PARAFUSO%'
             OR i.description ILIKE '%CIMENTO%'
             OR i.description ILIKE '%AREIA%'
             OR i.description ILIKE '%HASTE%ATERR%'
             OR i.description ILIKE '%CELULA FOTO%'
             OR i.description ILIKE '%LAMPADA%'
             OR i.description ILIKE '%POSTE%'
             OR i.description ILIKE '%LUMINARIA%'
             OR i.description ILIKE '%CONECTOR%'
             OR i.description ILIKE '%DISJUNTOR%'
             OR i.description ILIKE '%ELETRODUTO%'
             OR i.description ILIKE '%CAIXA%ALVEN%'
           )
         ORDER BY d.name, i.code
         LIMIT 50`
    );
    console.log(`Total: ${mistyped2.length} itens mal classificados\n`);
    for (const it of mistyped2) {
        console.log(`  ❌ ${it.code} | ${it.type} → deveria ser MATERIAL | DB: ${it.db_name} | ${(it.description || '').substring(0, 60)}`);
    }

    // 4. Check EQUIPAMENTO misclassifications
    console.log('\n=== ITENS COM DESCRIÇÃO DE EQUIPAMENTO MAS TIPO ERRADO ===\n');
    const mistyped3 = await prisma.$queryRawUnsafe(
        `SELECT i.code, i.description, i.type, i.unit, d.name as db_name
         FROM "EngineeringItem" i
         JOIN "EngineeringDatabase" d ON d.id = i."databaseId"
         WHERE i.type != 'EQUIPAMENTO'
           AND (
             i.description ILIKE '%GUINDASTE%' AND i.description NOT ILIKE '%OPERADOR%'
             OR i.description ILIKE '%RETROESCAVADEIRA%'
             OR i.description ILIKE '%BETONEIRA%'
             OR i.description ILIKE '%CAMINHAO%' AND i.description NOT ILIKE '%MOTORISTA%'
             OR i.description ILIKE '%ESCAVADEIRA%'
             OR i.description ILIKE '%COMPACTADOR%' AND i.description NOT ILIKE '%OPERADOR%'
           )
         ORDER BY d.name, i.code
         LIMIT 50`
    );
    console.log(`Total: ${mistyped3.length}\n`);
    for (const it of mistyped3) {
        console.log(`  ❌ ${it.code} | ${it.type} → deveria ser EQUIPAMENTO | DB: ${it.db_name} | ${(it.description || '').substring(0, 60)}`);
    }

    // 5. Summary by database  
    console.log('\n=== RESUMO POR BASE ===\n');
    const summary = await prisma.$queryRawUnsafe(
        `SELECT d.name, i.type, COUNT(*) as cnt
         FROM "EngineeringItem" i
         JOIN "EngineeringDatabase" d ON d.id = i."databaseId"
         GROUP BY d.name, i.type
         ORDER BY d.name, i.type`
    );
    let currentDb = '';
    for (const row of summary) {
        if (row.name !== currentDb) {
            currentDb = row.name;
            console.log(`\n  📁 ${row.name}:`);
        }
        console.log(`     ${row.type}: ${row.cnt}`);
    }

    await prisma.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
