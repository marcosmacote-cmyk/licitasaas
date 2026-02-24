import { useState, useRef, useEffect, useMemo } from 'react';
import { Brain, FileCheck, DollarSign, AlertTriangle, X, Send, Loader2, MessageSquare, Calendar, ShieldAlert, Award, FileX, CheckCircle2, ChevronRight, Sparkles } from 'lucide-react';
import type { AiAnalysis, BiddingProcess, CompanyDocument } from '../types';
import { API_BASE_URL } from '../config';
import { aiService } from '../services/ai';
import axios from 'axios';

interface Props {
    analysis: AiAnalysis;
    process: BiddingProcess;
    onClose: () => void;
    onUpdate: () => void;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
}

export function AiReportModal({ analysis, process, onClose, onUpdate }: Props) {
    const [activeTab, setActiveTab] = useState<'report' | 'chat'>('report');
    const [messages, setMessages] = useState<ChatMessage[]>(() => {
        try {
            return typeof analysis.chatHistory === 'string'
                ? JSON.parse(analysis.chatHistory)
                : (analysis.chatHistory || []);
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
            if (process.link) {
                const urls = process.link.split(',').map(u => u.trim());
                fileNames = urls.map(url => url.split('/').pop() || '').filter(Boolean);
            }
            const currentMessagesForAI = [...messages, userMsg].map(m => ({ role: m.role, text: m.text }));
            const replyText = await aiService.chatWithEdital(fileNames, currentMessagesForAI, process.id);

            const modelMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: replyText };
            const updatedMessages = [...messages, userMsg, modelMsg];
            setMessages(updatedMessages);

            try {
                const { biddingProcessId: _bId, ...analysisData } = analysis as any;
                await axios.post(`${API_BASE_URL}/api/analysis`, {
                    biddingProcessId: process.id,
                    ...analysisData,
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

    const parseArray = (data: string | string[]): string[] => {
        if (Array.isArray(data)) return data;
        try { return JSON.parse(data) as string[]; } catch { return []; }
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
                elements.push(<h4 key={`h-${key++}`} style={{ fontWeight: 700, fontSize: '0.95rem', marginTop: '16px', marginBottom: '4px', color: '#1e293b' }}>{formatInline(trimmed.slice(4))}</h4>);
                continue;
            }
            if (trimmed.startsWith('## ')) {
                elements.push(<h3 key={`h-${key++}`} style={{ fontWeight: 700, fontSize: '1.05rem', marginTop: '18px', marginBottom: '6px', color: '#0f172a' }}>{formatInline(trimmed.slice(3))}</h3>);
                continue;
            }
            if (trimmed.startsWith('# ')) {
                elements.push(<h2 key={`h-${key++}`} style={{ fontWeight: 800, fontSize: '1.1rem', marginTop: '20px', marginBottom: '8px', color: '#0f172a' }}>{formatInline(trimmed.slice(2))}</h2>);
                continue;
            }

            // Separator ---
            if (trimmed === '---') {
                elements.push(<hr key={`hr-${key++}`} style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '12px 0' }} />);
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

    const flagList = parseArray(analysis.irregularitiesFlags);
    const deadlineList = parseArray(analysis.deadlines || []);

    const [companyDocs, setCompanyDocs] = useState<CompanyDocument[]>([]);
    const [isLoadingDocs, setIsLoadingDocs] = useState(false);

    useEffect(() => {
        if (process.companyProfileId) {
            setIsLoadingDocs(true);
            fetch(`${API_BASE_URL}/api/documents`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            })
                .then(res => res.json())
                .then((data: CompanyDocument[]) => {
                    const tiedDocs = data.filter(d => d.companyProfileId === process.companyProfileId);
                    setCompanyDocs(tiedDocs);
                })
                .catch(err => console.error("Failed to fetch company docs:", err))
                .finally(() => setIsLoadingDocs(false));
        }
    }, [process.companyProfileId]);

    const categorizedDocs = useMemo(() => {
        let rawData: any = {};
        try {
            rawData = typeof analysis.requiredDocuments === 'string'
                ? JSON.parse(analysis.requiredDocuments)
                : analysis.requiredDocuments;

            // If it's an array, it's the old flat format. Convert to a single category.
            if (Array.isArray(rawData)) {
                rawData = { "Documentos Exigidos": rawData.map(d => typeof d === 'string' ? { item: '-', description: d } : d) };
            }
        } catch (e) {
            console.error("Failed to parse requiredDocuments", e);
            // Fallback for plain text
            if (typeof analysis.requiredDocuments === 'string' && analysis.requiredDocuments.trim()) {
                rawData = { "Processamento": [{ item: 'Info', description: analysis.requiredDocuments }] };
            }
        }

        const categories = ["Habilitação Jurídica", "Regularidade Fiscal, Social e Trabalhista", "Qualificação Técnica", "Qualificação Econômica Financeira", "Outros", "Documentos Exigidos", "Processamento"];
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
    }, [analysis.requiredDocuments, companyDocs]);

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
                borderRadius: '2rem',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                overflow: 'hidden',
                backgroundColor: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                display: 'flex',
                flexDirection: 'column'
            }}>
                {/* Modern AI Header */}
                <div style={{
                    padding: '32px 40px',
                    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                    color: 'white',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '24px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div style={{ padding: '12px', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', borderRadius: '16px', boxShadow: '0 0 20px rgba(59, 130, 246, 0.4)' }}>
                                <Brain size={28} color="white" />
                            </div>
                            <div>
                                <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0, letterSpacing: '-0.025em' }}>
                                    Análise Estratégica <span style={{ color: '#93c5fd' }}>IA</span>
                                </h2>
                                <p style={{ color: '#94a3b8', fontSize: '0.9375rem', marginTop: '4px' }}>
                                    Processando: <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{process.title}</span>
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
                    <div style={{ display: 'flex', gap: '32px' }}>
                        <button
                            onClick={() => setActiveTab('report')}
                            style={{
                                ...tabStyle,
                                color: activeTab === 'report' ? '#60a5fa' : '#64748b',
                                borderBottom: activeTab === 'report' ? '3px solid #60a5fa' : '3px solid transparent'
                            }}
                        >
                            <FileCheck size={18} /> Relatório Analítico
                        </button>
                        <button
                            onClick={() => setActiveTab('chat')}
                            style={{
                                ...tabStyle,
                                color: activeTab === 'chat' ? '#60a5fa' : '#64748b',
                                borderBottom: activeTab === 'chat' ? '3px solid #60a5fa' : '3px solid transparent'
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
                            padding: '40px',
                            overflowY: 'auto',
                            display: 'grid',
                            gridTemplateColumns: 'minmax(0, 1.8fr) minmax(0, 1fr)',
                            gap: '40px',
                            background: '#f8fafc'
                        }}>
                            {/* Left Column: Core Analysis */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

                                {/* Resumo Executivo */}
                                <div className="report-card">
                                    <h3 style={sectionHeaderStyle}><Sparkles size={18} /> Resumo Executivo</h3>
                                    <p style={{ color: '#334155', fontSize: '1rem', lineHeight: 1.7, margin: 0 }}>
                                        {analysis.fullSummary}
                                    </p>
                                </div>

                                {/* Detalhamento de Itens */}
                                {analysis.biddingItems && (
                                    <div className="report-card">
                                        <h3 style={sectionHeaderStyle}><FileCheck size={18} /> Itens Licitados</h3>
                                        <div style={{ padding: '20px', backgroundColor: '#f1f5f9', borderRadius: '1rem', border: '1px solid #e2e8f0' }}>
                                            <p style={{ color: '#475569', fontSize: '0.9375rem', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
                                                {analysis.biddingItems}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* Document Readiness Matcher */}
                                <div className="report-card">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                        <h3 style={{ ...sectionHeaderStyle, marginBottom: 0 }}><Award size={18} /> Habilitação Requerida</h3>
                                        {process.companyProfileId && !isLoadingDocs && (
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '12px',
                                                padding: '8px 16px',
                                                backgroundColor: readinessScore > 70 ? '#dcfce7' : '#fef9c3',
                                                borderRadius: '2rem',
                                                border: `1px solid ${readinessScore > 70 ? '#86efac' : '#fef08a'}`
                                            }}>
                                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: readinessScore > 70 ? '#22c55e' : '#eab308' }} />
                                                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: readinessScore > 70 ? '#166534' : '#854d0e' }}>
                                                    Readiness: {readinessScore}%
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {isLoadingDocs ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '20px', color: '#64748b' }}>
                                            <Loader2 size={20} className="spinner" /> Sincronizando com documentos cadastrados...
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                            {Object.entries(categorizedDocs).map(([category, docs]) => docs.length > 0 && (
                                                <div key={category}>
                                                    <div style={{ fontSize: '0.8125rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        {category} <div style={{ height: '1px', flex: 1, backgroundColor: '#e2e8f0' }} />
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                        {docs.map((doc, idx) => (
                                                            <div key={idx} style={{
                                                                padding: '16px 20px',
                                                                background: 'white',
                                                                borderRadius: '1rem',
                                                                border: '1px solid #e2e8f0',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '16px',
                                                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                                            }}>
                                                                <div style={{
                                                                    padding: '8px',
                                                                    borderRadius: '10px',
                                                                    background: doc.hasMatch ? '#f0fdf4' : '#fff1f2'
                                                                }}>
                                                                    {doc.hasMatch ? <CheckCircle2 size={18} color="#22c55e" /> : <FileX size={18} color="#f43f5e" />}
                                                                </div>
                                                                <div style={{ flex: 1 }}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                                                        {doc.item && doc.item !== '-' && (
                                                                            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#3b82f6', background: '#eff6ff', padding: '4px 10px', borderRadius: '6px', border: '1px solid #dbeafe' }}>
                                                                                ITEM {doc.item}
                                                                            </span>
                                                                        )}
                                                                        {!doc.hasMatch ? (
                                                                            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#f43f5e', background: '#fff1f2', padding: '4px 10px', borderRadius: '6px' }}>PENDENTE</span>
                                                                        ) : (
                                                                            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#10b981', background: '#ecfdf5', padding: '4px 10px', borderRadius: '6px' }}>MAPPED</span>
                                                                        )}
                                                                    </div>
                                                                    <p style={{ margin: 0, fontSize: '1rem', color: '#1e293b', fontWeight: 500, lineHeight: 1.5 }}>{doc.description}</p>
                                                                </div>
                                                                <ChevronRight size={16} color="#cbd5e1" />
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
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                                {/* Financial */}
                                <div style={{ ...metricsCardStyle, background: 'linear-gradient(135deg, #fff 0%, #f0fdf4 100%)', border: '1px solid #dcfce7' }}>
                                    <div style={{ color: '#166534', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                        <DollarSign size={20} /> <span style={{ fontWeight: 700 }}>Financeiro</span>
                                    </div>
                                    <p style={{ margin: 0, fontSize: '0.9375rem', color: '#374151', lineHeight: 1.6 }}>{analysis.pricingConsiderations}</p>
                                </div>

                                {/* Prazos */}
                                <div style={{ ...metricsCardStyle, background: 'linear-gradient(135deg, #fff 0%, #eff6ff 100%)', border: '1px solid #dbeafe' }}>
                                    <div style={{ color: '#1e40af', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                                        <Calendar size={20} /> <span style={{ fontWeight: 700 }}>Cronograma Crítico</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        {deadlineList.map((dl, i) => (
                                            <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                                                <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#3b82f6', marginTop: '8px' }} />
                                                <span style={{ fontSize: '0.875rem', color: '#1e3a8a' }}>{dl}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Penalidades */}
                                {analysis.penalties && (
                                    <div style={{ ...metricsCardStyle, background: 'linear-gradient(135deg, #fff 0%, #fff7ed 100%)', border: '1px solid #ffedd5' }}>
                                        <div style={{ color: '#9a3412', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                            <ShieldAlert size={20} /> <span style={{ fontWeight: 700 }}>Penalidades</span>
                                        </div>
                                        <p style={{ margin: 0, fontSize: '0.875rem', color: '#7c2d12', lineHeight: 1.6 }}>{analysis.penalties}</p>
                                    </div>
                                )}

                                {/* Risks / Red Flags */}
                                <div style={{ ...metricsCardStyle, background: '#fef2f2', border: '1px solid #fee2e2' }}>
                                    <div style={{ color: '#991b1b', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                                        <AlertTriangle size={20} /> <span style={{ fontWeight: 700 }}>Riscos e Pontos de Atenção</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {flagList.map((flag, i) => (
                                            <div key={i} style={{ padding: '10px 12px', background: 'white', border: '1px solid #fecaca', borderRadius: '0.75rem', fontSize: '0.8125rem', color: '#b91c1c', fontWeight: 500 }}>
                                                {flag}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Modern Chat Experience */
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f1f5f9' }}>
                            <div style={{ flex: 1, overflowY: 'auto', padding: '40px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                {messages.length === 0 && (
                                    <div style={{ textAlign: 'center', maxWidth: '500px', margin: '60px auto' }}>
                                        <div style={{ width: '80px', height: '80px', background: 'white', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
                                            <MessageSquare size={40} color="#3b82f6" />
                                        </div>
                                        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>Consultor de Edital IA</h3>
                                        <p style={{ color: '#64748b', lineHeight: 1.6 }}>Olá! Analisei integralmente os documentos deste processo. Como posso te ajudar a vencer esta licitação?</p>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', marginTop: '32px' }}>
                                            {quickReplies.map((reply, i) => (
                                                <button key={i} onClick={() => handleSendMessage(reply)} className="quick-reply-btn">
                                                    {reply}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {messages.map((msg) => (
                                    <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: '12px' }}>
                                        {msg.role === 'model' && (
                                            <div style={{ width: '32px', height: '32px', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                <Brain size={18} color="white" />
                                            </div>
                                        )}
                                        <div style={{
                                            maxWidth: '70%',
                                            padding: '16px 20px',
                                            borderRadius: '1.25rem',
                                            background: msg.role === 'user' ? '#1e293b' : 'white',
                                            color: msg.role === 'user' ? 'white' : '#1e293b',
                                            fontSize: '0.9375rem',
                                            lineHeight: 1.6,
                                            boxShadow: msg.role === 'model' ? '0 4px 6px -1px rgba(0,0,0,0.05)' : 'none',
                                            borderBottomRightRadius: msg.role === 'user' ? '4px' : '1.25rem',
                                            borderBottomLeftRadius: msg.role === 'model' ? '4px' : '1.25rem',
                                            whiteSpace: 'pre-wrap'
                                        }}>
                                            {msg.role === 'model' ? renderMarkdown(msg.text) : msg.text}
                                        </div>
                                    </div>
                                ))}
                                {isSending && (
                                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', color: '#64748b', fontSize: '0.875rem' }}>
                                        <div style={{ width: '32px', height: '32px', background: '#e2e8f0', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Loader2 size={18} className="spinner" />
                                        </div>
                                        Sua consultoria está processando a resposta...
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Chat Footer */}
                            <div style={{ padding: '24px 40px', background: 'white', borderTop: '1px solid #e2e8f0' }}>
                                <div style={{ display: 'flex', gap: '16px', background: '#f8fafc', padding: '8px 8px 8px 20px', borderRadius: '1.25rem', border: '1px solid #e2e8f0' }}>
                                    <input
                                        placeholder="Digitar pergunta específica sobre o edital..."
                                        style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: '0.9375rem', color: '#1e293b' }}
                                        value={inputText}
                                        onChange={(e) => setInputText(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                        disabled={isSending}
                                    />
                                    <button
                                        onClick={() => handleSendMessage()}
                                        disabled={!inputText.trim() || isSending}
                                        style={{
                                            background: '#1e293b',
                                            color: 'white',
                                            border: 'none',
                                            padding: '12px 24px',
                                            borderRadius: '1rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            cursor: 'pointer',
                                            opacity: (!inputText.trim() || isSending) ? 0.5 : 1,
                                            transition: 'transform 0.1s active'
                                        }}
                                    >
                                        <Send size={18} /> Pergunta
                                    </button>
                                </div>
                                <p style={{ margin: '12px 0 0', fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center' }}>
                                    Dica: Pergunte sobre itens de habilitação específicos ou prazos de impugnação.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Main Modal Footer */}
                <div style={{
                    padding: '20px 40px',
                    background: 'white',
                    borderTop: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8', fontSize: '0.75rem' }}>
                        <span style={{ fontWeight: 600 }}>ID ANÁLISE: {analysis.id.slice(0, 8)}</span>
                        <span>•</span>
                        <span>{new Date(analysis.analyzedAt).toLocaleString('pt-BR')}</span>
                    </div>
                    <button className="btn btn-outline" onClick={onClose} style={{ borderRadius: '12px', padding: '10px 24px' }}>
                        Fechar Painel
                    </button>
                </div>
            </div>

            <style>{`
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUp { from { transform: translateY(30px) scale(0.98); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
                .report-card { 
                .report-card {
                    background: white;
                    padding: 32px;
                    border-radius: 1.5rem;
                    border: 1px solid #e2e8f0;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                }
                .quick-reply-btn {
                    padding: 10px 18px;
                    border-radius: 1rem;
                    background: white;
                    border: 1px solid #e2e8f0;
                    color: '#64748b';
                    font-size: 0.875rem;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .quick-reply-btn:hover {
                    border-color: #3b82f6;
                    color: #3b82f6;
                    background: #f0f7ff;
                }
                ::-webkit-scrollbar { width: 8px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
                ::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
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
    fontSize: '0.9375rem',
    fontWeight: 700,
    padding: '12px 4px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    cursor: 'pointer',
    transition: 'all 0.2s',
};

const sectionHeaderStyle: React.CSSProperties = {
    fontSize: '1.125rem',
    fontWeight: 700,
    color: '#1e293b',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '20px'
};

const metricsCardStyle: React.CSSProperties = {
    padding: '24px',
    borderRadius: '1.5rem',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
};
