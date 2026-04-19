import { useState, useEffect, useMemo } from 'react';
import {
    Cpu, Loader2, AlertTriangle, CheckCircle2, Edit3, RotateCcw, Save, X,
    Eye, ArrowLeft, Activity, DollarSign, Zap, Calendar, RefreshCw,
    BarChart3, PieChart as PieChartIcon, Shield,
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell,
} from 'recharts';
import { API_BASE_URL } from '../../config';
import { useToast } from '../ui';

// ── Types ──
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

interface DrillDownData {
    tenant: { razaoSocial: string; rootCnpj: string };
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    avgDurationMs: number;
    errorRate: number;
    byOperation: Array<{ operation: string; calls: number; tokens: number }>;
    daily: Array<{ date: string; tokens: number; calls: number; costBRL: number }>;
    quota: {
        currentTokens: number; softLimit: number; hardLimit: number;
        percentUsed: number; status: string; estimatedCostBRL: number; daysRemainingInMonth: number;
    };
}

// ── Constants ──
const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K` : String(n);
const fmtBRL = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
const statusColor = (s: string) => s === 'critical' ? '#dc2626' : s === 'warning' ? '#d97706' : '#10b981';
const statusLabel = (s: string) => s === 'critical' ? 'Bloqueado' : s === 'warning' ? 'Alerta' : 'OK';

const OP_LABELS: Record<string, string> = {
    'analysis': 'Análise de Editais', 'ai_chat': 'Chat IA', 'proposal_letter': 'Carta Proposta',
    'proposal_populate': 'Preenchimento Proposta', 'proposal_composition': 'Composição Proposta',
    'oracle_analysis': 'Oráculo de Acervos', 'petition': 'Petição / Recurso',
    'dossier_match': 'Dossiê Técnico', 'generate_declaration': 'Declarações',
    'repair_declaration': 'Reparo Declarações', 'process_document': 'Processamento Docs',
    'compare_certificates': 'Comparação Atestados',
};
const OP_COLORS = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626', '#8b5cf6', '#0891b2', '#65a30d', '#ea580c', '#e11d48', '#6366f1', '#14b8a6'];

const PRESETS = [
    { label: '5M', value: 5_000_000 }, { label: '10M', value: 10_000_000 },
    { label: '20M', value: 20_000_000 }, { label: '50M', value: 50_000_000 },
    { label: '100M', value: 100_000_000 }, { label: 'Ilimitado', value: 999_999_999 },
];

export function AiQuotaManager() {
    const toast = useToast();
    const [quotas, setQuotas] = useState<TenantQuota[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editHard, setEditHard] = useState(0);
    const [editSoft, setEditSoft] = useState(0);
    const [saving, setSaving] = useState(false);

    // Drill-down state
    const [drillTenantId, setDrillTenantId] = useState<string | null>(null);
    const [drillData, setDrillData] = useState<DrillDownData | null>(null);
    const [drillLoading, setDrillLoading] = useState(false);
    const [drillPeriod, setDrillPeriod] = useState(30);

    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const fetchQuotas = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/admin/ai-quotas`, { headers });
            if (res.ok) setQuotas(await res.json());
        } catch { /* ignore */ }
        finally { setLoading(false); }
    };

    const fetchDrillDown = async (tenantId: string, days: number) => {
        setDrillLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/admin/ai-usage/${tenantId}?period=${days}`, { headers });
            if (res.ok) setDrillData(await res.json());
        } catch { toast.error('Erro ao carregar raio-X.'); }
        finally { setDrillLoading(false); }
    };

    useEffect(() => { fetchQuotas(); }, []);

    useEffect(() => {
        if (drillTenantId) fetchDrillDown(drillTenantId, drillPeriod);
    }, [drillTenantId, drillPeriod]);

    const openDrillDown = (tenantId: string) => {
        setDrillTenantId(tenantId);
        setDrillPeriod(30);
    };

    const startEdit = (q: TenantQuota) => { setEditingId(q.id); setEditHard(q.hardLimit); setEditSoft(q.softLimit); };

    const saveQuota = async (tenantId: string) => {
        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/admin/ai-quotas/${tenantId}`, {
                method: 'PUT', headers, body: JSON.stringify({ hardLimit: editHard, softLimit: editSoft }),
            });
            if (res.ok) { toast.success('Cota atualizada!'); setEditingId(null); fetchQuotas(); }
            else { const d = await res.json(); toast.error(d.error || 'Falha.'); }
        } catch { toast.error('Erro de conexão.'); }
        finally { setSaving(false); }
    };

    const resetCache = async (tenantId: string, name: string) => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/admin/ai-quotas/${tenantId}/reset`, { method: 'POST', headers });
            if (res.ok) { toast.success(`"${name}" desbloqueado!`); fetchQuotas(); }
        } catch { toast.error('Erro.'); }
    };

    // ═══ DRILL-DOWN VIEW ═══
    if (drillTenantId && drillData) {
        return <DrillDownView data={drillData} period={drillPeriod} setPeriod={setDrillPeriod}
            loading={drillLoading} onBack={() => { setDrillTenantId(null); setDrillData(null); }}
            onRefresh={() => fetchDrillDown(drillTenantId, drillPeriod)} />;
    }

    // ═══ QUOTA TABLE VIEW ═══
    if (loading) return <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}><Loader2 className="spinner" size={24} /></div>;

    return (
        <div>
            {/* Header */}
            <div style={{ padding: 'var(--space-4) var(--space-6)', background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <Cpu size={16} color="var(--color-primary)" />
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>Cotas de IA por Organização</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', padding: '2px 8px', borderRadius: 12, background: 'var(--color-bg-surface-hover)' }}>Mês atual</span>
                </div>
                <button className="btn btn-ghost" onClick={fetchQuotas} style={{ padding: '4px 8px', fontSize: 'var(--text-xs)' }}><RotateCcw size={12} /> Atualizar</button>
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)' }}>
                            {['Organização', 'Consumo', 'Progresso', 'Hard Limit', 'Soft Limit', 'Chamadas', 'Status', 'Ações'].map(h => (
                                <th key={h} style={{ padding: 'var(--space-2) var(--space-4)', fontSize: '0.625rem', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', fontWeight: 600, textAlign: h === 'Progresso' ? 'left' : 'center', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {quotas.map(q => {
                            const isEditing = editingId === q.id;
                            const barPct = Math.min(q.percentUsed, 100);
                            const bc = statusColor(q.status);

                            return (
                                <tr key={q.id} style={{ borderBottom: '1px solid var(--color-border)', background: q.status === 'critical' ? 'rgba(220,38,38,0.03)' : 'transparent' }}>
                                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.razaoSocial}</td>
                                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center', fontSize: 'var(--text-sm)', fontWeight: 600, fontFamily: 'monospace', color: bc }}>{fmt(q.currentTokens)}</td>
                                    <td style={{ padding: 'var(--space-3) var(--space-4)', minWidth: 120 }}>
                                        <div style={{ height: 8, borderRadius: 4, background: 'var(--color-bg-surface-hover)', overflow: 'hidden' }}>
                                            <div style={{ height: '100%', width: `${barPct}%`, borderRadius: 4, background: bc, transition: 'width 0.5s ease' }} />
                                        </div>
                                        <div style={{ fontSize: '0.625rem', color: 'var(--color-text-tertiary)', marginTop: 2, textAlign: 'center' }}>{q.percentUsed}%</div>
                                    </td>
                                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center' }}>
                                        {isEditing ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                                                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
                                                    {PRESETS.map(p => (
                                                        <button key={p.value} onClick={() => { setEditHard(p.value); setEditSoft(Math.round(p.value * 0.75)); }}
                                                            style={{ padding: '2px 6px', borderRadius: 4, border: 'none', fontSize: '0.625rem', fontWeight: 600, cursor: 'pointer',
                                                                background: editHard === p.value ? 'var(--color-primary)' : 'var(--color-bg-surface-hover)',
                                                                color: editHard === p.value ? 'white' : 'var(--color-text-secondary)' }}>{p.label}</button>
                                                    ))}
                                                </div>
                                                <input type="number" value={editHard} onChange={e => setEditHard(Number(e.target.value))}
                                                    style={{ width: 90, padding: '3px 6px', borderRadius: 4, border: 'none', boxShadow: '0 0 0 1px var(--color-border)', fontSize: '0.6875rem', textAlign: 'center', fontFamily: 'monospace' }} />
                                            </div>
                                        ) : <span style={{ fontSize: 'var(--text-sm)', fontFamily: 'monospace', color: 'var(--color-text-secondary)' }}>{fmt(q.hardLimit)}</span>}
                                    </td>
                                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center' }}>
                                        {isEditing ? (
                                            <input type="number" value={editSoft} onChange={e => setEditSoft(Number(e.target.value))}
                                                style={{ width: 90, padding: '3px 6px', borderRadius: 4, border: 'none', boxShadow: '0 0 0 1px var(--color-border)', fontSize: '0.6875rem', textAlign: 'center', fontFamily: 'monospace' }} />
                                        ) : <span style={{ fontSize: 'var(--text-sm)', fontFamily: 'monospace', color: 'var(--color-text-tertiary)' }}>{fmt(q.softLimit)}</span>}
                                    </td>
                                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{q.totalCalls}</td>
                                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 12, fontSize: '0.625rem', fontWeight: 700, background: `${bc}15`, color: bc }}>
                                            {q.status === 'critical' ? <AlertTriangle size={10} /> : <CheckCircle2 size={10} />} {statusLabel(q.status)}
                                        </span>
                                    </td>
                                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center' }}>
                                        {isEditing ? (
                                            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                                <button onClick={() => saveQuota(q.id)} disabled={saving} style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: 'var(--color-primary)', color: 'white', cursor: 'pointer', fontSize: '0.625rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                                                    {saving ? <Loader2 size={10} className="spinner" /> : <Save size={10} />} Salvar
                                                </button>
                                                <button onClick={() => setEditingId(null)} style={{ padding: '4px 6px', borderRadius: 4, border: 'none', background: 'var(--color-bg-surface-hover)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><X size={12} color="var(--color-text-tertiary)" /></button>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                                <button onClick={() => openDrillDown(q.id)} title="Raio-X de consumo"
                                                    style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: 'rgba(99,102,241,0.08)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.625rem', fontWeight: 600, color: '#6366f1' }}>
                                                    <Eye size={10} /> Raio-X
                                                </button>
                                                <button onClick={() => startEdit(q)} title="Editar limites"
                                                    style={{ padding: '4px 6px', borderRadius: 4, border: 'none', background: 'var(--color-bg-surface-hover)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                                    <Edit3 size={12} color="var(--color-primary)" />
                                                </button>
                                                {q.status === 'critical' && (
                                                    <button onClick={() => resetCache(q.id, q.razaoSocial)} title="Desbloquear"
                                                        style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: 'rgba(220,38,38,0.08)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.625rem', fontWeight: 600, color: '#dc2626' }}>
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

            <div style={{ padding: 'var(--space-3) var(--space-6)', fontSize: '0.6875rem', color: 'var(--color-text-tertiary)', borderTop: '1px solid var(--color-border)', lineHeight: 1.6 }}>
                <strong>Hard limit</strong> = bloqueia chamadas de IA. <strong>Soft limit</strong> = envia alerta (recomendado: 75% do hard).
                Clique em <strong>"Raio-X"</strong> para ver o consumo detalhado de cada cliente.
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  DRILL-DOWN VIEW — Dashboard de consumo de um tenant específico
// ═══════════════════════════════════════════════════════════════

function DrillDownView({ data, period, setPeriod, loading, onBack, onRefresh }: {
    data: DrillDownData; period: number; setPeriod: (d: number) => void; loading: boolean; onBack: () => void; onRefresh: () => void;
}) {
    const qc = data.quota.status === 'critical' ? '#dc2626' : data.quota.status === 'warning' ? '#d97706' : '#10b981';

    const chartData = useMemo(() =>
        data.daily.map(d => ({
            ...d, label: new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        })),
    [data.daily]);

    const pieData = useMemo(() =>
        data.byOperation.map((op, i) => ({
            name: OP_LABELS[op.operation] || op.operation,
            value: op.tokens, calls: op.calls,
            color: OP_COLORS[i % OP_COLORS.length],
        })),
    [data.byOperation]);

    const box: React.CSSProperties = {
        padding: 'var(--space-5)', borderRadius: 'var(--radius-xl)', background: 'var(--color-bg-surface)',
        boxShadow: '0 0 0 1px var(--color-border), 0 2px 12px rgba(0,0,0,0.04)',
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Header */}
            <div style={{ padding: 'var(--space-4) var(--space-6)', background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <button onClick={onBack} style={{ padding: '4px 8px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-bg-surface-hover)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                        <ArrowLeft size={14} /> Voltar
                    </button>
                    <div>
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                            Raio-X de IA — {data.tenant.razaoSocial}
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{data.tenant.rootCnpj}</div>
                    </div>
                    {loading && <Loader2 size={14} className="spinner" style={{ color: 'var(--color-ai)' }} />}
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <Calendar size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                    {[7, 15, 30].map(d => (
                        <button key={d} onClick={() => setPeriod(d)} style={{
                            padding: '4px 12px', borderRadius: 'var(--radius-md)', border: 'none', fontSize: 'var(--text-sm)',
                            fontWeight: period === d ? 600 : 400, cursor: 'pointer',
                            background: period === d ? 'var(--color-ai)' : 'var(--color-bg-surface-hover)',
                            color: period === d ? 'white' : 'var(--color-text-secondary)',
                        }}>{d}d</button>
                    ))}
                    <button onClick={onRefresh} style={{ padding: '4px 8px', borderRadius: 'var(--radius-md)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-tertiary)', display: 'flex' }} title="Atualizar"><RefreshCw size={14} /></button>
                </div>
            </div>

            {/* KPI Cards */}
            <div style={{ padding: '0 var(--space-6)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-3)' }}>
                <KpiCard icon={<Cpu size={18} />} label="Tokens Totais" value={fmt(data.totalTokens)} sub={`${fmt(data.totalInputTokens)} in · ${fmt(data.totalOutputTokens)} out`} color="var(--color-ai)" bg="var(--color-ai-bg)" />
                <KpiCard icon={<Activity size={18} />} label="Chamadas IA" value={data.totalCalls.toLocaleString('pt-BR')} sub={`${data.avgDurationMs}ms médio`} color="var(--color-primary)" bg="var(--color-primary-light)" />
                <KpiCard icon={<DollarSign size={18} />} label="Custo Estimado" value={fmtBRL(data.quota.estimatedCostBRL)} sub={`mês atual (${data.quota.daysRemainingInMonth}d restantes)`} color="#059669" bg="rgba(5,150,105,0.08)" />
                <KpiCard icon={<Zap size={18} />} label="Taxa de Erro" value={`${data.errorRate}%`} sub={data.errorRate === 0 ? 'sem falhas' : 'chamadas com erro'} color={data.errorRate > 5 ? '#dc2626' : '#10b981'} bg={data.errorRate > 5 ? 'rgba(220,38,38,0.06)' : 'rgba(5,150,105,0.08)'} />
            </div>

            {/* Quota Gauge */}
            <div style={{ padding: '0 var(--space-6)' }}>
                <div style={box}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                        <Shield size={16} style={{ color: qc }} />
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cota Mensal</span>
                        <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-lg)', background: `${qc}15`, color: qc }}>
                            {data.quota.status === 'critical' ? 'LIMITE ATINGIDO' : data.quota.status === 'warning' ? 'ATENÇÃO' : 'NORMAL'}
                        </span>
                    </div>
                    <div style={{ position: 'relative', marginBottom: 'var(--space-3)' }}>
                        <div style={{ height: 12, borderRadius: 9999, background: 'var(--color-bg-surface-hover)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 9999, width: `${Math.min(100, data.quota.percentUsed)}%`, background: `linear-gradient(90deg, ${qc}, ${qc}cc)`, transition: 'width 0.6s ease-out' }} />
                        </div>
                        {data.quota.hardLimit > 0 && <div style={{ position: 'absolute', left: `${(data.quota.softLimit / data.quota.hardLimit) * 100}%`, top: -2, bottom: -2, width: 2, background: '#d97706', borderRadius: 1, opacity: 0.6 }} />}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>{fmt(data.quota.currentTokens)} / {fmt(data.quota.hardLimit)}</span>
                        <span style={{ color: qc, fontWeight: 700, fontSize: 'var(--text-md)' }}>{data.quota.percentUsed}%</span>
                    </div>
                </div>
            </div>

            {/* Chart + Pie */}
            <div style={{ padding: '0 var(--space-6)', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-4)' }}>
                <div style={box}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                        <BarChart3 size={16} style={{ color: 'var(--color-ai)' }} />
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Consumo Diário</span>
                    </div>
                    <div style={{ width: '100%', height: 200 }}>
                        <ResponsiveContainer>
                            <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                <XAxis dataKey="label" interval={period <= 7 ? 0 : period <= 15 ? 1 : 'preserveStartEnd'} tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmt} />
                                <Tooltip contentStyle={{ backgroundColor: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', borderRadius: 8, fontSize: 12 }}
                                    formatter={((v?: number, n?: string) => n === 'tokens' ? [fmt(v ?? 0), 'Tokens'] : [v, n || '']) as any} />
                                <Bar dataKey="tokens" fill="var(--color-ai)" radius={[3, 3, 0, 0]} opacity={0.85} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div style={box}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                        <PieChartIcon size={16} style={{ color: 'var(--color-primary)' }} />
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Por Funcionalidade</span>
                    </div>
                    {pieData.length > 0 ? (
                        <>
                            <div style={{ width: '100%', height: 120, marginBottom: 'var(--space-2)' }}>
                                <ResponsiveContainer>
                                    <PieChart>
                                        <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={30} outerRadius={50} paddingAngle={2} strokeWidth={0}>
                                            {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                                        </Pie>
                                        <Tooltip contentStyle={{ backgroundColor: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', borderRadius: 8, fontSize: 11 }}
                                            formatter={((v?: number) => [fmt(v ?? 0), 'Tokens']) as any} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {pieData.slice(0, 6).map((op, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '3px 6px', fontSize: 'var(--text-xs)' }}>
                                        <span style={{ width: 8, height: 8, borderRadius: 2, background: op.color, flexShrink: 0 }} />
                                        <span style={{ flex: 1, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{op.name}</span>
                                        <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(op.value)}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : <div style={{ textAlign: 'center', padding: 'var(--space-6) 0', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>Sem dados no período.</div>}
                </div>
            </div>

            {/* Operations Table */}
            {data.byOperation.length > 0 && (
                <div style={{ padding: '0 var(--space-6) var(--space-4)' }}>
                    <div style={{ ...box, padding: 0, overflow: 'hidden' }}>
                        <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            <Activity size={16} style={{ color: 'var(--color-primary)' }} />
                            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Detalhamento por Operação</span>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    {['Operação', 'Chamadas', 'Tokens', '% do Total'].map((h, i) => (
                                        <th key={h} style={{ padding: '10px 20px', fontSize: '0.6875rem', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.byOperation.map((op, i) => {
                                    const pct = data.totalTokens > 0 ? Math.round((op.tokens / data.totalTokens) * 100) : 0;
                                    return (
                                        <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '10px 20px', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                                    <span style={{ width: 8, height: 8, borderRadius: 2, background: OP_COLORS[i % OP_COLORS.length], flexShrink: 0 }} />
                                                    {OP_LABELS[op.operation] || op.operation}
                                                </div>
                                            </td>
                                            <td style={{ padding: '10px 20px', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{op.calls}</td>
                                            <td style={{ padding: '10px 20px', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(op.tokens)}</td>
                                            <td style={{ padding: '10px 20px', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                                                    <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--color-bg-surface-hover)', overflow: 'hidden' }}>
                                                        <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: OP_COLORS[i % OP_COLORS.length] }} />
                                                    </div>
                                                    <span style={{ minWidth: 28, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── KPI Card ──
function KpiCard({ icon, label, value, sub, color, bg }: { icon: React.ReactNode; label: string; value: string; sub: string; color: string; bg: string }) {
    return (
        <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-surface)', boxShadow: '0 0 0 1px var(--color-border), 0 2px 8px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <div style={{ width: 30, height: 30, borderRadius: 'var(--radius-md)', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>{icon}</div>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
            </div>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{sub}</div>
        </div>
    );
}
