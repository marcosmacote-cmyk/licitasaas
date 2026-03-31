import { useState, useEffect } from 'react';
import { Cpu, Loader2, AlertTriangle, CheckCircle2, Edit3, RotateCcw, Save, X } from 'lucide-react';
import { API_BASE_URL } from '../../config';
import { useToast } from '../ui';

interface TenantQuota {
    id: string;
    razaoSocial: string;
    rootCnpj: string;
    currentTokens: number;
    totalCalls: number;
    hardLimit: number;
    softLimit: number;
    percentUsed: number;
    status: 'ok' | 'warning' | 'critical';
}

const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K` : String(n);

const statusColor = (s: string) => s === 'critical' ? '#dc2626' : s === 'warning' ? '#d97706' : '#10b981';
const statusLabel = (s: string) => s === 'critical' ? 'Bloqueado' : s === 'warning' ? 'Alerta' : 'OK';

const PRESETS = [
    { label: '5M', value: 5_000_000 },
    { label: '10M', value: 10_000_000 },
    { label: '20M', value: 20_000_000 },
    { label: '50M', value: 50_000_000 },
    { label: '100M', value: 100_000_000 },
    { label: 'Ilimitado', value: 999_999_999 },
];

export function AiQuotaManager() {
    const toast = useToast();
    const [quotas, setQuotas] = useState<TenantQuota[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editHard, setEditHard] = useState(0);
    const [editSoft, setEditSoft] = useState(0);
    const [saving, setSaving] = useState(false);

    const token = localStorage.getItem('token');
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const fetchQuotas = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/admin/ai-quotas`, { headers });
            if (res.ok) setQuotas(await res.json());
            else toast.error('Falha ao carregar cotas.');
        } catch { toast.error('Erro de conexão.'); }
        finally { setLoading(false); }
    };

    useEffect(() => { fetchQuotas(); }, []);

    const startEdit = (q: TenantQuota) => {
        setEditingId(q.id);
        setEditHard(q.hardLimit);
        setEditSoft(q.softLimit);
    };

    const cancelEdit = () => setEditingId(null);

    const saveQuota = async (tenantId: string) => {
        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/admin/ai-quotas/${tenantId}`, {
                method: 'PUT', headers,
                body: JSON.stringify({ hardLimit: editHard, softLimit: editSoft }),
            });
            if (res.ok) {
                toast.success('Cota atualizada!');
                setEditingId(null);
                fetchQuotas();
            } else {
                const d = await res.json();
                toast.error(d.error || 'Falha ao salvar.');
            }
        } catch { toast.error('Erro de conexão.'); }
        finally { setSaving(false); }
    };

    const resetCache = async (tenantId: string, name: string) => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/admin/ai-quotas/${tenantId}/reset`, {
                method: 'POST', headers,
            });
            if (res.ok) {
                toast.success(`Cache de "${name}" resetado. Limite será reavaliado.`);
                fetchQuotas();
            }
        } catch { toast.error('Erro ao resetar cache.'); }
    };

    if (loading) {
        return <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}><Loader2 className="spinner" size={24} /></div>;
    }

    return (
        <div>
            {/* Header */}
            <div style={{ padding: 'var(--space-4) var(--space-6)', background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <Cpu size={16} color="var(--color-primary)" />
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)' }}>Cotas de IA por Organização</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', padding: '2px 8px', borderRadius: 12, background: 'var(--color-bg-surface-hover)' }}>
                        Mês atual
                    </span>
                </div>
                <button className="btn btn-ghost" onClick={fetchQuotas} style={{ padding: '4px 8px', fontSize: 'var(--text-xs)' }}>
                    <RotateCcw size={12} /> Atualizar
                </button>
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)' }}>
                            {['Organização', 'Consumo Atual', 'Barra', 'Hard Limit', 'Soft Limit', 'Chamadas', 'Status', 'Ações'].map(h => (
                                <th key={h} style={{ padding: 'var(--space-2) var(--space-4)', fontSize: '0.625rem', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', fontWeight: 600, textAlign: h === 'Barra' ? 'left' : 'center', whiteSpace: 'nowrap' }}>
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {quotas.map(q => {
                            const isEditing = editingId === q.id;
                            const barPct = Math.min(q.percentUsed, 100);
                            const barColor = statusColor(q.status);

                            return (
                                <tr key={q.id} style={{ borderBottom: '1px solid var(--color-border)', background: q.status === 'critical' ? 'rgba(220, 38, 38, 0.03)' : 'transparent' }}>
                                    {/* Name */}
                                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-primary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {q.razaoSocial}
                                    </td>

                                    {/* Current */}
                                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center', fontSize: 'var(--text-sm)', fontWeight: 600, fontFamily: 'monospace', color: barColor }}>
                                        {fmt(q.currentTokens)}
                                    </td>

                                    {/* Bar */}
                                    <td style={{ padding: 'var(--space-3) var(--space-4)', minWidth: 120 }}>
                                        <div style={{ height: 8, borderRadius: 4, background: 'var(--color-bg-surface-hover)', overflow: 'hidden', position: 'relative' }}>
                                            <div style={{ height: '100%', width: `${barPct}%`, borderRadius: 4, background: barColor, transition: 'width 0.5s ease' }} />
                                        </div>
                                        <div style={{ fontSize: '0.625rem', color: 'var(--color-text-tertiary)', marginTop: 2, textAlign: 'center' }}>{q.percentUsed}%</div>
                                    </td>

                                    {/* Hard Limit */}
                                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center' }}>
                                        {isEditing ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                                                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
                                                    {PRESETS.map(p => (
                                                        <button key={p.value} onClick={() => { setEditHard(p.value); setEditSoft(Math.round(p.value * 0.75)); }}
                                                            style={{ padding: '2px 6px', borderRadius: 4, border: 'none', fontSize: '0.625rem', fontWeight: 600, cursor: 'pointer',
                                                                background: editHard === p.value ? 'var(--color-primary)' : 'var(--color-bg-surface-hover)',
                                                                color: editHard === p.value ? 'white' : 'var(--color-text-secondary)' }}>
                                                            {p.label}
                                                        </button>
                                                    ))}
                                                </div>
                                                <input type="number" value={editHard} onChange={e => setEditHard(Number(e.target.value))}
                                                    style={{ width: 90, padding: '3px 6px', borderRadius: 4, border: 'none', boxShadow: '0 0 0 1px var(--color-border)', fontSize: '0.6875rem', textAlign: 'center', fontFamily: 'monospace' }} />
                                            </div>
                                        ) : (
                                            <span style={{ fontSize: 'var(--text-sm)', fontFamily: 'monospace', color: 'var(--color-text-secondary)' }}>{fmt(q.hardLimit)}</span>
                                        )}
                                    </td>

                                    {/* Soft Limit */}
                                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center' }}>
                                        {isEditing ? (
                                            <input type="number" value={editSoft} onChange={e => setEditSoft(Number(e.target.value))}
                                                style={{ width: 90, padding: '3px 6px', borderRadius: 4, border: 'none', boxShadow: '0 0 0 1px var(--color-border)', fontSize: '0.6875rem', textAlign: 'center', fontFamily: 'monospace' }} />
                                        ) : (
                                            <span style={{ fontSize: 'var(--text-sm)', fontFamily: 'monospace', color: 'var(--color-text-tertiary)' }}>{fmt(q.softLimit)}</span>
                                        )}
                                    </td>

                                    {/* Calls */}
                                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                                        {q.totalCalls}
                                    </td>

                                    {/* Status */}
                                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center' }}>
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                            padding: '2px 8px', borderRadius: 12, fontSize: '0.625rem', fontWeight: 700,
                                            background: `${barColor}15`, color: barColor,
                                        }}>
                                            {q.status === 'critical' ? <AlertTriangle size={10} /> : <CheckCircle2 size={10} />}
                                            {statusLabel(q.status)}
                                        </span>
                                    </td>

                                    {/* Actions */}
                                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center' }}>
                                        {isEditing ? (
                                            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                                <button onClick={() => saveQuota(q.id)} disabled={saving}
                                                    style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: 'var(--color-primary)', color: 'white', cursor: 'pointer', fontSize: '0.625rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                                                    {saving ? <Loader2 size={10} className="spinner" /> : <Save size={10} />} Salvar
                                                </button>
                                                <button onClick={cancelEdit}
                                                    style={{ padding: '4px 6px', borderRadius: 4, border: 'none', background: 'var(--color-bg-surface-hover)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                                    <X size={12} color="var(--color-text-tertiary)" />
                                                </button>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                                <button onClick={() => startEdit(q)} title="Editar limites"
                                                    style={{ padding: '4px 6px', borderRadius: 4, border: 'none', background: 'var(--color-bg-surface-hover)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                                    <Edit3 size={12} color="var(--color-primary)" />
                                                </button>
                                                {q.status === 'critical' && (
                                                    <button onClick={() => resetCache(q.id, q.razaoSocial)} title="Desbloquear (resetar cache)"
                                                        style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: 'rgba(220, 38, 38, 0.08)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.625rem', fontWeight: 600, color: '#dc2626' }}>
                                                        <RotateCcw size={10} /> Desbloquear
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Help text */}
            <div style={{ padding: 'var(--space-3) var(--space-6)', fontSize: '0.6875rem', color: 'var(--color-text-tertiary)', borderTop: '1px solid var(--color-border)', lineHeight: 1.6 }}>
                <strong>Hard limit</strong> = bloqueia chamadas de IA quando atingido. <strong>Soft limit</strong> = envia alerta proativo (recomendado: 75% do hard).
                Para desbloquear imediatamente sem alterar limites, clique em "Desbloquear" — isso reseta o cache e aguarda a próxima verificação.
                Para liberar permanentemente, aumente o hard limit.
            </div>
        </div>
    );
}
