"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    try {
        const test = await prisma.$queryRawUnsafe(`SELECT unaccent('café') as val;`);
        console.log("Unaccent works:", test);
    }
    catch (e) {
        console.log("Unaccent failed:");
        console.log(e);
    }
    process.exit(0);
}
main();
