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
            <div className="page-header" style={{ marginBottom: '32px' }}>
                <h1 className="page-title">Configurações do Sistema</h1>
                <p className="page-subtitle">Gerencie preferências e visualize a saúde do Agente Local.</p>
            </div>

            <div style={{ maxWidth: '1000px', display: 'grid', gap: '24px' }}>
                {/* Saúde do Agente (Fase 4) */}
                <div className="card">
                    <div style={{ 
                        padding: '24px', 
                        borderBottom: '1px solid var(--color-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ 
                                padding: '10px', 
                                background: 'rgba(56, 189, 248, 0.1)', 
                                color: '#38bdf8',
                                borderRadius: '12px' 
                            }}>
                                <Activity size={24} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--color-text-primary)' }}>
                                    Saúde do Agente Local
                                </h3>
                                <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
                                    Histórico de capturas recentes e mensagens monitoradas
                                </p>
                            </div>
                        </div>
                        <button onClick={fetchAgentLogs} className="btn btn-secondary btn-sm" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <Loader2 size={16} /> Atualizar Log
                        </button>
                    </div>

                    <div style={{ padding: '24px' }}>
                        {logs.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-tertiary)', background: 'var(--color-background-elevated)', borderRadius: '12px' }}>
                                <Server size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                                <p style={{ fontWeight: 500 }}>Nenhum log de captura encontrado ainda.</p>
                                <p style={{ fontSize: '0.9rem', marginTop: '8px' }}>As mensagens do ComprasNet aparecerão aqui assim que o Agente Local começar a trabalhar.</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                {logs.map((log) => (
                                    <div key={log.id} style={{
                                        background: 'var(--color-background-elevated)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: '12px',
                                        padding: '16px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '12px'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                <span style={{ 
                                                    fontSize: '0.75rem', 
                                                    fontWeight: 600, 
                                                    background: log.detectedKeyword ? 'rgba(74, 222, 128, 0.1)' : 'var(--color-background-accent)',
                                                    color: log.detectedKeyword ? '#4ade80' : 'var(--color-text-secondary)',
                                                    padding: '4px 10px',
                                                    borderRadius: '20px'
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
                                        
                                        <div style={{ fontSize: '0.9rem', background: 'var(--color-background)', padding: '12px', borderRadius: '8px', borderLeft: '3px solid var(--color-border)' }}>
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
