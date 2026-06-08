import prisma from '../lib/prisma';

async function inspectJobs() {
    const jobs = await prisma.backgroundJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
    });

    console.log("=== RECENT BACKGROUND JOBS ===");
    jobs.forEach((j, idx) => {
        console.log(`\n------------------ [${idx}] ------------------`);
        console.log("ID:", j.id);
        console.log("Type:", j.type);
        console.log("Status:", j.status);
        console.log("Input:", JSON.stringify(j.input, null, 2));
        console.log("Result (keys):", j.result ? Object.keys(j.result as object) : 'null');
        if (j.result) {
            const res = j.result as any;
            if (res.process) {
                console.log("Result Process Title:", res.process.title);
                console.log("Result Process Link:", res.process.link_sistema);
            }
        }
        console.log("Error:", j.error);
        console.log("Created At:", j.createdAt);
    });
}

inspectJobs()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
