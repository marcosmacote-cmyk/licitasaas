import { useState, useEffect, useMemo } from 'react';
import type { AiAnalysis, BiddingProcess, CompanyDocument } from '../../types';
import { API_BASE_URL } from '../../config';

interface UseAiReportOptions {
    analysis: AiAnalysis;
    process: BiddingProcess;
}

export function useAiReport({ analysis, process }: UseAiReportOptions) {
    const parseArray = (data: any): string[] => {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        try {
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) return parsed;
            return typeof parsed === 'string' ? [parsed] : [];
        } catch {
            return typeof data === 'string' ? [data] : [];
        }
    };

    const renderTextValue = (val: any): string => {
        if (val === null || val === undefined) return '';
        if (typeof val === 'string') return val;
        try { return JSON.stringify(val, null, 2); }
        catch { return String(val); }
    };

    const flagList = parseArray(analysis?.irregularitiesFlags);
    const deadlineList = parseArray(analysis?.deadlines || []);

    // Company docs for readiness matching
    const [companyDocs, setCompanyDocs] = useState<CompanyDocument[]>([]);
    const [isLoadingDocs, setIsLoadingDocs] = useState(false);

    useEffect(() => {
        if (process?.companyProfileId) {
            setIsLoadingDocs(true);
            fetch(`${API_BASE_URL}/api/documents`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            })
                .then(res => res.json())
                .then((data: CompanyDocument[]) => {
                    const tiedDocs = data.filter(d => d.companyProfileId === process?.companyProfileId);
                    setCompanyDocs(tiedDocs);
                })
                .catch(err => console.error("Failed to fetch company docs:", err))
                .finally(() => setIsLoadingDocs(false));
        }
    }, [process?.companyProfileId]);

    // Categorized documents analysis
    const categorizedDocs = useMemo(() => {
        let rawData: any = {};
        try {
            if (analysis?.requiredDocuments) {
                rawData = typeof analysis?.requiredDocuments === 'string'
                    ? JSON.parse(analysis?.requiredDocuments)
                    : analysis?.requiredDocuments;
            }
            if (!rawData) rawData = {};
            if (Array.isArray(rawData)) {
                rawData = { "Documentos Exigidos": rawData.map(d => typeof d === 'string' ? { item: '-', description: d } : d) };
            }
        } catch (e) {
            console.error("Failed to parse requiredDocuments", e);
            if (typeof analysis?.requiredDocuments === 'string' && analysis?.requiredDocuments.trim()) {
                rawData = { "Processamento": [{ item: 'Info', description: analysis?.requiredDocuments }] };
            } else {
                rawData = {};
            }
        }

        const categories = ["Habilitação Jurídica", "Regularidade Fiscal, Social e Trabalhista", "Qualificação Técnica", "Qualificação Econômica Financeira", "Declarações e Outros", "Outros", "Documentos Exigidos", "Processamento"];
        const result: Record<string, { item: string; description: string; hasMatch: boolean }[]> = {};

        categories.forEach(cat => {
            const docs = Array.isArray(rawData[cat]) ? rawData[cat] : [];
            result[cat] = docs.map((doc: any) => {
                const docObj = typeof doc === 'string' ? { item: '-', description: doc } : doc;
                const textToMatch = `${docObj.item} ${docObj.description}`.toLowerCase();
                const hasMatch = companyDocs.some(cDoc => {
                    const docType = cDoc.docType.toLowerCase();
                    if (textToMatch.includes('trabalhista') && docType.includes('trabalhista')) return true;
                    if (textToMatch.includes('fgts') && docType.includes('fgts')) return true;
                    if (textToMatch.includes('federal') && docType.includes('federal')) return true;
                    if (textToMatch.includes('estadual') && docType.includes('estadual')) return true;
                    if (textToMatch.includes('municipal') && docType.includes('municipal')) return true;
                    if (textToMatch.includes('falência') && docType.includes('falência')) return true;
                    if (textToMatch.includes('balanço') && docType.includes('balanço')) return true;
                    if (textToMatch.includes('contrato social') && docType.includes('contrato social')) return true;
                    return false;
                });
                return { ...docObj, hasMatch };
            });
        });
        return result;
    }, [analysis?.requiredDocuments, companyDocs]);

    const allDocsList = useMemo(() => Object.values(categorizedDocs).flat(), [categorizedDocs]);
    const readinessScore = allDocsList.length > 0
        ? Math.round((allDocsList.filter(d => d.hasMatch).length / allDocsList.length) * 100)
        : 0;

    return {
        parseArray, renderTextValue,
        flagList, deadlineList,
        companyDocs, isLoadingDocs,
        categorizedDocs, allDocsList, readinessScore,
    };
}
