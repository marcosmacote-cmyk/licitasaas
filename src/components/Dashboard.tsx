import React, { useState, useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
    Target, DollarSign, Award,
    Calendar as CalendarIcon, ChevronLeft, ChevronRight,
    AlertTriangle, FileWarning,
    ArrowRight, Timer, ChevronDown, ChevronUp,
    BrainCircuit, Satellite, FileCheck, ExternalLink, Eye,
    FileText, CheckCircle, Zap, Building2, TrendingUp, Edit3,
    Clock,
} from 'lucide-react';
import type { BiddingProcess, CompanyProfile } from '../types';
import {
    LiveCountdown, MetricCard, AlertCard, PipelineStep,
    RadarCard, MissionCard, AgendaItem, ProgressBar,
} from './ui';
import { useDashboardMetrics } from './hooks/useDashboardMetrics';

interface Props {
    items: BiddingProcess[];
    companies?: CompanyProfile[];
    onNavigate?: (tab: string, filter?: { statuses?: string[]; highlight?: string }) => void;
}

export function Dashboard({ items, companies = [], onNavigate }: Props) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [showAllAlerts, setShowAllAlerts] = useState(false);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
    const [monthlyTarget, setMonthlyTarget] = useState<number>(() => {
        const saved = localStorage.getItem('dashboard_monthly_target');
        return saved ? Number(saved) : 0;
    });
    const [editingTarget, setEditingTarget] = useState(false);
    const [targetInput, setTargetInput] = useState('');

    const m = useDashboardMetrics(items, selectedCompanyId);

    // ── Critical Alerts (derived) ──
    const criticalAlerts = useMemo(() => {
        const alerts: { type: 'danger' | 'warning' | 'urgency'; icon: React.ReactNode; message: string; action: string; count?: number; dest?: string }[] = [];
        const vencidoDocs = m.expiringDocs.filter((d: any) => d.status === 'vencido');
        const alertaDocs = m.expiringDocs.filter((d: any) => d.status === 'critico' || d.status === 'alerta');

        if (vencidoDocs.length > 0) {
            alerts.push({ type: 'danger', icon: <FileWarning size={16} />, message: `${vencidoDocs.length} documento${vencidoDocs.length > 1 ? 's' : ''} vencido${vencidoDocs.length > 1 ? 's' : ''} — impeditivo para participação`, action: 'Renovar agora →', count: vencidoDocs.length, dest: 'companies' });
        }
        if (m.todaySessions.length > 0) {
            alerts.push({ type: 'urgency', icon: <Timer size={16} />, message: `${m.todaySessions.length} sessão${m.todaySessions.length > 1 ? 'ões' : ''} de licitação HOJE`, action: 'Ver sessões →', count: m.todaySessions.length, dest: 'bidding' });
        }
        if (alertaDocs.length > 0) {
            alerts.push({ type: 'warning', icon: <Clock size={16} />, message: `${alertaDocs.length} documento${alertaDocs.length > 1 ? 's' : ''} vencendo nos próximos 30 dias`, action: 'Verificar →', count: alertaDocs.length, dest: 'companies' });
        }
        if (m.stalledProcesses.length > 0) {
            alerts.push({ type: 'warning', icon: <AlertTriangle size={16} />, message: `${m.stalledProcesses.length} processo${m.stalledProcesses.length > 1 ? 's' : ''} parado${m.stalledProcesses.length > 1 ? 's' : ''} há mais de 7 dias`, action: 'Mover no funil →', count: m.stalledProcesses.length, dest: 'bidding' });
        }
        if (m.needsAiAnalysis.length > 0) {
            alerts.push({ type: 'warning', icon: <BrainCircuit size={16} />, message: `${m.needsAiAnalysis.length} edital${m.needsAiAnalysis.length > 1 ? 'is' : ''} em análise sem parecer da IA`, action: 'Analisar com IA →', count: m.needsAiAnalysis.length, dest: 'intelligence' });
        }
        return alerts;
    }, [m.expiringDocs, m.todaySessions, m.stalledProcesses, m.needsAiAnalysis]);

    // ── Funnel Data ──
    const statusCounts = items.reduce((acc, curr) => { acc[curr.status] = (acc[curr.status] || 0) + 1; return acc; }, {} as Record<string, number>);
    const funnelData = [
        { name: 'Captado', count: statusCounts['Captado'] || 0, fill: 'var(--color-neutral)' },
        { name: 'Em Análise', count: statusCounts['Em Análise de Edital'] || 0, fill: 'var(--color-primary)' },
        { name: 'Preparando', count: statusCounts['Preparando Documentação'] || 0, fill: 'var(--color-urgency)' },
        { name: 'Participando', count: statusCounts['Participando'] || 0, fill: 'var(--color-warning)' },
        { name: 'Vencido', count: statusCounts['Vencido'] || 0, fill: 'var(--color-success)' },
        { name: 'Perdido', count: statusCounts['Perdido'] || 0, fill: 'var(--color-danger)' },
    ];

    // ── Calendar ──
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

    const pipelineSteps = [
        { label: 'Captados', count: m.captadoItems.length, icon: <Satellite size={14} />, color: 'var(--color-neutral)', action: 'Triar', statuses: ['Captado'] },
        { label: 'Em Análise', count: m.emAnaliseItems.length, icon: <Eye size={14} />, color: 'var(--color-primary)', action: 'Analisar', statuses: ['Em Análise de Edital'] },
        { label: 'Preparando', count: m.preparandoItems.length, icon: <FileText size={14} />, color: 'var(--color-urgency)', action: 'Documentar', statuses: ['Preparando Documentação'] },
        { label: 'Participando', count: m.participandoItems.length, icon: <Zap size={14} />, color: 'var(--color-warning)', action: 'Acompanhar', statuses: ['Participando'] },
    ];

    const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);
    const today = new Date();

    return (
        <div className="page-container" style={{ maxWidth: '1400px', margin: '0 auto' }}>
            {/* HEADER */}
            <div className="breadcrumb"><span className="breadcrumb-current">Painel</span></div>
            <div className="page-header" style={{ marginBottom: 'var(--space-5)' }}>
                <div>
                    <h1 className="page-title">Painel de Licitações</h1>
                    <p className="page-subtitle">{today.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                </div>
                {companies.length > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <Building2 size={16} style={{ color: 'var(--color-text-tertiary)' }} />
                        <select
                            value={selectedCompanyId}
                            onChange={(e) => setSelectedCompanyId(e.target.value)}
                            style={{
                                padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)',
                                color: 'var(--color-text-primary)', fontSize: 'var(--text-sm)', cursor: 'pointer', minWidth: 180,
                            }}
                        >
                            <option value="">Todas as empresas</option>
                            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                )}
            </div>

            {/* ═══ CRITICAL ALERTS ═══ */}
            {criticalAlerts.length > 0 && (
                <div className="animate-fade-in-down" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-5)' }}>
                    {(showAllAlerts ? criticalAlerts : criticalAlerts.slice(0, 3)).map((alert, i) => (
                        <AlertCard key={i} type={alert.type} icon={alert.icon} message={alert.message} action={alert.action} onClick={alert.dest ? () => onNavigate?.(alert.dest!) : undefined} />
                    ))}
                    {criticalAlerts.length > 3 && (
                        <button onClick={() => setShowAllAlerts(!showAllAlerts)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)', padding: 'var(--space-1) 0' }}>
                            {showAllAlerts ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            {showAllAlerts ? 'Ocultar' : `Mais ${criticalAlerts.length - 3} alerta(s)`}
                        </button>
                    )}
                </div>
            )}

            {/* ═══ KPIs ═══ */}
            <div className="stagger-children grid-4" style={{ marginBottom: 'var(--space-5)' }}>
                <MetricCard title="Volume no Funil" value={fmt(m.totalValue)} icon={<DollarSign size={18} />} color="var(--color-primary)" bg="var(--color-primary-light)" subtitle={`${m.activeItems.length} processos ativos`} onClick={() => onNavigate?.('bidding', { statuses: ['Captado', 'Em Análise de Edital', 'Preparando Documentação', 'Participando'] })} />
                <MetricCard title="Volume Ganho (YTD)" value={fmt(m.wonValue)} icon={<Award size={18} />} color="var(--color-success)" bg="var(--color-success-bg)" subtitle={`${m.wonItems.length} licitações vencidas`} onClick={() => onNavigate?.('bidding', { statuses: ['Vencido'] })} />
                <MetricCard title="Taxa de Sucesso" value={`${m.winRate}%`} icon={<Target size={18} />} color={m.winRate >= 50 ? 'var(--color-success)' : m.winRate >= 30 ? 'var(--color-warning)' : 'var(--color-danger)'} bg={m.winRate >= 50 ? 'var(--color-success-bg)' : m.winRate >= 30 ? 'var(--color-warning-bg)' : 'var(--color-danger-bg)'} subtitle={`${m.wonItems.length} de ${m.totalFinished} finalizados`} onClick={() => onNavigate?.('bidding', { statuses: ['Vencido', 'Perdido', 'Sem Sucesso'] })} />
                <MetricCard title="Próximas Sessões" value={(m.todaySessions.length + m.upcomingSessions.length).toString()} icon={<CalendarIcon size={18} />} color={m.todaySessions.length > 0 ? 'var(--color-danger)' : 'var(--color-primary)'} bg={m.todaySessions.length > 0 ? 'var(--color-danger-bg)' : 'var(--color-primary-light)'} subtitle={m.todaySessions.length > 0 ? `⚡ ${m.todaySessions.length} HOJE` : 'nos próximos 7 dias'} onClick={() => onNavigate?.('bidding')} />
            </div>

            {/* ═══ PIPELINE ═══ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-2)', marginBottom: 'var(--space-5)' }}>
                {pipelineSteps.map((step, i) => (
                    <PipelineStep key={i} label={step.label} count={step.count} icon={step.icon} color={step.color} action={step.action} onClick={() => onNavigate?.('bidding', { statuses: step.statuses })} />
                ))}
            </div>

            {/* ═══ MAIN GRID ═══ */}
            <div className="grid-2-1">
                {/* LEFT COLUMN */}
                <div className="flex-col gap-5">

                    {/* MISSÕES DO DIA */}
                    <div className="card" style={{ padding: 'var(--card-padding)' }}>
                        <div className="flex-between mb-4">
                            <h3 className="dash-section-title"><Timer size={18} color="var(--color-urgency)" /> Missões do Dia</h3>
                            <span className="badge badge-urgency">{m.todaySessions.length + m.todayReminders.length} pendente{m.todaySessions.length + m.todayReminders.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex-col gap-2">
                            {m.todaySessions.length === 0 && m.todayReminders.length === 0 && (
                                <div className="empty-state">
                                    <CheckCircle size={28} style={{ opacity: 0.2, marginBottom: 'var(--space-2)', color: 'var(--color-success)' }} />
                                    <p style={{ margin: 0 }}>Nenhuma sessão ou lembrete para hoje.</p>
                                    {m.upcomingSessions.length > 0 && (
                                        <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-sm)' }}>
                                            Próxima sessão: <strong style={{ color: 'var(--color-text-primary)' }}>{new Date(m.upcomingSessions[0].sessionDate).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</strong>
                                        </p>
                                    )}
                                </div>
                            )}
                            {m.todaySessions.map((item, i) => (
                                <MissionCard key={`s-${i}`} type="session" time={new Date(item.sessionDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} rawDate={item.sessionDate} title={item.title} subtitle={item.modality} onClick={() => onNavigate?.('bidding')} />
                            ))}
                            {m.todayReminders.map((item, i) => (
                                <MissionCard key={`r-${i}`} type="reminder" time={new Date(item.reminderDate!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} title={item.title} subtitle={'Lembrete'} onClick={() => onNavigate?.('bidding')} />
                            ))}
                        </div>
                    </div>

                    {/* PRÓXIMAS SESSÕES */}
                    {m.upcomingSessions.length > 0 && (
                        <div className="card" style={{ padding: 'var(--card-padding)' }}>
                            <div className="flex-between mb-3">
                                <h3 className="dash-section-title"><CalendarIcon size={18} color="var(--color-primary)" /> Próximas Sessões</h3>
                                <button onClick={() => onNavigate?.('bidding')} className="btn-link" style={{ fontSize: 'var(--text-xs)' }}>
                                    Ver todas <ExternalLink size={12} />
                                </button>
                            </div>
                            <div className="flex-col gap-2">
                                {m.upcomingSessions.slice(0, 5).map((item, i) => {
                                    const d = new Date(item.sessionDate);
                                    return (
                                        <div key={i} onClick={() => onNavigate?.('bidding')} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-surface-hover)', cursor: 'pointer', transition: 'var(--transition-fast)' }}>
                                            <div style={{ minWidth: 48, textAlign: 'center', fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)', lineHeight: 1.3 }}>
                                                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)' }}>{d.getDate()}</div>
                                                <div>{d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</div>
                                            </div>
                                            <div className="flex-1">
                                                <div style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-medium)', color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                                                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>{d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {item.modality || item.portal}</div>
                                            </div>
                                            <LiveCountdown targetDate={item.sessionDate} compact />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* RADAR DO SISTEMA */}
                    <div className="stagger-children grid-3">
                        <RadarCard icon={<Satellite size={18} />} title="Captação PNCP" value={m.pncpCount.toString()} desc="no funil via PNCP" color="var(--color-primary)" bg="var(--color-primary-light)" action="Buscar novas" onClick={() => onNavigate?.('opportunities')} />
                        <RadarCard icon={<BrainCircuit size={18} />} title="LicitIA" value={m.aiCount.toString()} desc={m.needsAiAnalysis.length > 0 ? `${m.needsAiAnalysis.length} sem análise` : 'editais analisados'} color={m.needsAiAnalysis.length > 0 ? 'var(--color-warning)' : 'var(--color-ai)'} bg={m.needsAiAnalysis.length > 0 ? 'var(--color-warning-bg)' : 'var(--color-ai-bg)'} action={m.needsAiAnalysis.length > 0 ? 'Analisar' : 'Ver relatórios'} onClick={() => onNavigate?.('intelligence')} />
                        <RadarCard icon={<FileCheck size={18} />} title="Documentos" value={m.expiringDocs.length > 0 ? `${m.expiringDocs.length} alerta${m.expiringDocs.length > 1 ? 's' : ''}` : 'OK'} desc={m.expiringDocs.length > 0 ? 'requerem atenção' : 'tudo em dia'} color={m.expiringDocs.length > 0 ? 'var(--color-danger)' : 'var(--color-success)'} bg={m.expiringDocs.length > 0 ? 'var(--color-danger-bg)' : 'var(--color-success-bg)'} action={m.expiringDocs.length > 0 ? 'Renovar' : 'Gerenciar'} onClick={() => onNavigate?.('companies')} />
                    </div>

                    {/* FUNIL */}
                    <div className="card" style={{ padding: 'var(--card-padding)' }}>
                        <div className="flex-between mb-2">
                            <h3 className="dash-section-title">Distribuição por Fase</h3>
                            <button onClick={() => onNavigate?.('bidding')} className="btn-link" style={{ fontSize: 'var(--text-xs)' }}>
                                Abrir funil <ExternalLink size={12} />
                            </button>
                        </div>
                        <div style={{ width: '100%', height: 200 }}>
                            <ResponsiveContainer>
                                <BarChart data={funnelData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                    <XAxis dataKey="name" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                                    <Tooltip contentStyle={{ backgroundColor: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)' }} itemStyle={{ color: 'var(--color-text-primary)' }} />
                                    <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} cursor="pointer" onClick={() => onNavigate?.('bidding')} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* META MENSAL */}
                    <div className="card" style={{ padding: 'var(--card-padding)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                            <h3 className="dash-section-title"><TrendingUp size={18} color="var(--color-success)" /> Meta Mensal</h3>
                            <button onClick={() => { setEditingTarget(!editingTarget); setTargetInput(monthlyTarget ? monthlyTarget.toString() : ''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Edit3 size={12} /> {monthlyTarget > 0 ? 'Editar' : 'Definir meta'}
                            </button>
                        </div>

                        {editingTarget && (
                            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                                <input type="number" value={targetInput} onChange={(e) => setTargetInput(e.target.value)} placeholder="Ex: 500000" style={{ flex: 1, padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', fontSize: 'var(--text-sm)' }} onKeyDown={(e) => { if (e.key === 'Enter') { const val = Number(targetInput); setMonthlyTarget(val); localStorage.setItem('dashboard_monthly_target', val.toString()); setEditingTarget(false); } }} />
                                <button onClick={() => { const val = Number(targetInput); setMonthlyTarget(val); localStorage.setItem('dashboard_monthly_target', val.toString()); setEditingTarget(false); }} style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-success)', color: 'white', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', cursor: 'pointer' }}>Salvar</button>
                            </div>
                        )}

                        {monthlyTarget > 0 ? (() => {
                            const progress = Math.min(100, Math.round((m.wonValue / monthlyTarget) * 100));
                            const remaining = Math.max(0, monthlyTarget - m.wonValue);
                            return (
                                <>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
                                        <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)' }}>{progress}%</span>
                                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>{fmt(m.wonValue)} / {fmt(monthlyTarget)}</span>
                                    </div>
                                    <ProgressBar value={m.wonValue} max={monthlyTarget} label={progress >= 100 ? '🎉 Meta atingida! Parabéns!' : `Faltam ${fmt(remaining)} para atingir a meta`} />
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

                {/* RIGHT COLUMN */}
                <div className="flex-col gap-5">

                    {/* CALENDÁRIO */}
                    <div className="card" style={{ padding: 'var(--card-padding)' }}>
                        <div className="flex-between mb-4">
                            <h3 className="dash-section-title" style={{ marginBottom: 0 }}><CalendarIcon size={18} color="var(--color-primary)" /> Calendário</h3>
                            <div className="flex-center gap-2">
                                <button onClick={prevMonth} className="dash-cal-btn"><ChevronLeft size={14} /></button>
                                <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)', minWidth: 120, textAlign: 'center' }}>{monthNames[month]} {year}</span>
                                <button onClick={nextMonth} className="dash-cal-btn"><ChevronRight size={14} /></button>
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
                                const isToday = m.todayStr === dateKey;
                                const dayEvents = processEvents[dateKey];
                                const hasSessions = dayEvents?.sessions?.length > 0;
                                const hasReminders = dayEvents?.reminders?.length > 0;

                                return (
                                    <button key={d} onClick={() => setSelectedDate(dateObj)} style={{
                                        padding: '6px 2px', fontSize: 'var(--text-base)', fontWeight: 'var(--font-medium)',
                                        borderRadius: 'var(--radius-sm)', cursor: 'pointer', transition: 'all 150ms',
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 36,
                                        background: isSelected ? 'var(--color-primary)' : isToday ? 'var(--color-bg-surface-hover)' : 'transparent',
                                        color: isSelected ? 'white' : 'var(--color-text-primary)',
                                        border: isToday && !isSelected ? '1px solid var(--color-primary)' : '1px solid transparent',
                                    }}>
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

                    {/* AGENDA DO DIA */}
                    <div className="card" style={{ padding: 'var(--card-padding)', flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <div className="flex-between mb-4">
                            <h3 className="dash-section-title" style={{ marginBottom: 0 }}>{selectedDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</h3>
                            {selectedDateKey === m.todayStr && <span className="badge badge-danger" style={{ fontSize: 'var(--text-xs)' }}>HOJE</span>}
                        </div>
                        <div className="flex-col gap-2" style={{ flex: 1, overflowY: 'auto' }}>
                            {selectedEvents.sessions.length === 0 && selectedEvents.reminders.length === 0 && (
                                <div style={{ textAlign: 'center', padding: 'var(--space-8) 0', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-md)', margin: 'auto' }}>
                                    <CalendarIcon size={28} style={{ opacity: 0.15, marginBottom: 'var(--space-2)' }} />
                                    <p>Nenhuma ação neste dia.</p>
                                </div>
                            )}
                            {selectedEvents.sessions.map((item, i) => (
                                <AgendaItem key={`s-${i}`} type="session" title={item.title} time={new Date(item.sessionDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} onClick={() => onNavigate?.('bidding')} />
                            ))}
                            {selectedEvents.reminders.map((item, i) => (
                                <AgendaItem key={`r-${i}`} type="reminder" title={item.title} time={new Date(item.reminderDate!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} onClick={() => onNavigate?.('bidding')} />
                            ))}
                        </div>
                    </div>

                    {/* PROCESSOS PARADOS */}
                    {m.stalledProcesses.length > 0 && (
                        <div className="card" style={{ padding: 'var(--card-padding)' }}>
                            <div className="flex-between mb-3">
                                <h3 className="dash-section-title"><AlertTriangle size={18} color="var(--color-warning)" /> Processos Parados ({m.stalledProcesses.length})</h3>
                                <button onClick={() => onNavigate?.('bidding')} className="btn-link" style={{ color: 'var(--color-warning)', fontSize: 'var(--text-xs)' }}>
                                    Resolver <ArrowRight size={12} />
                                </button>
                            </div>
                            <div className="flex-col gap-2">
                                {m.stalledProcesses.slice(0, 4).map((item, i) => {
                                    const daysSince = Math.ceil((new Date().getTime() - new Date(item.sessionDate || new Date().toISOString()).getTime()) / (1000 * 60 * 60 * 24));
                                    return (
                                        <div key={i} onClick={() => onNavigate?.('bidding')} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning-border)', cursor: 'pointer', transition: 'var(--transition-fast)' }}>
                                            <div className="flex-1">
                                                <div style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-medium)', color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                                                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-warning)' }}>{item.status} · parado há {daysSince} dias</div>
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

