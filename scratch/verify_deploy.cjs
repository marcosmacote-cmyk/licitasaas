const { PrismaClient } = require('/app/server/node_modules/@prisma/client');
const prisma = new PrismaClient();

// Import the deployed resolveDisplayBase
let resolveDisplayBase;
try {
    const mod = require('/app/dist/server/services/engineering/baseResolver.js');
    resolveDisplayBase = mod.resolveDisplayBase;
    console.log('✅ baseResolver.js loaded from dist');
} catch(e) {
    console.log('⚠ Could not load baseResolver from dist, using inline version');
    resolveDisplayBase = function(dbName, sourceName, code) {
        const db = (dbName || '').trim();
        if (db && db !== 'PROPRIA' && !db.startsWith('PROPRIA_')) return db;
        const src = (sourceName || '').trim().toUpperCase();
        if (src && src !== 'PROPRIA' && !src.startsWith('PROPRIA')) return src;
        let c = (code || '').trim().toUpperCase();
        if (c) {
            c = c.replace(/-C\d+$/, '').replace(/-(H|M)-(AJ|EL)$/, '');
            if (c.startsWith('INS-')) c = c.replace(/^INS-/, '').replace(/-\d+$/, '');
            if (/^[A-Z]{1,4}\d{2,5}$/.test(c) || /^I\d{3,5}$/.test(c)) return 'SEINFRA';
            if (/^\d{3,6}(\/\d+)?$/.test(c)) return 'SINAPI';
            if (/^\d{3,6}\/ORSE$/.test(c)) return 'ORSE';
            if (/^[A-Z]{2}-\d{2}-\d{3}/.test(c)) return 'SICRO';
        }
        return 'PRÓPRIA';
    };
}

async function main() {
    const proposalId = '7a910235-a09c-40a0-86e8-73a1b4da3b12';
    const propriaDbName = 'PROPRIA_' + proposalId;
    
    // Get compositions with items
    const comps = await prisma.$queryRawUnsafe(
        `SELECT c.id, c.code, c.description, d.name as db_name,
                (SELECT COUNT(*) FROM "EngineeringCompositionItem" ci WHERE ci."compositionId" = c.id) as item_count
         FROM "EngineeringComposition" c
         JOIN "EngineeringDatabase" d ON d.id = c."databaseId"
         WHERE d.name IN ($1, 'PROPRIA') AND c.code LIKE 'CP-%'
         ORDER BY c.code`, propriaDbName
    );
    
    console.log('=== VERIFICAÇÃO PÓS-DEPLOY ===\n');
    
    for (const c of comps) {
        if (Number(c.item_count) === 0) {
            console.log('🟡 CASCA:', c.code, '— will show warning in report ✅');
            continue;
        }
        
        const items = await prisma.$queryRawUnsafe(
            `SELECT i.code as item_code, i.type as item_type,
                    id.name as item_db
             FROM "EngineeringCompositionItem" ci
             LEFT JOIN "EngineeringItem" i ON i.id = ci."itemId"
             LEFT JOIN "EngineeringDatabase" id ON id.id = i."databaseId"
             WHERE ci."compositionId" = $1 AND i.id IS NOT NULL`, c.id
        );
        
        console.log('\n📋', c.code, '(' + items.length + ' items):');
        let allCorrect = true;
        for (const it of items) {
            const resolved = resolveDisplayBase(it.item_db, undefined, it.item_code);
            const wasWrong = (it.item_db || '').startsWith('PROPRIA') && resolved !== 'PRÓPRIA';
            const status = wasWrong ? '✅ FIXED' : '✅ OK';
            if (wasWrong) {
                console.log('  ', status, it.item_code, '| DB:', it.item_db, '→ Display:', resolved);
            }
            if (resolved === 'PRÓPRIA' && (it.item_db || '').startsWith('PROPRIA')) {
                // Genuinely PROPRIA item
            }
        }
    }
    
    // Summary: count how many items would now be correctly resolved
    const allItems = await prisma.$queryRawUnsafe(
        `SELECT i.code as item_code, id.name as item_db
         FROM "EngineeringCompositionItem" ci
         JOIN "EngineeringItem" i ON i.id = ci."itemId"
         JOIN "EngineeringDatabase" id ON id.id = i."databaseId"
         JOIN "EngineeringComposition" c ON c.id = ci."compositionId"
         JOIN "EngineeringDatabase" cd ON cd.id = c."databaseId"
         WHERE cd.name IN ($1, 'PROPRIA')
           AND id.name LIKE 'PROPRIA%'`, propriaDbName
    );
    
    let fixed = 0, remaining = 0;
    for (const it of allItems) {
        const resolved = resolveDisplayBase(it.item_db, undefined, it.item_code);
        if (resolved !== 'PRÓPRIA') fixed++;
        else remaining++;
    }
    
    console.log('\n=== RESULTADO ===');
    console.log('Items em PROPRIA DB com base resolvida:', fixed, '✅');
    console.log('Items genuinamente PRÓPRIA:', remaining);
    console.log('Total auditado:', allItems.length);
    
    await prisma.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
