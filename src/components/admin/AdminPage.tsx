import React, { useState, useEffect } from 'react';
import { Building2, Plus, Users, Briefcase, Loader2, CheckCircle2, Copy, ExternalLink, X, ShieldAlert, Shield, AlertCircle } from 'lucide-react';
import { API_BASE_URL } from '../../config';
import { useToast } from '../ui';
import { AiQuotaManager } from './AiQuotaManager';
import { AuditLogViewer } from './AuditLogViewer';

interface TenantInfo {
    id: string;
    razaoSocial: string;
    rootCnpj: string;
    createdAt: string;
    stats: {
        users: number;
        companies: number;
        biddings: number;
    };
}

interface OnboardResult {
    message: string;
    tenant: { id: string; razaoSocial: string; rootCnpj: string };
    admin: { id: string; name: string; email: string; role: string };
    loginUrl: string;
    instructions: string;
}

export function AdminPage() {
    const toast = useToast();
    const [tenants, setTenants] = useState<TenantInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isResultOpen, setIsResultOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [onboardResult, setOnboardResult] = useState<OnboardResult | null>(null);

    // Form states
    const [razaoSocial, setRazaoSocial] = useState('');
    const [rootCnpj, setRootCnpj] = useState('');
    const [adminName, setAdminName] = useState('');
    const [adminEmail, setAdminEmail] = useState('');
    const [adminPassword, setAdminPassword] = useState('');

    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

    const fetchTenants = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/admin/tenants`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setTenants(data);
            } else {
                toast.error('Sem permissão para acessar administração.');
            }
        } catch (error) {
            console.error(error);
            toast.error('Falha ao carregar organizações.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTenants();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const formatCnpj = (cnpj: string) => {
        const clean = cnpj.replace(/\D/g, '');
        if (clean.length === 14) {
            return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
        }
        return cnpj;
    };

    const handleCnpjInput = (value: string) => {
        // Keep only digits
        const clean = value.replace(/\D/g, '').slice(0, 14);
        setRootCnpj(clean);
    };

    const generatePassword = () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let pwd = '';
        for (let i = 0; i < 10; i++) pwd += chars.charAt(Math.floor(Math.random() * chars.length));
        setAdminPassword(pwd);
    };

    const openCreateModal = () => {
        setRazaoSocial('');
        setRootCnpj('');
        setAdminName('');
        setAdminEmail('');
        setAdminPassword('');
        setIsModalOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);

        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/admin/onboard`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ razaoSocial, rootCnpj, adminName, adminEmail, adminPassword })
            });

            const data = await res.json();

            if (res.ok) {
                toast.success(data.message || 'Cliente provisionado com sucesso!');
                setIsModalOpen(false);
                setOnboardResult(data);
                setIsResultOpen(true);
                fetchTenants();
            } else {
                toast.error(data.error || 'Erro ao provisionar cliente.');
            }
        } catch {
            toast.error('Falha de conexão ao servidor.');
        } finally {
            setSubmitting(false);
        }
    };

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text).then(() => {
            toast.success(`${label} copiado!`);
        });
    };

    // Access control
    if (currentUser.role !== 'SUPER_ADMIN') {
        return (
            <div className="flex-center" style={{ height: '70vh', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <ShieldAlert size={48} color="var(--color-danger)" />
                <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 600 }}>Acesso Restrito</h2>
                <p style={{ color: 'var(--color-text-secondary)', maxWidth: 400, textAlign: 'center' }}>
                    Esta página é reservada para administradores do sistema.
                </p>
            </div>
        );
    }

    return (
        <div className="page-wrapper page-animate-fade">
            <div className="content-container">
                <main className="main-box" style={{ padding: '0' }}>

                    {/* Header */}
                    <div style={{ padding: 'var(--space-6)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)' }}>
                                Administração
                            </h2>
                            <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', marginTop: 4 }}>
                                Gerencie organizações e provisione novos clientes.
                            </p>
                        </div>
                        <button className="btn btn-primary" onClick={openCreateModal}>
                            <Plus size={16} /> Novo Cliente
                        </button>
                    </div>

                    {/* Stats Summary */}
                    {!loading && tenants.length > 0 && (
                        <div style={{ padding: 'var(--space-4) var(--space-6)', background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: 'var(--space-6)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                <Building2 size={14} color="var(--color-primary)" />
                                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                                    <strong style={{ color: 'var(--color-text-primary)' }}>{tenants.length}</strong> organizações
                                </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                <Users size={14} color="#8b5cf6" />
                                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                                    <strong style={{ color: 'var(--color-text-primary)' }}>{tenants.reduce((sum, t) => sum + t.stats.users, 0)}</strong> usuários
                                </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                <Briefcase size={14} color="#f59e0b" />
                                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                                    <strong style={{ color: 'var(--color-text-primary)' }}>{tenants.reduce((sum, t) => sum + t.stats.biddings, 0)}</strong> licitações
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Tenants Table */}
                    {loading ? (
                        <div style={{ padding: 'var(--space-10)', textAlign: 'center' }}><Loader2 className="spinner" size={24} /></div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)' }}>
                                        <th style={{ padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Organização</th>
                                        <th style={{ padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', color: 'var(--color-text-secondary)', fontWeight: 600 }}>CNPJ</th>
                                        <th style={{ padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'center' }}>Usuários</th>
                                        <th style={{ padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'center' }}>Empresas</th>
                                        <th style={{ padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'center' }}>Licitações</th>
                                        <th style={{ padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Criado em</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tenants.map((tenant) => (
                                        <tr key={tenant.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: 'var(--space-4) var(--space-6)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                                    <div style={{
                                                        width: 36, height: 36, borderRadius: 'var(--radius-md)',
                                                        background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        color: 'white', fontWeight: 700, fontSize: 'var(--text-xs)',
                                                        flexShrink: 0,
                                                    }}>
                                                        {tenant.razaoSocial.substring(0, 2).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: 'var(--text-sm)' }}>
                                                            {tenant.razaoSocial}
                                                        </div>
                                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                                                            {tenant.id.slice(0, 8)}...
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={{ padding: 'var(--space-4) var(--space-6)', fontFamily: 'monospace', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                                                {formatCnpj(tenant.rootCnpj)}
                                            </td>
                                            <td style={{ padding: 'var(--space-4) var(--space-6)', textAlign: 'center' }}>
                                                <span style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                                    padding: '2px 10px', borderRadius: 12,
                                                    background: tenant.stats.users > 0 ? 'rgba(59, 130, 246, 0.1)' : 'var(--color-bg-base)',
                                                    color: tenant.stats.users > 0 ? '#2563eb' : 'var(--color-text-tertiary)',
                                                    fontSize: 'var(--text-sm)', fontWeight: 600
                                                }}>
                                                    <Users size={12} /> {tenant.stats.users}
                                                </span>
                                            </td>
                                            <td style={{ padding: 'var(--space-4) var(--space-6)', textAlign: 'center' }}>
                                                <span style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                                    padding: '2px 10px', borderRadius: 12,
                                                    background: tenant.stats.companies > 0 ? 'rgba(16, 185, 129, 0.1)' : 'var(--color-bg-base)',
                                                    color: tenant.stats.companies > 0 ? '#059669' : 'var(--color-text-tertiary)',
                                                    fontSize: 'var(--text-sm)', fontWeight: 600
                                                }}>
                                                    <Building2 size={12} /> {tenant.stats.companies}
                                                </span>
                                            </td>
                                            <td style={{ padding: 'var(--space-4) var(--space-6)', textAlign: 'center' }}>
                                                <span style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                                    padding: '2px 10px', borderRadius: 12,
                                                    background: tenant.stats.biddings > 0 ? 'rgba(245, 158, 11, 0.1)' : 'var(--color-bg-base)',
                                                    color: tenant.stats.biddings > 0 ? '#d97706' : 'var(--color-text-tertiary)',
                                                    fontSize: 'var(--text-sm)', fontWeight: 600
                                                }}>
                                                    <Briefcase size={12} /> {tenant.stats.biddings}
                                                </span>
                                            </td>
                                            <td style={{ padding: 'var(--space-4) var(--space-6)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                                                {new Date(tenant.createdAt).toLocaleDateString('pt-BR')}
                                            </td>
                                        </tr>
                                    ))}
                                    {tenants.length === 0 && (
                                        <tr><td colSpan={6} style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                                            Nenhuma organização encontrada.
                                        </td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* ═══ AI Quota Management ═══ */}
                    <div style={{ marginTop: 'var(--space-6)', borderRadius: 'var(--radius-xl)', background: 'var(--color-bg-surface)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                        <AiQuotaManager />
                    </div>

                    {/* ═══ Audit Log Viewer ═══ */}
                    <div style={{ marginTop: 'var(--space-6)', padding: 'var(--space-6)', borderRadius: 'var(--radius-xl)', background: 'var(--color-bg-surface)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                        <AuditLogViewer />
                    </div>
                </main>
            </div>

            {/* Modal: Novo Cliente */}
            {isModalOpen && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', animation: 'fadeIn 0.2s ease-out' }}>
                    <div style={{
                        background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-xl)',
                        width: '100%', maxWidth: 500, boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                        overflow: 'hidden', display: 'flex', flexDirection: 'column'
                    }} className="animate-slide-up">
                        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-bg-base)' }}>
                            <div>
                                <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)' }}>Provisionar Novo Cliente</h3>
                                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: 2 }}>Cria a organização e o primeiro administrador</p>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: 4, display: 'flex' }}><X size={18} /></button>
                        </div>
                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column' }}>
                            <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

                                {/* Seção: Empresa */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', paddingBottom: 'var(--space-2)', borderBottom: '1px solid var(--color-border)' }}>
                                    <Building2 size={14} color="var(--color-primary)" />
                                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-primary)', letterSpacing: '0.05em' }}>Dados da Empresa</span>
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Razão Social *</label>
                                    <input required type="text" value={razaoSocial} onChange={e => setRazaoSocial(e.target.value)} placeholder="Ex: Construtora XYZ LTDA"
                                        style={{ width: '100%', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)', background: 'var(--color-bg-base)', fontSize: 'var(--text-md)', color: 'var(--color-text-primary)', outline: 'none', transition: 'box-shadow 0.2s' }}
                                        onFocus={e => e.target.style.boxShadow = '0 0 0 2px var(--color-primary)'}
                                        onBlur={e => e.target.style.boxShadow = '0 0 0 1px var(--color-border)'}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>CNPJ *</label>
                                    <input required type="text" value={formatCnpj(rootCnpj)} onChange={e => handleCnpjInput(e.target.value)} placeholder="00.000.000/0000-00"
                                        style={{ width: '100%', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)', background: 'var(--color-bg-base)', fontSize: 'var(--text-md)', color: 'var(--color-text-primary)', outline: 'none', transition: 'box-shadow 0.2s', fontFamily: 'monospace' }}
                                        onFocus={e => e.target.style.boxShadow = '0 0 0 2px var(--color-primary)'}
                                        onBlur={e => e.target.style.boxShadow = '0 0 0 1px var(--color-border)'}
                                    />
                                </div>

                                {/* Seção: Administrador */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', paddingBottom: 'var(--space-2)', borderBottom: '1px solid var(--color-border)', marginTop: 'var(--space-2)' }}>
                                    <Shield size={14} color="#8b5cf6" />
                                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, textTransform: 'uppercase', color: '#8b5cf6', letterSpacing: '0.05em' }}>Administrador do Cliente</span>
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Nome do Admin *</label>
                                    <input required type="text" value={adminName} onChange={e => setAdminName(e.target.value)} placeholder="Ex: João da Silva"
                                        style={{ width: '100%', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)', background: 'var(--color-bg-base)', fontSize: 'var(--text-md)', color: 'var(--color-text-primary)', outline: 'none', transition: 'box-shadow 0.2s' }}
                                        onFocus={e => e.target.style.boxShadow = '0 0 0 2px var(--color-primary)'}
                                        onBlur={e => e.target.style.boxShadow = '0 0 0 1px var(--color-border)'}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>E-mail do Admin *</label>
                                    <input required type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="joao@empresa.com"
                                        style={{ width: '100%', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)', background: 'var(--color-bg-base)', fontSize: 'var(--text-md)', color: 'var(--color-text-primary)', outline: 'none', transition: 'box-shadow 0.2s' }}
                                        onFocus={e => e.target.style.boxShadow = '0 0 0 2px var(--color-primary)'}
                                        onBlur={e => e.target.style.boxShadow = '0 0 0 1px var(--color-border)'}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Senha Inicial *</label>
                                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                        <input required minLength={6} type="text" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} placeholder="Mínimo 6 caracteres"
                                            style={{ flex: 1, padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)', background: 'var(--color-bg-base)', fontSize: 'var(--text-md)', color: 'var(--color-text-primary)', outline: 'none', transition: 'box-shadow 0.2s', fontFamily: 'monospace' }}
                                            onFocus={e => e.target.style.boxShadow = '0 0 0 2px var(--color-primary)'}
                                            onBlur={e => e.target.style.boxShadow = '0 0 0 1px var(--color-border)'}
                                        />
                                        <button type="button" className="btn btn-outline" onClick={generatePassword} style={{ whiteSpace: 'nowrap', fontSize: 'var(--text-xs)' }}>
                                            Gerar Senha
                                        </button>
                                    </div>
                                </div>

                            </div>
                            <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', background: 'var(--color-bg-surface-hover)' }}>
                                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                                <button type="submit" className="btn btn-primary" disabled={submitting} style={{ padding: 'var(--space-2) var(--space-6)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                    {submitting ? <><Loader2 size={14} className="spinner" /> Provisionando...</> : <><Plus size={14} /> Provisionar Cliente</>}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal: Resultado do Onboarding */}
            {isResultOpen && onboardResult && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', animation: 'fadeIn 0.2s ease-out' }}>
                    <div style={{
                        background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-xl)',
                        width: '100%', maxWidth: 480, boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                        overflow: 'hidden', display: 'flex', flexDirection: 'column'
                    }} className="animate-slide-up">
                        {/* Success Header */}
                        <div style={{ padding: 'var(--space-6)', background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)', color: 'white', textAlign: 'center' }}>
                            <CheckCircle2 size={40} style={{ marginBottom: 'var(--space-3)' }} />
                            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', marginBottom: 4 }}>Cliente Provisionado!</h3>
                            <p style={{ fontSize: 'var(--text-sm)', opacity: 0.9 }}>{onboardResult.tenant.razaoSocial}</p>
                        </div>

                        {/* Credentials */}
                        <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

                            <div style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3) var(--space-4)', display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                                <AlertCircle size={16} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
                                <p style={{ fontSize: 'var(--text-xs)', color: '#92400e', lineHeight: 1.5 }}>
                                    <strong>Atenção:</strong> Envie estas credenciais ao cliente por um canal seguro. Esta é a única vez que a senha será exibida.
                                </p>
                            </div>

                            <div style={{ background: 'var(--color-bg-base)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                {/* URL */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>URL de Acesso</div>
                                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <ExternalLink size={12} />
                                            {onboardResult.loginUrl}
                                        </div>
                                    </div>
                                    <button className="icon-btn" onClick={() => copyToClipboard(onboardResult.loginUrl, 'URL')} title="Copiar URL"><Copy size={14} /></button>
                                </div>

                                <div style={{ height: 1, background: 'var(--color-border)' }} />

                                {/* Email */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>E-mail</div>
                                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)', fontWeight: 500, fontFamily: 'monospace' }}>{onboardResult.admin.email}</div>
                                    </div>
                                    <button className="icon-btn" onClick={() => copyToClipboard(onboardResult.admin.email, 'E-mail')} title="Copiar E-mail"><Copy size={14} /></button>
                                </div>

                                <div style={{ height: 1, background: 'var(--color-border)' }} />

                                {/* Password */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>Senha</div>
                                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)', fontWeight: 500, fontFamily: 'monospace' }}>{adminPassword}</div>
                                    </div>
                                    <button className="icon-btn" onClick={() => copyToClipboard(adminPassword, 'Senha')} title="Copiar Senha"><Copy size={14} /></button>
                                </div>
                            </div>

                            {/* Copy All */}
                            <button
                                className="btn btn-outline"
                                style={{ width: '100%', justifyContent: 'center' }}
                                onClick={() => {
                                    const text = `LicitaSaaS — Dados de Acesso\n\nURL: ${onboardResult.loginUrl}\nE-mail: ${onboardResult.admin.email}\nSenha: ${adminPassword}\n\nAcesse a plataforma e altere sua senha no primeiro acesso.`;
                                    copyToClipboard(text, 'Credenciais completas');
                                }}
                            >
                                <Copy size={14} /> Copiar Tudo para Enviar ao Cliente
                            </button>
                        </div>

                        <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', background: 'var(--color-bg-surface-hover)' }}>
                            <button className="btn btn-primary" onClick={() => setIsResultOpen(false)}>Concluído</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
