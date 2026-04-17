"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pncpAggregator_1 = require("./workers/pncpAggregator");
async function main() {
    console.log('Running PNCP sync...');
    const result = await (0, pncpAggregator_1.runPncpSync)();
    console.log('Result:', result);
    process.exit(0);
}
main().catch(console.error);
