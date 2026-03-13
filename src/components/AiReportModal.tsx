import { useState, useRef, useEffect, useMemo } from 'react';
import { Brain, FileCheck, DollarSign, AlertTriangle, X, Send, Loader2, MessageSquare, Calendar, ShieldAlert, Award, FileX, CheckCircle2, ChevronRight, Sparkles, Plus } from 'lucide-react';
import type { AiAnalysis, BiddingProcess, CompanyDocument } from '../types';
import { API_BASE_URL } from '../config';
import { aiService } from '../services/ai';
import axios from 'axios';

interface Props {
    analysis: AiAnalysis;
    process: BiddingProcess;
    onClose: () => void;
    onUpdate: () => void;
    onImport?: () => void;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
}

export function AiReportModal({ analysis, process, onClose, onUpdate, onImport }: Props) {
    const [activeTab, setActiveTab] = useState<'report' | 'chat'>('report');
    const [messages, setMessages] = useState<ChatMessage[]>(() => {
        try {
            return typeof analysis?.chatHistory === 'string'
                ? JSON.parse(analysis?.chatHistory)
                : (analysis?.chatHistory || []);
        } catch (e) {
            console.error("Failed to parse chat history:", e);
            return [];
        }
    });
    const [inputText, setInputText] = useState('');
    const [isSending, setIsSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (activeTab === 'chat') {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, activeTab]);

    const handleSendMessage = async (textToOVeride?: string) => {
        const textToUse = textToOVeride || inputText;
        if (!textToUse.trim() || isSending) return;

        const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text: textToUse.trim() };
        setMessages((prev: ChatMessage[]) => [...prev, userMsg]);
        setInputText('');
        setIsSending(true);

        try {
            let fileNames: string[] = [];
            if (analysis?.sourceFileNames) {
                try {
                    fileNames = JSON.parse(analysis.sourceFileNames);
                } catch (e) {
                    console.error("Failed to parse sourceFileNames", e);
                }
            }

            if (fileNames.length === 0 && process?.link) {
                const urls = process?.link.split(',').map(u => u.trim());
                fileNames = urls.map(url => url.split('/').pop() || '').filter(Boolean);
            }
            const currentMessagesForAI = [...messages, userMsg].map(m => ({ role: m.role, text: m.text }));
            const replyText = await aiService.chatWithEdital(fileNames, currentMessagesForAI, process?.id);

            const modelMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: replyText };
            const updatedMessages = [...messages, userMsg, modelMsg];
            setMessages(updatedMessages);

            try {
                const { biddingProcessId: _bId, ...analysisData } = analysis as any;
                await axios.post(`${API_BASE_URL}/api/analysis`, {
                    biddingProcessId: process?.id,
                    ...analysisData,
                    sourceFileNames: analysis.sourceFileNames,
                    chatHistory: JSON.stringify(updatedMessages)
                }, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                });
                onUpdate();
            } catch (err) {
                console.error("Failed to persist chat history:", err);
            }
        } catch (error: any) {
            const errorMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'model',
                text: `❌ Erro ao se comunicar com o consultor: ${error.message}`
            };
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            setIsSending(false);
        }
    };

    const parseArray = (data: any): string[] => {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        try {
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) return parsed;
            return typeof parsed === 'string' ? [parsed] : [];
        } catch {
            return typeof data === 'string' ? [data] : [];
        }
    };

    const renderTextValue = (val: any): string => {
        if (val === null || val === undefined) return '';
        if (typeof val === 'string') return val;
        try {
            return JSON.stringify(val, null, 2);
        } catch {
            return String(val);
        }
    };

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
                elements.push(
                    <ListTag key={`list-${key++}`} style={{ margin: '8px 0', paddingLeft: '20px', lineHeight: 1.7 }}>
                        {listItems}
                    </ListTag>
                );
                listItems = [];
                listType = null;
            }
        };

        const formatInline = (str: string): React.ReactNode[] => {
            const parts: React.ReactNode[] = [];
            const regex = /\*\*(.+?)\*\*/g;
            let lastIndex = 0;
            let match;
            let idx = 0;

            while ((match = regex.exec(str)) !== null) {
                if (match.index > lastIndex) {
                    parts.push(str.slice(lastIndex, match.index));
                }
                parts.push(<strong key={`b-${idx++}`} style={{ fontWeight: 700 }}>{match[1]}</strong>);
                lastIndex = regex.lastIndex;
            }
            if (lastIndex < str.length) {
                parts.push(str.slice(lastIndex));
            }
            return parts.length > 0 ? parts : [str];
        };

        for (const line of lines) {
            const trimmed = line.trim();

            // Numbered list: 1. / 2. / etc
            const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
            if (orderedMatch) {
                if (listType !== 'ol') { flushList(); listType = 'ol'; }
                listItems.push(<li key={`li-${key++}`}>{formatInline(orderedMatch[2])}</li>);
                continue;
            }

            // Bullet list: - / • / *
            const bulletMatch = trimmed.match(/^[-•*]\s+(.+)$/);
            if (bulletMatch) {
                if (listType !== 'ul') { flushList(); listType = 'ul'; }
                listItems.push(<li key={`li-${key++}`}>{formatInline(bulletMatch[1])}</li>);
                continue;
            }

            // Not a list item — flush any pending list
            flushList();

            // Headers with ### / ## / #
            if (trimmed.startsWith('### ')) {
                elements.push(<h4 key={`h-${key++}`} style={{ fontWeight: 700, fontSize: '0.95rem', marginTop: '16px', marginBottom: '4px', color: 'var(--color-text-primary)' }}>{formatInline(trimmed.slice(4))}</h4>);
                continue;
            }
            if (trimmed.startsWith('## ')) {
                elements.push(<h3 key={`h-${key++}`} style={{ fontWeight: 700, fontSize: '1.05rem', marginTop: '18px', marginBottom: '6px', color: 'var(--color-text-primary)' }}>{formatInline(trimmed.slice(3))}</h3>);
                continue;
            }
            if (trimmed.startsWith('# ')) {
                elements.push(<h2 key={`h-${key++}`} style={{ fontWeight: 800, fontSize: '1.1rem', marginTop: '20px', marginBottom: '8px', color: 'var(--color-text-primary)' }}>{formatInline(trimmed.slice(2))}</h2>);
                continue;
            }

            // Separator ---
            if (trimmed === '---') {
                elements.push(<hr key={`hr-${key++}`} style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '12px 0' }} />);
                continue;
            }

            // Empty line
            if (!trimmed) {
                elements.push(<div key={`br-${key++}`} style={{ height: '8px' }} />);
                continue;
            }

            // Normal paragraph
            elements.push(<p key={`p-${key++}`} style={{ margin: '4px 0', lineHeight: 1.7 }}>{formatInline(trimmed)}</p>);
        }

        flushList();
        return elements;
    };

    const flagList = parseArray(analysis?.irregularitiesFlags);
    const deadlineList = parseArray(analysis?.deadlines || []);

    const [companyDocs, setCompanyDocs] = useState<CompanyDocument[]>([]);
    const [isLoadingDocs, setIsLoadingDocs] = useState(false);

    useEffect(() => {
        if (process?.companyProfileId) {
            setIsLoadingDocs(true);
            fetch(`${API_BASE_URL}/api/documents`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            })
                .then(res => res.json())
                .then((data: CompanyDocument[]) => {
                    const tiedDocs = data.filter(d => d.companyProfileId === process?.companyProfileId);
                    setCompanyDocs(tiedDocs);
                })
                .catch(err => console.error("Failed to fetch company docs:", err))
                .finally(() => setIsLoadingDocs(false));
        }
    }, [process?.companyProfileId]);

    const categorizedDocs = useMemo(() => {
        let rawData: any = {};
        try {
            if (analysis?.requiredDocuments) {
                rawData = typeof analysis?.requiredDocuments === 'string'
                    ? JSON.parse(analysis?.requiredDocuments)
                    : analysis?.requiredDocuments;
            }

            if (!rawData) {
                rawData = {};
            }

            // If it's an array, it's the old flat format. Convert to a single category.
            if (Array.isArray(rawData)) {
                rawData = { "Documentos Exigidos": rawData.map(d => typeof d === 'string' ? { item: '-', description: d } : d) };
            }
        } catch (e) {
            console.error("Failed to parse requiredDocuments", e);
            // Fallback for plain text
            if (typeof analysis?.requiredDocuments === 'string' && analysis?.requiredDocuments.trim()) {
                rawData = { "Processamento": [{ item: 'Info', description: analysis?.requiredDocuments }] };
            } else {
                rawData = {};
            }
        }

        const categories = ["Habilitação Jurídica", "Regularidade Fiscal, Social e Trabalhista", "Qualificação Técnica", "Qualificação Econômica Financeira", "Declarações e Outros", "Outros", "Documentos Exigidos", "Processamento"];
        const result: Record<string, { item: string; description: string; hasMatch: boolean }[]> = {};

        categories.forEach(cat => {
            const docs = Array.isArray(rawData[cat]) ? rawData[cat] : [];
            result[cat] = docs.map((doc: any) => {
                const docObj = typeof doc === 'string' ? { item: '-', description: doc } : doc;
                const textToMatch = `${docObj.item} ${docObj.description}`.toLowerCase();
                const hasMatch = companyDocs.some(cDoc => {
                    const docType = cDoc.docType.toLowerCase();
                    if (textToMatch.includes('trabalhista') && docType.includes('trabalhista')) return true;
                    if (textToMatch.includes('fgts') && docType.includes('fgts')) return true;
                    if (textToMatch.includes('federal') && docType.includes('federal')) return true;
                    if (textToMatch.includes('estadual') && docType.includes('estadual')) return true;
                    if (textToMatch.includes('municipal') && docType.includes('municipal')) return true;
                    if (textToMatch.includes('falência') && docType.includes('falência')) return true;
                    if (textToMatch.includes('balanço') && docType.includes('balanço')) return true;
                    if (textToMatch.includes('contrato social') && docType.includes('contrato social')) return true;
                    return false;
                });
                return { ...docObj, hasMatch };
            });
        });
        return result;
    }, [analysis?.requiredDocuments, companyDocs]);

    const allDocsList = useMemo(() => Object.values(categorizedDocs).flat(), [categorizedDocs]);
    const readinessScore = allDocsList.length > 0
        ? Math.round((allDocsList.filter(d => d.hasMatch).length / allDocsList.length) * 100)
        : 0;

    return (
        <div className="modal-overlay" style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.7)',
            backdropFilter: 'blur(8px)',
            animation: 'fadeIn 0.25s ease-out'
        }}>
            <div className="modal-content" style={{
                maxWidth: '950px',
                width: '95%',
                height: '92vh',
                borderRadius: 'var(--radius-xl)',
                boxShadow: 'var(--shadow-xl)',
                overflow: 'hidden',
                backgroundColor: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                display: 'flex',
                flexDirection: 'column'
            }}>
                {/* Modern AI Header */}
                <div style={{
                    padding: 'var(--space-8) var(--space-10)',
                    background: 'linear-gradient(135deg, var(--color-text-primary) 0%, var(--color-bg-surface-hover) 100%)',
                    color: 'white',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-6)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                            <div style={{ padding: 'var(--space-3)', background: 'linear-gradient(135deg, var(--color-primary), var(--color-ai))', borderRadius: 'var(--radius-xl)', boxShadow: '0 0 20px rgba(59, 130, 246, 0.4)' }}>
                                <Brain size={28} color="white" />
                            </div>
                            <div>
                                <h2 style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, margin: 0, letterSpacing: '-0.025em' }}>
                                    Análise Estratégica <span style={{ color: 'var(--color-primary-border)' }}>IA</span>
                                </h2>
                                <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-base)', marginTop: '4px' }}>
                                    Processando: <span style={{ color: 'var(--color-border)', fontWeight: 'var(--font-semibold)' }}>{process?.title}</span>
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', cursor: 'pointer', padding: '10px', borderRadius: '50%', transition: 'all 0.2s' }}
                            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
                            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                        >
                            <X size={24} />
                        </button>
                    </div>

                    {/* Styled Tabs */}
                    <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
                        <button
                            onClick={() => setActiveTab('report')}
                            style={{
                                ...tabStyle,
                                color: activeTab === 'report' ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                                borderBottom: activeTab === 'report' ? '3px solid var(--color-primary)' : '3px solid transparent'
                            }}
                        >
                            <FileCheck size={18} /> Relatório Analítico
                        </button>
                        <button
                            onClick={() => setActiveTab('chat')}
                            style={{
                                ...tabStyle,
                                color: activeTab === 'chat' ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                                borderBottom: activeTab === 'chat' ? '3px solid var(--color-primary)' : '3px solid transparent'
                            }}
                        >
                            <MessageSquare size={18} /> Consultor de Edital
                        </button>
                    </div>
                </div>

                {/* Content Area */}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
                    {activeTab === 'report' ? (
                        <div style={{
                            flex: 1,
                            padding: 'var(--space-10)',
                            overflowY: 'auto',
                            display: 'grid',
                            gridTemplateColumns: 'minmax(0, 1.8fr) minmax(0, 1fr)',
                            gap: 'var(--space-10)',
                            background: 'var(--color-bg-base)'
                        }}>
                            {/* Left Column: Core Analysis */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>

                                {/* Key Metrics Bar */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                                    <div style={{ padding: 'var(--space-5)', background: 'var(--color-success-bg)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-success-border)' }}>
                                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-bold)', color: 'var(--color-success)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--space-2)' }}>Valor Estimado</div>
                                        <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--color-success-hover)' }}>
                                            {process?.estimatedValue ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(process?.estimatedValue) : 'Não informado'}
                                        </div>
                                    </div>
                                    <div style={{ padding: 'var(--space-5)', background: 'var(--color-primary-light)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-primary-border)' }}>
                                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-bold)', color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--space-2)' }}>Sessão / Prazo</div>
                                        <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--color-primary-hover)' }}>
                                            {process?.sessionDate ? new Date(process?.sessionDate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Não informado'}
                                        </div>
                                    </div>
                                </div>

                                {/* Resumo Executivo — uses process?.summary (detailed executive summary from AI) */}
                                <div className="report-card">
                                    <h3 style={sectionHeaderStyle}><Sparkles size={18} /> Resumo Executivo</h3>
                                    <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-base)', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>
                                        {renderTextValue(process?.summary) || renderTextValue(analysis?.fullSummary) || 'Resumo executivo não disponível para este edital.'}
                                    </p>
                                </div>

                                {/* Parecer Técnico-Jurídico — uses analysis?.fullSummary */}
                                {analysis?.fullSummary && process?.summary && analysis?.fullSummary !== process?.summary && (
                                    <div className="report-card">
                                        <h3 style={sectionHeaderStyle}><Brain size={18} /> Parecer Técnico-Jurídico</h3>
                                        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-base)', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>
                                            {renderTextValue(analysis?.fullSummary)}
                                        </p>
                                    </div>
                                )}

                                {/* Detalhamento de Itens */}
                                {analysis?.biddingItems && (
                                    <div className="report-card">
                                        <h3 style={sectionHeaderStyle}><FileCheck size={18} /> Itens Licitados</h3>
                                        <div style={{ padding: 'var(--space-5)', backgroundColor: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-border)' }}>
                                            <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-base)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap', fontFamily: typeof analysis?.biddingItems !== 'string' ? 'monospace' : 'inherit' }}>
                                                {renderTextValue(analysis?.biddingItems)}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* Qualificação Técnica Detalhada */}
                                {analysis?.qualificationRequirements && (
                                    <div className="report-card">
                                        <h3 style={sectionHeaderStyle}><Award size={18} /> Qualificação Técnica Exigida</h3>
                                        <div style={{ padding: 'var(--space-5)', backgroundColor: 'var(--color-warning-bg)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-warning-border)' }}>
                                            <p style={{ color: 'var(--color-warning-hover)', fontSize: 'var(--text-base)', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>
                                                {renderTextValue(analysis?.qualificationRequirements)}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* Document Readiness Matcher */}
                                <div className="report-card">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
                                        <h3 style={{ ...sectionHeaderStyle, marginBottom: 0 }}><Award size={18} /> Habilitação Requerida</h3>
                                        {process?.companyProfileId && !isLoadingDocs && (
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 'var(--space-3)',
                                                padding: 'var(--space-2) var(--space-4)',
                                                backgroundColor: readinessScore > 70 ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
                                                borderRadius: 'var(--radius-full)',
                                                border: `1px solid ${readinessScore > 70 ? 'var(--color-success-border)' : 'var(--color-warning-border)'}`
                                            }}>
                                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: readinessScore > 70 ? 'var(--color-success)' : 'var(--color-warning)' }} />
                                                <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-bold)', color: readinessScore > 70 ? 'var(--color-success-hover)' : 'var(--color-warning-hover)' }}>
                                                    Readiness: {readinessScore}%
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {isLoadingDocs ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-5)', color: 'var(--color-text-secondary)' }}>
                                            <Loader2 size={20} className="spinner" /> Sincronizando com documentos cadastrados...
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
                                            {Object.entries(categorizedDocs).map(([category, docs]) => docs.length > 0 && (
                                                <div key={category}>
                                                    <div style={{ fontSize: '0.8125rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                                        {category} <div style={{ height: '1px', flex: 1, backgroundColor: 'var(--color-border)' }} />
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                                        {docs.map((doc, idx) => (
                                                            <div key={idx} style={{
                                                                padding: 'var(--space-4) var(--space-5)',
                                                            background: 'var(--color-bg-surface)',
                                                            borderRadius: 'var(--radius-xl)',
                                                            border: '1px solid var(--color-border)',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: 'var(--space-4)',
                                                            boxShadow: 'var(--shadow-xs)'
                                                            }}>
                                                                <div style={{
                                                                    padding: 'var(--space-2)',
                                                                    borderRadius: 'var(--radius-lg)',
                                                                    background: doc.hasMatch ? 'var(--color-success-bg)' : 'var(--color-danger-bg)'
                                                                }}>
                                                                    {doc.hasMatch ? <CheckCircle2 size={18} color="var(--color-success)" /> : <FileX size={18} color="var(--color-danger)" />}
                                                                </div>
                                                                <div style={{ flex: 1 }}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                                                                        {doc.item && doc.item !== '-' && (
                                                                            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '4px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary-border)' }}>
                                                                                ITEM {doc.item}
                                                                            </span>
                                                                        )}
                                                                        {!doc.hasMatch ? (
                                                                            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--color-danger)', background: 'var(--color-danger-bg)', padding: '4px 10px', borderRadius: 'var(--radius-md)' }}>PENDENTE</span>
                                                                        ) : (
                                                                            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--color-success)', background: 'var(--color-success-bg)', padding: '4px 10px', borderRadius: 'var(--radius-md)' }}>MAPPED</span>
                                                                        )}
                                                                    </div>
                                                                    <p style={{ margin: 0, fontSize: '1rem', color: 'var(--color-text-primary)', fontWeight: 500, lineHeight: 1.5 }}>{doc.description}</p>
                                                                </div>
                                                                <ChevronRight size={16} color="var(--color-border)" />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Right Column: Key Metrics & Risks */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

                                {/* Financial */}
                                <div style={{ ...metricsCardStyle, background: 'var(--color-success-bg)', border: '1px solid var(--color-success-border)' }}>
                                    <div style={{ color: 'var(--color-success-hover)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                                        <DollarSign size={20} /> <span style={{ fontWeight: 'var(--font-bold)' }}>Financeiro</span>
                                    </div>
                                    <p style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--color-text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                                        {renderTextValue(analysis?.pricingConsiderations) || 'Análise financeira não disponível para este edital.'}
                                    </p>
                                </div>

                                {/* Prazos */}
                                <div style={{ ...metricsCardStyle, background: 'var(--color-primary-light)', border: '1px solid var(--color-primary-border)' }}>
                                    <div style={{ color: 'var(--color-primary-hover)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                                        <Calendar size={20} /> <span style={{ fontWeight: 'var(--font-bold)' }}>Cronograma Crítico</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                        {deadlineList.length > 0 ? deadlineList.map((dl, i) => (
                                            <div key={i} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                                                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-primary)', marginTop: '7px', flexShrink: 0 }} />
                                                <span style={{ fontSize: '0.875rem', color: 'var(--color-primary-hover)', lineHeight: 1.5 }}>{dl}</span>
                                            </div>
                                        )) : (
                                            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>Prazos não identificados no edital.</p>
                                        )}
                                    </div>
                                </div>

                                {/* Penalidades */}
                                <div style={{ ...metricsCardStyle, background: 'var(--color-urgency-bg)', border: '1px solid var(--color-urgency-border)' }}>
                                    <div style={{ color: 'var(--color-urgency)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                                        <ShieldAlert size={20} /> <span style={{ fontWeight: 'var(--font-bold)' }}>Penalidades</span>
                                    </div>
                                    <p style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--color-urgency)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                                        {renderTextValue(analysis?.penalties) || 'Penalidades não identificadas no edital.'}
                                    </p>
                                </div>

                                {/* Risks / Red Flags */}
                                <div style={{ ...metricsCardStyle, background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)' }}>
                                    <div style={{ color: 'var(--color-danger-hover)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                                        <AlertTriangle size={20} /> <span style={{ fontWeight: 'var(--font-bold)' }}>Riscos e Pontos de Atenção</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                        {flagList.length > 0 ? flagList.map((flag, i) => (
                                            <div key={i} style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--color-bg-surface)', border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius-lg)', fontSize: '0.8125rem', color: 'var(--color-danger-hover)', fontWeight: 500 }}>
                                                {flag}
                                            </div>
                                        )) : (
                                            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>Nenhum risco identificado.</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Modern Chat Experience */
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
                                                <button key={i} onClick={() => handleSendMessage(reply)} className="quick-reply-btn">
                                                    {reply}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {messages.map((msg) => (
                                    <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 'var(--space-3)' }}>
                                        {msg.role === 'model' && (
                                            <div style={{ width: '32px', height: '32px', background: 'linear-gradient(135deg, var(--color-primary), var(--color-ai))', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                <Brain size={18} color="white" />
                                            </div>
                                        )}
                                        <div style={{
                                            maxWidth: '70%',
                                            padding: 'var(--space-4) var(--space-5)',
                                            borderRadius: 'var(--radius-xl)',
                                            background: msg.role === 'user' ? 'var(--color-text-primary)' : 'var(--color-bg-surface)',
                                            color: msg.role === 'user' ? 'white' : 'var(--color-text-primary)',
                                            fontSize: '0.9375rem',
                                            lineHeight: 1.6,
                                            boxShadow: msg.role === 'model' ? 'var(--shadow-sm)' : 'none',
                                            borderBottomRightRadius: msg.role === 'user' ? '4px' : 'var(--radius-xl)',
                                            borderBottomLeftRadius: msg.role === 'model' ? '4px' : 'var(--radius-xl)',
                                            whiteSpace: 'pre-wrap'
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

                            {/* Chat Footer */}
                            <div style={{ padding: 'var(--space-6) var(--space-10)', background: 'var(--color-bg-surface)', borderTop: '1px solid var(--color-border)' }}>
                                <div style={{ display: 'flex', gap: 'var(--space-4)', background: 'var(--color-bg-base)', padding: '8px 8px 8px 20px', borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-border)' }}>
                                    <input
                                        placeholder="Digitar pergunta específica sobre o edital..."
                                        style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: '0.9375rem', color: 'var(--color-text-primary)' }}
                                        value={inputText}
                                        onChange={(e) => setInputText(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                        disabled={isSending}
                                    />
                                    <button
                                        onClick={() => handleSendMessage()}
                                        disabled={!inputText.trim() || isSending}
                                        style={{
                                            background: 'var(--color-text-primary)',
                                            color: 'white',
                                            border: 'none',
                                            padding: 'var(--space-3) var(--space-6)',
                                            borderRadius: 'var(--radius-lg)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 'var(--space-2)',
                                            cursor: 'pointer',
                                            opacity: (!inputText.trim() || isSending) ? 0.5 : 1,
                                            transition: 'var(--transition-fast)'
                                        }}
                                    >
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

                {/* Main Modal Footer */}
                <div style={{
                    padding: 'var(--space-5) var(--space-10)',
                    background: 'var(--color-bg-surface)',
                    borderTop: '1px solid var(--color-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>
                        <span style={{ fontWeight: 'var(--font-semibold)' }}>ID ANÁLISE: {analysis?.id.slice(0, 8)}</span>
                        <span>•</span>
                        <span>{new Date(analysis?.analyzedAt).toLocaleString('pt-BR')}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                        {onImport && (
                            <button
                                onClick={onImport}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-2)',
                                    padding: 'var(--space-3) var(--space-6)',
                                    borderRadius: 'var(--radius-lg)',
                                    border: 'none',
                                    background: 'linear-gradient(135deg, var(--color-primary), var(--color-ai))',
                                    color: 'white',
                                    fontWeight: 'var(--font-bold)',
                                    fontSize: 'var(--text-md)',
                                    cursor: 'pointer',
                                    boxShadow: 'var(--shadow-md)',
                                    transition: 'var(--transition-fast)'
                                }}
                                onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(59, 130, 246, 0.45)'; }}
                                onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.35)'; }}
                            >
                                <Plus size={16} /> Importar para o Funil
                            </button>
                        )}
                        <button className="btn btn-outline" onClick={onClose} style={{ borderRadius: 'var(--radius-lg)', padding: 'var(--space-3) var(--space-6)' }}>
                            Fechar Painel
                        </button>
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUp { from { transform: translateY(30px) scale(0.98); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
                .report-card { 
                .report-card {
                    background: var(--color-bg-surface);
                    padding: var(--space-8);
                    border-radius: var(--radius-xl);
                    border: 1px solid var(--color-border);
                    box-shadow: var(--shadow-xs);
                }
                .quick-reply-btn {
                    padding: var(--space-3) var(--space-5);
                    border-radius: var(--radius-lg);
                    background: var(--color-bg-surface);
                    border: 1px solid var(--color-border);
                    color: var(--color-text-secondary);
                    font-size: 0.875rem;
                    cursor: pointer;
                    transition: var(--transition-fast);
                }
                .quick-reply-btn:hover {
                    border-color: var(--color-primary);
                    color: var(--color-primary);
                    background: var(--color-primary-light);
                }
                ::-webkit-scrollbar { width: 8px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 10px; }
                ::-webkit-scrollbar-thumb:hover { background: var(--color-text-tertiary); }
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

const tabStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    fontSize: 'var(--text-base)',
    fontWeight: 'var(--font-bold)',
    padding: 'var(--space-3) var(--space-1)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    cursor: 'pointer',
    transition: 'var(--transition-fast)',
};

const sectionHeaderStyle: React.CSSProperties = {
    fontSize: 'var(--text-xl)',
    fontWeight: 'var(--font-bold)',
    color: 'var(--color-text-primary)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-5)'
};

const metricsCardStyle: React.CSSProperties = {
    padding: 'var(--space-6)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-xs)'
};
