import React, { useState, useMemo, useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    Line, AreaChart, Area
} from 'recharts';
import {
    Target, TrendingUp, DollarSign, Award,
    Calendar as CalendarIcon, ChevronLeft, ChevronRight,
    Bell, Clock, Search, Zap, AlertTriangle, FileWarning,
    ArrowRight, Briefcase, Building2, Timer, ChevronDown, ChevronUp,
    BrainCircuit, Satellite, FileCheck
} from 'lucide-react';
import type { BiddingProcess, CompanyProfile } from '../types';
import { API_BASE_URL } from '../config';

interface Props {
    items: BiddingProcess[];
}

export function Dashboard({ items }: Props) {
    // ── State ──
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [showAllAlerts, setShowAllAlerts] = useState(false);
    const [expiringDocs, setExpiringDocs] = useState<{ name: string; docType: string; expirationDate: string; companyName: string; status: string }[]>([]);

    // ── KPI Calculations ──
    const totalValue = items.reduce((acc, curr) => acc + curr.estimatedValue, 0);
    const wonItems = items.filter(i => i.status === 'Vencido');
    const wonValue = wonItems.reduce((acc, curr) => acc + curr.estimatedValue, 0);
    const lostItems = items.filter(i => i.status === 'Perdido');
    const activeItems = items.filter(i => !['Vencido', 'Perdido', 'Sem Sucesso'].includes(i.status));
    const totalFinished = wonItems.length + lostItems.length;
    const winRate = totalFinished > 0 ? Math.round((wonItems.length / totalFinished) * 100) : 0;

    // ── Fetch expiring documents ──
    useEffect(() => {
        const fetchDocs = async () => {
            const token = localStorage.getItem('token');
            if (!token) return;
            try {
                const res = await fetch(`${API_BASE_URL}/api/documents`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const docs = await res.json();
                    const now = new Date();
                    const expiring = docs
                        .filter((d: any) => d.expirationDate)
                        .map((d: any) => {
                            const exp = new Date(d.expirationDate);
                            const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                            return {
                                ...d,
                                daysLeft,
                                status: daysLeft < 0 ? 'vencido' : daysLeft <= 15 ? 'critico' : daysLeft <= 30 ? 'alerta' : 'ok'
                            };
                        })
                        .filter((d: any) => d.status !== 'ok')
                        .sort((a: any, b: any) => a.daysLeft - b.daysLeft);
                    setExpiringDocs(expiring);
                }
            } catch { /* silent */ }
        };
        fetchDocs();
    }, []);

    // ── Today's missions: sessions + reminders happening today ──
    const today = new Date();
    const todayStr = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

    const todaySessions = useMemo(() => {
        return items.filter(item => {
            if (!item.sessionDate) return false;
            const d = new Date(item.sessionDate);
            const dateKey = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
            return dateKey === todayStr;
        }).sort((a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime());
    }, [items, todayStr]);

    const todayReminders = useMemo(() => {
        return items.filter(item => {
            if (!item.reminderDate || item.reminderStatus !== 'pending') return false;
            const d = new Date(item.reminderDate);
            const dateKey = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
            return dateKey === todayStr;
        });
    }, [items, todayStr]);

    // ── Upcoming sessions (next 7 days) ──
    const upcomingSessions = useMemo(() => {
        const now = new Date();
        const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        return items.filter(item => {
            if (!item.sessionDate) return false;
            const d = new Date(item.sessionDate);
            return d > now && d <= in7days;
        }).sort((a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime());
    }, [items]);

    // ── Stalled processes (in funnel but no action for 7+ days) ──
    const stalledProcesses = useMemo(() => {
        const now = new Date();
        return activeItems.filter(item => {
            const updated = new Date(item.updatedAt || item.createdAt);
            const daysSinceUpdate = Math.ceil((now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24));
            return daysSinceUpdate >= 7 && !['Captado'].includes(item.status);
        });
    }, [activeItems]);

    // ── Critical Alerts (aggregated) ──
    const criticalAlerts = useMemo(() => {
        const alerts: { type: 'danger' | 'warning' | 'urgency'; icon: React.ReactNode; message: string; count?: number }[] = [];

        const vencidoDocs = expiringDocs.filter((d: any) => d.status === 'vencido');
        const alertaDocs = expiringDocs.filter((d: any) => d.status === 'critico' || d.status === 'alerta');

        if (vencidoDocs.length > 0) {
            alerts.push({
                type: 'danger',
                icon: <FileWarning size={16} />,
                message: `${vencidoDocs.length} documento${vencidoDocs.length > 1 ? 's' : ''} vencido${vencidoDocs.length > 1 ? 's' : ''} — impeditivo para participação`,
                count: vencidoDocs.length
            });
        }
        if (alertaDocs.length > 0) {
            alerts.push({
                type: 'warning',
                icon: <Clock size={16} />,
                message: `${alertaDocs.length} documento${alertaDocs.length > 1 ? 's' : ''} vencendo nos próximos 30 dias`,
                count: alertaDocs.length
            });
        }
        if (todaySessions.length > 0) {
            alerts.push({
                type: 'urgency',
                icon: <Timer size={16} />,
                message: `${todaySessions.length} sessão${todaySessions.length > 1 ? 'ões' : ''} de licitação hoje`,
                count: todaySessions.length
            });
        }
        if (stalledProcesses.length > 0) {
            alerts.push({
                type: 'warning',
                icon: <AlertTriangle size={16} />,
                message: `${stalledProcesses.length} processo${stalledProcesses.length > 1 ? 's' : ''} parado${stalledProcesses.length > 1 ? 's' : ''} há mais de 7 dias`,
                count: stalledProcesses.length
            });
        }
        return alerts;
    }, [expiringDocs, todaySessions, stalledProcesses]);

    // ── Funnel Data ──
    const statusCounts = items.reduce((acc, curr) => {
        acc[curr.status] = (acc[curr.status] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    const funnelData = [
        { name: 'Captado', count: statusCounts['Captado'] || 0, fill: 'var(--color-neutral)' },
        { name: 'Em Análise', count: statusCounts['Em Análise de Edital'] || 0, fill: 'var(--color-primary)' },
        { name: 'Preparando', count: statusCounts['Preparando Documentação'] || 0, fill: 'var(--color-urgency)' },
        { name: 'Participando', count: statusCounts['Participando'] || 0, fill: 'var(--color-warning)' },
        { name: 'Vencido', count: statusCounts['Vencido'] || 0, fill: 'var(--color-success)' },
        { name: 'Perdido', count: statusCounts['Perdido'] || 0, fill: 'var(--color-danger)' },
    ];

    // ── Historical Data ──
    const historicalData = [
        { month: 'Set', winRate: 35, wonValue: Math.max(0, wonValue * 0.2) },
        { month: 'Out', winRate: 42, wonValue: Math.max(0, wonValue * 0.4) },
        { month: 'Nov', winRate: 38, wonValue: Math.max(0, wonValue * 0.5) },
        { month: 'Dez', winRate: 55, wonValue: Math.max(0, wonValue * 0.7) },
        { month: 'Jan', winRate: 60, wonValue: Math.max(0, wonValue * 0.9) },
        { month: 'Fev', winRate: winRate || 65, wonValue: wonValue },
    ];

    // ── Calendar Logic ──
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
    const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));

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
    const selectedEvents = processEvents[selectedDateKey] || { sessions: [], reminders: [] };
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    // ── Radar stats ──
    const pncpCount = items.filter(i => i.portal?.toLowerCase().includes('pncp') || i.link?.toLowerCase().includes('pncp.gov.br')).length;
    const aiCount = items.filter(i => i.aiAnalysis).length;

    return (
        <div className="page-container" style={{ maxWidth: '1400px', margin: '0 auto' }}>
            {/* ═════════════════════════════
                HEADER
                ═════════════════════════════ */}
            <div className="breadcrumb">
                <span className="breadcrumb-current">Painel</span>
            </div>
            <div className="page-header" style={{ marginBottom: 'var(--space-5)' }}>
                <div>
                    <h1 className="page-title">Command Center</h1>
                    <p className="page-subtitle">
                        {today.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                </div>
            </div>

            {/* ═════════════════════════════
                CRITICAL ALERTS (top banner)
                ═════════════════════════════ */}
            {criticalAlerts.length > 0 && (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)',
                    marginBottom: 'var(--space-5)',
                }}>
                    {(showAllAlerts ? criticalAlerts : criticalAlerts.slice(0, 2)).map((alert, i) => (
                        <div key={i} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-3)',
                            padding: 'var(--space-3) var(--space-4)',
                            borderRadius: 'var(--radius-md)',
                            border: `1px solid var(--color-${alert.type}-border, var(--color-border))`,
                            background: `var(--color-${alert.type}-bg, var(--color-bg-surface))`,
                            fontSize: 'var(--text-md)',
                            fontWeight: 'var(--font-medium)',
                            color: `var(--color-${alert.type}, var(--color-text-primary))`,
                        }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0, width: 28, height: 28,
                                borderRadius: 'var(--radius-sm)',
                                background: `var(--color-${alert.type}-bg, var(--color-bg-surface-hover))`,
                            }}>
                                {alert.icon}
                            </div>
                            <span style={{ flex: 1 }}>{alert.message}</span>
                            <ArrowRight size={14} style={{ opacity: 0.5 }} />
                        </div>
                    ))}
                    {criticalAlerts.length > 2 && (
                        <button
                            onClick={() => setShowAllAlerts(!showAllAlerts)}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)',
                                display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                                padding: 'var(--space-1) 0',
                            }}
                        >
                            {showAllAlerts ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            {showAllAlerts ? 'Ocultar' : `Mais ${criticalAlerts.length - 2} alerta(s)`}
                        </button>
                    )}
                </div>
            )}

            {/* ═════════════════════════════
                KPIs (compact strip)
                ═════════════════════════════ */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 'var(--space-4)',
                marginBottom: 'var(--space-5)',
            }}>
                <KpiCard
                    title="Volume no Funil"
                    value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(totalValue)}
                    icon={<DollarSign size={18} />}
                    color="var(--color-primary)"
                    bg="var(--color-primary-light)"
                />
                <KpiCard
                    title="Volume Ganho (YTD)"
                    value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(wonValue)}
                    icon={<Award size={18} />}
                    color="var(--color-success)"
                    bg="var(--color-success-bg)"
                />
                <KpiCard
                    title="Win Rate"
                    value={`${winRate}%`}
                    icon={<Target size={18} />}
                    color="var(--color-primary)"
                    bg="var(--color-primary-light)"
                    subtitle={`${wonItems.length} de ${totalFinished} finalizados`}
                />
                <KpiCard
                    title="Processos Ativos"
                    value={activeItems.length.toString()}
                    icon={<Briefcase size={18} />}
                    color="var(--color-urgency)"
                    bg="var(--color-urgency-bg)"
                    subtitle={`${items.length} total no sistema`}
                />
            </div>

            {/* ═════════════════════════════
                MAIN GRID: 2 columns
                ═════════════════════════════ */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: '1.2fr 1fr',
                gap: 'var(--space-5)',
            }}>
                {/* ── LEFT COLUMN ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

                    {/* MISSÕES DO DIA */}
                    <div className="card" style={{ padding: 'var(--card-padding)' }}>
                        <div style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            marginBottom: 'var(--space-4)',
                        }}>
                            <h3 style={sectionTitleStyle}>
                                <Timer size={18} color="var(--color-urgency)" />
                                Missões do Dia
                            </h3>
                            <span className="badge badge-urgency">
                                {todaySessions.length + todayReminders.length} pendente{todaySessions.length + todayReminders.length !== 1 ? 's' : ''}
                            </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                            {todaySessions.length === 0 && todayReminders.length === 0 && (
                                <div style={{
                                    textAlign: 'center', padding: 'var(--space-8) var(--space-4)',
                                    color: 'var(--color-text-tertiary)', fontSize: 'var(--text-md)',
                                }}>
                                    <CalendarIcon size={28} style={{ opacity: 0.2, marginBottom: 'var(--space-2)' }} />
                                    <p>Nenhuma sessão ou lembrete para hoje.</p>
                                </div>
                            )}

                            {todaySessions.map((item, i) => (
                                <MissionCard
                                    key={`s-${i}`}
                                    type="session"
                                    time={new Date(item.sessionDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                    title={item.title}
                                    subtitle={item.modality}
                                    value={item.estimatedValue}
                                />
                            ))}

                            {todayReminders.map((item, i) => (
                                <MissionCard
                                    key={`r-${i}`}
                                    type="reminder"
                                    time={new Date(item.reminderDate!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                    title={item.title}
                                    subtitle={item.reminderNote || 'Lembrete'}
                                />
                            ))}
                        </div>
                    </div>

                    {/* PRÓXIMAS SESSÕES (7 dias) */}
                    {upcomingSessions.length > 0 && (
                        <div className="card" style={{ padding: 'var(--card-padding)' }}>
                            <h3 style={sectionTitleStyle}>
                                <CalendarIcon size={18} color="var(--color-primary)" />
                                Próximas Sessões (7 dias)
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                                {upcomingSessions.slice(0, 5).map((item, i) => {
                                    const d = new Date(item.sessionDate);
                                    return (
                                        <div key={i} style={{
                                            display: 'flex', gap: 'var(--space-3)', alignItems: 'center',
                                            padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
                                            background: 'var(--color-bg-surface-hover)',
                                        }}>
                                            <div style={{
                                                minWidth: 48, textAlign: 'center',
                                                fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)',
                                                color: 'var(--color-primary)',
                                                background: 'var(--color-primary-light)',
                                                padding: 'var(--space-1) var(--space-2)',
                                                borderRadius: 'var(--radius-sm)',
                                                lineHeight: 1.3,
                                            }}>
                                                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)' }}>{d.getDate()}</div>
                                                <div>{d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</div>
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{
                                                    fontSize: 'var(--text-md)', fontWeight: 'var(--font-medium)',
                                                    color: 'var(--color-text-primary)',
                                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                }}>{item.title}</div>
                                                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                                                    {d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {item.modality || item.portal}
                                                </div>
                                            </div>
                                            {item.estimatedValue > 0 && (
                                                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--color-success)', whiteSpace: 'nowrap' }}>
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(item.estimatedValue)}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {upcomingSessions.length > 5 && (
                                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', textAlign: 'center', paddingTop: 'var(--space-2)' }}>
                                        +{upcomingSessions.length - 5} mais sessões nos próximos 7 dias
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* RADAR DO SISTEMA */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>
                        <RadarCard
                            icon={<Satellite size={18} />}
                            title="Captação PNCP"
                            value={pncpCount.toString()}
                            desc="no funil via PNCP"
                            color="var(--color-primary)"
                            bg="var(--color-primary-light)"
                        />
                        <RadarCard
                            icon={<BrainCircuit size={18} />}
                            title="LicitIA"
                            value={aiCount.toString()}
                            desc="editais analisados"
                            color="var(--color-ai)"
                            bg="var(--color-ai-bg)"
                        />
                        <RadarCard
                            icon={<FileCheck size={18} />}
                            title="Documentos"
                            value={expiringDocs.length > 0 ? `${expiringDocs.length} alerta${expiringDocs.length > 1 ? 's' : ''}` : 'OK'}
                            desc={expiringDocs.length > 0 ? 'requerem atenção' : 'tudo em dia'}
                            color={expiringDocs.length > 0 ? 'var(--color-danger)' : 'var(--color-success)'}
                            bg={expiringDocs.length > 0 ? 'var(--color-danger-bg)' : 'var(--color-success-bg)'}
                        />
                    </div>

                    {/* FUNIL */}
                    <div className="card" style={{ padding: 'var(--card-padding)' }}>
                        <h3 style={sectionTitleStyle}>Distribuição por Fase do Funil</h3>
                        <div style={{ width: '100%', height: 220 }}>
                            <ResponsiveContainer>
                                <BarChart data={funnelData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                    <XAxis dataKey="name" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)' }}
                                        itemStyle={{ color: 'var(--color-text-primary)' }}
                                    />
                                    <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* CONVERSÃO HISTÓRICA */}
                    <div className="card" style={{ padding: 'var(--card-padding)' }}>
                        <h3 style={sectionTitleStyle}>Evolução de Conversão (6 meses)</h3>
                        <div style={{ width: '100%', height: 220 }}>
                            <ResponsiveContainer>
                                <AreaChart data={historicalData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                                    <defs>
                                        <linearGradient id="colorWinRate" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.2} />
                                            <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                    <XAxis dataKey="month" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <YAxis yAxisId="left" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)' }}
                                        itemStyle={{ color: 'var(--color-text-primary)' }}
                                    />
                                    <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }} />
                                    <Area yAxisId="left" type="monotone" dataKey="winRate" name="Win Rate (%)" stroke="var(--color-success)" fillOpacity={1} fill="url(#colorWinRate)" />
                                    <Line yAxisId="right" type="monotone" dataKey="wonValue" name="Volume Ganho (R$)" stroke="var(--color-ai)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                {/* ── RIGHT COLUMN ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

                    {/* CALENDÁRIO */}
                    <div className="card" style={{ padding: 'var(--card-padding)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                            <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>
                                <CalendarIcon size={18} color="var(--color-primary)" />
                                Calendário
                            </h3>
                            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                                <button onClick={prevMonth} style={calBtnStyle}><ChevronLeft size={14} /></button>
                                <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)', minWidth: 120, textAlign: 'center' }}>
                                    {monthNames[month]} {year}
                                </span>
                                <button onClick={nextMonth} style={calBtnStyle}><ChevronRight size={14} /></button>
                            </div>
                        </div>

                        {/* Week headers */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', textAlign: 'center', marginBottom: 'var(--space-1)' }}>
                            {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
                                <div key={i} style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-tertiary)', padding: 'var(--space-1)' }}>{d}</div>
                            ))}
                        </div>

                        {/* Days */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
                            {Array.from({ length: firstDayOfMonth }).map((_, i) => <div key={`e-${i}`} />)}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                const d = i + 1;
                                const dateObj = new Date(year, month, d);
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
                                            padding: '6px 2px', fontSize: 'var(--text-base)', fontWeight: 'var(--font-medium)',
                                            borderRadius: 'var(--radius-sm)', cursor: 'pointer', transition: 'all 150ms',
                                            display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 36,
                                            background: isSelected ? 'var(--color-primary)' : isToday ? 'var(--color-bg-surface-hover)' : 'transparent',
                                            color: isSelected ? 'white' : 'var(--color-text-primary)',
                                            border: isToday && !isSelected ? '1px solid var(--color-primary)' : '1px solid transparent',
                                        }}
                                    >
                                        {d}
                                        <div style={{ display: 'flex', justifyContent: 'center', gap: '2px', marginTop: '2px', height: '4px' }}>
                                            {hasSessions && <span style={{ width: 4, height: 4, borderRadius: '50%', background: isSelected ? 'white' : 'var(--color-danger)' }} />}
                                            {hasReminders && <span style={{ width: 4, height: 4, borderRadius: '50%', background: isSelected ? 'white' : 'var(--color-warning)' }} />}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* AGENDA DO DIA SELECIONADO */}
                    <div className="card" style={{ padding: 'var(--card-padding)', flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                            <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>
                                {selectedDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                            </h3>
                            {selectedDateKey === todayStr && (
                                <span className="badge badge-danger" style={{ fontSize: 'var(--text-xs)' }}>HOJE</span>
                            )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flex: 1, overflowY: 'auto' }}>
                            {selectedEvents.sessions.length === 0 && selectedEvents.reminders.length === 0 && (
                                <div style={{ textAlign: 'center', padding: 'var(--space-8) 0', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-md)', margin: 'auto' }}>
                                    <CalendarIcon size={28} style={{ opacity: 0.15, marginBottom: 'var(--space-2)' }} />
                                    <p>Nenhuma ação neste dia.</p>
                                </div>
                            )}

                            {selectedEvents.sessions.map((item, i) => (
                                <AgendaItem key={`s-${i}`} type="session" item={item} />
                            ))}
                            {selectedEvents.reminders.map((item, i) => (
                                <AgendaItem key={`r-${i}`} type="reminder" item={item} />
                            ))}
                        </div>
                    </div>

                    {/* PROCESSOS PARADOS */}
                    {stalledProcesses.length > 0 && (
                        <div className="card" style={{ padding: 'var(--card-padding)' }}>
                            <h3 style={sectionTitleStyle}>
                                <AlertTriangle size={18} color="var(--color-warning)" />
                                Processos Parados ({stalledProcesses.length})
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                                {stalledProcesses.slice(0, 4).map((item, i) => {
                                    const daysSince = Math.ceil((new Date().getTime() - new Date(item.updatedAt || item.createdAt).getTime()) / (1000 * 60 * 60 * 24));
                                    return (
                                        <div key={i} style={{
                                            display: 'flex', gap: 'var(--space-3)', alignItems: 'center',
                                            padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
                                            background: 'var(--color-warning-bg)',
                                            border: '1px solid var(--color-warning-border)',
                                        }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{
                                                    fontSize: 'var(--text-md)', fontWeight: 'var(--font-medium)',
                                                    color: 'var(--color-text-primary)',
                                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                }}>{item.title}</div>
                                                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-warning)' }}>
                                                    {item.status} · parado há {daysSince} dias
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════
// SUB COMPONENTS
// ═══════════════════════════

function KpiCard({ title, value, icon, color, bg, subtitle }: {
    title: string; value: string; icon: React.ReactNode; color: string; bg: string; subtitle?: string;
}) {
    return (
        <div className="card" style={{ padding: 'var(--card-padding)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', fontWeight: 'var(--font-medium)', marginBottom: 'var(--space-2)' }}>{title}</div>
                    <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)', lineHeight: 1.2 }}>{value}</div>
                    {subtitle && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-1)' }}>{subtitle}</div>
                    )}
                </div>
                <div style={{
                    color, backgroundColor: bg,
                    padding: 'var(--space-2)', borderRadius: 'var(--radius-md)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    {icon}
                </div>
            </div>
        </div>
    );
}

function RadarCard({ title, value, desc, icon, color, bg }: {
    title: string; value: string; desc: string; icon: React.ReactNode; color: string; bg: string;
}) {
    return (
        <div className="card" style={{
            padding: 'var(--space-4)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
            gap: 'var(--space-2)',
        }}>
            <div style={{ color, backgroundColor: bg, padding: 'var(--space-2)', borderRadius: 'var(--radius-md)', display: 'flex' }}>
                {icon}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-semibold)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{title}</div>
            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)' }}>{value}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{desc}</div>
        </div>
    );
}

function MissionCard({ type, time, title, subtitle, value }: {
    type: 'session' | 'reminder'; time: string; title: string; subtitle?: string; value?: number;
}) {
    const isSession = type === 'session';
    const borderColor = isSession ? 'var(--color-urgency)' : 'var(--color-warning)';
    const tagBg = isSession ? 'var(--color-urgency-bg)' : 'var(--color-warning-bg)';
    const tagColor = isSession ? 'var(--color-urgency)' : 'var(--color-warning)';

    return (
        <div style={{
            display: 'flex', gap: 'var(--space-3)', alignItems: 'center',
            padding: 'var(--space-3) var(--space-4)',
            borderLeft: `3px solid ${borderColor}`,
            borderRadius: '0 var(--radius-md) var(--radius-md) 0',
            background: 'var(--color-bg-surface-hover)',
        }}>
            <div style={{
                fontSize: 'var(--text-sm)', fontWeight: 'var(--font-bold)',
                color: tagColor, minWidth: 44,
            }}>
                {time}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                    fontSize: 'var(--text-md)', fontWeight: 'var(--font-medium)',
                    color: 'var(--color-text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{title}</div>
                {subtitle && (
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginTop: '1px' }}>{subtitle}</div>
                )}
            </div>
            <span className={isSession ? 'badge badge-urgency' : 'badge badge-warning'} style={{ flexShrink: 0 }}>
                {isSession ? 'SESSÃO' : 'LEMBRETE'}
            </span>
        </div>
    );
}

function AgendaItem({ type, item }: { type: 'session' | 'reminder'; item: BiddingProcess }) {
    const isSession = type === 'session';
    const time = isSession
        ? new Date(item.sessionDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : new Date(item.reminderDate!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    return (
        <div style={{
            padding: 'var(--space-3)',
            borderLeft: `3px solid ${isSession ? 'var(--color-danger)' : 'var(--color-warning)'}`,
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
            background: isSession ? 'var(--color-danger-bg)' : 'var(--color-warning-bg)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '2px' }}>
                {isSession ? <Clock size={12} color="var(--color-danger)" /> : <Bell size={12} color="var(--color-warning)" />}
                <span style={{
                    fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)',
                    color: isSession ? 'var(--color-danger)' : 'var(--color-warning)',
                }}>
                    {isSession ? 'SESSÃO' : 'LEMBRETE'} · {time}
                </span>
            </div>
            <div style={{
                fontSize: 'var(--text-md)', fontWeight: 'var(--font-medium)',
                color: 'var(--color-text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
                {item.title}
            </div>
        </div>
    );
}

// ═══════════════════════════
// STYLES
// ═══════════════════════════

const sectionTitleStyle: React.CSSProperties = {
    fontSize: 'var(--text-lg)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--color-text-primary)',
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
};

const calBtnStyle: React.CSSProperties = {
    background: 'var(--color-bg-surface-hover)',
    border: '1px solid var(--color-border)',
    cursor: 'pointer', padding: '4px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--color-text-primary)', borderRadius: 'var(--radius-sm)',
    transition: 'all 150ms',
};
