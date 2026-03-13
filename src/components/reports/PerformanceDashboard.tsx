import { useMemo, useState } from 'react';
import { Target, Trophy, DollarSign, FileStack, PieChart as PieIcon } from 'lucide-react';
import { BarChart as RBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart as RPieChart, Pie } from 'recharts';
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

    return (
        <div className="performance-dashboard" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            {/* Filters */}
            <div className="flex-between" style={{ background: 'var(--color-bg-surface)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                <h3 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)' }}>Filtros de Período</h3>
                <div className="flex-gap">
                    <select
                        className="select-input"
                        value={periodFilter}
                        onChange={(e) => setPeriodFilter(e.target.value as any)}
                        style={{ padding: '8px 12px' }}
                    >
                        <option value="all">Todo o Período</option>
                        <option value="30">Últimos 30 dias</option>
                        <option value="90">Últimos 90 dias</option>
                        <option value="180">Últimos 180 dias</option>
                    </select>
                </div>
            </div>

            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-5)' }}>
                <div className="card p-6">
                    <div className="flex-between" style={{ marginBottom: 'var(--space-4)' }}>
                        <span className="kpi-label">Taxa de Conversão (Win Rate)</span>
                        <div className="kpi-icon" style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)' }}>
                            <Target size={20} />
                        </div>
                    </div>
                    <div className="kpi-value">{metrics.winRate}%</div>
                    <div className="kpi-sub">
                        <span style={{ color: 'var(--color-success)', fontWeight: 500 }}>{metrics.wonCount} Ganhos</span> / {metrics.lostCount} Perdidos
                    </div>
                </div>

                <div className="card p-6">
                    <div className="flex-between" style={{ marginBottom: 'var(--space-4)' }}>
                        <span className="kpi-label">Montante Ganho</span>
                        <div className="kpi-icon" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
                            <Trophy size={20} />
                        </div>
                    </div>
                    <div className="kpi-value">{formatCurrency(metrics.totalWonValue)}</div>
                    <div className="kpi-sub">Valor consolidado dos processos "Vencidos"</div>
                </div>

                <div className="card p-6">
                    <div className="flex-between" style={{ marginBottom: 'var(--space-4)' }}>
                        <span className="kpi-label">Total em Jogo (Pipeline)</span>
                        <div className="kpi-icon" style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>
                            <DollarSign size={20} />
                        </div>
                    </div>
                    <div className="kpi-value">{formatCurrency(metrics.totalInPlayValue)}</div>
                    <div className="kpi-sub">{metrics.ongoingCount} processos em andamento</div>
                </div>
            </div>

            {/* Charts Section */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 'var(--space-5)' }}>
                {/* Modality Chart */}
                <div className="card p-6">
                    <div className="flex-between" style={{ marginBottom: '24px' }}>
                        <div className="flex-gap">
                            <FileStack size={18} color="var(--color-primary)" />
                            <h3 className="kpi-label" style={{ margin: 0 }}>Processos por Modalidade</h3>
                        </div>
                    </div>
                    <div style={{ height: '300px', width: '100%' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <RBarChart data={chartData.modalities} layout="vertical" margin={{ left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={100} style={{ fontSize: '0.75rem' }} />
                                <Tooltip
                                    cursor={{ fill: 'var(--color-bg-base)' }}
                                    contentStyle={{ borderRadius: '8px', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-md)' }}
                                />
                                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                                    {chartData.modalities.map((_, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Bar>
                            </RBarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Status Chart */}
                <div className="card p-6">
                    <div className="flex-between" style={{ marginBottom: '24px' }}>
                        <div className="flex-gap">
                            <PieIcon size={18} color="var(--color-primary)" />
                            <h3 className="kpi-label" style={{ margin: 0 }}>Distribuição por Status</h3>
                        </div>
                    </div>
                    <div style={{ height: '300px', width: '100%' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <RPieChart>
                                <Pie
                                    data={chartData.statuses}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={70}
                                    outerRadius={90}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {chartData.statuses.map((_, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ borderRadius: '8px', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-md)' }}
                                />
                            </RPieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
}
