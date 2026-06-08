import pkg from '@prisma/client';
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function inspectDbProcess() {
    const processes = await prisma.biddingProcess.findMany({
        where: {
            OR: [
                { title: { contains: 'JAGUARUANA' } },
                { link: { contains: '07615750000117' } }
            ]
        }
    });

    console.log("=== FOUND PROCESSES IN DATABASE ===");
    console.log(`Found ${processes.length} records.`);
    processes.forEach((p, idx) => {
        console.log(`\n------------------ [${idx}] ------------------`);
        console.log("ID:", p.id);
        console.log("Title:", p.title);
        console.log("Portal:", p.portal);
        console.log("Link:", p.link);
        console.log("pncpLink:", p.pncpLink);
        console.log("isMonitored:", p.isMonitored);
        console.log("estimatedValue:", p.estimatedValue);
        console.log("sessionDate:", p.sessionDate);
    });
}

inspectDbProcess()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
