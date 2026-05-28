// Verification script: test resolveDisplayBase patterns
// Run after deploy to verify the fix works

const testCases = [
    // [code, sourceName, dbName, expected]
    ['2436', undefined, 'PROPRIA_7a910235', 'SINAPI'],
    ['247', undefined, 'PROPRIA_7a910235', 'SINAPI'],
    ['6160', undefined, 'PROPRIA_xxx', 'SINAPI'],
    ['6110', undefined, 'PROPRIA_xxx', 'SINAPI'],
    ['252', undefined, 'PROPRIA_xxx', 'SINAPI'],
    ['88316', undefined, 'PROPRIA_xxx', 'SINAPI'],
    ['I2171', undefined, 'PROPRIA_xxx', 'SEINFRA'],
    ['CPMH06', undefined, 'PROPRIA_xxx', 'SEINFRA'],
    ['C1614', undefined, 'PROPRIA_xxx', 'SEINFRA'],
    ['I0001', undefined, 'PROPRIA_xxx', 'SEINFRA'],
    ['CP-001', undefined, 'PROPRIA_xxx', 'PRÓPRIA'],  // Own composition code
    ['M18042', undefined, 'PROPRIA_xxx', 'SEINFRA'],   // M + digits = SEINFRA
    ['INS PMB 1301', undefined, 'PROPRIA_xxx', 'PRÓPRIA'], // Own custom code
    // With real dbName (should use it directly)
    ['2436', undefined, 'SINAPI', 'SINAPI'],
    ['I2171', undefined, 'SEINFRA', 'SEINFRA'],
    // With sourceName 
    ['anything', 'ORSE', 'PROPRIA_xxx', 'ORSE'],
];

function resolveDisplayBase(dbName, sourceName, compositionCode) {
    const db = (dbName || '').trim();
    if (db && db !== 'PROPRIA' && !db.startsWith('PROPRIA_')) return db;
    
    const src = (sourceName || '').trim().toUpperCase();
    if (src && src !== 'PROPRIA' && !src.startsWith('PROPRIA')) return src;
    
    let code = (compositionCode || '').trim().toUpperCase();
    if (code) {
        code = code.replace(/-C\d+$/, '');
        code = code.replace(/-(H|M)-(AJ|EL)$/, '');
        if (code.startsWith('INS-')) code = code.replace(/^INS-/, '').replace(/-\d+$/, '');
        
        if (/^[A-Z]{1,4}\d{2,5}$/.test(code) || /^I\d{3,5}$/.test(code)) return 'SEINFRA';
        if (/^\d{3,6}(\/\d+)?$/.test(code)) return 'SINAPI';
        if (/^\d{3,6}\/ORSE$/.test(code) || (/^\d{3,6}$/.test(code) && src === 'ORSE')) return 'ORSE';
        if (/^[A-Z]{2}-\d{2}-\d{3}/.test(code)) return 'SICRO';
        if (/^SBC/i.test(code)) return 'SBC';
        if (/^CAERN/i.test(code)) return 'CAERN';
        if (/^SICOR/i.test(code)) return 'SICOR';
    }
    
    return 'PRÓPRIA';
}

let passed = 0;
let failed = 0;

for (const [code, sourceName, dbName, expected] of testCases) {
    const result = resolveDisplayBase(dbName, sourceName, code);
    const ok = result === expected;
    if (ok) {
        passed++;
    } else {
        failed++;
        console.log(`FAIL: resolveDisplayBase('${dbName}', '${sourceName}', '${code}') = '${result}' expected '${expected}'`);
    }
}

console.log(`\n=== ${passed}/${passed + failed} tests passed ===`);
if (failed > 0) process.exit(1);
