import React, { useState, useEffect } from 'react';
import { X, FileText, Calendar, Upload, Link, Info, ShieldCheck, FileSearch, Briefcase, HelpCircle, Clock } from 'lucide-react';
import type { CompanyDocument, DocumentStatus } from '../types';

interface Props {
    initialData?: CompanyDocument | null;
    companyProfileId: string;
    onClose: () => void;
    onSave: (doc: Partial<CompanyDocument>, file?: File) => void;
}

const DOCUMENT_GROUPS = [
    { id: 'Habilitação Jurídica', icon: <ShieldCheck size={18} />, color: '#3b82f6' },
    { id: 'Regularidade Fiscal, Social e Trabalhista', icon: <FileSearch size={18} />, color: '#10b981' },
    { id: 'Qualificação Técnica', icon: <Briefcase size={18} />, color: '#8b5cf6' },
    { id: 'Qualificação Econômica Financeira', icon: <FileText size={18} />, color: '#f59e0b' },
    { id: 'Outros', icon: <HelpCircle size={18} />, color: '#64748b' },
];

export function DocumentFormModal({ initialData, companyProfileId, onClose, onSave }: Props) {
    const [formData, setFormData] = useState<Partial<CompanyDocument>>({
        companyProfileId,
        docType: '',
        expirationDate: '',
        docGroup: 'Outros',
        issuerLink: '',
        alertDays: 15,
    });
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    // To extract visual correctly for date inputs YYYY-MM-DD
    const extractDateString = (isoString?: string) => {
        if (!isoString) return '';
        try {
            return new Date(isoString).toISOString().split('T')[0];
        } catch (e) {
            return '';
        }
    };

    const [dateInput, setDateInput] = useState(extractDateString(initialData?.expirationDate));

    useEffect(() => {
        if (initialData) {
            setFormData({
                ...initialData,
                issuerLink: initialData.issuerLink || '',
                docGroup: initialData.docGroup || 'Outros',
                alertDays: initialData.alertDays || 15
            });
            setDateInput(extractDateString(initialData.expirationDate));
        }
    }, [initialData]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        let status: DocumentStatus = 'Válido';
        if (dateInput) {
            const expDate = new Date(dateInput);
            const now = new Date();
            const diffTime = expDate.getTime() - now.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays < 0) {
                status = 'Vencido';
            } else if (diffDays <= (formData.alertDays || 15)) {
                status = 'Vencendo';
            }
        }

        const finalData = {
            ...formData,
            expirationDate: dateInput ? new Date(dateInput).toISOString() : '',
            status
        };

        onSave(finalData, selectedFile || undefined);
    };

    return (
        <div className="modal-overlay" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            animation: 'fadeIn 0.2s ease-out'
        }}>
            <div className="modal-content" style={{
                maxWidth: '650px',
                width: '100%',
                borderRadius: '1.25rem',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                overflow: 'hidden',
                backgroundColor: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                animation: 'slideUp 0.3s ease-out'
            }}>
                <div style={{
                    padding: '24px 32px',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'linear-gradient(to right, var(--color-bg-surface), var(--color-bg-surface-hover))'
                }}>
                    <div>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
                            {initialData ? 'Atualizar Documento' : 'Novo Documento'}
                        </h2>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginTop: '4px' }}>
                            Preencha os dados abaixo para manter o compliance da empresa.
                        </p>
                    </div>
                    <button
                        className="icon-btn"
                        onClick={onClose}
                        style={{ background: 'var(--color-bg-surface)', borderRadius: '50%', padding: '8px', boxShadow: 'var(--shadow-sm)' }}
                    >
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} style={{ padding: '32px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>

                        {/* Nome do Documento */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>Nome ou Identificação do Documento *</label>
                            <div style={inputContainerStyle}>
                                <FileText size={18} color="var(--color-text-secondary)" />
                                <input
                                    type="text"
                                    style={inputInnerStyle}
                                    required
                                    placeholder="Ex: Certidão Negativa de Débitos Estaduais"
                                    value={formData.docType || ''}
                                    onChange={(e) => setFormData({ ...formData, docType: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* Grupo de Documentos */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>Grupo de Documentação *</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                                {DOCUMENT_GROUPS.map((group) => (
                                    <button
                                        key={group.id}
                                        type="button"
                                        onClick={() => setFormData({ ...formData, docGroup: group.id })}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            padding: '10px 14px',
                                            borderRadius: 'var(--radius-md)',
                                            fontSize: '0.8125rem',
                                            fontWeight: 500,
                                            border: '1px solid',
                                            borderColor: formData.docGroup === group.id ? group.color : 'var(--color-border)',
                                            backgroundColor: formData.docGroup === group.id ? group.color + '15' : 'transparent',
                                            color: formData.docGroup === group.id ? group.color : 'var(--color-text-secondary)',
                                            transition: 'all 0.2s ease',
                                        }}
                                    >
                                        {group.icon}
                                        {group.id}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Data de Vencimento */}
                        <div>
                            <label style={labelStyle}>Data de Vencimento *</label>
                            <div style={inputContainerStyle}>
                                <Calendar size={18} color="var(--color-text-secondary)" />
                                <input
                                    type="date"
                                    style={inputInnerStyle}
                                    required
                                    value={dateInput}
                                    onChange={(e) => setDateInput(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Link do Órgão Emissor */}
                        <div>
                            <label style={labelStyle}>Link do Órgão (Opcional)</label>
                            <div style={inputContainerStyle}>
                                <Link size={18} color="var(--color-text-secondary)" />
                                <input
                                    type="url"
                                    style={inputInnerStyle}
                                    placeholder="https://..."
                                    value={formData.issuerLink || ''}
                                    onChange={(e) => setFormData({ ...formData, issuerLink: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* Dias de Alerta */}
                        <div>
                            <label style={labelStyle}>Alerta de Vencimento (Dias)</label>
                            <div style={inputContainerStyle}>
                                <Clock size={18} color="var(--color-text-secondary)" />
                                <input
                                    type="number"
                                    style={inputInnerStyle}
                                    min="1"
                                    max="365"
                                    value={formData.alertDays || 15}
                                    onChange={(e) => setFormData({ ...formData, alertDays: parseInt(e.target.value) })}
                                />
                            </div>
                        </div>

                        {/* Upload de Arquivo */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>
                                {initialData ? 'Substituir Arquivo PDF' : 'Arquivo PDF do Documento *'}
                            </label>
                            <div style={{
                                border: '2px dashed var(--color-border)',
                                borderRadius: '1rem',
                                padding: '32px',
                                textAlign: 'center',
                                backgroundColor: 'var(--color-bg-surface-hover)',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                position: 'relative',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '12px'
                            }}
                                onDragOver={(e) => e.currentTarget.style.borderColor = 'var(--color-primary)'}
                                onDragLeave={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
                            >
                                <input
                                    type="file"
                                    accept="application/pdf"
                                    required={!initialData}
                                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                    style={{ position: 'absolute', top: 0, left: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                                />
                                <div style={{
                                    width: '48px',
                                    height: '48px',
                                    borderRadius: '50%',
                                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'var(--color-primary)'
                                }}>
                                    <Upload size={24} />
                                </div>
                                <div>
                                    <p style={{ margin: 0, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                        {selectedFile ? selectedFile.name : initialData ? 'Clique para substituir o arquivo atual' : 'Escolher arquivo ou arrastar e soltar'}
                                    </p>
                                    <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                                        Apenas formato PDF (máx. 10MB)
                                    </p>
                                </div>
                            </div>
                            {initialData && !selectedFile && (
                                <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>
                                    <Info size={14} />
                                    <span>Arquivo atual: <strong>{initialData.fileName}</strong></span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div style={{
                        marginTop: '40px',
                        display: 'flex',
                        gap: '12px',
                        justifyContent: 'flex-end',
                        paddingTop: '24px',
                        borderTop: '1px solid var(--color-border)'
                    }}>
                        <button
                            type="button"
                            className="btn btn-outline"
                            onClick={onClose}
                            style={{ padding: '12px 24px', borderRadius: 'var(--radius-md)' }}
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            style={{
                                padding: '12px 32px',
                                borderRadius: 'var(--radius-md)',
                                background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))',
                                boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)'
                            }}
                        >
                            {initialData ? 'Confirmar Atualização' : 'Cadastrar Documento'}
                        </button>
                    </div>
                </form>
            </div>

            <style>{`
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            `}</style>
        </div>
    );
}

const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    marginBottom: '8px'
};

const inputContainerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    backgroundColor: 'var(--color-bg-base)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
};

const inputInnerStyle: React.CSSProperties = {
    border: 'none',
    background: 'transparent',
    outline: 'none',
    width: '100%',
    color: 'var(--color-text-primary)',
    fontSize: '0.9375rem',
};
