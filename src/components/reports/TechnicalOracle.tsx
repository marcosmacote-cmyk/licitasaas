import React, { useState, useEffect, useMemo } from 'react';
import { Upload, Search, FileText, Trash2, HardHat, FileBadge, CheckCircle2, AlertTriangle, XCircle, Info, Building2, ChevronRight, Layers, Package } from 'lucide-react';
import type { BiddingProcess, CompanyProfile, TechnicalCertificate } from '../../types';
import axios from 'axios';
import { API_BASE_URL } from '../../config';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onRefresh?: () => void;
}

interface AnalysisItem {
    requirement: string;
    status: 'Atende' | 'Similar' | 'Não Atende';
    matchingCertificate: string;
    foundExperience: string;
    foundQuantity: number;
    justification: string;
    missing?: string;
}

interface AnalysisResult {
    overallStatus: 'Apto' | 'Risco' | 'Inapto';
    analysis: AnalysisItem[];
}

export function TechnicalOracle({ biddings, companies, onRefresh }: Props) {
    const [certificates, setCertificates] = useState<TechnicalCertificate[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [viewingCert, setViewingCert] = useState<TechnicalCertificate | null>(null);
    const [selectedCertIds, setSelectedCertIds] = useState<Set<string>>(new Set());
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');

    // Selected bidding for comparison
    const [selectedBiddingId, setSelectedBiddingId] = useState<string | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
    const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
    const [selectedCategory, setSelectedCategory] = useState<string>('');

    const PREDEFINED_CATEGORIES = [
        "Obras e Serviços de Engenharia",
        "Locação de Máquinas Pesadas",
        "Locação de Veículos",
        "Transporte Escolar",
        "Serviços de Manutenção",
        "Fornecimento de Materiais",
        "Outros"
    ];

    useEffect(() => {
        fetchCertificates();
    }, []);

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

        if (!selectedCompanyId) {
            setUploadError('Selecione uma empresa antes de enviar o arquivo.');
            return;
        }

        setIsUploading(true);
        setUploadError(null);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', file.name);
        formData.append('companyProfileId', selectedCompanyId);
        if (selectedCategory) {
            formData.append('category', selectedCategory);
        }

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

    const handleDeleteCert = async (id: string) => {
        if (!confirm('Tem certeza que deseja excluir este acervo?')) return;
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
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedCertIds(newSelected);
    };

    const handleAnalyzeCompatibility = async () => {
        if (!selectedBiddingId || selectedCertIds.size === 0) return;

        setIsAnalyzing(true);
        setAnalysisResult(null);

        try {
            const res = await axios.post(`${API_BASE_URL}/api/technical-certificates/compare`, {
                biddingProcessId: selectedBiddingId,
                technicalCertificateIds: Array.from(selectedCertIds)
            }, getAuthHeaders());
            setAnalysisResult(res.data);
        } catch (error) {
            console.error('Failed to analyze compatibility:', error);
            alert('Erro ao realizar a análise de compatibilidade.');
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

    const handleAddToDossier = () => {
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

        localStorage.setItem(`oracle_evidence_${selectedBiddingId}`, JSON.stringify(evidence));
        alert('Evidências vinculadas ao Dossiê com sucesso! ✅');
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
        biddings.filter(b => b.status === 'Preparando Documentação' && (b.aiAnalysis || b.summary))
        , [biddings]);

    const groupedCertificates = useMemo(() => {
        const groups: Record<string, TechnicalCertificate[]> = {};
        filteredCertificates.forEach(cert => {
            const companyName = cert.company?.razaoSocial || 'Empresa não vinculada';
            if (!groups[companyName]) groups[companyName] = [];
            groups[companyName].push(cert);
        });
        return groups;
    }, [filteredCertificates]);

    const toggleCompanyExpansion = (companyName: string) => {
        const newExpanded = new Set(expandedCompanies);
        if (newExpanded.has(companyName)) {
            newExpanded.delete(companyName);
        } else {
            newExpanded.add(companyName);
        }
        setExpandedCompanies(newExpanded);
    };


    return (
        <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: '24px', height: 'calc(100vh - 250px)' }}>
            {/* Left Column: List and Upload */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: '16px', overflow: 'hidden' }}>
                <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FileBadge size={20} color="var(--color-primary)" />
                        Acervo Técnico
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-tertiary)' }}>
                        Selecione os atestados para somatório e análise.
                    </p>
                </div>

                <div style={{ marginBottom: '16px', background: 'var(--color-bg-secondary)', padding: '12px', borderRadius: '8px' }}>
                    <div style={{ marginBottom: '12px', display: 'flex', gap: '8px' }}>
                        <select
                            className="form-control"
                            style={{ flex: 1, fontSize: '0.82rem' }}
                            value={selectedCompanyId}
                            onChange={(e) => setSelectedCompanyId(e.target.value)}
                        >
                            <option value="">Empresa...</option>
                            {companies.map(c => (
                                <option key={c.id} value={c.id}>{c.razaoSocial}</option>
                            ))}
                        </select>
                        <select
                            className="form-control"
                            style={{ flex: 1, fontSize: '0.82rem' }}
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                        >
                            <option value="">Categoria...</option>
                            {PREDEFINED_CATEGORIES.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                    </div>

                    <label className="btn btn-primary w-full" style={{ justifyContent: 'center', opacity: (isUploading || !selectedCompanyId) ? 0.7 : 1, cursor: (isUploading || !selectedCompanyId) ? 'not-allowed' : 'pointer' }}>
                        {isUploading ? 'Processando IA...' : 'Adicionar Novo Acervo'}
                        <Upload size={16} />
                        <input
                            type="file"
                            hidden
                            onChange={handleFileUpload}
                            disabled={isUploading || !selectedCompanyId}
                            accept=".pdf"
                        />
                    </label>
                    {uploadError && (
                        <div style={{ color: 'var(--color-danger)', fontSize: '0.8rem', marginTop: '8px', padding: '8px', border: '1px solid currentColor', borderRadius: '4px' }}>
                            {uploadError}
                        </div>
                    )}
                </div>

                <div className="input-group" style={{ marginBottom: '16px' }}>
                    <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                    <input
                        type="text"
                        placeholder="Buscar por objeto, empresa ou emissor..."
                        className="form-control"
                        style={{ paddingLeft: '40px' }}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px' }}>
                    {isLoading ? (
                        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-tertiary)' }}>Carregando...</div>
                    ) : Object.keys(groupedCertificates).length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-tertiary)', fontSize: '0.9rem' }}>
                            Nenhum atestado encontrado.
                        </div>
                    ) : (
                        Object.entries(groupedCertificates).map(([companyName, certs]) => (
                            <div key={companyName} style={{ marginBottom: '4px' }}>
                                <div
                                    onClick={() => toggleCompanyExpansion(companyName)}
                                    style={{
                                        padding: '10px 12px',
                                        background: 'var(--color-bg-secondary)',
                                        borderRadius: '8px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        cursor: 'pointer',
                                        fontWeight: 600,
                                        fontSize: '0.85rem',
                                        color: 'var(--color-text-primary)',
                                        border: '1px solid var(--color-border)',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <Building2 size={16} color="var(--color-primary)" />
                                    <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{companyName}</span>
                                    <span style={{ fontSize: '0.7rem', background: 'var(--color-border)', padding: '2px 6px', borderRadius: '10px', minWidth: '20px', textAlign: 'center' }}>
                                        {certs.length}
                                    </span>
                                    <ChevronRight
                                        size={16}
                                        style={{
                                            transform: expandedCompanies.has(companyName) ? 'rotate(90deg)' : 'none',
                                            transition: 'transform 0.2s ease',
                                            opacity: 0.5
                                        }}
                                    />
                                </div>

                                {expandedCompanies.has(companyName) && (
                                    <div style={{ padding: '8px 0 8px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {certs.map(cert => (
                                            <div
                                                key={cert.id}
                                                onClick={() => setViewingCert(cert)}
                                                style={{
                                                    padding: '12px',
                                                    borderRadius: '8px',
                                                    border: `1px solid ${viewingCert?.id === cert.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                                    background: viewingCert?.id === cert.id ? 'rgba(37, 99, 235, 0.05)' : 'white',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s ease',
                                                    position: 'relative',
                                                    boxShadow: selectedCertIds.has(cert.id) ? '0 0 0 2px var(--color-primary)' : 'none'
                                                }}
                                            >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedCertIds.has(cert.id)}
                                                            onChange={() => { }} // Controlled via onClick handle
                                                            onClick={(e) => toggleCertSelection(cert.id, e)}
                                                            style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                                                        />
                                                        <span style={{
                                                            fontSize: '0.65rem',
                                                            background: 'var(--color-bg-secondary)',
                                                            padding: '2px 6px',
                                                            borderRadius: '4px',
                                                            fontWeight: 700,
                                                            color: 'var(--color-text-secondary)',
                                                            textTransform: 'uppercase'
                                                        }}>
                                                            {cert.type}
                                                        </span>
                                                        {cert.category && (
                                                            <span style={{
                                                                fontSize: '0.65rem',
                                                                background: '#eff6ff',
                                                                padding: '2px 6px',
                                                                borderRadius: '4px',
                                                                fontWeight: 700,
                                                                color: 'var(--color-primary)',
                                                                border: '1px solid #dbeafe'
                                                            }}>
                                                                {cert.category}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteCert(cert.id); }}
                                                        style={{ background: 'none', border: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '2px' }}
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                                <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                                    {cert.title}
                                                </h4>
                                                <p style={{ margin: '4px 0 0 0', fontSize: '0.7rem', color: 'var(--color-text-tertiary)', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {cert.issuer}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Right Column: Details and Analysis */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto', paddingBottom: '24px' }}>

                {/* Comparison Header always visible if something is selected */}
                <div className="card" style={{ padding: '20px', border: '1px solid var(--color-border)', background: 'white' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <HardHat size={22} color="#f59e0b" />
                            Oráculo de Somatório
                        </h3>
                        {selectedCertIds.size > 0 && (
                            <span style={{ fontSize: '0.8rem', background: '#fffbeb', color: '#92400e', padding: '4px 10px', borderRadius: '20px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', border: '1px solid #f59e0b' }}>
                                <Layers size={14} /> {selectedCertIds.size} atestado(s) selecionado(s) para soma
                            </span>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <div style={{ flex: 1 }}>
                            <select
                                className="form-control"
                                style={{ width: '100%' }}
                                value={selectedBiddingId || ''}
                                onChange={(e) => setSelectedBiddingId(e.target.value)}
                            >
                                <option value="">Selecione uma licitação para análise conjunta...</option>
                                {biddingsWithAnalysis.map(b => (
                                    <option key={b.id} value={b.id}>{b.title}</option>
                                ))}
                            </select>
                        </div>
                        {!analysisResult ? (
                            <button
                                className="btn btn-primary"
                                disabled={!selectedBiddingId || selectedCertIds.size === 0 || isAnalyzing}
                                onClick={handleAnalyzeCompatibility}
                                style={{ padding: '10px 24px' }}
                            >
                                {isAnalyzing ? 'Processando Somatório...' : 'Analisar Somatório'}
                            </button>
                        ) : (
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleAddToDossier}
                                    style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}
                                    title="Vincular certificados selecionados ao Dossiê desta licitação"
                                >
                                    <Package size={16} /> Adicionar ao Dossiê
                                </button>
                                <button
                                    className="btn btn-outline"
                                    onClick={handleNewSearch}
                                    style={{ padding: '10px 16px' }}
                                    title="Zerar análise e começar nova pesquisa"
                                >
                                    <Layers size={16} /> Nova Pesquisa
                                </button>
                            </div>
                        )}
                    </div>
                    {selectedCertIds.size === 0 && !analysisResult && (
                        <p style={{ marginTop: '12px', fontSize: '0.8rem', color: 'var(--color-danger)', fontWeight: 500 }}>
                            ⚠️ Selecione ao menos um atestado na lista lateral para iniciar a análise.
                        </p>
                    )}
                </div>

                {/* Analysis Results */}
                {analysisResult && (
                    <div className="card" style={{ padding: '24px', border: `2px solid ${analysisResult.overallStatus === 'Apto' ? '#10b981' : analysisResult.overallStatus === 'Risco' ? '#f59e0b' : '#ef4444'}`, background: 'white' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                            {analysisResult.overallStatus === 'Apto' ? <CheckCircle2 color="#10b981" size={36} /> :
                                analysisResult.overallStatus === 'Risco' ? <AlertTriangle color="#f59e0b" size={36} /> :
                                    <XCircle color="#ef4444" size={36} />}
                            <div>
                                <h3 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>Parecer do Oráculo: {analysisResult.overallStatus}</h3>
                                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-tertiary)' }}>Análise fundamentada considerando o somatório do acervo técnico.</p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {analysisResult.analysis.map((item, idx) => (
                                <div key={idx} style={{ padding: '20px', background: 'var(--color-bg-secondary)', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                        <div style={{ flex: 1, paddingRight: '20px' }}>
                                            <h4 style={{ margin: '0 0 6px 0', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.05em' }}>Exigência do Edital</h4>
                                            <p style={{ margin: 0, fontSize: '1rem', color: 'var(--color-text-primary)', fontWeight: 600, lineHeight: '1.4' }}>{item.requirement}</p>
                                        </div>
                                        <span style={{
                                            padding: '6px 14px',
                                            borderRadius: '20px',
                                            fontSize: '0.8rem',
                                            fontWeight: 800,
                                            textTransform: 'uppercase',
                                            background: item.status === 'Atende' ? '#ecfdf5' : item.status === 'Similar' ? '#fffbeb' : '#fef2f2',
                                            color: item.status === 'Atende' ? '#065f46' : item.status === 'Similar' ? '#92400e' : '#991b1b',
                                            border: `1px solid ${item.status === 'Atende' ? '#10b981' : item.status === 'Similar' ? '#f59e0b' : '#ef4444'}`
                                        }}>
                                            {item.status}
                                        </span>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '20px', fontSize: '0.9rem' }}>
                                        <div style={{ background: 'white', padding: '12px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                            <div style={{ color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px', fontSize: '0.75rem', fontWeight: 600 }}>
                                                <FileBadge size={14} /> COMPROVAÇÃO INTEGRADA
                                            </div>
                                            <p style={{ margin: '0 0 8px 0', fontWeight: 600, color: 'var(--color-primary)' }}>{item.foundExperience}</p>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed var(--color-border)', paddingTop: '8px' }}>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>Total Somado:</span>
                                                <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{item.foundQuantity?.toLocaleString()}</span>
                                            </div>
                                            <div style={{ marginTop: '12px', fontSize: '0.8rem', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                                                <strong>Atestados utilizados:</strong> {item.matchingCertificate}
                                            </div>
                                        </div>
                                        <div style={{ background: 'rgba(37, 99, 235, 0.03)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(37, 99, 235, 0.1)' }}>
                                            <div style={{ color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px', fontSize: '0.75rem', fontWeight: 700 }}>
                                                <Info size={14} /> FUNDAMENTAÇÃO
                                            </div>
                                            <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: '1.5', color: 'var(--color-text-secondary)' }}>{item.justification}</p>
                                        </div>
                                    </div>

                                    {item.missing && (
                                        <div style={{ marginTop: '16px', padding: '10px 14px', background: '#fff1f2', borderRadius: '8px', border: '1px solid #fecaca', fontSize: '0.85rem', color: '#991b1b', display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <AlertTriangle size={16} />
                                            <span><strong>Déficit de Qualificação:</strong> {item.missing}</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Individual Certificate Details */}
                {viewingCert ? (
                    <div className="card" style={{ padding: '24px', background: 'white', border: '1px solid var(--color-border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                    <span style={{ fontSize: '0.7rem', background: 'var(--color-primary)', color: 'white', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>{viewingCert.type}</span>
                                    {viewingCert.category && (
                                        <span style={{ fontSize: '0.7rem', background: '#eff6ff', color: 'var(--color-primary)', padding: '2px 8px', borderRadius: '4px', fontWeight: 700, border: '1px solid #dbeafe' }}>
                                            {viewingCert.category}
                                        </span>
                                    )}
                                    <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>{viewingCert.title}</h2>
                                </div>
                                <p style={{ margin: 0, color: 'var(--color-text-tertiary)', fontSize: '0.9rem', fontWeight: 500 }}>
                                    <strong>Emissor:</strong> {viewingCert.issuer} {viewingCert.issueDate && `• ${new Date(viewingCert.issueDate).toLocaleDateString()}`}
                                </p>
                                <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '0.85rem' }}>
                                    <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
                                        <strong>Empresa Executora:</strong> {viewingCert.executingCompany || viewingCert.company?.razaoSocial || '-'}
                                    </p>
                                    <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
                                        <strong>Responsável Técnico:</strong> {viewingCert.technicalResponsible || '-'}
                                    </p>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    className={`btn ${selectedCertIds.has(viewingCert.id) ? 'btn-primary' : 'btn-outline'}`}
                                    onClick={(e) => toggleCertSelection(viewingCert.id, e)}
                                >
                                    {selectedCertIds.has(viewingCert.id) ? 'Remover do Somatório' : 'Selecionar para Somatório'}
                                </button>
                                <a href={viewingCert.fileUrl} target="_blank" rel="noreferrer" className="btn btn-secondary">
                                    Visualizar PDF
                                </a>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                            <div>
                                <h4 style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.05em', marginBottom: '12px', fontWeight: 700 }}>
                                    Objeto do Documento
                                </h4>
                                <div style={{ background: 'var(--color-bg-secondary)', padding: '16px', borderRadius: '8px', fontSize: '0.9rem', lineHeight: '1.6', whiteSpace: 'pre-wrap', border: '1px solid var(--color-border)' }}>
                                    {viewingCert.object || 'Objeto não extraído.'}
                                </div>
                            </div>
                            <div>
                                <h4 style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.05em', marginBottom: '12px', fontWeight: 700 }}>
                                    Experiências Técnicas (Granular)
                                </h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {viewingCert.experiences?.map((exp, idx) => (
                                        <div key={exp.id || idx} style={{ padding: '12px', background: 'white', border: '1px solid var(--color-border)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: 'var(--shadow-sm)' }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{exp.description}</div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: '2px', fontWeight: 600 }}>{exp.category}</div>
                                            </div>
                                            <div style={{ textAlign: 'right', marginLeft: '16px' }}>
                                                <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                                                    {exp.quantity?.toLocaleString() || '-'} <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>{exp.unit}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {(!viewingCert.experiences || viewingCert.experiences.length === 0) && (
                                        <p style={{ fontSize: '0.9rem', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>Nenhuma experiência técnica listada para este documento.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', padding: '48px', background: 'rgba(255,255,255,0.5)', borderStyle: 'dashed' }}>
                        <FileText size={64} style={{ opacity: 0.1, marginBottom: '24px' }} />
                        <h3 style={{ margin: 0, opacity: 0.5 }}>Detalhes do Acervo</h3>
                        <p style={{ marginTop: '8px', textAlign: 'center', opacity: 0.5, maxWidth: '300px' }}>
                            Escolha um atestado na lista para ver o detalhamento ou selecione vários para a análise de somatório.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
