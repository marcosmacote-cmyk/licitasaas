import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../../config';
import { useToast } from '../ui';
import type { BiddingProcess, TechnicalCertificate } from '../../types';
import { resolveStage, isModuleAllowed } from '../../governance';

export interface AnalysisItem {
    requirement: string;
    status: 'Atende' | 'Similar' | 'Não Atende';
    matchingCertificate: string;
    foundExperience: string;
    foundQuantity: number;
    justification: string;
    missing?: string;
}

export interface AnalysisResult {
    overallStatus: 'Apto' | 'Risco' | 'Inapto';
    summaryReport?: string;
    analysis: AnalysisItem[];
}

export const CATEGORIES_HIERARCHY: Record<string, string[]> = {
    "Infraestrutura, Urbanismo e Manutenção": [
        "Obras e Serviços de Engenharia",
        "Manutenção Predial (Elétrica, Hidráulica e Civil)",
        "Serviços de Iluminação Pública",
        "Manutenção e Conservação de Estradas e Rodovias",
        "Sinalização Viária (Vertical, Horizontal e Semafórica)",
        "Manutenção de Ar-Condicionado e Sistemas de Refrigeração",
        "Serviços de Jardinagem e Manutenção de Áreas Verdes"
    ],
    "Saúde e Bem-Estar": [
        "Medicamentos e Insumos Hospitalares",
        "Serviços Médicos Especializados e Credenciamentos",
        "Equipamentos e Mobiliário Médico-Hospitalar",
        "Oxigênio Hospitalar e Gases Medicinais",
        "Locação de Equipamentos Médicos e Ambulâncias",
        "Próteses, Órteses e Materiais Especiais (OPME)",
        "Serviços de Laboratório e Análises Clínicas"
    ],
    "Educação e Desenvolvimento Social": [
        "Gêneros Alimentícios e Merenda Escolar",
        "Materiais Pedagógicos e de Escritório",
        "Mobiliário Escolar",
        "Transporte Escolar (Locação de Ônibus e Vans)",
        "Uniformes e Vestuário Profissional",
        "Brinquedos e Equipamentos de Playground"
    ],
    "Tecnologia, Administrativo e Segurança": [
        "Serviços de TI, Software e Licenciamentos",
        "Vigilância e Segurança Patrimonial",
        "Serviços de Limpeza, Conservação e Higienização",
        "Locação de Veículos e Máquinas Pesadas",
        "Serviços de Impressão e Outsourcing de Impressoras",
        "Consultoria e Assessoria Jurídica ou Contábil",
        "Monitoramento Eletrônico e Câmeras de Segurança"
    ],
    "Logística e Operacional": [
        "Combustíveis e Lubrificantes para Frotas Oficiais",
        "Gestão, Coleta e Destinação de Resíduos Sólidos",
        "Peças de Reposição para Veículos e Máquinas"
    ]
};

interface UseTechnicalOracleOptions {
    biddings: BiddingProcess[];
    onRefresh?: () => void;
    initialBiddingId?: string;
}

export function useTechnicalOracle({ biddings, onRefresh, initialBiddingId }: UseTechnicalOracleOptions) {
    const toast = useToast();
    const [certificates, setCertificates] = useState<TechnicalCertificate[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [viewingCert, setViewingCert] = useState<TechnicalCertificate | null>(null);
    const [selectedCertIds, setSelectedCertIds] = useState<Set<string>>(new Set());
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [selectedBiddingId, setSelectedBiddingId] = useState<string | null>(initialBiddingId || null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
    const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [disabledRequirements, setDisabledRequirements] = useState<Set<string>>(new Set());

    useEffect(() => { fetchCertificates(); }, []);

    const getAuthHeaders = () => ({
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });

    const fetchCertificates = async () => {
        setIsLoading(true);
        try {
            const res = await axios.get(`${API_BASE_URL}/api/technical-certificates`, getAuthHeaders());
            setCertificates(res.data);
        } catch (error) {
            console.error('Failed to fetch certificates:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!selectedCompanyId) { setUploadError('Selecione uma empresa antes de enviar o arquivo.'); return; }

        setIsUploading(true);
        setUploadError(null);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', file.name);
        formData.append('companyProfileId', selectedCompanyId);
        if (selectedCategory) formData.append('category', selectedCategory);

        try {
            await axios.post(`${API_BASE_URL}/api/technical-certificates`, formData, getAuthHeaders());
            fetchCertificates();
            setSelectedCompanyId('');
            if (onRefresh) onRefresh();
        } catch (error: any) {
            setUploadError(error.response?.data?.error || 'Erro ao processar o atestado.');
        } finally {
            setIsUploading(false);
        }
    };

    const handleDeleteCert = async (id: string) => { setConfirmDeleteId(id); };

    const executeDeleteCert = async () => {
        if (!confirmDeleteId) return;
        const id = confirmDeleteId;
        setConfirmDeleteId(null);
        try {
            await axios.delete(`${API_BASE_URL}/api/technical-certificates/${id}`, getAuthHeaders());
            fetchCertificates();
            if (viewingCert?.id === id) setViewingCert(null);
            const newSelected = new Set(selectedCertIds);
            newSelected.delete(id);
            setSelectedCertIds(newSelected);
        } catch (error) {
            console.error('Failed to delete certificate:', error);
        }
    };

    const toggleCertSelection = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const newSelected = new Set(selectedCertIds);
        if (newSelected.has(id)) newSelected.delete(id);
        else newSelected.add(id);
        setSelectedCertIds(newSelected);
    };

    const handleAnalyzeCompatibility = async () => {
        if (!selectedBiddingId || selectedCertIds.size === 0) return;
        setIsAnalyzing(true);
        setAnalysisResult(null);
        try {
            const res = await axios.post(`${API_BASE_URL}/api/technical-certificates/compare`, {
                biddingProcessId: selectedBiddingId,
                technicalCertificateIds: Array.from(selectedCertIds),
                disabledRequirements: Array.from(disabledRequirements)
            }, getAuthHeaders());
            setAnalysisResult(res.data);
        } catch (error) {
            console.error('Failed to analyze compatibility:', error);
            toast.error('Erro ao realizar a análise de compatibilidade.');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleNewSearch = () => {
        setAnalysisResult(null);
        setSelectedCertIds(new Set());
        setSelectedBiddingId(null);
        setViewingCert(null);
    };

    const handleAddToDossier = async () => {
        if (!selectedBiddingId || !analysisResult) return;
        const evidence: Record<string, { docIds: string[], note: string }> = {};
        analysisResult.analysis.forEach(item => {
            if (item.status !== 'Não Atende') {
                evidence[item.requirement] = {
                    docIds: Array.from(selectedCertIds),
                    note: "Exigência conferida pelo o Oráculo (Acervo)"
                };
            }
        });

        // Dual write: localStorage (para compatibilidade imediata com Dossier) + API (persistência real)
        localStorage.setItem(`oracle_evidence_${selectedBiddingId}`, JSON.stringify(evidence));

        try {
            await axios.put(`${API_BASE_URL}/api/biddings/${selectedBiddingId}/oracle-evidence`, {
                oracleEvidence: evidence
            }, getAuthHeaders());
        } catch (err) {
            console.warn('[Oracle] Falha ao persistir evidências via API, mantendo localStorage:', err);
        }

        toast.success('Evidências vinculadas ao Dossiê com sucesso!');
    };

    const filteredCertificates = useMemo(() => {
        if (!searchTerm) return certificates;
        const low = searchTerm.toLowerCase();
        return certificates.filter(c =>
            c.title.toLowerCase().includes(low) ||
            c.issuer?.toLowerCase().includes(low) ||
            c.object?.toLowerCase().includes(low) ||
            c.experiences?.some(e => e.description.toLowerCase().includes(low)) ||
            c.company?.razaoSocial.toLowerCase().includes(low)
        );
    }, [certificates, searchTerm]);

    const biddingsWithAnalysis = useMemo(() =>
        biddings.filter(b => {
            const stage = resolveStage(b.status);
            return isModuleAllowed(stage, b.substage, 'oracle') && (b.aiAnalysis || b.summary);
        })
    , [biddings]);

    const parsedSchemaV2 = useMemo(() => {
        if (!selectedBiddingId) return null;
        const bidding = biddingsWithAnalysis.find(b => b.id === selectedBiddingId);
        if (!bidding?.aiAnalysis?.schemaV2) return null;
        let schema = bidding.aiAnalysis.schemaV2;
        if (typeof schema === 'string') {
            try { schema = JSON.parse(schema); } catch(e){ return null; }
        }
        return schema;
    }, [selectedBiddingId, biddingsWithAnalysis]);

    const requirementsToAnalyze = useMemo(() => {
        if (!parsedSchemaV2) return [];
        const schema = parsedSchemaV2 as any;
        const list: { id: string, text: string, type: string }[] = [];

        (schema.requirements?.qualificacao_tecnica_operacional || []).forEach((r: any) => {
             const key = r.requirement_id || r.title;
             if (key) list.push({ id: key, text: `${r.title}: ${r.description}`, type: 'Operacional' });
        });
        (schema.requirements?.qualificacao_tecnica_profissional || []).forEach((r: any) => {
             const key = r.requirement_id || r.title;
             if (key) list.push({ id: key, text: `${r.title}: ${r.description}`, type: 'Profissional' });
        });
        (schema.technical_analysis?.parcelas_relevantes || []).forEach((p: any) => {
             const key = p.item || p.descricao;
             if (key) list.push({ id: key, text: `${p.item || 'PARCELA'}: ${p.descricao} - Mínimo: ${p.quantitativo_minimo} ${p.unidade}`, type: 'Parcela de Relevância' });
        });
        return list;
    }, [parsedSchemaV2]);

    const toggleRequirement = (reqId: string) => {
        const newSet = new Set(disabledRequirements);
        if (newSet.has(reqId)) newSet.delete(reqId);
        else newSet.add(reqId);
        setDisabledRequirements(newSet);
    };

    const groupedCertificates = useMemo(() => {
        const groups: Record<string, TechnicalCertificate[]> = {};
        filteredCertificates.forEach(cert => {
            const companyName = cert.company?.razaoSocial || 'Empresa não vinculada';
            if (!groups[companyName]) groups[companyName] = [];
            groups[companyName].push(cert);
        });
        Object.keys(groups).forEach(companyName => {
            groups[companyName].sort((a, b) => {
                const catA = a.category || '';
                const catB = b.category || '';
                if (catA < catB) return -1;
                if (catA > catB) return 1;
                return a.title.localeCompare(b.title);
            });
        });
        return groups;
    }, [filteredCertificates]);

    const toggleCompanyExpansion = (companyName: string) => {
        const newExpanded = new Set(expandedCompanies);
        if (newExpanded.has(companyName)) newExpanded.delete(companyName);
        else newExpanded.add(companyName);
        setExpandedCompanies(newExpanded);
    };

    return {
        // State
        certificates, isLoading, searchTerm, setSearchTerm,
        viewingCert, setViewingCert,
        selectedCertIds, isUploading, uploadError,
        selectedCompanyId, setSelectedCompanyId,
        confirmDeleteId, setConfirmDeleteId,
        selectedBiddingId, setSelectedBiddingId,
        isAnalyzing, analysisResult,
        expandedCompanies, selectedCategory, setSelectedCategory,
        requirementsToAnalyze, disabledRequirements, toggleRequirement,
        // Derived
        filteredCertificates, biddingsWithAnalysis, groupedCertificates,
        // Handlers
        handleFileUpload, handleDeleteCert, executeDeleteCert,
        toggleCertSelection, handleAnalyzeCompatibility,
        handleNewSearch, handleAddToDossier, toggleCompanyExpansion,
    };
}
