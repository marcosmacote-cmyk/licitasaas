import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    const tenant = await prisma.tenant.upsert({
        where: { rootCnpj: '00.000.000/0001-00' },
        update: {},
        create: {
            rootCnpj: '00.000.000/0001-00',
            razaoSocial: 'LicitaSaaS Example Corp',
        },
    });

    const matrix = await prisma.companyProfile.upsert({
        where: { cnpj: '12.345.678/0001-90' },
        update: {},
        create: {
            tenantId: tenant.id,
            cnpj: '12.345.678/0001-90',
            razaoSocial: 'Tech Solutions Matriz LTDA',
            isHeadquarters: true,
        },
    });

    await prisma.companyProfile.create({
        data: {
            tenantId: tenant.id,
            cnpj: '12.345.678/0002-71',
            razaoSocial: 'Tech Solutions Filial SP',
            isHeadquarters: false,
        },
    });

    const bidding1 = await prisma.biddingProcess.create({
        data: {
            tenantId: tenant.id,
            companyProfileId: matrix.id,
            title: 'Pregão Eletrônico 012/2026 - Aquisição de Equipamentos Médicos',
            portal: 'ComprasNet',
            modality: 'Pregão Eletrônico',
            status: 'Captado',
            estimatedValue: 1250000.00,
            sessionDate: new Date('2026-03-15T09:00:00Z'),
            risk: 'Baixo',
        },
    });

    // Create Admin User
    const passwordHash = await bcrypt.hash('senha123', 10);
    const adminUser = await prisma.user.upsert({
        where: { email: 'admin@licitasaas.com' },
        update: {},
        create: {
            tenantId: tenant.id,
            name: 'Admin User',
            email: 'admin@licitasaas.com',
            passwordHash,
            role: 'Administrador'
        }
    });

    // Create Sample Document
    await prisma.document.upsert({
        where: { id: 'sample-doc-id-123' },
        update: {},
        create: {
            id: 'sample-doc-id-123',
            tenantId: tenant.id,
            companyProfileId: matrix.id,
            docType: 'Certidão Negativa de Débitos Federais',
            fileName: 'cnd_federal.pdf',
            fileUrl: '/uploads/sample_cnd.pdf',
            expirationDate: new Date('2025-06-30T23:59:59Z'),
            status: 'Válido'
        }
    });

    console.log('Database seeded with initial dummy data (including Admin User and Document)!');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
