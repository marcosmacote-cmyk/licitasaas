import React, { useState, useEffect } from 'react';
import { Building2, Tag, Mail, Phone, Save, Info, MapPin, Landmark, BrainCircuit, User, Wrench, CreditCard } from 'lucide-react';
import type { CompanyProfile } from '../types';
import { Modal, FormField, Input, Textarea, Button } from './ui';

interface Props {
    initialData?: CompanyProfile | null;
    onClose: () => void;
    onSave: (company: Partial<CompanyProfile>) => void;
}

type TabId = 'empresa' | 'admin' | 'tech' | 'banco' | 'ia';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'empresa', label: 'Dados da Empresa', icon: <Building2 size={15} /> },
    { id: 'admin', label: 'Administradores', icon: <User size={15} /> },
    { id: 'tech', label: 'Resp. Técnicos', icon: <Wrench size={15} /> },
    { id: 'banco', label: 'Dados Bancários', icon: <CreditCard size={15} /> },
    { id: 'ia', label: 'IA & Estratégia', icon: <BrainCircuit size={15} /> },
];

export function CompanyFormModal({ initialData, onClose, onSave }: Props) {
    const [activeTab, setActiveTab] = useState<TabId>('empresa');
    const [formData, setFormData] = useState<Partial<CompanyProfile>>({
        razaoSocial: '', cnpj: '', isHeadquarters: false,
    });

    // Campos de IA
    const [strengthsText, setStrengthsText] = useState('');
    const [weaknessesText, setWeaknessesText] = useState('');

    useEffect(() => {
        if (initialData) {
            // Migração automática: se tem defaultSignatureConfig mas não tem bankName, popular campos novos
            const migrated = { ...initialData };
            if (initialData.defaultSignatureConfig && !initialData.bankName) {
                try {
                    const sig = JSON.parse(initialData.defaultSignatureConfig);
                    if (sig.bankData) {
                        migrated.bankName = sig.bankData.bank || '';
                        migrated.bankAgency = sig.bankData.agency || '';
                        migrated.bankAccount = sig.bankData.account || '';
                        migrated.bankAccountType = sig.bankData.accountType || 'Conta Corrente';
                        migrated.bankPix = sig.bankData.pix || '';
                    }
                } catch { /* ignore */ }
            }
            setFormData(migrated);
            if (initialData.strengths) setStrengthsText(initialData.strengths.join(', '));
            if (initialData.knownWeaknesses) setWeaknessesText(initialData.knownWeaknesses.join(', '));
        }
    }, [initialData]);

    const set = (field: keyof CompanyProfile, value: any) => setFormData(prev => ({ ...prev, [field]: value }));

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const strengths = strengthsText.split(',').map(s => s.trim()).filter(Boolean);
        const knownWeaknesses = weaknessesText.split(',').map(s => s.trim()).filter(Boolean);

        // Manter legado: gerar defaultSignatureConfig a partir dos campos novos
        const sigConfig = {
            bankData: {
                bank: formData.bankName || '',
                agency: formData.bankAgency || '',
                account: formData.bankAccount || '',
                accountType: formData.bankAccountType || 'Conta Corrente',
                pix: formData.bankPix || '',
            },
            signatureMode: 'LEGAL',
            validityDays: 60,
        };
        const defaultSignatureConfig = JSON.stringify(sigConfig);

        onSave({
            razaoSocial: formData.razaoSocial,
            cnpj: formData.cnpj,
            isHeadquarters: formData.isHeadquarters,
            nomeFantasia: formData.nomeFantasia,
            inscricaoEstadual: formData.inscricaoEstadual,
            inscricaoMunicipal: formData.inscricaoMunicipal,
            address: formData.address,
            bairro: formData.bairro,
            city: formData.city,
            state: formData.state,
            cep: formData.cep,
            contactName: formData.contactName,
            contactCpf: formData.contactCpf,
            contactRg: formData.contactRg,
            contactRgOrgao: formData.contactRgOrgao,
            contactCargo: formData.contactCargo,
            contactNacionalidade: formData.contactNacionalidade,
            contactEstadoCivil: formData.contactEstadoCivil,
            contactEmail: formData.contactEmail,
            contactPhone: formData.contactPhone,
            techName: formData.techName,
            techCpf: formData.techCpf,
            techRegistration: formData.techRegistration,
            techTitle: formData.techTitle,
            techNacionalidade: formData.techNacionalidade,
            techEstadoCivil: formData.techEstadoCivil,
            bankName: formData.bankName,
            bankAgency: formData.bankAgency,
            bankAccount: formData.bankAccount,
            bankAccountType: formData.bankAccountType,
            bankPix: formData.bankPix,
            qualification: formData.qualification,
            technicalQualification: formData.technicalQualification,
            defaultSignatureConfig,
            strengths,
            knownWeaknesses,
        });
    };

    const footer = (
        <>
            <Button type="button" variant="outline" onClick={onClose} size="lg">Cancelar</Button>
            <Button type="submit" form="company-form" variant="primary" size="lg" icon={<Save size={18} />}
                style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))', boxShadow: 'var(--shadow-md)' }}>
                Salvar Empresa
            </Button>
        </>
    );

    // ── Estado civil options ──
    const estadoCivilOpts = ['solteiro(a)', 'casado(a)', 'divorciado(a)', 'viúvo(a)', 'união estável'];

    return (
        <Modal open={true} onClose={onClose}
            title={initialData ? 'Editar Empresa' : 'Cadastrar Empresa'}
            subtitle="Configure os dados cadastrais da proponente."
            maxWidth="700px" footer={footer}>

            {/* ══ TAB BAR ══ */}
            <div style={{
                display: 'flex', gap: 2, marginBottom: 'var(--space-5)',
                borderBottom: '2px solid var(--color-border)', paddingBottom: 0,
            }}>
                {TABS.map(tab => (
                    <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '8px 14px', fontSize: '0.78rem', fontWeight: 600,
                            border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                            borderBottom: activeTab === tab.id ? '2px solid var(--color-primary)' : '2px solid transparent',
                            marginBottom: '-2px',
                            color: activeTab === tab.id ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                            background: activeTab === tab.id ? 'var(--color-primary-light)' : 'transparent',
                            borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
                        }}>
                        {tab.icon} {tab.label}
                    </button>
                ))}
            </div>

            <form id="company-form" onSubmit={handleSubmit}>

                {/* ══════════════════════════════════════ */}
                {/* TAB 1: DADOS DA EMPRESA               */}
                {/* ══════════════════════════════════════ */}
                {activeTab === 'empresa' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                        <FormField label="Razão Social" required>
                            <Input icon={<Building2 size={16} color="var(--color-text-secondary)" />} required
                                placeholder="Ex: Tech Solutions LTDA"
                                value={formData.razaoSocial || ''} onChange={e => set('razaoSocial', e.target.value)} />
                        </FormField>
                        <FormField label="CNPJ" required>
                            <Input icon={<Tag size={16} color="var(--color-text-secondary)" />} required
                                placeholder="00.000.000/0000-00"
                                value={formData.cnpj || ''} onChange={e => set('cnpj', e.target.value)} />
                        </FormField>
                        <FormField label="Nome Fantasia">
                            <Input placeholder="Nome comercial (opcional)"
                                value={formData.nomeFantasia || ''} onChange={e => set('nomeFantasia', e.target.value)} />
                        </FormField>
                        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 14 }}>
                            <label style={{
                                display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                                padding: '10px 16px', borderRadius: 'var(--radius-md)',
                                backgroundColor: formData.isHeadquarters ? 'var(--color-primary-light)' : 'transparent',
                                border: formData.isHeadquarters ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                            }}>
                                <input type="checkbox" checked={formData.isHeadquarters || false}
                                    onChange={e => set('isHeadquarters', e.target.checked)}
                                    style={{ width: 18, height: 18, accentColor: 'var(--color-primary)' }} />
                                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: formData.isHeadquarters ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                                    Empresa Matriz (Sede)
                                </span>
                            </label>
                        </div>
                        <FormField label="Inscrição Estadual">
                            <Input placeholder="Ex: 06.123.456-7"
                                value={formData.inscricaoEstadual || ''} onChange={e => set('inscricaoEstadual', e.target.value)} />
                        </FormField>
                        <FormField label="Inscrição Municipal">
                            <Input placeholder="Ex: 123456"
                                value={formData.inscricaoMunicipal || ''} onChange={e => set('inscricaoMunicipal', e.target.value)} />
                        </FormField>

                        {/* Endereço */}
                        <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)', marginTop: 'var(--space-1)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)', fontSize: '0.78rem', fontWeight: 700 }}>
                                <MapPin size={14} /> Endereço da Sede
                            </div>
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <FormField label="Logradouro (Rua, Nº)">
                                <Input placeholder="Rua X, nº 123"
                                    value={formData.address || ''} onChange={e => set('address', e.target.value)} />
                            </FormField>
                        </div>
                        <FormField label="Bairro">
                            <Input placeholder="Centro"
                                value={formData.bairro || ''} onChange={e => set('bairro', e.target.value)} />
                        </FormField>
                        <FormField label="CEP">
                            <Input placeholder="60000-000"
                                value={formData.cep || ''} onChange={e => set('cep', e.target.value)} />
                        </FormField>
                        <FormField label="Cidade">
                            <Input placeholder="Fortaleza"
                                value={formData.city || ''} onChange={e => set('city', e.target.value)} />
                        </FormField>
                        <FormField label="UF">
                            <Input placeholder="CE" maxLength={2}
                                value={formData.state || ''} onChange={e => set('state', e.target.value.toUpperCase())} />
                        </FormField>

                        {/* Contato da empresa */}
                        <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)', marginTop: 'var(--space-1)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)', fontSize: '0.78rem', fontWeight: 700 }}>
                                <Phone size={14} /> Contato da Empresa
                            </div>
                        </div>
                        <FormField label="Telefone">
                            <Input icon={<Phone size={14} color="var(--color-text-tertiary)" />}
                                placeholder="(85) 99999-9999"
                                value={formData.contactPhone || ''} onChange={e => set('contactPhone', e.target.value)} />
                        </FormField>
                        <FormField label="E-mail">
                            <Input icon={<Mail size={14} color="var(--color-text-tertiary)" />}
                                placeholder="contato@empresa.com"
                                value={formData.contactEmail || ''} onChange={e => set('contactEmail', e.target.value)} />
                        </FormField>
                    </div>
                )}

                {/* ══════════════════════════════════════ */}
                {/* TAB 2: ADMINISTRADORES                */}
                {/* ══════════════════════════════════════ */}
                {activeTab === 'admin' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                        <div style={{ gridColumn: '1 / -1', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'rgba(59, 130, 246, 0.04)', border: '1px solid rgba(59, 130, 246, 0.12)', marginBottom: 'var(--space-2)' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>
                                💡 Estes dados serão usados na <strong>qualificação</strong> e <strong>assinatura</strong> da Carta Proposta, Declarações e Petições.
                            </div>
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <FormField label="Nome Completo do Representante Legal" required>
                                <Input icon={<User size={16} color="var(--color-text-secondary)" />}
                                    placeholder="João da Silva"
                                    value={formData.contactName || ''} onChange={e => set('contactName', e.target.value)} />
                            </FormField>
                        </div>
                        <FormField label="CPF" required>
                            <Input placeholder="000.000.000-00"
                                value={formData.contactCpf || ''} onChange={e => set('contactCpf', e.target.value)} />
                        </FormField>
                        <FormField label="Cargo">
                            <Input placeholder="Sócio-Administrador"
                                value={formData.contactCargo || ''} onChange={e => set('contactCargo', e.target.value)} />
                        </FormField>
                        <FormField label="RG">
                            <Input placeholder="1234567"
                                value={formData.contactRg || ''} onChange={e => set('contactRg', e.target.value)} />
                        </FormField>
                        <FormField label="Órgão Emissor">
                            <Input placeholder="SSP/CE"
                                value={formData.contactRgOrgao || ''} onChange={e => set('contactRgOrgao', e.target.value)} />
                        </FormField>
                        <FormField label="Nacionalidade">
                            <Input placeholder="brasileiro(a)"
                                value={formData.contactNacionalidade || ''} onChange={e => set('contactNacionalidade', e.target.value)} />
                        </FormField>
                        <FormField label="Estado Civil">
                            <select className="form-select" style={{ background: 'var(--color-bg-base)', width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: 'var(--text-sm)' }}
                                value={formData.contactEstadoCivil || ''}
                                onChange={e => set('contactEstadoCivil', e.target.value)}>
                                <option value="">Selecione...</option>
                                {estadoCivilOpts.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                        </FormField>

                        {/* Qualificação legada (fallback) */}
                        <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
                            <FormField label="Qualificação Completa (texto livre — legado)" hint="Se preferir, cole o texto completo da qualificação aqui. Os campos acima têm prioridade.">
                                <Textarea icon={<Info size={16} color="var(--color-text-tertiary)" />}
                                    placeholder="Ex: Empresa sediada em [Endereço], representada por [Nome], [Cargo]..."
                                    minHeight="70px"
                                    value={formData.qualification || ''} onChange={e => set('qualification', e.target.value)} />
                            </FormField>
                        </div>
                    </div>
                )}

                {/* ══════════════════════════════════════ */}
                {/* TAB 3: RESPONSÁVEIS TÉCNICOS          */}
                {/* ══════════════════════════════════════ */}
                {activeTab === 'tech' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                        <div style={{ gridColumn: '1 / -1', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'rgba(245, 158, 11, 0.04)', border: '1px solid rgba(245, 158, 11, 0.12)', marginBottom: 'var(--space-2)' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>
                                🔧 Dados do responsável técnico para assinatura de propostas de engenharia, declarações técnicas e Oráculo de Atestados.
                            </div>
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <FormField label="Nome do Responsável Técnico">
                                <Input icon={<Wrench size={16} color="var(--color-text-secondary)" />}
                                    placeholder="Maria da Silva"
                                    value={formData.techName || ''} onChange={e => set('techName', e.target.value)} />
                            </FormField>
                        </div>
                        <FormField label="CPF do RT">
                            <Input placeholder="000.000.000-00"
                                value={formData.techCpf || ''} onChange={e => set('techCpf', e.target.value)} />
                        </FormField>
                        <FormField label="Registro CREA/CAU">
                            <Input placeholder="CREA-CE 12345 ou CAU A12345-6"
                                value={formData.techRegistration || ''} onChange={e => set('techRegistration', e.target.value)} />
                        </FormField>
                        <FormField label="Título Profissional">
                            <Input placeholder="Engenheiro(a) Civil"
                                value={formData.techTitle || ''} onChange={e => set('techTitle', e.target.value)} />
                        </FormField>
                        <FormField label="Nacionalidade">
                            <Input placeholder="brasileiro(a)"
                                value={formData.techNacionalidade || ''} onChange={e => set('techNacionalidade', e.target.value)} />
                        </FormField>
                        <FormField label="Estado Civil">
                            <select className="form-select" style={{ background: 'var(--color-bg-base)', width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: 'var(--text-sm)' }}
                                value={formData.techEstadoCivil || ''}
                                onChange={e => set('techEstadoCivil', e.target.value)}>
                                <option value="">Selecione...</option>
                                {estadoCivilOpts.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                        </FormField>

                        {/* Qualificação técnica legada */}
                        <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
                            <FormField label="Qualificação Técnica (texto livre — legado)" hint="Se preferir, cole o texto completo. Os campos acima têm prioridade.">
                                <Textarea icon={<Info size={16} color="var(--color-text-tertiary)" />}
                                    placeholder="Ex: [Nome], [profissão], inscrito no CREA/CAU sob nº [Nº], CPF nº [CPF]..."
                                    minHeight="60px"
                                    value={formData.technicalQualification || ''} onChange={e => set('technicalQualification', e.target.value)} />
                            </FormField>
                        </div>
                    </div>
                )}

                {/* ══════════════════════════════════════ */}
                {/* TAB 4: DADOS BANCÁRIOS                */}
                {/* ══════════════════════════════════════ */}
                {activeTab === 'banco' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)' }}>
                        <div style={{ gridColumn: '1 / -1', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'rgba(20, 184, 166, 0.04)', border: '1px solid rgba(20, 184, 166, 0.12)', marginBottom: 'var(--space-2)' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>
                                🏦 Dados bancários que aparecerão na Carta Proposta. Todos opcionais.
                            </div>
                        </div>
                        <FormField label="Banco">
                            <Input icon={<Landmark size={14} color="var(--color-text-tertiary)" />}
                                placeholder="Ex: Banco do Brasil"
                                value={formData.bankName || ''} onChange={e => set('bankName', e.target.value)} />
                        </FormField>
                        <FormField label="Agência">
                            <Input placeholder="Ex: 1234-5"
                                value={formData.bankAgency || ''} onChange={e => set('bankAgency', e.target.value)} />
                        </FormField>
                        <FormField label="Conta">
                            <Input placeholder="Ex: 12345-6"
                                value={formData.bankAccount || ''} onChange={e => set('bankAccount', e.target.value)} />
                        </FormField>
                        <FormField label="Tipo de Conta">
                            <select className="form-select"
                                style={{ background: 'var(--color-bg-base)', width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: 'var(--text-sm)' }}
                                value={formData.bankAccountType || 'Conta Corrente'}
                                onChange={e => set('bankAccountType', e.target.value)}>
                                <option value="Conta Corrente">Conta Corrente</option>
                                <option value="Conta Poupança">Conta Poupança</option>
                            </select>
                        </FormField>
                        <div style={{ gridColumn: 'span 2' }}>
                            <FormField label="Chave PIX">
                                <Input placeholder="CNPJ, e-mail, telefone ou chave aleatória"
                                    value={formData.bankPix || ''} onChange={e => set('bankPix', e.target.value)} />
                            </FormField>
                        </div>
                    </div>
                )}

                {/* ══════════════════════════════════════ */}
                {/* TAB 5: IA & ESTRATÉGIA                */}
                {/* ══════════════════════════════════════ */}
                {activeTab === 'ia' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                        <div style={{ gridColumn: '1 / -1', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'linear-gradient(to right, rgba(139, 92, 246, 0.04), rgba(168, 85, 247, 0.02))', border: '1px solid rgba(139, 92, 246, 0.12)', marginBottom: 'var(--space-2)' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>
                                🧠 Diferenciais e fragilidades que alimentam o motor estratégico de participação da IA.
                            </div>
                        </div>
                        <FormField label="Diferenciais & Pontos Fortes" hint="Separe por vírgulas. Ex: Frota própria, Acervo robusto em hospitais" fullWidth>
                            <Textarea placeholder="Lista de diferenciais competitivos..." minHeight="100px"
                                value={strengthsText} onChange={e => setStrengthsText(e.target.value)}
                                style={{ borderColor: 'rgba(139, 92, 246, 0.15)' }} />
                        </FormField>
                        <FormField label="Fragilidades & Restrições" hint="Separe por vírgulas. Ex: Falta de balanço, Restrição para frete no Norte" fullWidth>
                            <Textarea placeholder="Lista de gargalos ou restrições de participação..." minHeight="100px"
                                value={weaknessesText} onChange={e => setWeaknessesText(e.target.value)}
                                style={{ borderColor: 'rgba(139, 92, 246, 0.15)' }} />
                        </FormField>
                    </div>
                )}

            </form>
        </Modal>
    );
}
