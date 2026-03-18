import React, { useState, useEffect } from 'react';
import { Building2, Tag, Mail, Phone, Save, Info, MapPin, Landmark } from 'lucide-react';
import type { CompanyProfile } from '../types';
import { Modal, FormField, Input, Textarea, Button } from './ui';

interface SignatureConfig {
    bankData?: { bank: string; agency: string; account: string; accountType: string; pix: string };
    signatureMode?: string;
    validityDays?: number;
}

interface Props {
    initialData?: CompanyProfile | null;
    onClose: () => void;
    onSave: (company: Partial<CompanyProfile>) => void;
}

export function CompanyFormModal({ initialData, onClose, onSave }: Props) {
    const [formData, setFormData] = useState<Partial<CompanyProfile>>({
        razaoSocial: '',
        cnpj: '',
        isHeadquarters: false,
    });

    // Dados bancários extraídos do JSON
    const [sigConfig, setSigConfig] = useState<SignatureConfig>({
        bankData: { bank: '', agency: '', account: '', accountType: 'Conta Corrente', pix: '' },
        signatureMode: 'LEGAL',
        validityDays: 60,
    });

    useEffect(() => {
        if (initialData) {
            setFormData(initialData);
            // Restaurar config de assinatura do JSON salvo
            try {
                const saved = initialData.defaultSignatureConfig;
                if (saved) {
                    const parsed = JSON.parse(saved);
                    setSigConfig({
                        bankData: parsed.bankData || { bank: '', agency: '', account: '', accountType: 'Conta Corrente', pix: '' },
                        signatureMode: parsed.signatureMode || 'LEGAL',
                        validityDays: parsed.validityDays || 60,
                    });
                }
            } catch { /* ignore */ }
        }
    }, [initialData]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const { razaoSocial, cnpj, isHeadquarters, qualification, technicalQualification, contactName, contactCpf, contactEmail, contactPhone, address, city, state } = formData;
        // Salvar config de assinatura como JSON
        const defaultSignatureConfig = JSON.stringify(sigConfig);
        onSave({ razaoSocial, cnpj, isHeadquarters, qualification, technicalQualification, contactName, contactCpf, contactEmail, contactPhone, address, city, state, defaultSignatureConfig });
    };

    const footer = (
        <>
            <Button variant="outline" onClick={onClose} size="lg">
                Cancelar
            </Button>
            <Button
                variant="primary"
                size="lg"
                icon={<Save size={18} />}
                onClick={handleSubmit}
                style={{
                    background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))',
                    boxShadow: 'var(--shadow-md)',
                }}
            >
                Salvar Empresa
            </Button>
        </>
    );

    return (
        <Modal
            open={true}
            onClose={onClose}
            title={initialData ? 'Editar Empresa' : 'Cadastrar Empresa'}
            subtitle="Configure os dados cadastrais da proponente."
            maxWidth="650px"
            footer={footer}
        >
            <form onSubmit={handleSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>

                    {/* Razão Social */}
                    <FormField label="Razão Social" required fullWidth>
                        <Input
                            icon={<Building2 size={18} color="var(--color-text-secondary)" />}
                            required
                            placeholder="Ex: Tech Solutions LTDA"
                            value={formData.razaoSocial || ''}
                            onChange={(e) => setFormData({ ...formData, razaoSocial: e.target.value })}
                        />
                    </FormField>

                    {/* CNPJ */}
                    <FormField label="CNPJ" required>
                        <Input
                            icon={<Tag size={18} color="var(--color-text-secondary)" />}
                            required
                            placeholder="00.000.000/0000-00"
                            value={formData.cnpj || ''}
                            onChange={(e) => setFormData({ ...formData, cnpj: e.target.value })}
                        />
                    </FormField>

                    {/* Tipo de Unidade */}
                    <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '14px' }}>
                        <label style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            cursor: 'pointer',
                            padding: '10px 16px',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: formData.isHeadquarters ? 'var(--color-primary-light)' : 'transparent',
                            border: formData.isHeadquarters ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                            transition: 'var(--transition-fast)'
                        }}>
                            <input
                                type="checkbox"
                                checked={formData.isHeadquarters || false}
                                onChange={(e) => setFormData({ ...formData, isHeadquarters: e.target.checked })}
                                style={{ width: '18px', height: '18px', accentColor: 'var(--color-primary)' }}
                            />
                            <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-medium)', color: formData.isHeadquarters ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                                Empresa Matriz (Sede)
                            </span>
                        </label>
                    </div>

                    {/* Qualificação e Representante */}
                    <FormField label="Qualificação da Empresa e Representante Legal" required fullWidth>
                        <Textarea
                            icon={<Info size={18} color="var(--color-text-secondary)" />}
                            required
                            placeholder="Ex: Empresa sediada em [Endereço], representada por [Nome], [Cargo], portador do CPF [CPF]..."
                            value={formData.qualification || ''}
                            onChange={(e) => setFormData({ ...formData, qualification: e.target.value })}
                        />
                    </FormField>

                    {/* Qualificação do Responsável Técnico */}
                    <FormField
                        label="Qualificação do Responsável Técnico"
                        hint="Usado para declarações que exigem anuência do profissional técnico (ex: acervo técnico, responsável técnico)."
                        fullWidth
                    >
                        <Textarea
                            icon={<Info size={18} color="var(--color-text-secondary)" />}
                            placeholder="Ex: [Nome], [nacionalidade], [estado civil], [profissão], inscrito no CREA/CAU sob nº [Nº], CPF nº [CPF], residente em [Endereço]..."
                            minHeight="60px"
                            value={formData.technicalQualification || ''}
                            onChange={(e) => setFormData({ ...formData, technicalQualification: e.target.value })}
                        />
                    </FormField>

                    {/* Canais de Contato */}
                    <div className="col-span-full">
                        <div className="card p-6">
                            <div className="flex-gap" style={{ gap: 'var(--space-2)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
                                <Phone size={16} />
                                <span className="form-label mb-0">Canais de Contato</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)' }}>
                                <FormField label="Nome do Contato (Repr. Legal)">
                                    <Input
                                        placeholder="Nome Completo"
                                        value={formData.contactName || ''}
                                        onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                                    />
                                </FormField>
                                <FormField label="CPF do Repr. Legal">
                                    <Input
                                        placeholder="000.000.000-00"
                                        value={formData.contactCpf || ''}
                                        onChange={(e) => setFormData({ ...formData, contactCpf: e.target.value })}
                                    />
                                </FormField>
                                <FormField label="E-mail">
                                    <Input
                                        icon={<Mail size={16} color="var(--color-text-tertiary)" />}
                                        placeholder="email@empresa.com"
                                        value={formData.contactEmail || ''}
                                        onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                                    />
                                </FormField>
                                <FormField label="Telefone">
                                    <Input
                                        icon={<Phone size={16} color="var(--color-text-tertiary)" />}
                                        placeholder="(00) 00000-0000"
                                        value={formData.contactPhone || ''}
                                        onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                                    />
                                </FormField>
                            </div>
                        </div>
                    </div>

                    {/* Endereço */}
                    <div className="col-span-full">
                        <div className="card p-6">
                            <div className="flex-gap" style={{ gap: 'var(--space-2)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
                                <MapPin size={16} />
                                <span className="form-label mb-0">Endereço da Sede</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-3)' }}>
                                <FormField label="Endereço Completo">
                                    <Input
                                        placeholder="Rua X, nº 123, Bairro Y"
                                        value={formData.address || ''}
                                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                    />
                                </FormField>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 'var(--space-3)' }}>
                                    <FormField label="Cidade">
                                        <Input
                                            placeholder="Fortaleza"
                                            value={formData.city || ''}
                                            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                                        />
                                    </FormField>
                                    <FormField label="UF">
                                        <Input
                                            placeholder="CE"
                                            maxLength={2}
                                            value={formData.state || ''}
                                            onChange={(e) => setFormData({ ...formData, state: e.target.value.toUpperCase() })}
                                        />
                                    </FormField>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── Dados Bancários para Proposta ── */}
                    <div className="col-span-full">
                        <div className="card p-6" style={{ border: '1px solid rgba(20, 184, 166, 0.2)', background: 'rgba(20, 184, 166, 0.02)' }}>
                            <div className="flex-gap" style={{ gap: 'var(--space-2)', color: '#14B8A6', marginBottom: 'var(--space-4)' }}>
                                <Landmark size={16} />
                                <span className="form-label mb-0" style={{ color: '#14B8A6' }}>Dados Bancários para Proposta</span>
                                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', fontWeight: 400, marginLeft: 4 }}>(opcional — aparecerá na carta proposta)</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)' }}>
                                <FormField label="Banco">
                                    <Input
                                        placeholder="Ex: Banco do Brasil"
                                        value={sigConfig.bankData?.bank || ''}
                                        onChange={(e) => setSigConfig({ ...sigConfig, bankData: { ...sigConfig.bankData!, bank: e.target.value } })}
                                    />
                                </FormField>
                                <FormField label="Agência">
                                    <Input
                                        placeholder="Ex: 1234-5"
                                        value={sigConfig.bankData?.agency || ''}
                                        onChange={(e) => setSigConfig({ ...sigConfig, bankData: { ...sigConfig.bankData!, agency: e.target.value } })}
                                    />
                                </FormField>
                                <FormField label="Conta">
                                    <Input
                                        placeholder="Ex: 12345-6"
                                        value={sigConfig.bankData?.account || ''}
                                        onChange={(e) => setSigConfig({ ...sigConfig, bankData: { ...sigConfig.bankData!, account: e.target.value } })}
                                    />
                                </FormField>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
                                <FormField label="Tipo de Conta">
                                    <select
                                        className="form-select"
                                        value={sigConfig.bankData?.accountType || 'Conta Corrente'}
                                        onChange={(e) => setSigConfig({ ...sigConfig, bankData: { ...sigConfig.bankData!, accountType: e.target.value } })}
                                        style={{ background: 'var(--color-bg-base)' }}
                                    >
                                        <option value="Conta Corrente">Conta Corrente</option>
                                        <option value="Conta Poupança">Conta Poupança</option>
                                    </select>
                                </FormField>
                                <FormField label="Chave PIX">
                                    <Input
                                        placeholder="CNPJ, e-mail, telefone ou chave aleatória"
                                        value={sigConfig.bankData?.pix || ''}
                                        onChange={(e) => setSigConfig({ ...sigConfig, bankData: { ...sigConfig.bankData!, pix: e.target.value } })}
                                    />
                                </FormField>
                            </div>
                        </div>
                    </div>

                </div>
            </form>
        </Modal>
    );
}
