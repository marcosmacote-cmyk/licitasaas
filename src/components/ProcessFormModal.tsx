import { useState, useEffect, useRef } from 'react';
import { X, Save, UploadCloud, Loader2, MessageSquare, Bell, PlusCircle, Briefcase, Globe, Tag, Link, DollarSign, Calendar, KeyRound, Copy, Eye, EyeOff, RefreshCw, ExternalLink } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { v4 as uuidv4 } from 'uuid';
import type { BiddingProcess, RiskTag, CompanyProfile, ObservationLog, CompanyCredential } from '../types';

interface Props {
    initialData: BiddingProcess | null;
    companies: CompanyProfile[];
    onClose: () => void;
    onSave: (data: Partial<BiddingProcess>) => void;
}

export function ProcessFormModal({ initialData, companies, onClose, onSave }: Props) {
    const [formData, setFormData] = useState<Partial<BiddingProcess>>({
        title: '',
        summary: '',
        modality: '',
        portal: '',
        estimatedValue: 0,
        sessionDate: '',
        risk: 'Baixo' as RiskTag,
        link: '',
        companyProfileId: '',
        observations: '[]',
        reminderDate: '',
        reminderStatus: 'pending',
        reminderType: 'once',
        reminderDays: '[]'
    });

    const [newObservation, setNewObservation] = useState('');
    const [observations, setObservations] = useState<ObservationLog[]>([]);

    useEffect(() => {
        if (initialData) {
            let formattedSessionDate = '';
            if (initialData.sessionDate) {
                const d = new Date(initialData.sessionDate);
                if (!isNaN(d.getTime())) {
                    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                    formattedSessionDate = d.toISOString().slice(0, 16);
                }
            }

            let formattedReminderDate = '';
            if (initialData.reminderDate) {
                const d = new Date(initialData.reminderDate);
                if (!isNaN(d.getTime())) {
                    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                    formattedReminderDate = d.toISOString().slice(0, 16);
                }
            }

            setFormData({
                ...initialData,
                sessionDate: formattedSessionDate,
                reminderDate: formattedReminderDate
            });

            try {
                const obs = JSON.parse(initialData.observations || '[]');
                setObservations(obs);
            } catch (e) {
                setObservations([]);
            }
        }
    }, [initialData]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [credentials, setCredentials] = useState<CompanyCredential[]>([]);
    const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [viewingPdf, setViewingPdf] = useState<string | null>(null);

    // Fetch credentials when company changes
    useEffect(() => {
        if (formData.companyProfileId) {
            const company = companies.find(c => c.id === formData.companyProfileId);
            if (company?.credentials) {
                setCredentials(company.credentials);
            } else {
                // Fetch from API
                fetch(`${API_BASE_URL}/api/credentials?companyId=${formData.companyProfileId}`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                })
                    .then(res => res.ok ? res.json() : [])
                    .then(data => setCredentials(Array.isArray(data) ? data : []))
                    .catch(() => setCredentials([]));
            }
        } else {
            setCredentials([]);
        }
    }, [formData.companyProfileId, companies]);

    const handleCopy = (text: string, fieldId: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(fieldId);
        setTimeout(() => setCopiedField(null), 2000);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        let finalValue: any = value;
        if (name === 'estimatedValue') {
            const sanitizedValue = value.replace(',', '.');
            finalValue = sanitizedValue === '' ? 0 : parseFloat(sanitizedValue);
            if (isNaN(finalValue)) finalValue = 0;
        }
        setFormData(prev => ({ ...prev, [name]: finalValue }));
    };

    const handleAddObservation = () => {
        if (!newObservation.trim()) return;
        const log: ObservationLog = {
            id: uuidv4(),
            text: newObservation.trim(),
            timestamp: new Date().toISOString()
        };
        const updatedObs = [...observations, log];
        setObservations(updatedObs);
        setFormData(prev => ({ ...prev, observations: JSON.stringify(updatedObs) }));
        setNewObservation('');
    };

    const handleFileUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        try {
            setIsUploading(true);
            const uploadedUrls: string[] = [];
            for (const file of files) {
                const bodyData = new FormData();
                bodyData.append('file', file);
                const uploadResponse = await fetch(`${API_BASE_URL}/api/upload`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: bodyData
                });
                if (uploadResponse.ok) {
                    const uploadData = await uploadResponse.json();
                    uploadedUrls.push(uploadData.fileUrl);
                }
            }
            if (uploadedUrls.length > 0) {
                setFormData(prev => ({
                    ...prev,
                    link: prev.link ? `${prev.link}, ${uploadedUrls.join(', ')} ` : uploadedUrls.join(', ')
                }));
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            ...formData,
            sessionDate: formData.sessionDate ? new Date(formData.sessionDate).toISOString() : new Date().toISOString(),
            reminderDate: formData.reminderDate ? new Date(formData.reminderDate).toISOString() : undefined
        });
    };

    return (
        <div className="modal-overlay" style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            animation: 'fadeIn 0.2s ease-out'
        }}>
            <div className="modal-content" style={{
                maxWidth: '800px',
                width: '100%',
                maxHeight: '90vh',
                borderRadius: '1.5rem',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                overflow: 'hidden',
                backgroundColor: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                animation: 'slideUp 0.3s ease-out',
                display: 'flex',
                flexDirection: 'column'
            }}>
                <div style={{
                    padding: '24px 36px',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'linear-gradient(to right, var(--color-bg-surface), var(--color-bg-surface-hover))'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ padding: '10px', background: 'rgba(37, 99, 235, 0.1)', borderRadius: '12px', color: 'var(--color-primary)' }}>
                            <Briefcase size={24} />
                        </div>
                        <div>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
                                {initialData ? 'Editar Licitação' : 'Nova Oportunidade'}
                            </h2>
                            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginTop: '2px' }}>
                                Gerencie os detalhes da disputa e acompanhe o progresso.
                            </p>
                        </div>
                    </div>
                    <button
                        className="icon-btn"
                        onClick={onClose}
                        style={{ background: 'var(--color-bg-surface)', borderRadius: '50%', padding: '8px', boxShadow: 'var(--shadow-sm)' }}
                    >
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} style={{ padding: '32px', overflowY: 'auto', flex: 1 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>

                        {/* Título */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>Título / Identificação do Processo *</label>
                            <div style={inputContainerStyle}>
                                <input
                                    type="text"
                                    name="title"
                                    style={inputInnerStyle}
                                    required
                                    placeholder="Ex: Pregão Eletrônico 01/2026 - Material de Expediente"
                                    value={formData.title || ''}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>

                        {/* Empresa Participante */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>Empresa Participante</label>
                            <div style={inputContainerStyle}>
                                <select
                                    name="companyProfileId"
                                    value={formData.companyProfileId || ''}
                                    onChange={handleChange}
                                    style={inputInnerStyle}
                                >
                                    <option value="">-- Selecione uma Empresa --</option>
                                    {companies.map(company => (
                                        <option key={company.id} value={company.id}>
                                            {company.razaoSocial} ({company.isHeadquarters ? 'Matriz' : 'Filial'})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Objeto */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>Objeto Resumido</label>
                            <div style={{ ...inputContainerStyle, alignItems: 'flex-start' }}>
                                <textarea
                                    name="summary"
                                    style={{ ...inputInnerStyle, height: '80px', resize: 'none' }}
                                    placeholder="Descrição breve do que está sendo licitado..."
                                    value={formData.summary || ''}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>

                        {/* Portal e Modalidade */}
                        <div>
                            <label style={labelStyle}>Portal / Origem *</label>
                            <div style={inputContainerStyle}>
                                <Globe size={18} color="var(--color-text-tertiary)" />
                                <input
                                    type="text"
                                    name="portal"
                                    style={inputInnerStyle}
                                    required
                                    placeholder="Ex: ComprasNet"
                                    value={formData.portal || ''}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>
                        <div>
                            <label style={labelStyle}>Modalidade *</label>
                            <div style={inputContainerStyle}>
                                <Tag size={18} color="var(--color-text-tertiary)" />
                                <input
                                    type="text"
                                    name="modality"
                                    style={inputInnerStyle}
                                    required
                                    placeholder="Ex: Pregão Eletrônico"
                                    value={formData.modality || ''}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>

                        {/* Valor, Data e Risco */}
                        <div>
                            <label style={labelStyle}>Valor Estimado (R$)</label>
                            <div style={inputContainerStyle}>
                                <DollarSign size={18} color="var(--color-text-tertiary)" />
                                <input
                                    type="number"
                                    step="0.01"
                                    name="estimatedValue"
                                    style={inputInnerStyle}
                                    value={formData.estimatedValue}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>
                        <div>
                            <label style={labelStyle}>Data/Hora da Sessão *</label>
                            <div style={inputContainerStyle}>
                                <Calendar size={18} color="var(--color-text-tertiary)" />
                                <input
                                    type="datetime-local"
                                    name="sessionDate"
                                    style={inputInnerStyle}
                                    required
                                    value={formData.sessionDate}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>Tag de Risco</label>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                {['Baixo', 'Médio', 'Alto', 'Crítico'].map((level) => (
                                    <button
                                        key={level}
                                        type="button"
                                        onClick={() => setFormData(p => ({ ...p, risk: level as RiskTag }))}
                                        style={{
                                            flex: 1,
                                            padding: '10px',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--color-border)',
                                            background: formData.risk === level ? 'var(--color-bg-surface-hover)' : 'var(--color-bg-surface)',
                                            color: formData.risk === level ? (
                                                level === 'Crítico' ? 'var(--color-danger)' :
                                                    level === 'Alto' ? '#ef4444' :
                                                        level === 'Médio' ? '#f59e0b' : 'var(--color-success)'
                                            ) : 'var(--color-text-secondary)',
                                            fontWeight: formData.risk === level ? 600 : 400,
                                            boxShadow: formData.risk === level ? 'inset 0 2px 4px rgba(0,0,0,0.05)' : 'none',
                                            transition: 'all 0.2s ease',
                                            borderColor: formData.risk === level ? 'currentColor' : 'var(--color-border)'
                                        }}
                                    >
                                        {level}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Link / Upload + PDF Viewer + Credenciais */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>Documentos do Edital / TR</label>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <div style={{ ...inputContainerStyle, flex: 1 }}>
                                    <Link size={18} color="var(--color-text-tertiary)" />
                                    <input
                                        type="text"
                                        name="link"
                                        style={inputInnerStyle}
                                        placeholder="Link do portal de compras ou edital..."
                                        value={formData.link || ''}
                                        onChange={handleChange}
                                    />
                                    {formData.link && formData.link.startsWith('http') && (
                                        <a href={formData.link} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, color: 'var(--color-primary)' }}>
                                            <ExternalLink size={18} />
                                        </a>
                                    )}
                                </div>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    style={{ display: 'none' }}
                                    onChange={handleFileChange}
                                    multiple
                                    accept="application/pdf"
                                />
                                <button
                                    type="button"
                                    className="btn btn-outline"
                                    onClick={handleFileUploadClick}
                                    disabled={isUploading}
                                    style={{ padding: '0 20px', display: 'flex', alignItems: 'center', gap: '8px' }}
                                >
                                    {isUploading ? <Loader2 size={18} className="spinner" /> : <UploadCloud size={18} />}
                                    Anexar PDF
                                </button>
                            </div>

                            {/* ── Attached Files Chips + Viewer ── */}
                            {formData.link && formData.link.includes('/uploads/') && (() => {
                                const allParts = formData.link.split(',').map(s => s.trim()).filter(s => s);
                                const pdfFiles = allParts.filter(s => s.startsWith('/uploads/'));
                                if (pdfFiles.length === 0) return null;
                                return (
                                    <div style={{ marginTop: '10px' }}>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: viewingPdf ? '12px' : 0 }}>
                                            {pdfFiles.map((file, idx) => {
                                                const name = decodeURIComponent(file.split('/').pop() || `Edital_${idx + 1}.pdf`);
                                                const shortName = name.length > 30 ? name.substring(0, 28) + '...' : name;
                                                const isViewing = viewingPdf === file;
                                                return (
                                                    <div key={idx} style={{
                                                        display: 'flex', alignItems: 'center', gap: '6px',
                                                        padding: '6px 12px', borderRadius: '20px',
                                                        border: isViewing ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                        background: isViewing ? 'rgba(59,130,246,0.06)' : 'var(--color-bg-body)',
                                                        fontSize: '0.75rem', fontWeight: 500
                                                    }}>
                                                        <span style={{ color: 'var(--color-danger)' }}>📄</span>
                                                        <span style={{ color: 'var(--color-text-primary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortName}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setViewingPdf(isViewing ? null : file)}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: isViewing ? 'var(--color-primary)' : 'var(--color-text-tertiary)', fontWeight: 600, fontSize: '0.7rem' }}
                                                            title="Visualizar PDF"
                                                        >
                                                            {isViewing ? '✕ Fechar' : '👁 Visualizar'}
                                                        </button>
                                                        <a
                                                            href={`${API_BASE_URL}${file}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: 'var(--color-text-tertiary)', fontSize: '0.7rem', textDecoration: 'none' }}
                                                            title="Abrir em nova aba"
                                                        >
                                                            ↗
                                                        </a>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {/* ── Inline PDF Viewer ── */}
                                        {viewingPdf && (
                                            <div style={{
                                                border: '1px solid var(--color-border)',
                                                borderRadius: 'var(--radius-lg)',
                                                overflow: 'hidden',
                                                background: '#525659',
                                                position: 'relative'
                                            }}>
                                                <div style={{
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                    padding: '8px 14px', background: 'var(--color-bg-surface)',
                                                    borderBottom: '1px solid var(--color-border)',
                                                    fontSize: '0.75rem'
                                                }}>
                                                    <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                                                        📄 Visualizador de Documento
                                                    </span>
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                        <a
                                                            href={`${API_BASE_URL}${viewingPdf}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="btn btn-secondary"
                                                            style={{ padding: '4px 10px', fontSize: '0.7rem' }}
                                                        >
                                                            Abrir em Nova Aba ↗
                                                        </a>
                                                        <button
                                                            type="button"
                                                            onClick={() => setViewingPdf(null)}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--color-text-tertiary)' }}
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                                <iframe
                                                    src={`${API_BASE_URL}${viewingPdf}`}
                                                    style={{ width: '100%', height: '500px', border: 'none' }}
                                                    title="Visualizador de PDF"
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* ── Credential Integration (AI-matched) ── */}
                            {credentials.length > 0 && (() => {
                                const portal = (formData.portal || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
                                const link = (formData.link || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');

                                // Score each credential for match
                                const scored = credentials.map(cred => {
                                    const cp = cred.platform.toLowerCase();
                                    const cu = (cred.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
                                    let score = 0;

                                    // Exact URL match
                                    if (cu && portal && (cu.includes(portal) || portal.includes(cu))) score += 10;
                                    if (cu && link && (cu.includes(link) || link.includes(cu))) score += 10;
                                    // Platform name match
                                    if (cp && portal && (cp.includes(portal) || portal.includes(cp))) score += 5;
                                    if (cp && link && link.includes(cp)) score += 5;
                                    // Partial domain match
                                    const portalDomain = portal.split('/')[0];
                                    const credDomain = cu.split('/')[0];
                                    if (portalDomain && credDomain && (portalDomain.includes(credDomain) || credDomain.includes(portalDomain))) score += 8;

                                    return { cred, score };
                                });

                                scored.sort((a, b) => b.score - a.score);
                                const bestMatch = scored[0]?.score > 0 ? scored[0].cred.id : null;

                                return (
                                    <div style={{
                                        marginTop: '12px',
                                        padding: '16px 20px',
                                        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.04), rgba(139, 92, 246, 0.04))',
                                        borderRadius: '1rem',
                                        border: '1px solid rgba(99, 102, 241, 0.15)'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#6366f1', marginBottom: '12px' }}>
                                            <KeyRound size={16} />
                                            <span style={{ fontWeight: 600, fontSize: '0.8125rem' }}>Credenciais de Acesso ao Portal</span>
                                            {bestMatch && (
                                                <span style={{
                                                    marginLeft: 'auto', padding: '3px 10px',
                                                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                                    color: '#fff', borderRadius: '12px',
                                                    fontSize: '0.65rem', fontWeight: 700,
                                                    display: 'flex', alignItems: 'center', gap: '4px'
                                                }}>
                                                    ✨ IA identificou a credencial
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {scored.map(({ cred, score: _score }) => {
                                                const isMatch = cred.id === bestMatch;
                                                return (
                                                    <div key={cred.id} style={{
                                                        padding: isMatch ? '14px 16px' : '10px 14px',
                                                        background: isMatch ? 'rgba(99, 102, 241, 0.06)' : 'white',
                                                        borderRadius: '0.75rem',
                                                        border: isMatch ? '2px solid #6366f1' : '1px solid var(--color-border)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '16px',
                                                        flexWrap: 'wrap',
                                                        transition: 'all 0.2s ease',
                                                        position: 'relative'
                                                    }}>
                                                        {isMatch && (
                                                            <span style={{
                                                                position: 'absolute', top: -8, right: 12,
                                                                padding: '2px 8px', background: '#22c55e',
                                                                color: '#fff', borderRadius: '8px',
                                                                fontSize: '0.6rem', fontWeight: 700
                                                            }}>
                                                                ✓ RECOMENDADA
                                                            </span>
                                                        )}
                                                        <div style={{ flex: '1 1 120px', minWidth: '120px' }}>
                                                            <span style={{
                                                                fontSize: '0.6875rem', fontWeight: 700,
                                                                textTransform: 'uppercase',
                                                                color: isMatch ? '#6366f1' : '#94a3b8',
                                                                letterSpacing: '0.05em'
                                                            }}>
                                                                {cred.platform}
                                                            </span>
                                                            {cred.url && (
                                                                <a href={cred.url} target="_blank" rel="noopener noreferrer" style={{
                                                                    display: 'block', fontSize: '0.72rem',
                                                                    color: isMatch ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                                                                    marginTop: '2px'
                                                                }}>
                                                                    {cred.url.replace(/^https?:\/\//, '').slice(0, 40)}{cred.url.length > 45 ? '...' : ''}
                                                                </a>
                                                            )}
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                            <div style={{
                                                                padding: '6px 12px', background: '#f8fafc', borderRadius: '8px',
                                                                border: '1px solid #e2e8f0', fontSize: '0.8125rem',
                                                                fontFamily: 'monospace', color: '#334155'
                                                            }}>
                                                                {cred.login}
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleCopy(cred.login, `login-${cred.id}`)}
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: copiedField === `login-${cred.id}` ? '#22c55e' : '#94a3b8' }}
                                                                title="Copiar login"
                                                            >
                                                                <Copy size={14} />
                                                            </button>
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                            <div style={{
                                                                padding: '6px 12px', background: '#f8fafc', borderRadius: '8px',
                                                                border: '1px solid #e2e8f0', fontSize: '0.8125rem',
                                                                fontFamily: 'monospace', color: '#334155', minWidth: '80px'
                                                            }}>
                                                                {showPassword[cred.id] ? (cred.password || '***') : '••••••••'}
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => setShowPassword(prev => ({ ...prev, [cred.id]: !prev[cred.id] }))}
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#94a3b8' }}
                                                                title={showPassword[cred.id] ? 'Ocultar senha' : 'Mostrar senha'}
                                                            >
                                                                {showPassword[cred.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleCopy(cred.password || '', `pass-${cred.id}`)}
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: copiedField === `pass-${cred.id}` ? '#22c55e' : '#94a3b8' }}
                                                                title="Copiar senha"
                                                            >
                                                                <Copy size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Sistema de Lembrete Inteligente */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <div style={{
                                padding: '24px',
                                background: formData.reminderType === 'weekdays'
                                    ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.04), rgba(249, 115, 22, 0.04))'
                                    : 'rgba(245, 158, 11, 0.03)',
                                borderRadius: '1rem',
                                border: `1px solid ${formData.reminderType === 'weekdays' ? 'rgba(249, 115, 22, 0.25)' : 'rgba(245, 158, 11, 0.2)'}`,
                                transition: 'all 0.3s'
                            }}>
                                {/* Header */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#b45309' }}>
                                        <Bell size={18} />
                                        <span style={{ fontWeight: 600 }}>Lembrete Inteligente</span>
                                    </div>
                                    {/* Tipo toggle */}
                                    <div style={{ display: 'flex', gap: '4px', padding: '3px', background: '#f1f5f9', borderRadius: '10px' }}>
                                        <button
                                            type="button"
                                            onClick={() => setFormData(p => ({ ...p, reminderType: 'once' }))}
                                            style={{
                                                padding: '5px 14px',
                                                borderRadius: '8px',
                                                border: 'none',
                                                background: formData.reminderType === 'once' ? 'white' : 'transparent',
                                                boxShadow: formData.reminderType === 'once' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                                color: formData.reminderType === 'once' ? '#1e293b' : '#94a3b8',
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            Único
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setFormData(p => ({ ...p, reminderType: 'weekdays' }))}
                                            style={{
                                                padding: '5px 14px',
                                                borderRadius: '8px',
                                                border: 'none',
                                                background: formData.reminderType === 'weekdays' ? 'white' : 'transparent',
                                                boxShadow: formData.reminderType === 'weekdays' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                                color: formData.reminderType === 'weekdays' ? '#ea580c' : '#94a3b8',
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <RefreshCw size={11} /> Recorrente
                                            </span>
                                        </button>
                                    </div>
                                </div>

                                {/* Date/Time row */}
                                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: formData.reminderType === 'weekdays' ? '16px' : '0' }}>
                                    <div style={{ ...inputContainerStyle, flex: 1, backgroundColor: 'white' }}>
                                        <Calendar size={16} color="#b45309" />
                                        <input
                                            type={formData.reminderType === 'weekdays' ? 'time' : 'datetime-local'}
                                            name="reminderDate"
                                            style={inputInnerStyle}
                                            value={formData.reminderType === 'weekdays'
                                                ? (formData.reminderDate ? formData.reminderDate.slice(11, 16) : '')
                                                : (formData.reminderDate || '')
                                            }
                                            onChange={(e) => {
                                                if (formData.reminderType === 'weekdays') {
                                                    // Store as a full datetime using today's date + selected time
                                                    const today = new Date();
                                                    const [h, m] = e.target.value.split(':');
                                                    today.setHours(parseInt(h), parseInt(m), 0, 0);
                                                    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
                                                    setFormData(prev => ({ ...prev, reminderDate: today.toISOString().slice(0, 16) }));
                                                } else {
                                                    handleChange(e);
                                                }
                                            }}
                                        />
                                    </div>
                                    <p style={{ margin: 0, fontSize: '0.8125rem', color: '#92400e', maxWidth: '260px', lineHeight: 1.4 }}>
                                        {formData.reminderType === 'weekdays'
                                            ? 'Horário do alarme nos dias selecionados abaixo.'
                                            : 'Um aviso será disparado para toda a equipe no horário configurado.'
                                        }
                                    </p>
                                </div>

                                {/* Weekday selector (shown only in recurring mode) */}
                                {formData.reminderType === 'weekdays' && (() => {
                                    const selectedDays: number[] = (() => {
                                        try { return JSON.parse(formData.reminderDays || '[]'); } catch { return []; }
                                    })();
                                    const dayLabels = [
                                        { num: 1, short: 'Seg', long: 'Segunda' },
                                        { num: 2, short: 'Ter', long: 'Terça' },
                                        { num: 3, short: 'Qua', long: 'Quarta' },
                                        { num: 4, short: 'Qui', long: 'Quinta' },
                                        { num: 5, short: 'Sex', long: 'Sexta' },
                                        { num: 6, short: 'Sáb', long: 'Sábado' },
                                        { num: 0, short: 'Dom', long: 'Domingo' },
                                    ];
                                    const toggleDay = (day: number) => {
                                        const newDays = selectedDays.includes(day)
                                            ? selectedDays.filter(d => d !== day)
                                            : [...selectedDays, day];
                                        setFormData(prev => ({ ...prev, reminderDays: JSON.stringify(newDays) }));
                                    };
                                    const weekdaysOnly = [1, 2, 3, 4, 5];
                                    const allDays = [0, 1, 2, 3, 4, 5, 6];
                                    const isWeekdaysSelected = weekdaysOnly.every(d => selectedDays.includes(d)) && selectedDays.length === 5;
                                    const isAllSelected = allDays.every(d => selectedDays.includes(d));

                                    return (
                                        <div>
                                            <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                                                {dayLabels.map(day => (
                                                    <button
                                                        key={day.num}
                                                        type="button"
                                                        onClick={() => toggleDay(day.num)}
                                                        title={day.long}
                                                        style={{
                                                            flex: 1,
                                                            padding: '8px 0',
                                                            borderRadius: '10px',
                                                            border: `2px solid ${selectedDays.includes(day.num) ? '#f59e0b' : '#e2e8f0'}`,
                                                            background: selectedDays.includes(day.num)
                                                                ? 'linear-gradient(135deg, #fbbf24, #f59e0b)'
                                                                : 'white',
                                                            color: selectedDays.includes(day.num) ? 'white' : '#94a3b8',
                                                            fontSize: '0.75rem',
                                                            fontWeight: 700,
                                                            cursor: 'pointer',
                                                            transition: 'all 0.15s',
                                                            boxShadow: selectedDays.includes(day.num) ? '0 2px 8px rgba(245, 158, 11, 0.3)' : 'none'
                                                        }}
                                                    >
                                                        {day.short}
                                                    </button>
                                                ))}
                                            </div>
                                            {/* Quick presets */}
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData(prev => ({ ...prev, reminderDays: JSON.stringify(weekdaysOnly) }))}
                                                    style={{
                                                        padding: '4px 12px',
                                                        borderRadius: '6px',
                                                        border: `1px solid ${isWeekdaysSelected ? '#f59e0b' : '#e2e8f0'}`,
                                                        background: isWeekdaysSelected ? 'rgba(245, 158, 11, 0.1)' : 'white',
                                                        color: isWeekdaysSelected ? '#b45309' : '#64748b',
                                                        fontSize: '0.6875rem',
                                                        fontWeight: 600,
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    Dias úteis
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData(prev => ({ ...prev, reminderDays: JSON.stringify(allDays) }))}
                                                    style={{
                                                        padding: '4px 12px',
                                                        borderRadius: '6px',
                                                        border: `1px solid ${isAllSelected ? '#f59e0b' : '#e2e8f0'}`,
                                                        background: isAllSelected ? 'rgba(245, 158, 11, 0.1)' : 'white',
                                                        color: isAllSelected ? '#b45309' : '#64748b',
                                                        fontSize: '0.6875rem',
                                                        fontWeight: 600,
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    Todos os dias
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData(prev => ({ ...prev, reminderDays: '[]' }))}
                                                    style={{
                                                        padding: '4px 12px',
                                                        borderRadius: '6px',
                                                        border: '1px solid #e2e8f0',
                                                        background: 'white',
                                                        color: '#94a3b8',
                                                        fontSize: '0.6875rem',
                                                        fontWeight: 600,
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    Limpar
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>

                        {/* Observações */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>Historico de Observações</label>
                            <div style={{
                                background: 'var(--color-bg-base)',
                                borderRadius: '1rem',
                                border: '1px solid var(--color-border)',
                                padding: '20px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '16px'
                            }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '180px', overflowY: 'auto' }}>
                                    {observations.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-tertiary)' }}>
                                            <MessageSquare size={32} style={{ marginBottom: '8px', opacity: 0.2 }} />
                                            <p style={{ margin: 0, fontSize: '0.875rem' }}>Nenhum comentário registrado.</p>
                                        </div>
                                    ) : (
                                        observations.map(obs => (
                                            <div key={obs.id} style={{
                                                padding: '12px 16px',
                                                background: 'var(--color-bg-surface)',
                                                borderRadius: '0.75rem',
                                                border: '1px solid var(--color-border)',
                                                boxShadow: 'var(--shadow-sm)'
                                            }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-primary)' }}>Equipe Licita</span>
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                                                        {new Date(obs.timestamp).toLocaleString('pt-BR')}
                                                    </span>
                                                </div>
                                                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-primary)', lineHeight: 1.5 }}>{obs.text}</p>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <div style={{ ...inputContainerStyle, flex: 1, backgroundColor: 'var(--color-bg-surface)' }}>
                                        <input
                                            value={newObservation}
                                            onChange={(e) => setNewObservation(e.target.value)}
                                            style={inputInnerStyle}
                                            placeholder="Adicionar atualização..."
                                            onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddObservation())}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={handleAddObservation}
                                        style={{ padding: '12px', borderRadius: 'var(--radius-md)' }}
                                    >
                                        <PlusCircle size={20} />
                                    </button>
                                </div>
                            </div>
                        </div>

                    </div>

                    <div style={{
                        marginTop: '40px',
                        display: 'flex',
                        gap: '12px',
                        justifyContent: 'flex-end',
                        paddingTop: '28px',
                        borderTop: '1px solid var(--color-border)'
                    }}>
                        <button type="button" className="btn btn-outline" onClick={onClose} style={{ padding: '12px 24px' }}>
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            style={{
                                padding: '12px 40px',
                                background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))',
                                boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)',
                                fontWeight: 600
                            }}
                        >
                            <Save size={18} /> Salvar Licitação
                        </button>
                    </div>
                </form>
            </div>

            <style>{`
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                ::-webkit-scrollbar { width: 6px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 10px; }
                ::-webkit-scrollbar-thumb:hover { background: var(--color-text-tertiary); }
`}</style>
        </div>
    );
}

const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    marginBottom: '10px'
};

const inputContainerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    backgroundColor: 'var(--color-bg-base)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    transition: 'all 0.2s ease',
};

const inputInnerStyle: React.CSSProperties = {
    border: 'none',
    background: 'transparent',
    outline: 'none',
    width: '100%',
    color: 'var(--color-text-primary)',
    fontSize: '0.9375rem',
};
