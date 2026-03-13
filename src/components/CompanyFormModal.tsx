import React, { useState, useEffect } from 'react';
import { Building2, Tag, Mail, Phone, Save, Info, MapPin } from 'lucide-react';
import type { CompanyProfile } from '../types';
import { Modal, FormField, Input, Textarea, Button } from './ui';

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

    useEffect(() => {
        if (initialData) {
            setFormData(initialData);
        }
    }, [initialData]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const { razaoSocial, cnpj, isHeadquarters, qualification, technicalQualification, contactName, contactCpf, contactEmail, contactPhone, address, city, state } = formData;
        onSave({ razaoSocial, cnpj, isHeadquarters, qualification, technicalQualification, contactName, contactCpf, contactEmail, contactPhone, address, city, state });
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
            maxWidth="600px"
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
                    <div style={{ gridColumn: '1 / -1' }}>
                        <div style={{ padding: 'var(--space-6)', backgroundColor: 'var(--color-bg-surface-hover)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
                                <Phone size={16} />
                                <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)' }}>Canais de Contato</span>
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
                    <div style={{ gridColumn: '1 / -1' }}>
                        <div style={{ padding: 'var(--space-6)', backgroundColor: 'var(--color-bg-surface-hover)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
                                <MapPin size={16} />
                                <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)' }}>Endereço da Sede</span>
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

                </div>
            </form>
        </Modal>
    );
}
