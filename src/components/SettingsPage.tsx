import { useState, useEffect } from 'react';
import { Settings, Bell, User, Globe, Clock, Check, Phone, Send, Mail, Loader2, CheckCircle, XCircle, Radar, Info, Cpu } from 'lucide-react';
import { ShieldAlert } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { AiUsageDashboard } from './settings/AiUsageDashboard';
import { SecuritySettings } from './settings/SecuritySettings';

export function SettingsPage() {
    const [notifEnabled, setNotifEnabled] = useState(true);
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [refreshInterval, setRefreshInterval] = useState(30);
    const [savedMsg, setSavedMsg] = useState('');

    // ── Notification channels (from ChatMonitorConfig) ──
    const [phoneNumber, setPhoneNumber] = useState('');
    const [telegramChatId, setTelegramChatId] = useState('');
    const [notificationEmail, setNotificationEmail] = useState('');
    const [loadingChannels, setLoadingChannels] = useState(true);
    const [savingChannels, setSavingChannels] = useState(false);
    const [channelSavedMsg, setChannelSavedMsg] = useState('');

    // ── Test notification ──
    const [testingNotif, setTestingNotif] = useState(false);
    const [testResult, setTestResult] = useState<{ telegram?: boolean | null; whatsapp?: boolean | null; email?: boolean | null } | null>(null);

    // ── Opportunity Scanner toggle ──
    const [scannerEnabled, setScannerEnabled] = useState(true);
    const [loadingScanner, setLoadingScanner] = useState(true);
    const [togglingScanner, setTogglingScanner] = useState(false);

    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Load saved local preferences
    useEffect(() => {
        try {
            const prefs = JSON.parse(localStorage.getItem('licitasaas_prefs') || '{}');
            if (prefs.notifEnabled !== undefined) setNotifEnabled(prefs.notifEnabled);
            if (prefs.soundEnabled !== undefined) setSoundEnabled(prefs.soundEnabled);
            if (prefs.autoRefresh !== undefined) setAutoRefresh(prefs.autoRefresh);
            if (prefs.refreshInterval !== undefined) setRefreshInterval(prefs.refreshInterval);
        } catch { /* ignore */ }
    }, []);

    // Load notification channels from server
    useEffect(() => {
        const loadChannels = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/chat-monitor/config`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    setPhoneNumber(data.phoneNumber || '');
                    setTelegramChatId(data.telegramChatId || '');
                    setNotificationEmail(data.notificationEmail || '');
                }
            } catch { /* silent */ }
            finally { setLoadingChannels(false); }
        };
        loadChannels();
    }, []);

    // Load scanner status
    useEffect(() => {
        const loadScanner = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/pncp/scanner/status`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    setScannerEnabled(data.enabled !== false);
                }
            } catch { /* silent */ }
            finally { setLoadingScanner(false); }
        };
        loadScanner();
    }, []);

    const saveLocalPrefs = () => {
        const prefs = { notifEnabled, soundEnabled, autoRefresh, refreshInterval };
        localStorage.setItem('licitasaas_prefs', JSON.stringify(prefs));
        setSavedMsg('Preferências salvas!');
        setTimeout(() => setSavedMsg(''), 2000);
    };

    const saveChannels = async () => {
        setSavingChannels(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/chat-monitor/config`, {
                method: 'POST', headers,
                body: JSON.stringify({ phoneNumber, telegramChatId, notificationEmail }),
            });
            if (res.ok) {
                setChannelSavedMsg('Canais salvos!');
                setTimeout(() => setChannelSavedMsg(''), 2500);
            }
        } catch { /* silent */ }
        finally { setSavingChannels(false); }
    };

    const handleTestNotification = async () => {
        setTestingNotif(true);
        setTestResult(null);
        try {
            const res = await fetch(`${API_BASE_URL}/api/chat-monitor/test`, { method: 'POST', headers });
            if (res.ok) {
                const data = await res.json();
                setTestResult(data.results || {});
            }
        } catch { /* silent */ }
        finally { setTestingNotif(false); }
    };

    const toggleScanner = async (enabled: boolean) => {
        setTogglingScanner(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/pncp/scanner/toggle`, {
                method: 'POST', headers,
                body: JSON.stringify({ enabled }),
            });
            if (res.ok) setScannerEnabled(enabled);
        } catch { /* silent */ }
        finally { setTogglingScanner(false); }
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

                {/* ── Segurança e 2FA ── */}
                <SettingsSection icon={<ShieldAlert size={20} />} title="Segurança da Conta" description="Gerencie a autenticação em duas etapas e configurações de acesso.">
                    <SecuritySettings />
                </SettingsSection>

                {/* ── Notificações (expanded) ── */}
                <SettingsSection icon={<Bell size={20} />} title="Notificações" description="Canais de entrega, alertas do navegador e scanner de oportunidades.">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

                        {/* ─── Block 1: Delivery Channels ─── */}
                        <div>
                            <div style={{ 
                                display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-4)',
                                fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)',
                                textTransform: 'uppercase', letterSpacing: '0.04em',
                            }}>
                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-primary)' }} />
                                Canais de Entrega
                            </div>

                            <div style={{ 
                                padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                                background: 'rgba(37,99,235,0.03)', 
                                boxShadow: '0 0 0 1px rgba(37,99,235,0.1)',
                                display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
                            }}>
                                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
                                    Configure os canais para receber alertas do <strong>Monitoramento de Chat</strong> e do <strong>Scanner de Oportunidades PNCP</strong>.
                                    Os canais preenchidos receberão notificações automáticas de novas ocorrências.
                                </div>

                                {loadingChannels ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>
                                        <Loader2 size={14} className="spinner" /> Carregando...
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
                                            {/* WhatsApp */}
                                            <div>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
                                                    <Phone size={14} color="#10b981" /> WhatsApp
                                                </label>
                                                <input
                                                    type="text"
                                                    value={phoneNumber}
                                                    onChange={(e) => setPhoneNumber(e.target.value)}
                                                    placeholder="+5585999999999"
                                                    style={{
                                                        width: '100%', padding: 'var(--space-2) var(--space-3)',
                                                        borderRadius: 'var(--radius-md)', border: 'none',
                                                        boxShadow: '0 0 0 1px var(--color-border)',
                                                        background: 'var(--color-bg-base)',
                                                        fontSize: 'var(--text-md)', color: 'var(--color-text-primary)',
                                                        outline: 'none',
                                                    }}
                                                />
                                            </div>

                                            {/* Telegram */}
                                            <div>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
                                                    <Send size={14} color="#2563eb" /> Telegram Chat ID
                                                </label>
                                                <input
                                                    type="text"
                                                    value={telegramChatId}
                                                    onChange={(e) => setTelegramChatId(e.target.value)}
                                                    placeholder="Chat ID ou @usuario"
                                                    style={{
                                                        width: '100%', padding: 'var(--space-2) var(--space-3)',
                                                        borderRadius: 'var(--radius-md)', border: 'none',
                                                        boxShadow: '0 0 0 1px var(--color-border)',
                                                        background: 'var(--color-bg-base)',
                                                        fontSize: 'var(--text-md)', color: 'var(--color-text-primary)',
                                                        outline: 'none',
                                                    }}
                                                />
                                            </div>
                                            
                                            {/* E-mail independent */}
                                            <div>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
                                                    <Mail size={14} color="#dc2626" /> E-mail de Alertas
                                                </label>
                                                <input
                                                    type="email"
                                                    value={notificationEmail}
                                                    onChange={(e) => setNotificationEmail(e.target.value)}
                                                    placeholder="alertas@empresa.com"
                                                    style={{
                                                        width: '100%', padding: 'var(--space-2) var(--space-3)',
                                                        borderRadius: 'var(--radius-md)', border: 'none',
                                                        boxShadow: '0 0 0 1px var(--color-border)',
                                                        background: 'var(--color-bg-base)',
                                                        fontSize: 'var(--text-md)', color: 'var(--color-text-primary)',
                                                        outline: 'none',
                                                    }}
                                                />
                                            </div>
                                        </div>

                                        {/* Action buttons */}
                                        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                                            <button
                                                className="btn btn-primary"
                                                onClick={saveChannels}
                                                disabled={savingChannels}
                                                style={{ padding: '8px var(--space-5)', fontSize: 'var(--text-sm)', gap: '6px', fontWeight: 600 }}
                                            >
                                                {savingChannels ? <Loader2 size={14} className="spinner" /> : <Check size={14} />}
                                                Salvar Canais
                                            </button>

                                            <button
                                                className="btn btn-outline"
                                                onClick={handleTestNotification}
                                                disabled={testingNotif}
                                                style={{ padding: '8px var(--space-5)', fontSize: 'var(--text-sm)', gap: '6px' }}
                                            >
                                                {testingNotif ? <Loader2 size={14} className="spinner" /> : <Send size={14} />}
                                                Enviar Teste
                                            </button>

                                            {channelSavedMsg && (
                                                <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-sm)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', animation: 'fadeIn 0.2s ease-out' }}>
                                                    <Check size={14} /> {channelSavedMsg}
                                                </span>
                                            )}
                                        </div>

                                        {/* Test Results */}
                                        {testResult && (
                                            <div style={{
                                                display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap',
                                                padding: 'var(--space-3)',
                                                borderRadius: 'var(--radius-md)',
                                                background: 'var(--color-bg-surface-hover)',
                                            }}>
                                                <TestResultBadge label="WhatsApp" result={testResult.whatsapp} />
                                                <TestResultBadge label="Telegram" result={testResult.telegram} />
                                                <TestResultBadge label="E-mail" result={testResult.email} />
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        {/* ─── Divider ─── */}
                        <div style={{ height: 1, background: 'var(--color-border)' }} />

                        {/* ─── Block 2: Browser Preferences ─── */}
                        <div>
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-3)',
                                fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)',
                                textTransform: 'uppercase', letterSpacing: '0.04em',
                            }}>
                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-warning)' }} />
                                Navegador
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                <SettingsToggle
                                    label="Notificações do navegador"
                                    description="Receba alertas visuais no navegador quando palavras-chave forem detectadas no chat."
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
                        </div>

                        {/* ─── Divider ─── */}
                        <div style={{ height: 1, background: 'var(--color-border)' }} />

                        {/* ─── Block 3: Opportunity Scanner ─── */}
                        <div>
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-3)',
                                fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)',
                                textTransform: 'uppercase', letterSpacing: '0.04em',
                            }}>
                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                                Alertas de Oportunidades
                            </div>
                            {loadingScanner ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', padding: 'var(--space-2)' }}>
                                    <Loader2 size={14} className="spinner" /> Carregando...
                                </div>
                            ) : (
                                <div style={{
                                    padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                                    background: scannerEnabled ? 'rgba(16,185,129,0.04)' : 'transparent',
                                    boxShadow: scannerEnabled ? '0 0 0 1px rgba(16,185,129,0.15)' : '0 0 0 1px var(--color-border)',
                                    display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
                                    transition: 'all 0.2s',
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <Radar size={18} color={scannerEnabled ? '#10b981' : 'var(--color-text-tertiary)'} />
                                            <div>
                                                <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                                    Scanner de Oportunidades PNCP
                                                </div>
                                                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                                    {scannerEnabled
                                                        ? 'Monitoramento ativo a cada 4 horas. Alertas enviados para os canais configurados acima.'
                                                        : 'Desativado. Ative para receber alertas automáticos de novas licitações.'}
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => toggleScanner(!scannerEnabled)}
                                            disabled={togglingScanner}
                                            className="btn btn-outline"
                                            style={{
                                                padding: '6px 16px', fontSize: '0.8125rem', gap: '6px',
                                                borderRadius: 'var(--radius-md)', flexShrink: 0,
                                                color: scannerEnabled ? 'var(--color-danger)' : '#10b981',
                                                borderColor: scannerEnabled ? 'var(--color-danger)' : '#10b981',
                                            }}
                                        >
                                            {togglingScanner && <Loader2 size={12} className="spinner" />}
                                            {scannerEnabled ? 'Desativar' : 'Ativar'}
                                        </button>
                                    </div>

                                    {/* Status indicator */}
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: '6px',
                                        fontSize: 'var(--text-sm)', color: scannerEnabled ? '#10b981' : 'var(--color-text-tertiary)',
                                    }}>
                                        <div style={{
                                            width: 8, height: 8, borderRadius: '50%',
                                            background: scannerEnabled ? '#10b981' : '#9ca3af',
                                            boxShadow: scannerEnabled ? '0 0 8px rgba(16,185,129,0.4)' : 'none',
                                        }} />
                                        {scannerEnabled ? 'Ativo' : 'Inativo'}
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                                        <Info size={12} style={{ flexShrink: 0, marginTop: '2px' }} />
                                        As pesquisas monitoradas são gerenciadas na aba PNCP. Os alertas são despachados via WhatsApp, Telegram e E-mail para os canais definidos acima.
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </SettingsSection>

                {/* ── Consumo de IA ── */}
                <SettingsSection icon={<Cpu size={20} />} title="Consumo de Inteligência Artificial" description="Monitore tokens, custos e quotas de uso da IA do sistema.">
                    <AiUsageDashboard />
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
                    <button className="btn btn-primary" onClick={saveLocalPrefs} style={{ padding: 'var(--space-3) var(--space-6)' }}>
                        Salvar Preferências
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Helper Components ──

function TestResultBadge({ label, result }: { label: string; result: boolean | null | undefined }) {
    if (result === null || result === undefined) {
        return (
            <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                padding: '3px 10px', borderRadius: 'var(--radius-lg)',
                background: 'var(--color-bg-surface-hover)',
                fontSize: '0.75rem', color: 'var(--color-text-tertiary)', fontWeight: 500,
            }}>
                {label}: Não configurado
            </span>
        );
    }
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            padding: '3px 10px', borderRadius: 'var(--radius-lg)',
            background: result ? 'var(--color-success-bg)' : 'rgba(220,38,38,0.06)',
            fontSize: '0.75rem', color: result ? 'var(--color-success)' : '#dc2626', fontWeight: 600,
        }}>
            {result ? <CheckCircle size={12} /> : <XCircle size={12} />}
            {label}: {result ? 'OK' : 'Falha'}
        </span>
    );
}

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
