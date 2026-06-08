import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const tenants = await prisma.tenant.findMany();
  console.log("TENANTS:", tenants.map(t => ({ id: t.id, razaoSocial: t.razaoSocial, cnpj: t.rootCnpj })));
  
  const users = await prisma.user.findMany();
  console.log("USERS:", users.map(u => ({ id: u.id, tenantId: u.tenantId, email: u.email })));
  
  const companies = await prisma.companyProfile.findMany();
  console.log("COMPANIES:", companies.map(c => ({ id: c.id, tenantId: c.tenantId, razaoSocial: c.razaoSocial })));

  const biddings = await prisma.biddingProcess.findMany({
    include: { aiAnalysis: true }
  });
  console.log("BIDDINGS COUNT:", biddings.length);
  console.log("BIDDINGS:", biddings.map(b => ({
    id: b.id,
    tenantId: b.tenantId,
    title: b.title,
    hasAnalysis: !!b.aiAnalysis,
  })));
}
run().catch(console.error).finally(() => prisma.$disconnect());
