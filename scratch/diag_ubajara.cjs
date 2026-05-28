const { PrismaClient } = require('/app/server/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Ubajara bid IDs
    const bidIds = ['410afada-2a6e-47bf-9ad6-5dd6ad35d6b3', '5e8977e2-f0c9-434d-81d0-d472b9184795'];
    
    // Get PriceProposal columns first
    const ppCols = await prisma.$queryRawUnsafe(
        `SELECT column_name FROM information_schema.columns WHERE table_name='PriceProposal' ORDER BY 1`
    );
    console.log('PriceProposal columns:', ppCols.map(c => c.column_name).join(', '));

    // Find engineering proposals for these bids
    const proposals = await prisma.$queryRawUnsafe(
        `SELECT id, "biddingProcessId", "totalValue" FROM "PriceProposal" WHERE "biddingProcessId" IN ($1, $2) ORDER BY "createdAt" DESC`,
        bidIds[0], bidIds[1]
    );
    console.log('\n=== PROPOSALS ===');
    for (const p of proposals) console.log(p.id, '| R$', Number(p.totalValue || 0).toFixed(2), '| bid:', p.biddingProcessId);

    if (proposals.length === 0) { console.log('No proposals'); return; }

    // Check which has engineering items
    for (const p of proposals) {
        const itemCount = await prisma.$queryRawUnsafe(
            `SELECT COUNT(*) as cnt FROM "EngineeringProposalItem" WHERE "proposalId" = $1`, p.id
        );
        console.log('  Proposal', p.id, '-> eng items:', Number(itemCount[0]?.cnt || 0));
    }

    // Use first proposal with engineering items
    let proposalId = null;
    for (const p of proposals) {
        const cnt = await prisma.$queryRawUnsafe(
            `SELECT COUNT(*) as cnt FROM "EngineeringProposalItem" WHERE "proposalId" = $1`, p.id
        );
        if (Number(cnt[0]?.cnt || 0) > 0) { proposalId = p.id; break; }
    }
    
    if (!proposalId) { console.log('No proposals with eng items'); return; }
    console.log('\n=== USING PROPOSAL:', proposalId, '===');
    
    // PROPRIA databases
    const dbs = await prisma.$queryRawUnsafe(
        `SELECT id, name, type FROM "EngineeringDatabase" WHERE name LIKE 'PROPRIA%' ORDER BY name`
    );
    console.log('\n=== PROPRIA DATABASES ===');
    for (const db of dbs) console.log(db.name, '| type:', db.type);

    // Compositions in PROPRIA
    const propriaDbName = 'PROPRIA_' + proposalId;
    const comps = await prisma.$queryRawUnsafe(
        `SELECT c.id, c.code, c.description, c."totalPrice", d.name as db_name,
                (SELECT COUNT(*) FROM "EngineeringCompositionItem" ci WHERE ci."compositionId" = c.id) as item_count
         FROM "EngineeringComposition" c
         JOIN "EngineeringDatabase" d ON d.id = c."databaseId"
         WHERE d.name IN ($1, 'PROPRIA')
         ORDER BY c.code`, propriaDbName
    );
    console.log('\n=== PROPRIA COMPOSITIONS (' + comps.length + ') ===');
    for (const c of comps) {
        console.log(c.code, '|', (c.description || '').substring(0, 50), '| DB:', c.db_name, '| Items:', Number(c.item_count), '| R$', Number(c.totalPrice).toFixed(2));
    }

    // Deep audit
    let totalIssues = 0;
    for (const c of comps.slice(0, 20)) {
        if (Number(c.item_count) === 0) {
            console.log('\n🟡 CASCA:', c.code, '(', (c.description||'').substring(0,40), ')');
            totalIssues++;
            continue;
        }
        const items = await prisma.$queryRawUnsafe(
            `SELECT ci.coefficient, ci.price, ci."groupKey",
                    i.code as item_code, i.description as item_desc, i.type as item_type,
                    id.name as item_db,
                    ac.code as aux_code, ad.name as aux_db
             FROM "EngineeringCompositionItem" ci
             LEFT JOIN "EngineeringItem" i ON i.id = ci."itemId"
             LEFT JOIN "EngineeringDatabase" id ON id.id = i."databaseId"
             LEFT JOIN "EngineeringComposition" ac ON ac.id = ci."auxiliaryCompositionId"
             LEFT JOIN "EngineeringDatabase" ad ON ad.id = ac."databaseId"
             WHERE ci."compositionId" = $1`, c.id
        );
        
        let officialInPropria = 0;
        let missingGroupKey = 0;
        let issueItems = [];
        
        for (const it of items) {
            if (!it.groupKey) missingGroupKey++;
            const dbName = it.item_db || it.aux_db || 'NULL';
            if (dbName.startsWith('PROPRIA') && it.item_code) {
                officialInPropria++;
                issueItems.push(it.item_code + ' | ' + it.item_type + ' | ' + (it.item_desc || '').substring(0, 35) + ' | DB:' + dbName);
            }
        }
        
        if (officialInPropria > 0 || missingGroupKey > 0) {
            totalIssues++;
            console.log('\n⚠', c.code, '(' + items.length + ' items)');
            if (officialInPropria > 0) {
                console.log('  🔴 ' + officialInPropria + ' items in PROPRIA DB:');
                for (const i of issueItems.slice(0, 8)) console.log('    ', i);
                if (issueItems.length > 8) console.log('    ... +' + (issueItems.length - 8) + ' more');
            }
            if (missingGroupKey > 0) console.log('  🟡 ' + missingGroupKey + '/' + items.length + ' missing groupKey');
        }
    }
    
    console.log('\n=== TOTAL: ' + totalIssues + ' issues / ' + comps.length + ' compositions ===');
    await prisma.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
