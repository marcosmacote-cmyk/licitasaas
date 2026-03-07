import React, { useState, useEffect, useMemo } from 'react';
import { Upload, Search, FileText, Trash2, HardHat, FileBadge } from 'lucide-react';
import type { BiddingProcess, CompanyProfile, TechnicalCertificate } from '../../types';
import axios from 'axios';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onRefresh?: () => void;
}

export function TechnicalOracle({ biddings, onRefresh }: Props) {
    const [certificates, setCertificates] = useState<TechnicalCertificate[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCert, setSelectedCert] = useState<TechnicalCertificate | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);

    // Selected bidding for comparison
    const [selectedBiddingId, setSelectedBiddingId] = useState<string | null>(null);

    useEffect(() => {
        fetchCertificates();
    }, []);

    const fetchCertificates = async () => {
        setIsLoading(true);
        try {
            const res = await axios.get('/api/technical-certificates');
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

        setIsUploading(true);
        setUploadError(null);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', file.name);

        try {
            await axios.post('/api/technical-certificates', formData);
            fetchCertificates();
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
            await axios.delete(`/api/technical-certificates/${id}`);
            fetchCertificates();
            if (selectedCert?.id === id) setSelectedCert(null);
        } catch (error) {
            console.error('Failed to delete certificate:', error);
        }
    };

    const filteredCertificates = useMemo(() => {
        if (!searchTerm) return certificates;
        const low = searchTerm.toLowerCase();
        return certificates.filter(c =>
            c.title.toLowerCase().includes(low) ||
            c.issuer?.toLowerCase().includes(low) ||
            c.object?.toLowerCase().includes(low) ||
            c.experiences?.some(e => e.description.toLowerCase().includes(low))
        );
    }, [certificates, searchTerm]);

    const biddingsWithAnalysis = useMemo(() =>
        biddings.filter(b => b.status === 'Preparando Documentação' && (b.aiAnalysis || b.summary))
        , [biddings]);

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: '24px', height: 'calc(100vh - 250px)' }}>
            {/* Left Column: List and Upload */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: '16px', overflow: 'hidden' }}>
                <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FileBadge size={20} color="var(--color-primary)" />
                        Acervo Técnico
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-tertiary)' }}>
                        Repositório de atestados e CATs.
                    </p>
                </div>

                <div style={{ marginBottom: '16px' }}>
                    <label className="btn btn-primary w-full" style={{ justifyContent: 'center', opacity: isUploading ? 0.7 : 1, cursor: isUploading ? 'not-allowed' : 'pointer' }}>
                        {isUploading ? 'Processando IA...' : 'Adicionar Novo Acervo'}
                        <Upload size={16} />
                        <input type="file" hidden onChange={handleFileUpload} disabled={isUploading} accept=".pdf" />
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
                        placeholder="Buscar no acervo..."
                        className="form-control"
                        style={{ paddingLeft: '40px' }}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {isLoading ? (
                        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-tertiary)' }}>Carregando...</div>
                    ) : filteredCertificates.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-tertiary)', fontSize: '0.9rem' }}>
                            Nenhum atestado encontrado.
                        </div>
                    ) : (
                        filteredCertificates.map(cert => (
                            <div
                                key={cert.id}
                                onClick={() => setSelectedCert(cert)}
                                style={{
                                    padding: '12px',
                                    borderRadius: '8px',
                                    border: `1px solid ${selectedCert?.id === cert.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                    background: selectedCert?.id === cert.id ? 'rgba(37, 99, 235, 0.05)' : 'white',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    position: 'relative'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                                    <span style={{
                                        fontSize: '0.7rem',
                                        background: 'var(--color-bg-secondary)',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        fontWeight: 600,
                                        color: 'var(--color-text-secondary)'
                                    }}>
                                        {cert.type}
                                    </span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteCert(cert.id); }}
                                        style={{ background: 'none', border: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '2px' }}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                                <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{cert.title}</h4>
                                <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {cert.issuer}
                                </p>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Right Column: Details and Analysis */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto' }}>
                {selectedCert ? (
                    <div className="card" style={{ padding: '24px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                            <div>
                                <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>{selectedCert.title}</h2>
                                <p style={{ margin: '4px 0 0 0', color: 'var(--color-text-tertiary)', fontSize: '0.95rem' }}>
                                    {selectedCert.issuer} {selectedCert.issueDate && `• ${new Date(selectedCert.issueDate).toLocaleDateString()}`}
                                </p>
                            </div>
                            <a href={selectedCert.fileUrl} target="_blank" rel="noreferrer" className="btn btn-secondary">
                                Visualizar PDF
                            </a>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                            <div>
                                <h4 style={{ fontSize: '0.9rem', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.05em', marginBottom: '12px' }}>
                                    Objeto Detalhado
                                </h4>
                                <div style={{ background: 'var(--color-bg-secondary)', padding: '16px', borderRadius: '8px', fontSize: '0.9rem', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                                    {selectedCert.object || 'Objeto não extraído.'}
                                </div>
                            </div>
                            <div>
                                <h4 style={{ fontSize: '0.9rem', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.05em', marginBottom: '12px' }}>
                                    Experiências Extraídas
                                </h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {selectedCert.experiences?.map((exp, idx) => (
                                        <div key={exp.id || idx} style={{ padding: '12px', background: 'white', border: '1px solid var(--color-border)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{exp.description}</div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>{exp.category}</div>
                                            </div>
                                            <div style={{ textAlign: 'right', marginLeft: '16px' }}>
                                                <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                                                    {exp.quantity?.toLocaleString() || '-'} {exp.unit}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {(!selectedCert.experiences || selectedCert.experiences.length === 0) && (
                                        <p style={{ fontSize: '0.9rem', color: 'var(--color-text-tertiary)' }}>Nenhuma experiência técnica listada.</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Analysis Section */}
                        <div style={{ marginTop: '32px', borderTop: '1px solid var(--color-border)', paddingTop: '32px' }}>
                            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <HardHat size={22} color="#f59e0b" />
                                Oráculo: Comparar com Licitação
                            </h3>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <select
                                    className="form-control"
                                    style={{ flex: 1 }}
                                    value={selectedBiddingId || ''}
                                    onChange={(e) => setSelectedBiddingId(e.target.value)}
                                >
                                    <option value="">Selecione uma licitação alvo...</option>
                                    {biddingsWithAnalysis.map(b => (
                                        <option key={b.id} value={b.id}>{b.title}</option>
                                    ))}
                                </select>
                                <button
                                    className="btn btn-primary"
                                    disabled={!selectedBiddingId}
                                    onClick={() => {/* Not implemented yet */ }}
                                >
                                    Analisar Compatibilidade
                                </button>
                            </div>
                            <p style={{ marginTop: '12px', fontSize: '0.85rem', color: 'var(--color-text-tertiary)' }}>
                                O Oráculo comparará as Parcelas de Maior Relevância do edital com este acervo técnico.
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', padding: '48px' }}>
                        <FileText size={64} style={{ opacity: 0.2, marginBottom: '24px' }} />
                        <h3 style={{ margin: 0 }}>Selecione um Acervo</h3>
                        <p style={{ marginTop: '8px', textAlign: 'center' }}>
                            Escolha um atestado na lista ao lado para visualizar os detalhes ou realize o upload de um novo CAT/Atestado.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
