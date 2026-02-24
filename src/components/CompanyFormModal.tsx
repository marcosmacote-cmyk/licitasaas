import React, { useState, useEffect } from 'react';
import { X, Building2, Tag, Mail, Phone, Save, Info } from 'lucide-react';
import type { CompanyProfile } from '../types';

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
        // Only send editable fields, strip out id/tenantId/relations
        const { razaoSocial, cnpj, isHeadquarters, qualification, technicalQualification, contactName, contactEmail, contactPhone } = formData;
        onSave({ razaoSocial, cnpj, isHeadquarters, qualification, technicalQualification, contactName, contactEmail, contactPhone });
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
                maxWidth: '600px',
                width: '100%',
                borderRadius: '1.5rem',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                overflow: 'hidden',
                backgroundColor: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                animation: 'slideUp 0.3s ease-out'
            }}>
                <div style={{
                    padding: '28px 36px',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'linear-gradient(to right, var(--color-bg-surface), var(--color-bg-surface-hover))'
                }}>
                    <div>
                        <h2 style={{ fontSize: '1.625rem', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
                            {initialData ? 'Editar Empresa' : 'Cadastrar Empresa'}
                        </h2>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9375rem', marginTop: '4px' }}>
                            Configure os dados cadastrais da proponente.
                        </p>
                    </div>
                    <button
                        className="icon-btn"
                        onClick={onClose}
                        style={{ background: 'var(--color-bg-surface)', borderRadius: '50%', padding: '10px', boxShadow: 'var(--shadow-sm)' }}
                    >
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} style={{ padding: '36px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>

                        {/* Razão Social */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>Razão Social *</label>
                            <div style={inputContainerStyle}>
                                <Building2 size={18} color="var(--color-text-secondary)" />
                                <input
                                    type="text"
                                    style={inputInnerStyle}
                                    required
                                    placeholder="Ex: Tech Solutions LTDA"
                                    value={formData.razaoSocial || ''}
                                    onChange={(e) => setFormData({ ...formData, razaoSocial: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* CNPJ */}
                        <div>
                            <label style={labelStyle}>CNPJ *</label>
                            <div style={inputContainerStyle}>
                                <Tag size={18} color="var(--color-text-secondary)" />
                                <input
                                    type="text"
                                    style={inputInnerStyle}
                                    required
                                    placeholder="00.000.000/0000-00"
                                    value={formData.cnpj || ''}
                                    onChange={(e) => setFormData({ ...formData, cnpj: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* Tipo de Unidade */}
                        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '14px' }}>
                            <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                cursor: 'pointer',
                                padding: '10px 16px',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: formData.isHeadquarters ? 'rgba(37, 99, 235, 0.05)' : 'transparent',
                                border: formData.isHeadquarters ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                transition: 'all 0.2s ease'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={formData.isHeadquarters || false}
                                    onChange={(e) => setFormData({ ...formData, isHeadquarters: e.target.checked })}
                                    style={{ width: '18px', height: '18px', accentColor: 'var(--color-primary)' }}
                                />
                                <span style={{ fontSize: '0.9375rem', fontWeight: 500, color: formData.isHeadquarters ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                                    Empresa Matriz (Sede)
                                </span>
                            </label>
                        </div>

                        {/* Qualificação e Representante */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>Qualificação da Empresa e Representante Legal *</label>
                            <div style={{ ...inputContainerStyle, alignItems: 'flex-start' }}>
                                <Info size={18} color="var(--color-text-secondary)" style={{ marginTop: '4px' }} />
                                <textarea
                                    style={{ ...inputInnerStyle, minHeight: '80px', resize: 'vertical' }}
                                    required
                                    placeholder="Ex: Empresa sediada em [Endereço], representada por [Nome], [Cargo], portador do CPF [CPF]..."
                                    value={formData.qualification || ''}
                                    onChange={(e) => setFormData({ ...formData, qualification: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* Qualificação do Responsável Técnico */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>Qualificação do Responsável Técnico <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400, fontSize: '0.75rem' }}>(opcional)</span></label>
                            <div style={{ ...inputContainerStyle, alignItems: 'flex-start' }}>
                                <Info size={18} color="var(--color-text-secondary)" style={{ marginTop: '4px' }} />
                                <textarea
                                    style={{ ...inputInnerStyle, minHeight: '60px', resize: 'vertical' }}
                                    placeholder="Ex: [Nome], [nacionalidade], [estado civil], [profissão], inscrito no CREA/CAU sob nº [Nº], CPF nº [CPF], residente em [Endereço]..."
                                    value={formData.technicalQualification || ''}
                                    onChange={(e) => setFormData({ ...formData, technicalQualification: e.target.value })}
                                />
                            </div>
                            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '6px', marginBottom: 0 }}>
                                Usado para declarações que exigem anuência do profissional técnico (ex: acervo técnico, responsável técnico).
                            </p>
                        </div>

                        <div style={{ gridColumn: '1 / -1' }}>
                            <div style={{ padding: '24px', backgroundColor: 'var(--color-bg-surface-hover)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
                                    <Phone size={16} />
                                    <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Canais de Contato</span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ ...labelStyle, fontSize: '0.75rem' }}>Nome do Contato</label>
                                        <div style={inputContainerStyle}>
                                            <input
                                                style={inputInnerStyle}
                                                placeholder="Nome"
                                                value={formData.contactName || ''}
                                                onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label style={{ ...labelStyle, fontSize: '0.75rem' }}>E-mail</label>
                                        <div style={inputContainerStyle}>
                                            <Mail size={16} color="var(--color-text-tertiary)" />
                                            <input
                                                style={inputInnerStyle}
                                                placeholder="email@empresa.com"
                                                value={formData.contactEmail || ''}
                                                onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label style={{ ...labelStyle, fontSize: '0.75rem' }}>Telefone</label>
                                        <div style={inputContainerStyle}>
                                            <Phone size={16} color="var(--color-text-tertiary)" />
                                            <input
                                                style={inputInnerStyle}
                                                placeholder="(00) 00000-0000"
                                                value={formData.contactPhone || ''}
                                                onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                                            />
                                        </div>
                                    </div>
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
                                padding: '12px 32px',
                                background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))',
                                boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)',
                                fontWeight: 600
                            }}
                        >
                            <Save size={18} /> Salvar Empresa
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
