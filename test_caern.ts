import fs from 'fs';
// We just copy the functions we need to test
const CAERN_CODE = fs.readFileSync('server/services/engineering/caernCrawler.ts', 'utf8');
const lines = CAERN_CODE.split('\n');
const startIdx = lines.findIndex(l => l.includes('function parseBrPrice'));
const endIdx = lines.findIndex(l => l.includes('function downloadAndParsePdf'));
// Just run our previously successful test instead, but now with the updated regex from the file
