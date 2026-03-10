import { useState, useEffect, useCallback } from 'react';
import { Save, Bell, Shield, MessageSquare, Phone, Send, Loader2, Info, History, ExternalLink, Calendar, Zap, Activity, CheckCircle, XCircle, AlertTriangle, Search, ChevronLeft, ChevronRight, X, Power, Wifi, WifiOff, Radio } from 'lucide-react';
import { API_BASE_URL } from '../config';

function ComprasnetWatcherControls() {
    const [status, setStatus] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [actionMsg, setActionMsg] = useState('');

    const token = localStorage.getItem('token');
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const fetchStatus = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/chat-watcher/status`, { headers });
            if (res.ok) setStatus(await res.json());
        } catch { /* silent */ }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 10000);
        return () => clearInterval(interval);
    }, []);

    const handleLogin = async () => {
        setLoading(true);
        setActionMsg('');
        try {
            const res = await fetch(`${API_BASE_URL}/api/chat-watcher/login`, { method: 'POST', headers });
            const data = await res.json();
            setActionMsg(data.message || (data.success ? '✅ Browser aberto' : '❌ Erro'));
            setTimeout(fetchStatus, 2000);
        } catch (e) {
            setActionMsg('❌ Erro de conexão');
        } finally {
            setLoading(false);
        }
    };

    const handleShutdown = async () => {
        if (!confirm('Encerrar o monitor de chat e fechar o navegador?')) return;
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/chat-watcher/shutdown`, { method: 'POST', headers });
            const data = await res.json();
            setActionMsg(data.message || '⏹ Encerrado');
            setTimeout(fetchStatus, 1000);
        } catch { setActionMsg('❌ Erro'); } 
        finally { setLoading(false); }
    };

    const isLaunched = status?.isLaunched;
    const sessionCount = status?.activeSessions?.length || 0;
    const hasSession = status?.hasStoredSession;

    return (
        <div style={{ display: 'grid', gap: '16px' }}>
            {/* Status Row */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', borderRadius: '8px', background: isLaunched ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.06)', border: `1px solid ${isLaunched ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.15)'}` }}>
                    {isLaunched ? <Wifi size={14} color="#10b981" /> : <WifiOff size={14} color="#ef4444" />}
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: isLaunched ? '#059669' : '#ef4444' }}>
                        {isLaunched ? 'Watcher Ativo' : 'Watcher Inativo'}
                    </span>
                </div>
                {sessionCount > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', background: 'rgba(37, 99, 235, 0.08)', border: '1px solid rgba(37, 99, 235, 0.15)' }}>
                        <Radio size={14} color="#2563eb" />
                        <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#2563eb' }}>
                            {sessionCount} {sessionCount === 1 ? 'sessão' : 'sessões'} monitorada{sessionCount > 1 ? 's' : ''}
                        </span>
                    </div>
                )}
                {hasSession && !isLaunched && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                        💾 Sessão salva disponível
                    </span>
                )}
            </div>

            {/* Active Sessions Detail */}
            {status?.activeSessions?.length > 0 && (
                <div style={{ display: 'grid', gap: '8px' }}>
                    {status.activeSessions.map((s: any) => (
                        <div key={s.processId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: '8px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', fontSize: '0.8125rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: s.isActive ? '#10b981' : '#ef4444', animation: s.isActive ? 'pulse 2s infinite' : 'none' }} />
                                <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>CompraID: {s.compraId}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '12px', color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>
                                <span>📨 {s.messagesLogged} msgs</span>
                                <span>💓 {new Date(s.lastHeartbeat).toLocaleTimeString('pt-BR')}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Action Message */}
            {actionMsg && (
                <div style={{ padding: '10px 14px', borderRadius: '8px', background: actionMsg.startsWith('✅') || actionMsg.startsWith('⏹') ? 'rgba(16,185,129,0.08)' : actionMsg.startsWith('❌') ? 'rgba(239,68,68,0.08)' : 'rgba(37,99,235,0.08)', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                    {actionMsg}
                </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '12px' }}>
                {!isLaunched && (
                    <button className="btn" onClick={handleLogin} disabled={loading}
                        style={{ padding: '10px 20px', borderRadius: '10px', gap: '8px', fontWeight: 600, background: 'linear-gradient(135deg, #059669, #10b981)', color: 'white', border: 'none', cursor: 'pointer' }}>
                        {loading ? <Loader2 size={16} className="spinner" /> : <Power size={16} />}
                        Fazer Login no ComprasNet
                    </button>
                )}
                {isLaunched && (
                    <button className="btn" onClick={handleShutdown} disabled={loading}
                        style={{ padding: '10px 20px', borderRadius: '10px', gap: '8px', fontWeight: 500, background: 'var(--color-bg-surface-hover)', color: 'var(--color-danger)', border: '1px solid var(--color-border)', cursor: 'pointer' }}>
                        {loading ? <Loader2 size={16} className="spinner" /> : <Power size={16} />}
                        Encerrar Watcher
                    </button>
                )}
            </div>
        </div>
    );
}

export function SettingsPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState({
        keywords: 'suspensa,reaberta,vencedora',
        phoneNumber: '',
        telegramChatId: '',
        isActive: true
    });
    const [logs, setLogs] = useState<any[]>([]);
    const [testing, setTesting] = useState(false);
    const [health, setHealth] = useState<any>(null);
    // Filter & Pagination state
    const [searchText, setSearchText] = useState('');
    const [filterKeyword, setFilterKeyword] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [pagination, setPagination] = useState<any>(null);
    const [logsLoading, setLogsLoading] = useState(false);

    const fetchLogs = useCallback(async (page = 1, keyword = '', search = '', status = '') => {
        setLogsLoading(true);
        try {
            const token = localStorage.getItem('token');
            const params = new URLSearchParams({ page: String(page), limit: '15' });
            if (keyword) params.set('keyword', keyword);
            if (search) params.set('search', search);
            if (status) params.set('status', status);

            const res = await fetch(`${API_BASE_URL}/api/chat-monitor/logs?${params}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setLogs(data.logs || []);
                setPagination(data.pagination || null);
            }
        } catch (e) {
            console.error("Failed to fetch logs", e);
        } finally {
            setLogsLoading(false);
        }
    }, []);

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch(`${API_BASE_URL}/api/chat-monitor/config`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setConfig({
                        keywords: data.keywords || 'suspensa,reaberta,vencedora',
                        phoneNumber: data.phoneNumber || '',
                        telegramChatId: data.telegramChatId || '',
                        isActive: data.isActive ?? true
                    });
                }
            } catch (e) {
                console.error("Failed to fetch config", e);
            } finally {
                setLoading(false);
            }
        };

        const fetchHealth = async () => {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch(`${API_BASE_URL}/api/chat-monitor/health`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setHealth(data);
                }
            } catch (e) {
                console.error("Failed to fetch health", e);
            }
        };

        fetchConfig();
        fetchLogs();
        fetchHealth();
    }, [fetchLogs]);

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(() => {
            setCurrentPage(1);
            fetchLogs(1, filterKeyword, searchText, filterStatus);
        }, 400);
        return () => clearTimeout(timer);
    }, [searchText, filterKeyword, filterStatus, fetchLogs]);

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
        fetchLogs(page, filterKeyword, searchText, filterStatus);
    };

    const clearFilters = () => {
        setSearchText('');
        setFilterKeyword('');
        setFilterStatus('');
        setCurrentPage(1);
    };

    const hasFilters = searchText || filterKeyword || filterStatus;

    const handleSave = async () => {
        setSaving(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/chat-monitor/config`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(config)
            });
            if (res.ok) {
                alert("Configurações salvas com sucesso!");
            } else {
                throw new Error("Erro ao salvar");
            }
        } catch (e) {
            console.error(e);
            alert("Falha ao salvar configurações.");
        } finally {
            setSaving(false);
        }
    };

    const handleTestNotification = async () => {
        setTesting(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/chat-monitor/test`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            const data = await res.json();
            if (res.ok) {
                const parts = [];
                if (data.results.telegram === true) parts.push('✅ Telegram OK');
                else if (data.results.telegram === false) parts.push('❌ Telegram falhou');
                if (data.results.whatsapp === true) parts.push('✅ WhatsApp OK');
                else if (data.results.whatsapp === false) parts.push('❌ WhatsApp falhou');
                alert(parts.length > 0 ? parts.join('\n') : data.message);
            } else {
                alert('Erro no teste: ' + (data.error || 'Tente novamente.'));
            }
        } catch (e) {
            alert('Falha de conexão ao testar notificação.');
        } finally {
            setTesting(false);
        }
    };

    if (loading) {
        return (
            <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
                <Loader2 size={32} className="spinner" color="var(--color-primary)" />
            </div>
        );
    }

    return (
        <div className="page-container">
            <div className="page-header" style={{ marginBottom: '32px' }}>
                <h1 className="page-title">Configurações do Sistema</h1>
                <p className="page-subtitle">Gerencie suas preferências, notificações e o Monitor de Chat PNCP.</p>
            </div>

            <div style={{ maxWidth: '800px', display: 'grid', gap: '24px' }}>
                {/* Chat Monitor Config Card */}
                <div className="card" style={{ padding: '0', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                    <div style={{ padding: '20px 24px', background: 'var(--color-primary)', color: 'white', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <MessageSquare size={20} />
                        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>Monitor de Chat de Sessão (PNCP)</h2>
                    </div>
                    
                    <div style={{ padding: '28px' }}>
                        <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(37, 99, 235, 0.05)', borderRadius: '12px', border: '1px solid rgba(37, 99, 235, 0.1)' }}>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                                    <Bell size={20} />
                                </div>
                                <div>
                                    <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>Monitoramento Ativo</div>
                                    <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)' }}>Ativar radar automático para processos sinalizados no Kanban.</div>
                                </div>
                            </div>
                            <label className="switch">
                                <input 
                                    type="checkbox" 
                                    checked={config.isActive} 
                                    onChange={(e) => setConfig({...config, isActive: e.target.checked})}
                                />
                                <span className="slider round"></span>
                            </label>
                        </div>

                        <div style={{ display: 'grid', gap: '24px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
                                    Palavras-chave de Alerta
                                </label>
                                <textarea 
                                    value={config.keywords}
                                    onChange={(e) => setConfig({...config, keywords: e.target.value})}
                                    placeholder="Ex: suspensa, reaberta, vencedora, Marcos, desclassificada"
                                    style={{ 
                                        width: '100%', 
                                        padding: '12px 16px', 
                                        borderRadius: '10px', 
                                        border: '1px solid var(--color-border)', 
                                        background: 'var(--color-bg-base)',
                                        minHeight: '80px',
                                        fontSize: '0.9375rem',
                                        lineHeight: '1.5',
                                        color: 'var(--color-text-primary)'
                                    }}
                                />
                                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Info size={12} /> O radar soará um aviso sempre que estas palavras aparecerem no chat oficial da licitação.
                                </p>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                <div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
                                        <Phone size={16} color="var(--color-success)" /> WhatsApp para Avisos
                                    </label>
                                    <input 
                                        type="text"
                                        value={config.phoneNumber}
                                        onChange={(e) => setConfig({...config, phoneNumber: e.target.value})}
                                        placeholder="+55 (85) 99999-9999"
                                        style={{ 
                                            width: '100%', 
                                            padding: '12px 16px', 
                                            borderRadius: '10px', 
                                            border: '1px solid var(--color-border)', 
                                            background: 'var(--color-bg-base)',
                                            fontSize: '0.9375rem',
                                            color: 'var(--color-text-primary)'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
                                        <Send size={16} color="#0088cc" /> Telegram Chat ID
                                    </label>
                                    <input 
                                        type="text"
                                        value={config.telegramChatId}
                                        onChange={(e) => setConfig({...config, telegramChatId: e.target.value})}
                                        placeholder="Seu Chat ID (ou @usuario)"
                                        style={{ 
                                            width: '100%', 
                                            padding: '12px 16px', 
                                            borderRadius: '10px', 
                                            border: '1px solid var(--color-border)', 
                                            background: 'var(--color-bg-base)',
                                            fontSize: '0.9375rem',
                                            color: 'var(--color-text-primary)'
                                        }}
                                    />
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--color-border)', paddingTop: '24px' }}>
                            <button 
                                className="btn" 
                                style={{ padding: '10px 20px', borderRadius: '12px', gap: '8px', fontWeight: 600, background: 'var(--color-bg-surface-hover)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                                onClick={handleTestNotification}
                                disabled={testing}
                                title="Envia uma mensagem de teste para os canais configurados"
                            >
                                {testing ? <Loader2 size={16} className="spinner" /> : <Zap size={16} />}
                                Testar Notificação
                            </button>
                            <button 
                                className="btn btn-primary" 
                                style={{ padding: '12px 28px', borderRadius: '12px', gap: '8px', fontWeight: 600 }}
                                onClick={handleSave}
                                disabled={saving}
                            >
                                {saving ? <Loader2 size={18} className="spinner" /> : <Save size={18} />}
                                Salvar Configurações
                            </button>
                        </div>
                    </div>
                </div>

                {/* Health Status Card */}
                {health && (
                    <div className="card" style={{ padding: '20px 24px', border: '1px solid var(--color-border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Activity size={18} color="var(--color-primary)" />
                                <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-text-primary)' }}>Status do Radar</span>
                            </div>
                            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginLeft: 'auto', fontSize: '0.8125rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-secondary)' }}>
                                    {health.lastPollStatus === 'success' ? <CheckCircle size={14} color="var(--color-success)" /> : health.lastPollStatus === 'error' ? <XCircle size={14} color="var(--color-danger)" /> : <AlertTriangle size={14} color="var(--color-warning)" />}
                                    <span>{health.lastPollTime ? `Última verificação: ${new Date(health.lastPollTime).toLocaleString('pt-BR')}` : 'Aguardando primeira verificação...'}</span>
                                </div>
                                <span style={{ color: 'var(--color-text-tertiary)' }}>|</span>
                                <span style={{ color: 'var(--color-text-secondary)' }}>📡 {health.monitoredProcesses} processos monitorados</span>
                                <span style={{ color: 'var(--color-text-tertiary)' }}>|</span>
                                <span style={{ color: 'var(--color-text-secondary)' }}>🚨 {health.totalAlerts} alertas totais</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* ComprasNet Chat Watcher Card */}
                <div className="card" style={{ padding: '0', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                    <div style={{ padding: '20px 24px', background: 'linear-gradient(135deg, #059669, #10b981)', color: 'white', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <MessageSquare size={20} />
                        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>Monitor de Chat — Compras.gov.br</h2>
                        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', padding: '4px 10px', background: 'rgba(255,255,255,0.2)', borderRadius: '20px' }}>Novo</span>
                    </div>
                    
                    <div style={{ padding: '24px' }}>
                        <div style={{ marginBottom: '16px', padding: '14px 16px', background: 'rgba(5, 150, 105, 0.05)', borderRadius: '10px', border: '1px solid rgba(5, 150, 105, 0.15)', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                            <Info size={14} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
                            Monitora em tempo real as mensagens do chat da <strong>Sala de Disputa</strong> do ComprasNet.
                            Captura convocações, diligências, suspensões e outros eventos críticos.
                            <br />
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '4px', display: 'block' }}>
                                Pré-requisito: Preencha os campos UASG, Modalidade, Nº Processo e Ano no card do processo (aparecem quando o portal é "ComprasNet").
                            </span>
                        </div>

                        <ComprasnetWatcherControls />
                    </div>
                </div>
                {/* Monitoring Logs Card */}
                <div className="card" style={{ padding: '0', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                    <div style={{ padding: '20px 24px', background: 'var(--color-bg-surface-hover)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <History size={20} color="var(--color-primary)" />
                            <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--color-text-primary)' }}>Histórico de Alertas (Radar)</h2>
                        </div>
                        {pagination && <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', fontWeight: 500 }}>{pagination.total} alertas encontrados</span>}
                    </div>

                    {/* Filters Bar */}
                    <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', background: 'var(--color-bg-base)' }}>
                        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: '180px' }}>
                            <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                            <input
                                type="text"
                                value={searchText}
                                onChange={(e) => setSearchText(e.target.value)}
                                placeholder="Buscar no conteúdo..."
                                style={{ width: '100%', padding: '8px 12px 8px 34px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', fontSize: '0.8125rem', color: 'var(--color-text-primary)' }}
                            />
                        </div>
                        <select
                            value={filterKeyword}
                            onChange={(e) => setFilterKeyword(e.target.value)}
                            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', fontSize: '0.8125rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}
                        >
                            <option value="">Todas as palavras</option>
                            {config.keywords.split(',').map(k => k.trim()).filter(Boolean).map(k => (
                                <option key={k} value={k}>{k}</option>
                            ))}
                        </select>
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', fontSize: '0.8125rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}
                        >
                            <option value="">Todos os status</option>
                            <option value="SENT">✅ Enviado</option>
                            <option value="FAILED">❌ Falhou</option>
                            <option value="PENDING_NOTIFICATION">⏳ Pendente</option>
                            <option value="NO_CHANNEL">📭 Sem canal</option>
                            <option value="SKIPPED">⏭️ Ignorado</option>
                        </select>
                        {hasFilters && (
                            <button
                                className="icon-btn"
                                onClick={clearFilters}
                                style={{ padding: '8px', borderRadius: '8px', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}
                                title="Limpar filtros"
                            >
                                <X size={14} /> Limpar
                            </button>
                        )}
                    </div>

                    <div style={{ padding: '0', maxHeight: '500px', overflowY: 'auto', position: 'relative' }}>
                        {logsLoading && (
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
                                <Loader2 size={24} className="spinner" color="var(--color-primary)" />
                            </div>
                        )}
                        {logs.length === 0 ? (
                            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                                <Info size={32} style={{ marginBottom: '12px', opacity: 0.3 }} />
                                <p>{hasFilters ? 'Nenhum alerta encontrado com os filtros atuais.' : 'Nenhum alerta detectado pelo radar ainda.'}</p>
                            </div>
                        ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                                <thead style={{ background: 'var(--color-bg-base)', position: 'sticky', top: 0, zIndex: 1, borderBottom: '1px solid var(--color-border)' }}>
                                    <tr>
                                        <th style={{ textAlign: 'left', padding: '12px 24px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Data/Hora</th>
                                        <th style={{ textAlign: 'left', padding: '12px 16px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Citação (Bot)</th>
                                        <th style={{ textAlign: 'left', padding: '12px 16px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Palavra</th>
                                        <th style={{ textAlign: 'left', padding: '12px 16px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Processo</th>
                                        <th style={{ textAlign: 'center', padding: '12px 16px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Status</th>
                                        <th style={{ textAlign: 'center', padding: '12px 24px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Link</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((log) => (
                                        <tr key={log.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '16px 24px', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <Calendar size={14} />
                                                    {new Date(log.createdAt).toLocaleString('pt-BR')}
                                                </div>
                                            </td>
                                            <td style={{ padding: '16px 16px', maxWidth: '300px' }}>
                                                <div style={{ fontStyle: 'italic', color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                                    "{log.content}"
                                                </div>
                                            </td>
                                            <td style={{ padding: '16px 16px' }}>
                                                <span className="badge badge-red" style={{ fontSize: '0.7rem' }}>{log.detectedKeyword}</span>
                                            </td>
                                            <td style={{ padding: '16px 16px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                                                {log.biddingProcess?.title || 'Processo não encontrado'}
                                            </td>
                                            <td style={{ padding: '16px 16px', textAlign: 'center' }}>
                                                <span className={`badge ${log.status === 'SENT' ? 'badge-green' : log.status === 'FAILED' ? 'badge-red' : log.status === 'PENDING_NOTIFICATION' ? 'badge-yellow' : 'badge-gray'}`} style={{ fontSize: '0.65rem' }}>
                                                    {log.status === 'SENT' ? '✅ Enviado' : log.status === 'FAILED' ? '❌ Falhou' : log.status === 'PENDING_NOTIFICATION' ? '⏳ Pendente' : log.status === 'NO_CHANNEL' ? '📭 Sem canal' : log.status}
                                                </span>
                                                {log.sentTo && <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>{log.sentTo}</div>}
                                            </td>
                                            <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                                                {log.biddingProcess?.link && (
                                                    <a href={log.biddingProcess.link} target="_blank" rel="noopener noreferrer" className="icon-btn" title="Ir para o Processo">
                                                        <ExternalLink size={16} color="var(--color-primary)" />
                                                    </a>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Pagination Controls */}
                    {pagination && pagination.totalPages > 1 && (
                        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-bg-base)', fontSize: '0.8125rem' }}>
                            <span style={{ color: 'var(--color-text-tertiary)' }}>
                                Página {pagination.page} de {pagination.totalPages}
                            </span>
                            <div style={{ display: 'flex', gap: '4px' }}>
                                <button
                                    className="icon-btn"
                                    onClick={() => handlePageChange(currentPage - 1)}
                                    disabled={currentPage <= 1}
                                    style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', opacity: currentPage <= 1 ? 0.4 : 1 }}
                                >
                                    <ChevronLeft size={16} />
                                </button>
                                {Array.from({ length: Math.min(pagination.totalPages, 5) }, (_, i) => {
                                    let pageNum: number;
                                    if (pagination.totalPages <= 5) {
                                        pageNum = i + 1;
                                    } else if (currentPage <= 3) {
                                        pageNum = i + 1;
                                    } else if (currentPage >= pagination.totalPages - 2) {
                                        pageNum = pagination.totalPages - 4 + i;
                                    } else {
                                        pageNum = currentPage - 2 + i;
                                    }
                                    return (
                                        <button
                                            key={pageNum}
                                            className="icon-btn"
                                            onClick={() => handlePageChange(pageNum)}
                                            style={{
                                                padding: '6px 12px',
                                                borderRadius: '8px',
                                                border: '1px solid var(--color-border)',
                                                fontWeight: pageNum === currentPage ? 700 : 400,
                                                background: pageNum === currentPage ? 'var(--color-primary)' : 'transparent',
                                                color: pageNum === currentPage ? 'white' : 'var(--color-text-secondary)',
                                                fontSize: '0.8125rem'
                                            }}
                                        >
                                            {pageNum}
                                        </button>
                                    );
                                })}
                                <button
                                    className="icon-btn"
                                    onClick={() => handlePageChange(currentPage + 1)}
                                    disabled={currentPage >= pagination.totalPages}
                                    style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', opacity: currentPage >= pagination.totalPages ? 0.4 : 1 }}
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Other settings placeholder */}
                <div className="card" style={{ padding: '24px', opacity: 0.6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--color-text-tertiary)' }}>
                        <Shield size={20} />
                        <span style={{ fontWeight: 600 }}>Segurança e Acesso</span>
                        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', padding: '2px 8px', background: 'var(--color-border)', borderRadius: '12px' }}>Em breve</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
