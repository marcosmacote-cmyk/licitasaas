import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const c = await prisma.pncpContratacao.count();
    const i = await prisma.pncpItem.count();
    console.log("Contratações:", c);
    console.log("Itens:", i);
    process.exit(0);
}
main();
