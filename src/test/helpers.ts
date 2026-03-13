import type { BiddingProcess, CompanyProfile, AiAnalysis, ProposalItem, PriceProposal } from '../types';

// ── Mock Toast ──
export const mockToast = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
};

// NOTE: Each test file must mock '../ui' with its own vi.mock() call
// using the correct relative path from its location.

// ── Factory: BiddingProcess ──
export function createBidding(overrides: Partial<BiddingProcess> = {}): BiddingProcess {
    return {
        id: `bid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title: 'Pregão Eletrônico 001/2026',
        summary: 'Contratação de serviços de TI',
        status: 'Captado',
        estimatedValue: 100000,
        sessionDate: '2026-04-01T10:00:00.000Z',
        modality: 'Pregão Eletrônico',
        portal: 'ComprasNet',
        risk: 'Baixo',
        link: '',
        companyProfileId: 'comp-1',
        observations: '[]',
        ...overrides,
    };
}

// ── Factory: CompanyProfile ──
export function createCompany(overrides: Partial<CompanyProfile> = {}): CompanyProfile {
    return {
        id: `comp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        cnpj: '12.345.678/0001-99',
        razaoSocial: 'TechCorp Ltda',
        isHeadquarters: true,
        contactName: 'João Silva',
        contactEmail: 'joao@techcorp.com',
        contactPhone: '(11) 99999-9999',
        qualification: 'TechCorp Ltda, sediada na Rua da Consolação, 123, São Paulo/SP, neste ato representada por seu Sócio Administrador, o Sr. João Silva, CPF nº: 123.456.789-00',
        address: 'Rua da Consolação, 123',
        city: 'São Paulo',
        state: 'SP',
        ...overrides,
    };
}

// ── Factory: AiAnalysis ──
export function createAnalysis(overrides: Partial<AiAnalysis> = {}): AiAnalysis {
    return {
        id: `analysis-1`,
        biddingProcessId: 'bid-1',
        requiredDocuments: JSON.stringify({
            'Habilitação Jurídica': [{ item: '1', description: 'Contrato Social' }],
            'Regularidade Fiscal, Social e Trabalhista': [{ item: '2', description: 'CND Federal' }],
        }),
        pricingConsiderations: 'Preço por unidade',
        irregularitiesFlags: JSON.stringify(['Prazo curto para impugnação']),
        fullSummary: 'Resumo completo da licitação de TI',
        deadlines: JSON.stringify(['Impugnação: 01/04/2026']),
        penalties: 'Multa de 10% sobre valor total',
        qualificationRequirements: 'Atestado de capacidade técnica',
        analyzedAt: new Date().toISOString(),
        ...overrides,
    };
}

// ── Factory: ProposalItem ──
export function createProposalItem(overrides: Partial<ProposalItem> = {}): ProposalItem {
    return {
        id: `item-${Date.now()}`,
        proposalId: 'prop-1',
        itemNumber: '1',
        description: 'Serviço de manutenção',
        unit: 'UN',
        quantity: 10,
        multiplier: 1,
        unitCost: 100,
        unitPrice: 110,
        totalPrice: 1100,
        sortOrder: 0,
        ...overrides,
    };
}

// ── Factory: PriceProposal ──
export function createProposal(overrides: Partial<PriceProposal> = {}): PriceProposal {
    return {
        id: `prop-${Date.now()}`,
        tenantId: 'tenant-1',
        biddingProcessId: 'bid-1',
        companyProfileId: 'comp-1',
        version: 1,
        status: 'draft',
        bdiPercentage: 25,
        taxPercentage: 0,
        socialCharges: 0,
        totalValue: 5000,
        signatureMode: 'LEGAL',
        validityDays: 60,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [],
        ...overrides,
    };
}

// ── Fetch Helpers ──
export function mockFetchSuccess(data: any = {}, status = 200) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(data),
        text: () => Promise.resolve(JSON.stringify(data)),
    });
}

export function mockFetchError(error: string = 'Server Error', status = 500) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status,
        json: () => Promise.resolve({ error }),
        text: () => Promise.resolve(JSON.stringify({ error })),
    });
}

export function mockFetchNetworkError() {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network Error'));
}

export function resetMocks() {
    vi.clearAllMocks();
    (global.fetch as ReturnType<typeof vi.fn>).mockReset();
    Object.values(mockToast).forEach(fn => fn.mockClear());
}
