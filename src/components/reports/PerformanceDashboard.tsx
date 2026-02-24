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

    const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    };

    return (
        <div className="performance-dashboard" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Filters */}
            <div className="flex-between" style={{ background: 'var(--color-bg-surface)', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Filtros de Período</h3>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
                <div style={kpiCardStyle}>
                    <div className="flex-between" style={{ marginBottom: '16px' }}>
                        <span style={kpiLabelStyle}>Taxa de Conversão (Win Rate)</span>
                        <div style={{ ...iconWrapperStyle, background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e' }}>
                            <Target size={20} />
                        </div>
                    </div>
                    <div style={kpiValueStyle}>{metrics.winRate}%</div>
                    <div style={kpiSubStyle}>
                        <span style={{ color: 'var(--color-success)', fontWeight: 500 }}>{metrics.wonCount} Ganhos</span> / {metrics.lostCount} Perdidos
                    </div>
                </div>

                <div style={kpiCardStyle}>
                    <div className="flex-between" style={{ marginBottom: '16px' }}>
                        <span style={kpiLabelStyle}>Montante Ganho</span>
                        <div style={{ ...iconWrapperStyle, background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
                            <Trophy size={20} />
                        </div>
                    </div>
                    <div style={kpiValueStyle}>{formatCurrency(metrics.totalWonValue)}</div>
                    <div style={kpiSubStyle}>Valor consolidado dos processos "Vencidos"</div>
                </div>

                <div style={kpiCardStyle}>
                    <div className="flex-between" style={{ marginBottom: '16px' }}>
                        <span style={kpiLabelStyle}>Total em Jogo (Pipeline)</span>
                        <div style={{ ...iconWrapperStyle, background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
                            <DollarSign size={20} />
                        </div>
                    </div>
                    <div style={kpiValueStyle}>{formatCurrency(metrics.totalInPlayValue)}</div>
                    <div style={kpiSubStyle}>{metrics.ongoingCount} processos em andamento</div>
                </div>
            </div>

            {/* Charts Section */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px' }}>
                {/* Modality Chart */}
                <div style={chartCardStyle}>
                    <div className="flex-between" style={{ marginBottom: '24px' }}>
                        <div className="flex-gap">
                            <FileStack size={18} color="var(--color-primary)" />
                            <h3 style={chartTitleStyle}>Processos por Modalidade</h3>
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
                <div style={chartCardStyle}>
                    <div className="flex-between" style={{ marginBottom: '24px' }}>
                        <div className="flex-gap">
                            <PieIcon size={18} color="var(--color-primary)" />
                            <h3 style={chartTitleStyle}>Distribuição por Status</h3>
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

const chartCardStyle: React.CSSProperties = {
    background: 'var(--color-bg-surface)',
    padding: '24px',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    boxShadow: 'var(--shadow-sm)'
};

const chartTitleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: '0.95rem',
    fontWeight: 600,
    color: 'var(--color-text-primary)'
};

const kpiCardStyle: React.CSSProperties = {
    background: 'var(--color-bg-surface)',
    padding: '24px',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
};

const kpiLabelStyle: React.CSSProperties = {
    color: 'var(--color-text-secondary)',
    fontSize: '0.875rem',
    fontWeight: 500
};

const kpiValueStyle: React.CSSProperties = {
    fontSize: '2rem',
    fontWeight: 700,
    color: 'var(--color-text-primary)',
    marginBottom: '8px'
};

const kpiSubStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    color: 'var(--color-text-tertiary)'
};

const iconWrapperStyle: React.CSSProperties = {
    width: '40px',
    height: '40px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
};
