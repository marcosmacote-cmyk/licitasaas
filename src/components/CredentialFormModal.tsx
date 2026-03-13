import React, { useState, useEffect } from 'react';
import { Globe, User, Lock, FileText, Save, Info } from 'lucide-react';
import type { CompanyCredential } from '../types';
import { Modal, FormField, Input, Textarea, Button } from './ui';

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
            setFormData(prev => ({ ...prev, ...initialData }));
        }
    }, [initialData]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData);
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
                Salvar Credencial
            </Button>
        </>
    );

    return (
        <Modal
            open={true}
            onClose={onClose}
            title={initialData ? 'Editar Acesso' : 'Nova Credencial'}
            subtitle="Gerencie as chaves de acesso para portais de licitação."
            maxWidth="550px"
            footer={footer}
        >
            <form onSubmit={handleSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)' }}>

                    <FormField label="Plataforma / Sistema" required fullWidth>
                        <Input
                            icon={<Globe size={18} color="var(--color-text-secondary)" />}
                            required
                            placeholder="Ex: ComprasNet, Gmail, Siofi..."
                            value={formData.platform || ''}
                            onChange={e => setFormData({ ...formData, platform: e.target.value })}
                        />
                    </FormField>

                    <FormField label="URL de Acesso" fullWidth>
                        <Input
                            icon={<Globe size={18} color="var(--color-text-secondary)" />}
                            type="url"
                            placeholder="https://..."
                            value={formData.url || ''}
                            onChange={e => setFormData({ ...formData, url: e.target.value })}
                        />
                    </FormField>

                    <FormField label="Login / Usuário" required>
                        <Input
                            icon={<User size={18} color="var(--color-text-secondary)" />}
                            required
                            value={formData.login || ''}
                            onChange={e => setFormData({ ...formData, login: e.target.value })}
                        />
                    </FormField>

                    <FormField label="Senha" required>
                        <Input
                            icon={<Lock size={18} color="var(--color-text-secondary)" />}
                            type="text"
                            required
                            placeholder="Sua senha"
                            value={formData.password || ''}
                            onChange={e => setFormData({ ...formData, password: e.target.value })}
                        />
                    </FormField>

                    <FormField label="Observações Adicionais" fullWidth>
                        <Textarea
                            icon={<FileText size={18} color="var(--color-text-secondary)" />}
                            placeholder="Ex: Token físico necessário, acessar apenas de SP..."
                            minHeight="80px"
                            style={{ resize: 'none' }}
                            value={formData.notes || ''}
                            onChange={e => setFormData({ ...formData, notes: e.target.value })}
                        />
                    </FormField>

                    <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-base)' }}>
                        <Info size={14} />
                        <span>A senha será exibida em texto plano para facilitar a cópia rápida.</span>
                    </div>
                </div>
            </form>
        </Modal>
    );
}
