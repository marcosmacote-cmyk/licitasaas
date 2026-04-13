import React from 'react';
import { MessageSquare, Loader2, Send, ScanSearch } from 'lucide-react';
import { renderMarkdown } from '../../utils/markdownRenderer';
import type { useAiChat } from '../hooks/useAiChat';

interface Props {
    chat: ReturnType<typeof useAiChat>;
}

const quickReplies = [
    "Traga a relação completa dos documentos de habilitação exigidos, com os itens de referência do edital",
    "Analise os requisitos de qualificação técnica e aponte riscos de inabilitação",
    "Liste todos os prazos críticos com datas e consequências de descumprimento",
    "Quais são os critérios de julgamento e formação de preço?",
    "Identifique cláusulas restritivas ou irregularidades no edital"
];

export function AiReportTabChat({ chat }: Props) {
    const { messages, inputText, setInputText, isSending, messagesEndRef, handleSendMessage } = chat;

    return (
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

            <div style={{ padding: 'var(--space-6) var(--space-10)', background: 'var(--color-bg-surface)', borderTop: 'none', boxShadow: '0 -1px 0 var(--color-border)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-4)', background: 'var(--color-bg-base)', padding: '8px 8px 8px 20px', borderRadius: 'var(--radius-full)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)', transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                    <input placeholder="Digitar pergunta específica sobre o edital..." style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: '0.9375rem', color: 'var(--color-text-primary)' }}
                        value={inputText} onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} disabled={isSending} />
                    <button onClick={() => handleSendMessage()} disabled={!inputText.trim() || isSending}
                        style={{
                            background: 'var(--color-text-primary)', color: 'white', border: 'none', padding: 'var(--space-3) var(--space-6)', borderRadius: 'var(--radius-full)',
                            display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', opacity: (!inputText.trim() || isSending) ? 0.5 : 1, transition: 'var(--transition-fast)'
                        }}>
                        <Send size={18} />
                    </button>
                </div>
                <p style={{ margin: '12px 0 0', fontSize: '0.75rem', color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
                    Dica: Pergunte sobre itens de habilitação específicos ou prazos de impugnação.
                </p>
            </div>
        </div>
    );
}
