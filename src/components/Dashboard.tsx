import React, { useState, useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    Line, AreaChart, Area
} from 'recharts';
import { Target, TrendingUp, DollarSign, Award, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Bell, Clock, Search, Zap } from 'lucide-react';
import type { BiddingProcess } from '../types';

interface Props {
    items: BiddingProcess[];
}

export function Dashboard({ items }: Props) {
    // State for Calendar
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(new Date());

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

    // 3. Mock Historical Data for Win Rate Line Chart
    const historicalData = [
        { month: 'Set', winRate: 35, wonValue: Math.max(0, wonValue * 0.2) },
        { month: 'Out', winRate: 42, wonValue: Math.max(0, wonValue * 0.4) },
        { month: 'Nov', winRate: 38, wonValue: Math.max(0, wonValue * 0.5) },
        { month: 'Dez', winRate: 55, wonValue: Math.max(0, wonValue * 0.7) },
        { month: 'Jan', winRate: 60, wonValue: Math.max(0, wonValue * 0.9) },
        { month: 'Fev', winRate: winRate || 65, wonValue: wonValue }, // Current month roughly
    ];

    // --- CALENDAR LOGIC ---
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay();

    const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
    const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));

    // Map events
    const processEvents = useMemo(() => {
        const events: Record<string, { sessions: BiddingProcess[], reminders: BiddingProcess[] }> = {};

        items.forEach(item => {
            if (item.sessionDate) {
                const dateKey = new Date(item.sessionDate).toISOString().split('T')[0];
                if (!events[dateKey]) events[dateKey] = { sessions: [], reminders: [] };
                events[dateKey].sessions.push(item);
            }
            if (item.reminderDate && item.reminderStatus === 'pending') {
                const dateKey = new Date(item.reminderDate).toISOString().split('T')[0];
                if (!events[dateKey]) events[dateKey] = { sessions: [], reminders: [] };
                events[dateKey].reminders.push(item);
            }
        });
        return events;
    }, [items]);

    const selectedDateKey = new Date(selectedDate.getTime() - (selectedDate.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    const todayStr = new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    const selectedEvents = processEvents[selectedDateKey] || { sessions: [], reminders: [] };

    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    // --- RADAR MOCK DATA ---
    const pncpCount = items.filter(i => i.portal === 'PNCP').length;
    const aiCount = items.filter(i => i.aiAnalysis).length;

    return (
        <div className="page-container" style={{ maxWidth: '1400px', margin: '0 auto' }}>
            <div className="page-header">
                <h1 className="page-title">Command Center</h1>
                <p className="page-subtitle">Acompanhe métricas, eventos e o panorama das ferramentas em tempo real.</p>
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', marginBottom: '24px', '@media (minWidth: 1024px)': { gridTemplateColumns: '7fr 5fr' } } as any}>

                {/* LEFT COLUMN: CHARTS AND SYSTEM RADAR */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', flex: 1 }}>

                    {/* RADAR DO SISTEMA */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                        <RadarCard
                            icon={<Search size={20} color="#3b82f6" />}
                            title="Radar PNCP"
                            subtitle={`${pncpCount} licitações`}
                            desc="captadas do Portal de Compras nos últimos 30 dias."
                            bg="rgba(59, 130, 246, 0.1)"
                        />
                        <RadarCard
                            icon={<Zap size={20} color="#8b5cf6" />}
                            title="LicitIA (Análises)"
                            subtitle={`${aiCount} editais`}
                            desc="fatiados e resumidos (aprox. 18h de leitura poupadas)."
                            bg="rgba(139, 92, 246, 0.1)"
                        />
                        <RadarCard
                            icon={<Clock size={20} color="#ef4444" />}
                            title="Validade de Certidões"
                            subtitle="1 Alerta Crítico"
                            desc="CND Municipal requer atenção (vence em breve)."
                            bg="rgba(239, 68, 68, 0.1)"
                        />
                    </div>

                    {/* CHARTS */}
                    <div style={chartCardStyle}>
                        <h3 style={chartTitleStyle}>Distribuição por Fase do Funil</h3>
                        <div style={{ width: '100%', height: 250 }}>
                            <ResponsiveContainer>
                                <BarChart data={funnelData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                    <XAxis dataKey="name" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <Tooltip contentStyle={{ backgroundColor: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', borderRadius: '8px' }} itemStyle={{ color: 'var(--color-text-primary)' }} />
                                    <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div style={chartCardStyle}>
                        <h3 style={chartTitleStyle}>Evolução de Conversão (6 meses)</h3>
                        <div style={{ width: '100%', height: 260 }}>
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
                                    <Tooltip contentStyle={{ backgroundColor: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', borderRadius: '8px' }} itemStyle={{ color: 'var(--color-text-primary)' }} />
                                    <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px', color: 'var(--color-text-secondary)' }} />
                                    <Area yAxisId="left" type="monotone" dataKey="winRate" name="Win Rate (%)" stroke="#10b981" fillOpacity={1} fill="url(#colorWinRate)" />
                                    <Line yAxisId="right" type="monotone" dataKey="wonValue" name="Volume Ganho (R$)" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                </div>

                {/* RIGHT COLUMN: CALENDAR & AGENDA */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', flex: 1 }}>
                    <div style={chartCardStyle}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h3 style={{ ...chartTitleStyle, marginBottom: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <CalendarIcon size={20} color="var(--color-primary)" />
                                Calendário de Missões
                            </h3>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <button onClick={prevMonth} style={calendarBtnStyle}><ChevronLeft size={16} /></button>
                                <span style={{ fontSize: '14px', fontWeight: 600, minWidth: '120px', textAlign: 'center' }}>
                                    {monthNames[month]} {year}
                                </span>
                                <button onClick={nextMonth} style={calendarBtnStyle}><ChevronRight size={16} /></button>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', marginBottom: '8px' }}>
                            {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
                                <div key={i} style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{d}</div>
                            ))}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                            {Array.from({ length: firstDayOfMonth }).map((_, i) => <div key={`empty-${i}`} />)}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                const d = i + 1;
                                const dateObj = new Date(year, month, d);
                                // Format locally avoiding timezone shifting to prior day
                                const dateKey = new Date(dateObj.getTime() - (dateObj.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

                                const isSelected = selectedDateKey === dateKey;
                                const isToday = todayStr === dateKey;
                                const dayEvents = processEvents[dateKey];
                                const hasSessions = dayEvents?.sessions?.length > 0;
                                const hasReminders = dayEvents?.reminders?.length > 0;

                                return (
                                    <button
                                        key={d}
                                        onClick={() => setSelectedDate(dateObj)}
                                        style={{
                                            ...calendarDayStyle,
                                            backgroundColor: isSelected ? 'var(--color-primary)' : (isToday ? 'var(--color-bg-secondary)' : 'transparent'),
                                            color: isSelected ? 'white' : 'var(--color-text-primary)',
                                            border: isToday && !isSelected ? '1px solid var(--color-primary)' : '1px solid transparent'
                                        }}
                                    >
                                        {d}
                                        <div style={{ display: 'flex', justifyContent: 'center', gap: '2px', marginTop: '4px', height: '4px' }}>
                                            {hasSessions && <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: isSelected ? 'white' : '#ef4444' }} />}
                                            {hasReminders && <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: isSelected ? 'white' : '#f59e0b' }} />}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* AGENDA LATERAL */}
                    <div style={{ ...chartCardStyle, flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <h3 style={{ ...chartTitleStyle, marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span>Para o dia {selectedDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span>
                            {selectedDateKey === todayStr && <span style={{ fontSize: '11px', backgroundColor: '#ef4444', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 'bold', letterSpacing: '0.5px' }}>HOJE</span>}
                        </h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, overflowY: 'auto' }}>
                            {selectedEvents.sessions.length === 0 && selectedEvents.reminders.length === 0 && (
                                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--color-text-secondary)', fontSize: '14px', margin: 'auto' }}>
                                    <CalendarIcon size={32} opacity={0.2} style={{ margin: '0 auto 8px' }} />
                                    Nenhuma ação necessária neste dia.
                                </div>
                            )}

                            {selectedEvents.sessions.map((item, i) => (
                                <div key={`sess-${i}`} style={agendaItemStyle('rgba(239, 68, 68, 0.1)', '#ef4444')}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ef4444' }}></span>
                                            SESSÃO ({new Date(item.sessionDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)', marginTop: '4px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                        {item.title}
                                    </div>
                                </div>
                            ))}

                            {selectedEvents.reminders.map((item, i) => (
                                <div key={`rem-${i}`} style={agendaItemStyle('rgba(245, 158, 11, 0.1)', '#f59e0b')}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#d97706', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <Bell size={12} />
                                            LEMBRETE ({new Date(item.reminderDate!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)', marginTop: '4px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                        {item.title}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}

// Subcomponents
function KpiCard({ title, value, icon, color, bg, trend }: { title: string, value: string, icon: React.ReactNode, color: string, bg: string, trend?: string }) {
    return (
        <div style={{
            backgroundColor: 'var(--color-bg-surface)',
            padding: '24px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
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

function RadarCard({ title, subtitle, desc, icon, bg }: { title: string, subtitle: string, desc: string, icon: React.ReactNode, bg: string }) {
    return (
        <div style={{
            backgroundColor: 'var(--color-bg-surface)', padding: '16px', borderRadius: '12px',
            border: '1px solid var(--color-border)', display: 'flex', alignItems: 'flex-start', gap: '12px',
            boxShadow: '0 2px 4px -1px rgba(0,0,0,0.03)'
        }}>
            <div style={{ backgroundColor: bg, padding: '10px', borderRadius: '10px', flexShrink: 0 }}>
                {icon}
            </div>
            <div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>{title}</div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text-primary)', marginTop: '2px' }}>{subtitle}</div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', lineHeight: 1.4 }}>{desc}</div>
            </div>
        </div>
    );
}

// Styles
const chartCardStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-bg-surface)',
    padding: '24px',
    borderRadius: '16px',
    border: '1px solid var(--color-border)',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)'
};

const chartTitleStyle: React.CSSProperties = {
    fontSize: '1rem',
    fontWeight: 600,
    color: 'var(--color-text-primary)',
    marginBottom: '24px',
    marginTop: 0
};

const calendarBtnStyle: React.CSSProperties = {
    background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)',
    cursor: 'pointer', padding: '6px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--color-text-primary)', borderRadius: '6px', transition: 'all 0.2s'
};

const calendarDayStyle: React.CSSProperties = {
    padding: '8px 4px', fontSize: '13px', fontWeight: 500, borderRadius: '8px',
    cursor: 'pointer', transition: 'all 0.2s', display: 'flex', flexDirection: 'column',
    alignItems: 'center', minHeight: '40px'
};

const agendaItemStyle = (bg: string, borderLeft: string): React.CSSProperties => ({
    backgroundColor: bg,
    borderLeft: `4px solid ${borderLeft}`,
    padding: '12px 16px',
    borderRadius: '4px 8px 8px 4px',
    boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
});

