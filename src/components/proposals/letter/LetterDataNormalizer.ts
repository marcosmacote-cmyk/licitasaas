/**
 * ══════════════════════════════════════════════════════════════
 * LetterDataNormalizer
 * Coleta dados brutos de BiddingProcess, CompanyProfile, AiAnalysis,
 * ProposalItems e PriceProposal e normaliza em ProposalLetterData.
 * ══════════════════════════════════════════════════════════════
 */

import type { BiddingProcess, CompanyProfile, ProposalItem, PriceProposal } from '../../../types';
import type { ProposalLetterData, ProposalItemSummary } from './types';
import { currencyToWords } from './utils/numberToWords';

interface NormalizerInput {
    bidding: BiddingProcess;
    company: CompanyProfile;
    proposal: PriceProposal;
    items: ProposalItem[];
    totalValue: number;
    signatureMode?: 'LEGAL' | 'TECH' | 'BOTH';
    validityDays?: number;
    bdiPercentage?: number;
    discountPercentage?: number;
    bankingData?: {
        bank?: string;
        agency?: string;
        account?: string;
        accountType?: string;
        pix?: string;
    };
}

export class LetterDataNormalizer {

    /**
     * Normaliza dados brutos do sistema em ProposalLetterData.
     */
    normalize(input: NormalizerInput): ProposalLetterData {
        const { bidding, company, proposal, items, totalValue } = input;
        const analysis = bidding.aiAnalysis;
        const schemaV2 = analysis?.schemaV2 as any;

        // ── Extract structured data from V2 schema ──
        // IMPORTANTE: Os nomes dos nós devem corresponder EXATAMENTE
        // ao AnalysisSchemaV1 definido em analysis-schema-v1.ts
        const processId = schemaV2?.process_identification || {};
        const contractual = schemaV2?.contractual_analysis || {};
        const proposalAnalysis = schemaV2?.proposal_analysis || {};

        return {
            recipient: this.normalizeRecipient(bidding, schemaV2),
            reference: this.normalizeReference(bidding, processId),
            company: this.normalizeCompany(company),
            object: this.normalizeObject(bidding, schemaV2),
            pricing: this.normalizePricing(items, totalValue, input),
            commercial: this.normalizeCommercial(input, contractual, proposalAnalysis),
            execution: this.normalizeExecution(contractual, processId, bidding),
            banking: input.bankingData || {},
            signature: this.normalizeSignature(company, input),
            meta: {
                proposalId: proposal.id,
                proposalVersion: proposal.version,
                biddingProcessId: bidding.id,
                generatedAt: new Date().toISOString(),
                aiModel: analysis?.modelUsed,
            },
        };
    }

    // ════════════════════════════════════════
    // Normalizers per section
    // ════════════════════════════════════════

    private normalizeRecipient(bidding: BiddingProcess, schemaV2: any): ProposalLetterData['recipient'] {
        // Campos corretos do AnalysisSchemaV1.ProcessIdentification:
        //   orgao, unidade_compradora
        const pi = schemaV2?.process_identification || {};
        let orgao = (pi.orgao || '').trim()
            || (pi.unidade_compradora || '').trim()
            || '';

        // Fallback: extrair órgão do título do bidding
        // Padrão legacyProcess: "Modalidade Nº - NomeDoÓrgão"
        if (!orgao && bidding.title) {
            const titleParts = bidding.title.split(' - ');
            if (titleParts.length >= 2) {
                orgao = titleParts.slice(1).join(' - ').trim();
            }
        }

        // Determine if "Pregoeiro" or "Agente de Contratação" based on modality
        const mod = (bidding.modality || '').toLowerCase();
        const isPregao = mod.includes('pregão') || mod.includes('pregao');
        const title = isPregao ? 'Pregoeiro(a)' : 'Agente de Contratação';

        return { title, orgao };
    }

    private normalizeReference(bidding: BiddingProcess, processId: any): ProposalLetterData['reference'] {
        return {
            modalidade: bidding.modality || processId?.modalidade || '',
            numero: processId?.numero_edital
                || bidding.processNumber
                || this.extractEditalNumber(bidding.title)
                || '',
            processo: processId?.numero_processo
                || '',
            ano: processId?.ano
                || bidding.processYear
                || new Date().getFullYear().toString(),
            portal: bidding.portal || 'PNCP',
            linkSistema: bidding.link,
        };
    }

    private normalizeCompany(company: CompanyProfile): ProposalLetterData['company'] {
        const derived = this.deriveCityState(company);

        return {
            razaoSocial: company.razaoSocial || '',
            cnpj: company.cnpj || '',
            qualification: company.qualification || '',
            contactName: company.contactName || '',
            contactCpf: company.contactCpf || '',
            technicalResponsible: company.technicalQualification ? this.extractTechName(company.technicalQualification) : undefined,
            technicalRegistration: company.technicalQualification ? this.extractTechRegistration(company.technicalQualification) : undefined,
            address: company.address,
            city: company.city || derived.city,
            state: company.state || derived.state,
            phone: company.contactPhone,
            email: company.contactEmail,
        };
    }

    private normalizeObject(bidding: BiddingProcess, schemaV2: any): ProposalLetterData['object'] {
        // REGRA: Usar o OBJETO da licitação — sem o resumo geral da análise.
        // Campos do AnalysisSchemaV1.ProcessIdentification:
        //   objeto_completo: "transcrição integral" (texto real do edital)
        //   objeto_resumido: "até 150 caracteres" (título curto)
        const pi = schemaV2?.process_identification || {};
        const objCompleto = (pi.objeto_completo || '').trim();
        const objResumido = (pi.objeto_resumido || '').trim();

        // Fallback: extrair objeto do bidding.summary
        // O summary legacyProcess começa com "{objeto_completo}\n\nModalidade:"
        // IMPORTANTE: objeto_resumido pode conter apenas a referência do certame
        // (ex: "Concorrência nº X - Órgão") e NÃO a descrição real do objeto.
        // Por isso, SEMPRE tentamos extrair do summary quando objeto_completo está vazio.
        let summaryObject = '';
        if (!objCompleto && bidding.summary) {
            const parts = bidding.summary.split(/\n\n(?=Modalidade:)/);
            if (parts.length >= 2 && parts[0].trim().length > 30) {
                summaryObject = parts[0].trim();
            }
        }

        // Escolha: objeto_completo > summaryObject (se mais substancial) > objeto_resumido > title
        // O summaryObject prevalece sobre objResumido porque geralmente contém
        // a descrição real do objeto, não apenas a referência do certame.
        const fullDesc = objCompleto
            || (summaryObject.length > (objResumido.length + 20) ? summaryObject : '')
            || objResumido
            || summaryObject
            || bidding.title
            || '';

        return {
            fullDescription: fullDesc,
            shortDescription: objResumido || bidding.title || '',
            scope: schemaV2?.contractual_analysis?.prazo_execucao,
        };
    }

    private normalizePricing(
        items: ProposalItem[],
        totalValue: number,
        input: NormalizerInput
    ): ProposalLetterData['pricing'] {
        const itemSummaries: ProposalItemSummary[] = items.map(it => ({
            itemNumber: it.itemNumber,
            description: it.description?.substring(0, 120) || '',
            unit: it.unit,
            quantity: it.quantity,
            multiplier: it.multiplier || 1,
            unitPrice: it.unitPrice,
            totalPrice: it.totalPrice,
        }));

        // Desconto total real: diferença entre referência e total atual
        const refTotal = items.reduce((sum, it) => sum + ((it.quantity || 0) * (it.multiplier || 1) * (it.referencePrice || it.unitCost || 0)), 0);
        const totalDiscountPct = refTotal > 0 ? ((refTotal - totalValue) / refTotal * 100) : 0;

        return {
            totalValue,
            totalValueExtended: currencyToWords(totalValue),
            estimatedValue: input.bidding.estimatedValue > 0 ? input.bidding.estimatedValue : undefined,
            bdiPercentage: input.bdiPercentage || input.proposal.bdiPercentage || 0,
            discountPercentage: input.discountPercentage || input.proposal.taxPercentage || 0,
            totalDiscountPercentage: totalDiscountPct > 0 ? totalDiscountPct : 0,
            items: itemSummaries,
            itemCount: items.length,
        };
    }

    private normalizeCommercial(
        input: NormalizerInput,
        contractual: any,
        _proposalAnalysis?: any
    ): ProposalLetterData['commercial'] {
        // Campos corretos do AnalysisSchemaV1.ContractualAnalysis:
        //   medicao_pagamento, reajuste, repactuacao, penalidades
        return {
            validityDays: input.validityDays || input.proposal.validityDays || 60,
            paymentConditions: (contractual?.medicao_pagamento || '').trim() || undefined,
            warrantyPercentage: undefined,
            readjustmentClause: (contractual?.reajuste || '').trim() || undefined,
        };
    }

    private normalizeExecution(
        contractual: any,
        processId: any,
        bidding: BiddingProcess
    ): ProposalLetterData['execution'] {
        // Campos corretos do AnalysisSchemaV1.ContractualAnalysis:
        //   prazo_execucao, prazo_vigencia
        // AnalysisSchemaV1.ProcessIdentification:
        //   municipio_uf (para local de execução)
        let executionDeadline = (contractual?.prazo_execucao || '').trim() || undefined;
        let contractDuration = (contractual?.prazo_vigencia || '').trim() || undefined;
        let executionLocation = (processId?.municipio_uf || '').trim() || undefined;

        // Fallback: extrair prazos do fullSummary ou summary
        if (!executionDeadline || !contractDuration) {
            const fullText = bidding.aiAnalysis?.fullSummary || bidding.summary || '';
            if (!executionDeadline) {
                executionDeadline = this.extractFromText(fullText, /prazo\s*(?:de\s*)?execu[cç][aã]o[:\s]+([^\n.;]+)/i);
            }
            if (!contractDuration) {
                contractDuration = this.extractFromText(fullText, /(?:prazo\s*(?:de\s*)?vig[eê]ncia|dura[cç][aã]o\s*(?:do\s*)?contrato)[:\s]+([^\n.;]+)/i);
            }
        }

        return {
            executionLocation,
            executionDeadline,
            contractDuration,
        };
    }

    private normalizeSignature(
        company: CompanyProfile,
        input: NormalizerInput
    ): ProposalLetterData['signature'] {
        const derived = this.deriveCityState(company);
        const city = company.city || derived.city;
        const state = company.state || derived.state;

        const now = new Date();
        const dateStr = new Intl.DateTimeFormat('pt-BR', {
            day: '2-digit', month: 'long', year: 'numeric'
        }).format(now);

        const locParts = [city, state].filter(Boolean);
        const localDate = locParts.length > 0
            ? `${locParts.join('/')}, ${dateStr}`
            : dateStr;

        // Extrair nome e CPF (proteger contra CPF embutido no contactName)
        let contactName = company.contactName || '';
        let contactCpf = company.contactCpf || '';
        if (contactName && /CPF/i.test(contactName)) {
            const cpfInName = contactName.match(/CPF[:\s]*([0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2})/i);
            if (cpfInName) {
                if (!contactCpf) contactCpf = cpfInName[1];
                contactName = contactName.replace(/\s*CPF[:\s]*[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}/i, '').trim();
            }
        }

        return {
            mode: (input.signatureMode || input.proposal.signatureMode || 'LEGAL') as 'LEGAL' | 'TECH' | 'BOTH',
            localDate,
            legalRepresentative: {
                name: contactName,
                cpf: contactCpf,
                role: 'Representante Legal',
            },
            technicalRepresentative: company.technicalQualification ? {
                name: this.extractTechName(company.technicalQualification),
                registration: this.extractTechRegistration(company.technicalQualification),
                role: 'Responsável Técnico',
            } : undefined,
        };
    }

    // ════════════════════════════════════════
    // DERIVATION HELPERS
    // ════════════════════════════════════════

    /**
     * Extracts a value from text using a regex pattern.
     * Returns the first capture group or undefined.
     */
    private extractFromText(text: string, pattern: RegExp): string | undefined {
        if (!text) return undefined;
        const match = text.match(pattern);
        return match?.[1]?.trim() || undefined;
    }

    /**
     * Tries to derive city/state from qualification text.
     * Moves fragile regex logic from exportServices.ts to a centralized place.
     */
    private deriveCityState(company: CompanyProfile): { city: string; state: string } {
        if (company.city && company.state) {
            return { city: company.city, state: company.state };
        }

        if (!company.qualification) return { city: '', state: '' };

        const qual = company.qualification;

        // Pattern: "..., Cidade/UF, ..." or "..., Cidade - UF ..."
        const cityMatch = qual.match(
            /,\s*([^,.(0-9\-]{3,30})\s*[/|-]\s*([A-Z]{2})(?=\s*,|\s+CEP|\s+inscrita|\s*neste|$)/i
        );
        if (cityMatch) {
            return { city: cityMatch[1].trim(), state: cityMatch[2].trim().toUpperCase() };
        }

        // Fallback: look for " em CIDADE/UF"
        const altMatch = qual.match(/em\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[a-zà-ú]+)*)\s*[/-]\s*([A-Z]{2})/);
        if (altMatch) {
            return { city: altMatch[1].trim(), state: altMatch[2].trim() };
        }

        return { city: '', state: '' };
    }

    /**
     * Extract edital number from title (fallback).
     * Looks for patterns like "nº 045/2026" or "045/2026" or "#045"
     */
    private extractEditalNumber(title: string): string {
        if (!title) return '';
        const match = title.match(/(?:n[ºo°]?\s*)(\d{1,5})(?:\/\d{4})?/i);
        return match ? match[1] : '';
    }

    /**
     * Extract technical responsible name from qualification text.
     * Handles: "Maria Marize Chaves Maciel Cra Nº 8021 - RPN Nº 0602019311"
     */
    private extractTechName(techQual: string): string {
        if (!techQual) return '';
        // Remove registration patterns (CREA/CAU/CRA/CONFEA + optional RPN/D)
        const regRe = /\s*(?:CREA|CAU|CRA|CONFEA)[-\s]*[A-Z]{0,2}[\s-]*(?:N[ºo°]?\s*)?[\d./-]+(?:\s*[-–]\s*(?:RPN|D)\s*(?:N[ºo°]?\s*)?[\d./-]+)?.*/i;
        const cleaned = techQual.replace(regRe, '').trim();
        // Take first line
        const firstLine = cleaned.split(/[\n]/)[0].trim();
        return firstLine || techQual.split(/[,\n]/)[0].trim();
    }

    /**
     * Extract CREA/CAU/CRA registration from technical qualification.
     * Handles: "CRA Nº 8021 - RPN Nº 0602019311", "CREA-CE 12345"
     */
    private extractTechRegistration(techQual: string): string {
        if (!techQual) return '';
        const match = techQual.match(/((?:CREA|CAU|CRA|CONFEA)[-\s]*[A-Z]{0,2}[\s-]*(?:N[ºo°]?\s*)?[\d./-]+(?:\s*[-–]\s*(?:RPN|D)\s*(?:N[ºo°]?\s*)?[\d./-]+)?)/i);
        return match ? match[1].trim() : '';
    }
}
