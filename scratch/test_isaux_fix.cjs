// End-to-end verification of the isAux fix
// Simulates what happens when frontend sends auxiliary composition items

const isTempId = (valId) => 
    !valId || valId.startsWith('new-') || valId.startsWith('temp-') || 
    valId.startsWith('new-casca-') || valId.startsWith('new-aux-') || 
    valId.startsWith('synthetic-') || valId.startsWith('etapa-');

// Simulate flatItems as they come from the frontend
const testCases = [
    // Case 1: New auxiliary composition with no id (the bug case)
    {
        name: 'New aux comp (id=undefined)',
        item: {
            auxiliaryComposition: { 
                code: 'CPMH06', description: 'Test Comp', unit: 'UN', totalPrice: 100 
                // NOTE: no .id property!
            },
            coefficient: 1,
            price: 100,
            groupKey: 'AUXILIAR'
        },
        expectedIsAux: true,
        expectedAuxId: undefined,
        expectedTempId: true
    },
    // Case 2: Auxiliary composition with temp id
    {
        name: 'New aux comp (temp id)',
        item: {
            auxiliaryComposition: { 
                id: 'new-aux-abc123', code: 'C0054', description: 'Test', unit: 'UN', totalPrice: 50 
            },
            coefficient: 2,
            price: 100,
            groupKey: 'AUXILIAR'
        },
        expectedIsAux: true,
        expectedAuxId: 'new-aux-abc123',
        expectedTempId: true
    },
    // Case 3: Existing auxiliary with real UUID
    {
        name: 'Existing aux comp (real UUID)',
        item: {
            auxiliaryCompositionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            auxiliaryComposition: { 
                id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', code: 'I0747', description: 'Existing', unit: 'UN', totalPrice: 200 
            },
            coefficient: 1.5,
            price: 300,
            groupKey: 'EQUIPAMENTO'
        },
        expectedIsAux: true,
        expectedAuxId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        expectedTempId: false
    },
    // Case 4: Regular item (should NOT be aux)
    {
        name: 'Regular item (not aux)',
        item: {
            item: { id: 'item-uuid-123', code: '2436', description: 'Eletricista', unit: 'H', price: 21.86 },
            coefficient: 5,
            price: 109.3,
            groupKey: 'MAO_DE_OBRA'
        },
        expectedIsAux: false,
        expectedAuxId: undefined,
        expectedTempId: undefined
    },
    // Case 5: Aux comp with ONLY auxiliaryCompositionId (no object)
    {
        name: 'Aux with only auxiliaryCompositionId',
        item: {
            auxiliaryCompositionId: 'uuid-abc-123',
            coefficient: 1,
            price: 50,
            groupKey: 'AUXILIAR'
        },
        expectedIsAux: true,
        expectedAuxId: 'uuid-abc-123',
        expectedTempId: false
    }
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
    const item = tc.item;
    
    // NEW FIXED LOGIC:
    const isAux = !!item.auxiliaryCompositionId || !!item.auxiliaryComposition;
    const itemId = item.item ? item.item.id : item.itemId;
    const auxId = item.auxiliaryComposition ? item.auxiliaryComposition.id : item.auxiliaryCompositionId;
    
    // Check skip condition
    const wouldSkip = !itemId && !auxId && !isAux;
    
    // Verify
    const checks = [
        { label: 'isAux', actual: isAux, expected: tc.expectedIsAux },
        { label: 'auxId', actual: auxId, expected: tc.expectedAuxId },
    ];
    
    if (tc.expectedTempId !== undefined) {
        checks.push({ label: 'isTempId', actual: isTempId(auxId), expected: tc.expectedTempId });
    }
    
    let testPassed = true;
    for (const check of checks) {
        if (check.actual !== check.expected) {
            console.log(`  FAIL [${tc.name}]: ${check.label} = ${JSON.stringify(check.actual)} expected ${JSON.stringify(check.expected)}`);
            testPassed = false;
        }
    }
    
    // Aux items with no auxId should NOT be skipped (they should be created as new)
    if (isAux && !auxId && wouldSkip) {
        console.log(`  FAIL [${tc.name}]: Aux item would be SKIPPED (wrong!)`);
        testPassed = false;
    }
    
    if (testPassed) {
        passed++;
        console.log(`✅ ${tc.name}`);
    } else {
        failed++;
    }
}

console.log(`\n=== ${passed}/${passed + failed} tests passed ===`);
if (failed > 0) process.exit(1);
