import React from 'react';
import { Search, Loader2, Bookmark, FolderOpen, BarChart2, Star } from 'lucide-react';
import { EducationalPopover } from '../ui';
import type { PncpChildProps } from './types';

export function PncpHeader({ p, items }: PncpChildProps) {
    return (
        <div className="page-header" style={{ marginBottom: 'var(--space-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
            <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <h1 className="page-title">Módulo de Oportunidades</h1>
                    <EducationalPopover
                        id="edu_pncp_overview"
                        title="Bem-vindo ao Localizador!"
                        content={
                            <>
                                <p style={{ marginTop: 0 }}>Esta é a sua porta de entrada. O sistema não apenas <b>pesquisa ativamente</b> fontes oficiais (PNCP e ComprasNet) usando suas palavras-chave, mas também age como um <b>Scanner Automático</b>.</p>
                                <ul style={{ paddingLeft: 'var(--space-4)', margin: 'var(--space-2) 0 0 0' }}>
                                    <li>Crie e salve pesquisas nas abas abaixo.</li>
                                    <li>Ative as notificações para receber novos editais no WhatsApp.</li>
                                    <li>Em 1-clique, adicione os editais favoritos diretamente no seu Pipeline (Painel).</li>
                                </ul>
                            </>
                        }
                    >
                        <span style={{ fontSize: 'var(--text-xl)' }}>💡</span>
                    </EducationalPopover>
                </div>
                <p className="page-subtitle">Central de prospecção e ingestão de licitações com IA.</p>
                {/* ── Dashboard Indicators ── */}
                <div style={{ display: 'flex', gap: 'var(--space-3)', overflowX: 'auto', paddingTop: 'var(--space-3)' }}>
                    <div className="indicator-card" style={{ padding: '8px 12px' }}>
                        <div className="indicator-label"><BarChart2 size={12} /> Descobertos</div>
                        <div className="indicator-value" style={{ fontSize: '1.2rem' }}>{(p.totalResults || 0).toLocaleString('pt-BR')}</div>
                    </div>
                    <div className="indicator-card" style={{ padding: '8px 12px' }}>
                        <div className="indicator-label"><Bookmark size={12} /> No Funil</div>
                        <div className="indicator-value" style={{ color: 'var(--color-primary)', fontSize: '1.2rem' }}>{items?.length || 0}</div>
                    </div>
                    <div className="indicator-card" style={{ padding: '8px 12px' }}>
                        <div className="indicator-label"><Star size={12} /> Favoritos</div>
                        <div className="indicator-value" style={{ color: 'var(--color-warning)', fontSize: '1.2rem' }}>{p.favoritos.length}</div>
                    </div>
                </div>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'flex-end', flex: '1 1 auto' }}>
                {/* ── Botão de Upload Manual ── */}
                <div style={{ display: 'flex' }}>
                    <input type="file" accept="application/pdf, application/zip, application/x-zip-compressed, application/vnd.rar, .rar, .zip" ref={p.fileInputRef} style={{ display: 'none' }} onChange={p.handleFileUpload} multiple />
                    <button className="btn btn-primary" onClick={p.handleAIAssistClick} disabled={p.isParsingAI} style={{ padding: '10px 24px', boxShadow: 'var(--shadow-md)' }} data-tour="pncp-upload">
                        {p.isParsingAI ? <><Loader2 size={16} className="spinner" /> Processando PDF...</> : <><FolderOpen size={16} /> Upload de Edital</>}
                    </button>
                </div>

                {/* ── Notificações Card ── */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', background: 'var(--color-bg-surface)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', lineHeight: '1.4', maxWidth: '280px', textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.opportunityScannerEnabled ? '#10b981' : '#9ca3af', boxShadow: p.opportunityScannerEnabled ? '0 0 8px rgba(16, 185, 129, 0.4)' : 'none' }} />
                            <strong style={{ color: 'var(--color-text-primary)' }}>
                                {p.opportunityScannerEnabled ? 'Notificações Ativas' : 'Notificações Inativas'}
                            </strong>
                        </div>
                        <div style={{ marginTop: '2px' }}>
                            {p.opportunityScannerEnabled ? (
                                <>Monitoramento automático via <strong>WhatsApp, Telegram e E-mail</strong>.</>
                            ) : (
                                <>Ative os alertas automáticos das pesquisas salvas.</>
                            )}
                        </div>
                    </div>

                    <div style={{ height: '32px', width: '1px', background: 'var(--color-border)', margin: '0 4px' }} />

                    <button 
                        onClick={() => p.toggleOpportunityScanner(!p.opportunityScannerEnabled)}
                        className="btn btn-outline"
                        style={{
                            padding: '6px 14px', fontSize: '0.8125rem', gap: '6px',
                            borderRadius: 'var(--radius-md)', 
                            color: p.opportunityScannerEnabled ? 'var(--color-danger)' : 'var(--color-primary)', 
                            borderColor: p.opportunityScannerEnabled ? 'rgba(239, 68, 68, 0.2)' : 'rgba(37, 99, 235, 0.2)',
                            background: p.opportunityScannerEnabled ? 'rgba(239, 68, 68, 0.05)' : 'rgba(37, 99, 235, 0.05)'
                        }}
                    >
                        {p.opportunityScannerEnabled ? 'Desativar Alertas' : 'Ativar Alertas'}
                    </button>
                    
                    <button 
                        onClick={p.handleTriggerScan}
                        className="icon-btn"
                        style={{ padding: '6px', color: 'var(--color-text-secondary)', cursor: p.loading ? 'wait' : 'pointer' }}
                        title="Forçar busca manual agora"
                        disabled={p.loading}
                    >
                        {p.loading ? <Loader2 size={16} className="spinner" /> : <Search size={16} />} 
                    </button>
                </div>
            </div>
        </div>
    );
}
