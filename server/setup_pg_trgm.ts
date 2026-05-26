import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("Enabling pg_trgm...");
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    
    console.log("Creating GiST index on EngineeringItem.description...");
    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS eng_item_desc_trgm_idx 
        ON "EngineeringItem" USING gin (description gin_trgm_ops);
    `);
    
    console.log("Creating GiST index on EngineeringComposition.description...");
    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS eng_comp_desc_trgm_idx 
        ON "EngineeringComposition" USING gin (description gin_trgm_ops);
    `);

    console.log("Creating functional B-Tree index on LOWER(EngineeringItem.code)...");
    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS eng_item_lower_code_idx 
        ON "EngineeringItem" (LOWER(code));
    `);

    console.log("Creating functional B-Tree index on LOWER(EngineeringComposition.code)...");
    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS eng_comp_lower_code_idx 
        ON "EngineeringComposition" (LOWER(code));
    `);

    console.log("Creating GiST/GIN trigram index on EngineeringItem.code...");
    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS eng_item_code_trgm_idx 
        ON "EngineeringItem" USING gin (code gin_trgm_ops);
    `);

    console.log("Creating GiST/GIN trigram index on EngineeringComposition.code...");
    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS eng_comp_code_trgm_idx 
        ON "EngineeringComposition" USING gin (code gin_trgm_ops);
    `);
    
    console.log("Success! pg_trgm and indexes created.");
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
