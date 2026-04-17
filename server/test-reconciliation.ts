import { runPncpSync } from './workers/pncpAggregator';

async function main() {
    console.log('Running PNCP sync...');
    const result = await runPncpSync();
    console.log('Result:', result);
    process.exit(0);
}

main().catch(console.error);
