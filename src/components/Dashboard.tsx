import React, { useState, useMemo, useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
    Target, DollarSign, Award,
    Calendar as CalendarIcon, ChevronLeft, ChevronRight,
    Bell, Clock, AlertTriangle, FileWarning,
    ArrowRight, Timer, ChevronDown, ChevronUp,
    BrainCircuit, Satellite, FileCheck, ExternalLink, Eye,
    FileText, CheckCircle, Zap, Building2, TrendingUp, Edit3
} from 'lucide-react';
import type { BiddingProcess, CompanyProfile } from '../types';
import { API_BASE_URL } from '../config';
import { CountdownBadge } from './ui';

interface Props {
    items: BiddingProcess[];
    companies?: CompanyProfile[];
    onNavigate?: (tab: string, filter?: { statuses?: string[]; highlight?: string }) => void;
}

export function Dashboard({ items, companies = [], onNavigate }: Props) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [showAllAlerts, setShowAllAlerts] = useState(false);
    const [expiringDocs, setExpiringDocs] = useState<{ name: string; docType: string; expirationDate: string; companyName: string; status: string; daysLeft?: number }[]>([]);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
    const [monthlyTarget, setMonthlyTarget] = useState<number>(() => {
        const saved = localStorage.getItem('dashboard_monthly_target');
        return saved ? Number(saved) : 0;
    });
    const [editingTarget, setEditingTarget] = useState(false);
    const [targetInput, setTargetInput] = useState('');

    // ── Filter items by company ──
    const filteredItems = useMemo(() => {
        if (!selectedCompanyId) return items;
        return items.filter(i => i.companyProfileId === selectedCompanyId);
    }, [items, selectedCompanyId]);

    // ── KPI Calculations ──
    const totalValue = filteredItems.reduce((acc, curr) => acc + curr.estimatedValue, 0);
    const wonItems = filteredItems.filter(i => i.status === 'Vencido');
    const wonValue = wonItems.reduce((acc, curr) => acc + curr.estimatedValue, 0);
    const lostItems = filteredItems.filter(i => i.status === 'Perdido');
    const activeItems = filteredItems.filter(i => !['Vencido', 'Perdido', 'Sem Sucesso'].includes(i.status));
    const totalFinished = wonItems.length + lostItems.length;
    const winRate = totalFinished > 0 ? Math.round((wonItems.length / totalFinished) * 100) : 0;

    // ── Specific status counts for actionable KPIs ──
    const captadoItems = filteredItems.filter(i => i.status === 'Captado');
    const emAnaliseItems = filteredItems.filter(i => i.status === 'Em Análise de Edital');
    const preparandoItems = filteredItems.filter(i => i.status === 'Preparando Documentação');
    const participandoItems = filteredItems.filter(i => i.status === 'Participando');

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

    // ── Today's missions ──
    const today = new Date();
    const todayStr = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

    const todaySessions = useMemo(() => {
        return filteredItems.filter(item => {
            if (!item.sessionDate) return false;
            const d = new Date(item.sessionDate);
            const dateKey = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
            return dateKey === todayStr;
        }).sort((a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime());
    }, [filteredItems, todayStr]);

    const todayReminders = useMemo(() => {
        return filteredItems.filter(item => {
            if (!item.reminderDate || item.reminderStatus !== 'pending') return false;
            const d = new Date(item.reminderDate);
            const dateKey = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
            return dateKey === todayStr;
        });
    }, [filteredItems, todayStr]);

    // ── Upcoming sessions (next 7 days) ──
    const upcomingSessions = useMemo(() => {
        const now = new Date();
        const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        return filteredItems.filter(item => {
            if (!item.sessionDate) return false;
            const d = new Date(item.sessionDate);
            return d > now && d <= in7days;
        }).sort((a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime());
    }, [filteredItems]);

    // ── Stalled processes (7+ days without action) ──
    const stalledProcesses = useMemo(() => {
        const now = new Date();
        return activeItems.filter(item => {
            const updated = new Date(item.sessionDate || new Date().toISOString());
            const daysSinceUpdate = Math.ceil((now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24));
            return daysSinceUpdate >= 7 && !['Captado'].includes(item.status);
        });
    }, [activeItems]);

    // ── Items needing AI analysis ──
    const needsAiAnalysis = useMemo(() => {
        return emAnaliseItems.filter(i => !i.aiAnalysis);
    }, [emAnaliseItems]);

    // ── Critical Alerts ──
    const criticalAlerts = useMemo(() => {
        const alerts: { type: 'danger' | 'warning' | 'urgency'; icon: React.ReactNode; message: string; action: string; count?: number; dest?: string }[] = [];

        const vencidoDocs = expiringDocs.filter((d: any) => d.status === 'vencido');
        const alertaDocs = expiringDocs.filter((d: any) => d.status === 'critico' || d.status === 'alerta');

        if (vencidoDocs.length > 0) {
            alerts.push({
                type: 'danger',
                icon: <FileWarning size={16} />,
                message: `${vencidoDocs.length} documento${vencidoDocs.length > 1 ? 's' : ''} vencido${vencidoDocs.length > 1 ? 's' : ''} — impeditivo para participação`,
                action: 'Renovar agora →',
                count: vencidoDocs.length,
                dest: 'companies'
            });
        }
        if (todaySessions.length > 0) {
            alerts.push({
                type: 'urgency',
                icon: <Timer size={16} />,
                message: `${todaySessions.length} sessão${todaySessions.length > 1 ? 'ões' : ''} de licitação HOJE`,
                action: 'Ver sessões →',
                count: todaySessions.length,
                dest: 'bidding'
            });
        }
        if (alertaDocs.length > 0) {
            alerts.push({
                type: 'warning',
                icon: <Clock size={16} />,
                message: `${alertaDocs.length} documento${alertaDocs.length > 1 ? 's' : ''} vencendo nos próximos 30 dias`,
                action: 'Verificar →',
                count: alertaDocs.length,
                dest: 'companies'
            });
        }
        if (stalledProcesses.length > 0) {
            alerts.push({
                type: 'warning',
                icon: <AlertTriangle size={16} />,
                message: `${stalledProcesses.length} processo${stalledProcesses.length > 1 ? 's' : ''} parado${stalledProcesses.length > 1 ? 's' : ''} há mais de 7 dias`,
                action: 'Mover no funil →',
                count: stalledProcesses.length,
                dest: 'bidding'
            });
        }
        if (needsAiAnalysis.length > 0) {
            alerts.push({
                type: 'warning',
                icon: <BrainCircuit size={16} />,
                message: `${needsAiAnalysis.length} edital${needsAiAnalysis.length > 1 ? 'is' : ''} em análise sem parecer da IA`,
                action: 'Analisar com IA →',
                count: needsAiAnalysis.length,
                dest: 'intelligence'
            });
        }
        return alerts;
    }, [expiringDocs, todaySessions, stalledProcesses, needsAiAnalysis]);

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

    // ── Quick action pipeline counts — with deep link filters ──
    const pipelineSteps = [
        { label: 'Captados', count: captadoItems.length, icon: <Satellite size={14} />, color: 'var(--color-neutral)', action: 'Triar', dest: 'bidding', statuses: ['Captado'] },
        { label: 'Em Análise', count: emAnaliseItems.length, icon: <Eye size={14} />, color: 'var(--color-primary)', action: 'Analisar', dest: 'bidding', statuses: ['Em Análise de Edital'] },
        { label: 'Preparando', count: preparandoItems.length, icon: <FileText size={14} />, color: 'var(--color-urgency)', action: 'Documentar', dest: 'bidding', statuses: ['Preparando Documentação'] },
        { label: 'Participando', count: participandoItems.length, icon: <Zap size={14} />, color: 'var(--color-warning)', action: 'Acompanhar', dest: 'bidding', statuses: ['Participando'] },
    ];

    const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

    return (
        <div className="page-container" style={{ maxWidth: '1400px', margin: '0 auto' }}>
            {/* HEADER */}
            <div className="breadcrumb">
                <span className="breadcrumb-current">Painel</span>
            </div>
            <div className="page-header" style={{ marginBottom: 'var(--space-5)' }}>
                <div>
                    <h1 className="page-title">Painel de Licitações</h1>
                    <p className="page-subtitle">
                        {today.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                </div>
                {/* Company filter */}
                {companies.length > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <Building2 size={16} style={{ color: 'var(--color-text-tertiary)' }} />
                        <select
                            value={selectedCompanyId}
                            onChange={(e) => setSelectedCompanyId(e.target.value)}
                            style={{
                                padding: 'var(--space-2) var(--space-3)',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--color-border)',
                                background: 'var(--color-bg-surface)',
                                color: 'var(--color-text-primary)',
                                fontSize: 'var(--text-sm)',
                                cursor: 'pointer',
                                minWidth: 180,
                            }}
                        >
                            <option value="">Todas as empresas</option>
                            {companies.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            {/* ═══ CRITICAL ALERTS — actionable banners ═══ */}
            {criticalAlerts.length > 0 && (
            <div className="animate-fade-in-down" style={{
                    display: 'flex', flexDirection: 'column',
                    gap: 'var(--space-2)', marginBottom: 'var(--space-5)',
                }}>
                    {(showAllAlerts ? criticalAlerts : criticalAlerts.slice(0, 3)).map((alert, i) => (
                        <div
                            key={i}
                            onClick={() => alert.dest && onNavigate?.(alert.dest)}
                            style={{
                            display: 'flex', alignItems: 'center',
                            gap: 'var(--space-3)',
                            padding: 'var(--space-3) var(--space-4)',
                            borderRadius: 'var(--radius-md)',
                            border: `1px solid var(--color-${alert.type}-border, var(--color-border))`,
                            background: `var(--color-${alert.type}-bg, var(--color-bg-surface))`,
                            fontSize: 'var(--text-md)',
                            fontWeight: 'var(--font-medium)',
                            color: `var(--color-${alert.type}, var(--color-text-primary))`,
                            cursor: alert.dest ? 'pointer' : undefined,
                            transition: 'var(--transition-fast)',
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
                            <span style={{
                                fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)',
                                opacity: 0.8, whiteSpace: 'nowrap',
                            }}>{alert.action}</span>
                        </div>
                    ))}
                    {criticalAlerts.length > 3 && (
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
                            {showAllAlerts ? 'Ocultar' : `Mais ${criticalAlerts.length - 3} alerta(s)`}
                        </button>
                    )}
                </div>
            )}

            {/* ═══ KPIs — clickable shortcuts ═══ */}
            <div className="stagger-children grid-4" style={{ marginBottom: 'var(--space-5)' }}>
                <KpiCard
                    title="Volume no Funil"
                    value={fmt(totalValue)}
                    icon={<DollarSign size={18} />}
                    color="var(--color-primary)"
                    bg="var(--color-primary-light)"
                    subtitle={`${activeItems.length} processos ativos`}
                    onClick={() => onNavigate?.('bidding', { statuses: ['Captado', 'Em Análise de Edital', 'Preparando Documentação', 'Participando'] })}
                />
                <KpiCard
                    title="Volume Ganho (YTD)"
                    value={fmt(wonValue)}
                    icon={<Award size={18} />}
                    color="var(--color-success)"
                    bg="var(--color-success-bg)"
                    subtitle={`${wonItems.length} licitações vencidas`}
                    onClick={() => onNavigate?.('bidding', { statuses: ['Vencido'] })}
                />
                <KpiCard
                    title="Taxa de Sucesso"
                    value={`${winRate}%`}
                    icon={<Target size={18} />}
                    color={winRate >= 50 ? 'var(--color-success)' : winRate >= 30 ? 'var(--color-warning)' : 'var(--color-danger)'}
                    bg={winRate >= 50 ? 'var(--color-success-bg)' : winRate >= 30 ? 'var(--color-warning-bg)' : 'var(--color-danger-bg)'}
                    subtitle={`${wonItems.length} de ${totalFinished} finalizados`}
                    onClick={() => onNavigate?.('bidding', { statuses: ['Vencido', 'Perdido', 'Sem Sucesso'] })}
                />
                <KpiCard
                    title="Próximas Sessões"
                    value={(todaySessions.length + upcomingSessions.length).toString()}
                    icon={<CalendarIcon size={18} />}
                    color={todaySessions.length > 0 ? 'var(--color-danger)' : 'var(--color-primary)'}
                    bg={todaySessions.length > 0 ? 'var(--color-danger-bg)' : 'var(--color-primary-light)'}
                    subtitle={todaySessions.length > 0 ? `⚡ ${todaySessions.length} HOJE` : 'nos próximos 7 dias'}
                    onClick={() => onNavigate?.('bidding')}
                />
            </div>

            {/* ═══ PIPELINE RÁPIDO — clickable step bar ═══ */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 'var(--space-2)', marginBottom: 'var(--space-5)',
            }}>
                {pipelineSteps.map((step, i) => (
                    <button
                        key={i}
                        onClick={() => onNavigate?.(step.dest, { statuses: step.statuses })}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                            padding: 'var(--space-3) var(--space-4)',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--color-border)',
                            background: step.count > 0 ? 'var(--color-bg-surface)' : 'var(--color-bg-body)',
                            cursor: 'pointer', transition: 'var(--transition-fast)',
                            textAlign: 'left',
                        }}
                    >
                        <div style={{
                            color: step.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: 28, height: 28, borderRadius: 'var(--radius-sm)',
                            background: `color-mix(in srgb, ${step.color} 12%, transparent)`,
                            flexShrink: 0,
                        }}>{step.icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)', lineHeight: 1 }}>
                                {step.count}
                            </div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{step.label}</div>
                        </div>
                        {step.count > 0 && (
                            <span style={{ fontSize: 'var(--text-xs)', color: step.color, fontWeight: 'var(--font-semibold)', whiteSpace: 'nowrap' }}>
                                {step.action} →
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* ═══ MAIN GRID: 2 columns ═══ */}
            <div className="grid-2-1">
                {/* ── LEFT COLUMN ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

                    {/* MISSÕES DO DIA — actionable */}
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
                                    textAlign: 'center', padding: 'var(--space-6) var(--space-4)',
                                    color: 'var(--color-text-tertiary)', fontSize: 'var(--text-md)',
                                }}>
                                    <CheckCircle size={28} style={{ opacity: 0.2, marginBottom: 'var(--space-2)', color: 'var(--color-success)' }} />
                                    <p style={{ margin: 0 }}>Nenhuma sessão ou lembrete para hoje.</p>
                                    {upcomingSessions.length > 0 && (
                                        <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-sm)' }}>
                                            Próxima sessão: <strong style={{ color: 'var(--color-text-primary)' }}>{new Date(upcomingSessions[0].sessionDate).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</strong>
                                        </p>
                                    )}
                                </div>
                            )}

                            {todaySessions.map((item, i) => (
                                <MissionCard
                                    key={`s-${i}`}
                                    type="session"
                                    time={new Date(item.sessionDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                    rawDate={item.sessionDate}
                                    title={item.title}
                                    subtitle={item.modality}
                                    value={item.estimatedValue}
                                    onClick={() => onNavigate?.('bidding')}
                                />
                            ))}

                            {todayReminders.map((item, i) => (
                                <MissionCard
                                    key={`r-${i}`}
                                    type="reminder"
                                    time={new Date(item.reminderDate!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                    title={item.title}
                                    subtitle={'Lembrete'}
                                    onClick={() => onNavigate?.('bidding')}
                                />
                            ))}
                        </div>
                    </div>

                    {/* PRÓXIMAS SESSÕES (7 dias) — with countdown */}
                    {upcomingSessions.length > 0 && (
                        <div className="card" style={{ padding: 'var(--card-padding)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                                <h3 style={sectionTitleStyle}>
                                    <CalendarIcon size={18} color="var(--color-primary)" />
                                    Próximas Sessões
                                </h3>
                                <button onClick={() => onNavigate?.('bidding')} style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    fontSize: 'var(--text-xs)', color: 'var(--color-primary)', fontWeight: 'var(--font-semibold)',
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                }}>
                                    Ver todas <ExternalLink size={12} />
                                </button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                {upcomingSessions.slice(0, 5).map((item, i) => {
                                    const d = new Date(item.sessionDate);
                                    return (
                                        <div key={i} onClick={() => onNavigate?.('bidding')} style={{
                                            display: 'flex', gap: 'var(--space-3)', alignItems: 'center',
                                            padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
                                            background: 'var(--color-bg-surface-hover)', cursor: 'pointer',
                                            transition: 'var(--transition-fast)',
                                        }}>
                                            <div style={{
                                                minWidth: 48, textAlign: 'center',
                                                fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)',
                                                color: 'var(--color-primary)',
                                                background: 'var(--color-primary-light)',
                                                padding: 'var(--space-1) var(--space-2)',
                                                borderRadius: 'var(--radius-sm)', lineHeight: 1.3,
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
                                            <CountdownBadge targetDate={item.sessionDate} compact />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* RADAR DO SISTEMA — actionable cards */}
                    <div className="stagger-children grid-3">
                        <RadarCard
                            icon={<Satellite size={18} />}
                            title="Captação PNCP"
                            value={pncpCount.toString()}
                            desc="no funil via PNCP"
                            color="var(--color-primary)"
                            bg="var(--color-primary-light)"
                            action="Buscar novas"
                            onClick={() => onNavigate?.('opportunities')}
                        />
                        <RadarCard
                            icon={<BrainCircuit size={18} />}
                            title="LicitIA"
                            value={aiCount.toString()}
                            desc={needsAiAnalysis.length > 0 ? `${needsAiAnalysis.length} sem análise` : 'editais analisados'}
                            color={needsAiAnalysis.length > 0 ? 'var(--color-warning)' : 'var(--color-ai)'}
                            bg={needsAiAnalysis.length > 0 ? 'var(--color-warning-bg)' : 'var(--color-ai-bg)'}
                            action={needsAiAnalysis.length > 0 ? 'Analisar' : 'Ver relatórios'}
                            onClick={() => onNavigate?.('intelligence')}
                        />
                        <RadarCard
                            icon={<FileCheck size={18} />}
                            title="Documentos"
                            value={expiringDocs.length > 0 ? `${expiringDocs.length} alerta${expiringDocs.length > 1 ? 's' : ''}` : 'OK'}
                            desc={expiringDocs.length > 0 ? 'requerem atenção' : 'tudo em dia'}
                            color={expiringDocs.length > 0 ? 'var(--color-danger)' : 'var(--color-success)'}
                            bg={expiringDocs.length > 0 ? 'var(--color-danger-bg)' : 'var(--color-success-bg)'}
                            action={expiringDocs.length > 0 ? 'Renovar' : 'Gerenciar'}
                            onClick={() => onNavigate?.('companies')}
                        />
                    </div>

                    {/* FUNIL — clickable bars */}
                    <div className="card" style={{ padding: 'var(--card-padding)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                            <h3 style={sectionTitleStyle}>Distribuição por Fase</h3>
                            <button onClick={() => onNavigate?.('bidding')} style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                fontSize: 'var(--text-xs)', color: 'var(--color-primary)', fontWeight: 'var(--font-semibold)',
                                display: 'flex', alignItems: 'center', gap: '4px',
                            }}>
                                Abrir funil <ExternalLink size={12} />
                            </button>
                        </div>
                        <div style={{ width: '100%', height: 200 }}>
                            <ResponsiveContainer>
                                <BarChart data={funnelData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                    <XAxis dataKey="name" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)' }}
                                        itemStyle={{ color: 'var(--color-text-primary)' }}
                                    />
                                    <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(_: any) => onNavigate?.('bidding')} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* META MENSAL */}
                    <div className="card" style={{ padding: 'var(--card-padding)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                            <h3 style={sectionTitleStyle}>
                                <TrendingUp size={18} color="var(--color-success)" />
                                Meta Mensal
                            </h3>
                            <button
                                onClick={() => { setEditingTarget(!editingTarget); setTargetInput(monthlyTarget ? monthlyTarget.toString() : ''); }}
                                style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)',
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                }}
                            >
                                <Edit3 size={12} /> {monthlyTarget > 0 ? 'Editar' : 'Definir meta'}
                            </button>
                        </div>

                        {editingTarget && (
                            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                                <input
                                    type="number"
                                    value={targetInput}
                                    onChange={(e) => setTargetInput(e.target.value)}
                                    placeholder="Ex: 500000"
                                    style={{
                                        flex: 1, padding: 'var(--space-2) var(--space-3)',
                                        borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
                                        background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)',
                                        fontSize: 'var(--text-sm)',
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            const val = Number(targetInput);
                                            setMonthlyTarget(val); localStorage.setItem('dashboard_monthly_target', val.toString());
                                            setEditingTarget(false);
                                        }
                                    }}
                                />
                                <button
                                    onClick={() => {
                                        const val = Number(targetInput);
                                        setMonthlyTarget(val); localStorage.setItem('dashboard_monthly_target', val.toString());
                                        setEditingTarget(false);
                                    }}
                                    style={{
                                        padding: 'var(--space-2) var(--space-3)',
                                        borderRadius: 'var(--radius-md)', border: 'none',
                                        background: 'var(--color-success)', color: 'white',
                                        fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)',
                                        cursor: 'pointer',
                                    }}
                                >
                                    Salvar
                                </button>
                            </div>
                        )}

                        {monthlyTarget > 0 ? (() => {
                            const progress = Math.min(100, Math.round((wonValue / monthlyTarget) * 100));
                            const remaining = Math.max(0, monthlyTarget - wonValue);
                            return (
                                <>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
                                        <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)' }}>
                                            {progress}%
                                        </span>
                                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                                            {fmt(wonValue)} / {fmt(monthlyTarget)}
                                        </span>
                                    </div>
                                    <div style={{
                                        height: 8, borderRadius: 'var(--radius-full)',
                                        background: 'var(--color-bg-surface-hover)', overflow: 'hidden',
                                        marginBottom: 'var(--space-2)',
                                    }}>
                                        <div style={{
                                            height: '100%', borderRadius: 'var(--radius-full)',
                                            width: `${progress}%`,
                                            background: progress >= 100 ? 'var(--color-success)' : progress >= 60 ? 'var(--color-primary)' : 'var(--color-warning)',
                                            transition: 'width 0.5s ease',
                                        }} />
                                    </div>
                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                                        {progress >= 100
                                            ? '🎉 Meta atingida! Parabéns!'
                                            : `Faltam ${fmt(remaining)} para atingir a meta`}
                                    </div>
                                </>
                            );
                        })() : (
                            <div style={{ textAlign: 'center', padding: 'var(--space-4)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>
                                <TrendingUp size={24} style={{ opacity: 0.2, marginBottom: 'var(--space-2)' }} />
                                <p style={{ margin: 0 }}>Defina uma meta mensal de faturamento para acompanhar seu progresso.</p>
                            </div>
                        )}
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

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', textAlign: 'center', marginBottom: 'var(--space-1)' }}>
                            {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
                                <div key={i} style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-tertiary)', padding: 'var(--space-1)' }}>{d}</div>
                            ))}
                        </div>

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

                    {/* AGENDA DO DIA SELECIONADO — actionable */}
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
                                <AgendaItem key={`s-${i}`} type="session" item={item} onClick={() => onNavigate?.('bidding')} />
                            ))}
                            {selectedEvents.reminders.map((item, i) => (
                                <AgendaItem key={`r-${i}`} type="reminder" item={item} onClick={() => onNavigate?.('bidding')} />
                            ))}
                        </div>
                    </div>

                    {/* PROCESSOS PARADOS — actionable */}
                    {stalledProcesses.length > 0 && (
                        <div className="card" style={{ padding: 'var(--card-padding)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                                <h3 style={sectionTitleStyle}>
                                    <AlertTriangle size={18} color="var(--color-warning)" />
                                    Processos Parados ({stalledProcesses.length})
                                </h3>
                                <button onClick={() => onNavigate?.('bidding')} style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    fontSize: 'var(--text-xs)', color: 'var(--color-warning)', fontWeight: 'var(--font-semibold)',
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                }}>
                                    Resolver <ArrowRight size={12} />
                                </button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                {stalledProcesses.slice(0, 4).map((item, i) => {
                                    const daysSince = Math.ceil((new Date().getTime() - new Date(item.sessionDate || new Date().toISOString()).getTime()) / (1000 * 60 * 60 * 24));
                                    return (
                                        <div key={i} onClick={() => onNavigate?.('bidding')} style={{
                                            display: 'flex', gap: 'var(--space-3)', alignItems: 'center',
                                            padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
                                            background: 'var(--color-warning-bg)',
                                            border: '1px solid var(--color-warning-border)',
                                            cursor: 'pointer', transition: 'var(--transition-fast)',
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
                                            <ArrowRight size={14} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
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

function KpiCard({ title, value, icon, color, bg, subtitle, onClick }: {
    title: string; value: string; icon: React.ReactNode; color: string; bg: string; subtitle?: string; onClick?: () => void;
}) {
    return (
        <div className="card card-interactive" style={{ padding: 'var(--card-padding)' }} onClick={onClick}>
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

function RadarCard({ title, value, desc, icon, color, bg, action, onClick }: {
    title: string; value: string; desc: string; icon: React.ReactNode; color: string; bg: string; action?: string; onClick?: () => void;
}) {
    return (
        <div className="card card-interactive" onClick={onClick} style={{
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
            {action && (
                <div style={{ fontSize: 'var(--text-xs)', color, fontWeight: 'var(--font-semibold)', marginTop: 'var(--space-1)' }}>
                    {action} →
                </div>
            )}
        </div>
    );
}

function MissionCard({ type, time, rawDate, title, subtitle, value: _value, onClick }: {
    type: 'session' | 'reminder'; time: string; rawDate?: string; title: string; subtitle?: string; value?: number; onClick?: () => void;
}) {
    const isSession = type === 'session';
    const borderColor = isSession ? 'var(--color-urgency)' : 'var(--color-warning)';
    const tagColor = isSession ? 'var(--color-urgency)' : 'var(--color-warning)';

    return (
        <div onClick={onClick} style={{
            display: 'flex', gap: 'var(--space-3)', alignItems: 'center',
            padding: 'var(--space-3) var(--space-4)',
            borderLeft: `3px solid ${borderColor}`,
            borderRadius: '0 var(--radius-md) var(--radius-md) 0',
            background: 'var(--color-bg-surface-hover)',
            cursor: onClick ? 'pointer' : undefined,
            transition: 'var(--transition-fast)',
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
            {isSession && rawDate ? <CountdownBadge targetDate={rawDate} compact /> : (
                <span className={isSession ? 'badge badge-urgency' : 'badge badge-warning'} style={{ flexShrink: 0 }}>
                    {isSession ? 'SESSÃO' : 'LEMBRETE'}
                </span>
            )}
        </div>
    );
}

function AgendaItem({ type, item, onClick }: { type: 'session' | 'reminder'; item: BiddingProcess; onClick?: () => void }) {
    const isSession = type === 'session';
    const time = isSession
        ? new Date(item.sessionDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : new Date(item.reminderDate!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    return (
        <div onClick={onClick} style={{
            padding: 'var(--space-3)',
            borderLeft: `3px solid ${isSession ? 'var(--color-danger)' : 'var(--color-warning)'}`,
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
            background: isSession ? 'var(--color-danger-bg)' : 'var(--color-warning-bg)',
            cursor: onClick ? 'pointer' : undefined,
            transition: 'var(--transition-fast)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '2px' }}>
                {isSession ? <Clock size={12} color="var(--color-danger)" /> : <Bell size={12} color="var(--color-warning)" />}
                <span style={{
                    fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)',
                    color: isSession ? 'var(--color-danger)' : 'var(--color-warning)',
                }}>
                    {isSession ? 'SESSÃO' : 'LEMBRETE'} · {time}
                </span>
                {isSession && (
                    <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--color-primary)', fontWeight: 'var(--font-semibold)' }}>
                        Abrir →
                    </span>
                )}
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
