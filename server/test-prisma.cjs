const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        console.log("Connecting...");
        const users = await prisma.user.findMany();
        console.log("Users:", users.length);
        console.log(users.map(u => ({ email: u.email, id: u.id })));
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await prisma.$disconnect();
    }
}
run();
