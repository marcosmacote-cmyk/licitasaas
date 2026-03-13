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

    const CATEGORIES_HIERARCHY = {
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
        
        // Grouping
        filteredCertificates.forEach(cert => {
            const companyName = cert.company?.razaoSocial || 'Empresa não vinculada';
            if (!groups[companyName]) groups[companyName] = [];
            groups[companyName].push(cert);
        });

        // Sorting each group by category then title
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
        if (newExpanded.has(companyName)) {
            newExpanded.delete(companyName);
        } else {
            newExpanded.add(companyName);
        }
        setExpandedCompanies(newExpanded);
    };


    return (
        <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 'var(--space-6)', height: 'calc(100vh - 250px)' }}>
            {/* Left Column: List and Upload */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-4)', overflow: 'hidden' }}>
                <div style={{ marginBottom: 'var(--space-5)' }}>
                    <h3 style={{ margin: '0 0 var(--space-2) 0', fontSize: 'var(--text-xl)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <FileBadge size={20} color="var(--color-primary)" />
                        Acervo Técnico
                    </h3>
                    <p style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--color-text-tertiary)' }}>
                        Selecione os atestados para somatório e análise.
                    </p>
                </div>

                <div style={{ marginBottom: 'var(--space-5)', background: 'var(--color-bg-secondary)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                    <div style={{ marginBottom: 'var(--space-4)' }}>
                        <label style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 'var(--space-2)', display: 'block', letterSpacing: '0.05em' }}>
                            Vincular à Empresa
                        </label>
                        <div style={{ position: 'relative' }}>
                            <Building2 size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', zIndex: 1 }} />
                            <select
                                className="form-control"
                                style={{ width: '100%', paddingLeft: '36px', fontSize: 'var(--text-base)', height: '42px' }}
                                value={selectedCompanyId}
                                onChange={(e) => setSelectedCompanyId(e.target.value)}
                            >
                                <option value="">Selecione a empresa...</option>
                                {companies.map(c => (
                                    <option key={c.id} value={c.id}>{c.razaoSocial}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div style={{ marginBottom: 'var(--space-4)' }}>
                        <label style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 'var(--space-2)', display: 'block', letterSpacing: '0.05em' }}>
                            Categoria do Acervo
                        </label>
                        <div style={{ position: 'relative' }}>
                            <Layers size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', zIndex: 1 }} />
                            <select
                                className="form-control"
                                style={{ width: '100%', paddingLeft: '36px', fontSize: 'var(--text-base)', height: '42px' }}
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                            >
                                <option value="">Selecione uma categoria...</option>
                                {Object.entries(CATEGORIES_HIERARCHY).map(([group, cats]) => (
                                    <optgroup key={group} label={group}>
                                        {cats.map(cat => (
                                            <option key={cat} value={cat}>{cat}</option>
                                        ))}
                                    </optgroup>
                                ))}
                                <option value="Outros">Outros</option>
                            </select>
                        </div>
                    </div>

                    <label className="btn btn-primary w-full" style={{ justifyContent: 'center', height: '42px', opacity: (isUploading || !selectedCompanyId) ? 0.7 : 1, cursor: (isUploading || !selectedCompanyId) ? 'not-allowed' : 'pointer', fontWeight: 'var(--font-bold)' }}>
                        {isUploading ? 'Processando IA...' : 'Enviar Novo Atestado'}
                        <Upload size={18} />
                        <input
                            type="file"
                            hidden
                            onChange={handleFileUpload}
                            disabled={isUploading || !selectedCompanyId}
                            accept=".pdf"
                        />
                    </label>
                    {uploadError && (
                        <div style={{ color: 'var(--color-danger)', fontSize: 'var(--text-base)', marginTop: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius-md)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                            <AlertTriangle size={14} />
                            {uploadError}
                        </div>
                    )}
                </div>

                <div style={{ marginBottom: 'var(--space-5)' }}>
                    <label style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 'var(--space-2)', display: 'block', letterSpacing: '0.05em' }}>
                        Busca por Objeto
                    </label>
                    <div className="input-group" style={{ position: 'relative' }}>
                        <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', zIndex: 1 }} />
                        <input
                            type="text"
                            placeholder="Descreva o que procura no acervo..."
                            className="form-control"
                            style={{ paddingLeft: '40px', height: '42px', fontSize: 'var(--text-base)', width: '100%' }}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
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
                                        padding: 'var(--space-3)',
                                        background: 'var(--color-bg-secondary)',
                                        borderRadius: 'var(--radius-md)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--space-2)',
                                        cursor: 'pointer',
                                        fontWeight: 'var(--font-semibold)',
                                        fontSize: 'var(--text-base)',
                                        color: 'var(--color-text-primary)',
                                        border: '1px solid var(--color-border)',
                                        transition: 'var(--transition-fast)'
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
                                                    padding: 'var(--space-3)',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: `1px solid ${viewingCert?.id === cert.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                                    background: viewingCert?.id === cert.id ? 'var(--color-primary-light)' : 'var(--color-bg-surface)',
                                                    cursor: 'pointer',
                                                    transition: 'var(--transition-fast)',
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
                                                                background: 'var(--color-primary-light)',
                                                                padding: '2px 6px',
                                                                borderRadius: 'var(--radius-sm)',
                                                                fontWeight: 'var(--font-bold)',
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
                                                <h4 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-primary)' }}>
                                                    {cert.title}
                                                </h4>
                                                <p style={{ margin: '4px 0 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', overflowY: 'auto', paddingBottom: 'var(--space-6)' }}>

                {/* Comparison Header always visible if something is selected */}
                <div className="card" style={{ padding: 'var(--space-5)', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                        <h3 style={{ margin: 0, fontSize: 'var(--text-xl)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            <HardHat size={22} color="var(--color-warning)" />
                            Oráculo de Somatório
                        </h3>
                        {selectedCertIds.size > 0 && (
                            <span style={{ fontSize: 'var(--text-base)', background: 'var(--color-warning-bg)', color: '#92400e', padding: 'var(--space-1) var(--space-3)', borderRadius: 'var(--radius-full)', fontWeight: 'var(--font-bold)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', border: '1px solid var(--color-warning-border)' }}>
                                <Layers size={14} /> {selectedCertIds.size} atestado(s) selecionado(s) para soma
                            </span>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
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
                        <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-base)', color: 'var(--color-danger)', fontWeight: 'var(--font-medium)' }}>
                            ⚠️ Selecione ao menos um atestado na lista lateral para iniciar a análise.
                        </p>
                    )}
                </div>

                {/* Analysis Results */}
                {analysisResult && (
                    <div className="card" style={{ padding: 'var(--space-6)', border: `2px solid ${analysisResult.overallStatus === 'Apto' ? 'var(--color-success)' : analysisResult.overallStatus === 'Risco' ? 'var(--color-warning)' : 'var(--color-danger)'}`, background: 'var(--color-bg-surface)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
                            {analysisResult.overallStatus === 'Apto' ? <CheckCircle2 color="var(--color-success)" size={36} /> :
                                analysisResult.overallStatus === 'Risco' ? <AlertTriangle color="var(--color-warning)" size={36} /> :
                                    <XCircle color="var(--color-danger)" size={36} />}
                            <div>
                                <h3 style={{ margin: 0, fontSize: 'var(--text-3xl)', fontWeight: 'var(--font-bold)' }}>Parecer do Oráculo: {analysisResult.overallStatus}</h3>
                                <p style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--color-text-tertiary)' }}>Análise fundamentada considerando o somatório do acervo técnico.</p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                            {analysisResult.analysis.map((item, idx) => (
                                <div key={idx} style={{ padding: 'var(--space-5)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
                                        <div style={{ flex: 1, paddingRight: 'var(--space-5)' }}>
                                            <h4 style={{ margin: '0 0 6px 0', fontSize: 'var(--text-sm)', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.05em' }}>Exigência do Edital</h4>
                                            <p style={{ margin: 0, fontSize: 'var(--text-lg)', color: 'var(--color-text-primary)', fontWeight: 'var(--font-semibold)', lineHeight: '1.4' }}>{item.requirement}</p>
                                        </div>
                                        <span style={{
                                            padding: 'var(--space-2) var(--space-4)',
                                            borderRadius: 'var(--radius-full)',
                                            fontSize: 'var(--text-base)',
                                            fontWeight: 'var(--font-bold)',
                                            textTransform: 'uppercase',
                                            background: item.status === 'Atende' ? 'var(--color-success-bg)' : item.status === 'Similar' ? 'var(--color-warning-bg)' : 'var(--color-danger-bg)',
                                            color: item.status === 'Atende' ? '#065f46' : item.status === 'Similar' ? '#92400e' : '#991b1b',
                                            border: `1px solid ${item.status === 'Atende' ? 'var(--color-success)' : item.status === 'Similar' ? 'var(--color-warning)' : 'var(--color-danger)'}`
                                        }}>
                                            {item.status}
                                        </span>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 'var(--space-5)', fontSize: 'var(--text-base)' }}>
                                        <div style={{ background: 'var(--color-bg-surface)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                            <div style={{ color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: 'var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)' }}>
                                                <FileBadge size={14} /> COMPROVAÇÃO INTEGRADA
                                            </div>
                                            <p style={{ margin: '0 0 var(--space-2) 0', fontWeight: 'var(--font-semibold)', color: 'var(--color-primary)' }}>{item.foundExperience}</p>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed var(--color-border)', paddingTop: 'var(--space-2)' }}>
                                                <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-secondary)' }}>Total Somado:</span>
                                                <span style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-bold)' }}>{item.foundQuantity?.toLocaleString()}</span>
                                            </div>
                                            <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-base)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                                                <strong>Atestados utilizados:</strong> {item.matchingCertificate}
                                            </div>
                                        </div>
                                        <div style={{ background: 'var(--color-primary-light)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(37, 99, 235, 0.1)' }}>
                                            <div style={{ color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: 'var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-bold)' }}>
                                                <Info size={14} /> FUNDAMENTAÇÃO
                                            </div>
                                            <p style={{ margin: 0, fontSize: 'var(--text-base)', lineHeight: '1.5', color: 'var(--color-text-secondary)' }}>{item.justification}</p>
                                        </div>
                                    </div>

                                    {item.missing && (
                                        <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', background: 'var(--color-danger-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-danger-border)', fontSize: 'var(--text-base)', color: '#991b1b', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
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
                    <div className="card" style={{ padding: 'var(--space-6)', background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-6)' }}>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '4px' }}>
                                    <span style={{ fontSize: 'var(--text-sm)', background: 'var(--color-primary)', color: 'white', padding: '2px var(--space-2)', borderRadius: 'var(--radius-sm)', fontWeight: 'var(--font-bold)' }}>{viewingCert.type}</span>
                                    {viewingCert.category && (
                                        <span style={{ fontSize: 'var(--text-sm)', background: 'var(--color-primary-light)', color: 'var(--color-primary)', padding: '2px var(--space-2)', borderRadius: 'var(--radius-sm)', fontWeight: 'var(--font-bold)', border: '1px solid #dbeafe' }}>
                                            {viewingCert.category}
                                        </span>
                                    )}
                                    <h2 style={{ margin: 0, fontSize: 'var(--text-3xl)', fontWeight: 'var(--font-bold)' }}>{viewingCert.title}</h2>
                                </div>
                                <p style={{ margin: 0, color: 'var(--color-text-tertiary)', fontSize: 'var(--text-base)', fontWeight: 'var(--font-medium)' }}>
                                    <strong>Emissor:</strong> {viewingCert.issuer} {viewingCert.issueDate && `• ${new Date(viewingCert.issueDate).toLocaleDateString()}`}
                                </p>
                                <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-2)', fontSize: 'var(--text-base)' }}>
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

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>
                            <div>
                                <h4 style={{ fontSize: 'var(--text-base)', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.05em', marginBottom: 'var(--space-3)', fontWeight: 'var(--font-bold)' }}>
                                    Objeto do Documento
                                </h4>
                                <div style={{ background: 'var(--color-bg-secondary)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-base)', lineHeight: '1.6', whiteSpace: 'pre-wrap', border: '1px solid var(--color-border)' }}>
                                    {viewingCert.object || 'Objeto não extraído.'}
                                </div>
                            </div>
                            <div>
                                <h4 style={{ fontSize: 'var(--text-base)', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.05em', marginBottom: 'var(--space-3)', fontWeight: 'var(--font-bold)' }}>
                                    Experiências Técnicas (Granular)
                                </h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {viewingCert.experiences?.map((exp, idx) => (
                                        <div key={exp.id || idx} style={{ padding: 'var(--space-3)', background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: 'var(--shadow-sm)' }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-primary)' }}>{exp.description}</div>
                                                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginTop: '2px', fontWeight: 'var(--font-semibold)' }}>{exp.category}</div>
                                            </div>
                                            <div style={{ textAlign: 'right', marginLeft: 'var(--space-4)' }}>
                                                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--color-primary)' }}>
                                                    {exp.quantity?.toLocaleString() || '-'} <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-medium)' }}>{exp.unit}</span>
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
                    <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', padding: 'var(--space-12)', background: 'var(--color-bg-secondary)', borderStyle: 'dashed' }}>
                        <FileText size={64} style={{ opacity: 0.1, marginBottom: 'var(--space-6)' }} />
                        <h3 style={{ margin: 0, opacity: 0.5 }}>Detalhes do Acervo</h3>
                        <p style={{ marginTop: 'var(--space-2)', textAlign: 'center', opacity: 0.5, maxWidth: '300px' }}>
                            Escolha um atestado na lista para ver o detalhamento ou selecione vários para a análise de somatório.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
