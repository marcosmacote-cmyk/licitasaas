"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient({
    datasources: {
        db: { url: "postgresql://postgres:vVGIYSQWlPbvDqfUCWvinTEhFGjJoOvP@mainline.proxy.rlwy.net:18216/railway" }
    }
});
async function main() {
    const pList = await prisma.biddingProcess.findMany({
        orderBy: { id: 'desc' },
        take: 3
    });
    pList.forEach(p => {
        console.log("DB Title:", p.title);
        console.log("DB Link:", p.link);
    });
}
main().finally(() => prisma.$disconnect());
