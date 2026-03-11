/**
 * Script auxiliar para listar os processos monitorados e seus dados.
 * 
 * USO: 
 *   1. Obtenha seu token JWT (DevTools → Network → Authorization header)
 *   2. Cole abaixo
 *   3. node list-processes.js
 */

const API_URL = 'https://licitasaas-production.up.railway.app';
const TOKEN = 'SEU_TOKEN_AQUI'; // Cole seu token JWT

async function main() {
  console.log('📋 Buscando processos monitorados...\n');

  const res = await fetch(`${API_URL}/api/chat-monitor/processes`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  });

  if (!res.ok) {
    console.error(`❌ Erro ${res.status}: ${res.statusText}`);
    if (res.status === 401) {
      console.log('   Token inválido. Abra LicitaSaaS → F12 → Network → copie Authorization header');
    }
    process.exit(1);
  }

  const processes = await res.json();
  
  console.log(`Encontrados ${processes.length} processo(s):\n`);

  // Fetch full details for each
  for (const p of processes) {
    const detailRes = await fetch(`${API_URL}/api/bidding-processes/${p.id}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const detail = detailRes.ok ? await detailRes.json() : {};

    console.log(`  ─ ${p.title?.substring(0, 60)}`);
    console.log(`    id: "${p.id}"`);
    console.log(`    uasg: "${detail.uasg || p.uasg || ''}"`);
    console.log(`    modalityCode: "${detail.modalityCode || ''}"`);
    console.log(`    processNumber: "${detail.processNumber || ''}"`);
    console.log(`    processYear: "${detail.processYear || ''}"`);
    console.log(`    portal: ${p.portal}`);
    console.log(`    isMonitored: ${p.isMonitored}`);
    console.log(`    totalMessages: ${p.totalMessages}`);

    const hasComprasNet = detail.uasg && detail.modalityCode && detail.processNumber && detail.processYear;
    console.log(`    ComprasNet ready: ${hasComprasNet ? '✅' : '❌ Faltam dados'}`);
    console.log('');
  }

  console.log('\n📌 Copie os processos com "ComprasNet ready: ✅" para CONFIG.PROCESSES no watcher.js');
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
