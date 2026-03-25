const fs = require('fs');
const path = require('path');

// Load .env manually
const envPath = path.join(__dirname, 'server/.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
});

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const m2aProcesses = await prisma.biddingProcess.findMany({
    where: {
      isMonitored: true,
      OR: [
        { portal: { contains: 'm2a', mode: 'insensitive' } },
        { link: { contains: 'm2atecnologia', mode: 'insensitive' } },
      ]
    },
    select: { id: true, title: true, portal: true, link: true, tenantId: true, isMonitored: true }
  });
  console.log('M2A Monitored:', m2aProcesses.length);
  m2aProcesses.forEach(p => {
    console.log(`  id=${p.id.substring(0,12)} tenant=${p.tenantId.substring(0,8)} portal=${p.portal} monitored=${p.isMonitored}`);
    console.log(`    title=${(p.title||'').substring(0,60)}`);
  });

  // All M2A
  const allM2A = await prisma.biddingProcess.findMany({
    where: {
      OR: [
        { portal: { contains: 'm2a', mode: 'insensitive' } },
        { link: { contains: 'm2atecnologia', mode: 'insensitive' } },
      ]
    },
    select: { id: true, portal: true, isMonitored: true, tenantId: true, title: true }
  });
  console.log('\nAll M2A (monitored or not):', allM2A.length);
  allM2A.forEach(p => {
    console.log(`  id=${p.id.substring(0,12)} monitored=${p.isMonitored} portal=${p.portal}`);
    console.log(`    title=${(p.title||'').substring(0,60)}`);
  });

  if (m2aProcesses.length > 0) {
    const tenantId = m2aProcesses[0].tenantId;
    const allForTenant = await prisma.biddingProcess.findMany({
      where: { tenantId, OR: [{ isMonitored: true }, { chatMonitorLogs: { some: {} } }] },
      select: { id: true, portal: true, isMonitored: true }
    });
    console.log('\nTotal in /processes for tenant:', allForTenant.length);
    const m2aInList = allForTenant.filter(p => (p.portal||'').toLowerCase().includes('m2a'));
    console.log('M2A in list:', m2aInList.length);
    m2aInList.forEach(p => console.log(`  id=${p.id.substring(0,12)} portal=${p.portal} monitored=${p.isMonitored}`));

    // Check if archived
    const archivedLogs = await prisma.chatMonitorLog.findMany({
      where: { tenantId, isArchived: true },
      select: { biddingProcessId: true },
      distinct: ['biddingProcessId'],
    });
    const archivedSet = new Set(archivedLogs.map(k => k.biddingProcessId));
    const m2aArchived = m2aProcesses.filter(p => archivedSet.has(p.id));
    console.log('\nM2A archived:', m2aArchived.length);
  }
  await prisma.$disconnect();
}
check().catch(e => { console.error(e.message); process.exit(1); });
