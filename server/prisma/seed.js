const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding database...');

    // 1. Create a Root Tenant
    const tenant = await prisma.tenant.upsert({
        where: { rootCnpj: '00.000.000/0001-91' },
        update: {},
        create: {
            rootCnpj: '00.000.000/0001-91',
            razaoSocial: 'LicitaSaaS Root',
        },
    });

    console.log('Tenant created:', tenant.id);

    // 2. Create a Root User
    const passwordHash = await bcrypt.hash('senha123', 10);
    const user = await prisma.user.upsert({
        where: { email: 'admin@licitasaas.com' },
        update: { passwordHash },
        create: {
            email: 'admin@licitasaas.com',
            name: 'Administrador Root',
            passwordHash,
            role: 'Admin',
            tenantId: tenant.id,
        },
    });

    console.log('User created:', user.email);
    console.log('Database seeded successfully!');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
