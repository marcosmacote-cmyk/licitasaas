/**
 * ══════════════════════════════════════════════════════════════
 *  AI Usage Dashboard — Painel de Consumo de IA
 * ══════════════════════════════════════════════════════════════
 * 
 * Premium dashboard showing:
 * - Quota gauge (monthly token consumption vs limits)
 * - Daily usage chart (token consumption over time)
 * - Breakdown by operation (which AI features consume most)
 * - Estimated cost in R$
 */

import { useState, useEffect, useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell,
} from 'recharts';
import {
    Cpu, Activity, Zap, DollarSign, TrendingUp,
    AlertTriangle, Loader2, RefreshCw, Calendar,
    BarChart3, PieChart as PieChartIcon, Shield,
} from 'lucide-react';
import { API_BASE_URL } from '../../config';

// ── Types ──

interface DailyData {
    date: string;
    calls: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    costBRL: number;
}

interface OperationData {
    operation: string;
    calls: number;
    tokens: number;
}

interface QuotaData {
    currentTokens: number;
    softLimit: number;
    hardLimit: number;
    percentUsed: number;
    status: 'ok' | 'warning' | 'critical';
    estimatedCostBRL: number;
    daysRemainingInMonth: number;
}

interface UsageData {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    avgDurationMs: number;
    errorRate: number;
    byOperation: OperationData[];
    daily: DailyData[];
    quota: QuotaData;
}

// ── Operation Label Map ──
const OPERATION_LABELS: Record<string, string> = {
    'analysis': 'Análise de Editais',
    'ai_chat': 'Chat IA',
    'proposal_letter': 'Carta Proposta',
    'proposal_populate': 'Preenchimento Proposta',
    'proposal_composition': 'Composição Proposta',
    'oracle_analysis': 'Oráculo de Acervos',
    'petition': 'Petição / Recurso',
    'dossier_match': 'Dossiê Técnico',
    'generate_declaration': 'Declarações',
    'repair_declaration': 'Reparo Declarações',
    'process_document': 'Processamento Docs',
    'compare_certificates': 'Comparação Atestados',
};

const OPERATION_COLORS = [
    '#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626',
    '#8b5cf6', '#0891b2', '#65a30d', '#ea580c', '#e11d48',
    '#6366f1', '#14b8a6',
];

// ── Main Component ──

export function AiUsageDashboard() {
    const [data, setData] = useState<UsageData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [period, setPeriod] = useState(30);

    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
    };

    const fetchData = async (days: number) => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`${API_BASE_URL}/api/admin/ai-usage?period=${days}`, { headers });
            if (!res.ok) throw new Error('Falha ao carregar dados');
            const json = await res.json();
            setData(json);
        } catch (e: any) {
            setError(e.message || 'Erro desconhecido');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData(period);
    }, [period]);

    const fmtTokens = (n: number) => {
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
        return n.toString();
    };

    const fmtBRL = (n: number) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

    // Chart data — abbreviate dates
    const chartData = useMemo(() => {
        if (!data?.daily) return [];
        return data.daily.map(d => ({
            ...d,
            label: new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        }));
    }, [data?.daily]);

    // Pie data for operations
    const pieData = useMemo(() => {
        if (!data?.byOperation) return [];
        return data.byOperation.map((op, i) => ({
            name: OPERATION_LABELS[op.operation] || op.operation,
            value: op.tokens,
            calls: op.calls,
            color: OPERATION_COLORS[i % OPERATION_COLORS.length],
        }));
    }, [data?.byOperation]);

    if (loading && !data) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-10)', gap: 'var(--space-3)' }}>
                <Loader2 size={20} className="spinner" style={{ color: 'var(--color-ai)' }} />
                <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>Carregando consumo de IA...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{
                padding: 'var(--space-6)', textAlign: 'center',
                color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)',
            }}>
                <AlertTriangle size={24} style={{ opacity: 0.3, marginBottom: 'var(--space-2)' }} />
                <p>{error}</p>
                <button className="btn btn-outline" onClick={() => fetchData(period)} style={{ fontSize: 'var(--text-sm)' }}>
                    <RefreshCw size={14} /> Tentar novamente
                </button>
            </div>
        );
    }

    if (!data) return null;

    const quotaColor = data.quota.status === 'critical' ? 'var(--color-danger)' :
                       data.quota.status === 'warning' ? 'var(--color-warning)' : 'var(--color-success)';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

            {/* ─── Header + Period Selector ─── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    {loading && <Loader2 size={14} className="spinner" style={{ color: 'var(--color-ai)' }} />}
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <Calendar size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                    {[7, 15, 30].map(d => (
                        <button
                            key={d}
                            onClick={() => setPeriod(d)}
                            style={{
                                padding: '4px 12px',
                                borderRadius: 'var(--radius-md)',
                                border: 'none',
                                fontSize: 'var(--text-sm)',
                                fontWeight: period === d ? 600 : 400,
                                cursor: 'pointer',
                                background: period === d ? 'var(--color-ai)' : 'var(--color-bg-surface-hover)',
                                color: period === d ? 'white' : 'var(--color-text-secondary)',
                                transition: 'all 0.15s',
                            }}
                        >
                            {d}d
                        </button>
                    ))}
                    <button
                        onClick={() => fetchData(period)}
                        style={{
                            padding: '4px 8px', borderRadius: 'var(--radius-md)',
                            border: 'none', background: 'transparent', cursor: 'pointer',
                            color: 'var(--color-text-tertiary)', display: 'flex',
                        }}
                        title="Atualizar"
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>
            </div>

            {/* ─── KPI Cards ─── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 'var(--space-3)' }}>
                <KpiCard
                    icon={<Cpu size={18} />}
                    label="Tokens Totais"
                    value={fmtTokens(data.totalTokens)}
                    sub={`${fmtTokens(data.totalInputTokens)} in · ${fmtTokens(data.totalOutputTokens)} out`}
                    color="var(--color-ai)"
                    bg="var(--color-ai-bg)"
                />
                <KpiCard
                    icon={<Activity size={18} />}
                    label="Chamadas IA"
                    value={data.totalCalls.toLocaleString('pt-BR')}
                    sub={`${data.avgDurationMs}ms médio`}
                    color="var(--color-primary)"
                    bg="var(--color-primary-light)"
                />
                <KpiCard
                    icon={<DollarSign size={18} />}
                    label="Custo Estimado"
                    value={fmtBRL(data.quota.estimatedCostBRL)}
                    sub={`mês atual (${data.quota.daysRemainingInMonth}d restantes)`}
                    color="#059669"
                    bg="rgba(5,150,105,0.08)"
                />
                <KpiCard
                    icon={<Zap size={18} />}
                    label="Taxa de Erro"
                    value={`${data.errorRate}%`}
                    sub={data.errorRate === 0 ? 'sem falhas no período' : 'chamadas com erro'}
                    color={data.errorRate > 5 ? 'var(--color-danger)' : 'var(--color-success)'}
                    bg={data.errorRate > 5 ? 'rgba(220,38,38,0.06)' : 'rgba(5,150,105,0.08)'}
                />
            </div>

            {/* ─── Quota Gauge ─── */}
            <div style={{
                padding: 'var(--space-5)',
                borderRadius: 'var(--radius-xl)',
                background: 'var(--color-bg-surface)',
                boxShadow: '0 0 0 1px var(--color-border), 0 2px 12px rgba(0,0,0,0.04)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                    <Shield size={16} style={{ color: quotaColor }} />
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Cota Mensal
                    </span>
                    <span style={{
                        marginLeft: 'auto',
                        fontSize: 'var(--text-xs)', fontWeight: 600,
                        padding: '2px 8px', borderRadius: 'var(--radius-lg)',
                        background: `${quotaColor}15`,
                        color: quotaColor,
                    }}>
                        {data.quota.status === 'critical' ? 'LIMITE ATINGIDO' :
                         data.quota.status === 'warning' ? 'ATENÇÃO' : 'NORMAL'}
                    </span>
                </div>

                {/* Gauge bar */}
                <div style={{ position: 'relative', marginBottom: 'var(--space-3)' }}>
                    <div style={{
                        height: 12, borderRadius: 9999,
                        background: 'var(--color-bg-surface-hover)',
                        overflow: 'hidden',
                    }}>
                        <div style={{
                            height: '100%', borderRadius: 9999,
                            width: `${Math.min(100, data.quota.percentUsed)}%`,
                            background: `linear-gradient(90deg, ${quotaColor}, ${quotaColor}cc)`,
                            transition: 'width 0.6s ease-out',
                            boxShadow: data.quota.percentUsed > 50 ? `0 0 12px ${quotaColor}40` : 'none',
                        }} />
                    </div>
                    {/* Soft limit marker */}
                    {data.quota.hardLimit > 0 && (
                        <div style={{
                            position: 'absolute',
                            left: `${(data.quota.softLimit / data.quota.hardLimit) * 100}%`,
                            top: -2, bottom: -2,
                            width: 2,
                            background: 'var(--color-warning)',
                            borderRadius: 1,
                            opacity: 0.6,
                        }} />
                    )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
                    <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                        {fmtTokens(data.quota.currentTokens)} / {fmtTokens(data.quota.hardLimit)}
                    </span>
                    <span style={{ color: quotaColor, fontWeight: 700, fontSize: 'var(--text-md)' }}>
                        {data.quota.percentUsed}%
                    </span>
                </div>

                {/* Quota legend */}
                <div style={{ display: 'flex', gap: 'var(--space-5)', marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--color-warning)', opacity: 0.6 }} />
                        Soft limit ({fmtTokens(data.quota.softLimit)})
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--color-danger)' }} />
                        Hard limit ({fmtTokens(data.quota.hardLimit)})
                    </span>
                </div>
            </div>

            {/* ─── MAIN GRID: Chart + Operations ─── */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-4)' }}>

                {/* Daily Usage Chart */}
                <div style={{
                    padding: 'var(--space-5)',
                    borderRadius: 'var(--radius-xl)',
                    background: 'var(--color-bg-surface)',
                    boxShadow: '0 0 0 1px var(--color-border), 0 2px 12px rgba(0,0,0,0.04)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                        <BarChart3 size={16} style={{ color: 'var(--color-ai)' }} />
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Consumo Diário
                        </span>
                    </div>
                    <div style={{ width: '100%', height: 220 }}>
                        <ResponsiveContainer>
                            <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                <XAxis
                                    dataKey="label"
                                    interval={period <= 7 ? 0 : period <= 15 ? 1 : 'preserveStartEnd'}
                                    tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
                                    axisLine={false} tickLine={false}
                                />
                                <YAxis
                                    tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
                                    axisLine={false} tickLine={false}
                                    tickFormatter={fmtTokens}
                                />
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: 'var(--color-bg-surface)',
                                        borderColor: 'var(--color-border)',
                                        borderRadius: 'var(--radius-md)',
                                        fontSize: 'var(--text-sm)',
                                    }}
                                    formatter={(value?: number, name?: string) => {
                                        const v = value ?? 0;
                                        if (name === 'tokens') return [fmtTokens(v), 'Tokens'];
                                        if (name === 'calls') return [v, 'Chamadas'];
                                        return [v, name || ''];
                                    }}
                                    labelFormatter={(l) => `${l}`}
                                />
                                <Bar dataKey="tokens" fill="var(--color-ai)" radius={[3, 3, 0, 0]} opacity={0.85} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Operations Breakdown */}
                <div style={{
                    padding: 'var(--space-5)',
                    borderRadius: 'var(--radius-xl)',
                    background: 'var(--color-bg-surface)',
                    boxShadow: '0 0 0 1px var(--color-border), 0 2px 12px rgba(0,0,0,0.04)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                        <PieChartIcon size={16} style={{ color: 'var(--color-primary)' }} />
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Por Funcionalidade
                        </span>
                    </div>

                    {pieData.length > 0 ? (
                        <>
                            <div style={{ width: '100%', height: 130, marginBottom: 'var(--space-2)' }}>
                                <ResponsiveContainer>
                                    <PieChart>
                                        <Pie
                                            data={pieData}
                                            dataKey="value"
                                            nameKey="name"
                                            cx="50%" cy="50%"
                                            innerRadius={35} outerRadius={55}
                                            paddingAngle={2}
                                            strokeWidth={0}
                                        >
                                            {pieData.map((entry, i) => (
                                                <Cell key={i} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: 'var(--color-bg-surface)',
                                                borderColor: 'var(--color-border)',
                                                borderRadius: 'var(--radius-md)',
                                                fontSize: 'var(--text-xs)',
                                            }}
                                            formatter={(value?: number) => [fmtTokens(value ?? 0), 'Tokens']}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Legend list */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                                {pieData.slice(0, 6).map((op, i) => (
                                    <div key={i} style={{
                                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                        padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                                        fontSize: 'var(--text-xs)',
                                    }}>
                                        <span style={{
                                            width: 8, height: 8, borderRadius: 2,
                                            background: op.color, flexShrink: 0,
                                        }} />
                                        <span style={{ flex: 1, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {op.name}
                                        </span>
                                        <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                                            {fmtTokens(op.value)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div style={{ textAlign: 'center', padding: 'var(--space-8) 0', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>
                            <TrendingUp size={24} style={{ opacity: 0.2, marginBottom: 'var(--space-2)' }} />
                            <p style={{ margin: 0 }}>Sem dados no período selecionado.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* ─── Operations Table ─── */}
            {data.byOperation.length > 0 && (
                <div style={{
                    borderRadius: 'var(--radius-xl)',
                    background: 'var(--color-bg-surface)',
                    boxShadow: '0 0 0 1px var(--color-border), 0 2px 12px rgba(0,0,0,0.04)',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        padding: 'var(--space-4) var(--space-5)',
                        borderBottom: '1px solid var(--color-border)',
                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    }}>
                        <Activity size={16} style={{ color: 'var(--color-primary)' }} />
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Detalhamento por Operação
                        </span>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <th style={thStyle}>Operação</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Chamadas</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Tokens</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>% do Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.byOperation.map((op, i) => {
                                const pct = data.totalTokens > 0 ? Math.round((op.tokens / data.totalTokens) * 100) : 0;
                                return (
                                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={tdStyle}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                                <span style={{
                                                    width: 8, height: 8, borderRadius: 2,
                                                    background: OPERATION_COLORS[i % OPERATION_COLORS.length],
                                                    flexShrink: 0,
                                                }} />
                                                {OPERATION_LABELS[op.operation] || op.operation}
                                            </div>
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                            {op.calls.toLocaleString('pt-BR')}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                                            {fmtTokens(op.tokens)}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                                                <div style={{
                                                    width: 40, height: 4, borderRadius: 2,
                                                    background: 'var(--color-bg-surface-hover)',
                                                    overflow: 'hidden',
                                                }}>
                                                    <div style={{
                                                        height: '100%', borderRadius: 2,
                                                        width: `${pct}%`,
                                                        background: OPERATION_COLORS[i % OPERATION_COLORS.length],
                                                    }} />
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
            )}
        </div>
    );
}

// ── Helper Components ──

function KpiCard({ icon, label, value, sub, color, bg }: {
    icon: React.ReactNode;
    label: string;
    value: string;
    sub: string;
    color: string;
    bg: string;
}) {
    return (
        <div style={{
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-bg-surface)',
            boxShadow: '0 0 0 1px var(--color-border), 0 2px 8px rgba(0,0,0,0.03)',
            display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <div style={{
                    width: 30, height: 30,
                    borderRadius: 'var(--radius-md)',
                    background: bg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color,
                    flexShrink: 0,
                }}>
                    {icon}
                </div>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    {label}
                </span>
            </div>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {value}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                {sub}
            </div>
        </div>
    );
}

// ── Styles ──

const thStyle: React.CSSProperties = {
    padding: '10px 20px',
    fontSize: '0.6875rem',
    fontWeight: 700,
    color: 'var(--color-text-tertiary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    textAlign: 'left',
};

const tdStyle: React.CSSProperties = {
    padding: '10px 20px',
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-secondary)',
};
