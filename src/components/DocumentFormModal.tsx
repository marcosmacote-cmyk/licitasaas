import React, { useState, useEffect } from 'react';
import { FileText, Calendar, Upload, Link, Info, ShieldCheck, FileSearch, Briefcase, HelpCircle, Clock } from 'lucide-react';
import type { CompanyDocument, DocumentStatus } from '../types';
import { Modal, FormField, Input, Button } from './ui';

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

    const extractDateString = (isoString?: string) => {
        if (!isoString) return '';
        try {
            return new Date(isoString).toISOString().split('T')[0];
        } catch {
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

    const footer = (
        <>
            <Button variant="outline" onClick={onClose} size="lg">
                Cancelar
            </Button>
            <Button
                variant="primary"
                size="lg"
                onClick={handleSubmit}
                style={{
                    background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))',
                    boxShadow: 'var(--shadow-md)',
                }}
            >
                {initialData ? 'Confirmar Atualização' : 'Cadastrar Documento'}
            </Button>
        </>
    );

    return (
        <Modal
            open={true}
            onClose={onClose}
            title={initialData ? 'Atualizar Documento' : 'Novo Documento'}
            subtitle="Preencha os dados abaixo para manter o compliance da empresa."
            maxWidth="650px"
            footer={footer}
        >
            <form onSubmit={handleSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>

                    {/* Nome do Documento */}
                    <FormField label="Nome ou Identificação do Documento" required fullWidth>
                        <Input
                            icon={<FileText size={18} color="var(--color-text-secondary)" />}
                            required
                            placeholder="Ex: Certidão Negativa de Débitos Estaduais"
                            value={formData.docType || ''}
                            onChange={(e) => setFormData({ ...formData, docType: e.target.value })}
                        />
                    </FormField>

                    {/* Grupo de Documentos */}
                    <FormField label="Grupo de Documentação" required fullWidth>
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
                                        cursor: 'pointer',
                                    }}
                                >
                                    {group.icon}
                                    {group.id}
                                </button>
                            ))}
                        </div>
                    </FormField>

                    {/* Data de Vencimento */}
                    <FormField label="Data de Vencimento" required>
                        <Input
                            icon={<Calendar size={18} color="var(--color-text-secondary)" />}
                            type="date"
                            required
                            value={dateInput}
                            onChange={(e) => setDateInput(e.target.value)}
                        />
                    </FormField>

                    {/* Link do Órgão Emissor */}
                    <FormField label="Link do Órgão (Opcional)">
                        <Input
                            icon={<Link size={18} color="var(--color-text-secondary)" />}
                            type="url"
                            placeholder="https://..."
                            value={formData.issuerLink || ''}
                            onChange={(e) => setFormData({ ...formData, issuerLink: e.target.value })}
                        />
                    </FormField>

                    {/* Dias de Alerta */}
                    <FormField label="Alerta de Vencimento (Dias)">
                        <Input
                            icon={<Clock size={18} color="var(--color-text-secondary)" />}
                            type="number"
                            min={1}
                            max={365}
                            value={formData.alertDays || 15}
                            onChange={(e) => setFormData({ ...formData, alertDays: parseInt(e.target.value) })}
                        />
                    </FormField>

                    {/* Upload de Arquivo */}
                    <div style={{ gridColumn: '1 / -1' }}>
                        <FormField label={initialData ? 'Substituir Arquivo PDF' : 'Arquivo PDF do Documento'} required={!initialData}>
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
                                    width: '48px', height: '48px', borderRadius: '50%',
                                    backgroundColor: 'var(--color-primary-light)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: 'var(--color-primary)'
                                }}>
                                    <Upload size={24} />
                                </div>
                                <div>
                                    <p style={{ margin: 0, fontWeight: 'var(--font-semibold)', color: 'var(--color-text-primary)' }}>
                                        {selectedFile ? selectedFile.name : initialData ? 'Clique para substituir o arquivo atual' : 'Escolher arquivo ou arrastar e soltar'}
                                    </p>
                                    <p style={{ margin: '4px 0 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                                        Apenas formato PDF (máx. 10MB)
                                    </p>
                                </div>
                            </div>
                        </FormField>
                        {initialData && !selectedFile && (
                            <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-base)' }}>
                                <Info size={14} />
                                <span>Arquivo atual: <strong>{initialData.fileName}</strong></span>
                            </div>
                        )}
                    </div>
                </div>
            </form>
        </Modal>
    );
}
