import React, { useState, useEffect } from 'react';
import { X, FileText, Calendar, Upload, Link, Info, ShieldCheck, FileSearch, Briefcase, HelpCircle, Clock } from 'lucide-react';
import type { CompanyDocument, DocumentStatus } from '../types';

interface Props {
    initialData?: CompanyDocument | null;
    companyProfileId: string;
    onClose: () => void;
    onSave: (doc: Partial<CompanyDocument>, file?: File) => void;
    groupAlertDays?: Record<string, number>;
    defaultAlertDays?: number;
}

const DOCUMENT_GROUPS = [
    { id: 'Habilitação Jurídica', icon: <ShieldCheck size={18} />, color: 'var(--color-primary)' },
    { id: 'Regularidade Fiscal, Social e Trabalhista', icon: <FileSearch size={18} />, color: 'var(--color-success)' },
    { id: 'Qualificação Técnica', icon: <Briefcase size={18} />, color: 'var(--color-ai)' },
    { id: 'Qualificação Econômica Financeira', icon: <FileText size={18} />, color: 'var(--color-warning)' },
    { id: 'Outros', icon: <HelpCircle size={18} />, color: 'var(--color-neutral)' },
];

export function DocumentFormModal({ initialData, companyProfileId, onClose, onSave, groupAlertDays, defaultAlertDays }: Props) {
    const defaultGroup = 'Outros';
    const initialAlert = groupAlertDays?.[defaultGroup] ?? defaultAlertDays ?? 15;

    const [formData, setFormData] = useState<Partial<CompanyDocument>>({
        companyProfileId,
        docType: '',
        expirationDate: '',
        docGroup: defaultGroup,
        issuerLink: '',
        alertDays: initialAlert,
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
                alertDays: initialData.alertDays || groupAlertDays?.[initialData.docGroup || 'Outros'] || defaultAlertDays || 15
            });
            setDateInput(extractDateString(initialData.expirationDate));
        }
    }, [initialData]);

    // Auto update alertDays when group changes, if it's a new document
    useEffect(() => {
        if (!initialData && formData.docGroup) {
            const groupDefault = groupAlertDays?.[formData.docGroup] ?? defaultAlertDays ?? 15;
            setFormData(prev => ({ ...prev, alertDays: groupDefault }));
        }
    }, [formData.docGroup, initialData, groupAlertDays, defaultAlertDays]);

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
            animation: 'fadeIn 0.2s ease-out',
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 1000,
            padding: '20px'
        }}>
            <div className="modal-content" style={{
                maxWidth: '650px',
                width: '100%',
                maxHeight: '90vh',
                borderRadius: 'var(--radius-xl)',
                boxShadow: 'var(--shadow-xl)',
                overflowY: 'auto',
                backgroundColor: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                animation: 'slideUp 0.3s ease-out'
            }}>
                <div style={{
                    padding: 'var(--space-6) var(--space-8)',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'linear-gradient(to right, var(--color-bg-surface), var(--color-bg-surface-hover))'
                }}>
                    <div>
                        <h2 style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)', margin: 0 }}>
                            {initialData ? 'Atualizar Documento' : 'Novo Documento'}
                        </h2>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-md)', marginTop: '4px' }}>
                            Preencha os dados abaixo para manter o compliance da empresa.
                        </p>
                    </div>
                    <button
                        className="icon-btn"
                        onClick={onClose}
                        style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-full)', padding: 'var(--space-2)', boxShadow: 'var(--shadow-sm)' }}
                    >
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} style={{ padding: 'var(--space-8)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>

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
                                            fontSize: 'var(--text-base)',
                                            fontWeight: 'var(--font-medium)',
                                            border: '1px solid',
                                            borderColor: formData.docGroup === group.id ? group.color : 'var(--color-border)',
                                            backgroundColor: formData.docGroup === group.id ? group.color + '15' : 'transparent',
                                            color: formData.docGroup === group.id ? group.color : 'var(--color-text-secondary)',
                                            transition: 'var(--transition-fast)',
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
                                borderRadius: 'var(--radius-xl)',
                                padding: 'var(--space-8)',
                                textAlign: 'center',
                                backgroundColor: 'var(--color-bg-surface-hover)',
                                cursor: 'pointer',
                                transition: 'var(--transition-fast)',
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
                                    backgroundColor: 'var(--color-primary-light)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'var(--color-primary)'
                                }}>
                                    <Upload size={24} />
                                </div>
                                <div>
                                    <p style={{ margin: 0, fontWeight: 'var(--font-semibold)', color: 'var(--color-text-primary)' }}>
                                        {selectedFile ? selectedFile.name : initialData ? 'Clique para substituir o arquivo atual' : 'Escolher arquivo ou arrastar e soltar'}
                                    </p>
                                    <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                                        Apenas formato PDF (máx. 10MB)
                                    </p>
                                </div>
                            </div>
                            {initialData && !selectedFile && (
                                <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-base)' }}>
                                    <Info size={14} />
                                    <span>Arquivo atual: <strong>{initialData.fileName}</strong></span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div style={{
                        marginTop: 'var(--space-10)',
                        display: 'flex',
                        gap: 'var(--space-3)',
                        justifyContent: 'flex-end',
                        paddingTop: 'var(--space-6)',
                        borderTop: '1px solid var(--color-border)'
                    }}>
                        <button
                            type="button"
                            className="btn btn-outline"
                            onClick={onClose}
                            style={{ padding: 'var(--space-3) var(--space-6)', borderRadius: 'var(--radius-md)' }}
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            style={{
                                padding: 'var(--space-3) var(--space-8)',
                                borderRadius: 'var(--radius-md)',
                                background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))',
                                boxShadow: 'var(--shadow-md)'
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
    fontSize: 'var(--text-md)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--color-text-secondary)',
    marginBottom: 'var(--space-2)'
};

const inputContainerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-3) var(--space-4)',
    backgroundColor: 'var(--color-bg-base)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    transition: 'var(--transition-fast)',
};

const inputInnerStyle: React.CSSProperties = {
    border: 'none',
    background: 'transparent',
    outline: 'none',
    width: '100%',
    color: 'var(--color-text-primary)',
    fontSize: 'var(--text-base)',
};
