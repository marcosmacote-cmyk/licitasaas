import { useState, useEffect } from 'react';
import { ShieldCheck, Calendar, Globe, Activity, RefreshCw } from 'lucide-react';
import { API_BASE_URL } from '../../config';

export function AuditLogViewer() {
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const token = localStorage.getItem('token');
    const headers = { 'Authorization': `Bearer ${token}` };

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/admin/audit-logs?limit=50`, { headers });
            if (res.ok) {
                const data = await res.json();
                setLogs(data.logs || []);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldCheck size={20} color="var(--color-success)" /> Trilhas de Auditoria (Audit Log)
                </h3>
                <button onClick={fetchLogs} disabled={loading} className="btn btn-outline" style={{ gap: '6px', fontSize: '13px' }}>
                    <RefreshCw size={14} className={loading ? 'spinner' : ''} /> {loading ? 'Carregando...' : 'Atualizar'}
                </button>
            </div>

            <div style={{ background: 'var(--color-bg-base)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', minWidth: '700px' }}>
                    <thead>
                        <tr>
                            <th style={{ width: '150px' }}>Data / Hora</th>
                            <th style={{ width: '200px' }}>Usuário / IP</th>
                            <th>Ação</th>
                            <th>Entidade</th>
                            <th>Detalhes</th>
                        </tr>
                    </thead>
                    <tbody>
                        {logs.map(log => (
                            <tr key={log.id} style={{ fontSize: '13px' }}>
                                <td style={{ color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <Calendar size={12} /> {new Date(log.createdAt).toLocaleString('pt-BR')}
                                    </div>
                                </td>
                                <td>
                                    <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>
                                        {log.user ? log.user.name : 'Sistema'}
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                                        <Globe size={10} /> {log.ipAddress || 'IP desconhecido'}
                                    </div>
                                </td>
                                <td>
                                    <span style={{
                                        display: 'inline-flex', padding: '2px 8px', borderRadius: '4px',
                                        background: log.action.includes('LOGIN') ? 'rgba(16,185,129,0.1)' : 'rgba(37,99,235,0.1)',
                                        color: log.action.includes('LOGIN') ? '#10b981' : '#2563eb',
                                        fontWeight: 600, fontSize: '11px'
                                    }}>
                                        {log.action}
                                    </span>
                                </td>
                                <td>
                                    <div style={{ color: 'var(--color-text-secondary)' }}>{log.entityType}</div>
                                    {log.entityId && <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>ID: {log.entityId.substring(0, 8)}...</div>}
                                </td>
                                <td style={{ color: 'var(--color-text-tertiary)' }}>
                                    {log.newValue ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <Activity size={12} /> Alteração Registrada
                                        </div>
                                    ) : '-'}
                                </td>
                            </tr>
                        ))}
                        {logs.length === 0 && !loading && (
                            <tr>
                                <td colSpan={5} style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--color-text-tertiary)' }}>
                                    Nenhuma trilha de auditoria encontrada.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
