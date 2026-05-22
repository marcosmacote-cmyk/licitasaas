import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

async function runTest() {
    console.log("=== STARTING MANUAL COMPOSITION TEST ===");

    // 1. Create a dummy tenant and database PRÓPRIA if not exists
    let tenant = await prisma.tenant.findFirst();
    if (!tenant) {
        tenant = await prisma.tenant.create({
            data: {
                id: 'test-tenant-id',
                rootCnpj: '00000000000000',
                razaoSocial: 'Test Tenant',
            }
        });
    }

    let database = await prisma.engineeringDatabase.findFirst({
        where: { name: 'PROPRIA', tenantId: tenant.id }
    });
    if (!database) {
        database = await prisma.engineeringDatabase.create({
            data: {
                name: 'PROPRIA',
                type: 'PROPRIA',
                tenantId: tenant.id,
                uf: 'CE',
            }
        });
    }

    // 2. Create a test proprietary composition
    const compCode = `TEST-COMP-${Date.now()}`;
    const composition = await prisma.engineeringComposition.create({
        data: {
            databaseId: database.id,
            code: compCode,
            description: 'Composição de Teste para Auditoria',
            unit: 'M2',
            totalPrice: 150.00,
        }
    });

    console.log(`Created composition shell: ${composition.code} (${composition.id})`);

    // 3. Mock payload structure representing CompositionEditor.tsx saving
    const mockSavePayload = {
        code: compCode,
        description: 'Composição de Teste para Auditoria (Updated)',
        unit: 'M2',
        totalPrice: 180.50,
        groupNotes: {
            MATERIAL: 'Observação do grupo Material',
            CUSTOM_ETAPA_1: 'Observação da etapa customizada 1'
        },
        customGroupLabels: {
            CUSTOM_ETAPA_1: 'Etapa Customizada 1 de Fundações'
        },
        groupOrder: ['MATERIAL', 'CUSTOM_ETAPA_1'],
        referenceDivisor: { label: 'Divisor Ref', value: 2 },
        _officialRef: null,
        groups: {
            MATERIAL: [
                {
                    coefficient: 2.5,
                    price: 25.00,
                    item: {
                        id: 'new-temp-1',
                        code: 'LIVRE', // Should trigger unique generation
                        description: 'Cimento Livre Especial',
                        unit: 'KG',
                        price: 10.00,
                    }
                }
            ],
            CUSTOM_ETAPA_1: [
                {
                    coefficient: 1.0,
                    price: 120.00,
                    item: {
                        id: 'new-temp-2',
                        code: 'LIVRE', // Should trigger unique generation
                        description: 'Aço Livre Estrutural',
                        unit: 'KG',
                        price: 120.00,
                    }
                }
            ]
        }
    };

    // 4. Simulate PUT logic inside a transaction
    console.log("Simulating PUT transaction...");
    await prisma.$transaction(async (tx) => {
        // Flatten all items and associate groupKey
        const flatItems: any[] = [];
        for (const [groupKey, group] of Object.entries(mockSavePayload.groups)) {
            if (Array.isArray(group)) {
                for (const item of group) {
                    flatItems.push({
                        ...item,
                        groupKey: groupKey
                    });
                }
            }
        }

        const metadata = {
            groupNotes: mockSavePayload.groupNotes || null,
            customGroupLabels: mockSavePayload.customGroupLabels || null,
            groupOrder: mockSavePayload.groupOrder || null,
            referenceDivisor: mockSavePayload.referenceDivisor || null,
            _officialRef: mockSavePayload._officialRef || null,
        };

        // Update composition
        await tx.engineeringComposition.update({
            where: { id: composition.id },
            data: {
                code: mockSavePayload.code,
                totalPrice: mockSavePayload.totalPrice,
                description: mockSavePayload.description,
                unit: mockSavePayload.unit,
                metadata: metadata,
            }
        });

        // Delete old items
        await tx.engineeringCompositionItem.deleteMany({
            where: { compositionId: composition.id }
        });

        // Create new items
        for (const item of flatItems) {
            let itemId = item.item?.id;
            let itemCode = item.item?.code || 'LIVRE';
            if (itemCode === 'LIVRE') {
                itemCode = `LIVRE-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
            }

            // Create proprietary item
            const createdItem = await tx.engineeringItem.create({
                data: {
                    databaseId: database!.id,
                    code: itemCode,
                    description: item.item?.description || 'Item Livre',
                    unit: item.item?.unit || 'UN',
                    type: 'MATERIAL',
                    price: item.item?.price || 0,
                }
            });

            itemId = createdItem.id;

            await tx.engineeringCompositionItem.create({
                data: {
                    compositionId: composition.id,
                    itemId: itemId,
                    coefficient: item.coefficient,
                    price: item.price,
                    groupKey: item.groupKey,
                }
            });
        }
    });

    console.log("PUT completed successfully.");

    // 5. Simulate GET /compositions/:code logic
    console.log("Simulating GET lookup...");
    const retrieved = await prisma.engineeringComposition.findUnique({
        where: { id: composition.id },
        include: {
            items: { include: { item: true } },
            database: true,
        }
    });

    if (!retrieved) {
        throw new Error("Could not retrieve saved composition!");
    }

    const metadataObj = retrieved.metadata
        ? (typeof retrieved.metadata === 'string'
            ? JSON.parse(retrieved.metadata)
            : retrieved.metadata)
        : {};

    const enrichedItems = retrieved.items;

    // Grouping logic
    const groups: Record<string, any[]> = {};
    const hasGroupKeys = enrichedItems.some((ci: any) => ci.groupKey);
    if (hasGroupKeys) {
        for (const ci of enrichedItems) {
            const key = ci.groupKey || 'MATERIAL';
            if (!groups[key]) groups[key] = [];
            groups[key].push(ci);
        }
    }

    console.log("\n=== VERIFYING SAVED METADATA ===");
    console.log("Metadata groupNotes:", JSON.stringify(metadataObj.groupNotes));
    console.log("Metadata customGroupLabels:", JSON.stringify(metadataObj.customGroupLabels));
    console.log("Metadata groupOrder:", JSON.stringify(metadataObj.groupOrder));
    console.log("Metadata referenceDivisor:", JSON.stringify(metadataObj.referenceDivisor));

    console.log("\n=== VERIFYING GROUPING BY GROUPKEY ===");
    for (const [key, groupItems] of Object.entries(groups)) {
        console.log(`Group: ${key} (${groupItems.length} items):`);
        for (const ci of groupItems) {
            console.log(`  - Item: "${ci.item.description}", Code: ${ci.item.code}, Coef: ${ci.coefficient}, GroupKey: ${ci.groupKey}`);
        }
    }

    // Assertions
    const customLabels = metadataObj.customGroupLabels;
    if (customLabels?.CUSTOM_ETAPA_1 !== 'Etapa Customizada 1 de Fundações') {
        throw new Error("Custom labels mismatch!");
    }

    if (!groups.CUSTOM_ETAPA_1 || groups.CUSTOM_ETAPA_1.length !== 1) {
        throw new Error("Custom group item missing or misgrouped!");
    }

    const cimentoItem = groups.MATERIAL[0].item;
    const acoItem = groups.CUSTOM_ETAPA_1[0].item;

    if (cimentoItem.code === 'LIVRE' || acoItem.code === 'LIVRE') {
        throw new Error("Unique code generation for LIVRE items failed!");
    }

    if (cimentoItem.description !== 'Cimento Livre Especial' || acoItem.description !== 'Aço Livre Estrutural') {
        throw new Error("LIVRE items details overwritten!");
    }

    console.log("\n✅ ALL ASSERTIONS PASSED!");

    // Clean up
    console.log("Cleaning up test data...");
    await prisma.engineeringCompositionItem.deleteMany({ where: { compositionId: composition.id } });
    await prisma.engineeringComposition.delete({ where: { id: composition.id } });
    await prisma.engineeringItem.delete({ where: { id: cimentoItem.id } });
    await prisma.engineeringItem.delete({ where: { id: acoItem.id } });
    console.log("Cleanup complete!");
}

runTest().catch((err) => {
    console.error("Test failed!", err);
    process.exit(1);
}).finally(() => prisma.$disconnect());
