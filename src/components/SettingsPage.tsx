import { useState, useEffect } from 'react';
import { Settings, Bell, User, Globe, Clock, Check } from 'lucide-react';
import { API_BASE_URL } from '../config';

export function SettingsPage() {
    const [notifEnabled, setNotifEnabled] = useState(true);
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [refreshInterval, setRefreshInterval] = useState(30);
    const [savedMsg, setSavedMsg] = useState('');

    // Load saved preferences
    useEffect(() => {
        try {
            const prefs = JSON.parse(localStorage.getItem('licitasaas_prefs') || '{}');
            if (prefs.notifEnabled !== undefined) setNotifEnabled(prefs.notifEnabled);
            if (prefs.soundEnabled !== undefined) setSoundEnabled(prefs.soundEnabled);
            if (prefs.autoRefresh !== undefined) setAutoRefresh(prefs.autoRefresh);
            if (prefs.refreshInterval !== undefined) setRefreshInterval(prefs.refreshInterval);
        } catch { /* ignore */ }
    }, []);

    const savePrefs = () => {
        const prefs = { notifEnabled, soundEnabled, autoRefresh, refreshInterval };
        localStorage.setItem('licitasaas_prefs', JSON.stringify(prefs));
        setSavedMsg('Preferências salvas!');
        setTimeout(() => setSavedMsg(''), 2000);
    };

    // Get user info from localStorage
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    return (
        <div className="page-container">
            {/* Page Header */}
            <div className="page-header" style={{ marginBottom: 'var(--space-8)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{
                        padding: 'var(--space-2)',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-bg-surface-hover)',
                        color: 'var(--color-text-secondary)',
                        display: 'flex'
                    }}>
                        <Settings size={24} />
                    </div>
                    <div>
                        <h1 className="page-title">Configurações</h1>
                        <p className="page-subtitle">Gerencie suas preferências e conta.</p>
                    </div>
                </div>
            </div>

            <div style={{ maxWidth: '800px', display: 'grid', gap: 'var(--space-6)' }}>

                {/* ── Perfil ── */}
                <SettingsSection icon={<User size={20} />} title="Conta" description="Informações do seu perfil no sistema.">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                        <SettingsField label="Nome" value={user.name || 'Administrador'} />
                        <SettingsField label="Email" value={user.email || 'admin@licitasaas.com'} />
                        <SettingsField label="Organização" value={user.tenantName || 'LicitaSaaS Brasil'} />
                        <SettingsField label="Função" value={user.role === 'admin' ? 'Administrador' : 'Operador'} />
                    </div>
                </SettingsSection>

                {/* ── Notificações ── */}
                <SettingsSection icon={<Bell size={20} />} title="Notificações" description="Configure alertas do Monitoramento de Chat e sessões.">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                        <SettingsToggle
                            label="Notificações do navegador"
                            description="Receba alertas quando palavras-chave forem detectadas no chat."
                            checked={notifEnabled}
                            onChange={setNotifEnabled}
                        />
                        <SettingsToggle
                            label="Alerta sonoro"
                            description="Toque um som ao detectar nova mensagem relevante no monitoramento."
                            checked={soundEnabled}
                            onChange={setSoundEnabled}
                        />
                    </div>
                </SettingsSection>

                {/* ── Atualização ── */}
                <SettingsSection icon={<Clock size={20} />} title="Atualização de Dados" description="Controle a frequência de atualização automática.">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                        <SettingsToggle
                            label="Atualização automática"
                            description="Recarregar dados de licitações e monitoramento periodicamente."
                            checked={autoRefresh}
                            onChange={setAutoRefresh}
                        />
                        {autoRefresh && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', paddingLeft: 'var(--space-2)' }}>
                                <label style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', minWidth: '160px' }}>
                                    Intervalo (segundos):
                                </label>
                                <select
                                    value={refreshInterval}
                                    onChange={(e) => setRefreshInterval(Number(e.target.value))}
                                    className="form-select"
                                    style={{ width: '120px' }}
                                >
                                    <option value={15}>15s</option>
                                    <option value={30}>30s</option>
                                    <option value={60}>60s</option>
                                    <option value={120}>120s</option>
                                </select>
                            </div>
                        )}
                    </div>
                </SettingsSection>

                {/* ── Sistema ── */}
                <SettingsSection icon={<Globe size={20} />} title="Sistema" description="Informações técnicas do sistema.">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                        <SettingsField label="Versão" value="1.0.0 (Sprint 4)" />
                        <SettingsField label="Servidor" value={API_BASE_URL.replace('https://', '').replace('http://', '')} />
                        <SettingsField label="Plano" value="Enterprise" />
                        <SettingsField label="Último Login" value={new Date().toLocaleDateString('pt-BR')} />
                    </div>
                </SettingsSection>

                {/* ── Save Button ── */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 'var(--space-3)' }}>
                    {savedMsg && (
                        <span style={{ 
                            color: 'var(--color-success)', 
                            fontSize: 'var(--text-sm)', 
                            fontWeight: 600,
                            display: 'flex', alignItems: 'center', gap: '4px',
                            animation: 'fadeIn 0.2s ease-out',
                        }}>
                            <Check size={14} /> {savedMsg}
                        </span>
                    )}
                    <button className="btn btn-primary" onClick={savePrefs} style={{ padding: 'var(--space-3) var(--space-6)' }}>
                        Salvar Preferências
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Helper Components ──

function SettingsSection({ icon, title, description, children }: {
    icon: React.ReactNode;
    title: string;
    description: string;
    children: React.ReactNode;
}) {
    return (
        <div style={{
            background: 'var(--color-bg-surface)',
            borderRadius: 'var(--radius-xl)',
            border: 'none',
            boxShadow: '0 0 0 1px var(--color-border), 0 2px 12px rgba(0,0,0,0.04)',
            overflow: 'hidden',
        }}>
            <div style={{
                padding: 'var(--space-5) var(--space-6)',
                borderBottom: '1px solid var(--color-border)',
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
            }}>
                <div style={{
                    width: 36, height: 36,
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(37,99,235,0.08)',
                    border: 'none',
                    boxShadow: '0 0 0 1px rgba(37,99,235,0.12)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--color-primary)',
                    flexShrink: 0,
                }}>
                    {icon}
                </div>
                <div>
                    <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                        {title}
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginTop: 1 }}>
                        {description}
                    </div>
                </div>
            </div>
            <div style={{ padding: 'var(--space-5) var(--space-6)' }}>
                {children}
            </div>
        </div>
    );
}

function SettingsField({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                {label}
            </div>
            <div style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-primary)', fontWeight: 500 }}>
                {value}
            </div>
        </div>
    );
}

function SettingsToggle({ label, description, checked, onChange }: {
    label: string;
    description: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <div
            onClick={() => onChange(!checked)}
            style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: 'var(--space-3) var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: checked ? 'rgba(37,99,235,0.04)' : 'transparent',
                cursor: 'pointer',
                transition: 'all 0.15s',
            }}
        >
            <div>
                <div style={{ fontSize: 'var(--text-md)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                    {label}
                </div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                    {description}
                </div>
            </div>
            <div
                style={{
                    width: 44, height: 24,
                    borderRadius: 9999,
                    background: checked ? 'var(--color-primary)' : 'var(--color-bg-surface-hover)',
                    position: 'relative',
                    transition: 'background 0.2s',
                    flexShrink: 0,
                    marginLeft: 'var(--space-4)',
                    boxShadow: checked ? '0 0 8px rgba(37,99,235,0.3)' : '0 0 0 1px var(--color-border)',
                }}
            >
                <div style={{
                    width: 18, height: 18,
                    borderRadius: '50%',
                    background: 'white',
                    position: 'absolute',
                    top: 3,
                    left: checked ? 23 : 3,
                    transition: 'left 0.2s',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                }} />
            </div>
        </div>
    );
}
