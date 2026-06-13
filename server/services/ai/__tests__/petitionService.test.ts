import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generatePetitionService } from '../petitionService';
import prisma from '../../../lib/prisma';
import { callGeminiWithRetry } from '../gemini.service';

// Mock logger
vi.mock('../../../lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

// Mock prisma client
vi.mock('../../../lib/prisma', () => ({
    default: {
        biddingProcess: {
            findUnique: vi.fn()
        },
        companyProfile: {
            findUnique: vi.fn()
        }
    }
}));

// Mock gemini service
vi.mock('../gemini.service', () => ({
    callGeminiWithRetry: vi.fn(),
    GEMINI_PROFILES: {
        HIGH_INTELLIGENCE: 'gemini-2.5-pro'
    }
}));

// Mock GoogleGenAI class constructor
vi.mock('@google/genai', () => {
    return {
        GoogleGenAI: class {
            models = {};
        }
    };
});

describe('generatePetitionService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.GEMINI_API_KEY = 'test-api-key';
    });

    it('should throw error if process or company is not found', async () => {
        (prisma.biddingProcess.findUnique as any).mockResolvedValue(null);
        (prisma.companyProfile.findUnique as any).mockResolvedValue(null);

        await expect(generatePetitionService({
            biddingProcessId: 'p-1',
            companyId: 'c-1',
            templateType: 'impugnacao',
            userContext: 'fatos',
            tenantId: 't-1'
        })).rejects.toThrow('Processo licitatório ou Empresa não encontrados.');
    });

    it('should throw error if userContext is empty and no attachments are provided', async () => {
        (prisma.biddingProcess.findUnique as any).mockResolvedValue({ id: 'p-1' });
        (prisma.companyProfile.findUnique as any).mockResolvedValue({ id: 'c-1' });

        await expect(generatePetitionService({
            biddingProcessId: 'p-1',
            companyId: 'c-1',
            templateType: 'impugnacao',
            userContext: '',
            attachments: [],
            tenantId: 't-1'
        })).rejects.toThrow('Por favor, descreva os fatos ou anexe documentos de base.');
    });

    it('should successfully build prompt and invoke callGeminiWithRetry', async () => {
        const mockBidding = {
            id: 'p-1',
            title: 'Licitação Teste',
            summary: 'Objeto resumido da licitação',
            portal: 'ComprasNet',
            modality: 'Pregão Eletrônico',
            aiAnalysis: {
                id: 'a-1',
                schemaV2: {
                    process_identification: {
                        objeto_completo: 'Objeto completo do edital'
                    }
                }
            }
        };

        const mockCompany = {
            id: 'c-1',
            razaoSocial: 'Empresa Teste LTDA',
            cnpj: '12.345.678/0001-99',
            city: 'Natal/RN',
            state: 'RN',
            contactName: 'Marcos Gomes',
            contactCpf: '123.456.789-00'
        };

        (prisma.biddingProcess.findUnique as any).mockResolvedValue(mockBidding);
        (prisma.companyProfile.findUnique as any).mockResolvedValue(mockCompany);
        (callGeminiWithRetry as any).mockResolvedValue({ text: 'Petição gerada com sucesso contendo tags de assinatura' });

        const result = await generatePetitionService({
            biddingProcessId: 'p-1',
            companyId: 'c-1',
            templateType: 'impugnacao',
            userContext: 'Fatos e argumentos do usuário',
            tenantId: 't-1'
        });

        expect(result.text).toBe('Petição gerada com sucesso contendo tags de assinatura');
        expect(callGeminiWithRetry).toHaveBeenCalledTimes(1);

        // Verify call args
        const callArgs = (callGeminiWithRetry as any).mock.calls[0][1];
        expect(callArgs.model).toBe('gemini-2.5-pro');
        expect(callArgs.contents[0].parts[0].text).toContain('Fatos e argumentos do usuário');
        expect(callArgs.config.systemInstruction).toContain('[INICIO_ASSINATURA]');
        expect(callArgs.config.systemInstruction).toContain('[FIM_ASSINATURA]');
    });
});
