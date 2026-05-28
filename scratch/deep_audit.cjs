const { PrismaClient } = require('/app/server/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const proposalId = '7a910235-a09c-40a0-86e8-73a1b4da3b12';
    const propriaDbName = 'PROPRIA_' + proposalId;

    // Check CP-001 composition items in detail
    const cpCodes = ['CP-001', 'CP-002', 'CP-003'];
    
    for (const cpCode of cpCodes) {
        const comp = await prisma.$queryRawUnsafe(
            `SELECT c.id, c.code, c.description, c."totalPrice", d.name as db_name
             FROM "EngineeringComposition" c
             JOIN "EngineeringDatabase" d ON d.id = c."databaseId"
             WHERE c.code = $1 AND d.name IN ($2, 'PROPRIA')
             LIMIT 1`, cpCode, propriaDbName
        );
        
        if (comp.length === 0) {
            console.log('\n❌ ' + cpCode + ' not found in PROPRIA DB');
            continue;
        }
        
        console.log('\n═══════════════════════════════════════');
        console.log('📋', cpCode, '| DB:', comp[0].db_name, '| R$', Number(comp[0].totalPrice).toFixed(2));
        
        const items = await prisma.$queryRawUnsafe(
            `SELECT ci.id, ci.coefficient, ci.price, ci."groupKey",
                    ci."itemId", ci."auxiliaryCompositionId",
                    i.code as item_code, i.description as item_desc, i.type as item_type, i.price as item_price,
                    id.name as item_db_name,
                    ac.code as aux_code, ac.description as aux_desc, ac."totalPrice" as aux_price,
                    ad.name as aux_db_name
             FROM "EngineeringCompositionItem" ci
             LEFT JOIN "EngineeringItem" i ON i.id = ci."itemId"
             LEFT JOIN "EngineeringDatabase" id ON id.id = i."databaseId"
             LEFT JOIN "EngineeringComposition" ac ON ac.id = ci."auxiliaryCompositionId"
             LEFT JOIN "EngineeringDatabase" ad ON ad.id = ac."databaseId"
             WHERE ci."compositionId" = $1
             ORDER BY ci."groupKey" NULLS LAST`, comp[0].id
        );
        
        console.log('  Total items:', items.length);
        
        let groupStats = {};
        for (const it of items) {
            const isAux = !!it.auxiliaryCompositionId;
            const code = isAux ? it.aux_code : it.item_code;
            const desc = isAux ? it.aux_desc : it.item_desc;
            const dbName = isAux ? it.aux_db_name : it.item_db_name;
            const type = isAux ? 'AUX_COMP' : it.item_type;
            const group = it.groupKey || 'NULL';
            
            if (!groupStats[group]) groupStats[group] = { count: 0, items: [] };
            groupStats[group].count++;
            groupStats[group].items.push({
                code, type, dbName, isAux,
                coef: Number(it.coefficient).toFixed(4),
                price: Number(it.price).toFixed(2),
                unitPrice: isAux ? Number(it.aux_price).toFixed(2) : Number(it.item_price).toFixed(2)
            });
        }
        
        for (const [group, info] of Object.entries(groupStats)) {
            console.log('\n  📁 Group:', group, '(' + info.count + ' items)');
            for (const item of info.items) {
                const auxTag = item.isAux ? '🔗AUX' : '   ';
                console.log('   ', auxTag, item.code, '|', item.type, '| DB:', item.dbName, '| coef:', item.coef, '| price:', item.price, '| unitPrice:', item.unitPrice);
            }
        }
    }

    // Also check the budget item values
    console.log('\n═══════════════════════════════════════');
    console.log('📊 BUDGET ITEM VALUES (EngineeringProposalItem)');
    const budgetItems = await prisma.$queryRawUnsafe(
        `SELECT code, description, "unitCost", "unitPrice", quantity, "totalPrice", "compositionTotalPrice"
         FROM "EngineeringProposalItem"
         WHERE "proposalId" = $1 AND code LIKE 'CP-%'
         ORDER BY code`, proposalId
    );
    for (const bi of budgetItems) {
        console.log('  ', bi.code, '|', (bi.description || '').substring(0, 40), '| unitCost:', Number(bi.unitCost).toFixed(2), '| compTotal:', bi.compositionTotalPrice ? Number(bi.compositionTotalPrice).toFixed(2) : 'NULL');
    }

    await prisma.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
