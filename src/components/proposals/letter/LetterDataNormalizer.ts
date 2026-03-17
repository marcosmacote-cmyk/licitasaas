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
        const processId = schemaV2?.process_identification || {};
        const contractConditions = schemaV2?.contract_conditions || {};
        const proposalAnalysis = schemaV2?.proposal_analysis || {};

        return {
            recipient: this.normalizeRecipient(bidding, schemaV2),
            reference: this.normalizeReference(bidding, processId),
            company: this.normalizeCompany(company),
            object: this.normalizeObject(bidding, schemaV2),
            pricing: this.normalizePricing(items, totalValue, input),
            commercial: this.normalizeCommercial(input, contractConditions, proposalAnalysis),
            execution: this.normalizeExecution(contractConditions),
            banking: { /* Empty — user fills manually or from future company field */ },
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
        // Campos corretos do schemaV2: orgao, unidade_compradora
        const pi = schemaV2?.process_identification || {};
        const orgao = pi.orgao
            || pi.unidade_compradora
            || (bidding as any).organ
            || '';

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
        // REGRA: Usar APENAS o objeto — sem resumo, sem análise
        // Prioridade: objeto_resumido (curto) > objeto_completo > title
        const pi = schemaV2?.process_identification || {};
        const v2Object = pi.objeto_resumido
            || pi.objeto
            || '';

        return {
            fullDescription: v2Object || bidding.title || '',
            shortDescription: bidding.title || '',
            scope: schemaV2?.contract_conditions?.escopo_detalhado,
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

        return {
            totalValue,
            totalValueExtended: currencyToWords(totalValue),
            estimatedValue: input.bidding.estimatedValue > 0 ? input.bidding.estimatedValue : undefined,
            bdiPercentage: input.bdiPercentage || input.proposal.bdiPercentage || 0,
            discountPercentage: input.discountPercentage || input.proposal.taxPercentage || 0,
            items: itemSummaries,
            itemCount: items.length,
        };
    }

    private normalizeCommercial(
        input: NormalizerInput,
        contractConditions: any,
        _proposalAnalysis?: any
    ): ProposalLetterData['commercial'] {
        return {
            validityDays: input.validityDays || input.proposal.validityDays || 60,
            paymentConditions: contractConditions?.condicoes_pagamento?.trim() || undefined,
            warrantyPercentage: contractConditions?.garantia_percentual || undefined,
            readjustmentClause: contractConditions?.clausula_reajuste || undefined,
        };
    }

    private normalizeExecution(contractConditions: any): ProposalLetterData['execution'] {
        return {
            executionLocation: contractConditions?.local_execucao?.trim() || undefined,
            executionDeadline: (contractConditions?.prazo_execucao || contractConditions?.prazo_entrega)?.trim() || undefined,
            contractDuration: contractConditions?.vigencia_contrato?.trim() || undefined,
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

        return {
            mode: (input.signatureMode || input.proposal.signatureMode || 'LEGAL') as 'LEGAL' | 'TECH' | 'BOTH',
            localDate,
            legalRepresentative: {
                name: company.contactName || '',
                cpf: company.contactCpf || '',
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
     */
    private extractTechName(techQual: string): string {
        if (!techQual) return '';
        // Usually the first line or text before the first comma
        const firstLine = techQual.split(/[,\n]/)[0].trim();
        // Remove registration numbers (CREA-XX 123456)
        return firstLine.replace(/CREA[- ]\w+\s*\d+/i, '').replace(/CAU[- ]\w+\s*\d+/i, '').trim();
    }

    /**
     * Extract CREA/CAU registration from technical qualification.
     */
    private extractTechRegistration(techQual: string): string {
        if (!techQual) return '';
        const match = techQual.match(/(CREA[- ]?\w{2}[- ]?\d+|CAU[- ]?\w{2}[- ]?\d+)/i);
        return match ? match[1] : '';
    }
}
