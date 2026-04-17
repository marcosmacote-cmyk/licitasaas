import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log("=== CHECKING ILIKE ===");
    const items = await prisma.$queryRawUnsafe(`
        SELECT id, uf, objeto FROM "PncpContratacao"
        WHERE uf = 'CE' AND objeto ILIKE '%genero%'
        LIMIT 5;
    `);
    console.log(items);

    console.log("\n=== CHECKING FTS VECTOR ===");
    const items2 = await prisma.$queryRawUnsafe(`
        SELECT id, uf, objeto, "searchVector" FROM "PncpContratacao"
        WHERE uf = 'CE' AND "searchVector" @@ websearch_to_tsquery('pt_unaccent', 'generos')
        LIMIT 5;
    `);
    console.log(items2);

    process.exit(0);
}
main().catch(console.error);
