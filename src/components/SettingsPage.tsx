import { useState, useEffect } from 'react';
import { Shield, Loader2, Activity, Server, Clock } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface AgentLog {
    id: string;
    content: string;
    detectedKeyword: string | null;
    status: string;
    captureSource: string;
    createdAt: string;
    biddingProcess?: {
        processNumber?: string;
        processYear?: string;
        title?: string;
        uasg?: string;
    };
}

export function SettingsPage() {
    const [loading, setLoading] = useState(true);
    const [logs, setLogs] = useState<AgentLog[]>([]);

    useEffect(() => {
        fetchAgentLogs();
    }, []);

    const fetchAgentLogs = async () => {
        try {
            setLoading(true);
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/chat-monitor/logs?limit=50`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setLogs(data);
            }
        } catch (error) {
            console.error('Failed to fetch agent logs:', error);
        } finally {
            setLoading(false);
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
            <div className="page-header" style={{ marginBottom: 'var(--space-8)' }}>
                <h1 className="page-title">Configurações do Sistema</h1>
                <p className="page-subtitle">Gerencie preferências e visualize a saúde do Agente Local.</p>
            </div>

            <div style={{ maxWidth: '1000px', display: 'grid', gap: 'var(--space-6)' }}>
                {/* Saúde do Agente (Fase 4) */}
                <div className="card">
                    <div style={{ 
                        padding: 'var(--space-6)', 
                        borderBottom: '1px solid var(--color-border)',
                    }}
                        className="flex-between"
                    >
                        <div className="flex-gap" style={{ gap: 'var(--space-3)' }}>
                            <div className="indicator-card" style={{ padding: 'var(--space-3)', minWidth: 'auto', border: 'none', boxShadow: 'none', background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
                                <Activity size={24} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-primary)' }}>
                                    Saúde do Agente Local
                                </h3>
                                <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-base)', marginTop: '4px' }}>
                                    Histórico de capturas recentes e mensagens monitoradas
                                </p>
                            </div>
                        </div>
                        <button onClick={fetchAgentLogs} className="btn btn-secondary btn-sm" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                            <Loader2 size={16} /> Atualizar Log
                        </button>
                    </div>

                    <div style={{ padding: '24px' }}>
                        {logs.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--color-text-tertiary)', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)' }}>
                                <Server size={48} style={{ margin: '0 auto var(--space-4)', opacity: 0.5 }} />
                                <p style={{ fontWeight: 'var(--font-medium)' }}>Nenhum log de captura encontrado ainda.</p>
                                <p style={{ fontSize: 'var(--text-base)', marginTop: 'var(--space-2)' }}>As mensagens do ComprasNet aparecerão aqui assim que o Agente Local começar a trabalhar.</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                                {logs.map((log) => (
                                    <div key={log.id} className="card" style={{
                                        padding: 'var(--space-4)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 'var(--space-3)'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                                                <span style={{ 
                                                    fontSize: 'var(--text-sm)', 
                                                    fontWeight: 'var(--font-semibold)', 
                                                    background: log.detectedKeyword ? 'var(--color-success-bg)' : 'var(--color-bg-surface-hover)',
                                                    color: log.detectedKeyword ? 'var(--color-success)' : 'var(--color-text-secondary)',
                                                    padding: '4px var(--space-3)',
                                                    borderRadius: 'var(--radius-xl)'
                                                }}>
                                                    {log.detectedKeyword ? `Alerta: ${log.detectedKeyword}` : 'Captura Comum'}
                                                </span>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <Server size={14} /> Fonte: {log.captureSource}
                                                </span>
                                            </div>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <Clock size={14} /> {new Date(log.createdAt).toLocaleString()}
                                            </span>
                                        </div>
                                        
                                        <div style={{ fontSize: 'var(--text-base)', background: 'var(--color-bg-base)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--color-border)' }}>
                                            {log.content}
                                        </div>

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                                                Ref: Processo {log.biddingProcess?.processNumber}{log.biddingProcess?.processYear ? '/' + log.biddingProcess.processYear : ''} - UASG {log.biddingProcess?.uasg || 'N/A'} - {log.biddingProcess?.title}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Segurança e Acesso */}
                <div className="card" style={{ padding: 'var(--space-6)', opacity: 0.6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', color: 'var(--color-text-tertiary)' }}>
                        <Shield size={20} />
                        <span style={{ fontWeight: 'var(--font-semibold)' }}>Segurança e Acesso</span>
                        <span style={{ marginLeft: 'auto', fontSize: 'var(--text-sm)', padding: '2px var(--space-2)', background: 'var(--color-border)', borderRadius: 'var(--radius-lg)' }}>Em breve</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
