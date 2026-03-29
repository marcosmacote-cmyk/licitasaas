import React, { useState, useEffect } from 'react';
import { Users, Plus, Edit2, ShieldAlert, KeyRound, Loader2, CheckCircle2, Shield, UserX, UserCheck } from 'lucide-react';
import { API_BASE_URL } from '../../config';
import { useToast } from '../ui';

interface TeamMember {
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
    opportunityScannerEnabled: boolean;
}

export function TeamPage() {
    const toast = useToast();
    const [team, setTeam] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const [editingMember, setEditingMember] = useState<TeamMember | null>(null);

    // Form states
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('Analista');
    const [isActive, setIsActive] = useState(true);
    const [scanEnabled, setScanEnabled] = useState(true);

    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

    const fetchTeam = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/team`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setTeam(data);
            } else {
                toast.error('Você não tem permissão para visualizar a equipe.');
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTeam();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const openCreateModal = () => {
        setEditingMember(null);
        setName('');
        setEmail('');
        setPassword('');
        setRole('Analista');
        setIsActive(true);
        setScanEnabled(true);
        setIsModalOpen(true);
    };

    const openEditModal = (member: TeamMember) => {
        setEditingMember(member);
        setName(member.name);
        setEmail(member.email);
        setPassword(''); // Not shown in edit
        setRole(member.role);
        setIsActive(member.isActive);
        setScanEnabled(member.opportunityScannerEnabled !== false);
        setIsModalOpen(true);
    };

    const openPasswordModal = (member: TeamMember) => {
        setEditingMember(member);
        setPassword('');
        setIsPasswordModalOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = localStorage.getItem('token');
        
        const payload = editingMember
            ? { name, role, isActive, opportunityScannerEnabled: scanEnabled }
            : { name, email, password, role, isActive, opportunityScannerEnabled: scanEnabled };
            
        const method = editingMember ? 'PUT' : 'POST';
        const url = editingMember ? `${API_BASE_URL}/api/team/${editingMember.id}` : `${API_BASE_URL}/api/team`;

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                toast.success(editingMember ? 'Usuário atualizado.' : 'Membro convidado com sucesso.');
                setIsModalOpen(false);
                fetchTeam();
            } else {
                const data = await res.json();
                toast.error(data.error || 'Falha ao salvar usuário.');
            }
        } catch {
            toast.error('Falha de conexão ao servidor.');
        }
    };

    const handlePasswordReset = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingMember) return;
        const token = localStorage.getItem('token');
        try {
            const res = await fetch(`${API_BASE_URL}/api/team/${editingMember.id}/reset`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ newPassword: password })
            });

            if (res.ok) {
                toast.success(`Senha atualizada para ${editingMember.name}`);
                setIsPasswordModalOpen(false);
            } else {
                const data = await res.json();
                toast.error(data.error);
            }
        } catch {
            toast.error('Falha de conexão ao servidor.');
        }
    };

    const toggleUserStatus = async (member: TeamMember) => {
        if (member.id === currentUser.id) {
            toast.warning('Você não pode desativar sua própria conta.');
            return;
        }

        const token = localStorage.getItem('token');
        try {
            const res = await fetch(`${API_BASE_URL}/api/team/${member.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ isActive: !member.isActive })
            });
            if (res.ok) {
                toast.success(!member.isActive ? `Conta de ${member.name} Ativada` : `Acesso de ${member.name} Revogado`);
                fetchTeam();
            }
        } catch { }
    };

    if (currentUser.role !== 'admin' && currentUser.role !== 'ADMIN') {
        return (
            <div className="flex-center" style={{ height: '70vh', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <ShieldAlert size={48} color="var(--color-danger)" />
                <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 600 }}>Acesso Restrito</h2>
                <p style={{ color: 'var(--color-text-secondary)', maxWidth: 400, textAlign: 'center' }}>
                    Esta página é reservada para administradores do sistema. Contate o responsável pela conta para solicitar alterações de equipe.
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
                                Gestão de Acessos
                            </h2>
                            <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', marginTop: 4 }}>
                                Gerencie quem tem acesso à plataforma e quais são suas permissões.
                            </p>
                        </div>
                        <button className="btn btn-primary" onClick={openCreateModal}>
                            <Plus size={16} /> Novo Membro
                        </button>
                    </div>

                    {loading ? (
                        <div style={{ padding: 'var(--space-10)', textAlign: 'center' }}><Loader2 className="spinner" size={24} /></div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)' }}>
                                        <th style={{ padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Usuário</th>
                                        <th style={{ padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Função</th>
                                        <th style={{ padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Status</th>
                                        <th style={{ padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'right' }}>Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {team.map((member) => (
                                        <tr key={member.id} style={{ borderBottom: '1px solid var(--color-border)', opacity: member.isActive ? 1 : 0.6 }}>
                                            <td style={{ padding: 'var(--space-4) var(--space-6)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                                    <div style={{ 
                                                        width: 36, height: 36, borderRadius: 'var(--radius-full)', 
                                                        background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontWeight: 600, color: 'var(--color-text-secondary)'
                                                    }}>
                                                        {member.name.substring(0, 2).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{member.name} {member.id === currentUser.id && <span style={{fontSize: 11, color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '2px 6px', borderRadius: 10, marginLeft: 4}}>Você</span>}</div>
                                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>{member.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={{ padding: 'var(--space-4) var(--space-6)' }}>
                                                {(member.role === 'ADMIN' || member.role === 'admin') ? (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 12, background: 'rgba(59, 130, 246, 0.1)', color: '#2563eb', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                                                        <Shield size={12} /> Admin
                                                    </span>
                                                ) : (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 12, background: 'rgba(16, 185, 129, 0.1)', color: '#059669', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                                                        <Users size={12} /> Analista
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: 'var(--space-4) var(--space-6)' }}>
                                                {member.isActive ? (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#059669', fontSize: 'var(--text-sm)', fontWeight: 500 }}><CheckCircle2 size={14} /> Ativo</span>
                                                ) : (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', fontWeight: 500 }}><UserX size={14} /> Desativado</span>
                                                )}
                                            </td>
                                            <td style={{ padding: 'var(--space-4) var(--space-6)', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                                                    <button className="icon-btn" onClick={() => toggleUserStatus(member)} title={member.isActive ? "Desativar Acesso" : "Reativar Acesso"} disabled={member.id === currentUser.id}>
                                                        {member.isActive ? <UserX size={16} /> : <UserCheck size={16} />}
                                                    </button>
                                                    <button className="icon-btn" onClick={() => openPasswordModal(member)} title="Resetar Senha">
                                                        <KeyRound size={16} />
                                                    </button>
                                                    <button className="icon-btn" onClick={() => openEditModal(member)} title="Editar Nível/Cargo">
                                                        <Edit2 size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {team.length === 0 && (
                                        <tr><td colSpan={4} style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>Nenhum membro encontrado.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </main>
            </div>

            {/* Modal: Editar/Criar Usuário */}
            {isModalOpen && (
                <div className="modal-overlay">
                    <div className="modal-content animate-slide-up" style={{ maxWidth: 450 }}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editingMember ? 'Editar Perfil' : 'Novo Membro na Equipe'}</h3>
                            <button className="icon-btn" onClick={() => setIsModalOpen(false)}>✕</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                                
                                <div>
                                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 'var(--text-sm)' }}>Nome Completo</label>
                                    <input required type="text" className="select-input" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: João da Silva" />
                                </div>
                                
                                <div>
                                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 'var(--text-sm)' }}>Endereço de E-mail {!editingMember && '*'}</label>
                                    <input required={!editingMember} disabled={!!editingMember} type="email" className="select-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="joao@licitasaas.com" />
                                </div>

                                {!editingMember && (
                                    <div>
                                        <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 'var(--text-sm)' }}>Senha Temporária *</label>
                                        <input required minLength={6} type="password" className="select-input" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
                                    </div>
                                )}

                                <div>
                                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 'var(--text-sm)' }}>Nível de Acesso</label>
                                    <select className="select-input" value={role} onChange={e => setRole(e.target.value)}>
                                        <option value="Analista">Analista (Recomendado)</option>
                                        <option value="ADMIN">Administrador (Acesso Total)</option>
                                    </select>
                                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                                        Administradores podem ver faturas e gerenciar outros membros.
                                    </p>
                                </div>

                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                                <button type="submit" className="btn btn-primary">{editingMember ? 'Salvar Alterações' : 'Convidar Membro'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal: Redefinir Senha */}
            {isPasswordModalOpen && editingMember && (
                <div className="modal-overlay">
                    <div className="modal-content animate-slide-up" style={{ maxWidth: 400 }}>
                        <div className="modal-header">
                            <h3 className="modal-title">Redefinir Senha</h3>
                            <button className="icon-btn" onClick={() => setIsPasswordModalOpen(false)}>✕</button>
                        </div>
                        <form onSubmit={handlePasswordReset}>
                            <div className="modal-body">
                                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
                                    Defina uma nova senha de acesso para <strong>{editingMember.name}</strong>.
                                </p>
                                <div>
                                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 'var(--text-sm)' }}>Nova Senha</label>
                                    <input required minLength={6} type="text" className="select-input" value={password} onChange={e => setPassword(e.target.value)} placeholder="Digite a nova senha" />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setIsPasswordModalOpen(false)}>Cancelar</button>
                                <button type="submit" className="btn btn-primary">Confirmar Nova Senha</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
