import { useState, useEffect } from 'react';
import { ScanSearch, FileCheck, DollarSign, AlertTriangle, X, Send, Loader2, MessageSquare, Calendar, ShieldAlert, BadgeCheck, FileX, CheckCircle2, FileSearch2, Plus, BarChart3, Building2 } from 'lucide-react';
import type { AiAnalysis, BiddingProcess } from '../types';
import { useAiChat } from './hooks/useAiChat';
import { useAiReport } from './hooks/useAiReport';

interface Props {
    analysis: AiAnalysis;
    process: BiddingProcess;
    onClose: () => void;
    onUpdate: () => void;
    onImport?: () => void;
}

export function AiReportModal({ analysis, process, onClose, onUpdate, onImport }: Props) {
    const [activeTab, setActiveTab] = useState<'report' | 'chat'>('report');

    const {
        messages, inputText, setInputText, isSending,
        messagesEndRef, scrollToBottom, handleSendMessage,
    } = useAiChat({ analysis, process, onUpdate });

    const report = useAiReport({ analysis, process });

    useEffect(() => {
        if (activeTab === 'chat') scrollToBottom();
    }, [messages, activeTab]);

    // Simple Markdown renderer for AI chat messages
    const renderMarkdown = (text: string) => {
        const lines = text.split('\n');
        const elements: React.ReactNode[] = [];
        let listItems: React.ReactNode[] = [];
        let listType: 'ol' | 'ul' | null = null;
        let key = 0;

        const flushList = () => {
            if (listItems.length > 0 && listType) {
                const ListTag = listType;
                elements.push(<ListTag key={`list-${key++}`} style={{ margin: '8px 0', paddingLeft: '20px', lineHeight: 1.7 }}>{listItems}</ListTag>);
                listItems = []; listType = null;
            }
        };

        const formatInline = (str: string): React.ReactNode[] => {
            const parts: React.ReactNode[] = [];
            const regex = /\*\*(.+?)\*\*/g;
            let lastIndex = 0; let match; let idx = 0;
            while ((match = regex.exec(str)) !== null) {
                if (match.index > lastIndex) parts.push(str.slice(lastIndex, match.index));
                parts.push(<strong key={`b-${idx++}`} style={{ fontWeight: 700 }}>{match[1]}</strong>);
                lastIndex = regex.lastIndex;
            }
            if (lastIndex < str.length) parts.push(str.slice(lastIndex));
            return parts.length > 0 ? parts : [str];
        };

        for (const line of lines) {
            const trimmed = line.trim();
            const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
            if (orderedMatch) { if (listType !== 'ol') { flushList(); listType = 'ol'; } listItems.push(<li key={`li-${key++}`}>{formatInline(orderedMatch[2])}</li>); continue; }
            const bulletMatch = trimmed.match(/^[-•*]\s+(.+)$/);
            if (bulletMatch) { if (listType !== 'ul') { flushList(); listType = 'ul'; } listItems.push(<li key={`li-${key++}`}>{formatInline(bulletMatch[1])}</li>); continue; }
            flushList();
            if (trimmed.startsWith('### ')) { elements.push(<h4 key={`h-${key++}`} style={{ fontWeight: 700, fontSize: '0.95rem', marginTop: '16px', marginBottom: '4px', color: 'var(--color-text-primary)' }}>{formatInline(trimmed.slice(4))}</h4>); continue; }
            if (trimmed.startsWith('## ')) { elements.push(<h3 key={`h-${key++}`} style={{ fontWeight: 700, fontSize: '1.05rem', marginTop: '18px', marginBottom: '6px', color: 'var(--color-text-primary)' }}>{formatInline(trimmed.slice(3))}</h3>); continue; }
            if (trimmed.startsWith('# ')) { elements.push(<h2 key={`h-${key++}`} style={{ fontWeight: 800, fontSize: '1.1rem', marginTop: '20px', marginBottom: '8px', color: 'var(--color-text-primary)' }}>{formatInline(trimmed.slice(2))}</h2>); continue; }
            if (trimmed === '---') { elements.push(<hr key={`hr-${key++}`} style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '12px 0' }} />); continue; }
            if (!trimmed) { elements.push(<div key={`br-${key++}`} style={{ height: '8px' }} />); continue; }
            elements.push(<p key={`p-${key++}`} style={{ margin: '4px 0', lineHeight: 1.7 }}>{formatInline(trimmed)}</p>);
        }
        flushList();
        return elements;
    };

    const severityColor = (sev: string) => {
        switch (sev) {
            case 'critica': return { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', badge: '#dc2626' };
            case 'alta': return { bg: '#fff7ed', border: '#fdba74', text: '#9a3412', badge: '#ea580c' };
            case 'media': return { bg: '#fffbeb', border: '#fcd34d', text: '#92400e', badge: '#d97706' };
            case 'baixa': return { bg: '#f0fdf4', border: '#86efac', text: '#166534', badge: '#16a34a' };
            default: return { bg: '#f8fafc', border: '#cbd5e1', text: '#475569', badge: '#64748b' };
        }
    };

    const [expandedChildren, setExpandedChildren] = useState<Record<string, boolean>>({});
    const toggleChildren = (key: string) => setExpandedChildren(prev => ({ ...prev, [key]: !prev[key] }));
    const [showSecondaryDeadlines, setShowSecondaryDeadlines] = useState(false);

    const hasRequirements = Object.keys(report.categorizedDocs).length > 0;
    const hasRisks = report.flagList.length > 0;
    const hasDeadlines = report.criticalDeadlines.length > 0 || report.secondaryDeadlines.length > 0;
    const hasFinancial = report.hasContent(report.financialText);
    const hasPenalties = report.hasContent(report.penaltiesText);
    const hasItems = report.hasContent(report.biddingItemsText);

    const hasConditions = report.conditions.length > 0;
    const hasTechnicalOpinion = report.hasContent(report.technicalOpinion);

    return (
        <div className="modal-overlay" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(8px)', animation: 'fadeIn 0.25s ease-out'
        }}>
            <div className="modal-content" style={{
                maxWidth: '1060px', width: '95%', height: '92vh', borderRadius: 'var(--radius-xl)',
                boxShadow: 'var(--shadow-xl)', overflow: 'hidden', backgroundColor: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)', animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                display: 'flex', flexDirection: 'column'
            }}>
                {/* Header */}
                <div style={{
                    padding: 'var(--space-6) var(--space-10)',
                    background: 'linear-gradient(135deg, var(--color-text-primary) 0%, var(--color-bg-surface-hover) 100%)',
                    color: 'white', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                            <div style={{ padding: 'var(--space-3)', background: 'linear-gradient(135deg, var(--color-primary), var(--color-ai))', borderRadius: 'var(--radius-xl)', boxShadow: '0 0 20px rgba(59, 130, 246, 0.4)' }}>
                                <ScanSearch size={24} color="white" />
                            </div>
                            <div>
                                <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, margin: 0, letterSpacing: '-0.025em' }}>
                                    Análise Estratégica <span style={{ color: 'var(--color-primary-border)' }}>IA</span>
                                </h2>
                                <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', marginTop: '2px', maxWidth: '500px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {process?.title}
                                </p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                            {report.pipelineMeta && (
                                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                                    {report.pipelineMeta.confidence && (
                                        <span style={{
                                            padding: '4px 12px', borderRadius: 'var(--radius-full)', fontSize: '0.75rem', fontWeight: 700,
                                            background: report.pipelineMeta.confidence === 'alta' ? 'rgba(34,197,94,0.2)' : report.pipelineMeta.confidence === 'media' ? 'rgba(234,179,8,0.2)' : 'rgba(239,68,68,0.2)',
                                            color: report.pipelineMeta.confidence === 'alta' ? '#4ade80' : report.pipelineMeta.confidence === 'media' ? '#fbbf24' : '#f87171',
                                            border: `1px solid ${report.pipelineMeta.confidence === 'alta' ? 'rgba(34,197,94,0.3)' : report.pipelineMeta.confidence === 'media' ? 'rgba(234,179,8,0.3)' : 'rgba(239,68,68,0.3)'}`
                                        }}>
                                            {report.pipelineMeta.confidence === 'alta' ? '●' : report.pipelineMeta.confidence === 'media' ? '●' : '●'} Confiança {report.pipelineMeta.confidence}
                                        </span>
                                    )}
                                    {report.pipelineMeta.scorePercentage !== null && (
                                        <span style={{ padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: '0.7rem', fontWeight: 700, background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}>
                                            {report.pipelineMeta.scorePercentage}%
                                        </span>
                                    )}
                                </div>
                            )}
                            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', cursor: 'pointer', padding: '8px', borderRadius: '50%', transition: 'all 0.2s' }}
                                onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
                                onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}>
                                <X size={20} />
                            </button>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
                        <button onClick={() => setActiveTab('report')} className="ai-tab-btn"
                            style={{ color: activeTab === 'report' ? 'var(--color-primary)' : 'var(--color-text-tertiary)', borderBottom: activeTab === 'report' ? '3px solid var(--color-primary)' : '3px solid transparent' }}>
                            <FileCheck size={18} /> Relatório Analítico
                        </button>
                        <button onClick={() => setActiveTab('chat')} className="ai-tab-btn"
                            style={{ color: activeTab === 'chat' ? 'var(--color-primary)' : 'var(--color-text-tertiary)', borderBottom: activeTab === 'chat' ? '3px solid var(--color-primary)' : '3px solid transparent' }}>
                            <MessageSquare size={18} /> Consultor de Edital
                        </button>
                    </div>
                </div>

                {/* Content Area */}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
                    {activeTab === 'report' ? (
                        <div style={{ flex: 1, padding: 'var(--space-8)', overflowY: 'auto', background: 'var(--color-bg-base)' }}>

                            {/* ─── ROW 1: Key Indicators ─── */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
                                {/* Valor Estimado */}
                                <div style={{ padding: 'var(--space-4)', background: 'var(--color-success-bg)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-success-border)' }}>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-success)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <DollarSign size={13} /> Valor Estimado
                                    </div>
                                    <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--color-success-hover)' }}>
                                        {process?.estimatedValue ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(process?.estimatedValue) : 'Não informado'}
                                    </div>
                                </div>

                                {/* Sessão */}
                                <div style={{ padding: 'var(--space-4)', background: 'var(--color-primary-light)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-primary-border)' }}>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-primary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Calendar size={13} /> Sessão
                                    </div>
                                    <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--color-primary-hover)' }}>
                                        {process?.sessionDate ? new Date(process?.sessionDate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Não informado'}
                                    </div>
                                </div>

                                {/* Riscos */}
                                {hasRisks && (
                                    <div style={{ padding: 'var(--space-4)', background: 'var(--color-danger-bg)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-danger-border)' }}>
                                        <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-danger)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <AlertTriangle size={13} /> Riscos
                                        </div>
                                        <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--color-danger-hover)' }}>
                                            {report.flagList.length} {report.flagList.length === 1 ? 'ponto' : 'pontos'}
                                        </div>
                                    </div>
                                )}

                                {/* Exigências */}
                                {hasRequirements && (
                                    <div style={{ padding: 'var(--space-4)', background: 'var(--color-warning-bg)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-warning-border)' }}>
                                        <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-warning)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <BadgeCheck size={13} /> Exigências
                                        </div>
                                        <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--color-warning-hover)' }}>
                                            {report.mainRequirementCount}
                                            <span style={{ fontSize: '0.65rem', fontWeight: 500, color: 'var(--color-warning)', marginLeft: '6px' }}>
                                                ({Object.keys(report.categorizedDocs).length} cat.{report.allDocsList.length > report.mainRequirementCount ? ` + ${report.allDocsList.length - report.mainRequirementCount} subitens` : ''})
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* ─── BLOCO FIXO: Metadados do Processo ─── */}
                            <div style={{
                                background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-lg)',
                                border: '1px solid var(--color-border)', padding: 'var(--space-4) var(--space-5)',
                                marginBottom: 'var(--space-4)'
                            }}>
                                <div style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <Building2 size={11} /> Metadados do Processo
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-2) var(--space-6)' }}>
                                    {([ 
                                        { label: 'Objeto', value: report.processMetadata.objeto, span: true },
                                        { label: 'Órgão / Entidade', value: report.processMetadata.orgao },
                                        { label: 'Nº do Processo', value: report.processMetadata.numeroProcesso },
                                        { label: 'Modalidade', value: report.processMetadata.modalidade },
                                        { label: 'Critério de Julgamento', value: report.processMetadata.criterioJulgamento },
                                        { label: 'Regime de Execução', value: report.processMetadata.regimeExecucao },
                                        { label: 'Local', value: report.processMetadata.local },
                                        { label: 'Sessão', value: report.processMetadata.dataSessao },
                                        { label: 'Valor Estimado', value: report.processMetadata.valorEstimado },
                                    ] as { label: string; value: string | null; span?: boolean }[]).map((item, i) => (
                                        <div key={i} style={item.span ? { gridColumn: '1 / -1' } : {}}>
                                            <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', display: 'block' }}>
                                                {item.label}
                                            </span>
                                            <span style={{
                                                fontSize: item.span ? 'var(--text-sm)' : '0.8rem',
                                                fontWeight: item.value ? 600 : 400,
                                                color: item.value ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                                                fontStyle: item.value ? 'normal' : 'italic',
                                                lineHeight: 1.4, display: 'block'
                                            }}>
                                                {item.value || 'Não informado'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                {report.processMetadata.fonteOficial && (
                                    <div style={{ marginTop: 'var(--space-2)', fontSize: '0.6rem', color: 'var(--color-text-tertiary)' }}>
                                        📄 {report.processMetadata.fonteOficial}
                                    </div>
                                )}
                            </div>

                            {/* ─── ROW 2: Conditions Tags (V2 only) — grouped by theme ─── */}
                            {hasConditions && (() => {
                                const vedacoes = report.conditions.filter((c: any) => c.label.startsWith('Vedação'));
                                const processConditions = report.conditions.filter((c: any) => !c.label.startsWith('Vedação'));
                                return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
                                        {/* Process conditions as tags */}
                                        {processConditions.length > 0 && (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                                                {processConditions.map((c: any, i: number) => (
                                                    <span key={i} style={{
                                                        padding: '4px 12px', borderRadius: 'var(--radius-full)', fontSize: '0.75rem', fontWeight: 600,
                                                        background: c.type === 'danger' ? 'var(--color-danger-bg)' : c.type === 'warning' ? 'var(--color-warning-bg)' : 'var(--color-bg-secondary)',
                                                        color: c.type === 'danger' ? 'var(--color-danger-hover)' : c.type === 'warning' ? 'var(--color-warning-hover)' : 'var(--color-text-secondary)',
                                                        border: `1px solid ${c.type === 'danger' ? 'var(--color-danger-border)' : c.type === 'warning' ? 'var(--color-warning-border)' : 'var(--color-border)'}`
                                                    }}>
                                                        {c.label}: {c.value}
                                                        {c.sourceRef && c.sourceRef !== 'referência não localizada' && (
                                                            <span style={{ fontSize: '0.6rem', fontWeight: 400, opacity: 0.75, marginLeft: '4px' }}>
                                                                📄 {c.sourceRef}
                                                            </span>
                                                        )}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        {/* Vedações grouped in a compact block */}
                                        {vedacoes.length > 0 && (
                                            <div style={{
                                                padding: '8px 12px', borderRadius: 'var(--radius-lg)',
                                                background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning-border)'
                                            }}>
                                                <div style={{
                                                    fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-warning-hover)',
                                                    marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px'
                                                }}>
                                                    🚫 Vedações de Participação
                                                    <span style={{
                                                        background: 'var(--color-warning-hover)', color: 'white',
                                                        fontSize: '0.6rem', padding: '1px 6px', borderRadius: 'var(--radius-full)', fontWeight: 800
                                                    }}>{vedacoes.length}</span>
                                                    {vedacoes[0]?.sourceRef && (
                                                        <span style={{ fontSize: '0.6rem', fontWeight: 400, opacity: 0.7, marginLeft: '4px' }}>
                                                            📄 {vedacoes[0].sourceRef}
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                    {vedacoes.map((v: any, i: number) => (
                                                        <span key={i} style={{ fontSize: '0.73rem', color: 'var(--color-warning-hover)', lineHeight: 1.4 }}>
                                                            • {v.value}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* ─── Main 2-Column Layout ─── */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(0, 1fr)', gap: 'var(--space-8)' }}>
                                {/* LEFT COLUMN */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
                                    {/* Executive Summary */}
                                    {report.hasContent(report.executiveSummary) && (
                                        <div className="report-card">
                                            <h3 className="ai-section-header"><FileSearch2 size={18} /> Resumo Executivo</h3>
                                            <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-base)', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>
                                                {report.executiveSummary}
                                            </p>
                                        </div>
                                    )}

                                    {/* Risks — structured cards, not text dump */}
                                    {hasRisks && (
                                        <div className="report-card">
                                            <h3 className="ai-section-header"><AlertTriangle size={18} /> Riscos e Pontos Críticos</h3>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                                {report.flagList.map((flag: any, i: number) => {
                                                    const sc = severityColor(flag.severity);
                                                    return (
                                                        <div key={i} style={{ padding: 'var(--space-3) var(--space-4)', background: sc.bg, border: `1px solid ${sc.border}`, borderRadius: 'var(--radius-lg)', borderLeft: `3px solid ${sc.badge}` }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: flag.title ? '3px' : 0 }}>
                                                                <span style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', color: sc.badge, background: `${sc.badge}15`, padding: '1px 6px', borderRadius: 'var(--radius-sm)', letterSpacing: '0.03em' }}>
                                                                    {flag.severity || 'média'}
                                                                </span>
                                                                {flag.title && (
                                                                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: sc.text }}>
                                                                        {flag.title}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {flag.text && (
                                                                <p style={{ fontSize: '0.8rem', color: sc.text, lineHeight: 1.5, margin: 0, fontWeight: 400 }}>
                                                                    {flag.text}
                                                                </p>
                                                            )}
                                                            {flag.action && (
                                                                <p style={{ fontSize: '0.75rem', color: sc.badge, lineHeight: 1.4, margin: '4px 0 0', fontWeight: 600 }}>
                                                                    → {flag.action}
                                                                </p>
                                                            )}
                                                            {/* Normative reference (visible) */}
                                                            {flag.sourceRef && (
                                                                <p style={{ fontSize: '0.65rem', color: sc.text, opacity: 0.8, margin: '3px 0 0', fontWeight: 500 }}>
                                                                    📄 {flag.sourceRef}
                                                                </p>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Technical-Legal Opinion */}
                                    {hasTechnicalOpinion && !hasRisks && (
                                        <div className="report-card">
                                            <h3 className="ai-section-header"><ScanSearch size={18} /> Parecer Técnico-Jurídico</h3>
                                            <div style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-base)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                                                {renderMarkdown(report.technicalOpinion)}
                                            </div>
                                        </div>
                                    )}

                                    {/* Bidding Items */}
                                    {hasItems && (
                                        <div className="report-card">
                                            <h3 className="ai-section-header"><FileCheck size={18} /> Observações da Proposta</h3>
                                            <div style={{ padding: 'var(--space-4)', backgroundColor: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                                                <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>
                                                    {report.biddingItemsText}
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Technical Qualification */}
                                    {/* Qualificação Técnica — removed: duplicates QTO/QTP cards in Habilitação Requerida */}

                                    {/* Document Readiness / Habilitação */}
                                    {hasRequirements && (
                                        <div className="report-card">
                                            <div className="flex-between mb-6">
                                                <h3 className="ai-section-header mb-0"><BadgeCheck size={18} /> Habilitação Requerida</h3>
                                                {process?.companyProfileId && !report.isLoadingDocs && (
                                                    <div className="flex-center gap-3" style={{
                                                        padding: 'var(--space-2) var(--space-4)',
                                                        backgroundColor: report.readinessScore > 70 ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
                                                        borderRadius: 'var(--radius-full)',
                                                        border: `1px solid ${report.readinessScore > 70 ? 'var(--color-success-border)' : 'var(--color-warning-border)'}`
                                                    }}>
                                                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: report.readinessScore > 70 ? 'var(--color-success)' : 'var(--color-warning)' }} />
                                                        <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-bold)', color: report.readinessScore > 70 ? 'var(--color-success-hover)' : 'var(--color-warning-hover)' }}>
                                                            Readiness: {report.readinessScore}%
                                                        </span>
                                                    </div>
                                                )}
                                            </div>

                                            {report.isLoadingDocs ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-5)', color: 'var(--color-text-secondary)' }}>
                                                    <Loader2 size={20} className="spinner" /> Sincronizando com documentos cadastrados...
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                                                    {Object.entries(report.categorizedDocs).map(([category, docs]) => (
                                                        <div key={category}>
                                                            <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                                                {category} <span style={{ fontSize: '0.65rem', color: 'var(--color-text-quaternary)' }}>({report.mainCountPerCategory[category] ?? docs.length})</span>
                                                                <div style={{ height: '1px', flex: 1, backgroundColor: 'var(--color-border)' }} />
                                                            </div>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                                                {(() => {
                                                                    // Separate principal items and their children
                                                                    const principals = docs.filter((d: any) => !d.entryType || d.entryType === 'exigencia_principal');
                                                                    const children = docs.filter((d: any) => d.entryType && d.entryType !== 'exigencia_principal');
                                                                    const isQTOorQTP = category.includes('Operacional') || category.includes('Profissional');

                                                                    // Group children by parentId
                                                                    const childrenByParent: Record<string, any[]> = {};
                                                                    children.forEach((child: any) => {
                                                                        const pid = child.parentId || '__orphan__';
                                                                        if (!childrenByParent[pid]) childrenByParent[pid] = [];
                                                                        childrenByParent[pid].push(child);
                                                                    });

                                                                    return principals.map((doc: any, idx: number) => {
                                                                        const DESC_LIMIT = isQTOorQTP ? 999 : 120;
                                                                        const isLong = doc.description && doc.description.length > DESC_LIMIT;
                                                                        const obl = ({
                                                                            'obrigatoria_universal': { label: 'Obrigatório', color: 'var(--color-success)', bg: 'var(--color-success-bg)' },
                                                                            'condicional': { label: 'Condicional', color: 'var(--color-primary)', bg: 'var(--color-primary-light)' },
                                                                            'se_aplicavel': { label: 'Se aplicável', color: 'var(--color-text-tertiary)', bg: 'var(--color-bg-secondary)' },
                                                                            'alternativa': { label: 'Alternativa', color: 'var(--color-primary)', bg: 'var(--color-primary-light)' },
                                                                            'vencedor': { label: 'Só vencedor', color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
                                                                            'fase_contratual': { label: 'Contratual', color: 'var(--color-text-tertiary)', bg: 'var(--color-bg-secondary)' },
                                                                            'consorcio': { label: 'Consórcio', color: 'var(--color-primary)', bg: 'var(--color-primary-light)' },
                                                                            'me_epp': { label: 'ME/EPP', color: 'var(--color-primary)', bg: 'var(--color-primary-light)' },
                                                                            'recuperacao_judicial': { label: 'Rec. Judicial', color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
                                                                            'empresa_estrangeira': { label: 'Estrangeira', color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
                                                                        } as Record<string, { label: string; color: string; bg: string }>)[doc.obligationType] || { label: 'Obrigatório', color: 'var(--color-success)', bg: 'var(--color-success-bg)' };
                                                                        const phaseLabel = ({ 'habilitacao': 'Habilitação', 'proposta': 'Proposta', 'contratacao': 'Contratação', 'pos_contratacao': 'Pós-contrato' } as Record<string, string>)[doc.phase] || '';
                                                                        const consequenceMap: Record<string, string> = { 'inabilitacao': '⚠ Risco: inabilitação', 'inabilitação': '⚠ Risco: inabilitação', 'desclassificacao': '⚠ Risco: desclassificação', 'desclassificação': '⚠ Risco: desclassificação', 'penalidade': '⚠ Risco: penalidade', 'risco_contratual': '⚠ Risco contratual' };
                                                                        const consequenceLabel = doc.riskIfMissing ? consequenceMap[doc.riskIfMissing] || '' : '';
                                                                        const hasSourceRef = doc.sourceRef && doc.sourceRef !== 'referência não localizada';

                                                                        // Children for this principal
                                                                        const myChildren = childrenByParent[doc.item] || [];
                                                                        // QTO/QTP: auto-expand children to show parcelas/quantitativos
                                                                        const childrenOpen = isQTOorQTP ? (expandedChildren[doc.item] !== false) : (expandedChildren[doc.item] || false);

                                                                        return (
                                                                            <div key={idx}>
                                                                                {/* Principal requirement card */}
                                                                                <div style={{
                                                                                    padding: 'var(--space-3) var(--space-4)',
                                                                                    background: 'var(--color-bg-surface)',
                                                                                    borderRadius: 'var(--radius-lg)',
                                                                                    border: '1px solid var(--color-border)',
                                                                                    display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 'var(--text-sm)',
                                                                                }}>
                                                                                    <div style={{ padding: '2px', borderRadius: 'var(--radius-md)', background: doc.hasMatch ? 'var(--color-success-bg)' : 'var(--color-danger-bg)', flexShrink: 0, marginTop: '2px' }}>
                                                                                        {doc.hasMatch ? <CheckCircle2 size={14} color="var(--color-success)" /> : <FileX size={14} color="var(--color-danger)" />}
                                                                                    </div>
                                                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                                                        {/* Row 1: Code + badges */}
                                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', marginBottom: '2px' }}>
                                                                                            {doc.item && doc.item !== '-' && (
                                                                                                <span style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '1px 5px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-primary-border)', flexShrink: 0 }}>
                                                                                                    {doc.item}
                                                                                                </span>
                                                                                            )}
                                                                                            <span style={{ fontSize: '0.55rem', fontWeight: 700, color: obl.color, background: obl.bg, padding: '1px 4px', borderRadius: 'var(--radius-sm)', textTransform: 'uppercase' }}>
                                                                                                {obl.label}
                                                                                            </span>
                                                                                            {phaseLabel && (
                                                                                                <span style={{ fontSize: '0.5rem', fontWeight: 600, color: 'var(--color-text-quaternary)', background: 'var(--color-bg-tertiary)', padding: '1px 3px', borderRadius: 'var(--radius-sm)' }}>
                                                                                                    {phaseLabel}
                                                                                                </span>
                                                                                            )}
                                                                                        </div>
                                                                                        {/* Row 2: Title */}
                                                                                        {doc.title && (
                                                                                            <p style={{ margin: '0 0 1px', fontSize: '0.82rem', color: 'var(--color-text-primary)', fontWeight: 600, lineHeight: 1.3 }}>
                                                                                                {doc.title}
                                                                                            </p>
                                                                                        )}
                                                                                        {/* Row 3: Description */}
                                                                                        {doc.description && (
                                                                                            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-secondary)', fontWeight: 400, lineHeight: 1.4 }}>
                                                                                                {isLong ? doc.description.slice(0, DESC_LIMIT) + '…' : doc.description}
                                                                                            </p>
                                                                                        )}
                                                                                        {/* Row 4: Consequence + Source */}
                                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: '3px', flexWrap: 'wrap' }}>
                                                                                            {consequenceLabel && (
                                                                                                <span style={{ fontSize: '0.65rem', color: 'var(--color-danger)', fontWeight: 500, fontStyle: 'italic' }}>
                                                                                                    {consequenceLabel}
                                                                                                </span>
                                                                                            )}
                                                                                            {doc.sourceRef && (
                                                                                                <span style={{ fontSize: '0.65rem', color: hasSourceRef ? 'var(--color-text-tertiary)' : 'var(--color-warning)', fontWeight: hasSourceRef ? 500 : 400 }}>
                                                                                                    📄 {doc.sourceRef}
                                                                                                </span>
                                                                                            )}
                                                                                        </div>
                                                                                    </div>
                                                                                </div>

                                                                                {/* Collapsible children toggle */}
                                                                                {myChildren.length > 0 && (
                                                                                    <>
                                                                                        <button onClick={() => toggleChildren(doc.item)} style={{
                                                                                            background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.65rem', fontWeight: 600,
                                                                                            color: 'var(--color-primary)', padding: '2px 0 2px var(--space-8)', display: 'flex', alignItems: 'center', gap: '4px'
                                                                                        }}>
                                                                                            {childrenOpen ? '▾' : '▸'} {myChildren.length} {myChildren.length === 1 ? 'subitem/observação' : 'subitens/observações'}
                                                                                        </button>
                                                                                        {childrenOpen && (
                                                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginLeft: 'var(--space-5)' }}>
                                                                                                {myChildren.map((child: any, cidx: number) => {
                                                                                                    const isObs = child.entryType === 'observacao';
                                                                                                    const icon = child.entryType === 'subitem' ? '↳' : isObs ? '📝' : '📎';
                                                                                                    const typeLabel = child.entryType === 'subitem' ? 'subitem' : isObs ? 'observação' : 'doc. complementar';
                                                                                                    const childDescLimit = isQTOorQTP ? 999 : 200;
                                                                                                    return (
                                                                                                        <div key={cidx} style={{
                                                                                                            padding: 'var(--space-2) var(--space-3)',
                                                                                                            background: 'var(--color-bg-tertiary)',
                                                                                                            borderRadius: 'var(--radius-md)',
                                                                                                            borderLeft: '3px solid var(--color-primary-border, var(--color-primary))',
                                                                                                            opacity: isObs ? 0.85 : 1,
                                                                                                            display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', fontSize: '0.78rem',
                                                                                                        }}>
                                                                                                            <span style={{ fontSize: '0.7rem', flexShrink: 0, marginTop: '1px' }}>{icon}</span>
                                                                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '1px' }}>
                                                                                                                    {child.item && child.item !== '-' && (
                                                                                                                        <span style={{ fontSize: '0.55rem', fontWeight: 700, color: 'var(--color-primary)', padding: '0 3px', background: 'var(--color-primary-light)', borderRadius: '2px' }}>
                                                                                                                            {child.item}
                                                                                                                        </span>
                                                                                                                    )}
                                                                                                                    <span style={{ fontSize: '0.5rem', fontWeight: 600, color: 'var(--color-text-quaternary)', textTransform: 'uppercase' }}>{typeLabel}</span>
                                                                                                                </div>
                                                                                                                {child.title && <p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 500, color: 'var(--color-text-primary)', lineHeight: 1.3 }}>{child.title}</p>}
                                                                                                                {child.description && (
                                                                                                                    <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--color-text-secondary)', lineHeight: 1.3 }}>
                                                                                                                        {child.description.length > childDescLimit ? child.description.slice(0, childDescLimit) + '…' : child.description}
                                                                                                                    </p>
                                                                                                                )}
                                                                                                                {child.sourceRef && (
                                                                                                                    <span style={{ fontSize: '0.6rem', color: 'var(--color-text-tertiary)' }}>📄 {child.sourceRef}</span>
                                                                                                                )}
                                                                                                            </div>
                                                                                                        </div>
                                                                                                    );
                                                                                                })}
                                                                                            </div>
                                                                                        )}
                                                                                    </>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    });
                                                                })()}
                                                                {/* Orphan children (without a matching principal) */}
                                                                {(() => {
                                                                    const orphans = docs.filter((d: any) => d.entryType && d.entryType !== 'exigencia_principal' && !docs.some((p: any) => (!p.entryType || p.entryType === 'exigencia_principal') && p.item === d.parentId));
                                                                    if (orphans.length === 0) return null;
                                                                    const isQTOorQTP = category.includes('Operacional') || category.includes('Profissional');
                                                                    return orphans.map((child: any, cidx: number) => {
                                                                        const icon = child.entryType === 'subitem' ? '↳' : child.entryType === 'observacao' ? '📝' : '📎';
                                                                        const childDescLimit = isQTOorQTP ? 999 : 200;
                                                                        return (
                                                                            <div key={`orphan-${cidx}`} style={{
                                                                                padding: 'var(--space-2) var(--space-3)',
                                                                                background: 'var(--color-bg-tertiary)',
                                                                                borderRadius: 'var(--radius-md)',
                                                                                borderLeft: '3px solid var(--color-border)',
                                                                                display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', fontSize: '0.78rem',
                                                                            }}>
                                                                                <span style={{ fontSize: '0.7rem', flexShrink: 0, marginTop: '1px' }}>{icon}</span>
                                                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                                                    {child.title && <p style={{ margin: 0, fontWeight: 500, color: 'var(--color-text-primary)', lineHeight: 1.3 }}>{child.title}</p>}
                                                                                    {child.description && (
                                                                                        <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--color-text-secondary)', lineHeight: 1.3 }}>
                                                                                            {child.description.length > childDescLimit ? child.description.slice(0, childDescLimit) + '…' : child.description}
                                                                                        </p>
                                                                                    )}
                                                                                    {child.sourceRef && <span style={{ fontSize: '0.6rem', color: 'var(--color-text-tertiary)' }}>📄 {child.sourceRef}</span>}
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    });
                                                                })()}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* RIGHT COLUMN */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                                    {/* Financial */}
                                    {hasFinancial && (
                                        <div className="report-metrics-card" style={{ background: 'var(--color-success-bg)', border: '1px solid var(--color-success-border)' }}>
                                            <div style={{ color: 'var(--color-success-hover)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                                                <DollarSign size={18} /> <span style={{ fontWeight: 'var(--font-bold)', fontSize: 'var(--text-sm)' }}>Financeiro</span>
                                            </div>
                                            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                                                {report.financialText}
                                            </p>
                                        </div>
                                    )}

                                    {/* Deadlines — critical always visible, secondary expandable */}
                                    {hasDeadlines && (
                                        <div className="report-metrics-card" style={{ background: 'var(--color-primary-light)', border: '1px solid var(--color-primary-border)' }}>
                                            <div style={{ color: 'var(--color-primary-hover)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                                                <Calendar size={18} /> <span style={{ fontWeight: 'var(--font-bold)', fontSize: 'var(--text-sm)' }}>Cronograma</span>
                                            </div>
                                            {/* Critical deadlines — always visible */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                                {report.criticalDeadlines.map((dl: string, i: number) => (
                                                    <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                                                        <span style={{ fontSize: '0.8rem', color: 'var(--color-primary-hover)', lineHeight: 1.5 }}>{dl}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            {/* Secondary deadlines — expandable */}
                                            {report.secondaryDeadlines.length > 0 && (
                                                <>
                                                    <button
                                                        onClick={() => setShowSecondaryDeadlines(!showSecondaryDeadlines)}
                                                        style={{
                                                            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
                                                            fontSize: '0.72rem', color: 'var(--color-primary)', fontWeight: 600,
                                                            display: 'flex', alignItems: 'center', gap: '4px', marginTop: 'var(--space-2)'
                                                        }}
                                                    >
                                                        {showSecondaryDeadlines ? '▾' : '▸'} {report.secondaryDeadlines.length} prazo(s) complementar(es)
                                                    </button>
                                                    {showSecondaryDeadlines && (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginTop: '4px', paddingLeft: '8px', borderLeft: '2px solid var(--color-primary-border)' }}>
                                                            {report.secondaryDeadlines.map((dl: string, i: number) => (
                                                                <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                                                                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{dl}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    )}

                                    {/* Penalties — structured blocks */}
                                    {hasPenalties && (
                                        <div className="report-metrics-card" style={{ background: 'var(--color-urgency-bg)', border: '1px solid var(--color-urgency-border)' }}>
                                            <div style={{ color: 'var(--color-urgency)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                                                <ShieldAlert size={18} /> <span style={{ fontWeight: 'var(--font-bold)', fontSize: 'var(--text-sm)' }}>Penalidades</span>
                                            </div>
                                            {(() => {
                                                const ps = report.penaltiesStructured;
                                                const hasStructured = ps && (ps.multas.length > 0 || ps.sancoes.length > 0 || ps.rescisao.length > 0);
                                                if (!hasStructured) {
                                                    return (
                                                        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-urgency)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                                                            {report.penaltiesText}
                                                        </p>
                                                    );
                                                }
                                                return (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                                        {ps.multas.length > 0 && (
                                                            <div>
                                                                <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-urgency)', opacity: 0.8, marginBottom: '4px' }}>💰 Multas</div>
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                                    {ps.multas.map((m: string, i: number) => (
                                                                        <p key={i} style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-urgency)', lineHeight: 1.4 }}>• {m}</p>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {ps.sancoes.length > 0 && (
                                                            <div>
                                                                <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-urgency)', opacity: 0.8, marginBottom: '4px' }}>⛔ Sanções Administrativas</div>
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                                    {ps.sancoes.map((s: string, i: number) => (
                                                                        <p key={i} style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-urgency)', lineHeight: 1.4 }}>• {s}</p>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {ps.rescisao.length > 0 && (
                                                            <div>
                                                                <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-urgency)', opacity: 0.8, marginBottom: '4px' }}>📋 Rescisão / Efeitos</div>
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                                    {ps.rescisao.map((r: string, i: number) => (
                                                                        <p key={i} style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-urgency)', lineHeight: 1.4 }}>• {r}</p>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {ps.outros.length > 0 && (
                                                            <div>
                                                                <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-urgency)', opacity: 0.8, marginBottom: '4px' }}>📎 Outras</div>
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                                    {ps.outros.map((o: string, i: number) => (
                                                                        <p key={i} style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-urgency)', lineHeight: 1.4 }}>• {o}</p>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}

                                    {/* Pipeline Meta */}
                                    {report.pipelineMeta && (
                                        <div style={{ padding: 'var(--space-4)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                                            <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <BarChart3 size={13} /> Métricas do Pipeline
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                                                {analysis?.pipelineDurationS && (
                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                        <span>Tempo total</span>
                                                        <span style={{ fontWeight: 700 }}>{analysis.pipelineDurationS.toFixed(1)}s</span>
                                                    </div>
                                                )}
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                    <span>Rastreabilidade</span>
                                                    <span style={{ fontWeight: 700, color: report.pipelineMeta.traceabilityPercentage !== null && report.pipelineMeta.traceabilityPercentage < 80 ? 'var(--color-warning)' : 'inherit' }}>
                                                        {report.pipelineMeta.traceabilityPercentage !== null ? `${report.pipelineMeta.tracedRequirements}/${report.pipelineMeta.totalRequirements} (${report.pipelineMeta.traceabilityPercentage}%)` : `${report.pipelineMeta.evidenceCount} evidências`}
                                                    </span>
                                                </div>
                                                {report.pipelineMeta.qualityScore !== null && (
                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                        <span>Qualidade</span>
                                                        <span style={{ fontWeight: 700 }}>{report.pipelineMeta.qualityScore}%</span>
                                                    </div>
                                                )}
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                    <span>Modelo</span>
                                                    <span style={{ fontWeight: 600, fontSize: '0.7rem' }}>{report.pipelineMeta.model}</span>
                                                </div>
                                                {/* Pipeline health warnings */}
                                                {report.pipelineMeta.pipelineHealth && (
                                                    <>
                                                        {report.pipelineMeta.pipelineHealth.parseRepairs > 0 && (
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-warning)' }}>
                                                                <span>⚠️ Reparos JSON</span>
                                                                <span style={{ fontWeight: 700 }}>{report.pipelineMeta.pipelineHealth.parseRepairs}</span>
                                                            </div>
                                                        )}
                                                        {report.pipelineMeta.pipelineHealth.fallbacksUsed > 0 && (
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-warning)' }}>
                                                                <span>⚠️ Fallbacks</span>
                                                                <span style={{ fontWeight: 700 }}>{report.pipelineMeta.pipelineHealth.fallbacksUsed}</span>
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Chat Experience */
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--color-bg-base)' }}>
                            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-10)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
                                {messages.length === 0 && (
                                    <div style={{ textAlign: 'center', maxWidth: '500px', margin: '60px auto' }}>
                                        <div style={{ width: '80px', height: '80px', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-2xl)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', boxShadow: 'var(--shadow-lg)' }}>
                                            <MessageSquare size={40} color="var(--color-primary)" />
                                        </div>
                                        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>Consultor de Edital IA</h3>
                                        <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>Olá! Analisei integralmente os documentos deste processo. Como posso te ajudar a vencer esta licitação?</p>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', justifyContent: 'center', marginTop: 'var(--space-8)' }}>
                                            {quickReplies.map((reply, i) => (
                                                <button key={i} onClick={() => handleSendMessage(reply)} className="quick-reply-btn">{reply}</button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {messages.map((msg) => (
                                    <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 'var(--space-3)' }}>
                                        {msg.role === 'model' && (
                                            <div style={{ width: '32px', height: '32px', background: 'linear-gradient(135deg, var(--color-primary), var(--color-ai))', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                <ScanSearch size={18} color="white" />
                                            </div>
                                        )}
                                        <div style={{
                                            maxWidth: '70%', padding: 'var(--space-4) var(--space-5)', borderRadius: 'var(--radius-xl)',
                                            background: msg.role === 'user' ? 'var(--color-text-primary)' : 'var(--color-bg-surface)',
                                            color: msg.role === 'user' ? 'white' : 'var(--color-text-primary)',
                                            fontSize: '0.9375rem', lineHeight: 1.6, boxShadow: msg.role === 'model' ? 'var(--shadow-sm)' : 'none',
                                            borderBottomRightRadius: msg.role === 'user' ? '4px' : 'var(--radius-xl)',
                                            borderBottomLeftRadius: msg.role === 'model' ? '4px' : 'var(--radius-xl)', whiteSpace: 'pre-wrap'
                                        }}>
                                            {msg.role === 'model' ? renderMarkdown(msg.text) : msg.text}
                                        </div>
                                    </div>
                                ))}
                                {isSending && (
                                    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
                                        <div style={{ width: '32px', height: '32px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Loader2 size={18} className="spinner" />
                                        </div>
                                        Sua consultoria está processando a resposta...
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            <div style={{ padding: 'var(--space-6) var(--space-10)', background: 'var(--color-bg-surface)', borderTop: '1px solid var(--color-border)' }}>
                                <div style={{ display: 'flex', gap: 'var(--space-4)', background: 'var(--color-bg-base)', padding: '8px 8px 8px 20px', borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-border)' }}>
                                    <input placeholder="Digitar pergunta específica sobre o edital..." style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: '0.9375rem', color: 'var(--color-text-primary)' }}
                                        value={inputText} onChange={(e) => setInputText(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} disabled={isSending} />
                                    <button onClick={() => handleSendMessage()} disabled={!inputText.trim() || isSending}
                                        style={{
                                            background: 'var(--color-text-primary)', color: 'white', border: 'none', padding: 'var(--space-3) var(--space-6)', borderRadius: 'var(--radius-lg)',
                                            display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', opacity: (!inputText.trim() || isSending) ? 0.5 : 1, transition: 'var(--transition-fast)'
                                        }}>
                                        <Send size={18} /> Pergunta
                                    </button>
                                </div>
                                <p style={{ margin: '12px 0 0', fontSize: '0.75rem', color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
                                    Dica: Pergunte sobre itens de habilitação específicos ou prazos de impugnação.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: 'var(--space-4) var(--space-10)', background: 'var(--color-bg-surface)', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }}>
                        <span style={{ fontWeight: 'var(--font-semibold)' }}>ID: {analysis?.id.slice(0, 8)}</span>
                        <span>•</span>
                        <span>{new Date(analysis?.analyzedAt).toLocaleString('pt-BR')}</span>
                        {analysis?.modelUsed && (<><span>•</span><span>{analysis.modelUsed}</span></>)}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                        {onImport && (
                            <button onClick={onImport} style={{
                                display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-6)', borderRadius: 'var(--radius-lg)',
                                border: 'none', background: 'linear-gradient(135deg, var(--color-primary), var(--color-ai))', color: 'white', fontWeight: 'var(--font-bold)',
                                fontSize: 'var(--text-md)', cursor: 'pointer', boxShadow: 'var(--shadow-md)', transition: 'var(--transition-fast)'
                            }}
                                onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(59, 130, 246, 0.45)'; }}
                                onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.35)'; }}>
                                <Plus size={16} /> Importar para o Funil
                            </button>
                        )}
                        <button className="btn btn-outline" onClick={onClose} style={{ borderRadius: 'var(--radius-lg)', padding: 'var(--space-3) var(--space-6)' }}>Fechar Painel</button>
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUp { from { transform: translateY(30px) scale(0.98); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
                .quick-reply-btn { padding: var(--space-3) var(--space-5); border-radius: var(--radius-lg); background: var(--color-bg-surface); border: 1px solid var(--color-border); color: var(--color-text-secondary); font-size: 0.875rem; cursor: pointer; transition: var(--transition-fast); }
                .quick-reply-btn:hover { border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-light); }
            `}</style>
        </div>
    );
}

const quickReplies = [
    "Traga a relação completa dos documentos de habilitação exigidos, com os itens de referência do edital",
    "Analise os requisitos de qualificação técnica e aponte riscos de inabilitação",
    "Liste todos os prazos críticos com datas e consequências de descumprimento",
    "Quais são os critérios de julgamento e formação de preço?",
    "Identifique cláusulas restritivas ou irregularidades no edital"
];
