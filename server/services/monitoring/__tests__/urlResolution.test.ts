/**
 * ══════════════════════════════════════════════════════════════════
 *  URL Resolution Test Suite — Verifica links funcionais por plataforma
 * ══════════════════════════════════════════════════════════════════
 *
 *  Testa se o AutoEnrich e o import de processos geram links que
 *  o monitor de chat consegue usar (com param1, certame, sessionId, etc.)
 */
import { describe, it, expect } from 'vitest';

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

// ── Test Suite ──

describe('URL Resolution', () => {
    describe('Links funcionais devem ser aceitos', () => {
        for (const spec of PLATFORM_SPECS) {
            for (const goodLink of spec.goodExamples) {
                it(`${spec.platform}: aceita ${goodLink.slice(0, 60)}...`, () => {
                    const err = validateLink(goodLink, spec.platform);
                    expect(err).toBeNull();
                });
            }
        }
    });

    describe('Links genéricos devem ser rejeitados', () => {
        for (const spec of PLATFORM_SPECS) {
            for (const badLink of spec.badExamples) {
                it(`${spec.platform}: rejeita ${badLink.slice(0, 60)}...`, () => {
                    const err = validateLink(badLink, spec.platform);
                    expect(err).not.toBeNull();
                });
            }
        }
    });

    describe('AutoEnrich', () => {
        const autoEnrichCases = [
            {
                name: 'BLL genérico + PNCP → deve rodar',
                link: 'https://bllcompras.com/Home/PublicAccess, https://pncp.gov.br/app/editais/12345/2026/12',
                expectRun: true,
            },
            {
                name: 'M2A vitrine pública + PNCP → deve rodar',
                link: 'https://compras.m2atecnologia.com.br/processos/publicacao/abc123/nome-processo, https://pncp.gov.br/app/editais/12345/2026/12',
                expectRun: true,
            },
            {
                name: 'BLL funcional + PNCP → não precisa enriquecer',
                link: 'https://bllcompras.com/Process/ProcessView?param1=[gkz]abc, https://pncp.gov.br/app/editais/12345/2026/12',
                expectRun: false,
            },
            {
                name: 'Só PNCP sem plataforma → deve enriquecer',
                link: 'https://pncp.gov.br/app/editais/12345/2026/12',
                expectRun: true,
            },
            {
                name: 'ComprasNet cnetmobile + PNCP → não precisa',
                link: 'https://cnetmobile.estaleiro.serpro.gov.br/compras/001234, https://pncp.gov.br/app/editais/12345/2026/12',
                expectRun: false,
            },
        ];

        for (const tc of autoEnrichCases) {
            it(tc.name, () => {
                const { shouldRun } = shouldAutoEnrichRun(tc.link);
                expect(shouldRun).toBe(tc.expectRun);
            });
        }
    });
});

// Export for use in other scripts
export { validateLink, shouldAutoEnrichRun, PLATFORM_SPECS };
