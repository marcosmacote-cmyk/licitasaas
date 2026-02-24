import React from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    Line, AreaChart, Area, PieChart, Pie, Cell
} from 'recharts';
import { Target, TrendingUp, DollarSign, Award } from 'lucide-react';
import type { BiddingProcess } from '../types';

interface Props {
    items: BiddingProcess[];
}

export function Dashboard({ items }: Props) {
    // 1. KPI Calculations
    const totalValue = items.reduce((acc, curr) => acc + curr.estimatedValue, 0);
    const wonItems = items.filter(i => i.status === 'Vencido');
    const wonValue = wonItems.reduce((acc, curr) => acc + curr.estimatedValue, 0);
    const lostItems = items.filter(i => i.status === 'Perdido');

    const totalFinished = wonItems.length + lostItems.length;
    const winRate = totalFinished > 0 ? Math.round((wonItems.length / totalFinished) * 100) : 0;

    // 2. Data for Status Funnel/Bar Chart
    const statusCounts = items.reduce((acc, curr) => {
        acc[curr.status] = (acc[curr.status] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    const funnelData = [
        { name: 'Captado', count: statusCounts['Captado'] || 0 },
        { name: 'Em Análise', count: statusCounts['Em Análise de Edital'] || 0 },
        { name: 'Preparando', count: statusCounts['Preparando Documentação'] || 0 },
        { name: 'Participando', count: statusCounts['Participando'] || 0 },
        { name: 'Vencido', count: statusCounts['Vencido'] || 0 },
        { name: 'Perdido', count: statusCounts['Perdido'] || 0 },
    ];

    // 3. Data for Modality Donut
    const modalityCounts = items.reduce((acc, curr) => {
        acc[curr.modality] = (acc[curr.modality] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    const modalityData = Object.keys(modalityCounts).map(key => ({
        name: key,
        value: modalityCounts[key]
    }));
    const DONUT_COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

    // 4. Mock Historical Data for Win Rate Line Chart
    const historicalData = [
        { month: 'Set', winRate: 35, wonValue: 1200000 },
        { month: 'Out', winRate: 42, wonValue: 2500000 },
        { month: 'Nov', winRate: 38, wonValue: 1800000 },
        { month: 'Dez', winRate: 55, wonValue: 4200000 },
        { month: 'Jan', winRate: 60, wonValue: 5100000 },
        { month: 'Fev', winRate: 65, wonValue: wonValue }, // Current month roughly
    ];

    return (
        <div className="page-container">
            <div className="page-header">
                <h1 className="page-title">Dashboard Analítico</h1>
                <p className="page-subtitle">Acompanhe as métricas de conversão e volume financeiro.</p>
            </div>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '24px', marginBottom: '24px' }}>
                <KpiCard
                    title="Volume Total no Funil"
                    value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalValue)}
                    icon={<DollarSign size={24} />}
                    color="var(--color-primary)"
                    bg="rgba(139, 92, 246, 0.1)"
                />
                <KpiCard
                    title="Volume Ganho (YTD)"
                    value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(wonValue)}
                    icon={<Award size={24} />}
                    color="#10b981"
                    bg="rgba(16, 185, 129, 0.1)"
                />
                <KpiCard
                    title="Taxa de Conversão (Win Rate)"
                    value={`${winRate}%`}
                    icon={<Target size={24} />}
                    color="#3b82f6"
                    bg="rgba(59, 130, 246, 0.1)"
                    trend="+5% vs último mês"
                />
                <KpiCard
                    title="Processos Ativos"
                    value={(items.length - wonItems.length - lostItems.length).toString()}
                    icon={<TrendingUp size={24} />}
                    color="#f59e0b"
                    bg="rgba(245, 158, 11, 0.1)"
                />
            </div>

            {/* Charts Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px', marginBottom: '24px' }}>

                {/* Main Chart: Funnel / Status Distribution */}
                <div style={chartCardStyle}>
                    <h3 style={chartTitleStyle}>Distribuição por Fase do Funil</h3>
                    <div style={{ width: '100%', height: 300 }}>
                        <ResponsiveContainer>
                            <BarChart data={funnelData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                <XAxis dataKey="name" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', borderRadius: '8px' }}
                                    itemStyle={{ color: 'var(--color-text-primary)' }}
                                />
                                <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} name="Qtd. Processos" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Donut Chart: Modalities */}
                <div style={chartCardStyle}>
                    <h3 style={chartTitleStyle}>Processos por Modalidade</h3>
                    <div style={{ width: '100%', height: 300 }}>
                        <ResponsiveContainer>
                            <PieChart>
                                <Pie
                                    data={modalityData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {modalityData.map((_entry, index) => (
                                        <Cell key={`cell-${index}`} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', borderRadius: '8px' }}
                                    itemStyle={{ color: 'var(--color-text-primary)' }}
                                />
                                <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '12px', color: 'var(--color-text-secondary)' }} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

            </div>

            {/* Full Width Chart: Historical Win Rate */}
            <div style={chartCardStyle}>
                <h3 style={chartTitleStyle}>Evolução da Taxa de Conversão e Volume (Últimos 6 meses)</h3>
                <div style={{ width: '100%', height: 300 }}>
                    <ResponsiveContainer>
                        <AreaChart data={historicalData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <defs>
                                <linearGradient id="colorWinRate" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                            <XAxis dataKey="month" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                            <YAxis yAxisId="left" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                            <Tooltip
                                contentStyle={{ backgroundColor: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', borderRadius: '8px' }}
                                itemStyle={{ color: 'var(--color-text-primary)' }}
                            />
                            <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px', color: 'var(--color-text-secondary)' }} />
                            <Area yAxisId="left" type="monotone" dataKey="winRate" name="Win Rate (%)" stroke="#10b981" fillOpacity={1} fill="url(#colorWinRate)" />
                            <Line yAxisId="right" type="monotone" dataKey="wonValue" name="Volume Ganho (R$)" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

        </div>
    );
}

// Subcomponent for reuse
function KpiCard({ title, value, icon, color, bg, trend }: { title: string, value: string, icon: React.ReactNode, color: string, bg: string, trend?: string }) {
    return (
        <div style={{
            backgroundColor: 'var(--color-bg-surface)',
            padding: '24px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
        }}>
            <div className="flex-between">
                <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', fontWeight: 500 }}>{title}</span>
                <div style={{ color, backgroundColor: bg, padding: '8px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {icon}
                </div>
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {value}
            </div>
            {trend && (
                <div style={{ fontSize: '0.75rem', color: 'var(--color-success)', fontWeight: 500 }}>
                    {trend}
                </div>
            )}
        </div>
    );
}

const chartCardStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-bg-surface)',
    padding: '24px',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
};

const chartTitleStyle: React.CSSProperties = {
    fontSize: '1rem',
    fontWeight: 600,
    color: 'var(--color-text-primary)',
    marginBottom: '24px',
    marginTop: 0
};
