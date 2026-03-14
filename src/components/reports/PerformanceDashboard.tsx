import { useMemo, useState } from 'react';
import { Target, Trophy, DollarSign, FileStack, PieChart as PieIcon, TrendingUp } from 'lucide-react';
import { BarChart as RBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart as RPieChart, Pie, Legend } from 'recharts';
import type { BiddingProcess } from '../../types';

interface Props {
    biddings: BiddingProcess[];
}

export function PerformanceDashboard({ biddings }: Props) {
    const [periodFilter, setPeriodFilter] = useState<'all' | '30' | '90' | '180'>('all');

    // Filter by period (simulated for now based on sessionDate, assuming sessionDate is YYYY-MM-DD or similar)
    const filteredBiddings = useMemo(() => {
        if (periodFilter === 'all') return biddings;
        const now = new Date();
        const daysToSubtract = parseInt(periodFilter);
        const cutoffDate = new Date(now.getTime() - daysToSubtract * 24 * 60 * 60 * 1000);

        return biddings.filter(b => {
            const sessionDate = new Date(b.sessionDate);
            return sessionDate >= cutoffDate;
        });
    }, [biddings, periodFilter]);

    // Calculate Metrics
    const metrics = useMemo(() => {
        let wonCount = 0;
        let lostCount = 0;
        let totalWonValue = 0;
        let totalInPlayValue = 0;
        let ongoingCount = 0;

        filteredBiddings.forEach(b => {
            if (b.status === 'Vencido') {
                wonCount++;
                totalWonValue += b.estimatedValue;
            } else if (b.status === 'Perdido') {
                lostCount++;
            } else if (['Captado', 'Em Análise de Edital', 'Preparando Documentação', 'Participando'].includes(b.status)) {
                ongoingCount++;
                totalInPlayValue += b.estimatedValue;
            }
        });

        const totalCompleted = wonCount + lostCount;
        const winRate = totalCompleted > 0 ? ((wonCount / totalCompleted) * 100).toFixed(1) : '0.0';

        return {
            winRate,
            wonCount,
            lostCount,
            totalWonValue,
            totalInPlayValue,
            ongoingCount
        };
    }, [filteredBiddings]);

    const chartData = useMemo(() => {
        const modalityMap: Record<string, number> = {};
        const statusMap: Record<string, number> = {};

        filteredBiddings.forEach(b => {
            modalityMap[b.modality] = (modalityMap[b.modality] || 0) + 1;
            statusMap[b.status] = (statusMap[b.status] || 0) + 1;
        });

        const modalities = Object.entries(modalityMap).map(([name, value]) => ({ name, value }));
        const statuses = Object.entries(statusMap).map(([name, value]) => ({ name, value }));

        return { modalities, statuses };
    }, [filteredBiddings]);

    const COLORS = ['var(--color-primary)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-danger)', 'var(--color-ai)', 'var(--color-neutral)'];

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    };

    const PERIOD_OPTIONS = [
        { value: 'all', label: 'Todo período' },
        { value: '30', label: '30 dias' },
        { value: '90', label: '90 dias' },
        { value: '180', label: '180 dias' },
    ];

    const winRateNum = parseFloat(metrics.winRate);
    const totalCompleted = metrics.wonCount + metrics.lostCount;

    return (
        <div className="performance-dashboard" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

            {/* ── Period Filter Bar ── */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'var(--color-bg-surface)', padding: 'var(--space-4) var(--space-5)',
                borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-border)',
                boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', background: 'rgba(37,99,235,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <TrendingUp size={16} color="var(--color-primary)" />
                    </div>
                    <div>
                        <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.1 }}>Painel de Performance Licitatória</div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)' }}>{filteredBiddings.length} processo(s) no período selecionado</div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 3, background: 'var(--color-bg-body)', padding: 3, borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                    {PERIOD_OPTIONS.map(opt => (
                        <button
                            key={opt.value}
                            onClick={() => setPeriodFilter(opt.value as any)}
                            style={{
                                padding: '5px 14px', borderRadius: 'var(--radius-md)',
                                border: 'none', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600,
                                background: periodFilter === opt.value ? 'var(--color-primary)' : 'transparent',
                                color: periodFilter === opt.value ? 'white' : 'var(--color-text-secondary)',
                                transition: 'all 0.15s',
                            }}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── KPI Cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
                {/* Win Rate */}
                <div style={{
                    padding: 'var(--space-5)', borderRadius: 'var(--radius-xl)',
                    border: '1px solid rgba(34,197,94,0.2)', background: 'var(--color-bg-surface)',
                    boxShadow: '0 2px 10px rgba(34,197,94,0.06)',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-tertiary)' }}>Win Rate</div>
                        <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', background: 'var(--color-success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Target size={16} color="var(--color-success)" />
                        </div>
                    </div>
                    <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--color-success)', lineHeight: 1, letterSpacing: '-0.03em', marginBottom: 'var(--space-1)' }}>{metrics.winRate}<span style={{ fontSize: '1.2rem' }}>%</span></div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-3)' }}>
                        <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>{metrics.wonCount} ganhos</span> · {metrics.lostCount} perdidos
                    </div>
                    {totalCompleted > 0 && (
                        <div style={{ height: 4, borderRadius: 9999, background: 'var(--color-bg-body)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${winRateNum}%`, background: 'var(--color-success)', borderRadius: 9999, transition: 'width 0.6s ease' }} />
                        </div>
                    )}
                </div>

                {/* Montante Ganho */}
                <div style={{
                    padding: 'var(--space-5)', borderRadius: 'var(--radius-xl)',
                    border: '1px solid rgba(37,99,235,0.15)', background: 'var(--color-bg-surface)',
                    boxShadow: '0 2px 10px rgba(37,99,235,0.06)',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-tertiary)' }}>Montante Ganho</div>
                        <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Trophy size={16} color="var(--color-primary)" />
                        </div>
                    </div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-primary)', lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: 'var(--space-1)' }}>{formatCurrency(metrics.totalWonValue)}</div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>Valor consolidado · processos vencidos</div>
                </div>

                {/* Pipeline */}
                <div style={{
                    padding: 'var(--space-5)', borderRadius: 'var(--radius-xl)',
                    border: '1px solid rgba(245,158,11,0.18)', background: 'var(--color-bg-surface)',
                    boxShadow: '0 2px 10px rgba(245,158,11,0.06)',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-tertiary)' }}>Pipeline Ativo</div>
                        <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', background: 'var(--color-warning-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <DollarSign size={16} color="var(--color-warning)" />
                        </div>
                    </div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-warning)', lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: 'var(--space-1)' }}>{formatCurrency(metrics.totalInPlayValue)}</div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>{metrics.ongoingCount} processo(s) em andamento</div>
                </div>

                {/* Total analisado */}
                <div style={{
                    padding: 'var(--space-5)', borderRadius: 'var(--radius-xl)',
                    border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-tertiary)' }}>Total Analisado</div>
                        <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', background: 'var(--color-bg-body)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <FileStack size={16} color="var(--color-text-secondary)" />
                        </div>
                    </div>
                    <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1, letterSpacing: '-0.03em', marginBottom: 'var(--space-1)' }}>{filteredBiddings.length}</div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>processos no período</div>
                </div>
            </div>

            {/* ── Charts Section ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 'var(--space-5)' }}>
                {/* Modality Chart */}
                <div style={{ padding: 'var(--space-6)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
                        <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', background: 'rgba(37,99,235,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <FileStack size={16} color="var(--color-primary)" />
                        </div>
                        <div>
                            <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.1 }}>Processos por Modalidade</div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)' }}>Distribuição por tipo de licitação</div>
                        </div>
                    </div>
                    <div style={{ height: 280 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <RBarChart data={chartData.modalities} layout="vertical" margin={{ left: 10, right: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={110} style={{ fontSize: '0.72rem', fill: 'var(--color-text-secondary)' }} />
                                <Tooltip
                                    cursor={{ fill: 'rgba(37,99,235,0.04)' }}
                                    contentStyle={{ borderRadius: '10px', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-md)', fontSize: '0.8rem' }}
                                    formatter={(value) => [`${value ?? 0} processos`, 'Quantidade'] as [string, string]}
                                />
                                <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={18}>
                                    {chartData.modalities.map((_, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Bar>
                            </RBarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Status Chart */}
                <div style={{ padding: 'var(--space-6)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
                        <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', background: 'rgba(37,99,235,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <PieIcon size={16} color="var(--color-primary)" />
                        </div>
                        <div>
                            <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.1 }}>Distribuição por Status</div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)' }}>Proporção do ciclo licitatório</div>
                        </div>
                    </div>
                    <div style={{ height: 280 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <RPieChart>
                                <Pie
                                    data={chartData.statuses}
                                    cx="50%" cy="45%"
                                    innerRadius={72}
                                    outerRadius={96}
                                    paddingAngle={4}
                                    dataKey="value"
                                >
                                    {chartData.statuses.map((_, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ borderRadius: '10px', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-md)', fontSize: '0.8rem' }}
                                />
                                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }} />
                            </RPieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
}
