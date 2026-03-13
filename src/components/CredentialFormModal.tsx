import React, { useState, useEffect } from 'react';
import { X, Save, Globe, User, Lock, FileText, Info } from 'lucide-react';
import type { CompanyCredential } from '../types';

interface Props {
    companyId: string;
    initialData: Partial<CompanyCredential> | null;
    onClose: () => void;
    onSave: (data: Partial<CompanyCredential>) => void;
}

export function CredentialFormModal({ companyId, initialData, onClose, onSave }: Props) {
    const [formData, setFormData] = useState<Partial<CompanyCredential>>({
        companyProfileId: companyId,
        platform: '',
        url: '',
        login: '',
        password: '',
        notes: ''
    });

    useEffect(() => {
        if (initialData) {
            setFormData({ ...formData, ...initialData });
        }
    }, [initialData]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData);
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
                maxWidth: '550px',
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
                            {initialData ? 'Editar Acesso' : 'Nova Credencial'}
                        </h2>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-md)', marginTop: '4px' }}>
                            Gerencie as chaves de acesso para portais de licitação.
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
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)' }}>

                        {/* Plataforma */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>Plataforma / Sistema *</label>
                            <div style={inputContainerStyle}>
                                <Globe size={18} color="var(--color-text-secondary)" />
                                <input
                                    type="text"
                                    style={inputInnerStyle}
                                    required
                                    placeholder="Ex: ComprasNet, Gmail, Siofi..."
                                    value={formData.platform || ''}
                                    onChange={e => setFormData({ ...formData, platform: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* URL de Acesso */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>URL de Acesso</label>
                            <div style={inputContainerStyle}>
                                < Globe size={18} color="var(--color-text-secondary)" />
                                <input
                                    type="url"
                                    style={inputInnerStyle}
                                    placeholder="https://..."
                                    value={formData.url || ''}
                                    onChange={e => setFormData({ ...formData, url: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* Login */}
                        <div>
                            <label style={labelStyle}>Login / Usuário *</label>
                            <div style={inputContainerStyle}>
                                <User size={18} color="var(--color-text-secondary)" />
                                <input
                                    type="text"
                                    style={inputInnerStyle}
                                    required
                                    value={formData.login || ''}
                                    onChange={e => setFormData({ ...formData, login: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* Senha */}
                        <div>
                            <label style={labelStyle}>Senha *</label>
                            <div style={inputContainerStyle}>
                                <Lock size={18} color="var(--color-text-secondary)" />
                                <input
                                    type="text"
                                    style={inputInnerStyle}
                                    required
                                    placeholder="Sua senha"
                                    value={formData.password || ''}
                                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* Observações */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={labelStyle}>Observações Adicionais</label>
                            <div style={{ ...inputContainerStyle, alignItems: 'flex-start' }}>
                                <FileText size={18} color="var(--color-text-secondary)" style={{ marginTop: '2px' }} />
                                <textarea
                                    style={{ ...inputInnerStyle, height: '80px', resize: 'none' }}
                                    placeholder="Ex: Token físico necessário, acessar apenas de SP..."
                                    value={formData.notes || ''}
                                    onChange={e => setFormData({ ...formData, notes: e.target.value })}
                                />
                            </div>
                        </div>

                        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-base)' }}>
                            <Info size={14} />
                            <span>A senha será exibida em texto plano para facilitar a cópia rápida.</span>
                        </div>
                    </div>

                    <div style={{
                        marginTop: 'var(--space-8)',
                        display: 'flex',
                        gap: 'var(--space-3)',
                        justifyContent: 'flex-end',
                        paddingTop: 'var(--space-6)',
                        borderTop: '1px solid var(--color-border)'
                    }}>
                        <button type="button" className="btn btn-outline" onClick={onClose} style={{ padding: 'var(--space-3) var(--space-5)' }}>
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            style={{
                                padding: 'var(--space-3) var(--space-6)',
                                background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))',
                                boxShadow: 'var(--shadow-md)'
                            }}
                        >
                            <Save size={18} /> Salvar Credencial
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
