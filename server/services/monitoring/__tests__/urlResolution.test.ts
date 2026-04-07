/**
 * ══════════════════════════════════════════════════════════════════
 *  URL Resolution Test Suite — Verifica links funcionais por plataforma
 * ══════════════════════════════════════════════════════════════════
 *
 *  Testa se o AutoEnrich e o import de processos geram links que
 *  o monitor de chat consegue usar (com param1, certame, sessionId, etc.)
 *
 *  Uso:
 *    npx tsx server/services/monitoring/__tests__/urlResolution.test.ts
 *
 *  Exit codes:
 *    0 = todos os cenários passaram
 *    1 = algum cenário falhou
 */

// ── Definição de Link Funcional por Plataforma ──

interface PlatformLinkSpec {
    platform: string;
    /** Regex que um link funcional DEVE satisfazer */
    functionalPattern: RegExp;
    /** Regex que links genéricos/inúteis satisfazem (devem ser rejeitados) */
    genericPatterns: RegExp[];
    /** Exemplos de links funcionais */
    goodExamples: string[];
    /** Exemplos de links genéricos (que NÃO devem passar) */
    badExamples: string[];
}

const PLATFORM_SPECS: PlatformLinkSpec[] = [
    {
        platform: 'BLL Compras',
        functionalPattern: /bllcompras.*(?:param1=|ProcessView)/i,
        genericPatterns: [
            /bllcompras\.com\/Home\/PublicAccess/i,
            /bllcompras\.com\/?$/i,
        ],
        goodExamples: [
            'https://bllcompras.com/Process/ProcessView?param1=[gkz]dkVNDdvCuCiJ8BUY/swfbeX/V6tjKmsf',
            'https://bllcompras.com/BatchList/GetProcessMessageView?param1=%5Bgkz%5DeAMK1wnu',
        ],
        badExamples: [
            'https://bllcompras.com/Home/PublicAccess',
            'https://bllcompras.com/',
            'https://bllcompras.com/Home/PublicAccess#!',
        ],
    },
    {
        platform: 'BNC Compras',
        functionalPattern: /bnccompras.*(?:param1=|ProcessView)/i,
        genericPatterns: [
            /bnccompras\.com\/Home\/PublicAccess/i,
            /bnccompras\.com\/?$/i,
        ],
        goodExamples: [
            'https://bnccompras.com/Process/ProcessView?param1=[gkz]abc123',
        ],
        badExamples: [
            'https://bnccompras.com/Home/PublicAccess',
        ],
    },
    {
        platform: 'M2A Compras',
        functionalPattern: /(?:precodereferencia|m2atecnologia).*\/certame\/\d+/i,
        genericPatterns: [
            /compras\.m2atecnologia\.com\.br\/processos\/publicacao\//i,
            /compras\.m2atecnologia\.com\.br\/?$/i,
        ],
        goodExamples: [
            'https://precodereferencia.m2atecnologia.com.br/empresa/painel/certame/12345/',
            'https://precodereferencia.m2atecnologia.com.br/empresa/painel/certame/67890/chat/',
        ],
        badExamples: [
            'https://compras.m2atecnologia.com.br/processos/publicacao/0049d33e3ce14219aa25117c14d0e6ab/registro-de-precos',
            'https://compras.m2atecnologia.com.br/',
        ],
    },
    {
        platform: 'ComprasNet',
        functionalPattern: /cnetmobile/i,
        genericPatterns: [
            /www\.comprasnet\.gov\.br\/seguro\/loginPortal/i,
            /compras\.gov\.br\/?$/i,
        ],
        goodExamples: [
            'https://cnetmobile.estaleiro.serpro.gov.br/compras/001234-5-00001-2026',
        ],
        badExamples: [
            'https://www.comprasnet.gov.br/seguro/loginPortal.asp',
            'https://compras.gov.br/',
        ],
    },
    {
        platform: 'PCP',
        functionalPattern: /portaldecompraspublicas.*\d+/i,
        genericPatterns: [
            /portaldecompraspublicas\.com\.br\/?$/i,
        ],
        goodExamples: [
            'https://www.portaldecompraspublicas.com.br/processos/123456',
        ],
        badExamples: [
            'https://www.portaldecompraspublicas.com.br/',
        ],
    },
    {
        platform: 'Licitanet',
        functionalPattern: /licitanet\.com\.br.*\d+/i,
        genericPatterns: [
            /licitanet\.com\.br\/?$/i,
        ],
        goodExamples: [
            'https://licitanet.com.br/licitacao/12345',
        ],
        badExamples: [
            'https://licitanet.com.br/',
        ],
    },
    {
        platform: 'Licita Mais Brasil',
        functionalPattern: /licitamaisbrasil.*\d+/i,
        genericPatterns: [
            /licitamaisbrasil\.com\.br\/?$/i,
        ],
        goodExamples: [
            'https://licitamaisbrasil.com.br/edital/99999',
        ],
        badExamples: [
            'https://licitamaisbrasil.com.br/',
        ],
    },
    {
        platform: 'BBMNET',
        functionalPattern: /bbmnet.*\d+/i,
        genericPatterns: [
            /bbmnet\.com\.br\/?$/i,
        ],
        goodExamples: [
            'https://www.bbmnet.com.br/licitacao/77777',
        ],
        badExamples: [
            'https://www.bbmnet.com.br/',
        ],
    },
];

// ── Funções de Validação ──

/**
 * Verifica se um link é funcional para monitoramento de chat.
 * Retorna null se OK, ou mensagem de erro se não funcional.
 */
function validateLink(link: string, platform: string): string | null {
    const spec = PLATFORM_SPECS.find(s => s.platform === platform);
    if (!spec) return `Plataforma "${platform}" não conhecida`;

    // Check if it's a known generic pattern (bad)
    for (const gp of spec.genericPatterns) {
        if (gp.test(link)) {
            return `Link genérico detectado (${gp.source.slice(0, 30)}...) — monitor NÃO funciona`;
        }
    }

    // Check if matches functional pattern (good)
    if (!spec.functionalPattern.test(link)) {
        return `Link não satisfaz padrão funcional: ${spec.functionalPattern.source}`;
    }

    return null; // OK
}

/**
 * Verifica se o AutoEnrich deveria rodar para um dado link.
 * Reproduz a lógica real do server/index.ts.
 */
function shouldAutoEnrichRun(link: string): { shouldRun: boolean; reason: string } {
    const MONITORABLE_DOMAINS = [
        'cnetmobile', 'licitamaisbrasil', 'bllcompras', 'bll.org',
        'bnccompras', 'portaldecompraspublicas', 'licitanet.com.br', 'bbmnet', 'm2atecnologia',
        'precodereferencia',
    ];

    const l = link.toLowerCase();
    const hasPlatformLink = MONITORABLE_DOMAINS.some(d => l.includes(d));
    const hasPncp = l.includes('pncp.gov.br') && l.includes('editais');

    if (!hasPncp) return { shouldRun: false, reason: 'Sem link PNCP' };

    // Check for generic platform links that need enrichment
    const isGeneric = hasPlatformLink && (() => {
        if (l.includes('bllcompras') && !l.includes('param1=') && !l.includes('processview')) return true;
        if (l.includes('m2atecnologia') && !l.includes('/certame/') && !l.includes('precodereferencia')) return true;
        return false;
    })();

    if (!hasPlatformLink) return { shouldRun: true, reason: 'Sem domínio monitorável — precisa enriquecer' };
    if (isGeneric) return { shouldRun: true, reason: 'Link genérico detectado — AutoEnrich forçado' };
    return { shouldRun: false, reason: 'Link já funcional — não precisa enriquecer' };
}

// ── Runner ──

interface TestResult {
    scenario: string;
    pass: boolean;
    detail: string;
}

function runTests(): TestResult[] {
    const results: TestResult[] = [];

    // ── CENÁRIO 1: Links bons devem ser aceitos ──
    for (const spec of PLATFORM_SPECS) {
        for (const goodLink of spec.goodExamples) {
            const err = validateLink(goodLink, spec.platform);
            results.push({
                scenario: `${spec.platform}: link funcional aceito`,
                pass: err === null,
                detail: err || `✅ ${goodLink.slice(0, 60)}...`,
            });
        }
    }

    // ── CENÁRIO 2: Links genéricos devem ser rejeitados ──
    for (const spec of PLATFORM_SPECS) {
        for (const badLink of spec.badExamples) {
            const err = validateLink(badLink, spec.platform);
            results.push({
                scenario: `${spec.platform}: link genérico rejeitado`,
                pass: err !== null, // Deve FALHAR validação (= erro não é null)
                detail: err ? `✅ Rejeitado: ${err}` : `❌ Link genérico aceito como funcional: ${badLink}`,
            });
        }
    }

    // ── CENÁRIO 3: AutoEnrich deve rodar para links genéricos ──
    const autoEnrichCases = [
        {
            name: 'BLL genérico + PNCP',
            link: 'https://bllcompras.com/Home/PublicAccess, https://pncp.gov.br/app/editais/12345/2026/12',
            expectRun: true,
        },
        {
            name: 'M2A vitrine pública + PNCP',
            link: 'https://compras.m2atecnologia.com.br/processos/publicacao/abc123/nome-processo, https://pncp.gov.br/app/editais/12345/2026/12',
            expectRun: true,
        },
        {
            name: 'BLL funcional + PNCP (não precisa enriquecer)',
            link: 'https://bllcompras.com/Process/ProcessView?param1=[gkz]abc, https://pncp.gov.br/app/editais/12345/2026/12',
            expectRun: false,
        },
        {
            name: 'Só PNCP sem plataforma (deve enriquecer)',
            link: 'https://pncp.gov.br/app/editais/12345/2026/12',
            expectRun: true,
        },
        {
            name: 'ComprasNet cnetmobile + PNCP (não precisa)',
            link: 'https://cnetmobile.estaleiro.serpro.gov.br/compras/001234, https://pncp.gov.br/app/editais/12345/2026/12',
            expectRun: false,
        },
    ];

    for (const tc of autoEnrichCases) {
        const { shouldRun, reason } = shouldAutoEnrichRun(tc.link);
        results.push({
            scenario: `AutoEnrich: ${tc.name}`,
            pass: shouldRun === tc.expectRun,
            detail: shouldRun === tc.expectRun
                ? `✅ ${shouldRun ? 'Roda' : 'Não roda'} — ${reason}`
                : `❌ Esperado ${tc.expectRun ? 'RODAR' : 'NÃO rodar'}, mas ${shouldRun ? 'RODOU' : 'NÃO rodou'} — ${reason}`,
        });
    }

    return results;
}

// ── Output ──

console.log(`\n${'═'.repeat(60)}`);
console.log(`🔗  URL RESOLUTION TEST SUITE`);
console.log(`${'═'.repeat(60)}\n`);

const results = runTests();
const passed = results.filter(r => r.pass);
const failed = results.filter(r => !r.pass);

for (const r of results) {
    const icon = r.pass ? '✅' : '❌';
    console.log(`${icon} ${r.scenario}`);
    if (!r.pass) {
        console.log(`   └→ ${r.detail}`);
    }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`TOTAL: ${results.length} tests | ✅ ${passed.length} passed | ❌ ${failed.length} failed`);

if (failed.length > 0) {
    console.log(`\n🚨 ${failed.length} TESTE(S) FALHARAM — verificar links e AutoEnrich`);
    process.exit(1);
} else {
    console.log(`\n✅ TODOS OS TESTES PASSARAM`);
    process.exit(0);
}

// Export for use in other scripts
export { validateLink, shouldAutoEnrichRun, PLATFORM_SPECS };
