import React from 'react';
import { Loader2, Star, Bell, Search, MapPin, ExternalLink, Brain, Trash2, CheckCircle2 } from 'lucide-react';
import { normalizeModality } from '../../utils/normalizeModality';
import type { PncpChildProps } from './types';

export function PncpResultsTable({ p, items, loaderRef }: PncpChildProps & { loaderRef: any }) {
    return (
        <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-xl)', border: 'none', boxShadow: 'var(--shadow-sm), 0 0 0 1px var(--color-border)', overflow: 'hidden' }}>
            <table className="table" style={{ width: '100%' }}>
                <thead>
                    <tr>
                        <th style={{ paddingLeft: '24px', width: '22%' }}>Órgão / Localidade</th>
                        <th style={{ width: '38%' }}>Objeto</th>
                        <th style={{ width: '12%' }}>Modalidade</th>
                        <th style={{ width: '10%' }}>Prazo Limite</th>
                        <th style={{ width: '8%', textAlign: 'right' }}>Valor Est.</th>
                        <th style={{ paddingRight: '24px', width: '10%', textAlign: 'right' }}>Ações</th>
                    </tr>
                </thead>
                <tbody>
                    {(p.loading || (p.activeTab === 'found' && p.scannerOpportunitiesLoading)) ? (
                        <tr>
                            <td colSpan={6} style={{ textAlign: 'center', padding: '60px' }}>
                                <Loader2 size={32} className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
                                <div style={{ marginTop: '12px', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
                                    {p.activeTab === 'found' ? 'Carregando oportunidades...' : 'Consultando PNCP...'}
                                </div>
                            </td>
                        </tr>
                    ) : p.displayItems.length === 0 ? (
                        <tr>
                            <td colSpan={6} style={{ textAlign: 'center', padding: '60px', color: 'var(--color-text-tertiary)' }}>
                                {p.activeTab === 'favorites' ? <Star size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                                    : p.activeTab === 'found' ? <Bell size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                                    : <Search size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />}
                                <div style={{ fontSize: '1rem', fontWeight: 500 }}>
                                    {p.activeTab === 'favorites' ? 'Nenhum edital nos favoritos'
                                        : p.activeTab === 'found' ? 'Nenhuma oportunidade encontrada pelo scanner'
                                        : 'Nenhum edital encontrado'}
                                </div>
                                <div style={{ fontSize: '0.8125rem', marginTop: '4px' }}>
                                    {p.activeTab === 'favorites' ? 'Clique na estrela para favoritar resultados.'
                                        : p.activeTab === 'found' ? 'Ative o scanner e aguarde a próxima varredura automática.'
                                        : 'Tente ajustar as palavras-chave ou filtros.'}
                                </div>
                            </td>
                        </tr>
                    ) : (
                        p.displayItems.map((item) => {
                            const isFavorito = p.favoritos.some(f => f.id === item.id);
                            const isOnKanban = items.some(proc => proc.link && item.link_sistema && proc.link.includes(item.link_sistema));
                            const isUnviewed = p.activeTab === 'found' && (item as any)._isViewed === false;
                            const searchName = p.activeTab === 'found' ? (item as any)._searchName : null;
                            const foundAt = p.activeTab === 'found' ? (item as any)._foundAt : null;

                            return (
                                <React.Fragment key={item.id}>
                                <tr style={{ 
                                    transition: 'background 0.15s',
                                    borderLeft: isUnviewed ? '3px solid var(--color-primary)' : 'none',
                                    background: isUnviewed ? 'rgba(37, 99, 235, 0.03)' : 'transparent',
                                }}
                                    onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--color-bg-base)'}
                                    onMouseLeave={(e: any) => e.currentTarget.style.background = isUnviewed ? 'rgba(37, 99, 235, 0.03)' : 'transparent'}
                                >
                                    <td style={{ paddingLeft: '24px', verticalAlign: 'top', paddingTop: '16px', paddingBottom: '16px' }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.8125rem', lineHeight: '1.4' }}>{item.orgao_nome}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                                            <MapPin size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '2px' }} /> {item.municipio} - {item.uf}
                                        </div>
                                        {searchName && (
                                            <div style={{ fontSize: '0.6875rem', color: 'var(--color-primary)', marginTop: '4px', opacity: 0.8 }}>
                                                <Search size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '2px' }} /> {searchName}
                                                {foundAt && <> · {new Date(foundAt).toLocaleDateString('pt-BR')}</>}
                                            </div>
                                        )}
                                    </td>
                                    <td style={{ verticalAlign: 'top', paddingTop: '16px', paddingBottom: '16px' }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: '4px', lineHeight: '1.3' }}>
                                            {item.titulo}
                                            {(p.activeTab === 'favorites' || p.activeTab === 'found') && isOnKanban && (
                                                <span style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    marginLeft: 'var(--space-2)',
                                                    padding: '3px var(--space-2)',
                                                    background: 'var(--color-success-bg)',
                                                    color: 'var(--color-success)',
                                                    borderRadius: 'var(--radius-lg)',
                                                    fontSize: 'var(--text-sm)',
                                                    fontWeight: 'var(--font-bold)' as any,
                                                    verticalAlign: 'middle'
                                                }} title="Esta licitação já foi captada para o Kanban.">
                                                    <CheckCircle2 size={12} />
                                                    Salvo no Kanban
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: '1.4' }}>
                                            {item.objeto}
                                        </div>
                                    </td>
                                    <td style={{ verticalAlign: 'top', paddingTop: '16px', whiteSpace: 'nowrap' }}>
                                        {item.modalidade_nome ? (
                                            <span style={{
                                                display: 'inline-block',
                                                padding: '3px var(--space-3)',
                                                borderRadius: 'var(--radius-sm)',
                                                background: 'var(--color-primary-light)',
                                                color: 'var(--color-primary)',
                                                fontSize: 'var(--text-sm)',
                                                fontWeight: 'var(--font-semibold)' as any,
                                            }}>{ normalizeModality(item.modalidade_nome) }</span>
                                        ) : (
                                            <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>—</span>
                                        )}
                                    </td>
                                    {/* Prazo Limite (data fim de recebimento de propostas) */}
                                    <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top', paddingTop: '16px' }}>
                                        {item.data_encerramento_proposta ? (
                                            <>
                                                <div style={{ fontWeight: 700, fontSize: '0.8125rem', color: new Date(item.data_encerramento_proposta) > new Date() ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>
                                                    {new Date(item.data_encerramento_proposta).toLocaleDateString('pt-BR')}
                                                </div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>
                                                    {new Date(item.data_encerramento_proposta).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            </>
                                        ) : (
                                            <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>—</span>
                                        )}
                                    </td>
                                    <td style={{ fontWeight: 700, verticalAlign: 'top', paddingTop: '16px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                                        {item.valor_estimado ? (
                                            <span style={{ color: 'var(--color-success)' }}>
                                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.valor_estimado)}
                                            </span>
                                        ) : (
                                            <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>N/D</span>
                                        )}
                                    </td>
                                    <td style={{ paddingRight: '24px', verticalAlign: 'top', paddingTop: '14px', textAlign: 'right' }}>
                                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                            <button
                                                className="btn btn-ghost"
                                                onClick={() => p.toggleFavorito(item)}
                                                style={{ padding: '7px', borderRadius: 'var(--radius-md)', color: isFavorito ? 'var(--color-warning)' : 'var(--color-text-tertiary)', background: isFavorito ? 'var(--color-warning-bg)' : 'transparent' }}
                                                title={isFavorito ? "Remover dos Favoritos" : "Adicionar aos Favoritos"}
                                            >
                                                <Star size={15} fill={isFavorito ? "currentColor" : "none"} />
                                            </button>
                                            {isFavorito && (
                                                <button
                                                    className="btn btn-ghost"
                                                    onClick={() => p.toggleFavorito(item)}
                                                    style={{ padding: '7px', borderRadius: 'var(--radius-md)', color: 'var(--color-danger)', background: 'var(--color-danger-bg)' }}
                                                    title="Excluir dos Favoritos"
                                                >
                                                    <Trash2 size={15} />
                                                </button>
                                            )}

                                            <button
                                                className="btn"
                                                style={{
                                                    padding: '7px var(--space-3)',
                                                    fontSize: 'var(--text-sm)',
                                                    borderRadius: 'var(--radius-md)',
                                                    gap: '4px',
                                                    whiteSpace: 'nowrap',
                                                    background: p.analyzingItemId === item.id ? 'linear-gradient(135deg, var(--color-ai), var(--color-primary))' : 'linear-gradient(135deg, var(--color-primary), var(--color-ai))',
                                                    color: 'white',
                                                    border: 'none',
                                                    cursor: p.analyzingItemId ? 'not-allowed' : 'pointer',
                                                    opacity: (p.analyzingItemId && p.analyzingItemId !== item.id) ? 0.5 : 1,
                                                    boxShadow: '0 2px 8px rgba(99, 102, 241, 0.3)',
                                                    transition: 'var(--transition-fast)'
                                                }}
                                                onClick={() => p.handlePncpAiAnalyze(item)}
                                                disabled={!!p.analyzingItemId}
                                                title="Analisar edital com IA (busca PDFs do PNCP automaticamente)"
                                            >
                                                {p.analyzingItemId === item.id ? (
                                                    <><Loader2 size={14} className="spinner" /> Enviando...</>
                                                ) : (
                                                    <><Brain size={14} /> Analisar com IA</>
                                                )}
                                            </button>
                                            <a
                                                href={item.link_sistema}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="btn btn-ghost"
                                                style={{ padding: '7px', borderRadius: 'var(--radius-md)' }}
                                                title="Abrir no PNCP"
                                            >
                                                <ExternalLink size={15} />
                                            </a>
                                        </div>
                                    </td>
                                </tr>
                                </React.Fragment>)
                        })
                    )}
                </tbody>
            </table>

            {/* Infinite Scroll Loader */}
            <div ref={loaderRef} style={{ height: '40px', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 'var(--space-4)' }}>
                {(p.loading || p.scannerOpportunitiesLoading) && <Loader2 size={24} className="spinner" color="var(--color-primary)" />}
            </div>

            {/* Show total records count indicator at the bottom if fully loaded */}
            <div style={{ textAlign: 'center', padding: 'var(--space-4)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>
                {p.activeTab === 'search' && p.page >= Math.ceil(p.totalResults / 10) && p.totalResults > 0 && `Todos os ${p.totalResults} resultados carregados.`}
                {p.activeTab === 'found' && p.scannerOpportunitiesPage >= Math.ceil(p.scannerOpportunitiesTotal / 50) && p.scannerOpportunitiesTotal > 0 && `Todas as ${p.scannerOpportunitiesTotal} oportunidades carregadas.`}
            </div>
        </div>
    );
}
