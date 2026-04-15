import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
    try {
        await prisma.$executeRaw`CREATE EXTENSION IF NOT EXISTS unaccent;`;
        console.log("Extension unaccent created.");
        
        const term = 'locação';
        
        // Use unaccent in ILIKE test
        const rows = await prisma.$queryRaw`
            SELECT id, "objeto", "orgaoNome" 
            FROM "PncpContratacao" 
            WHERE unaccent("objeto") ILIKE unaccent(${'%' + term + '%'})
               OR unaccent("orgaoNome") ILIKE unaccent(${'%' + term + '%'})
            LIMIT 5;
        `;
        console.log("Rows matched:", (rows as any[]).length);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
run();
