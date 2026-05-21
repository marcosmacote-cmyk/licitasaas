async function main() {
    const { getLatestOrsePeriods, searchOrseInsumos, searchOrseServices } = await import('../server/services/engineering/orseCrawler.ts');

    console.log("Fetching periods...");
    const periods = await getLatestOrsePeriods(12);
    console.log(`Found ${periods.length} periods:`);
    for (const p of periods) {
        console.log(`- label: ${p.label}, value: ${p.value}, downloadUrl: ${p.downloadUrl}`);
    }

    // Try to crawl insumos for the last 3 periods to see if we get inputs
    for (let i = 0; i < Math.min(3, periods.length); i++) {
        const period = periods[i];
        console.log(`\nTesting period: ${period.label} (${period.value})`);
        
        console.log("Fetching services page 1...");
        const services = await searchOrseServices(period.value, '', 1);
        console.log(`Services page 1 count: ${services.services.length}, totalServices: ${services.totalServices}, totalPages: ${services.totalPages}`);

        console.log("Fetching insumos page 1...");
        const insumos = await searchOrseInsumos(period.value, '', 1);
        console.log(`Insumos page 1 count: ${insumos.inputs.length}, totalInputs: ${insumos.totalInputs}, totalPages: ${insumos.totalPages}`);
        if (insumos.inputs.length > 0) {
            console.log("Sample input:", insumos.inputs[0]);
        }
    }
}

main().catch(console.error);
