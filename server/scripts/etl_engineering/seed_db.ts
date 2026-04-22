import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
    console.log('--- LicitaSaaS Engineering Database Ingestor ---');
    
    // Ler o arquivo JSON gerado pelo Python ETL
    const jsonPath = process.argv[2];
    if (!jsonPath) {
        console.error('Uso: npx ts-node seed_db.ts <caminho_para_json>');
        process.exit(1);
    }
    
    const absolutePath = path.resolve(jsonPath);
    if (!fs.existsSync(absolutePath)) {
        console.error(`Erro: Arquivo não encontrado - ${absolutePath}`);
        process.exit(1);
    }
    
    console.log(`Lendo arquivo: ${absolutePath}`);
    const data = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    
    const { metadata, items } = data;
    
    console.log(`[1/3] Verificando se Tabela Base já existe...`);
    console.log(`  - Fonte: ${metadata.sourceName}`);
    console.log(`  - UF: ${metadata.stateUf}`);
    console.log(`  - Versão: ${metadata.referenceDate}`);
    
    // Evitar duplicidade: verificar se a database já existe
    let database = await prisma.engineeringDatabase.findFirst({
        where: {
            name: metadata.sourceName,
            uf: metadata.stateUf,
            version: metadata.referenceDate.split('T')[0].substring(0, 7), // "2026-05"
            type: "OFICIAL"
        }
    });
    
    if (database) {
        console.log(`  -> Database já existe (ID: ${database.id}). Apagando insumos antigos para recriar...`);
        await prisma.engineeringItem.deleteMany({
            where: { databaseId: database.id }
        });
    } else {
        console.log(`  -> Criando nova Database Oficial no banco...`);
        database = await prisma.engineeringDatabase.create({
            data: {
                name: metadata.sourceName,
                uf: metadata.stateUf,
                version: metadata.referenceDate.split('T')[0].substring(0, 7),
                type: "OFICIAL"
            }
        });
    }
    
    console.log(`[2/3] Preparando ${items.length} insumos para inserção em lote (Bulk Insert)...`);
    
    const payload = items.map((it: any) => ({
        databaseId: database.id,
        code: it.code,
        description: it.description,
        unit: it.unit,
        price: it.unitCost,
        type: it.type || 'MATERIAL'
    }));
    
    console.log(`[3/3] Executando inserção no Prisma...`);
    const result = await prisma.engineeringItem.createMany({
        data: payload,
        skipDuplicates: true
    });
    
    console.log(`✅ Sucesso! Inseridos ${result.count} insumos na base de Engenharia do LicitaSaaS.`);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
