import { useMemo, useState } from 'react';
import { Target, Trophy, DollarSign, FileStack, PieChart as PieIcon, TrendingUp, BarChart2 } from 'lucide-react';
import { BarChart as RBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart as RPieChart, Pie, Legend } from 'recharts';
import type { BiddingProcess } from '../../types';
import { resolveStage } from '../../governance';

interface Props {
    biddings: BiddingProcess[];
}

export function PerformanceDashboard({ biddings }: Props) {
    const [periodFilter, setPeriodFilter] = useState<'all' | '30' | '90' | '180'>('all');

    const filteredBiddings = useMemo(() => {
        if (periodFilter === 'all') return biddings;
        const now = new Date();
        const daysToSubtract = parseInt(periodFilter);
        const cutoffDate = new Date(now.getTime() - daysToSubtract * 24 * 60 * 60 * 1000);
        return biddings.filter(b => new Date(b.sessionDate) >= cutoffDate);
    }, [biddings, periodFilter]);

    const metrics = useMemo(() => {
        let wonCount = 0;
        let lostCount = 0;
        let totalWonValue = 0;
        let totalInPlayValue = 0;
        let ongoingCount = 0;

        filteredBiddings.forEach(b => {
            const stage = resolveStage(b.status);
            if (stage === 'Ganho') {
                wonCount++;
                totalWonValue += b.estimatedValue;
            } else if (stage === 'Perdido' || stage === 'Não Participar') {
                lostCount++;
            } else if (!['Ganho', 'Perdido', 'Não Participar', 'Arquivado'].includes(stage)) {
                ongoingCount++;
                totalInPlayValue += b.estimatedValue;
            }
        });

        const totalCompleted = wonCount + lostCount;
        const winRate = totalCompleted > 0 ? ((wonCount / totalCompleted) * 100).toFixed(1) : '0.0';
        return { winRate, wonCount, lostCount, totalWonValue, totalInPlayValue, ongoingCount };
    }, [filteredBiddings]);

    const chartData = useMemo(() => {
        const modalityMap: Record<string, number> = {};
        const statusMap: Record<string, number> = {};
        filteredBiddings.forEach(b => {
            modalityMap[b.modality] = (modalityMap[b.modality] || 0) + 1;
            statusMap[b.status] = (statusMap[b.status] || 0) + 1;
        });
        return {
            modalities: Object.entries(modalityMap).map(([name, value]) => ({ name, value })),
            statuses: Object.entries(statusMap).map(([name, value]) => ({ name, value })),
        };
    }, [filteredBiddings]);

    const COLORS = ['#2563eb', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];

    const formatCurrency = (value: number) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

    const PERIOD_OPTIONS = [
        { value: 'all', label: 'Todo período' },
        { value: '30', label: '30 dias' },
        { value: '90', label: '90 dias' },
        { value: '180', label: '180 dias' },
    ];

    const winRateNum = parseFloat(metrics.winRate);
    const totalCompleted = metrics.wonCount + metrics.lostCount;
    const totalInPlay = filteredBiddings.length > 0 ? Math.round((metrics.ongoingCount / filteredBiddings.length) * 100) : 0;

    // ── tooltip shared style ──
    const tooltipStyle = {
        borderRadius: '10px',
        border: 'none',
        boxShadow: '0 0 0 1px var(--color-border), 0 4px 16px rgba(0,0,0,0.12)',
        fontSize: '0.8rem',
        background: 'var(--color-bg-surface)',
        color: 'var(--color-text-primary)',
    };

    return (
        <div className="performance-dashboard" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

            {/* ══════════════════════════════════
                Executive Header Bar
            ══════════════════════════════════ */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'linear-gradient(135deg, var(--color-bg-surface) 0%, rgba(37,99,235,0.03) 60%, rgba(139,92,246,0.02) 100%)',
                padding: 'var(--space-5) var(--space-6)',
                borderRadius: 'var(--radius-xl)',
                border: 'none',
                boxShadow: '0 0 0 1px rgba(37,99,235,0.12), 0 2px 12px rgba(37,99,235,0.06)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                    <div style={{
                        width: 44, height: 44, borderRadius: 'var(--radius-lg)',
                        background: 'linear-gradient(135deg, rgba(37,99,235,0.12), rgba(99,102,241,0.08))',
                        border: 'none', boxShadow: '0 0 0 1px rgba(37,99,235,0.2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                    }}>
                        <TrendingUp size={20} color="var(--color-primary)" strokeWidth={2} />
                    </div>
                    <div>
                        <div style={{
                            fontSize: 'var(--text-xl)', fontWeight: 800,
                            color: 'var(--color-text-primary)',
                            lineHeight: 1.1, letterSpacing: '-0.025em',
                        }}>
                            Performance Licitatória
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                            <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{filteredBiddings.length}</span> processo(s) analisados no período · taxa de conversão&nbsp;
                            <span style={{ color: metrics.winRate !== '0.0' ? 'var(--color-success)' : 'var(--color-text-tertiary)', fontWeight: 600 }}>{metrics.winRate}%</span>
                        </div>
                    </div>
                </div>

                {/* Period pill selector */}
                <div style={{
                    display: 'flex', gap: 3,
                    background: 'var(--color-bg-body)', padding: 3,
                    borderRadius: 'var(--radius-lg)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)',
                }}>
                    {PERIOD_OPTIONS.map(opt => (
                        <button
                            key={opt.value}
                            onClick={() => setPeriodFilter(opt.value as any)}
                            style={{
                                padding: '6px 16px', borderRadius: 'var(--radius-md)',
                                border: 'none', cursor: 'pointer',
                                fontSize: 'var(--text-sm)', fontWeight: 600,
                                background: periodFilter === opt.value
                                    ? 'linear-gradient(135deg, var(--color-primary), rgba(99,102,241,0.9))'
                                    : 'transparent',
                                color: periodFilter === opt.value ? 'white' : 'var(--color-text-secondary)',
                                boxShadow: periodFilter === opt.value ? '0 2px 8px rgba(37,99,235,0.3)' : 'none',
                                transition: 'all 0.15s',
                            }}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ══════════════════════════════════
                KPI Cards
            ══════════════════════════════════ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>

                {/* Win Rate — destaque verde */}
                <KpiCard
                    label="Win Rate"
                    icon={<Target size={17} color="#22c55e" />}
                    iconBg="rgba(34,197,94,0.1)"
                    iconBorder="rgba(34,197,94,0.2)"
                    borderColor="rgba(34,197,94,0.22)"
                    shadowColor="rgba(34,197,94,0.08)"
                >
                    <div style={{ fontSize: '2.8rem', fontWeight: 800, color: '#22c55e', lineHeight: 1, letterSpacing: '-0.04em', marginBottom: 4 }}>
                        {metrics.winRate}<span style={{ fontSize: '1.4rem', fontWeight: 700 }}>%</span>
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-3)' }}>
                        <span style={{ color: '#22c55e', fontWeight: 700 }}>{metrics.wonCount} ganhos</span>
                        {totalCompleted > 0 && <> · <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>{metrics.lostCount} perdidos</span></>}
                    </div>
                    {totalCompleted > 0 && (
                        <ProgressBar value={winRateNum} color="#22c55e" />
                    )}
                </KpiCard>

                {/* Montante Ganho */}
                <KpiCard
                    label="Montante Ganho"
                    icon={<Trophy size={17} color="var(--color-primary)" />}
                    iconBg="rgba(37,99,235,0.1)"
                    iconBorder="rgba(37,99,235,0.2)"
                    borderColor="rgba(37,99,235,0.15)"
                    shadowColor="rgba(37,99,235,0.06)"
                >
                    <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--color-primary)', lineHeight: 1.1, letterSpacing: '-0.025em', marginBottom: 4 }}>
                        {formatCurrency(metrics.totalWonValue)}
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-3)' }}>
                        Consolidado · processos vencidos
                    </div>
                    <ProgressBar value={totalCompleted > 0 ? (metrics.wonCount / totalCompleted) * 100 : 0} color="var(--color-primary)" />
                </KpiCard>

                {/* Pipeline Ativo */}
                <KpiCard
                    label="Pipeline Ativo"
                    icon={<DollarSign size={17} color="#f59e0b" />}
                    iconBg="rgba(245,158,11,0.1)"
                    iconBorder="rgba(245,158,11,0.2)"
                    borderColor="rgba(245,158,11,0.18)"
                    shadowColor="rgba(245,158,11,0.06)"
                >
                    <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f59e0b', lineHeight: 1.1, letterSpacing: '-0.025em', marginBottom: 4 }}>
                        {formatCurrency(metrics.totalInPlayValue)}
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-3)' }}>
                        {metrics.ongoingCount} processo(s) em andamento
                    </div>
                    <ProgressBar value={totalInPlay} color="#f59e0b" />
                </KpiCard>

                {/* Total Analisado */}
                <KpiCard
                    label="Total Analisado"
                    icon={<FileStack size={17} color="var(--color-text-secondary)" />}
                    iconBg="var(--color-bg-body)"
                    iconBorder="var(--color-border)"
                    borderColor="var(--color-border)"
                    shadowColor="rgba(0,0,0,0.03)"
                >
                    <div style={{ fontSize: '2.8rem', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1, letterSpacing: '-0.04em', marginBottom: 4 }}>
                        {filteredBiddings.length}
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-3)' }}>
                        processos no período
                    </div>
                    <ProgressBar value={100} color="var(--color-border)" />
                </KpiCard>
            </div>

            {/* ══════════════════════════════════
                Section Divider
            ══════════════════════════════════ */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 14px', borderRadius: 9999,
                    background: 'var(--color-bg-surface)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)',
                    fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.1em', color: 'var(--color-text-tertiary)',
                }}>
                    <BarChart2 size={11} />
                    Análise Gráfica
                </div>
                <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
            </div>

            {/* ══════════════════════════════════
                Charts Section
            ══════════════════════════════════ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 'var(--space-5)' }}>

                {/* Modality Bar Chart */}
                <div style={{
                    borderRadius: 'var(--radius-xl)', border: 'none',
                    background: 'var(--color-bg-surface)',
                    boxShadow: '0 0 0 1px var(--color-border), 0 2px 12px rgba(0,0,0,0.04)',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                        padding: 'var(--space-5) var(--space-6)',
                        borderBottom: '1px solid var(--color-border)',
                        background: 'linear-gradient(135deg, rgba(37,99,235,0.03), transparent)',
                    }}>
                        <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', background: 'rgba(37,99,235,0.08)', border: 'none', boxShadow: '0 0 0 1px rgba(37,99,235,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <FileStack size={16} color="var(--color-primary)" />
                        </div>
                        <div>
                            <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.1, letterSpacing: '-0.015em' }}>
                                Processos por Modalidade
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)', marginTop: 1 }}>
                                Distribuição por tipo de licitação
                            </div>
                        </div>
                    </div>
                    <div style={{ padding: 'var(--space-5)', height: 290 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <RBarChart data={chartData.modalities} layout="vertical" margin={{ left: 4, right: 24, top: 4, bottom: 4 }}>
                                <CartesianGrid strokeDasharray="2 4" horizontal={false} stroke="var(--color-border)" />
                                <XAxis type="number" hide />
                                <YAxis
                                    dataKey="name" type="category" width={114}
                                    style={{ fontSize: '0.71rem' }}
                                    tick={{ fill: 'var(--color-text-secondary)' }}
                                />
                                <Tooltip
                                    cursor={{ fill: 'rgba(37,99,235,0.04)', rx: 4 }}
                                    contentStyle={tooltipStyle}
                                    formatter={(value) => [`${value ?? 0} processos`, 'Quantidade'] as [string, string]}
                                />
                                <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>
                                    {chartData.modalities.map((_, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Bar>
                            </RBarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Status Donut Chart */}
                <div style={{
                    borderRadius: 'var(--radius-xl)', border: 'none',
                    background: 'var(--color-bg-surface)',
                    boxShadow: '0 0 0 1px var(--color-border), 0 2px 12px rgba(0,0,0,0.04)',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                        padding: 'var(--space-5) var(--space-6)',
                        borderBottom: '1px solid var(--color-border)',
                        background: 'linear-gradient(135deg, rgba(37,99,235,0.03), transparent)',
                    }}>
                        <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', background: 'rgba(37,99,235,0.08)', border: 'none', boxShadow: '0 0 0 1px rgba(37,99,235,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <PieIcon size={16} color="var(--color-primary)" />
                        </div>
                        <div>
                            <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.1, letterSpacing: '-0.015em' }}>
                                Distribuição por Status
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)', marginTop: 1 }}>
                                Proporção do ciclo licitatório
                            </div>
                        </div>
                    </div>
                    <div style={{ padding: 'var(--space-5)', height: 290 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <RPieChart>
                                <Pie
                                    data={chartData.statuses}
                                    cx="50%" cy="44%"
                                    innerRadius={74}
                                    outerRadius={100}
                                    paddingAngle={3}
                                    dataKey="value"
                                    strokeWidth={2}
                                >
                                    {chartData.statuses.map((_, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="var(--color-bg-surface)" />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={tooltipStyle} />
                                <Legend
                                    iconType="circle" iconSize={8}
                                    wrapperStyle={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', paddingTop: 8 }}
                                />
                            </RPieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── KpiCard ──────────────────────────────────────────
function KpiCard({
    label, icon, iconBg, iconBorder, borderColor, shadowColor, children
}: {
    label: string;
    icon: React.ReactNode;
    iconBg: string;
    iconBorder: string;
    borderColor: string;
    shadowColor: string;
    children: React.ReactNode;
}) {
    return (
        <div style={{
            padding: 'var(--space-5)', borderRadius: 'var(--radius-xl)',
            border: 'none',
            background: 'var(--color-bg-surface)',
            boxShadow: `0 0 0 1px ${borderColor}, 0 2px 12px ${shadowColor}`,
            display: 'flex', flexDirection: 'column',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)' }}>
                    {label}
                </div>
                <div style={{
                    width: 30, height: 30, borderRadius: 'var(--radius-md)',
                    background: iconBg, border: 'none', boxShadow: `0 0 0 1px ${iconBorder}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                    {icon}
                </div>
            </div>
            {children}
        </div>
    );
}

// ── ProgressBar ──────────────────────────────────────
function ProgressBar({ value, color }: { value: number; color: string }) {
    return (
        <div style={{ height: 3, borderRadius: 9999, background: 'var(--color-bg-body)', overflow: 'hidden' }}>
            <div style={{
                height: '100%',
                width: `${Math.min(100, Math.max(0, value))}%`,
                background: color,
                borderRadius: 9999,
                transition: 'width 0.6s ease',
            }} />
        </div>
    );
}
